/**
 * Configuration for connecting to an MCP server.
 */
export type McpServerConfig = {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "streamable-http";
  /** For stdio transport: the command to spawn */
  command?: string;
  /** For stdio transport: command arguments */
  args?: string[];
  /** For stdio transport: environment variables */
  env?: Record<string, string>;
  /** For HTTP transports (SSE or streamable-http): the server URL */
  url?: string;
  /** For HTTP transports: additional headers */
  headers?: Record<string, string>;
};

/**
 * Represents an active connection to an MCP server.
 */
export type McpConnection = {
  serverId: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  tools: McpToolDescription[];
  error?: string;
};

/**
 * A tool discovered from an MCP server.
 */
export type McpToolDescription = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
};

/**
 * Result returned from calling an MCP tool.
 */
export type McpToolResult = {
  content: McpContentItem[];
  isError?: boolean;
};

/**
 * A single content item in an MCP tool result.
 */
export type McpContentItem = {
  type: "text" | "image" | "audio" | "resource" | "resource_link";
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
};
