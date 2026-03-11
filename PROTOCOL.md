# Protocol

## Purpose

This document defines the canonical entities and event model for version 1.
Everything in the product should reduce to these structures:

- workspace state
- thread state
- tasks
- runs
- artifacts
- terminal activity
- file changes
- agent messages

Version 1 is built around multi-agent orchestration, so the protocol must make
agent coordination explicit and inspectable.

## Design Rules

- The event stream is append-only
- UI state is derived from events and projections
- Every agent action is attributable
- Tasks and runs are explicit objects, not inferred from chat text
- Terminal and IDE activity must be tied back to a run or user action
- Handoffs are visible protocol objects

## Core Entities

### Workspace

Represents a project directory and the services attached to it.

```ts
type Workspace = {
  id: string
  name: string
  rootPath: string
  git?: {
    rootPath: string
    branch: string
    headSha: string
    dirty: boolean
  }
  openedAt: string
}
```

### Thread

Represents one collaborative session inside a workspace.

```ts
type Thread = {
  id: string
  workspaceId: string
  title: string
  createdAt: string
  updatedAt: string
  status: "idle" | "active" | "blocked" | "completed"
}
```

### AgentProfile

Represents a named agent that can participate in a thread.

```ts
type AgentProfile = {
  id: string
  name: string
  role: "controller" | "planner" | "implementer" | "reviewer" | "specialist"
  provider: string
  model: string
  canEditFiles: boolean
  canRunCommands: boolean
  canApprove: boolean
}
```

### Task

A task is a scoped unit of work. Tasks can be created by the user, the
controller, or another agent.

```ts
type Task = {
  id: string
  threadId: string
  title: string
  goal: string
  status: "open" | "assigned" | "in_progress" | "blocked" | "completed" | "failed"
  createdBy: {
    type: "user" | "agent" | "system"
    id: string
  }
  assigneeAgentId?: string
  fileScope: string[]
  terminalScope: string[]
  dependsOnTaskIds: string[]
  createdAt: string
  updatedAt: string
}
```

### Run

A run is one execution attempt by one agent against one task.

```ts
type Run = {
  id: string
  threadId: string
  taskId: string
  agentId: string
  status: "queued" | "starting" | "streaming" | "waiting" | "completed" | "failed" | "canceled"
  startedAt?: string
  finishedAt?: string
  summary?: string
}
```

### Artifact

Artifacts are durable outputs from a run.

```ts
type Artifact = {
  id: string
  threadId: string
  runId?: string
  type:
    | "plan"
    | "summary"
    | "patch"
    | "review"
    | "command_result"
    | "diff"
    | "diagnostic"
  uri?: string
  metadata: Record<string, unknown>
  createdAt: string
}
```

### Presence

Version 1 only needs lightweight presence.

```ts
type Presence = {
  threadId: string
  actorType: "user" | "agent"
  actorId: string
  status: "online" | "active" | "busy" | "idle" | "offline"
  updatedAt: string
}
```

## Event Model

Each thread has an append-only event stream ordered by sequence number.

```ts
type EventEnvelope<TType extends string, TPayload> = {
  id: string
  threadId: string
  seq: number
  ts: string
  actor: {
    type: "user" | "agent" | "system"
    id: string
  }
  type: TType
  payload: TPayload
}
```

The system should never mutate historical events. Corrections and updates are
represented by later events.

## Required Event Families For Version 1

### Thread Events

```ts
type ThreadMessageCreated = EventEnvelope<
  "thread.message.created",
  {
    messageId: string
    content: string
    format: "markdown" | "plain"
  }
>
```

### Task Events

```ts
type TaskCreated = EventEnvelope<
  "task.created",
  {
    task: Task
  }
>

type TaskAssigned = EventEnvelope<
  "task.assigned",
  {
    taskId: string
    agentId: string
    assignedBy: string
  }
>

type TaskStatusChanged = EventEnvelope<
  "task.status.changed",
  {
    taskId: string
    status: Task["status"]
    reason?: string
  }
>
```

### Handoff Events

Handoffs are first-class.

```ts
type HandoffCreated = EventEnvelope<
  "handoff.created",
  {
    fromAgentId: string
    toAgentId: string
    sourceTaskId: string
    newTaskId: string
    goal: string
    inputs: string[]
    deliverable: string
  }
>
```

### Run Events

```ts
type RunStarted = EventEnvelope<
  "run.started",
  {
    run: Run
  }
>

type RunOutputDelta = EventEnvelope<
  "run.output.delta",
  {
    runId: string
    channel: "message" | "summary" | "debug"
    text: string
  }
>

type RunCompleted = EventEnvelope<
  "run.completed",
  {
    runId: string
    status: "completed" | "failed" | "canceled"
    summary: string
  }
>
```

### Terminal Events

The terminal is protocol-visible, not hidden behind opaque tool calls.

```ts
type TerminalSessionOpened = EventEnvelope<
  "terminal.session.opened",
  {
    terminalSessionId: string
    cwd: string
    initiatedBy: {
      type: "user" | "agent"
      id: string
    }
    runId?: string
  }
>

type TerminalCommandStarted = EventEnvelope<
  "terminal.command.started",
  {
    terminalSessionId: string
    commandId: string
    command: string
    runId?: string
  }
>

type TerminalOutputDelta = EventEnvelope<
  "terminal.output.delta",
  {
    terminalSessionId: string
    commandId?: string
    stream: "stdout" | "stderr"
    text: string
  }
>

type TerminalCommandCompleted = EventEnvelope<
  "terminal.command.completed",
  {
    terminalSessionId: string
    commandId: string
    exitCode: number
    runId?: string
  }
>
```

### IDE And Patch Events

```ts
type FileOpened = EventEnvelope<
  "file.opened",
  {
    path: string
    initiatedBy: {
      type: "user" | "agent"
      id: string
    }
  }
>

type PatchProposed = EventEnvelope<
  "patch.proposed",
  {
    artifactId: string
    runId: string
    paths: string[]
    summary: string
  }
>

type PatchApplied = EventEnvelope<
  "patch.applied",
  {
    artifactId: string
    appliedBy: {
      type: "user" | "agent" | "system"
      id: string
    }
  }
>

type PatchRejected = EventEnvelope<
  "patch.rejected",
  {
    artifactId: string
    rejectedBy: {
      type: "user" | "agent"
      id: string
    }
    reason?: string
  }
>
```

## Orchestration Semantics

### Shared Thread Visibility

Agents can read the thread in near real time by subscribing to the thread event
stream.

Rules:

- active agents may receive the full relevant thread stream
- background agents may receive filtered events or summaries
- the controller decides which agents should respond

This prevents every agent from responding to every message while still allowing
real-time coordination.

### Controller Responsibility

The controller is responsible for:

- interpreting new user requests
- deciding whether to answer directly or create tasks
- choosing assignees
- deciding when a handoff is needed
- preventing overlapping conflicting runs

### One Writer Policy

Two runs should not both have write authority over the same file scope at the
same time.

Rules:

- overlapping write scopes require serialization
- read-only review runs can execute in parallel
- the orchestrator should enforce locks or reservations on writable file scope

### Human Override

The user can:

- reassign a task
- cancel a run
- reject a patch
- force a terminal command stop
- change the active agent plan

These actions should also be emitted as events.

## Suggested Projections

The UI should not query raw events for every screen. The daemon should build
projections such as:

- thread timeline
- task board
- agent roster state
- terminal session list
- patch review queue
- latest workspace git state

These are derived read models, not canonical sources of truth.

## Version 1 Exclusions

The protocol does not need to cover these yet:

- multi-user CRDT document sync
- voice audio packet streaming
- marketplace/plugin lifecycle
- hosted org and permission models
- background autonomous workflows with no explicit task/run lineage

## Initial Principle

If a user asks, "What happened, who did it, and why did the system make that
choice?" the protocol should be able to answer from the event log alone.
