/**
 * Phase 5: Pipeline Execution Engine
 *
 * Executes pipelines as DAGs with support for:
 * - Agent nodes that instantiate full AgentHarness instances
 * - Tool nodes that execute a single tool call directly
 * - Condition nodes with multiple evaluation strategies
 * - Parallel fork/join with concat or structured merge
 * - Transform nodes for data mapping between nodes
 * - Approval nodes that pause for human confirmation
 * - Retry policies and timeouts per node
 * - Pipeline-level variables and template substitution
 */

import type {
  PipelineConfig,
  PipelineNodeConfig,
  PipelineEdgeConfig,
  PipelineExecutionState,
  PipelineExecutionStatus,
  PipelineNodeType,
  PipelineEvent,
  ConditionConfig,
} from "../../protocol/src/pipeline-types";
import type { AgentHarness } from "./harness";
import type { AiApiKeys, AiMessage, HarnessRunResult } from "./types";

// ── Engine Options ────────────────────────────────────────────

export type PipelineEngineOptions = {
  /** Factory for creating AgentHarness instances from a harness ID */
  createHarness: (harnessId: string, configOverride?: Record<string, unknown>) => AgentHarness;

  /** Execute a tool directly (for tool nodes) */
  executeTool: (toolId: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

  /** Request human approval (for approval nodes) */
  requestApproval: (nodeId: string, context: unknown) => Promise<boolean>;

  /** API keys for LLM calls (agent nodes, LLM conditions) */
  apiKeys: AiApiKeys;

  /** Optional: called when a node starts */
  onNodeStart?: (nodeId: string, nodeType: PipelineNodeType) => void;

  /** Optional: called when a node completes */
  onNodeComplete?: (nodeId: string, output: unknown) => void;

  /** Optional: called when a node fails */
  onNodeError?: (nodeId: string, error: Error) => void;

  /** Optional: called for each pipeline event */
  onEvent?: (event: PipelineEvent) => void;

  /** Optional: LLM call function for condition nodes with type "llm" */
  callLlm?: (params: {
    prompt: string;
    model?: string;
    apiKeys: AiApiKeys;
    signal: AbortSignal;
  }) => Promise<string>;
};

// ── Pipeline Engine ───────────────────────────────────────────

export class PipelineEngine {
  private readonly config: PipelineConfig;
  private readonly options: PipelineEngineOptions;
  private state: PipelineExecutionState;
  private abortController: AbortController;
  private pausePromise: { resolve: () => void; promise: Promise<void> } | null = null;

  // DAG helpers: pre-computed adjacency
  private readonly outgoingEdges: Map<string, PipelineEdgeConfig[]>;
  private readonly incomingEdges: Map<string, PipelineEdgeConfig[]>;
  private readonly nodeMap: Map<string, PipelineNodeConfig>;

  constructor(config: PipelineConfig, options: PipelineEngineOptions) {
    this.config = config;
    this.options = options;
    this.abortController = new AbortController();

    // Initialize execution state
    this.state = {
      id: crypto.randomUUID(),
      pipelineId: config.id,
      status: "running",
      currentNodeIds: [],
      completedNodeIds: [],
      failedNodeIds: [],
      nodeOutputs: {},
      nodeErrors: {},
      variables: { ...(config.variables ?? {}) },
      startedAt: Date.now(),
    };

    // Build adjacency maps
    this.nodeMap = new Map(config.nodes.map((n) => [n.id, n]));
    this.outgoingEdges = new Map<string, PipelineEdgeConfig[]>();
    this.incomingEdges = new Map<string, PipelineEdgeConfig[]>();

    for (const node of config.nodes) {
      this.outgoingEdges.set(node.id, []);
      this.incomingEdges.set(node.id, []);
    }

    for (const edge of config.edges) {
      this.outgoingEdges.get(edge.source)?.push(edge);
      this.incomingEdges.get(edge.target)?.push(edge);
    }
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Execute the pipeline with the given input.
   * Starts from all "input" nodes and follows the DAG.
   */
  async execute(input: Record<string, unknown>): Promise<PipelineExecutionState> {
    this.state.variables = { ...this.state.variables, input };
    this.emitEvent({ type: "pipeline.execution.started" });

    // Find input/start nodes
    const startNodes = this.config.nodes.filter(
      (n) => n.type === "input",
    );

    if (startNodes.length === 0) {
      this.state.status = "failed";
      this.state.nodeErrors["_pipeline"] = "No input nodes found";
      this.state.finishedAt = Date.now();
      this.emitEvent({ type: "pipeline.execution.failed", error: "No input nodes found" });
      return this.state;
    }

    try {
      // Execute all start nodes in parallel
      await Promise.all(
        startNodes.map((node) => this.executeNode(node.id, input)),
      );

      if (this.state.status === "running") {
        this.state.status = "completed";
        this.state.finishedAt = Date.now();
        this.emitEvent({ type: "pipeline.execution.completed" });
      }
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.state.status = "canceled";
        this.emitEvent({ type: "pipeline.execution.canceled" });
      } else if (this.state.status !== "paused") {
        this.state.status = "failed";
        this.emitEvent({
          type: "pipeline.execution.failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.state.finishedAt = Date.now();
    }

    return this.state;
  }

  /** Pause execution. Running nodes will complete, but no new nodes start. */
  pause(): void {
    if (this.state.status !== "running") return;
    this.state.status = "paused";
    this.pausePromise = createDeferredPromise();
    this.emitEvent({ type: "pipeline.execution.paused" });
  }

  /** Resume a paused execution. */
  resume(): void {
    if (this.state.status !== "paused" || !this.pausePromise) return;
    this.state.status = "running";
    this.pausePromise.resolve();
    this.pausePromise = null;
  }

  /** Cancel execution. All running nodes will be aborted. */
  cancel(): void {
    this.abortController.abort();
    if (this.pausePromise) {
      this.pausePromise.resolve(); // unblock pause so it can exit
      this.pausePromise = null;
    }
    this.state.status = "canceled";
    this.state.finishedAt = Date.now();
    this.emitEvent({ type: "pipeline.execution.canceled" });
  }

  /** Get the current execution state. */
  getState(): PipelineExecutionState {
    return { ...this.state };
  }

  // ── Node Execution ──────────────────────────────────────────

  private async executeNode(nodeId: string, input: unknown): Promise<void> {
    // Check abort/pause
    if (this.abortController.signal.aborted) {
      throw new Error("Pipeline canceled");
    }
    if (this.state.status === "paused" && this.pausePromise) {
      await this.pausePromise.promise;
      if (this.abortController.signal.aborted) {
        throw new Error("Pipeline canceled");
      }
    }

    const node = this.nodeMap.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    // Mark node as current
    this.state.currentNodeIds.push(nodeId);
    this.options.onNodeStart?.(nodeId, node.type);
    this.emitEvent({ type: "pipeline.node.started", nodeId, nodeType: node.type });

    try {
      const output = await this.executeNodeByType(node, input);

      // Store output and mark complete
      this.state.nodeOutputs[nodeId] = output;
      this.state.completedNodeIds.push(nodeId);
      this.state.currentNodeIds = this.state.currentNodeIds.filter((id) => id !== nodeId);
      this.options.onNodeComplete?.(nodeId, output);
      this.emitEvent({ type: "pipeline.node.completed", nodeId, nodeType: node.type, output });

      // Follow outgoing edges (unless handled internally by the node type)
      if (node.type !== "condition" && node.type !== "output") {
        await this.executeDownstream(nodeId, output);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Retry logic
      if (node.retryPolicy) {
        const retried = await this.retryNode(node, input, err);
        if (retried) return;
      }

      this.state.failedNodeIds.push(nodeId);
      this.state.nodeErrors[nodeId] = err.message;
      this.state.currentNodeIds = this.state.currentNodeIds.filter((id) => id !== nodeId);
      this.options.onNodeError?.(nodeId, err);
      this.emitEvent({ type: "pipeline.node.failed", nodeId, nodeType: node.type, error: err.message });
      throw err;
    }
  }

  /**
   * Execute a node based on its type. Returns the node's output.
   */
  private async executeNodeByType(node: PipelineNodeConfig, input: unknown): Promise<unknown> {
    const signal = this.abortController.signal;

    // Wrap with timeout if configured
    if (node.timeoutMs) {
      return withTimeout(
        () => this.executeNodeCore(node, input, signal),
        node.timeoutMs,
        `Node "${node.label}" timed out after ${node.timeoutMs}ms`,
      );
    }

    return this.executeNodeCore(node, input, signal);
  }

  private async executeNodeCore(
    node: PipelineNodeConfig,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (node.type) {
      case "input":
        return input;

      case "output":
        // Terminal node — store output and stop
        return input;

      case "agent":
        return this.executeAgentNode(node, input, signal);

      case "tool":
        return this.executeToolNode(node, input, signal);

      case "condition":
        return this.executeConditionNode(node, input, signal);

      case "parallel":
        return this.executeParallelNode(node, input);

      case "join":
        return this.executeJoinNode(node);

      case "transform":
        return this.executeTransformNode(node, input);

      case "approval":
        return this.executeApprovalNode(node, input);

      default:
        throw new Error(`Unknown node type: ${(node as PipelineNodeConfig).type}`);
    }
  }

  // ── Agent Node ──────────────────────────────────────────────

  private async executeAgentNode(
    node: PipelineNodeConfig,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const harnessId = node.harnessId;
    if (!harnessId) {
      throw new Error(`Agent node "${node.label}" has no harnessId`);
    }

    const harness = this.options.createHarness(
      harnessId,
      node.harnessConfig as Record<string, unknown> | undefined,
    );

    const inputStr = typeof input === "string" ? input : JSON.stringify(input);
    const messages: AiMessage[] = [{ role: "user", content: inputStr }];

    const result: HarnessRunResult = await harness.run(
      messages,
      this.options.apiKeys,
      signal,
    );

    if (result.stopReason === "error") {
      throw new Error(result.error ?? "Agent execution failed");
    }

    return result.response;
  }

  // ── Tool Node ───────────────────────────────────────────────

  private async executeToolNode(
    node: PipelineNodeConfig,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const toolId = node.toolId;
    if (!toolId) {
      throw new Error(`Tool node "${node.label}" has no toolId`);
    }

    // Resolve template variables in tool args
    const resolvedArgs = this.resolveTemplateArgs(
      node.toolArgs ?? {},
      input,
    );

    return this.options.executeTool(toolId, resolvedArgs, signal);
  }

  // ── Condition Node ──────────────────────────────────────────

  private async executeConditionNode(
    node: PipelineNodeConfig,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const conditionConfig = node.condition;
    if (!conditionConfig) {
      throw new Error(`Condition node "${node.label}" has no condition config`);
    }

    const result = await this.evaluateCondition(conditionConfig, input, signal);
    const outputLabel = result ? "true" : "false";

    // Store condition result
    this.state.nodeOutputs[node.id] = outputLabel;
    this.state.completedNodeIds.push(node.id);
    this.state.currentNodeIds = this.state.currentNodeIds.filter((id) => id !== node.id);
    this.options.onNodeComplete?.(node.id, outputLabel);
    this.emitEvent({
      type: "pipeline.node.completed",
      nodeId: node.id,
      nodeType: node.type,
      output: outputLabel,
    });

    // Route to the matching edge
    const outEdges = this.outgoingEdges.get(node.id) ?? [];
    const matchingEdge = outEdges.find(
      (e) => e.sourceHandle === outputLabel || e.label === outputLabel,
    );

    // Fall back to first edge if no label match
    const targetEdge = matchingEdge ?? outEdges[0];
    if (targetEdge) {
      await this.executeNode(targetEdge.target, input);
    }

    return outputLabel;
  }

  private async evaluateCondition(
    config: ConditionConfig,
    input: unknown,
    signal: AbortSignal,
  ): Promise<boolean> {
    const inputStr = typeof input === "string" ? input : JSON.stringify(input);

    switch (config.type) {
      case "exit_code": {
        const code = typeof input === "number"
          ? input
          : typeof input === "object" && input !== null && "exitCode" in input
            ? (input as { exitCode: number }).exitCode
            : NaN;
        if (config.operator === "eq") return code === config.value;
        if (config.operator === "neq") return code !== config.value;
        return false;
      }

      case "contains": {
        if (config.caseSensitive) {
          return inputStr.includes(config.text);
        }
        return inputStr.toLowerCase().includes(config.text.toLowerCase());
      }

      case "regex": {
        const regex = new RegExp(config.pattern);
        return regex.test(inputStr);
      }

      case "expression": {
        try {
          // Evaluate a JS expression with `input` and `variables` in scope
          const fn = new Function("input", "variables", `return !!(${config.expression})`);
          return fn(input, this.state.variables);
        } catch {
          return false;
        }
      }

      case "llm": {
        if (!this.options.callLlm) {
          throw new Error("LLM condition requires a callLlm function in engine options");
        }
        const prompt = `${config.prompt}\n\nInput:\n${inputStr}\n\nRespond with exactly "true" or "false".`;
        const response = await this.options.callLlm({
          prompt,
          model: config.model,
          apiKeys: this.options.apiKeys,
          signal,
        });
        return response.trim().toLowerCase() === "true";
      }

      default:
        return false;
    }
  }

  // ── Parallel Node ───────────────────────────────────────────

  private async executeParallelNode(
    node: PipelineNodeConfig,
    input: unknown,
  ): Promise<unknown> {
    // Fork: execute all downstream nodes in parallel
    const outEdges = this.outgoingEdges.get(node.id) ?? [];

    // Mark this node complete before forking
    this.state.nodeOutputs[node.id] = input;
    this.state.completedNodeIds.push(node.id);
    this.state.currentNodeIds = this.state.currentNodeIds.filter((id) => id !== node.id);
    this.options.onNodeComplete?.(node.id, input);
    this.emitEvent({
      type: "pipeline.node.completed",
      nodeId: node.id,
      nodeType: node.type,
      output: input,
    });

    await Promise.all(
      outEdges.map((edge) => this.executeNode(edge.target, input)),
    );

    return input;
  }

  // ── Join Node ───────────────────────────────────────────────

  private async executeJoinNode(node: PipelineNodeConfig): Promise<unknown> {
    const inEdges = this.incomingEdges.get(node.id) ?? [];

    // Check if all incoming nodes have completed
    const allReady = inEdges.every((e) =>
      this.state.completedNodeIds.includes(e.source),
    );

    if (!allReady) {
      // Not all branches done — this will be called again by the last branch
      // Remove from current and don't mark complete yet
      this.state.currentNodeIds = this.state.currentNodeIds.filter((id) => id !== node.id);
      return undefined;
    }

    const strategy = node.joinStrategy ?? "concat";

    if (strategy === "structured") {
      // Produce a JSON object keyed by source node IDs
      const result: Record<string, unknown> = {};
      for (const edge of inEdges) {
        result[edge.source] = this.state.nodeOutputs[edge.source];
      }
      return result;
    }

    // Default: concat strategy
    const outputs = inEdges
      .map((e) => {
        const val = this.state.nodeOutputs[e.source];
        return typeof val === "string" ? val : JSON.stringify(val);
      })
      .filter(Boolean)
      .join("\n---\n");

    return outputs;
  }

  // ── Transform Node ──────────────────────────────────────────

  private async executeTransformNode(
    node: PipelineNodeConfig,
    input: unknown,
  ): Promise<unknown> {
    const expression = node.transformExpression;
    if (!expression) {
      return input; // passthrough
    }

    try {
      const fn = new Function("input", "variables", `return (${expression})`);
      return fn(input, this.state.variables);
    } catch (error) {
      throw new Error(
        `Transform expression failed in node "${node.label}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ── Approval Node ──────────────────────────────────────────

  private async executeApprovalNode(
    node: PipelineNodeConfig,
    input: unknown,
  ): Promise<unknown> {
    this.emitEvent({
      type: "pipeline.node.approval_required",
      nodeId: node.id,
      nodeType: node.type,
    });

    const approved = await this.options.requestApproval(node.id, {
      nodeLabel: node.label,
      input,
      pipelineId: this.config.id,
      executionId: this.state.id,
    });

    if (!approved) {
      throw new Error(`Approval denied for node "${node.label}"`);
    }

    return input; // passthrough on approval
  }

  // ── Downstream Execution ────────────────────────────────────

  private async executeDownstream(nodeId: string, output: unknown): Promise<void> {
    const outEdges = this.outgoingEdges.get(nodeId) ?? [];

    for (const edge of outEdges) {
      // Evaluate edge-level condition if present
      if (edge.condition) {
        try {
          const fn = new Function("output", "variables", `return !!(${edge.condition})`);
          const shouldFollow = fn(output, this.state.variables);
          if (!shouldFollow) continue;
        } catch {
          continue; // Skip edge on condition error
        }
      }

      await this.executeNode(edge.target, output);
    }
  }

  // ── Retry Logic ─────────────────────────────────────────────

  private async retryNode(
    node: PipelineNodeConfig,
    input: unknown,
    lastError: Error,
  ): Promise<boolean> {
    const policy = node.retryPolicy;
    if (!policy) return false;

    for (let attempt = 1; attempt <= policy.maxRetries; attempt++) {
      // Wait with backoff
      await sleep(policy.backoffMs * attempt);

      if (this.abortController.signal.aborted) return false;

      try {
        const output = await this.executeNodeByType(node, input);

        // Success — store output and mark complete
        this.state.nodeOutputs[node.id] = output;
        this.state.completedNodeIds.push(node.id);
        this.state.currentNodeIds = this.state.currentNodeIds.filter((id) => id !== node.id);
        this.options.onNodeComplete?.(node.id, output);
        this.emitEvent({
          type: "pipeline.node.completed",
          nodeId: node.id,
          nodeType: node.type,
          output,
        });

        if (node.type !== "condition" && node.type !== "output") {
          await this.executeDownstream(node.id, output);
        }

        return true;
      } catch {
        // Continue retrying
      }
    }

    return false; // All retries exhausted
  }

  // ── Template Resolution ─────────────────────────────────────

  /**
   * Resolve {{input}}, {{variables.key}}, and {{nodeOutputs.nodeId}}
   * template references in tool arguments.
   */
  private resolveTemplateArgs(
    args: Record<string, unknown>,
    input: unknown,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        resolved[key] = this.resolveTemplateString(value, input);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  private resolveTemplateString(template: string, input: unknown): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
      const parts = path.split(".");
      const root = parts[0];
      const rest = parts.slice(1);

      let value: unknown;

      if (root === "input") {
        value = rest.length > 0 ? getNestedValue(input, rest) : input;
      } else if (root === "variables") {
        value = rest.length > 0 ? getNestedValue(this.state.variables, rest) : this.state.variables;
      } else if (root === "nodeOutputs") {
        value = rest.length > 0 ? getNestedValue(this.state.nodeOutputs, rest) : this.state.nodeOutputs;
      } else {
        value = getNestedValue(this.state.variables, parts);
      }

      if (value === undefined || value === null) return "";
      return typeof value === "string" ? value : JSON.stringify(value);
    });
  }

  // ── Event Emission ──────────────────────────────────────────

  private emitEvent(partial: Partial<PipelineEvent> & { type: PipelineEvent["type"] }): void {
    const event: PipelineEvent = {
      executionId: this.state.id,
      timestamp: Date.now(),
      ...partial,
    };
    this.options.onEvent?.(event);
  }
}

// ── Utility Functions ─────────────────────────────────────────

function getNestedValue(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferredPromise(): { resolve: () => void; promise: Promise<void> } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs),
    ),
  ]);
}
