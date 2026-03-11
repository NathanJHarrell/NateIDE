import type { Visibility } from "@nateide/protocol";

// ── Approval Policy ──────────────────────────────────────────

/**
 * "safe" = mutating tools require user approval before execution.
 * "yolo" = all tool calls execute immediately without confirmation.
 */
export type ApprovalPolicy = "safe" | "yolo";

// ── Tool Grants ──────────────────────────────────────────────

/**
 * A discriminated union of all grantable tool types.
 * Each variant specifies the tool and optional per-tool restrictions.
 */
export type ToolGrant =
  | { tool: "read_file" }
  | { tool: "write_file"; requireApproval?: boolean }
  | { tool: "run_command"; requireApproval?: boolean; allowlist?: string[] }
  | { tool: "web_search" }
  | { tool: "read_url" }
  | { tool: "code_search" }
  | { tool: "git"; operations?: string[] }
  | { tool: "terminal_session" }
  | { tool: "custom"; toolId: string }
  | { tool: "mcp"; serverId: string; toolName: string };

/** Extract the tool name string from the union */
export type ToolName = ToolGrant["tool"];

// ── Execution Policy ─────────────────────────────────────────

export type ContextStrategy = "full" | "windowed" | "summary";

export type ExecutionPolicy = {
  maxIterations: number;
  maxTokensPerTurn: number;
  contextStrategy: ContextStrategy;
};

// ── Soul Config (placeholder — Phase 3 expands this) ─────────

export type SoulConfig = {
  soul: string;
  style: string;
  skill: string;
  memory: string;
};

// ── Model Config ─────────────────────────────────────────────

export type ModelConfig = {
  provider: string;
  model: string;
};

// ── HarnessConfig ────────────────────────────────────────────

/**
 * The complete definition of an agent. A harness is model + tools + soul
 * + execution policy. Built-in agents are just pre-filled harness configs.
 */
export type HarnessConfig = {
  id: string;
  name: string;
  description: string;

  /** Primary model */
  model: ModelConfig;
  /** Fallback models tried in order if the primary fails */
  fallbacks?: ModelConfig[];

  /** Which tools this agent is allowed to use */
  toolGrants: ToolGrant[];
  /** How mutating tool calls are handled */
  approvalPolicy: ApprovalPolicy;

  /** Soul documents — identity, voice, skills, memory */
  soul?: SoulConfig;

  /** Execution constraints */
  execution: ExecutionPolicy;

  /** Sharing / visibility */
  visibility: Visibility;

  /** Display */
  color: string;
  icon?: string;

  /** Ownership */
  createdBy: string;
  workspaceId?: string;
  createdAt: number;
  updatedAt: number;

  /** Whether this is a built-in default harness */
  isBuiltIn?: boolean;
};

// ── Tool Action (what the LLM requests) ──────────────────────

export type ToolAction =
  | { tool: "read_file"; path: string }
  | { tool: "write_file"; path: string; content: string }
  | { tool: "run_command"; command: string; cwd?: string }
  | { tool: "code_search"; query: string; path?: string }
  | { tool: "web_search"; query: string }
  | { tool: "read_url"; url: string }
  | { tool: "git"; operation: string; args?: string[] }
  | { tool: "terminal_session"; command: string }
  | { tool: "custom"; toolId: string; input: Record<string, unknown> }
  | { tool: "mcp"; serverId: string; toolName: string; input: Record<string, unknown> };

// ── Tool Result ──────────────────────────────────────────────

export type ToolResult = {
  tool: string;
  success: boolean;
  output: string;
  error?: string;
  /** Duration in milliseconds */
  durationMs?: number;
};

// ── Approval ─────────────────────────────────────────────────

export type ApprovalRequest = {
  id: string;
  harnessId: string;
  action: ToolAction;
  description: string;
  createdAt: number;
};

export type ApprovalDecision = "approved" | "denied";

export type ApprovalResult = {
  requestId: string;
  decision: ApprovalDecision;
  decidedBy?: string;
  decidedAt: number;
};

// ── Tool Description (for system prompt generation) ──────────

export type ToolDescription = {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
};

// ── Harness Run Result ───────────────────────────────────────

export type HarnessRunResult = {
  /** The final text response from the agent */
  response: string;
  /** All tool calls made during the run */
  toolCalls: Array<{ action: ToolAction; result: ToolResult }>;
  /** Total iterations (LLM calls) */
  iterations: number;
  /** Token usage across all iterations */
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Why the run ended */
  stopReason: "completed" | "max_iterations" | "aborted" | "error";
  /** Error message if stopReason is "error" */
  error?: string;
};

// ── Callbacks ────────────────────────────────────────────────

export type HarnessCallbacks = {
  onChunk?: (text: string) => void;
  onToolCall?: (action: ToolAction) => void;
  onToolResult?: (action: ToolAction, result: ToolResult) => void;
  onApprovalRequested?: (request: ApprovalRequest) => void;
  onApprovalResolved?: (result: ApprovalResult) => void;
  onIterationStart?: (iteration: number) => void;
};

// ── AI types (duplicated minimally to avoid daemon dependency) ─

export type AiMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiApiKeys = {
  anthropic: string;
  google: string;
  openai: string;
  openrouter: string;
};
