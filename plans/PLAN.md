# Master Plan

## Overview

This plan transforms the project from a desktop-first single-user agentic IDE
into a multiplayer platform for multi-agent orchestration — an "Agentic GitHub"
where humans and AI agents collaborate on projects with sharable configurations,
real-time presence, and community discovery.

The work is split into seven phases. Each phase is self-contained and
delivers usable functionality. Later phases build on earlier ones but each
phase should be mergeable and shippable on its own.

## Architecture Shift

The system moves from a local daemon with in-memory state to a hybrid
architecture:

- **Convex** handles state, real-time sync, auth, and the social/sharing layer
- **Local daemon** (thin) handles filesystem access, terminal/PTY, MCP clients,
  and local tool execution
- **Desktop app** (React/Tauri) talks to both Convex and the local daemon

This replaces the current monolithic daemon that owns state, streaming, auth,
and execution all in one process.

## Key Design Decisions

These decisions were made during the design phase and apply across all phases:

1. **Everything is a shareable artifact.** Workspaces, projects, pipelines,
   harnesses, tools, souls, and MCP configs all have a visibility toggle:
   `private | workspace | public`. Public artifacts appear on user profiles.

2. **Agents ask permission by default.** Read-only operations execute freely.
   Mutating operations (file writes, commands, tool calls) require user
   approval. YOLO mode skips all confirmations. This is per-harness.

3. **Harness = agent definition.** A harness is model + tools + soul + execution
   policy. Built-in agents are just pre-filled harnesses. Users create custom
   agents by creating harnesses. One concept, one editor.

4. **Soul follows the SOUL.md framework.** Each harness has four markdown
   documents: SOUL (identity), STYLE (voice), SKILL (operating instructions),
   MEMORY (accumulated context). Users edit them directly.

5. **Tools are grants, not capabilities.** A harness declares which tools an
   agent can use. The runtime enforces this — an agent that tries to use an
   ungranted tool gets a rejection, not a silent drop.

6. **Convex Auth for identity.** No separate auth service. Convex Auth handles
   users, sessions, OAuth, and organization membership.

7. **Conflicts halt execution.** When users give contradictory instructions or
   agents hit file conflicts, execution pauses and both users are notified.
   Resolution happens in the thread.

8. **Clone, don't link.** When a user imports a public pipeline or clones a
   harness, they get an independent copy. No upstream dependency.

## Phases

### Phase 1: Convex Foundation
Migrate from local daemon state to Convex. Set up database schema, auth, and
real-time subscriptions. The daemon becomes a thin local service.

**Plan:** [plans/phase-1-convex-foundation.md](./phase-1-convex-foundation.md)

### Phase 2: Harness System
Extract the agent execution logic from session-store into a proper harness
abstraction. Tool registry, tool executor, approval queue, and per-agent
execution loops.

**Plan:** [plans/phase-2-harness-system.md](./phase-2-harness-system.md)

### Phase 3: Soul System
Replace the current structured SoulDocument with the SOUL/STYLE/SKILL/MEMORY
markdown-based soul framework. User-editable per harness with templates and
import support.

**Plan:** [plans/phase-3-soul-system.md](./phase-3-soul-system.md)

### Phase 4: Custom Tools & MCP
User-created tools (command, HTTP, MCP), MCP client integration in the daemon,
and the tool grant/approval flow.

**Plan:** [plans/phase-4-custom-tools-mcp.md](./phase-4-custom-tools-mcp.md)

### Phase 5: Pipeline Overhaul
Upgrade pipelines so agent nodes carry full harness configs, add tool nodes,
improve condition nodes, and build the visual pipeline editor.

**Plan:** [plans/phase-5-pipeline-overhaul.md](./phase-5-pipeline-overhaul.md)

### Phase 6: Multi-User & Real-Time Collaboration
Workspace membership, real-time presence, shared threads, multi-user approval
queue, conflict detection and halting.

**Plan:** [plans/phase-6-multi-user.md](./phase-6-multi-user.md)

### Phase 7: Profiles, Projects & Discovery
User profiles, project pages, public artifacts, stars, cloning/importing,
and the community discovery surface.

**Plan:** [plans/phase-7-profiles-discovery.md](./phase-7-profiles-discovery.md)

### Standalone: Floating Agent Chat
A persistent floating chat panel accessible from any page via a button in the
bottom-right corner. Works like an intercom widget — open it on the terminal
workspace, the explore page, settings, anywhere.

**Plan:** [plans/phase-floating-chat.md](./phase-floating-chat.md)

### Standalone: Multi-Terminal Workspace
Full-screen terminal grid when two or more terminals are open. Independent of
the phased plan — can be built alongside any phase after Phase 1.

**Plan:** [plans/phase-terminal-workspace.md](./phase-terminal-workspace.md)

## Dependency Graph

```
Phase 1 (Convex Foundation)
  ├── Phase 2 (Harness System)
  │     ├── Phase 3 (Soul System)
  │     └── Phase 4 (Custom Tools & MCP)
  │           └── Phase 5 (Pipeline Overhaul)
  ├── Phase 6 (Multi-User)
  │     └── Phase 7 (Profiles & Discovery)
  ├── Standalone: Floating Agent Chat
  └── Standalone: Multi-Terminal Workspace
```

Phases 2 and 6 can run in parallel after Phase 1.
Phases 3 and 4 can run in parallel after Phase 2.
Phase 5 requires Phase 4.
Phase 7 requires Phase 6.
Standalone features can be built anytime after Phase 1.

## Files That Will Change Significantly

These existing files will see major refactoring or replacement:

| File | Change |
|------|--------|
| `apps/daemon/src/session-store.ts` | Gutted. State moves to Convex. Execution logic moves to harness. Becomes a thin bridge. |
| `apps/daemon/src/conversation-loop.ts` | Refactored to instantiate harnesses instead of inline dispatch. |
| `apps/daemon/src/ai-client.ts` | Moves to Convex actions for LLM calls. Local daemon keeps a thin proxy for streaming. |
| `apps/daemon/src/pipeline-engine.ts` | Rewritten with harness-per-node and tool nodes. |
| `apps/daemon/src/index.ts` | HTTP server simplified. Most endpoints become Convex functions. |
| `packages/protocol/src/entities.ts` | Extended with Harness, CustomTool, Project, UserProfile types. |
| `packages/protocol/src/events.ts` | New event types for presence, conflict, approval, tool execution. |
| `packages/agents/src/catalog.ts` | Built-in agents become default harness configs. |
| `packages/agents/src/soul-documents.ts` | Replaced by SOUL/STYLE/SKILL/MEMORY markdown system. |
| `apps/desktop/src/app.tsx` | Major UI additions across all phases. |

## New Packages and Directories

| Path | Purpose |
|------|---------|
| `convex/` | Convex schema, functions, actions, auth config |
| `packages/harness/` | AgentHarness class, ToolRegistry, ToolExecutor, approval queue |
| `packages/soul/` | Soul parsing, rendering, template system, memory extraction |
| `packages/mcp-client/` | MCP client for connecting to external tool servers |
| `plans/` | This directory. Phase plans and architecture decisions. |

## Documents That Need Updating

After implementation, these existing documents should be revised to reflect
the new architecture:

- `ARCHITECTURE.md` — hybrid Convex + local daemon, new package structure
- `PRODUCT.md` — expanded scope: multi-user, profiles, sharing, projects
- `PROTOCOL.md` — new entities, events, and Convex schema as source of truth
