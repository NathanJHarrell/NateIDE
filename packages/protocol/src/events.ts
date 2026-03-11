import type {
  ActorRef,
  Artifact,
  KanbanBoard,
  KanbanCard,
  KanbanLane,
  MessageFormat,
  Pipeline,
  PipelineExecution,
  Run,
  Task,
  TaskStatus,
  TokenUsage,
} from "./entities";

export type EventEnvelope<TType extends string, TPayload> = {
  id: string;
  threadId: string;
  seq: number;
  ts: string;
  actor: ActorRef;
  type: TType;
  payload: TPayload;
};

export type ThreadMessageCreatedEvent = EventEnvelope<
  "thread.message.created",
  {
    messageId: string;
    content: string;
    format: MessageFormat;
  }
>;

export type TaskCreatedEvent = EventEnvelope<
  "task.created",
  {
    task: Task;
  }
>;

export type TaskAssignedEvent = EventEnvelope<
  "task.assigned",
  {
    taskId: string;
    agentId: string;
    assignedBy: string;
  }
>;

export type TaskStatusChangedEvent = EventEnvelope<
  "task.status.changed",
  {
    taskId: string;
    status: TaskStatus;
    reason?: string;
  }
>;

export type HandoffCreatedEvent = EventEnvelope<
  "handoff.created",
  {
    fromAgentId: string;
    toAgentId: string;
    sourceTaskId: string;
    newTaskId: string;
    goal: string;
    inputs: string[];
    deliverable: string;
  }
>;

export type RunStartedEvent = EventEnvelope<
  "run.started",
  {
    run: Run;
  }
>;

export type RunOutputDeltaEvent = EventEnvelope<
  "run.output.delta",
  {
    runId: string;
    channel: "message" | "summary" | "debug";
    text: string;
  }
>;

export type RunCompletedEvent = EventEnvelope<
  "run.completed",
  {
    runId: string;
    status: "completed" | "failed" | "canceled";
    summary: string;
    tokenUsage?: TokenUsage;
  }
>;

export type RunCanceledEvent = EventEnvelope<
  "run.canceled",
  {
    runId: string;
    canceledBy: ActorRef;
  }
>;

export type ControllerThinkingEvent = EventEnvelope<
  "controller.thinking",
  {
    isActionable: boolean;
    keywordsMatched: string[];
    agents: Array<{
      agentId: string;
      name: string;
      selected: boolean;
      matchedKeywords: string[];
    }>;
    decision: string;
  }
>;

export type TerminalSessionOpenedEvent = EventEnvelope<
  "terminal.session.opened",
  {
    terminalSessionId: string;
    cwd: string;
    initiatedBy: ActorRef;
    runId?: string;
  }
>;

export type TerminalCommandStartedEvent = EventEnvelope<
  "terminal.command.started",
  {
    terminalSessionId: string;
    commandId: string;
    command: string;
    runId?: string;
  }
>;

export type TerminalOutputDeltaEvent = EventEnvelope<
  "terminal.output.delta",
  {
    terminalSessionId: string;
    commandId?: string;
    stream: "stdout" | "stderr";
    text: string;
  }
>;

export type TerminalCommandCompletedEvent = EventEnvelope<
  "terminal.command.completed",
  {
    terminalSessionId: string;
    commandId: string;
    exitCode: number;
    runId?: string;
  }
>;

export type FileOpenedEvent = EventEnvelope<
  "file.opened",
  {
    path: string;
    initiatedBy: ActorRef;
  }
>;

export type PatchProposedEvent = EventEnvelope<
  "patch.proposed",
  {
    artifactId: string;
    runId: string;
    paths: string[];
    summary: string;
  }
>;

export type PatchAppliedEvent = EventEnvelope<
  "patch.applied",
  {
    artifactId: string;
    appliedBy: ActorRef;
  }
>;

export type PatchRejectedEvent = EventEnvelope<
  "patch.rejected",
  {
    artifactId: string;
    rejectedBy: ActorRef;
    reason?: string;
  }
>;

export type ArtifactCreatedEvent = EventEnvelope<
  "artifact.created",
  {
    artifact: Artifact;
  }
>;

export type BoardLaneCreatedEvent = EventEnvelope<
  "board.lane.created",
  {
    lane: KanbanLane;
    boardId: string;
  }
>;

export type BoardLaneUpdatedEvent = EventEnvelope<
  "board.lane.updated",
  {
    lane: KanbanLane;
    boardId: string;
  }
>;

export type BoardCardCreatedEvent = EventEnvelope<
  "board.card.created",
  {
    card: KanbanCard;
    boardId: string;
  }
>;

export type BoardCardUpdatedEvent = EventEnvelope<
  "board.card.updated",
  {
    card: KanbanCard;
    boardId: string;
  }
>;

export type BoardCardMovedEvent = EventEnvelope<
  "board.card.moved",
  {
    boardId: string;
    cardId: string;
    fromLaneId: string;
    toLaneId: string;
  }
>;

export type BoardReplacedEvent = EventEnvelope<
  "board.replaced",
  {
    board: KanbanBoard;
  }
>;

export type PipelineStartedEvent = EventEnvelope<
  "pipeline.started",
  {
    execution: PipelineExecution;
    pipeline: Pipeline;
  }
>;

export type PipelineNodeStartedEvent = EventEnvelope<
  "pipeline.node.started",
  {
    executionId: string;
    nodeId: string;
    agentId?: string;
  }
>;

export type PipelineNodeCompletedEvent = EventEnvelope<
  "pipeline.node.completed",
  {
    executionId: string;
    nodeId: string;
    output: string;
  }
>;

export type PipelineCompletedEvent = EventEnvelope<
  "pipeline.completed",
  {
    executionId: string;
    status: "completed" | "failed" | "canceled";
  }
>;

// ── Conversation loop events ──────────────────────────────

export type ConversationRoundStartedEvent = EventEnvelope<
  "conversation.round.started",
  {
    roundNumber: number;
    respondingAgentIds: string[];
    observingAgentIds: string[];
  }
>;

export type ConversationRoundCompletedEvent = EventEnvelope<
  "conversation.round.completed",
  {
    roundNumber: number;
    responses: Array<{
      agentId: string;
      action: "respond" | "pass" | "satisfied";
      confidence?: number;
    }>;
  }
>;

export type ConversationCompletedEvent = EventEnvelope<
  "conversation.completed",
  {
    totalRounds: number;
    reason: "converged" | "max_rounds" | "user_ended" | "canceled";
    participatingAgentIds: string[];
  }
>;

export type AgentDelegationEvent = EventEnvelope<
  "agent.delegation",
  {
    fromAgentId: string;
    toAgentId: string;
    question: string;
    roundNumber: number;
  }
>;

export type DissentDetectedEvent = EventEnvelope<
  "dissent.detected",
  {
    dissentingAgentId: string;
    agreeingAgentIds: string[];
    topic: string;
    roundNumber: number;
    confidence: number;
  }
>;

export type WorkstreamCreatedEvent = EventEnvelope<
  "workstream.created",
  {
    workstreamId: string;
    agentId: string;
    goal: string;
  }
>;

export type WorkstreamSyncEvent = EventEnvelope<
  "workstream.sync",
  {
    workstreamIds: string[];
    summary: string;
  }
>;

// ── Phase 6: Multi-User collaboration events ─────────────────────────

export type PresenceJoinedEvent = EventEnvelope<
  "presence.joined",
  {
    userId: string;
    threadId: string;
  }
>;

export type PresenceLeftEvent = EventEnvelope<
  "presence.left",
  {
    userId: string;
    threadId: string;
  }
>;

export type PresenceUpdatedEvent = EventEnvelope<
  "presence.updated",
  {
    userId: string;
    threadId: string;
    status: "active" | "idle" | "typing";
  }
>;

export type ConflictDetectedEvent = EventEnvelope<
  "conflict.detected",
  {
    conflictId: string;
    type: "contradictory_instructions" | "file_lock";
    description: string;
    involvedUsers: string[];
    involvedMessages?: string[];
    involvedFiles?: string[];
  }
>;

export type ConflictResolvedEvent = EventEnvelope<
  "conflict.resolved",
  {
    conflictId: string;
    resolvedBy: string;
    resolution: string;
  }
>;

export type MemberInvitedEvent = EventEnvelope<
  "member.invited",
  {
    email: string;
    role: string;
    invitedBy: string;
  }
>;

export type MemberJoinedEvent = EventEnvelope<
  "member.joined",
  {
    userId: string;
    role: string;
  }
>;

export type MemberLeftEvent = EventEnvelope<
  "member.left",
  {
    userId: string;
    reason: "left" | "removed";
  }
>;

export type MemberRoleChangedEvent = EventEnvelope<
  "member.role_changed",
  {
    userId: string;
    oldRole: string;
    newRole: string;
    changedBy: string;
  }
>;

export type AppEvent =
  | AgentDelegationEvent
  | ArtifactCreatedEvent
  | BoardCardCreatedEvent
  | BoardCardMovedEvent
  | BoardCardUpdatedEvent
  | BoardLaneCreatedEvent
  | BoardLaneUpdatedEvent
  | BoardReplacedEvent
  | ConversationCompletedEvent
  | ConversationRoundCompletedEvent
  | ConversationRoundStartedEvent
  | ControllerThinkingEvent
  | DissentDetectedEvent
  | FileOpenedEvent
  | HandoffCreatedEvent
  | PatchAppliedEvent
  | PatchProposedEvent
  | PatchRejectedEvent
  | PipelineCompletedEvent
  | PipelineNodeCompletedEvent
  | PipelineNodeStartedEvent
  | PipelineStartedEvent
  | RunCanceledEvent
  | RunCompletedEvent
  | RunOutputDeltaEvent
  | RunStartedEvent
  | TaskAssignedEvent
  | TaskCreatedEvent
  | TaskStatusChangedEvent
  | TerminalCommandCompletedEvent
  | TerminalCommandStartedEvent
  | TerminalOutputDeltaEvent
  | TerminalSessionOpenedEvent
  | ThreadMessageCreatedEvent
  | WorkstreamCreatedEvent
  | WorkstreamSyncEvent
  | PresenceJoinedEvent
  | PresenceLeftEvent
  | PresenceUpdatedEvent
  | ConflictDetectedEvent
  | ConflictResolvedEvent
  | MemberInvitedEvent
  | MemberJoinedEvent
  | MemberLeftEvent
  | MemberRoleChangedEvent;

type EventSeed<TType extends string, TPayload> = Omit<
  EventEnvelope<TType, TPayload>,
  "ts"
> & {
  ts?: string;
};

export function createEvent<TType extends string, TPayload>(
  seed: EventSeed<TType, TPayload>,
): EventEnvelope<TType, TPayload> {
  return {
    ...seed,
    ts: seed.ts ?? new Date().toISOString(),
  };
}
