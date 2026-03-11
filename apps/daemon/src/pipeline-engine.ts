import { randomUUID } from "node:crypto";
import type {
  Pipeline,
  PipelineExecution,
  PipelineNode,
} from "@nateide/protocol";
import {
  chatCompletionWithFallback,
  type AgentRoleConfig,
  type AiApiKeys,
  type AiStreamChunk,
  type ChatCompletionResult,
} from "./ai-client";

export type PipelineCallbacks = {
  onNodeStarted: (executionId: string, nodeId: string, agentId?: string) => void;
  onNodeCompleted: (executionId: string, nodeId: string, output: string) => void;
  onChunk: (executionId: string, nodeId: string, chunk: AiStreamChunk) => void;
  onExecutionCompleted: (executionId: string, status: "completed" | "failed" | "canceled") => void;
};

export type PipelineContext = {
  apiKeys: AiApiKeys;
  agentRoles?: AgentRoleConfig[];
  signal?: AbortSignal;
  systemPromptPrefix?: string;
};

function findNodeById(pipeline: Pipeline, nodeId: string): PipelineNode | undefined {
  return pipeline.nodes.find((n) => n.id === nodeId);
}

function findOutgoingEdges(pipeline: Pipeline, nodeId: string) {
  return pipeline.edges.filter((e) => e.source === nodeId);
}

function findIncomingEdges(pipeline: Pipeline, nodeId: string) {
  return pipeline.edges.filter((e) => e.target === nodeId);
}

export async function executePipeline(
  pipeline: Pipeline,
  inputContent: string,
  context: PipelineContext,
  callbacks: PipelineCallbacks,
): Promise<PipelineExecution> {
  const executionId = randomUUID();
  const execution: PipelineExecution = {
    id: executionId,
    pipelineId: pipeline.id,
    status: "running",
    currentNodeIds: [],
    completedNodeIds: [],
    nodeOutputs: {},
    startedAt: new Date().toISOString(),
  };

  // Find start node
  const startNode = pipeline.nodes.find((n) => n.type === "start");
  if (!startNode) {
    execution.status = "failed";
    execution.finishedAt = new Date().toISOString();
    callbacks.onExecutionCompleted(executionId, "failed");
    return execution;
  }

  execution.nodeOutputs[startNode.id] = inputContent;

  try {
    await executeNode(pipeline, startNode.id, execution, inputContent, context, callbacks);
    execution.status = "completed";
    execution.finishedAt = new Date().toISOString();
    callbacks.onExecutionCompleted(executionId, "completed");
  } catch (error) {
    if (context.signal?.aborted) {
      execution.status = "canceled";
      callbacks.onExecutionCompleted(executionId, "canceled");
    } else {
      execution.status = "failed";
      callbacks.onExecutionCompleted(executionId, "failed");
    }
    execution.finishedAt = new Date().toISOString();
  }

  return execution;
}

async function executeNode(
  pipeline: Pipeline,
  nodeId: string,
  execution: PipelineExecution,
  input: string,
  context: PipelineContext,
  callbacks: PipelineCallbacks,
): Promise<void> {
  if (context.signal?.aborted) throw new Error("Pipeline canceled");

  const node = findNodeById(pipeline, nodeId);
  if (!node) return;

  execution.currentNodeIds = [...execution.currentNodeIds, nodeId];
  callbacks.onNodeStarted(execution.id, nodeId, node.agentId);

  let output = input;

  switch (node.type) {
    case "start":
      output = input;
      break;

    case "end":
      execution.nodeOutputs[nodeId] = input;
      execution.completedNodeIds.push(nodeId);
      execution.currentNodeIds = execution.currentNodeIds.filter((id) => id !== nodeId);
      callbacks.onNodeCompleted(execution.id, nodeId, input);
      return;

    case "agent": {
      if (!node.agentId) {
        output = input;
        break;
      }

      const systemPrompt = [
        context.systemPromptPrefix ?? "You are an AI agent in a pipeline.",
        `Your task: process the input and produce output for the next step.`,
        `Pipeline: ${pipeline.name}. Step: ${node.label}.`,
      ].join("\n");

      const result = await chatCompletionWithFallback(
        node.agentId,
        systemPrompt,
        [{ role: "user", content: input }],
        context.apiKeys,
        (chunk) => callbacks.onChunk(execution.id, nodeId, chunk),
        context.agentRoles,
        context.signal,
      );
      output = result.text;
      break;
    }

    case "condition": {
      // Simple condition evaluation: check if previous output contains the condition text
      const conditionMet = node.condition
        ? input.toLowerCase().includes(node.condition.toLowerCase())
        : true;

      execution.nodeOutputs[nodeId] = conditionMet ? "true" : "false";
      execution.completedNodeIds.push(nodeId);
      execution.currentNodeIds = execution.currentNodeIds.filter((id) => id !== nodeId);
      callbacks.onNodeCompleted(execution.id, nodeId, conditionMet ? "true" : "false");

      // Follow edges based on condition — edges with label "true" or "false"
      const outEdges = findOutgoingEdges(pipeline, nodeId);
      const matchingEdge = outEdges.find((e) => e.label === (conditionMet ? "true" : "false")) ?? outEdges[0];

      if (matchingEdge) {
        await executeNode(pipeline, matchingEdge.target, execution, input, context, callbacks);
      }
      return;
    }

    case "parallel-split": {
      execution.nodeOutputs[nodeId] = input;
      execution.completedNodeIds.push(nodeId);
      execution.currentNodeIds = execution.currentNodeIds.filter((id) => id !== nodeId);
      callbacks.onNodeCompleted(execution.id, nodeId, input);

      const outEdges = findOutgoingEdges(pipeline, nodeId);
      await Promise.all(
        outEdges.map((edge) =>
          executeNode(pipeline, edge.target, execution, input, context, callbacks),
        ),
      );
      return;
    }

    case "parallel-join": {
      // Collect outputs from all incoming nodes
      const inEdges = findIncomingEdges(pipeline, nodeId);
      const allInputsReady = inEdges.every((e) =>
        execution.completedNodeIds.includes(e.source),
      );

      if (!allInputsReady) {
        // Not all inputs ready yet — another branch will trigger this
        return;
      }

      const combinedInput = inEdges
        .map((e) => execution.nodeOutputs[e.source] ?? "")
        .filter(Boolean)
        .join("\n---\n");
      output = combinedInput;
      break;
    }
  }

  execution.nodeOutputs[nodeId] = output;
  execution.completedNodeIds.push(nodeId);
  execution.currentNodeIds = execution.currentNodeIds.filter((id) => id !== nodeId);
  callbacks.onNodeCompleted(execution.id, nodeId, output);

  // Follow outgoing edges
  const outEdges = findOutgoingEdges(pipeline, nodeId);
  for (const edge of outEdges) {
    await executeNode(pipeline, edge.target, execution, output, context, callbacks);
  }
}
