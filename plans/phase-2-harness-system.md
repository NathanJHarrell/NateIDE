# Phase 2: Harness System

## Goal

Extract the agent execution logic from the monolithic session store into a
proper harness abstraction. A harness is the complete definition of an agent:
model, tools, soul, and execution policy. The runtime enforces tool grants
and manages the agent's execution loop.

## Why This Is Phase 2

The harness is the central abstraction everything else plugs into. Souls
(Phase 3) attach to harnesses. Custom tools (Phase 4) are granted to
harnesses. Pipelines (Phase 5) instantiate harnesses per node. Multi-user
(Phase 6) scopes permissions through harnesses. This must be solid before
the rest can build on it.

## Current State

- Agent execution is an inline closure in `session-store.ts:1503-1590`
- Tool permissions are booleans on `AgentDescriptor` (`canEditFiles`,
  `canRunCommands`) that only affect the system prompt — no enforcement
- Agent identity is split across `catalog.ts`, `ai-client.ts`, and
  `soul-documents.ts` with no unified type
- The conversation loop takes a `dispatchAgent` callback that is defined
  inline in the session store
- Action parsing uses text-based `[ACTION:...]` blocks — no structured
  tool calls

## Target State

- `AgentHarness` is a single type that defines an agent completely
- `packages/harness/` is a new package containing the harness runtime
- `ToolRegistry` enforces which tools an agent can use at execution time
- `ToolExecutor` dispatches tool calls to the right handler
- `ApprovalQueue` holds mutating operations for user confirmation
- The conversation loop and pipeline engine instantiate harnesses instead of
  using inline dispatch
- Built-in agents (Claude, Codex, Gemini, Kimi) are default harness configs

## New Package: `packages/harness/`

```
packages/harness/
  src/
    index.ts              — public API exports
    types.ts              — AgentHarness, AgentToolGrant, ApprovalPolicy
    harness.ts            — AgentHarnessRuntime class
    tool-registry.ts      — ToolRegistry class
    tool-executor.ts      — ToolExecutor class
    approval-queue.ts     — ApprovalQueue class
    loop.ts               — inner execution loop (LLM → parse → execute → repeat)
    context.ts            — system prompt assembly, context windowing
    defaults.ts           — built-in harness configs for Claude, Codex, Gemini, Kimi
```

## Steps

### 2.1 Define the Harness Type

Add to `packages/protocol/src/entities.ts`:

```ts
type Visibility = "private" | "workspace" | "public"

type ApprovalPolicy = "safe" | "yolo"

type AgentToolGrant =
  | { tool: "read_file" }
  | { tool: "write_file"; requireApproval?: boolean }
  | { tool: "run_command"; requireApproval?: boolean; allowlist?: string[] }
  | { tool: "web_search" }
  | { tool: "read_url" }
  | { tool: "code_search" }
  | { tool: "git"; operations: string[] }
  | { tool: "terminal_session" }
  | { tool: "custom"; toolId: string }
  | { tool: "mcp"; serverId: string; toolName: string }

type AgentHarness = {
  id: string
  name: string
  createdBy: string
  workspaceId: string
  visibility: Visibility

  // Model
  provider: string
  model: string
  fallbacks?: Array<{ provider: string; model: string }>

  // Tools
  tools: AgentToolGrant[]
  approvalPolicy: ApprovalPolicy

  // Soul (Phase 3 fills this in fully — start with a single systemPrompt)
  soul: {
    soul: string
    style: string
    skill: string
    memory: string
  }

  // Execution
  maxIterations: number
  maxTokensPerTurn: number
  contextStrategy: "full" | "windowed" | "summary"

  // Display
  color: string
  icon?: string
}
```

### 2.2 Build the Tool Registry

`ToolRegistry` takes an array of `AgentToolGrant` and enforces them:

```ts
class ToolRegistry {
  constructor(grants: AgentToolGrant[])

  // Check if an action is allowed
  canExecute(action: ToolAction): { allowed: boolean; reason?: string }

  // Check if an action needs user approval (safe mode)
  needsApproval(action: ToolAction): boolean

  // Get the list of tools for system prompt generation
  describeGrantedTools(): ToolDescription[]
}
```

Key behaviors:
- An agent that tries to use `run_command` without the grant gets a rejection
  message fed back into its context: "Tool not available: run_command is not
  granted to this agent."
- In safe mode, all mutating tools go through approval regardless of per-tool
  settings. In YOLO mode, nothing goes through approval.
- `read_file` and `code_search` never require approval.
- Command allowlists are checked with glob matching: `"npm *"` allows
  `npm install express` but not `rm -rf /`.

### 2.3 Build the Tool Executor

`ToolExecutor` dispatches tool calls to handlers:

```ts
class ToolExecutor {
  constructor(config: {
    workspaceRoot: string
    registry: ToolRegistry
    approvalQueue: ApprovalQueue
    daemonClient: DaemonClient    // talks to the local daemon for file/terminal ops
  })

  async execute(action: ToolAction, signal: AbortSignal): Promise<ToolResult>
}
```

Tool types and their handlers:
- `read_file` → daemon client reads from disk
- `write_file` → daemon client writes to disk (after approval if safe mode)
- `run_command` → daemon client runs in terminal (after approval if safe mode)
- `code_search` → daemon client greps workspace
- `git` → daemon client runs git operations
- `custom` → dispatches to custom tool handler (Phase 4)
- `mcp` → dispatches to MCP client (Phase 4)

### 2.4 Build the Approval Queue

`ApprovalQueue` holds pending actions and waits for user resolution:

```ts
class ApprovalQueue {
  // Submit an action for approval, returns a promise that resolves when
  // the user approves or denies
  async requestApproval(request: ApprovalRequest): Promise<ApprovalResult>

  // Called by the UI when the user responds
  resolve(requestId: string, decision: "approved" | "denied"): void
}
```

Approval requests are stored in a Convex `approvalQueue` table. The desktop
app subscribes to pending approvals and shows confirmation cards. When the
user clicks approve/deny, a Convex mutation resolves the request.

The harness runtime awaits the approval promise. If denied, it feeds a
rejection message back to the agent. If approved, execution continues.

Timeout: if no response in 5 minutes, auto-deny and feed timeout message.

### 2.5 Build the Inner Execution Loop

Extract the loop from `session-store.ts:1503-1590` into `loop.ts`:

```ts
async function runHarnessLoop(config: {
  harnessConfig: AgentHarness
  messages: AiMessage[]
  toolExecutor: ToolExecutor
  apiKeys: AiApiKeys
  onChunk: (text: string) => void
  onToolCall: (action: ToolAction) => void
  onToolResult: (result: ToolResult) => void
  signal: AbortSignal
}): Promise<HarnessRunResult>
```

The loop:
1. Build system prompt from harness config (soul + tool descriptions)
2. Call LLM with messages
3. Parse response for tool calls
4. For each tool call:
   a. Check `ToolRegistry.canExecute()` — reject if not granted
   b. Check `ToolRegistry.needsApproval()` — queue if needed
   c. Execute via `ToolExecutor`
   d. Collect result
5. If tool calls were made, feed results back as a user message and goto 2
6. If no tool calls, return the final response
7. Stop after `maxIterations`

### 2.6 Build the Harness Runtime

`AgentHarnessRuntime` ties everything together:

```ts
class AgentHarnessRuntime {
  constructor(config: AgentHarness, deps: HarnessDependencies)

  // Run the agent on a set of messages
  async run(messages: AiMessage[], signal: AbortSignal): Promise<HarnessRunResult>

  // Get the harness config
  getConfig(): AgentHarness
}
```

This is what the conversation loop and pipeline engine instantiate.

### 2.7 Create Default Harness Configs

Convert the four built-in agents from `catalog.ts` into harness configs in
`packages/harness/src/defaults.ts`:

| Agent | Model | Tools | Policy |
|-------|-------|-------|--------|
| Claude (controller) | claude-opus-4-6 | none | safe |
| Codex (executor) | gpt-5.4 | read_file, write_file, run_command, git, terminal_session | safe |
| Gemini (reviewer) | gemini-3.1-pro-preview | read_file, write_file, run_command, git | safe |
| Kimi (generalist) | moonshotai/kimi-k2.5 | read_file, write_file | safe |

Soul documents will be migrated in Phase 3. For now, the existing
`soul-documents.ts` content is placed in the `soul.soul` field as plain text.

### 2.8 Refactor Conversation Loop

Update `conversation-loop.ts`:

- The `dispatchAgent` callback is replaced. Instead, `runConversationLoop`
  receives a function that creates an `AgentHarnessRuntime` for each agent.
- Each agent in a round gets its own harness instance.
- The harness handles tool calls internally — the conversation loop no longer
  knows about action blocks.

### 2.9 Add Harness Schema to Convex

Add a `harnesses` table to the Convex schema:

- id, name, createdBy, workspaceId, visibility
- provider, model, fallbacks
- tools (array of grants)
- approvalPolicy
- soul (object with soul/style/skill/memory strings)
- maxIterations, contextStrategy
- color, icon

Add CRUD mutations and queries for harnesses.

### 2.10 Build the Harness Editor UI

Add to the desktop app settings/configuration area:

- List of harnesses in the workspace (built-in + custom)
- Create new harness form:
  - Name and color picker
  - Model selector (provider + model dropdowns)
  - Tool grant checklist with per-tool options
  - System prompt / soul text area (full soul editor comes in Phase 3)
  - Approval policy toggle (Safe / YOLO)
  - Max iterations slider
- Edit existing harness
- Clone harness (copy and customize)
- Delete custom harness (built-ins can't be deleted, only reset)

## New Events

Add to `packages/protocol/src/events.ts`:

```ts
// Tool execution events
"tool.invoked"      — agent requested a tool call
"tool.approved"     — user approved a tool call
"tool.denied"       — user denied a tool call
"tool.completed"    — tool execution finished
"tool.failed"       — tool execution errored

// Approval events
"approval.requested" — action queued for user approval
"approval.resolved"  — user approved or denied
"approval.timeout"   — approval timed out (auto-denied)
```

## Testing Strategy

- Unit tests for ToolRegistry: grant checking, allowlist matching, approval
  determination
- Unit tests for the inner loop: mock LLM, mock ToolExecutor, verify
  parse → execute → feed back cycle
- Integration test: create harness → run agent → agent uses tools → verify
  tool calls are enforced
- Approval flow test: agent requests write → approval card appears → user
  approves → write executes
- Rejection test: agent tries to use ungranted tool → rejection message fed
  back → agent adapts

## Migration Notes

- `AgentDescriptor` in `catalog.ts` is deprecated in favor of `AgentHarness`
- `AgentRoleConfig` in `ai-client.ts` is deprecated — model routing is in
  the harness config
- `canEditFiles` / `canRunCommands` booleans are replaced by tool grants
- The inline dispatch closure in session-store is removed
- `buildToolUsePrompt()` in conversation-loop is replaced by
  `ToolRegistry.describeGrantedTools()` which generates the prompt section

## Definition of Done

- [ ] `packages/harness/` package created with all modules
- [ ] `AgentHarness` type defined in protocol
- [ ] ToolRegistry enforces grants at execution time
- [ ] ToolExecutor dispatches to correct handlers
- [ ] ApprovalQueue works end-to-end (request → UI card → resolve → continue)
- [ ] Inner loop extracted and working independently
- [ ] Built-in agents defined as default harness configs
- [ ] Conversation loop refactored to use harness instances
- [ ] Harness CRUD in Convex (create, read, update, delete)
- [ ] Harness editor UI functional in desktop app
- [ ] Existing agent behavior preserved (no regressions)
