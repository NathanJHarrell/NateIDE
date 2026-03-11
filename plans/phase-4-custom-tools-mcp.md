# Phase 4: Custom Tools & MCP

## Goal

Allow users to create custom tools (command, HTTP, MCP) and add them to agent
harnesses. Integrate MCP (Model Context Protocol) as the extension backbone so
users can connect external tool servers and grant their tools to agents.

## Depends On

- Phase 2 (Harness System) — tools are granted to harnesses via ToolRegistry

## Current State

- Three hardcoded tool types: `read_file`, `write_file`, `run_command`
- Tool use is parsed from text-based `[ACTION:...]` blocks in agent responses
- No user-created tools
- No MCP integration
- No HTTP tool calls
- Tool "permissions" are system prompt instructions, not enforced

## Target State

- Users create custom tools via a form: command tools, HTTP tools, or MCP tools
- MCP client in the daemon connects to external MCP servers and discovers tools
- All tools (built-in, custom, MCP) appear in the harness builder as grantable
- ToolExecutor dispatches to the correct handler based on tool type
- Custom tools and MCP server configs are shareable artifacts with visibility
- Read-only tools execute freely; mutating tools go through approval in safe mode

## Types

### Custom Tool

```ts
type CustomTool = {
  id: string
  name: string
  description: string             // shown to the agent
  createdBy: string               // userId
  workspaceId: string
  visibility: Visibility
  scope: "workspace" | "global"

  source:
    | { type: "command"; command: string; cwd?: string }
    | {
        type: "http"
        url: string
        method: "GET" | "POST" | "PUT" | "DELETE"
        headers?: Record<string, string>
        bodyTemplate?: string
      }
    | { type: "mcp"; serverId: string; toolName: string }

  parameters: ToolParameter[]
  readOnly: boolean               // if true, skips approval in safe mode
  timeout: number                 // seconds, default 30
}

type ToolParameter = {
  name: string
  description: string
  type: "string" | "number" | "boolean" | "filepath"
  required: boolean
  default?: string
}
```

### MCP Server Config

```ts
type McpServerConfig = {
  id: string
  name: string
  createdBy: string
  workspaceId: string
  visibility: Visibility

  transport:
    | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
    | { type: "sse"; url: string; headers?: Record<string, string> }
    | { type: "streamable-http"; url: string; headers?: Record<string, string> }

  // Discovered tools (populated after connecting)
  discoveredTools: McpDiscoveredTool[]

  status: "disconnected" | "connecting" | "connected" | "error"
  lastError?: string
}

type McpDiscoveredTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>   // JSON Schema from MCP
}
```

## New Package: `packages/mcp-client/`

```
packages/mcp-client/
  src/
    index.ts              — public API
    client.ts             — MCP client implementation
    transport-stdio.ts    — stdio transport (local command)
    transport-http.ts     — SSE and streamable-http transports
    types.ts              — MCP protocol types
```

## Steps

### 4.1 Build the MCP Client

The MCP client runs in the local daemon (not Convex) because MCP servers are
often local processes or need filesystem access.

```ts
class McpClient {
  constructor(config: McpServerConfig)

  // Connect and discover tools
  async connect(): Promise<McpDiscoveredTool[]>

  // Call a tool
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult>

  // Disconnect
  async disconnect(): void

  // Status
  getStatus(): McpServerConfig["status"]
}
```

Transports:
- **stdio**: spawn a child process, communicate via stdin/stdout JSON-RPC
- **SSE**: connect to an SSE endpoint for server→client, POST for client→server
- **streamable-http**: newer MCP transport, single HTTP endpoint with streaming

Use the official `@modelcontextprotocol/sdk` package if available, or implement
the protocol directly. The MCP protocol is JSON-RPC 2.0 over the chosen
transport.

### 4.2 Add MCP Management to the Daemon

New daemon endpoints:

- `POST /mcp/servers` — register a new MCP server config
- `GET /mcp/servers` — list registered servers and their status
- `POST /mcp/servers/:id/connect` — connect and discover tools
- `POST /mcp/servers/:id/disconnect` — disconnect
- `DELETE /mcp/servers/:id` — remove server config
- `POST /mcp/servers/:id/tools/:name/call` — call a specific tool

The daemon maintains active MCP connections in memory. Configs are persisted
in Convex. On startup, the daemon reconnects to servers that were previously
connected.

### 4.3 Extend ToolExecutor

Add handlers for custom and MCP tools:

```ts
class ToolExecutor {
  // Existing handlers for built-in tools...

  // New: custom command tool
  private async executeCommandTool(tool: CustomTool, args: Record<string, string>): Promise<ToolResult>

  // New: custom HTTP tool
  private async executeHttpTool(tool: CustomTool, args: Record<string, string>): Promise<ToolResult>

  // New: MCP tool
  private async executeMcpTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult>
}
```

Command tools:
- Template substitution: `eslint {{file}}` with `{ file: "src/index.ts" }`
  becomes `eslint src/index.ts`
- Run in the workspace root (or custom cwd)
- Capture stdout/stderr and exit code
- Respect timeout

HTTP tools:
- Template substitution in URL, headers, and body
- Execute the HTTP request
- Return status code and response body
- Respect timeout
- Credentials in headers (user's responsibility to configure)

MCP tools:
- Route to the daemon's MCP client for the specified server
- Pass arguments through
- Return the MCP tool result

### 4.4 Update ToolRegistry for Custom Tools

The ToolRegistry needs to know about custom tools and MCP tools when checking
grants:

```ts
// A grant for a custom tool
{ tool: "custom"; toolId: "lint-staged" }

// A grant for an MCP tool
{ tool: "mcp"; serverId: "filesystem-server"; toolName: "read_directory" }
```

When generating the tool description for the system prompt, custom and MCP
tools include their `description` and `parameters` so the agent knows how
to use them.

### 4.5 Add Custom Tool and MCP Tables to Convex

```ts
// convex/schema.ts additions

tools: defineTable({
  name: v.string(),
  description: v.string(),
  createdBy: v.id("users"),
  workspaceId: v.id("workspaces"),
  visibility: v.union(v.literal("private"), v.literal("workspace"), v.literal("public")),
  scope: v.union(v.literal("workspace"), v.literal("global")),
  source: v.union(
    v.object({ type: v.literal("command"), command: v.string(), cwd: v.optional(v.string()) }),
    v.object({
      type: v.literal("http"),
      url: v.string(),
      method: v.string(),
      headers: v.optional(v.any()),
      bodyTemplate: v.optional(v.string()),
    }),
    v.object({ type: v.literal("mcp"), serverId: v.string(), toolName: v.string() }),
  ),
  parameters: v.array(v.object({
    name: v.string(),
    description: v.string(),
    type: v.string(),
    required: v.boolean(),
    default: v.optional(v.string()),
  })),
  readOnly: v.boolean(),
  timeout: v.number(),
}),

mcpServers: defineTable({
  name: v.string(),
  createdBy: v.id("users"),
  workspaceId: v.id("workspaces"),
  visibility: v.union(v.literal("private"), v.literal("workspace"), v.literal("public")),
  transport: v.union(
    v.object({ type: v.literal("stdio"), command: v.string(), args: v.optional(v.array(v.string())) }),
    v.object({ type: v.literal("sse"), url: v.string() }),
    v.object({ type: v.literal("streamable-http"), url: v.string() }),
  ),
  discoveredTools: v.array(v.object({
    name: v.string(),
    description: v.string(),
    inputSchema: v.any(),
  })),
}),
```

### 4.6 Build the Tool Creator UI

A form in settings for creating custom tools:

```
┌─ New Tool ─────────────────────────────────┐
│                                            │
│  Name: [lint-staged              ]         │
│  Description: [Run lint on staged files ]  │
│                                            │
│  Type: ◉ Command  ○ HTTP  ○ MCP           │
│                                            │
│  Command: [bunx lint-staged        ]       │
│  Working dir: [                    ] (opt) │
│                                            │
│  Parameters:                               │
│  + Add parameter                           │
│                                            │
│  ☐ Read-only (skip approval in safe mode)  │
│  Timeout: [30] seconds                     │
│                                            │
│  Visibility: ○ Private ○ Workspace ◉ Public│
│                                            │
│  [Cancel]                       [Create]   │
└────────────────────────────────────────────┘
```

For HTTP tools, the form shows URL, method, headers, and body template fields.
For MCP tools, the form shows a dropdown of connected MCP servers and their
discovered tools.

### 4.7 Build the MCP Server Manager UI

In settings:

```
┌─ MCP Servers ──────────────────────────────┐
│                                            │
│  @modelcontextprotocol/filesystem  🟢      │
│  stdio · 5 tools discovered                │
│  [Disconnect]  [Refresh tools]             │
│                                            │
│  my-company/internal-tools         🔴      │
│  sse · Not connected                       │
│  [Connect]  [Remove]                       │
│                                            │
│  [+ Add MCP Server]                        │
│                                            │
└────────────────────────────────────────────┘
```

"Add MCP Server" form:

```
┌─ Add MCP Server ───────────────────────────┐
│                                            │
│  Name: [filesystem              ]          │
│                                            │
│  Transport: ◉ stdio  ○ SSE  ○ HTTP        │
│                                            │
│  Command: [npx @modelcontextprotocol/server│
│            -filesystem /path/to/dir    ]   │
│                                            │
│  Visibility: ○ Private ○ Workspace ◉ Public│
│                                            │
│  [Cancel]                       [Connect]  │
└────────────────────────────────────────────┘
```

### 4.8 Update Harness Builder Tool Checklist

The tool grant checklist in the harness builder now shows all available tools
grouped by source:

```
┌─ Tools ──────────────────────────────────┐
│                                          │
│  Built-in                                │
│  ☑ read_file                             │
│  ☑ write_file                            │
│  ☑ run_command         [Allowlist: ...]  │
│  ☐ terminal_session                      │
│  ☐ git                 [Operations: ...] │
│  ☐ web_search                            │
│  ☐ code_search                           │
│                                          │
│  Workspace Tools                         │
│  ☑ lint-staged                           │
│  ☐ deploy                                │
│                                          │
│  MCP: filesystem                         │
│  ☑ read_directory                        │
│  ☐ move_file                             │
│  ☐ search_files                          │
│                                          │
└──────────────────────────────────────────┘
```

## New Events

```ts
"tool.custom.created"    — user created a custom tool
"tool.custom.updated"    — user updated a custom tool
"tool.custom.deleted"    — user deleted a custom tool
"mcp.server.connected"   — MCP server connected, tools discovered
"mcp.server.disconnected" — MCP server disconnected
"mcp.server.error"       — MCP server connection error
```

## Testing Strategy

- Unit tests for MCP client: mock stdio/HTTP transport, verify tool discovery
  and invocation
- Unit tests for ToolExecutor: custom command, HTTP, and MCP handlers
- Integration test: create custom command tool → grant to harness → agent uses
  it → verify execution
- Integration test: connect MCP server → discover tools → grant to harness →
  agent uses tool → verify MCP call
- Approval test: custom tool marked as mutating → approval required in safe
  mode → user approves → tool executes
- HTTP tool test: mock HTTP endpoint → tool calls it → verify request format
  and response handling

## Definition of Done

- [ ] `packages/mcp-client/` package created with stdio and HTTP transports
- [ ] MCP client can connect, discover tools, and call tools
- [ ] Daemon has MCP management endpoints
- [ ] `CustomTool` type defined in protocol
- [ ] `McpServerConfig` type defined in protocol
- [ ] ToolExecutor handles command, HTTP, and MCP tools
- [ ] ToolRegistry validates custom and MCP tool grants
- [ ] Convex tables for tools and MCP servers
- [ ] Tool creator UI functional
- [ ] MCP server manager UI functional
- [ ] Harness builder shows all tool sources in the checklist
- [ ] Custom tools and MCP configs are shareable artifacts with visibility
