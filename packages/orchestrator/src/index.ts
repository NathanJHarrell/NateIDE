import {
  createEvent,
  type AppEvent,
  type Artifact,
  type KanbanBoard,
  type Run,
  type Task,
  type Thread,
  type Workspace,
} from "@nateide/protocol";
import { defaultAgentProfiles, type AgentDescriptor } from "@nateide/agents";
import {
  createDemoWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "@nateide/workspace";
import { versionOneShellLayout, type ShellLayout } from "@nateide/ui";

export type ThreadBootstrap = {
  workspace: Workspace;
  thread: Thread;
  agents: AgentDescriptor[];
  board: KanbanBoard;
  tasks: Task[];
  runs: Run[];
  artifacts: Artifact[];
  events: AppEvent[];
  workspaceSnapshot: WorkspaceSnapshot;
  layout: ShellLayout;
};

export type InitialThreadBootstrapOptions = {
  workspace: Workspace;
  workspaceSnapshot: WorkspaceSnapshot;
  board?: KanbanBoard;
  threadTitle?: string;
  welcomeMessage?: string;
};

function createDefaultBoard(workspace: Workspace, ts: string): KanbanBoard {
  return {
    id: `board-${workspace.id}`,
    workspaceId: workspace.id,
    lanes: [
      { id: `lane-${workspace.id}-backlog`, name: "Backlog", color: "#c2853d" },
      { id: `lane-${workspace.id}-in-progress`, name: "In Progress", color: "#3f78c7" },
      { id: `lane-${workspace.id}-done`, name: "Done", color: "#2b8a57" },
    ],
    cards: [],
    updatedAt: ts,
  };
}

function timestampAt(base: number, minuteOffset: number): string {
  return new Date(base + minuteOffset * 60_000).toISOString();
}

export function createInitialThreadBootstrap(
  options: InitialThreadBootstrapOptions,
): ThreadBootstrap {
  const ts = new Date().toISOString();
  const thread: Thread = {
    id: `thread-${options.workspace.id}`,
    workspaceId: options.workspace.id,
    title: options.threadTitle ?? `${options.workspace.name} workspace thread`,
    createdAt: ts,
    updatedAt: ts,
    status: "active",
  };

  const welcomeMessage =
    options.welcomeMessage ??
    `Opened ${options.workspace.name}. Claude is acting as the controller and can route work to Codex, Gemini, and Kimi.`;

  return {
    workspace: options.workspace,
    thread,
    agents: defaultAgentProfiles,
    board: options.board ?? createDefaultBoard(options.workspace, ts),
    tasks: [],
    runs: [],
    artifacts: [],
    events: [
      createEvent({
        id: `evt-open-${options.workspace.id}`,
        threadId: thread.id,
        seq: 1,
        ts,
        actor: { type: "system", id: "orchestrator" },
        type: "thread.message.created",
        payload: {
          messageId: `msg-open-${options.workspace.id}`,
          content: welcomeMessage,
          format: "plain",
        },
      }),
    ],
    workspaceSnapshot: options.workspaceSnapshot,
    layout: versionOneShellLayout,
  };
}

export function createDemoThreadBootstrap(rootPath: string): ThreadBootstrap {
  const base = Date.UTC(2026, 2, 6, 19, 30, 0);
  const workspace: Workspace = {
    id: "workspace-main",
    name: "nateide",
    rootPath,
    git: {
      rootPath,
      branch: "main",
      headSha: "2d3c4b5",
      dirty: true,
    },
    openedAt: timestampAt(base, 0),
  };

  const thread: Thread = {
    id: "thread-v1",
    workspaceId: workspace.id,
    title: "Version 1 orchestration shell",
    createdAt: timestampAt(base, 1),
    updatedAt: timestampAt(base, 9),
    status: "active",
  };

  const tasks: Task[] = [
    {
      id: "task-plan-v1",
      threadId: thread.id,
      title: "Frame version 1 workflow",
      goal: "Turn the product docs into an orchestrated execution plan.",
      status: "completed",
      createdBy: { type: "user", id: "nate" },
      assigneeAgentId: "agent-controller",
      fileScope: ["PRODUCT.md", "ARCHITECTURE.md", "PROTOCOL.md"],
      terminalScope: [],
      dependsOnTaskIds: [],
      createdAt: timestampAt(base, 1),
      updatedAt: timestampAt(base, 3),
    },
    {
      id: "task-scaffold-shell",
      threadId: thread.id,
      title: "Scaffold IDE and terminal shell",
      goal: "Create the workspace structure, desktop shell, and daemon entrypoint.",
      status: "in_progress",
      createdBy: { type: "agent", id: "agent-controller" },
      assigneeAgentId: "agent-codex",
      fileScope: ["apps/desktop", "apps/daemon", "packages/ui"],
      terminalScope: ["workspace shell"],
      dependsOnTaskIds: ["task-plan-v1"],
      createdAt: timestampAt(base, 4),
      updatedAt: timestampAt(base, 9),
    },
    {
      id: "task-review-terminal-model",
      threadId: thread.id,
      title: "Review execution model",
      goal: "Validate terminal attribution and write-lock rules before the shell lands.",
      status: "assigned",
      createdBy: { type: "agent", id: "agent-controller" },
      assigneeAgentId: "agent-gemini",
      fileScope: [],
      terminalScope: ["workspace shell"],
      dependsOnTaskIds: ["task-scaffold-shell"],
      createdAt: timestampAt(base, 6),
      updatedAt: timestampAt(base, 6),
    },
  ];

  const runs: Run[] = [
    {
      id: "run-controller-plan",
      threadId: thread.id,
      taskId: tasks[0].id,
      agentId: "agent-controller",
      status: "completed",
      startedAt: timestampAt(base, 2),
      finishedAt: timestampAt(base, 3),
      summary: "Produced the initial task graph and assigned the scaffold work.",
    },
    {
      id: "run-codex-scaffold",
      threadId: thread.id,
      taskId: tasks[1].id,
      agentId: "agent-codex",
      status: "streaming",
      startedAt: timestampAt(base, 5),
      summary: "Building a Bun workspace, protocol package, daemon, and desktop shell.",
    },
    {
      id: "run-gemini-review",
      threadId: thread.id,
      taskId: tasks[2].id,
      agentId: "agent-gemini",
      status: "queued",
    },
  ];

  const artifacts: Artifact[] = [
    {
      id: "artifact-plan-v1",
      threadId: thread.id,
      runId: runs[0].id,
      type: "plan",
      metadata: {
        summary: "Prioritize orchestration, make terminal actions attributable, keep IDE first-class.",
      },
      createdAt: timestampAt(base, 3),
    },
    {
      id: "artifact-shell-patch",
      threadId: thread.id,
      runId: runs[1].id,
      type: "patch",
      metadata: {
        paths: ["apps/desktop/src/app.tsx", "apps/daemon/src/index.ts"],
        summary: "Initial shell layout and daemon bootstrap endpoint.",
      },
      createdAt: timestampAt(base, 8),
    },
  ];

  const board: KanbanBoard = {
    id: "board-v1",
    workspaceId: workspace.id,
    lanes: [
      { id: "lane-backlog", name: "Backlog", color: "#c2853d" },
      { id: "lane-now", name: "Now", color: "#3f78c7" },
      { id: "lane-verify", name: "Verify", color: "#8a50c7" },
      { id: "lane-done", name: "Done", color: "#2b8a57" },
    ],
    cards: [
      {
        id: "card-shell",
        laneId: "lane-now",
        title: "Scaffold IDE shell",
        description: "Tie the editor, terminal, and thread together around the orchestration loop.",
        priority: "high",
        fileTags: [
          { path: `${rootPath}/apps/desktop/src/app.tsx`, kind: "file" },
          { path: `${rootPath}/apps/daemon/src/index.ts`, kind: "file" },
        ],
        assignedAgentId: "agent-codex",
        createdBy: { type: "user", id: "nate" },
        createdAt: timestampAt(base, 2),
        updatedAt: timestampAt(base, 6),
      },
      {
        id: "card-review",
        laneId: "lane-verify",
        title: "Review terminal attribution",
        description: "Make sure terminal actions stay tied to the run that triggered them.",
        priority: "medium",
        fileTags: [
          { path: `${rootPath}/packages/protocol/src/events.ts`, kind: "file" },
        ],
        assignedAgentId: "agent-gemini",
        createdBy: { type: "agent", id: "agent-controller" },
        createdAt: timestampAt(base, 4),
        updatedAt: timestampAt(base, 7),
      },
    ],
    updatedAt: timestampAt(base, 8),
  };

  const events: AppEvent[] = [
    createEvent({
      id: "evt-001",
      threadId: thread.id,
      seq: 1,
      ts: timestampAt(base, 1),
      actor: { type: "user", id: "nate" },
      type: "thread.message.created",
      payload: {
        messageId: "msg-001",
        content: "Version 1 scope is multi-agent orchestration, terminal, and IDE.",
        format: "plain",
      },
    }),
    createEvent({
      id: "evt-002",
      threadId: thread.id,
      seq: 2,
      ts: timestampAt(base, 2),
      actor: { type: "system", id: "orchestrator" },
      type: "task.created",
      payload: { task: tasks[0] },
    }),
    createEvent({
      id: "evt-003",
      threadId: thread.id,
      seq: 3,
      ts: timestampAt(base, 3),
      actor: { type: "agent", id: "agent-controller" },
      type: "run.completed",
      payload: {
        runId: runs[0].id,
        status: "completed" as const,
        summary: runs[0].summary ?? "",
      },
    }),
    createEvent({
      id: "evt-004",
      threadId: thread.id,
      seq: 4,
      ts: timestampAt(base, 4),
      actor: { type: "system", id: "orchestrator" },
      type: "task.created",
      payload: { task: tasks[1] },
    }),
    createEvent({
      id: "evt-005",
      threadId: thread.id,
      seq: 5,
      ts: timestampAt(base, 4),
      actor: { type: "system", id: "orchestrator" },
      type: "task.assigned",
      payload: {
        taskId: tasks[1].id,
        agentId: "agent-codex",
        assignedBy: "agent-controller",
      },
    }),
    createEvent({
      id: "evt-006",
      threadId: thread.id,
      seq: 6,
      ts: timestampAt(base, 5),
      actor: { type: "agent", id: "agent-codex" },
      type: "run.started",
      payload: {
        run: runs[1],
      },
    }),
    createEvent({
      id: "evt-007",
      threadId: thread.id,
      seq: 7,
      ts: timestampAt(base, 5),
      actor: { type: "agent", id: "agent-codex" },
      type: "terminal.session.opened",
      payload: {
        terminalSessionId: "terminal-main",
        cwd: rootPath,
        initiatedBy: { type: "agent" as const, id: "agent-codex" },
        runId: runs[1].id,
      },
    }),
    createEvent({
      id: "evt-008",
      threadId: thread.id,
      seq: 8,
      ts: timestampAt(base, 5),
      actor: { type: "agent", id: "agent-codex" },
      type: "terminal.command.started",
      payload: {
        terminalSessionId: "terminal-main",
        commandId: "command-typecheck",
        command: "bun run typecheck",
        runId: runs[1].id,
      },
    }),
    createEvent({
      id: "evt-009",
      threadId: thread.id,
      seq: 9,
      ts: timestampAt(base, 6),
      actor: { type: "agent", id: "agent-controller" },
      type: "handoff.created",
      payload: {
        fromAgentId: "agent-controller",
        toAgentId: "agent-gemini",
        sourceTaskId: tasks[1].id,
        newTaskId: tasks[2].id,
        goal: tasks[2].goal,
        inputs: ["terminal attribution model", "one-writer lock policy"],
        deliverable: "review notes before shell files are finalized",
      },
    }),
    createEvent({
      id: "evt-010",
      threadId: thread.id,
      seq: 10,
      ts: timestampAt(base, 7),
      actor: { type: "agent", id: "agent-codex" },
      type: "run.output.delta",
      payload: {
        runId: runs[1].id,
        channel: "message" as const,
        text: "Scaffolded the workspace packages and connected the shell to a daemon bootstrap endpoint.",
      },
    }),
    createEvent({
      id: "evt-011",
      threadId: thread.id,
      seq: 11,
      ts: timestampAt(base, 8),
      actor: { type: "agent", id: "agent-codex" },
      type: "artifact.created",
      payload: {
        artifact: artifacts[1],
      },
    }),
    createEvent({
      id: "evt-012",
      threadId: thread.id,
      seq: 12,
      ts: timestampAt(base, 8),
      actor: { type: "agent", id: "agent-codex" },
      type: "patch.proposed",
      payload: {
        artifactId: artifacts[1].id,
        runId: runs[1].id,
        paths: ["apps/desktop/src/app.tsx", "apps/daemon/src/index.ts"],
        summary: "Initial shell layout and daemon bootstrap endpoint.",
      },
    }),
  ];

  return {
    workspace,
    thread,
    agents: defaultAgentProfiles,
    board,
    tasks,
    runs,
    artifacts,
    events,
    workspaceSnapshot: createDemoWorkspaceSnapshot(rootPath),
    layout: versionOneShellLayout,
  };
}
