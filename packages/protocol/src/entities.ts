export type {
  Visibility,
  MemberRole,
  ConvexId,
  ApiKeyProvider,
  UserProfile,
  UserSettings,
  WorkspaceMember,
} from "./convex-types";

export type ActorKind = "user" | "agent" | "system";

export type ActorRef = {
  type: ActorKind;
  id: string;
};

export type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  git?: {
    rootPath: string;
    branch: string;
    headSha: string;
    dirty: boolean;
  };
  openedAt: string;
};

export type WorkspaceCandidate = {
  name: string;
  path: string;
  source: "direct" | "scan";
  hasGit: boolean;
  hasPackageJson: boolean;
};

export type KanbanCardPriority = "low" | "medium" | "high";

export type KanbanFileTag = {
  path: string;
  kind: "file" | "directory";
};

export type KanbanLane = {
  id: string;
  name: string;
  color: string;
};

export type KanbanCard = {
  id: string;
  laneId: string;
  title: string;
  description: string;
  priority: KanbanCardPriority;
  fileTags: KanbanFileTag[];
  assignedAgentId?: string;
  createdBy: ActorRef;
  createdAt: string;
  updatedAt: string;
};

export type KanbanBoard = {
  id: string;
  workspaceId: string;
  lanes: KanbanLane[];
  cards: KanbanCard[];
  updatedAt: string;
};

export type ThreadStatus = "idle" | "active" | "blocked" | "completed";

export type Thread = {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: ThreadStatus;
};

export type AgentRole =
  | "controller"
  | "planner"
  | "implementer"
  | "executor"
  | "reviewer"
  | "generalist"
  | "specialist";

export type AgentProfile = {
  id: string;
  name: string;
  role: AgentRole;
  provider: string;
  model: string;
  canEditFiles: boolean;
  canRunCommands: boolean;
  canApprove: boolean;
};

export type TaskStatus =
  | "open"
  | "assigned"
  | "in_progress"
  | "blocked"
  | "completed"
  | "failed";

export type Task = {
  id: string;
  threadId: string;
  title: string;
  goal: string;
  status: TaskStatus;
  createdBy: ActorRef;
  assigneeAgentId?: string;
  fileScope: string[];
  terminalScope: string[];
  dependsOnTaskIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type RunStatus =
  | "queued"
  | "starting"
  | "streaming"
  | "waiting"
  | "completed"
  | "failed"
  | "canceled";

export type Run = {
  id: string;
  threadId: string;
  taskId: string;
  agentId: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  tokenUsage?: TokenUsage;
};

export type ArtifactType =
  | "plan"
  | "summary"
  | "patch"
  | "review"
  | "command_result"
  | "diff"
  | "diagnostic";

export type Artifact = {
  id: string;
  threadId: string;
  runId?: string;
  type: ArtifactType;
  uri?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PresenceStatus = "online" | "active" | "busy" | "idle" | "offline";

export type Presence = {
  threadId: string;
  actorType: "user" | "agent";
  actorId: string;
  status: PresenceStatus;
  updatedAt: string;
};

export type MessageFormat = "markdown" | "plain";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
};

export type PipelineNodeType = "agent" | "condition" | "parallel-split" | "parallel-join" | "start" | "end";

export type PipelineNode = {
  id: string;
  type: PipelineNodeType;
  agentId?: string;
  condition?: string;
  label: string;
  position: { x: number; y: number };
};

export type PipelineEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string;
};

export type Pipeline = {
  id: string;
  name: string;
  description: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  createdAt: string;
  updatedAt: string;
};

export type PipelineExecutionStatus = "running" | "completed" | "failed" | "canceled";

export type PipelineExecution = {
  id: string;
  pipelineId: string;
  status: PipelineExecutionStatus;
  currentNodeIds: string[];
  completedNodeIds: string[];
  nodeOutputs: Record<string, string>;
  startedAt: string;
  finishedAt?: string;
};
