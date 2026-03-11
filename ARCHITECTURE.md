# Architecture

## Summary

The system should be built as a new product rooted at `/home/nate/nateide`.
It should not depend on `opencode` as the primary architecture. Existing code in
`/home/nate/nateide/opencode` can be referenced or mined selectively, but
version 1 should stand on its own design.

The architecture is desktop-first with a local daemon. This gives reliable
filesystem access, git operations, PTY support, indexing, and an IDE workflow
without fighting browser restrictions.

## System Shape

Version 1 should be a modular monolith split into a desktop app, a local daemon,
and shared packages.

### Apps

- `apps/desktop`
  - Desktop shell and main UI
  - Hosts the editor, terminal, thread, review surface, and agent roster

- `apps/daemon`
  - Local backend process
  - Owns workspace access, git, PTY, indexing, event storage, and provider
    integrations

- `apps/web` later
  - Optional remote client for shared or hosted workflows
  - Not required for version 1

### Packages

- `packages/protocol`
  - Shared TypeScript schemas for commands, events, entities, and streaming
    payloads

- `packages/orchestrator`
  - Task graph logic
  - Routing rules
  - Handoff contracts
  - Run lifecycle

- `packages/agents`
  - Agent profiles
  - Provider adapters
  - Role-specific prompts and policies

- `packages/workspace`
  - File tree
  - search
  - git
  - diffing
  - patch application
  - indexing
  - terminal session coordination

- `packages/ui`
  - Shared components and layout primitives

## Architectural Priorities For Version 1

### 1. Multi-Agent Orchestration Is The Core

The controller and event model come first. The IDE and terminal are there to
make the orchestration useful inside a real workspace.

This changes the shape of the system:

- one workspace can have one or more threads
- one thread can have multiple active agents
- the controller decides what each agent should do
- each agent execution is a `Run`
- runs produce messages, patches, command output, and summaries as events

### 2. Event Log As The Source Of Truth

The system should store an append-only event log per thread.

Why:

- agents need shared visibility into the session
- the UI needs replayable state
- task/routing/debugging is easier when behavior is event-based
- summaries and reviews are easier to derive from events than from ad hoc mutable
  state

Examples of events:

- user message
- agent message
- task created
- task assigned
- handoff created
- run started
- terminal output streamed
- patch proposed
- patch applied
- run completed

### 3. Desktop-First Execution

Version 1 should assume:

- local workspace on disk
- local daemon with direct filesystem access
- desktop shell for the main experience

The web client should not drive early architectural decisions.

## Runtime Model

### Native Local Mode

This is the default mode for version 1.

- desktop app runs on the host
- daemon runs on the host
- workspace is a local directory
- git and PTY run directly on the host

This mode gives the best developer ergonomics and the fewest moving parts.

### Optional Containerized Execution Mode

Container support is useful, but it should be selective.

Principle:

- containerize execution
- do not containerize interaction

Good uses for containers:

- isolated agent command execution
- reproducible workspace runtimes
- test and preview environments
- remote or team deployments later

Bad uses for containers:

- the primary desktop shell
- file picking UX
- voice capture
- editor interaction

The daemon should be able to target either host execution or container-backed
execution through the same interface.

### Hosted Mode Later

After version 1, a remote control plane can be added for:

- shared sessions
- remote workspaces
- authentication
- presence and collaboration

That should be a later layer, not a prerequisite.

## Recommended Tech Stack

### Desktop Shell

- `Tauri`
  - native windowing
  - small footprint
  - good local integration

### Editor

- `Monaco`
  - mature IDE-like editing model
  - strong language tooling integration

### Terminal

- `xterm.js`
  - browser-rendered terminal surface
  - pairs well with PTY streaming from the daemon

### Backend

- `TypeScript` for shared logic
- `Bun` or `Node.js` for the daemon runtime

Version 1 can use either, but the daemon should keep process boundaries and
protocols explicit so runtime choice is not baked into the whole system.

### Local Storage

- `SQLite`
  - event log
  - workspace metadata
  - task and run records
  - cached summaries

### Later Remote Storage

- `Postgres`
  - hosted metadata and event storage

## UI Layout

Version 1 should feel like an IDE, not a chat app with a code pane.

Recommended default layout:

- left sidebar: workspace explorer, search, git, agents
- center: multi-tab editor
- bottom panel: terminal and diagnostics
- right panel: thread, tasks, runs, and handoffs

This layout keeps the orchestration visible without making the editor secondary.

## Orchestrator Design

### Controller

Use a lightweight controller as the top-level coordinator.

Responsibilities:

- interpret new user requests
- decompose work into tasks
- assign tasks to agents
- decide when to hand off or request review
- prevent reply storms from every agent responding at once

The controller is not required to be a separate model. It can be a system role
implemented by the daemon and orchestrator package.

### Agents

Each named agent has:

- identity
- role
- provider/model preference
- tool policy
- editable file permissions
- context budget strategy

Examples:

- `Claude`: planner or synthesizer
- `Codex`: implementer
- `Gemini`: reviewer or UI specialist
- `Composer`: rewrite and polish agent

### Runs

A run is one scoped execution of one task by one agent.

Runs should have:

- explicit inputs
- bounded scope
- streamed output
- terminal and file activity attribution
- final status and summary

## Workspace Services

The daemon should expose these services:

- workspace listing and opening
- file read and write
- search and indexing
- git status, diff, branch, commit metadata
- terminal session creation and streaming
- patch apply and revert by explicit action
- provider/model invocation
- event append and subscription

These services should sit behind the protocol layer so the desktop app never
calls raw internals directly.

## Suggested Repo Layout

```text
/home/nate/nateide
  apps/
    desktop/
    daemon/
  packages/
    protocol/
    orchestrator/
    agents/
    workspace/
    ui/
  docs/
  opencode/            # temporary reference only, not the product base
```

## Key Architectural Rules

- The event log is canonical
- The workspace is a first-class concept
- The thread belongs to a workspace
- Agents collaborate through tasks and events, not hidden side channels
- Terminal actions and patches must be attributable to a specific run
- One writer policy should apply when two runs touch overlapping file scope
- Human approval must gate destructive or high-impact operations

## Out Of Scope For Version 1 Architecture

- full multi-user Yjs collaboration
- cloud-native multi-tenant control plane
- plugin marketplace
- browser-only mode as the primary path
- autonomous background swarms with no task boundaries
