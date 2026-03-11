import { ApprovalQueue } from "./approval-queue";
import { ToolExecutor, type DaemonClient } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";
import type {
  AiApiKeys,
  AiMessage,
  HarnessCallbacks,
  HarnessConfig,
  HarnessRunResult,
  ToolAction,
  ToolResult,
} from "./types";

// ── Tool call parsing ────────────────────────────────────────

const TOOL_CALL_RE = /\[TOOL_CALL\]\s*([\s\S]*?)\[\/TOOL_CALL\]/g;

/**
 * Parse tool calls from an LLM response.
 * Tool calls use the format:
 *   [TOOL_CALL]
 *   tool: <tool_name>
 *   param: value
 *   [/TOOL_CALL]
 */
export function parseToolCalls(text: string): { actions: ToolAction[]; cleanText: string } {
  const actions: ToolAction[] = [];
  let cleanText = text;

  let match;
  // Reset lastIndex for global regex
  TOOL_CALL_RE.lastIndex = 0;
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    const body = match[1].trim();
    const action = parseToolCallBody(body);
    if (action) {
      actions.push(action);
    }
    cleanText = cleanText.replace(match[0], "").trim();
  }

  return { actions, cleanText };
}

function parseToolCallBody(body: string): ToolAction | null {
  const lines = body.split("\n").map((l) => l.trim());
  const params: Record<string, string> = {};

  // Parse key-value pairs. Handles multi-line "content:" values.
  let currentKey = "";
  let currentValue = "";
  let inMultiline = false;

  for (const line of lines) {
    if (!inMultiline) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      currentKey = key;
      currentValue = value;

      // "content" is allowed to be multi-line — everything after "content:" to end
      if (key === "content" && value === "") {
        inMultiline = true;
        continue;
      }

      params[key] = value;
    } else {
      // Accumulate multi-line content
      currentValue += (currentValue ? "\n" : "") + line;
    }
  }

  // Save multi-line content
  if (inMultiline && currentKey) {
    params[currentKey] = currentValue;
  }

  const toolName = params.tool;
  if (!toolName) return null;

  switch (toolName) {
    case "read_file":
      if (!params.path) return null;
      return { tool: "read_file", path: params.path };

    case "write_file":
      if (!params.path || params.content === undefined) return null;
      return { tool: "write_file", path: params.path, content: params.content };

    case "run_command":
      if (!params.command) return null;
      return { tool: "run_command", command: params.command, cwd: params.cwd };

    case "code_search":
      if (!params.query) return null;
      return { tool: "code_search", query: params.query, path: params.path };

    case "web_search":
      if (!params.query) return null;
      return { tool: "web_search", query: params.query };

    case "read_url":
      if (!params.url) return null;
      return { tool: "read_url", url: params.url };

    case "git":
      if (!params.operation) return null;
      return {
        tool: "git",
        operation: params.operation,
        args: params.args ? params.args.split(" ") : undefined,
      };

    case "terminal_session":
      if (!params.command) return null;
      return { tool: "terminal_session", command: params.command };

    case "custom":
      if (!params.toolId) return null;
      return {
        tool: "custom",
        toolId: params.toolId,
        input: JSON.parse(params.input || "{}"),
      };

    case "mcp":
      if (!params.serverId || !params.toolName) return null;
      return {
        tool: "mcp",
        serverId: params.serverId,
        toolName: params.toolName,
        input: JSON.parse(params.input || "{}"),
      };

    default:
      return null;
  }
}

/**
 * Format tool results as a message to feed back to the LLM.
 */
function formatToolResults(results: Array<{ action: ToolAction; result: ToolResult }>): string {
  if (results.length === 0) return "";

  const sections = results.map(({ action, result }) => {
    const header = `[TOOL_RESULT: ${action.tool}]`;
    if (result.success) {
      return `${header}\n${result.output}\n[/TOOL_RESULT]`;
    }
    return `${header}\nERROR: ${result.error}\n[/TOOL_RESULT]`;
  });

  return sections.join("\n\n");
}

// ── LLM Call Abstraction ─────────────────────────────────────

/**
 * Function type for calling an LLM. The harness doesn't import the ai-client
 * directly — the caller provides this function so the harness stays decoupled
 * from provider-specific SDK code.
 */
export type LlmCallFn = (params: {
  provider: string;
  model: string;
  systemPrompt: string;
  messages: AiMessage[];
  apiKeys: AiApiKeys;
  onChunk: (text: string) => void;
  signal: AbortSignal;
}) => Promise<{
  text: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}>;

// ── Dependencies ─────────────────────────────────────────────

export type HarnessDependencies = {
  /** Function to call an LLM — provided by the caller */
  callLlm: LlmCallFn;
  /** Local daemon client for file/terminal/git operations */
  daemonClient?: DaemonClient;
  /** Shared approval queue (can be shared across multiple harness instances) */
  approvalQueue?: ApprovalQueue;
  /** Workspace root path */
  workspaceRoot: string;
};

// ── AgentHarness ─────────────────────────────────────────────

/**
 * AgentHarness ties everything together. It's instantiated from a HarnessConfig
 * and dependencies, then runs the agent loop: call LLM, parse tool calls,
 * execute tools, feed results back, repeat.
 *
 * This replaces the inline dispatch closure in session-store.ts and the
 * text-based ACTION parsing in conversation-loop.ts.
 */
export class AgentHarness {
  readonly config: HarnessConfig;
  private readonly registry: ToolRegistry;
  private readonly executor: ToolExecutor;
  private readonly approvalQueue: ApprovalQueue;
  private readonly callLlm: LlmCallFn;

  constructor(config: HarnessConfig, deps: HarnessDependencies) {
    this.config = config;
    this.callLlm = deps.callLlm;

    this.registry = new ToolRegistry(config.toolGrants, config.approvalPolicy);

    this.approvalQueue = deps.approvalQueue ?? new ApprovalQueue();

    this.executor = new ToolExecutor({
      workspaceRoot: deps.workspaceRoot,
      registry: this.registry,
      approvalQueue: this.approvalQueue,
      harnessId: config.id,
      daemonClient: deps.daemonClient,
    });
  }

  /**
   * Get the underlying tool registry (for prompt generation etc.)
   */
  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /**
   * Get the approval queue.
   */
  getApprovalQueue(): ApprovalQueue {
    return this.approvalQueue;
  }

  /**
   * Register a custom tool handler on the executor.
   */
  registerToolHandler(toolKey: string, handler: (action: ToolAction, signal: AbortSignal) => Promise<ToolResult>): void {
    this.executor.registerHandler(toolKey, handler);
  }

  /**
   * Run the agent on a set of messages.
   *
   * The loop:
   *   1. Build system prompt from harness config (soul + tool descriptions)
   *   2. Call LLM with messages
   *   3. Parse response for tool calls
   *   4. For each tool call:
   *      a. Check registry.canExecute() — reject if not granted
   *      b. Check registry.needsApproval() — queue if needed
   *      c. Execute via ToolExecutor
   *      d. Collect result
   *   5. If tool calls were made, feed results back as user message and goto 2
   *   6. If no tool calls, return the final response
   *   7. Stop after maxIterations
   */
  async run(
    messages: AiMessage[],
    apiKeys: AiApiKeys,
    signal: AbortSignal,
    callbacks?: HarnessCallbacks,
  ): Promise<HarnessRunResult> {
    const allToolCalls: Array<{ action: ToolAction; result: ToolResult }> = [];
    const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const maxIterations = this.config.execution.maxIterations;

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt();

    // Working copy of messages — we append tool results as user messages
    const workingMessages: AiMessage[] = [...messages];

    let lastResponseText = "";

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (signal.aborted) {
        return {
          response: lastResponseText,
          toolCalls: allToolCalls,
          iterations: iteration - 1,
          totalUsage,
          stopReason: "aborted",
        };
      }

      callbacks?.onIterationStart?.(iteration);

      // Call LLM
      let llmResult;
      try {
        llmResult = await this.callLlmWithFallbacks(
          systemPrompt,
          workingMessages,
          apiKeys,
          (text) => callbacks?.onChunk?.(text),
          signal,
        );
      } catch (err) {
        return {
          response: lastResponseText,
          toolCalls: allToolCalls,
          iterations: iteration,
          totalUsage,
          stopReason: "error",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Accumulate usage
      totalUsage.inputTokens += llmResult.usage.inputTokens;
      totalUsage.outputTokens += llmResult.usage.outputTokens;
      totalUsage.totalTokens += llmResult.usage.totalTokens;

      // Parse tool calls from the response
      const { actions, cleanText } = parseToolCalls(llmResult.text);
      lastResponseText = cleanText || llmResult.text;

      // No tool calls — we're done
      if (actions.length === 0) {
        return {
          response: lastResponseText,
          toolCalls: allToolCalls,
          iterations: iteration,
          totalUsage,
          stopReason: "completed",
        };
      }

      // Execute tool calls
      const iterationResults: Array<{ action: ToolAction; result: ToolResult }> = [];

      for (const action of actions) {
        if (signal.aborted) break;

        callbacks?.onToolCall?.(action);
        const result = await this.executor.execute(action, signal);
        callbacks?.onToolResult?.(action, result);

        iterationResults.push({ action, result });
        allToolCalls.push({ action, result });
      }

      // Add assistant message (the response with tool calls)
      workingMessages.push({ role: "assistant", content: llmResult.text });

      // Feed tool results back as a user message
      const resultsText = formatToolResults(iterationResults);
      workingMessages.push({ role: "user", content: resultsText });
    }

    // Hit max iterations
    return {
      response: lastResponseText,
      toolCalls: allToolCalls,
      iterations: maxIterations,
      totalUsage,
      stopReason: "max_iterations",
    };
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Build the system prompt from harness config components.
   */
  private buildSystemPrompt(): string {
    const sections: string[] = [];

    // Soul / identity
    if (this.config.soul) {
      if (this.config.soul.soul) {
        sections.push(`# Identity\n${this.config.soul.soul}`);
      }
      if (this.config.soul.style) {
        sections.push(`# Style\n${this.config.soul.style}`);
      }
      if (this.config.soul.skill) {
        sections.push(`# Skills & Instructions\n${this.config.soul.skill}`);
      }
      if (this.config.soul.memory) {
        sections.push(`# Memory\n${this.config.soul.memory}`);
      }
    }

    // Agent metadata
    sections.push(`# Agent: ${this.config.name}`);
    if (this.config.description) {
      sections.push(this.config.description);
    }

    // Tool descriptions
    const toolPrompt = this.registry.buildToolPrompt();
    if (toolPrompt) {
      sections.push(toolPrompt);
    }

    return sections.join("\n\n");
  }

  /**
   * Call the LLM, trying fallback models if the primary fails.
   */
  private async callLlmWithFallbacks(
    systemPrompt: string,
    messages: AiMessage[],
    apiKeys: AiApiKeys,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }> {
    const models = [
      this.config.model,
      ...(this.config.fallbacks ?? []),
    ];

    let lastError: Error | undefined;

    for (const model of models) {
      try {
        return await this.callLlm({
          provider: model.provider,
          model: model.model,
          systemPrompt,
          messages,
          apiKeys,
          onChunk,
          signal,
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Try next fallback
      }
    }

    throw lastError ?? new Error("All LLM models failed");
  }
}
