import { ApprovalQueue } from "./approval-queue";
import { ToolRegistry } from "./tool-registry";
import type { ToolAction, ToolResult } from "./types";

/**
 * A handler function that executes a specific tool action.
 * Implementations are provided by the daemon client or registered dynamically.
 */
export type ToolHandler = (
  action: ToolAction,
  signal: AbortSignal,
) => Promise<ToolResult>;

/**
 * Interface for the local daemon client that performs filesystem/terminal ops.
 * The actual implementation lives in the daemon package — this is the contract
 * the harness expects.
 */
export type DaemonClient = {
  readFile(path: string, signal: AbortSignal): Promise<string>;
  writeFile(path: string, content: string, signal: AbortSignal): Promise<void>;
  runCommand(command: string, cwd: string | undefined, signal: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  codeSearch(query: string, path: string | undefined, signal: AbortSignal): Promise<string>;
  gitOperation(operation: string, args: string[] | undefined, signal: AbortSignal): Promise<string>;
  runInTerminal(command: string, signal: AbortSignal): Promise<string>;
};

export type ToolExecutorConfig = {
  workspaceRoot: string;
  registry: ToolRegistry;
  approvalQueue: ApprovalQueue;
  harnessId: string;
  /** The local daemon client for built-in tool execution */
  daemonClient?: DaemonClient;
};

/**
 * ToolExecutor dispatches tool calls to the right handler.
 *
 * For each tool call:
 *   1. Check ToolRegistry.canExecute() — reject if not granted
 *   2. Check ToolRegistry.needsApproval() — queue for user approval if needed
 *   3. Execute via the appropriate handler
 *   4. Return the result
 */
export class ToolExecutor {
  private readonly config: ToolExecutorConfig;
  private readonly customHandlers: Map<string, ToolHandler> = new Map();

  constructor(config: ToolExecutorConfig) {
    this.config = config;
  }

  /**
   * Register a custom tool handler (for custom and MCP tools in Phase 4).
   */
  registerHandler(toolKey: string, handler: ToolHandler): void {
    this.customHandlers.set(toolKey, handler);
  }

  /**
   * Execute a tool action with grant checking and approval flow.
   */
  async execute(action: ToolAction, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now();

    // 1. Check if the tool is granted
    const grantCheck = this.config.registry.canExecute(action);
    if (!grantCheck.allowed) {
      return {
        tool: action.tool,
        success: false,
        output: "",
        error: grantCheck.reason,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Check if approval is needed
    if (this.config.registry.needsApproval(action)) {
      const approval = await this.config.approvalQueue.requestApproval(
        this.config.harnessId,
        action,
      );

      if (approval.decision === "denied") {
        return {
          tool: action.tool,
          success: false,
          output: "",
          error: `Action denied by user: ${this.describeAction(action)}`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // 3. Check for abort before execution
    if (signal.aborted) {
      return {
        tool: action.tool,
        success: false,
        output: "",
        error: "Execution aborted",
        durationMs: Date.now() - startTime,
      };
    }

    // 4. Execute the tool
    try {
      const result = await this.dispatch(action, signal);
      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        tool: action.tool,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ── Private dispatch ─────────────────────────────────────────

  private async dispatch(action: ToolAction, signal: AbortSignal): Promise<ToolResult> {
    // Check for custom handler first
    const handlerKey = this.getHandlerKey(action);
    const customHandler = this.customHandlers.get(handlerKey);
    if (customHandler) {
      return customHandler(action, signal);
    }

    // Use daemon client for built-in tools
    const client = this.config.daemonClient;
    if (!client) {
      return {
        tool: action.tool,
        success: false,
        output: "",
        error: "No daemon client available. Tool execution requires a local daemon connection.",
      };
    }

    switch (action.tool) {
      case "read_file":
        return this.handleReadFile(client, action, signal);
      case "write_file":
        return this.handleWriteFile(client, action, signal);
      case "run_command":
        return this.handleRunCommand(client, action, signal);
      case "code_search":
        return this.handleCodeSearch(client, action, signal);
      case "git":
        return this.handleGit(client, action, signal);
      case "terminal_session":
        return this.handleTerminalSession(client, action, signal);
      case "web_search":
      case "read_url":
        return {
          tool: action.tool,
          success: false,
          output: "",
          error: `Tool "${action.tool}" is not yet implemented. Coming in Phase 4.`,
        };
      case "custom":
        return {
          tool: action.tool,
          success: false,
          output: "",
          error: `Custom tool "${action.toolId}" has no registered handler.`,
        };
      case "mcp":
        return {
          tool: action.tool,
          success: false,
          output: "",
          error: `MCP tool "${action.serverId}/${action.toolName}" has no registered handler.`,
        };
      default:
        return {
          tool: (action as ToolAction).tool,
          success: false,
          output: "",
          error: `Unknown tool: ${(action as ToolAction).tool}`,
        };
    }
  }

  private async handleReadFile(
    client: DaemonClient,
    action: Extract<ToolAction, { tool: "read_file" }>,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const content = await client.readFile(action.path, signal);
    return { tool: "read_file", success: true, output: content };
  }

  private async handleWriteFile(
    client: DaemonClient,
    action: Extract<ToolAction, { tool: "write_file" }>,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    await client.writeFile(action.path, action.content, signal);
    return {
      tool: "write_file",
      success: true,
      output: `File written: ${action.path} (${action.content.length} bytes)`,
    };
  }

  private async handleRunCommand(
    client: DaemonClient,
    action: Extract<ToolAction, { tool: "run_command" }>,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const result = await client.runCommand(action.command, action.cwd, signal);
    const output = [
      result.stdout,
      result.stderr ? `stderr: ${result.stderr}` : "",
      `exit code: ${result.exitCode}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      tool: "run_command",
      success: result.exitCode === 0,
      output,
      error: result.exitCode !== 0 ? `Command exited with code ${result.exitCode}` : undefined,
    };
  }

  private async handleCodeSearch(
    client: DaemonClient,
    action: Extract<ToolAction, { tool: "code_search" }>,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const results = await client.codeSearch(action.query, action.path, signal);
    return { tool: "code_search", success: true, output: results };
  }

  private async handleGit(
    client: DaemonClient,
    action: Extract<ToolAction, { tool: "git" }>,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const output = await client.gitOperation(action.operation, action.args, signal);
    return { tool: "git", success: true, output };
  }

  private async handleTerminalSession(
    client: DaemonClient,
    action: Extract<ToolAction, { tool: "terminal_session" }>,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const output = await client.runInTerminal(action.command, signal);
    return { tool: "terminal_session", success: true, output };
  }

  private getHandlerKey(action: ToolAction): string {
    switch (action.tool) {
      case "custom":
        return `custom:${action.toolId}`;
      case "mcp":
        return `mcp:${action.serverId}:${action.toolName}`;
      default:
        return action.tool;
    }
  }

  private describeAction(action: ToolAction): string {
    switch (action.tool) {
      case "write_file":
        return `write ${action.path}`;
      case "run_command":
        return `run "${action.command}"`;
      case "git":
        return `git ${action.operation}`;
      case "terminal_session":
        return `terminal "${action.command}"`;
      default:
        return action.tool;
    }
  }
}
