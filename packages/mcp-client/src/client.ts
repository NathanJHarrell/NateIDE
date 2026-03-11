import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type {
  McpServerConfig,
  McpConnection,
  McpToolDescription,
  McpToolResult,
  McpContentItem,
} from "./types.js";

/**
 * McpClient wraps the official @modelcontextprotocol/sdk Client to provide
 * a simpler interface for connecting to MCP servers, discovering tools,
 * and calling them.
 *
 * Each McpClient instance manages a single server connection.
 */
export class McpClient {
  private client: Client;
  private transport: Transport | null = null;
  private config: McpServerConfig;
  private _status: McpConnection["status"] = "disconnected";
  private _tools: McpToolDescription[] = [];
  private _error: string | undefined;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.client = new Client(
      { name: "nateide", version: "0.1.0" },
      { capabilities: {} },
    );
  }

  /**
   * Connect to the MCP server and discover available tools.
   */
  async connect(): Promise<McpToolDescription[]> {
    if (this._status === "connected") {
      return this._tools;
    }

    this._status = "connecting";
    this._error = undefined;

    try {
      this.transport = this.createTransport();

      this.transport.onclose = () => {
        this._status = "disconnected";
      };

      this.transport.onerror = (error: Error) => {
        this._error = error.message;
        this._status = "error";
      };

      await this.client.connect(this.transport);
      this._status = "connected";

      // Discover tools
      this._tools = await this.discoverTools();
      return this._tools;
    } catch (error) {
      this._status = "error";
      this._error =
        error instanceof Error ? error.message : "Unknown connection error";
      throw error;
    }
  }

  /**
   * Disconnect from the MCP server.
   */
  async disconnect(): Promise<void> {
    if (this._status === "disconnected") {
      return;
    }

    try {
      await this.client.close();
    } catch {
      // Best-effort close
    } finally {
      this.transport = null;
      this._status = "disconnected";
      this._tools = [];
      this._error = undefined;
    }
  }

  /**
   * List all tools available on the connected server.
   * Uses the cached list if available, otherwise re-discovers.
   */
  async listTools(): Promise<McpToolDescription[]> {
    if (this._status !== "connected") {
      throw new Error(
        `Cannot list tools: server "${this.config.id}" is not connected (status: ${this._status})`,
      );
    }
    return this._tools;
  }

  /**
   * Re-discover tools from the server (refreshes the cached list).
   */
  async refreshTools(): Promise<McpToolDescription[]> {
    if (this._status !== "connected") {
      throw new Error(
        `Cannot refresh tools: server "${this.config.id}" is not connected`,
      );
    }
    this._tools = await this.discoverTools();
    return this._tools;
  }

  /**
   * Call a tool on the connected MCP server.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    if (this._status !== "connected") {
      throw new Error(
        `Cannot call tool: server "${this.config.id}" is not connected`,
      );
    }

    const result = await this.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      signal ? { signal } : undefined,
    );

    // Normalize the SDK result to our McpToolResult shape
    if ("content" in result && Array.isArray(result.content)) {
      return {
        content: result.content.map((item) => this.normalizeContentItem(item)),
        isError: (result.isError as boolean | undefined) ?? false,
      };
    }

    // Fallback for the alternative toolResult shape
    if ("toolResult" in result) {
      return {
        content: [
          {
            type: "text",
            text: String(result.toolResult),
          },
        ],
        isError: false,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: false,
    };
  }

  /**
   * Get the current connection status.
   */
  getStatus(): McpConnection["status"] {
    return this._status;
  }

  /**
   * Get the full connection info.
   */
  getConnection(): McpConnection {
    return {
      serverId: this.config.id,
      status: this._status,
      tools: this._tools,
      error: this._error,
    };
  }

  /**
   * Get the server config.
   */
  getConfig(): McpServerConfig {
    return this.config;
  }

  // ── Private helpers ──────────────────────────────────────────

  private createTransport(): Transport {
    switch (this.config.transport) {
      case "stdio": {
        if (!this.config.command) {
          throw new Error(
            `stdio transport requires a "command" in config for server "${this.config.id}"`,
          );
        }
        return new StdioClientTransport({
          command: this.config.command,
          args: this.config.args,
          env: this.config.env,
          stderr: "pipe",
        });
      }

      case "sse": {
        if (!this.config.url) {
          throw new Error(
            `SSE transport requires a "url" in config for server "${this.config.id}"`,
          );
        }
        const sseUrl = new URL(this.config.url);
        return new SSEClientTransport(sseUrl, {
          requestInit: this.config.headers
            ? { headers: this.config.headers }
            : undefined,
        });
      }

      case "streamable-http": {
        if (!this.config.url) {
          throw new Error(
            `streamable-http transport requires a "url" in config for server "${this.config.id}"`,
          );
        }
        const httpUrl = new URL(this.config.url);
        return new StreamableHTTPClientTransport(httpUrl, {
          requestInit: this.config.headers
            ? { headers: this.config.headers }
            : undefined,
        });
      }

      default:
        throw new Error(
          `Unsupported transport type: ${this.config.transport}`,
        );
    }
  }

  private async discoverTools(): Promise<McpToolDescription[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
      serverId: this.config.id,
    }));
  }

  private normalizeContentItem(item: Record<string, unknown>): McpContentItem {
    const type = (item.type as string) ?? "text";

    if (type === "text") {
      return { type: "text", text: item.text as string };
    }

    if (type === "image") {
      return {
        type: "image",
        data: item.data as string,
        mimeType: item.mimeType as string,
      };
    }

    if (type === "audio") {
      return {
        type: "audio",
        data: item.data as string,
        mimeType: item.mimeType as string,
      };
    }

    // For resource, resource_link, or anything else, pass through
    return { type, ...item } as McpContentItem;
  }
}
