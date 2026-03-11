import type { ToolDescription, ToolName } from "./types";

/**
 * Built-in tool definitions. These describe the tools that the harness
 * runtime knows how to execute natively (via the daemon client).
 *
 * Custom tools and MCP tools are registered dynamically in Phase 4.
 */

export const BUILT_IN_TOOLS: Record<string, ToolDescription> = {
  read_file: {
    name: "read_file",
    description: "Read the contents of a file at the given path. Returns the file content as text.",
    parameters: {
      path: {
        type: "string",
        description: "Absolute or workspace-relative file path",
        required: true,
      },
    },
  },

  write_file: {
    name: "write_file",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. " +
      "This is a mutating operation and may require user approval in safe mode.",
    parameters: {
      path: {
        type: "string",
        description: "Absolute or workspace-relative file path",
        required: true,
      },
      content: {
        type: "string",
        description: "The full content to write to the file",
        required: true,
      },
    },
  },

  run_command: {
    name: "run_command",
    description:
      "Run a shell command in the workspace. Returns stdout, stderr, and exit code. " +
      "This is a mutating operation and may require user approval in safe mode.",
    parameters: {
      command: {
        type: "string",
        description: "The shell command to execute",
        required: true,
      },
      cwd: {
        type: "string",
        description: "Working directory (defaults to workspace root)",
      },
    },
  },

  code_search: {
    name: "code_search",
    description:
      "Search for text or patterns in the workspace codebase. " +
      "Supports regex patterns. Returns matching file paths and line contents.",
    parameters: {
      query: {
        type: "string",
        description: "Search query or regex pattern",
        required: true,
      },
      path: {
        type: "string",
        description: "Subdirectory to search in (defaults to workspace root)",
      },
    },
  },

  web_search: {
    name: "web_search",
    description: "Search the web for information. Returns a summary of results.",
    parameters: {
      query: {
        type: "string",
        description: "Search query",
        required: true,
      },
    },
  },

  read_url: {
    name: "read_url",
    description: "Fetch and read the content of a URL. Returns the page content as text.",
    parameters: {
      url: {
        type: "string",
        description: "The URL to fetch",
        required: true,
      },
    },
  },

  git: {
    name: "git",
    description:
      "Execute git operations in the workspace repository. " +
      "This may be a mutating operation depending on the specific git command.",
    parameters: {
      operation: {
        type: "string",
        description: "Git operation (status, log, diff, add, commit, push, pull, branch, checkout, etc.)",
        required: true,
      },
      args: {
        type: "string[]",
        description: "Additional arguments for the git command",
      },
    },
  },

  terminal_session: {
    name: "terminal_session",
    description:
      "Run a command in a persistent terminal session. Useful for long-running processes, " +
      "interactive tools, or commands that need to maintain state between calls.",
    parameters: {
      command: {
        type: "string",
        description: "The command to run in the terminal session",
        required: true,
      },
    },
  },
};

/**
 * Tools that never require approval — they are read-only operations.
 */
export const READ_ONLY_TOOLS: Set<ToolName> = new Set([
  "read_file",
  "code_search",
  "web_search",
  "read_url",
]);

/**
 * Tools that are mutating and require approval in safe mode
 * (unless the per-tool grant overrides with requireApproval: false).
 */
export const MUTATING_TOOLS: Set<ToolName> = new Set([
  "write_file",
  "run_command",
  "git",
  "terminal_session",
  "custom",
  "mcp",
]);

/**
 * Git operations considered read-only (no approval needed even in safe mode).
 */
export const READ_ONLY_GIT_OPS: Set<string> = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "remote",
  "stash list",
  "tag",
  "blame",
  "shortlog",
]);
