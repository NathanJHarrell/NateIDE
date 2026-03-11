/**
 * Phase 5: Enhanced pipeline types.
 *
 * Extends the basic pipeline system with harness-per-node execution,
 * tool nodes, improved conditions, and execution state tracking.
 */

import type { Visibility } from "./convex-types";

// ── Node Types ────────────────────────────────────────────────

/** All supported pipeline node types */
export type PipelineNodeType =
  | "agent"        // Runs a harness (full LLM agent loop)
  | "tool"         // Executes a single tool directly
  | "condition"    // Branch based on expression
  | "parallel"     // Fork into parallel branches
  | "join"         // Wait for parallel branches
  | "input"        // Pipeline input/start
  | "output"       // Pipeline output/end
  | "transform"    // Transform data between nodes
  | "approval";    // Require human approval to proceed

// ── Condition Config ──────────────────────────────────────────

/** Condition evaluation strategies for condition nodes */
export type ConditionConfig =
  | { type: "exit_code"; operator: "eq" | "neq"; value: number }
  | { type: "contains"; text: string; caseSensitive?: boolean }
  | { type: "regex"; pattern: string }
  | { type: "llm"; prompt: string; model?: string }
  | { type: "expression"; expression: string };

// ── Retry Policy ──────────────────────────────────────────────

export type RetryPolicy = {
  maxRetries: number;
  backoffMs: number;
};

// ── Node Config ───────────────────────────────────────────────

export type PipelineNodeConfig = {
  id: string;
  type: PipelineNodeType;
  label: string;
  position: { x: number; y: number };

  // Agent node config
  harnessId?: string;                      // reference a saved harness by ID
  harnessConfig?: {                        // inline harness config override
    provider?: string;
    model?: string;
    tools?: Array<{ tool: string; [key: string]: unknown }>;
    approvalPolicy?: "safe" | "yolo";
    maxIterations?: number;
  };
  soulOverride?: {                         // override soul for this pipeline step
    soul?: string;
    style?: string;
    skill?: string;
    memory?: string;
  };

  // Tool node config
  toolId?: string;                         // built-in, custom, or MCP tool
  toolArgs?: Record<string, unknown>;      // static tool arguments
  toolApprovalPolicy?: "safe" | "yolo";    // override pipeline default

  // Condition node config
  condition?: ConditionConfig;
  conditionOutputs?: string[];             // named outputs (e.g. ["true", "false"])

  // Join node config
  joinStrategy?: "concat" | "structured";

  // Transform node config
  transformExpression?: string;            // JS expression for data transform

  // Execution config (any node)
  timeoutMs?: number;                      // max execution time for this node
  retryPolicy?: RetryPolicy;
};

// ── Edge Config ───────────────────────────────────────────────

export type PipelineEdgeConfig = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;     // for condition branches ("true", "false", etc.)
  label?: string;            // display label on the edge
  condition?: string;        // edge-level condition (JS expression)
};

// ── Pipeline Config ───────────────────────────────────────────

export type PipelineConfig = {
  id: string;
  name: string;
  description: string;
  nodes: PipelineNodeConfig[];
  edges: PipelineEdgeConfig[];
  variables?: Record<string, unknown>;   // pipeline-level variables
  defaultPolicy?: "safe" | "yolo";       // cascades to all nodes
  visibility: Visibility;
  createdBy: string;
  workspaceId?: string;
  createdAt: number;
  updatedAt: number;
};

// ── Execution State ───────────────────────────────────────────

export type PipelineExecutionStatus =
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "paused"
  | "waiting_approval";

export type PipelineExecutionState = {
  id: string;
  pipelineId: string;
  status: PipelineExecutionStatus;
  currentNodeIds: string[];
  completedNodeIds: string[];
  failedNodeIds: string[];
  nodeOutputs: Record<string, unknown>;
  nodeErrors: Record<string, string>;
  variables: Record<string, unknown>;
  triggeredBy?: string;
  startedAt: number;
  finishedAt?: number;
};

// ── Pipeline Events ───────────────────────────────────────────

export type PipelineEventType =
  | "pipeline.execution.started"
  | "pipeline.execution.completed"
  | "pipeline.execution.failed"
  | "pipeline.execution.canceled"
  | "pipeline.execution.paused"
  | "pipeline.node.started"
  | "pipeline.node.completed"
  | "pipeline.node.failed"
  | "pipeline.node.approval_required";

export type PipelineEvent = {
  type: PipelineEventType;
  executionId: string;
  nodeId?: string;
  nodeType?: PipelineNodeType;
  output?: unknown;
  error?: string;
  timestamp: number;
};

// ── Import/Export ──────────────────────────────────────────────

export type ExportedPipeline = {
  format: "oc-pipeline-v1";
  pipeline: PipelineConfig;
  /** Inline harness configs for portability */
  embeddedHarnesses: Record<string, unknown>;
  /** Inline tool configs for portability */
  embeddedTools: Record<string, unknown>;
};
