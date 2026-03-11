# Product

## Vision

Build an agentic IDE where multiple named agents can work inside the same
workspace and thread. The product center is not chat alone. It is a coding
environment where the editor, terminal, and orchestration layer are all
first-class.

Version 1 should prove one thing clearly: a user can work inside a real coding
workspace while multiple agents collaborate, hand work to each other, and act
against the same project context.

## Version 1 Scope

Version 1 includes exactly three pillars:

1. Multi-agent orchestration
2. IDE
3. Terminal

These are not separate features. They are one workflow:

- the user opens a workspace
- the user works in an editor and terminal
- the user interacts with a shared thread attached to that workspace
- the orchestrator routes work to one or more agents
- agents can read the thread, inspect files, propose changes, run commands, and
  hand off tasks to other agents

## Product Goals

### 1. Multi-Agent By Design

The system must support multiple named agents in one session, such as
`Claude`, `Gemini`, `Codex`, and `Composer`.

Version 1 must support:

- visible agent identities
- explicit task assignment
- structured handoffs between agents
- real-time access to the shared thread
- different agent roles such as planner, implementer, reviewer, or frontend
  specialist
- a controller/orchestrator that decides routing and coordination

The system should feel like one coordinated team, not a dropdown that swaps one
model for another.

### 2. IDE As A First-Class Surface

The user must be able to browse files, open editors, inspect diffs, and review
 agent changes without leaving the product.

Version 1 IDE requirements:

- file explorer
- multi-file editor
- code search
- patch and diff review
- diagnostics surface for build and test feedback

### 3. Terminal As A First-Class Surface

The terminal is part of the workflow, not a hidden internal tool.

Version 1 terminal requirements:

- open one or more terminal tabs for a workspace
- stream terminal output live
- let the user run commands directly
- let agents run commands through the same execution model
- show which commands were started by the user vs by an agent

## Primary User Flows

### Open Workspace

The user opens a local workspace. The system indexes the workspace, initializes
editor state, starts terminal support, and creates a thread bound to that
workspace.

### Start A Thread

The user enters a request such as "plan the refactor, implement the API change,
and have another agent review it." The controller creates tasks, assigns them to
agents, and streams progress into the shared thread.

### Delegate Across Agents

One agent can hand work to another agent. Example:

- `Claude` creates a plan
- `Codex` implements the backend changes
- `Gemini` reviews the UI impact
- `Composer` rewrites a failing test or documentation block

Each handoff is explicit and visible in the thread.

### Work Across IDE And Terminal

An agent may inspect files, propose or apply a patch, then run tests in the
terminal. The user can interrupt, redirect, approve, or take over at any point.

### Review Changes

The user reviews proposed edits and command results inside the same workspace.
Version 1 does not need a full PR system, but it must support patch review and
approval or rejection.

## Non-Goals For Version 1

Version 1 should not try to solve everything.

Out of scope:

- full multiplayer collaboration between multiple human users
- web-first parity with the desktop experience
- advanced voice workflows
- plugin marketplace
- enterprise auth and permissions
- remote hosted workspaces as the primary mode
- autonomous long-running background swarms without explicit task structure

These can come later. Version 1 wins if the multi-agent coding workflow feels
coherent and real.

## Product Principles

- Workspace-first, not prompt-first
- Multi-agent is core behavior, not a model picker
- Everything important is visible in the thread or workspace timeline
- Terminal and editor actions must be attributable
- Human override must always be possible
- The local desktop experience is the reference experience

## Success Criteria

Version 1 is successful if a user can:

1. open a real codebase
2. ask multiple agents to collaborate on a task in one thread
3. watch those agents plan, implement, review, and use the terminal
4. inspect the resulting edits in the IDE
5. approve or reject the outcome without leaving the app

## Milestones

### Milestone 1: Workspace Shell

- open a workspace
- file explorer and editor
- terminal sessions
- single shared thread bound to the workspace

### Milestone 2: Multi-Agent Core

- agent roster
- controller/orchestrator
- task creation and assignment
- visible handoffs
- run status and streaming outputs

### Milestone 3: Patch And Command Workflow

- patches proposed by agents
- patch approval and rejection
- agent command execution through terminal infrastructure
- attribution across messages, commands, and file edits

## Deferred After Version 1

- multi-user collaboration
- shared presence and cursors
- remote daemon and hosted control plane
- voice transcription
- container orchestration beyond a basic execution mode
