import { BUILT_IN_TOOLS, MUTATING_TOOLS, READ_ONLY_GIT_OPS, READ_ONLY_TOOLS } from "./built-in-tools";
import type { ApprovalPolicy, ToolAction, ToolDescription, ToolGrant, ToolName } from "./types";

type GrantCheckResult = {
  allowed: boolean;
  reason?: string;
};

/**
 * ToolRegistry takes an array of ToolGrants and enforces them at runtime.
 * It answers two questions:
 *   1. Is this agent allowed to use this tool? (canExecute)
 *   2. Does this tool call need user approval? (needsApproval)
 */
export class ToolRegistry {
  private readonly grantsByTool: Map<ToolName, ToolGrant>;
  private readonly approvalPolicy: ApprovalPolicy;

  constructor(grants: ToolGrant[], approvalPolicy: ApprovalPolicy) {
    this.grantsByTool = new Map();
    this.approvalPolicy = approvalPolicy;
    for (const grant of grants) {
      this.grantsByTool.set(grant.tool, grant);
    }
  }

  /**
   * Check if an action is allowed based on the agent's tool grants.
   * Returns { allowed: true } or { allowed: false, reason: "..." }.
   */
  canExecute(action: ToolAction): GrantCheckResult {
    const toolName = action.tool as ToolName;
    const grant = this.grantsByTool.get(toolName);

    if (!grant) {
      return {
        allowed: false,
        reason: `Tool not available: "${toolName}" is not granted to this agent.`,
      };
    }

    // Check tool-specific restrictions
    switch (action.tool) {
      case "run_command": {
        const commandGrant = grant as Extract<ToolGrant, { tool: "run_command" }>;
        if (commandGrant.allowlist && commandGrant.allowlist.length > 0) {
          const isAllowed = this.matchesCommandAllowlist(action.command, commandGrant.allowlist);
          if (!isAllowed) {
            return {
              allowed: false,
              reason:
                `Command "${action.command}" is not in the allowlist. ` +
                `Allowed patterns: ${commandGrant.allowlist.join(", ")}`,
            };
          }
        }
        break;
      }

      case "git": {
        const gitGrant = grant as Extract<ToolGrant, { tool: "git" }>;
        if (gitGrant.operations && gitGrant.operations.length > 0) {
          if (!gitGrant.operations.includes(action.operation)) {
            return {
              allowed: false,
              reason:
                `Git operation "${action.operation}" is not allowed. ` +
                `Allowed operations: ${gitGrant.operations.join(", ")}`,
            };
          }
        }
        break;
      }

      case "mcp": {
        const mcpGrant = grant as Extract<ToolGrant, { tool: "mcp" }>;
        if (mcpGrant.serverId !== action.serverId || mcpGrant.toolName !== action.toolName) {
          // Check if there's a matching MCP grant (there might be multiple)
          const allMcpGrants = [...this.grantsByTool.values()].filter(
            (g): g is Extract<ToolGrant, { tool: "mcp" }> => g.tool === "mcp",
          );
          const match = allMcpGrants.find(
            (g) => g.serverId === action.serverId && g.toolName === action.toolName,
          );
          if (!match) {
            return {
              allowed: false,
              reason: `MCP tool "${action.serverId}/${action.toolName}" is not granted to this agent.`,
            };
          }
        }
        break;
      }

      case "custom": {
        const customGrant = grant as Extract<ToolGrant, { tool: "custom" }>;
        if (customGrant.toolId !== action.toolId) {
          // Check if there's a matching custom grant
          const allCustomGrants = [...this.grantsByTool.values()].filter(
            (g): g is Extract<ToolGrant, { tool: "custom" }> => g.tool === "custom",
          );
          const match = allCustomGrants.find((g) => g.toolId === action.toolId);
          if (!match) {
            return {
              allowed: false,
              reason: `Custom tool "${action.toolId}" is not granted to this agent.`,
            };
          }
        }
        break;
      }
    }

    return { allowed: true };
  }

  /**
   * Determine if a tool call needs user approval before execution.
   *
   * In YOLO mode, nothing needs approval.
   * In safe mode:
   *   - Read-only tools never need approval
   *   - Mutating tools need approval unless the per-tool grant explicitly
   *     sets requireApproval: false
   *   - Read-only git operations don't need approval
   */
  needsApproval(action: ToolAction): boolean {
    if (this.approvalPolicy === "yolo") {
      return false;
    }

    const toolName = action.tool as ToolName;

    // Read-only tools never need approval
    if (READ_ONLY_TOOLS.has(toolName)) {
      return false;
    }

    // Git: check if the specific operation is read-only
    if (action.tool === "git" && READ_ONLY_GIT_OPS.has(action.operation)) {
      return false;
    }

    // Check per-tool requireApproval override
    const grant = this.grantsByTool.get(toolName);
    if (grant) {
      if ("requireApproval" in grant && grant.requireApproval === false) {
        return false;
      }
    }

    // Default: mutating tools need approval in safe mode
    return MUTATING_TOOLS.has(toolName);
  }

  /**
   * Get descriptions of all granted tools for system prompt generation.
   */
  describeGrantedTools(): ToolDescription[] {
    const descriptions: ToolDescription[] = [];
    for (const [toolName] of this.grantsByTool) {
      const desc = BUILT_IN_TOOLS[toolName];
      if (desc) {
        descriptions.push(desc);
      }
    }
    return descriptions;
  }

  /**
   * Get the set of granted tool names.
   */
  getGrantedToolNames(): Set<ToolName> {
    return new Set(this.grantsByTool.keys());
  }

  /**
   * Check if a specific tool is granted.
   */
  hasGrant(toolName: ToolName): boolean {
    return this.grantsByTool.has(toolName);
  }

  /**
   * Build a system prompt section describing the available tools.
   */
  buildToolPrompt(): string {
    const tools = this.describeGrantedTools();
    if (tools.length === 0) {
      return "";
    }

    const sections = [
      "",
      "--- AVAILABLE TOOLS ---",
      "You can use the following tools by including tool call blocks in your response.",
      "Format each tool call as:",
      "",
      "[TOOL_CALL]",
      "tool: <tool_name>",
      "<param_name>: <param_value>",
      "[/TOOL_CALL]",
      "",
      "Available tools:",
      "",
    ];

    for (const tool of tools) {
      sections.push(`### ${tool.name}`);
      sections.push(tool.description);
      sections.push("Parameters:");
      for (const [paramName, param] of Object.entries(tool.parameters)) {
        const req = param.required ? " (required)" : " (optional)";
        sections.push(`  - ${paramName}: ${param.type}${req} — ${param.description}`);
      }
      sections.push("");
    }

    sections.push(
      "IMPORTANT:",
      "- Use tools to actually DO work, not just discuss it.",
      "- After tool calls are executed, you'll receive the results and can continue with more tool calls or provide your final response.",
      "- When your response has no tool calls, it is treated as your final message for this turn.",
      "- You may include multiple tool calls in a single response.",
      "--- END AVAILABLE TOOLS ---",
      "",
    );

    return sections.join("\n");
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Check if a command matches any pattern in the allowlist.
   * Patterns use glob-like matching:
   *   "npm *"  matches "npm install express" but not "rm -rf /"
   *   "git *"  matches "git status"
   *   "*"      matches everything
   */
  private matchesCommandAllowlist(command: string, allowlist: string[]): boolean {
    const cmd = command.trim();
    for (const pattern of allowlist) {
      if (this.globMatch(cmd, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob matching: only supports * as a wildcard for "any characters".
   */
  private globMatch(input: string, pattern: string): boolean {
    // Escape regex special chars except *
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(input);
  }
}
