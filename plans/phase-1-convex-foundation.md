# Phase 1: Convex Foundation

## Goal

Migrate from the local daemon's in-memory state management to Convex as the
primary backend. Set up the database schema, auth, and real-time subscriptions.
The daemon becomes a thin local service that handles only filesystem, terminal,
and MCP operations.

## Why This Is Phase 1

Everything else depends on this. The harness system needs persistent state.
Multi-user needs auth and real-time. Sharing needs a hosted data layer. Convex
provides all of these, so it must come first.

## Current State

- `apps/daemon/src/session-store.ts` (2300 lines) manages all state in memory
- SSE streaming broadcasts events to the desktop app
- No auth — single user assumed
- No persistence — state lost on daemon restart
- `apps/daemon/src/index.ts` (595 lines) is a raw `node:http` server with 20+
  endpoints

## Target State

- Convex database holds all persistent state (workspaces, threads, events,
  tasks, runs, settings)
- Convex Auth handles user identity and sessions
- Desktop app uses Convex React client for reactive queries (replaces SSE)
- Local daemon is a thin service that the desktop app calls for filesystem,
  terminal, and local execution only
- State survives daemon restarts

## Convex Credentials

The Convex project is already provisioned:

- **Cloud URL:** `https://precise-gopher-800.convex.cloud`
- **HTTP Actions URL:** `https://precise-gopher-800.convex.site`

These are configured in the `.env.local` file at the project root and in
the desktop app's environment.

## Steps

### 1.1 Initialize Convex

- `convex` is already installed as a root dependency
- The `convex/` directory is scaffolded at the project root
- Configure environment files with the Convex URLs above
- Add Convex dev server to the `bun dev` script
- Create `.env.local` with:
  ```
  CONVEX_URL=https://precise-gopher-800.convex.cloud
  ```

### 1.2 Define Core Schema

Create `convex/schema.ts` with tables for:

- `users` — handle, displayName, avatar, bio, profileVisibility
- `workspaces` — name, rootPath, visibility, ownership
- `members` — workspaceId, userId, role
- `threads` — workspaceId, title, status
- `events` — threadId, seq, actor, eventType, payload
- `tasks` — threadId, title, goal, status, assigneeAgentId, etc.
- `runs` — threadId, taskId, agentId, status, summary
- `settings` — userId, apiKeys (encrypted), preferences

Add indexes for all foreign key relationships and common query patterns.

The schema should mirror the types in `packages/protocol/src/entities.ts` but
expressed as Convex validators. The protocol types remain the TypeScript source
of truth; the Convex schema validates at the database layer.

### 1.3 Set Up Convex Auth

- Install the Convex Auth plugin
- Configure email/password auth as the baseline
- Add GitHub OAuth as the first social provider
- Create the `users` table integration so auth creates user records
- Add session validation helpers for use in Convex functions

### 1.4 Write Core Convex Functions

#### Queries (reactive, cached)

- `getWorkspace(workspaceId)` — workspace details + membership
- `getThreads(workspaceId)` — all threads for a workspace
- `getEvents(threadId, afterSeq?)` — event stream for a thread
- `getTasks(threadId)` — tasks for a thread
- `getRuns(threadId)` — runs for a thread
- `getSettings(userId)` — user settings

#### Mutations

- `createWorkspace(name, rootPath)` — create workspace, add creator as owner
- `createThread(workspaceId, title)` — create thread
- `appendEvent(threadId, actor, eventType, payload)` — append to event stream,
  auto-increment seq
- `createTask(...)` — create a task
- `updateTask(taskId, updates)` — status changes, assignment
- `startRun(taskId, agentId)` — create a run
- `completeRun(runId, status, summary)` — finish a run
- `updateSettings(userId, updates)` — save settings

#### Actions (server-side, can call external APIs)

- `dispatchAgent(agentId, systemPrompt, messages, apiKeys)` — call LLM,
  stream results back via mutations. This replaces `ai-client.ts` for the
  Convex-hosted path.

### 1.5 Migrate Desktop App to Convex Client

- Install `convex/react` in `apps/desktop`
- Wrap the app in `ConvexProvider` with the Convex URL
- Replace all `fetch()` calls to the daemon with Convex `useQuery` and
  `useMutation` hooks
- SSE subscription logic is removed — Convex subscriptions handle real-time
  updates automatically
- Thread view subscribes to `getEvents(threadId)` — updates appear in real time

### 1.6 Slim Down the Daemon

The daemon keeps only local-execution endpoints:

- `POST /workspace/files/read` — read files from disk
- `POST /workspace/files/write` — write files to disk
- `POST /workspace/files/list` — list directory
- `POST /workspace/search` — code search / grep
- `POST /workspace/git/*` — git operations
- `POST /terminal/create` — create PTY session
- `POST /terminal/write` — write to PTY
- `WS /terminal/stream/:id` — stream terminal output (WebSocket)

Remove from the daemon:
- All state management (session store)
- Event streaming (SSE)
- Settings storage
- Agent dispatch (moves to Convex actions)
- Conversation loop orchestration (moves to Convex)

The daemon authenticates requests using a local token issued during desktop app
startup. This is not user auth — it's just a guard so only the local desktop
app can talk to the daemon.

### 1.7 API Key Security

API keys (Anthropic, OpenAI, Google, OpenRouter) move to Convex:

- Stored in a `settings` table, scoped to the user
- Encrypted at rest (Convex environment variables for encryption key)
- Only accessible via Convex actions that need them for LLM calls
- Never sent to the desktop app — the app tells Convex "call this agent" and
  Convex uses the stored keys server-side
- Users manage keys through a settings UI that calls Convex mutations

### 1.8 Update Protocol Package

Add Convex-specific types to `packages/protocol`:

- `ConvexId<TableName>` type aliases for Convex document IDs
- Ensure all entity types are compatible with Convex's document model (no
  `undefined` values, dates as ISO strings or numbers)
- Add a shared `Visibility` type: `"private" | "workspace" | "public"`

## Testing Strategy

- Unit tests for Convex functions using Convex's mock backend
- Integration test: create workspace → create thread → append events →
  verify reactive query receives them
- Auth flow test: sign up → sign in → access workspace → verify session
- Daemon slimdown test: verify all remaining daemon endpoints still work
- Desktop app smoke test: open workspace, send message, see agent response

## Migration Notes

- This is a breaking change from the current architecture. The in-memory
  session store is completely replaced.
- During development, the old daemon can run alongside Convex for comparison.
  Feature-flag the Convex path until it's stable.
- Existing prototype HTML files in `prototypes/` are not affected.

## Definition of Done

- [ ] Convex project initialized and deployed
- [ ] Schema defined with all core tables and indexes
- [ ] Convex Auth working with email/password and GitHub OAuth
- [ ] Core queries and mutations implemented and tested
- [ ] Desktop app uses Convex client for all state reads
- [ ] Desktop app uses Convex mutations for all state writes
- [ ] LLM dispatch works as a Convex action
- [ ] Daemon is slimmed to filesystem/terminal/local-only endpoints
- [ ] API keys stored securely in Convex, never exposed to client
- [ ] State persists across daemon restarts
- [ ] Real-time updates work without SSE (Convex subscriptions)
