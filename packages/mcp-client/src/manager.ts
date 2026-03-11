import { McpClient } from "./client.js";
import type {
  McpServerConfig,
  McpConnection,
  McpToolDescription,
  McpToolResult,
} from "./types.js";

/**
 * McpManager manages multiple MCP server connections.
 * It handles connecting, disconnecting, auto-reconnecting,
 * health checking, and aggregating tools from all servers.
 */
export class McpManager {
  private clients: Map<string, McpClient> = new Map();
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /** How often to run health checks (ms) */
  private healthCheckIntervalMs = 30_000;
  /** Delay before attempting reconnect (ms) */
  private reconnectDelayMs = 5_000;
  /** Max reconnect attempts before giving up */
  private maxReconnectAttempts = 5;
  /** Track reconnect attempts per server */
  private reconnectAttempts: Map<string, number> = new Map();

  /** Optional callback when a connection status changes */
  onConnectionChange?: (connection: McpConnection) => void;

  constructor(
    options?: {
      healthCheckIntervalMs?: number;
      reconnectDelayMs?: number;
      maxReconnectAttempts?: number;
    },
  ) {
    if (options?.healthCheckIntervalMs) {
      this.healthCheckIntervalMs = options.healthCheckIntervalMs;
    }
    if (options?.reconnectDelayMs) {
      this.reconnectDelayMs = options.reconnectDelayMs;
    }
    if (options?.maxReconnectAttempts) {
      this.maxReconnectAttempts = options.maxReconnectAttempts;
    }
  }

  /**
   * Connect to an MCP server. Creates a client and establishes the connection.
   * Returns discovered tools on success.
   */
  async connect(config: McpServerConfig): Promise<McpToolDescription[]> {
    // Disconnect existing connection if any
    if (this.clients.has(config.id)) {
      await this.disconnect(config.id);
    }

    const client = new McpClient(config);
    this.clients.set(config.id, client);
    this.reconnectAttempts.set(config.id, 0);

    try {
      const tools = await client.connect();
      this.notifyChange(client);
      return tools;
    } catch (error) {
      this.notifyChange(client);
      throw error;
    }
  }

  /**
   * Disconnect from a specific MCP server.
   */
  async disconnect(serverId: string): Promise<void> {
    this.clearReconnectTimer(serverId);
    this.reconnectAttempts.delete(serverId);

    const client = this.clients.get(serverId);
    if (!client) {
      return;
    }

    await client.disconnect();
    this.clients.delete(serverId);
    this.notifyChange({
      getConnection: () => ({
        serverId,
        status: "disconnected" as const,
        tools: [],
      }),
    } as unknown as McpClient);
  }

  /**
   * Disconnect from all servers and clean up.
   */
  async disconnectAll(): Promise<void> {
    this.stopHealthChecks();

    const disconnects = [...this.clients.keys()].map((id) =>
      this.disconnect(id),
    );
    await Promise.allSettled(disconnects);
  }

  /**
   * Get the list of available tools from a specific server.
   */
  async listTools(serverId: string): Promise<McpToolDescription[]> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`No connection to server "${serverId}"`);
    }
    return client.listTools();
  }

  /**
   * Call a tool on a specific server.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`No connection to server "${serverId}"`);
    }
    return client.callTool(toolName, args, signal);
  }

  /**
   * Get all active connections and their statuses.
   */
  getConnections(): McpConnection[] {
    return [...this.clients.values()].map((client) => client.getConnection());
  }

  /**
   * Get a specific connection's info.
   */
  getConnection(serverId: string): McpConnection | undefined {
    return this.clients.get(serverId)?.getConnection();
  }

  /**
   * Aggregate all tools from all connected servers.
   */
  getAllTools(): McpToolDescription[] {
    const tools: McpToolDescription[] = [];
    for (const client of this.clients.values()) {
      const conn = client.getConnection();
      if (conn.status === "connected") {
        tools.push(...conn.tools);
      }
    }
    return tools;
  }

  /**
   * Start periodic health checks on all connections.
   * Disconnected clients with auto-reconnect enabled will be reconnected.
   */
  startHealthChecks(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, this.healthCheckIntervalMs);
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Clear all reconnect timers
    for (const [serverId] of this.reconnectTimers) {
      this.clearReconnectTimer(serverId);
    }
  }

  /**
   * Refresh tools for a specific server.
   */
  async refreshTools(serverId: string): Promise<McpToolDescription[]> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`No connection to server "${serverId}"`);
    }
    const tools = await client.refreshTools();
    this.notifyChange(client);
    return tools;
  }

  // ── Private helpers ──────────────────────────────────────────

  private async runHealthChecks(): Promise<void> {
    for (const [serverId, client] of this.clients) {
      const conn = client.getConnection();

      if (
        conn.status === "disconnected" ||
        conn.status === "error"
      ) {
        const attempts = this.reconnectAttempts.get(serverId) ?? 0;
        if (attempts < this.maxReconnectAttempts) {
          this.scheduleReconnect(serverId, client);
        }
      }
    }
  }

  private scheduleReconnect(serverId: string, client: McpClient): void {
    if (this.reconnectTimers.has(serverId)) {
      return; // Already scheduled
    }

    const attempts = this.reconnectAttempts.get(serverId) ?? 0;
    const delay = this.reconnectDelayMs * Math.pow(1.5, attempts);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(serverId);
      this.reconnectAttempts.set(serverId, attempts + 1);

      try {
        const config = client.getConfig();
        const newClient = new McpClient(config);
        await newClient.connect();
        this.clients.set(serverId, newClient);
        this.reconnectAttempts.set(serverId, 0);
        this.notifyChange(newClient);
      } catch {
        // Reconnect failed, will be retried on next health check
        this.notifyChange(client);
      }
    }, delay);

    this.reconnectTimers.set(serverId, timer);
  }

  private clearReconnectTimer(serverId: string): void {
    const timer = this.reconnectTimers.get(serverId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(serverId);
    }
  }

  private notifyChange(client: McpClient): void {
    if (this.onConnectionChange) {
      this.onConnectionChange(client.getConnection());
    }
  }
}
