import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  type ChildProcess,
  spawn as spawnProcess,
} from "node:child_process";
import {
  spawn as spawnPty,
  type IPty,
} from "node-pty";
import type { AgentDescriptor } from "@nateide/agents";
import { defaultAgentProfiles } from "@nateide/agents";
import {
  createInitialThreadBootstrap,
  type ThreadBootstrap,
} from "@nateide/orchestrator";
import {
  createEvent,
  type ActorRef,
  type AppEvent,
  type KanbanCard,
  type KanbanCardPriority,
  type KanbanFileTag,
  type KanbanLane,
  type Run,
  type RunStatus,
  type Task,
  type TaskStatus,
  type WorkspaceCandidate,
} from "@nateide/protocol";
import type {
  EditorDocumentSnapshot,
  TerminalCommandSnapshot,
  TerminalSessionSnapshot,
} from "@nateide/workspace";
import {
  buildWorkspaceContext,
  listWorkspaceCandidates,
  openWorkspaceDocument,
  resolveWorkspacePath,
} from "./workspace-service";
import {
  chatCompletionWithFallback,
  type AgentRoleConfig,
  type AiApiKeys,
  type AiMessage,
  type ChatCompletionResult,
} from "./ai-client";
import type { TokenUsage } from "@nateide/protocol";
import { soulDocumentToPromptSection, type SoulDocument } from "@nateide/agents";
import {
  runConversationLoop,
  parseAgentResponse,
  parseActionBlocks,
  buildToolUsePrompt,
  detectDissent,
  parseParallelDirectives,
  type AgentDispatchContext,
  type AgentActionBlock,
  type ConversationRound,
  type AgentResponse,
} from "./conversation-loop";
import { MemoryStore } from "./memory-store";

const DEFAULT_USER: ActorRef = { type: "user", id: "nate" };
const MAX_COMMAND_HISTORY = 6;
const MAX_TERMINAL_BUFFER_CHUNKS = 320;
const MAX_TERMINAL_LINES = 120;

type AssignmentPlan = {
  agent: AgentDescriptor;
  deliverable: string;
  goal: string;
  kickoff: string;
  title: string;
};

type SessionListener = (state: ThreadBootstrap, latestEvent?: AppEvent) => void;

type InteractiveTerminalRecord = {
  pty: IPty;
  terminalSessionId: string;
};

function humanList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function summarizeText(value: string, limit = 56): string {
  const trimmed = value.trim().replace(/\s+/g, " ");

  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit - 1)}...`;
}

function getAgentById(agentId: string): AgentDescriptor | undefined {
  return defaultAgentProfiles.find((agent) => agent.id === agentId);
}

const AGENT_ID_TO_ROLE_ID: Record<string, string> = {
  "agent-controller": "planner",
  "agent-codex": "executor",
  "agent-gemini": "reviewer",
  "agent-kimi": "generalist",
};

const TASK_KEYWORDS =
  /\b(build|implement|code|fix|refactor|scaffold|wire|create|add|remove|delete|update|change|modify|move|rename|deploy|install|configure|setup|set up|migrate|upgrade|downgrade|test|debug|review|audit|check|validate|rewrite|polish|redesign|optimize|terminal|daemon|editor|ide|api|kanban|board|card|todo|track|backlog|lane|write|generate|make|run|execute|ship|push|pull|merge|commit|branch)\b/i;

const CASUAL_PATTERN =
  /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|nice|wow|lol|testing|test|ping|pong|haha|yep|nope|sure|yeah|nah|brb|gtg|ty|np|gg|omg|wtf|idk|lmao|hmm|hm|oh|ah|aha|ooh|yay|noo?|mhm|bye|cya|what'?s? up)\b/i;

function isActionableRequest(content: string): boolean {
  const trimmed = content.trim();

  // Task keywords ALWAYS take priority — "hey guys, let's build..." is a task
  if (TASK_KEYWORDS.test(trimmed)) {
    return true;
  }

  // Greetings, one-word casual messages — only casual if no task keywords
  if (CASUAL_PATTERN.test(trimmed)) {
    return false;
  }

  // Very short messages (under ~15 chars) without task keywords are casual
  if (trimmed.length < 15) {
    return false;
  }

  // If it's a question without task keywords, it's conversational
  if (/\?$/.test(trimmed)) {
    return false;
  }

  // Default: if the message is substantial, treat as a task
  return content.length >= 30;
}

function defaultLaneColor(index: number): string {
  return ["#c2853d", "#3f78c7", "#8a50c7", "#2b8a57", "#d14d72"][index % 5] ?? "#c2853d";
}

export class LocalSessionStore {
  private readonly interactiveTerminals = new Map<string, InteractiveTerminalRecord>();
  private readonly listeners = new Set<SessionListener>();
  private readonly runAbortControllers = new Map<string, AbortController>();
  private readonly runningCommands = new Map<string, ChildProcess>();
  private readonly scheduledActions = new Set<ReturnType<typeof setTimeout>>();
  private readonly scanRoots: string[];
  private readonly memoryStore = new MemoryStore();
  private readonly conversationLoopAbortControllers = new Map<string, AbortController>();
  private generation = 0;
  private seq = 0;
  private sessionTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
  private state: ThreadBootstrap | null = null;
  private apiKeys: AiApiKeys = { anthropic: "", google: "", openai: "", openrouter: "" };
  private agentRoles: AgentRoleConfig[] | undefined;
  private soulDocuments: Record<string, SoulDocument> = {};
  private conversationLoopConfig = { maxRounds: 10, enabled: true };

  constructor(
    private readonly workspaceRoot: string,
    scanRoots?: string[],
  ) {
    this.scanRoots = [
      workspaceRoot,
      ...new Set(
        (scanRoots ?? [workspaceRoot, process.env.HOME ?? workspaceRoot]).filter(Boolean),
      ),
    ];
  }

  setApiKeys(keys: { anthropic?: string; openai?: string; google?: string; openrouter?: string }) {
    this.apiKeys = {
      anthropic: keys.anthropic ?? this.apiKeys.anthropic,
      openai: keys.openai ?? this.apiKeys.openai,
      google: keys.google ?? this.apiKeys.google,
      openrouter: keys.openrouter ?? this.apiKeys.openrouter,
    };
  }

  setAgentRoles(roles: AgentRoleConfig[]) {
    this.agentRoles = roles;
  }

  setSoulDocuments(docs: Record<string, SoulDocument>) {
    this.soulDocuments = docs;
  }

  setConversationLoopConfig(config: { maxRounds?: number; enabled?: boolean }) {
    if (config.maxRounds !== undefined) this.conversationLoopConfig.maxRounds = config.maxRounds;
    if (config.enabled !== undefined) this.conversationLoopConfig.enabled = config.enabled;
  }

  getMemoryStore(): MemoryStore {
    return this.memoryStore;
  }

  cancelRun(runId: string) {
    const controller = this.runAbortControllers.get(runId);
    if (controller) {
      controller.abort();
      this.runAbortControllers.delete(runId);
    }

    const state = this.state;
    if (!state) return;

    const run = state.runs.find((r) => r.id === runId);
    if (run && run.status !== "completed" && run.status !== "failed" && run.status !== "canceled") {
      run.status = "canceled";
      run.finishedAt = new Date().toISOString();

      this.appendEvent(
        createEvent({
          id: randomUUID(),
          threadId: state.thread.id,
          seq: this.nextSeq(),
          actor: DEFAULT_USER,
          type: "run.canceled",
          payload: {
            runId,
            canceledBy: DEFAULT_USER,
          },
        }) as AppEvent,
      );

      this.appendEvent(
        createEvent({
          id: randomUUID(),
          threadId: run.threadId,
          seq: this.nextSeq(),
          actor: { type: "agent", id: run.agentId },
          type: "run.completed",
          payload: {
            runId,
            status: "canceled" as const,
            summary: run.summary ?? "Canceled by user.",
            tokenUsage: run.tokenUsage,
          },
        }) as AppEvent,
      );
    }
  }

  cancelAllRuns() {
    const runIds = [...this.runAbortControllers.keys()];
    for (const runId of runIds) {
      this.cancelRun(runId);
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.openWorkspace(this.workspaceRoot);
    } catch (error) {
      console.error("failed to initialize workspace", error);
    }
  }

  getState(): (ThreadBootstrap & { sessionTokenUsage: TokenUsage }) | null {
    if (!this.state) return null;
    return { ...structuredClone(this.state), sessionTokenUsage: { ...this.sessionTokenUsage } };
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async listWorkspaces(): Promise<WorkspaceCandidate[]> {
    return listWorkspaceCandidates(this.scanRoots);
  }

  async openWorkspace(workspacePath: string): Promise<ThreadBootstrap> {
    this.clearAsyncWork();
    this.generation += 1;

    const resolvedPath = await resolveWorkspacePath(workspacePath);
    const { workspace, workspaceSnapshot } = await buildWorkspaceContext(resolvedPath);
    const state = createInitialThreadBootstrap({
      workspace,
      workspaceSnapshot,
      threadTitle: `${workspace.name} orchestration thread`,
    });

    this.state = state;
    this.seq = state.events.at(-1)?.seq ?? 0;
    this.publish();
    return this.getRequiredState();
  }

  async openDocument(filePath: string, initiatedBy: ActorRef = DEFAULT_USER) {
    const state = this.getRequiredState();
    const document = await openWorkspaceDocument(state.workspace.rootPath, filePath);
    const existing = state.workspaceSnapshot.documents.filter(
      (entry) => entry.path !== document.path,
    );

    state.workspaceSnapshot.documents = [document, ...existing].slice(0, MAX_COMMAND_HISTORY);
    state.workspaceSnapshot.openPaths = state.workspaceSnapshot.documents.map(
      (entry) => entry.path,
    );
    state.workspaceSnapshot.activeDocumentPath = document.path;

    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: initiatedBy,
        type: "file.opened",
        payload: {
          path: document.path,
          initiatedBy,
        },
      }) as AppEvent,
    );

    return document;
  }

  getBoard() {
    return structuredClone(this.getRequiredState().board);
  }

  openTerminalSession(
    input: {
      cols?: number;
      cwd?: string;
      shell?: string;
      rows?: number;
    },
    initiatedBy: ActorRef = DEFAULT_USER,
  ) {
    const state = this.getRequiredState();
    const terminalSessionId = "terminal-main";
    const cols = Math.max(40, input.cols ?? 120);
    const rows = Math.max(12, input.rows ?? 32);
    const cwd = input.cwd?.trim() || state.workspace.rootPath;
    const shell = input.shell?.trim() || process.env.SHELL || "bash";
    const current = this.findTerminalSession(terminalSessionId);
    const existing = this.interactiveTerminals.get(terminalSessionId);

    if (existing && current && current.status !== "closed") {
      current.cols = cols;
      current.rows = rows;
      existing.pty.resize(cols, rows);
      this.publish();
      return structuredClone(current);
    }

    if (existing) {
      existing.pty.kill();
      this.interactiveTerminals.delete(terminalSessionId);
    }

    const terminal: TerminalSessionSnapshot = {
      id: terminalSessionId,
      title: path.basename(cwd) || "workspace shell",
      cwd,
      shell,
      status: "running",
      cols,
      rows,
      commands: [],
      buffer: [],
      recentOutput: [],
    };
    const generation = this.generation;
    const pty = spawnPty(shell, ["-i"], {
      cols,
      cwd,
      env: {
        ...process.env,
        COLORTERM: "truecolor",
        TERM: "xterm-256color",
      },
      name: "xterm-256color",
      rows,
    });

    this.interactiveTerminals.set(terminalSessionId, {
      pty,
      terminalSessionId,
    });
    state.workspaceSnapshot.terminals = [
      terminal,
      ...state.workspaceSnapshot.terminals.filter((entry) => entry.id !== terminalSessionId),
    ];

    pty.onData((data) => {
      if (generation !== this.generation || !this.state) {
        return;
      }

      const activeTerminal = this.findTerminalSession(terminalSessionId);

      if (!activeTerminal) {
        return;
      }

      activeTerminal.status = "running";
      this.pushTerminalBuffer(activeTerminal, data);
      this.pushTerminalOutput(activeTerminal, data);
      this.publish();
    });
    pty.onExit(({ exitCode }) => {
      if (generation !== this.generation || !this.state) {
        return;
      }

      this.interactiveTerminals.delete(terminalSessionId);
      const activeTerminal = this.findTerminalSession(terminalSessionId);

      if (!activeTerminal) {
        return;
      }

      activeTerminal.status = "closed";
      activeTerminal.lastExitCode = exitCode;
      this.publish();
    });

    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: initiatedBy,
        type: "terminal.session.opened",
        payload: {
          terminalSessionId,
          cwd,
          initiatedBy,
        },
      }) as AppEvent,
    );

    return structuredClone(terminal);
  }

  writeTerminalInput(terminalSessionId: string, data: string) {
    const record = this.interactiveTerminals.get(terminalSessionId);

    if (!record) {
      throw new Error("Interactive terminal is not running.");
    }

    if (!data) {
      return this.getRequiredState();
    }

    record.pty.write(data);
    return this.getRequiredState();
  }

  resizeTerminalSession(terminalSessionId: string, cols: number, rows: number) {
    const record = this.interactiveTerminals.get(terminalSessionId);
    const terminal = this.findTerminalSession(terminalSessionId);

    if (!record || !terminal) {
      throw new Error("Interactive terminal is not running.");
    }

    terminal.cols = Math.max(40, cols);
    terminal.rows = Math.max(12, rows);
    record.pty.resize(terminal.cols, terminal.rows);
    this.publish();
    return structuredClone(terminal);
  }

  createBoardLane(input: { name: string; color?: string }, createdBy: ActorRef = DEFAULT_USER) {
    const state = this.getRequiredState();
    const name = input.name.trim();

    if (!name) {
      throw new Error("Lane name is required.");
    }

    const lane: KanbanLane = {
      id: `lane-${randomUUID()}`,
      name,
      color: input.color?.trim() || defaultLaneColor(state.board.lanes.length),
    };

    state.board.lanes = [...state.board.lanes, lane];
    state.board.updatedAt = new Date().toISOString();
    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: createdBy,
        type: "board.lane.created",
        payload: {
          boardId: state.board.id,
          lane,
        },
      }) as AppEvent,
    );

    return this.getBoard();
  }

  updateBoardLane(
    laneId: string,
    input: { color?: string; name?: string },
    updatedBy: ActorRef = DEFAULT_USER,
  ) {
    const state = this.getRequiredState();
    const lane = state.board.lanes.find((entry) => entry.id === laneId);

    if (!lane) {
      throw new Error("Lane not found.");
    }

    lane.name = input.name?.trim() || lane.name;
    lane.color = input.color?.trim() || lane.color;
    state.board.updatedAt = new Date().toISOString();
    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: updatedBy,
        type: "board.lane.updated",
        payload: {
          boardId: state.board.id,
          lane: { ...lane },
        },
      }) as AppEvent,
    );

    return this.getBoard();
  }

  createBoardCard(
    input: {
      assignedAgentId?: string;
      description?: string;
      fileTags?: KanbanFileTag[];
      laneId?: string;
      priority?: KanbanCardPriority;
      title: string;
    },
    createdBy: ActorRef = DEFAULT_USER,
  ) {
    const state = this.getRequiredState();
    const title = input.title.trim();

    if (!title) {
      throw new Error("Card title is required.");
    }

    const card: KanbanCard = {
      id: `card-${randomUUID()}`,
      laneId: input.laneId ?? this.getDefaultLaneId(),
      title,
      description: input.description?.trim() ?? "",
      priority: input.priority ?? "medium",
      fileTags: input.fileTags ?? this.inferBoardFileTags(),
      assignedAgentId: input.assignedAgentId,
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    state.board.cards = [card, ...state.board.cards];
    state.board.updatedAt = card.updatedAt;
    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: createdBy,
        type: "board.card.created",
        payload: {
          boardId: state.board.id,
          card,
        },
      }) as AppEvent,
    );

    return this.getBoard();
  }

  updateBoardCard(
    cardId: string,
    input: {
      assignedAgentId?: string;
      description?: string;
      fileTags?: KanbanFileTag[];
      laneId?: string;
      priority?: KanbanCardPriority;
      title?: string;
    },
    updatedBy: ActorRef = DEFAULT_USER,
  ) {
    const state = this.getRequiredState();
    const card = state.board.cards.find((entry) => entry.id === cardId);

    if (!card) {
      throw new Error("Card not found.");
    }

    const previousLaneId = card.laneId;
    card.title = input.title?.trim() || card.title;
    card.description = input.description?.trim() ?? card.description;
    card.priority = input.priority ?? card.priority;
    card.fileTags = input.fileTags ?? card.fileTags;
    card.assignedAgentId = input.assignedAgentId ?? card.assignedAgentId;
    card.laneId = input.laneId ?? card.laneId;
    card.updatedAt = new Date().toISOString();
    state.board.updatedAt = card.updatedAt;

    if (previousLaneId !== card.laneId) {
      this.appendEvent(
        createEvent({
          id: randomUUID(),
          threadId: state.thread.id,
          seq: this.nextSeq(),
          actor: updatedBy,
          type: "board.card.moved",
          payload: {
            boardId: state.board.id,
            cardId: card.id,
            fromLaneId: previousLaneId,
            toLaneId: card.laneId,
          },
        }) as AppEvent,
      );
    }

    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: updatedBy,
        type: "board.card.updated",
        payload: {
          boardId: state.board.id,
          card: { ...card },
        },
      }) as AppEvent,
    );

    return this.getBoard();
  }

  async appendUserMessage(
    content: string,
    requestedAgentIds: string[] = [],
  ): Promise<ThreadBootstrap> {
    const state = this.getRequiredState();
    const trimmed = content.trim();

    if (!trimmed) {
      throw new Error("Message content is required.");
    }

    const generation = this.generation;

    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: DEFAULT_USER,
        type: "thread.message.created",
        payload: {
          messageId: randomUUID(),
          content: trimmed,
          format: "plain",
        },
      }) as AppEvent,
    );

    // Parse @mentions from content
    const mentionMatches = trimmed.match(/@([\w-]+)/g) ?? [];
    const mentionedAgentIds: string[] = [];
    for (const mention of mentionMatches) {
      const name = mention.slice(1).toLowerCase();
      // Match against agent profiles and role configs
      const agent = defaultAgentProfiles.find(
        (a) => a.name.toLowerCase() === name || a.id.toLowerCase() === `agent-${name}` || a.role.toLowerCase() === name,
      );
      if (agent && agent.id !== "agent-controller") {
        mentionedAgentIds.push(agent.id);
      }
    }

    // If the user explicitly requested agents, always dispatch to them.
    // Otherwise, decide whether this is an actionable task or just conversation.
    const allRequestedIds = [...new Set([...requestedAgentIds, ...mentionedAgentIds])];
    const requestedAgents = allRequestedIds
      .map((agentId) => getAgentById(agentId))
      .filter((agent): agent is AgentDescriptor => Boolean(agent && agent.id !== "agent-controller"));

    const isTask = requestedAgents.length > 0 || isActionableRequest(trimmed);

    if (!isTask) {
      // Casual conversation — reply with the cheapest model (Gemini) directly, no orchestration.
      this.dispatchQuickReply(generation, trimmed);
      return this.getRequiredState();
    }

    const controllerTask = this.createTask({
      assigneeAgentId: "agent-controller",
      createdBy: DEFAULT_USER,
      fileScope: [],
      goal: `Interpret and route the request: ${trimmed}`,
      terminalScope: [],
      title: `Route request: ${summarizeText(trimmed)}`,
    });

    this.setTaskStatus(controllerTask.id, "in_progress", "Controller is routing the request.");

    const controllerRun = this.startRun(
      controllerTask.id,
      "agent-controller",
      "starting",
      "Reading the request and deciding which agents should engage.",
    );
    const { assignments, thinkingAgents, keywordsMatched } = this.planAssignmentsWithMetadata(trimmed, requestedAgents);
    const shouldCreateBoardCards = /(kanban|board|card|todo|track|backlog|lane)/i.test(trimmed);
    const routingLabel = humanList(assignments.map((assignment) => assignment.agent.name));
    const routingReason = requestedAgents.length > 0 ? "as requested" : "based on the request";

    // Emit controller thinking event
    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: { type: "agent", id: "agent-controller" },
        type: "controller.thinking",
        payload: {
          isActionable: true,
          keywordsMatched,
          agents: thinkingAgents,
          decision: `Routing to ${routingLabel} ${routingReason}.`,
        },
      }) as AppEvent,
    );

    this.setRunSummary(
      controllerRun.id,
      `Routing to ${routingLabel} ${routingReason}.`,
      "streaming",
    );
    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: { type: "agent", id: "agent-controller" },
        type: "thread.message.created",
        payload: {
          messageId: randomUUID(),
          content: `Routing this request to ${routingLabel} ${routingReason}.`,
          format: "plain",
        },
      }) as AppEvent,
    );

    this.setRunSummary(
      controllerRun.id,
      `Controller completed routing to ${routingLabel}.`,
      "completed",
    );
    this.completeRun(controllerRun.id, "completed");
    this.setTaskStatus(controllerTask.id, "completed", "Routing complete.");

    // Fire off each agent assignment concurrently
    for (const assignment of assignments) {
      if (shouldCreateBoardCards) {
        this.createBoardCard(
          {
            assignedAgentId: assignment.agent.id,
            description: assignment.goal,
            priority: assignment.agent.role === "reviewer" ? "medium" : "high",
            title: assignment.title,
          },
          { type: "agent", id: assignment.agent.id },
        );
      }
    }

    // If conversation loop is enabled, include ALL non-controller agents in round 1.
    // The keyword-matched agents have focused goals; others join as collaborators.
    if (this.conversationLoopConfig.enabled && assignments.length > 0) {
      const assignedIds = new Set(assignments.map((a) => a.agent.id));
      for (const agent of defaultAgentProfiles) {
        if (agent.id === "agent-controller") continue;
        if (assignedIds.has(agent.id)) continue;
        assignments.push(this.assignmentForAgent(agent, trimmed));
      }
      this.dispatchConversationLoop(generation, controllerTask.id, assignments, trimmed);
    } else {
      // Legacy dispatch: fire off each agent independently
      for (const assignment of assignments) {
        this.dispatchAgentCompletion(generation, controllerTask.id, assignment);
      }
    }

    return this.getRequiredState();
  }

  private dispatchAgentCompletion(
    generation: number,
    sourceTaskId: string,
    assignment: AssignmentPlan,
  ) {
    const state = this.getRequiredState();
    const agentRef: ActorRef = { type: "agent", id: assignment.agent.id };

    const task = this.createTask({
      assigneeAgentId: assignment.agent.id,
      createdBy: { type: "agent", id: "agent-controller" },
      fileScope: [],
      goal: assignment.goal,
      terminalScope: assignment.agent.canRunCommands ? ["workspace shell"] : [],
      title: assignment.title,
    });

    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: { type: "agent", id: "agent-controller" },
        type: "handoff.created",
        payload: {
          fromAgentId: "agent-controller",
          toAgentId: assignment.agent.id,
          sourceTaskId,
          newTaskId: task.id,
          goal: assignment.goal,
          inputs: [assignment.deliverable],
          deliverable: assignment.deliverable,
        },
      }) as AppEvent,
    );

    this.setTaskStatus(task.id, "in_progress", `${assignment.agent.name} accepted the task.`);
    const run = this.startRun(
      task.id,
      assignment.agent.id,
      "streaming",
      `${assignment.agent.name} is working...`,
    );

    // Set up abort controller for cancellation
    const abortController = new AbortController();
    this.runAbortControllers.set(run.id, abortController);

    // Build conversation history from thread events for context
    const threadMessages = this.buildThreadMessages();
    const systemPrompt = this.buildAgentSystemPrompt(assignment.agent);

    // Build fallback chain from role config
    const roleId = AGENT_ID_TO_ROLE_ID[assignment.agent.id];
    const roleConfig = roleId ? this.agentRoles?.find((r) => r.id === roleId) : undefined;
    const fallbacks = roleConfig?.fallbackProviders;

    // Call the real LLM with fallback support
    chatCompletionWithFallback(
      assignment.agent.id,
      systemPrompt,
      threadMessages,
      this.apiKeys,
      (chunk) => {
        if (generation !== this.generation || !this.state) {
          return;
        }

        if (chunk.type === "text_delta" && chunk.text) {
          this.appendEvent(
            createEvent({
              id: randomUUID(),
              threadId: state.thread.id,
              seq: this.nextSeq(),
              actor: agentRef,
              type: "run.output.delta",
              payload: {
                runId: run.id,
                channel: "message",
                text: chunk.text,
              },
            }) as AppEvent,
          );
        }
      },
      this.agentRoles,
      abortController.signal,
      fallbacks,
      (from, to, error) => {
        if (generation !== this.generation || !this.state) return;
        this.appendEvent(
          createEvent({
            id: randomUUID(),
            threadId: state.thread.id,
            seq: this.nextSeq(),
            actor: agentRef,
            type: "run.output.delta",
            payload: {
              runId: run.id,
              channel: "debug",
              text: `Switched from ${from} to ${to} (${error.slice(0, 80)})`,
            },
          }) as AppEvent,
        );
      },
    )
      .then((result) => {
        this.runAbortControllers.delete(run.id);
        if (generation !== this.generation || !this.state) {
          return;
        }

        // Update token usage
        run.tokenUsage = result.usage;
        this.sessionTokenUsage.inputTokens += result.usage.inputTokens;
        this.sessionTokenUsage.outputTokens += result.usage.outputTokens;
        this.sessionTokenUsage.totalTokens += result.usage.totalTokens;
        this.sessionTokenUsage.estimatedCostUsd = (this.sessionTokenUsage.estimatedCostUsd ?? 0) + (result.usage.estimatedCostUsd ?? 0);

        this.appendEvent(
          createEvent({
            id: randomUUID(),
            threadId: state.thread.id,
            seq: this.nextSeq(),
            actor: agentRef,
            type: "thread.message.created",
            payload: {
              messageId: randomUUID(),
              content: result.text,
              format: "plain",
            },
          }) as AppEvent,
        );

        this.setRunSummary(run.id, summarizeText(result.text, 120), "completed");
        this.completeRun(run.id, "completed");
        this.setTaskStatus(task.id, "completed", `${assignment.agent.name} delivered.`);
      })
      .catch((error) => {
        this.runAbortControllers.delete(run.id);
        if (generation !== this.generation || !this.state) {
          return;
        }

        // If aborted, don't treat as failure — cancelRun already handled it
        if (abortController.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : "Unknown error";

        this.appendEvent(
          createEvent({
            id: randomUUID(),
            threadId: state.thread.id,
            seq: this.nextSeq(),
            actor: agentRef,
            type: "thread.message.created",
            payload: {
              messageId: randomUUID(),
              content: `Error: ${message}`,
              format: "plain",
            },
          }) as AppEvent,
        );

        this.setRunSummary(run.id, `Failed: ${message}`, "failed");
        this.completeRun(run.id, "failed");
        this.setTaskStatus(task.id, "failed", message);
      });
  }

  private dispatchQuickReply(generation: number, content: string) {
    const state = this.getRequiredState();
    const agentId = "quick-reply";
    const agentRef: ActorRef = { type: "agent", id: "agent-gemini" };
    const quickRunId = `quick-${generation}`;

    const abortController = new AbortController();
    this.runAbortControllers.set(quickRunId, abortController);

    const threadMessages = this.buildThreadMessages();
    const systemPrompt = [
      `You are a helpful assistant in a multi-agent orchestration IDE called "nateide".`,
      `The user is chatting casually — this is not a task. Be friendly, concise, and conversational.`,
      `Workspace: "${state.workspace.name}" at ${state.workspace.rootPath}.`,
    ].join("\n");

    chatCompletionWithFallback(agentId, systemPrompt, threadMessages, this.apiKeys, (chunk) => {
      if (generation !== this.generation || !this.state) {
        return;
      }

      if (chunk.type === "text_delta" && chunk.text) {
        this.appendEvent(
          createEvent({
            id: randomUUID(),
            threadId: state.thread.id,
            seq: this.nextSeq(),
            actor: agentRef,
            type: "run.output.delta",
            payload: {
              runId: quickRunId,
              channel: "message",
              text: chunk.text,
            },
          }) as AppEvent,
        );
      }
    }, this.agentRoles, abortController.signal)
      .then((result) => {
        this.runAbortControllers.delete(quickRunId);
        if (generation !== this.generation || !this.state) {
          return;
        }

        // Track token usage for quick reply
        this.sessionTokenUsage.inputTokens += result.usage.inputTokens;
        this.sessionTokenUsage.outputTokens += result.usage.outputTokens;
        this.sessionTokenUsage.totalTokens += result.usage.totalTokens;
        this.sessionTokenUsage.estimatedCostUsd = (this.sessionTokenUsage.estimatedCostUsd ?? 0) + (result.usage.estimatedCostUsd ?? 0);

        this.appendEvent(
          createEvent({
            id: randomUUID(),
            threadId: state.thread.id,
            seq: this.nextSeq(),
            actor: agentRef,
            type: "thread.message.created",
            payload: {
              messageId: randomUUID(),
              content: result.text,
              format: "plain",
            },
          }) as AppEvent,
        );
      })
      .catch((error) => {
        this.runAbortControllers.delete(quickRunId);
        if (generation !== this.generation || !this.state) {
          return;
        }

        if (abortController.signal.aborted) return;

        const message = error instanceof Error ? error.message : "Unknown error";

        this.appendEvent(
          createEvent({
            id: randomUUID(),
            threadId: state.thread.id,
            seq: this.nextSeq(),
            actor: agentRef,
            type: "thread.message.created",
            payload: {
              messageId: randomUUID(),
              content: `Error: ${message}`,
              format: "plain",
            },
          }) as AppEvent,
        );
      });
  }

  private buildThreadMessages(): AiMessage[] {
    const state = this.getRequiredState();
    const messages: AiMessage[] = [];

    for (const event of state.events) {
      if (event.type !== "thread.message.created") {
        continue;
      }

      const payload = event.payload as { content?: string };

      if (!payload.content) {
        continue;
      }

      const role = event.actor.type === "user" ? "user" : "assistant";
      messages.push({ role, content: payload.content });
    }

    return messages;
  }

  private buildAgentSystemPrompt(agent: AgentDescriptor, sharedMemory?: string): string {
    const state = this.getRequiredState();
    const workspaceName = state.workspace.name;
    const rootPath = state.workspace.rootPath;

    // Look up custom system prompt from role config
    const roleId = AGENT_ID_TO_ROLE_ID[agent.id];
    const roleConfig = roleId ? this.agentRoles?.find((r) => r.id === roleId) : undefined;
    const customPrompt = roleConfig?.systemPrompt;

    const base = customPrompt
      ? `${customPrompt}\nYou are ${agent.name}.`
      : [
          `You are ${agent.name}, a specialized AI agent in a multi-agent orchestration IDE.`,
          `Your role: ${agent.role}. Your specialty: ${agent.specialty}.`,
        ].join("\n");

    const sections: string[] = [
      base,
      `You are working in the "${workspaceName}" workspace at ${rootPath}.`,
    ];

    // Inject soul document if available
    const soul = this.soulDocuments[agent.id];
    if (soul) {
      sections.push("", "# Soul Document", soulDocumentToPromptSection(soul));
    }

    // Inject shared memory if available
    if (sharedMemory) {
      sections.push("", sharedMemory);
    }

    // Add tool-use instructions for capable agents
    const toolPrompt = buildToolUsePrompt(agent.canEditFiles, agent.canRunCommands);
    if (toolPrompt) {
      sections.push(toolPrompt);
    }

    sections.push(
      "Be concise and action-oriented. Respond directly to the user's request.",
      "When asked to implement something, actually DO it using action blocks — don't just describe what you would do.",
    );

    return sections.filter(Boolean).join("\n");
  }

  endConversationLoop() {
    for (const [id, controller] of this.conversationLoopAbortControllers) {
      controller.abort();
      this.conversationLoopAbortControllers.delete(id);
    }
  }

  clearThread() {
    const state = this.getRequiredState();
    // Clear events, tasks, runs — but keep workspace, board, memory
    this.cancelAllRuns();
    this.endConversationLoop();
    this.generation += 1;

    state.events = [];
    state.tasks = [];
    state.runs = [];
    state.thread.status = "idle";
    state.thread.updatedAt = new Date().toISOString();
    this.seq = 0;
    this.sessionTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
    this.publish();
  }

  async handleFeedback(agentId: string, type: "positive" | "negative", content: string) {
    const soul = this.soulDocuments[agentId];
    if (!soul) return;

    const pref = type === "positive"
      ? `User liked: ${content}`
      : `User disliked: ${content}`;

    soul.learnedPreferences.push(pref);
    // The caller (index.ts) should also persist this via settingsStore.update()
  }

  private dispatchConversationLoop(
    generation: number,
    controllerTaskId: string,
    assignments: AssignmentPlan[],
    userContent: string,
  ) {
    const state = this.getRequiredState();
    const loopId = `loop-${generation}`;
    const abortController = new AbortController();
    this.conversationLoopAbortControllers.set(loopId, abortController);

    // Fetch shared memory for prompt injection
    const workspaceId = state.workspace.id;
    this.memoryStore.summarizeForPrompt(workspaceId).then((sharedMemory) => {
      // Helper to build a dispatch context for any agent
      const buildContextForAgent = (agent: AgentDescriptor): AgentDispatchContext => {
        const roleId = AGENT_ID_TO_ROLE_ID[agent.id];
        const roleConfig = roleId ? this.agentRoles?.find((r) => r.id === roleId) : undefined;
        const fallbacks = roleConfig?.fallbackProviders;

        const task = this.createTask({
          assigneeAgentId: agent.id,
          createdBy: { type: "agent", id: "agent-controller" },
          fileScope: [],
          goal: `Contribute to the conversation about: ${userContent.slice(0, 100)}`,
          terminalScope: agent.canRunCommands ? ["workspace shell"] : [],
          title: `${agent.name}: ${summarizeText(userContent)}`,
        });

        this.appendEvent(
          createEvent({
            id: randomUUID(),
            threadId: state.thread.id,
            seq: this.nextSeq(),
            actor: { type: "agent", id: "agent-controller" },
            type: "handoff.created",
            payload: {
              fromAgentId: "agent-controller",
              toAgentId: agent.id,
              sourceTaskId: controllerTaskId,
              newTaskId: task.id,
              goal: `Contribute to the conversation`,
              inputs: [],
              deliverable: `${agent.name}'s contribution`,
            },
          }) as AppEvent,
        );

        this.setTaskStatus(task.id, "in_progress", `${agent.name} accepted the task.`);
        const run = this.startRun(task.id, agent.id, "streaming", `${agent.name} is working...`);
        this.runAbortControllers.set(run.id, new AbortController());

        return {
          agent,
          systemPrompt: this.buildAgentSystemPrompt(agent, sharedMemory),
          runId: run.id,
          taskId: task.id,
          roles: this.agentRoles,
          fallbacks,
        };
      };

      // Build dispatch contexts for initially assigned agents
      const contexts: AgentDispatchContext[] = assignments.map((assignment) => {
        const roleId = AGENT_ID_TO_ROLE_ID[assignment.agent.id];
        const roleConfig = roleId ? this.agentRoles?.find((r) => r.id === roleId) : undefined;
        const fallbacks = roleConfig?.fallbackProviders;

        const task = this.createTask({
          assigneeAgentId: assignment.agent.id,
          createdBy: { type: "agent", id: "agent-controller" },
          fileScope: [],
          goal: assignment.goal,
          terminalScope: assignment.agent.canRunCommands ? ["workspace shell"] : [],
          title: assignment.title,
        });

        this.appendEvent(
          createEvent({
            id: randomUUID(),
            threadId: state.thread.id,
            seq: this.nextSeq(),
            actor: { type: "agent", id: "agent-controller" },
            type: "handoff.created",
            payload: {
              fromAgentId: "agent-controller",
              toAgentId: assignment.agent.id,
              sourceTaskId: controllerTaskId,
              newTaskId: task.id,
              goal: assignment.goal,
              inputs: [assignment.deliverable],
              deliverable: assignment.deliverable,
            },
          }) as AppEvent,
        );

        this.setTaskStatus(task.id, "in_progress", `${assignment.agent.name} accepted the task.`);
        const run = this.startRun(task.id, assignment.agent.id, "streaming", `${assignment.agent.name} is working...`);
        this.runAbortControllers.set(run.id, new AbortController());

        return {
          agent: assignment.agent,
          systemPrompt: this.buildAgentSystemPrompt(assignment.agent, sharedMemory),
          runId: run.id,
          taskId: task.id,
          roles: this.agentRoles,
          fallbacks,
        };
      });

      // Build available agents map — all contexts are built eagerly since all
      // non-controller agents are included in initial assignments.
      const availableAgents = new Map<string, AgentDispatchContext>();
      for (const ctx of contexts) {
        availableAgents.set(ctx.agent.id, ctx);
      }

      const userMessages: AiMessage[] = this.buildThreadMessages();

      runConversationLoop(
        contexts,
        availableAgents,
        userMessages,
        this.apiKeys,
        {
          maxRounds: this.conversationLoopConfig.maxRounds,
          generation,
          signal: abortController.signal,
        },
        {
          onRoundStarted: (round, agentIds) => {
            if (generation !== this.generation || !this.state) return;
            const observing = [...availableAgents.values()]
              .filter((c) => !agentIds.includes(c.agent.id))
              .map((c) => c.agent.id);
            this.appendEvent(
              createEvent({
                id: randomUUID(),
                threadId: state.thread.id,
                seq: this.nextSeq(),
                actor: { type: "system", id: "orchestrator" },
                type: "conversation.round.started",
                payload: {
                  roundNumber: round,
                  respondingAgentIds: agentIds,
                  observingAgentIds: observing,
                },
              }) as AppEvent,
            );
          },
          onAgentResponse: (agentId, response) => {
            if (generation !== this.generation || !this.state) return;
            const agentRef: ActorRef = { type: "agent", id: agentId };

            // Track token usage
            this.sessionTokenUsage.inputTokens += response.usage.inputTokens;
            this.sessionTokenUsage.outputTokens += response.usage.outputTokens;
            this.sessionTokenUsage.totalTokens += response.usage.totalTokens;
            this.sessionTokenUsage.estimatedCostUsd = (this.sessionTokenUsage.estimatedCostUsd ?? 0) + (response.usage.estimatedCostUsd ?? 0);

            // Find the run and update its token usage
            const ctx = availableAgents.get(agentId);
            if (ctx) {
              const run = state.runs.find((r) => r.id === ctx.runId);
              if (run) {
                run.tokenUsage = run.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
                run.tokenUsage.inputTokens += response.usage.inputTokens;
                run.tokenUsage.outputTokens += response.usage.outputTokens;
                run.tokenUsage.totalTokens += response.usage.totalTokens;
                run.tokenUsage.estimatedCostUsd = (run.tokenUsage.estimatedCostUsd ?? 0) + (response.usage.estimatedCostUsd ?? 0);
              }
            }

            if (response.action === "respond" && response.text) {
              this.appendEvent(
                createEvent({
                  id: randomUUID(),
                  threadId: state.thread.id,
                  seq: this.nextSeq(),
                  actor: agentRef,
                  type: "thread.message.created",
                  payload: {
                    messageId: randomUUID(),
                    content: response.text,
                    format: "plain",
                  },
                }) as AppEvent,
              );
            }
          },
          onRoundCompleted: (round) => {
            if (generation !== this.generation || !this.state) return;

            const responses = [...round.responses.entries()].map(([agentId, r]) => ({
              agentId,
              action: r.action,
              confidence: r.confidence,
            }));

            this.appendEvent(
              createEvent({
                id: randomUUID(),
                threadId: state.thread.id,
                seq: this.nextSeq(),
                actor: { type: "system", id: "orchestrator" },
                type: "conversation.round.completed",
                payload: {
                  roundNumber: round.roundNumber,
                  responses,
                },
              }) as AppEvent,
            );

            // Check for dissent
            const dissent = detectDissent(round.responses);
            if (dissent) {
              this.appendEvent(
                createEvent({
                  id: randomUUID(),
                  threadId: state.thread.id,
                  seq: this.nextSeq(),
                  actor: { type: "system", id: "orchestrator" },
                  type: "dissent.detected",
                  payload: {
                    dissentingAgentId: dissent.dissentingAgentId,
                    agreeingAgentIds: dissent.agreeingAgentIds,
                    topic: dissent.topic,
                    roundNumber: round.roundNumber,
                    confidence: dissent.confidence,
                  },
                }) as AppEvent,
              );
            }
          },
          onLoopCompleted: (rounds, reason) => {
            if (generation !== this.generation || !this.state) return;
            this.conversationLoopAbortControllers.delete(loopId);

            const participatingAgentIds = [...new Set(
              rounds.flatMap((r) => [...r.responses.keys()]),
            )];

            this.appendEvent(
              createEvent({
                id: randomUUID(),
                threadId: state.thread.id,
                seq: this.nextSeq(),
                actor: { type: "system", id: "orchestrator" },
                type: "conversation.completed",
                payload: {
                  totalRounds: rounds.length,
                  reason,
                  participatingAgentIds,
                },
              }) as AppEvent,
            );

            // Complete all runs and tasks for ALL agents that participated
            const allParticipatingContexts = [...availableAgents.values()].filter(
              (ctx) => participatingAgentIds.includes(ctx.agent.id),
            );
            for (const ctx of allParticipatingContexts) {
              this.runAbortControllers.delete(ctx.runId);
              this.setRunSummary(ctx.runId, `Completed after ${rounds.length} rounds.`, "completed");
              this.completeRun(ctx.runId, "completed");
              this.setTaskStatus(ctx.taskId, "completed", `${ctx.agent.name} finished.`);
            }

            // Extract memories from the conversation
            this.extractMemories(workspaceId, rounds, allParticipatingContexts);
          },
          onDelegation: (from, to, question) => {
            if (generation !== this.generation || !this.state) return;
            this.appendEvent(
              createEvent({
                id: randomUUID(),
                threadId: state.thread.id,
                seq: this.nextSeq(),
                actor: { type: "agent", id: from },
                type: "agent.delegation",
                payload: {
                  fromAgentId: from,
                  toAgentId: to,
                  question,
                  roundNumber: 0, // Will be filled by context
                },
              }) as AppEvent,
            );
          },
          onChunk: (agentId, runId, text) => {
            if (generation !== this.generation || !this.state) return;
            this.appendEvent(
              createEvent({
                id: randomUUID(),
                threadId: state.thread.id,
                seq: this.nextSeq(),
                actor: { type: "agent", id: agentId },
                type: "run.output.delta",
                payload: {
                  runId,
                  channel: "message",
                  text,
                },
              }) as AppEvent,
            );
          },
        },
        // Agent dispatch function with action execution loop
        async (ctx, messages, apiKeys, onChunk, signal) => {
          const MAX_ACTION_ITERATIONS = 8;
          const workspaceRoot = state.workspace.rootPath;
          let currentMessages = [...messages];
          let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          let finalText = "";

          for (let iter = 0; iter < MAX_ACTION_ITERATIONS; iter++) {
            if (signal.aborted) break;

            // On intermediate iterations, buffer the response instead of streaming
            // On last possible iteration or when no actions found, stream normally
            let bufferedText = "";
            const isFirstIter = iter === 0;

            const result = await chatCompletionWithFallback(
              ctx.agent.id,
              ctx.systemPrompt,
              currentMessages,
              apiKeys,
              (chunk) => {
                if (chunk.type === "text_delta" && chunk.text) {
                  bufferedText += chunk.text;
                  // Stream the first iteration so user sees something happening
                  // For subsequent iterations, we buffer and only show status
                  if (isFirstIter) {
                    onChunk(chunk.text);
                  }
                }
              },
              ctx.roles,
              signal,
              ctx.fallbacks,
            );

            totalUsage.inputTokens += result.usage.inputTokens;
            totalUsage.outputTokens += result.usage.outputTokens;
            totalUsage.totalTokens += result.usage.totalTokens;
            totalUsage.estimatedCostUsd = (totalUsage.estimatedCostUsd ?? 0) + (result.usage.estimatedCostUsd ?? 0);

            // Check for action blocks
            const { actions, cleanText } = parseActionBlocks(result.text);

            if (actions.length === 0) {
              // No actions — this is the final response
              finalText = result.text;
              // If this wasn't the first iteration, stream the final clean text
              if (!isFirstIter) {
                onChunk("\n\n" + cleanText);
              }
              break;
            }

            // Execute actions and collect results
            const actionResults: string[] = [];
            for (const action of actions) {
              if (signal.aborted) break;

              // Emit action execution status so user can see what's happening
              const actionLabel = action.type === "run_command"
                ? `\`${action.command}\``
                : action.type === "read_file"
                ? `Reading \`${action.path}\``
                : `Writing \`${action.path}\``;
              onChunk(`\n\n> ${actionLabel}\n`);

              const actionResult = await this.executeAgentAction(action, ctx.agent.id, workspaceRoot);
              actionResults.push(actionResult);
            }

            // Feed results back to the agent
            currentMessages = [
              ...currentMessages,
              { role: "assistant" as const, content: result.text },
              { role: "user" as const, content: `[ACTION RESULTS]\n${actionResults.join("\n\n")}\n[/ACTION RESULTS]\n\nContinue with more actions or provide your final response.` },
            ];

            // The clean text from this iteration becomes part of the display
            finalText = cleanText;
          }

          // If agent only produced action blocks with no final commentary, provide a summary
          if (!finalText.trim()) {
            finalText = "[RESPOND] Done. Actions executed successfully.";
          }

          return { text: finalText, usage: totalUsage };
        },
      ).catch((error) => {
        if (generation !== this.generation || !this.state) return;
        console.error("[conversation-loop] error:", error);
        this.conversationLoopAbortControllers.delete(loopId);
      });
    }).catch((error) => {
      // Memory fetch failed — fall back to legacy dispatch
      console.error("[memory] failed to load shared memory:", error);
      for (const assignment of assignments) {
        this.dispatchAgentCompletion(generation, controllerTaskId, assignment);
      }
    });
  }

  private async extractMemories(
    workspaceId: string,
    rounds: ConversationRound[],
    contexts: AgentDispatchContext[],
  ) {
    // Build a summary of the conversation for memory extraction
    const lines: string[] = [];
    for (const round of rounds) {
      for (const [agentId, resp] of round.responses) {
        if (resp.action === "respond" && resp.text) {
          const ctx = contexts.find((c) => c.agent.id === agentId);
          lines.push(`[${ctx?.agent.name ?? agentId}]: ${resp.text}`);
        }
      }
    }

    if (lines.length === 0) return;

    // Use the memory agent to extract key points
    const memoryRole = this.agentRoles?.find((r) => r.id === "memory");
    if (!memoryRole) {
      // No memory agent configured — skip extraction
      return;
    }

    try {
      const result = await chatCompletionWithFallback(
        "quick-reply", // Use quick-reply agent ID for routing to cheap model
        memoryRole.systemPrompt,
        [{ role: "user", content: `Extract memories from this conversation:\n\n${lines.join("\n")}` }],
        this.apiKeys,
        () => {}, // No streaming needed
        [{ ...memoryRole, id: "memory-extraction", triggerKeywords: [], isQuickReply: false }],
      );

      // Parse the memory agent's response as JSON
      try {
        const memories = JSON.parse(result.text) as Array<{ type: string; content: string }>;
        for (const mem of memories) {
          if (mem.type && mem.content) {
            await this.memoryStore.append(workspaceId, {
              workspaceId,
              type: mem.type as "decision" | "pattern" | "preference" | "lesson",
              content: mem.content,
              createdBy: "memory-agent",
              sessionId: this.state?.thread.id ?? "",
            });
          }
        }
      } catch {
        // Memory agent didn't return valid JSON — store the raw text as a single lesson
        if (result.text.trim()) {
          await this.memoryStore.append(workspaceId, {
            workspaceId,
            type: "lesson",
            content: result.text.trim().slice(0, 500),
            createdBy: "memory-agent",
            sessionId: this.state?.thread.id ?? "",
          });
        }
      }
    } catch (error) {
      console.error("[memory] extraction failed:", error);
    }
  }

  /**
   * Execute an agent action block and return a text result.
   * Used by the conversation loop to give agents tool-use capabilities.
   */
  async executeAgentAction(
    action: AgentActionBlock,
    agentId: string,
    workspaceRoot: string,
  ): Promise<string> {
    const MAX_OUTPUT = 8000; // Cap output to prevent context blow-up

    switch (action.type) {
      case "read_file": {
        const { readFile } = await import("node:fs/promises");
        const filePath = action.path.startsWith("/")
          ? action.path
          : path.join(workspaceRoot, action.path);
        try {
          const content = await readFile(filePath, "utf8");
          if (content.length > MAX_OUTPUT) {
            return `[FILE: ${filePath}]\n${content.slice(0, MAX_OUTPUT)}\n... (truncated, ${content.length} chars total)`;
          }
          return `[FILE: ${filePath}]\n${content}`;
        } catch (err) {
          return `[ERROR reading ${filePath}]: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      case "run_command": {
        const { execSync } = await import("node:child_process");
        try {
          const output = execSync(action.command, {
            cwd: workspaceRoot,
            encoding: "utf8",
            timeout: 30000, // 30 second timeout
            maxBuffer: 1024 * 1024,
            env: { ...process.env, TERM: "dumb" },
          });
          const trimmed = output.length > MAX_OUTPUT
            ? output.slice(0, MAX_OUTPUT) + "\n... (truncated)"
            : output;
          return `[COMMAND: ${action.command}]\n${trimmed}`;
        } catch (err: unknown) {
          const execErr = err as { stdout?: string; stderr?: string; status?: number; message?: string };
          const stdout = execErr.stdout ?? "";
          const stderr = execErr.stderr ?? "";
          const combined = `${stdout}\n${stderr}`.trim().slice(0, MAX_OUTPUT);
          return `[COMMAND FAILED (exit ${execErr.status ?? "?"}): ${action.command}]\n${combined || execErr.message || "Unknown error"}`;
        }
      }

      case "write_file": {
        const { writeFile, mkdir } = await import("node:fs/promises");
        const filePath = action.path.startsWith("/")
          ? action.path
          : path.join(workspaceRoot, action.path);
        try {
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, action.content, "utf8");
          return `[WROTE: ${filePath}] (${action.content.length} chars)`;
        } catch (err) {
          return `[ERROR writing ${filePath}]: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      default:
        return `[ERROR]: Unknown action type`;
    }
  }

  async runCommand(
    command: string,
    initiatedBy: ActorRef = DEFAULT_USER,
    runId?: string,
    options?: {
      cwd?: string;
      shell?: string;
    },
  ): Promise<{ commandId: string; terminalSessionId: string }> {
    const state = this.getRequiredState();
    const trimmed = command.trim();
    const shell = options?.shell?.trim() || process.env.SHELL || "bash";
    const cwd = options?.cwd?.trim() || state.workspace.rootPath;

    if (!trimmed) {
      throw new Error("Command is required.");
    }

    let terminalSession = this.findTerminalSession("terminal-diagnostics");
    const createdTerminal = !terminalSession;

    if (!terminalSession) {
      const diagnosticsTerminal: TerminalSessionSnapshot = {
        id: "terminal-diagnostics",
        title: "diagnostics",
        cwd,
        shell,
        status: "idle",
        cols: 120,
        rows: 32,
        commands: [],
        buffer: [],
        recentOutput: [],
      };
      terminalSession = diagnosticsTerminal;
      state.workspaceSnapshot.terminals = [
        ...state.workspaceSnapshot.terminals.filter((entry) => entry.id !== diagnosticsTerminal.id),
        diagnosticsTerminal,
      ];
    }

    terminalSession.cwd = cwd;
    terminalSession.shell = shell;

    if (createdTerminal) {
      this.appendEvent(
        createEvent({
          id: randomUUID(),
          threadId: state.thread.id,
          seq: this.nextSeq(),
          actor: initiatedBy,
          type: "terminal.session.opened",
          payload: {
            terminalSessionId: terminalSession.id,
            cwd: terminalSession.cwd,
            initiatedBy,
            runId,
          },
        }) as AppEvent,
      );
    }

    const commandId = randomUUID();
    const commandSnapshot: TerminalCommandSnapshot = {
      id: commandId,
      command: trimmed,
      status: "running",
      initiatedBy,
    };

    terminalSession.commands = [commandSnapshot, ...terminalSession.commands].slice(
      0,
      MAX_COMMAND_HISTORY,
    );
    terminalSession.status = "running";
    this.pushTerminalBuffer(terminalSession, `$ ${trimmed}\n`);
    this.pushTerminalOutput(terminalSession, `$ ${trimmed}`);

    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: initiatedBy,
        type: "terminal.command.started",
        payload: {
          terminalSessionId: terminalSession.id,
          commandId,
          command: trimmed,
          runId,
        },
      }) as AppEvent,
    );

    const generation = this.generation;
    const child = spawnProcess(shell, ["-lc", trimmed], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.runningCommands.set(commandId, child);

    const handleChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (!this.state || generation !== this.generation) {
        return;
      }

      const liveTerminalSession = this.findTerminalSession(terminalSession.id);

      if (!liveTerminalSession) {
        return;
      }

      const text = chunk.toString("utf8").replace(/\0/g, "");
      this.pushTerminalBuffer(liveTerminalSession, text);
      this.pushTerminalOutput(liveTerminalSession, text);
      this.appendEvent(
        createEvent({
          id: randomUUID(),
          threadId: state.thread.id,
          seq: this.nextSeq(),
          actor: initiatedBy,
          type: "terminal.output.delta",
          payload: {
            terminalSessionId: terminalSession.id,
            commandId,
            stream,
            text,
          },
        }) as AppEvent,
      );
    };

    child.stdout.on("data", (chunk) => handleChunk("stdout", chunk));
    child.stderr.on("data", (chunk) => handleChunk("stderr", chunk));
    child.on("close", (exitCode) => {
      this.runningCommands.delete(commandId);

      if (!this.state || generation !== this.generation) {
        return;
      }

      const liveTerminalSession = this.findTerminalSession(terminalSession.id);

      if (!liveTerminalSession) {
        return;
      }

      liveTerminalSession.commands = liveTerminalSession.commands.map((entry) =>
        entry.id === commandId
          ? {
              ...entry,
              status: "completed",
              exitCode: exitCode ?? 0,
            }
          : entry,
      );
      liveTerminalSession.status = this.runningCommands.size > 0 ? "running" : "idle";
      liveTerminalSession.lastExitCode = exitCode ?? 0;

      this.appendEvent(
        createEvent({
          id: randomUUID(),
          threadId: state.thread.id,
          seq: this.nextSeq(),
          actor: initiatedBy,
          type: "terminal.command.completed",
          payload: {
            terminalSessionId: terminalSession.id,
            commandId,
            exitCode: exitCode ?? 0,
            runId,
          },
        }) as AppEvent,
      );
    });

    child.on("error", (error) => {
      const liveTerminalSession = this.findTerminalSession(terminalSession.id);

      if (!liveTerminalSession) {
        return;
      }

      this.pushTerminalBuffer(liveTerminalSession, `${error.message}\n`);
      this.pushTerminalOutput(liveTerminalSession, error.message);
    });

    return {
      commandId,
      terminalSessionId: terminalSession.id,
    };
  }


  private createTask(input: {
    assigneeAgentId?: string;
    createdBy: ActorRef;
    fileScope: string[];
    goal: string;
    terminalScope: string[];
    title: string;
  }): Task {
    const state = this.getRequiredState();
    const ts = new Date().toISOString();
    const task: Task = {
      id: `task-${randomUUID()}`,
      threadId: state.thread.id,
      title: input.title,
      goal: input.goal,
      status: input.assigneeAgentId ? "assigned" : "open",
      createdBy: input.createdBy,
      assigneeAgentId: input.assigneeAgentId,
      fileScope: input.fileScope,
      terminalScope: input.terminalScope,
      dependsOnTaskIds: [],
      createdAt: ts,
      updatedAt: ts,
    };

    state.tasks = [task, ...state.tasks];
    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: input.createdBy,
        type: "task.created",
        payload: { task },
      }) as AppEvent,
    );

    if (input.assigneeAgentId) {
      this.appendEvent(
        createEvent({
          id: randomUUID(),
          threadId: state.thread.id,
          seq: this.nextSeq(),
          actor: { type: "system", id: "orchestrator" },
          type: "task.assigned",
          payload: {
            taskId: task.id,
            agentId: input.assigneeAgentId,
            assignedBy: input.createdBy.id,
          },
        }) as AppEvent,
      );
    }

    return task;
  }

  private setTaskStatus(taskId: string, status: TaskStatus, reason?: string) {
    const task = this.getRequiredState().tasks.find((entry) => entry.id === taskId);

    if (!task) {
      return;
    }

    task.status = status;
    task.updatedAt = new Date().toISOString();

    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: task.threadId,
        seq: this.nextSeq(),
        actor: { type: "system", id: "orchestrator" },
        type: "task.status.changed",
        payload: {
          taskId,
          status,
          reason,
        },
      }) as AppEvent,
    );
  }

  private startRun(
    taskId: string,
    agentId: string,
    status: RunStatus,
    summary?: string,
  ): Run {
    const state = this.getRequiredState();
    const run: Run = {
      id: `run-${randomUUID()}`,
      threadId: state.thread.id,
      taskId,
      agentId,
      status,
      startedAt: new Date().toISOString(),
      summary,
    };

    state.runs = [run, ...state.runs];
    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: state.thread.id,
        seq: this.nextSeq(),
        actor: { type: "agent", id: agentId },
        type: "run.started",
        payload: {
          run,
        },
      }) as AppEvent,
    );

    return run;
  }

  private setRunSummary(runId: string, summary: string, status?: RunStatus) {
    const run = this.getRequiredState().runs.find((entry) => entry.id === runId);

    if (!run) {
      return;
    }

    run.summary = summary;

    if (status) {
      run.status = status;
    }
  }

  private completeRun(runId: string, status: Extract<RunStatus, "completed" | "failed" | "canceled">) {
    const run = this.getRequiredState().runs.find((entry) => entry.id === runId);

    if (!run) {
      return;
    }

    run.status = status;
    run.finishedAt = new Date().toISOString();

    this.appendEvent(
      createEvent({
        id: randomUUID(),
        threadId: run.threadId,
        seq: this.nextSeq(),
        actor: { type: "agent", id: run.agentId },
        type: "run.completed",
        payload: {
          runId,
          status,
          summary: run.summary ?? "",
          tokenUsage: run.tokenUsage,
        },
      }) as AppEvent,
    );
  }

  private assignmentForAgent(agent: AgentDescriptor, content: string): AssignmentPlan {
    const roleId = AGENT_ID_TO_ROLE_ID[agent.id];
    const roleConfig = roleId ? this.agentRoles?.find((r) => r.id === roleId) : undefined;
    const roleName = roleConfig?.name ?? agent.role;

    return {
      agent,
      deliverable: `Deliver the ${roleName.toLowerCase()} output for this request.`,
      goal: `${roleName}: ${content}`,
      kickoff: `I will handle the ${roleName.toLowerCase()} work for this request.`,
      title: `${roleName}: ${summarizeText(content)}`,
    };
  }

  private planAssignmentsWithMetadata(
    content: string,
    requestedAgents: AgentDescriptor[] = [],
  ): {
    assignments: AssignmentPlan[];
    thinkingAgents: Array<{ agentId: string; name: string; selected: boolean; matchedKeywords: string[] }>;
    keywordsMatched: string[];
  } {
    const lower = content.toLowerCase();
    const assignments: AssignmentPlan[] = [];
    const seen = new Set<string>();
    const thinkingAgents: Array<{ agentId: string; name: string; selected: boolean; matchedKeywords: string[] }> = [];
    const allKeywordsMatched: string[] = [];

    const include = (assignment: AssignmentPlan) => {
      if (seen.has(assignment.agent.id)) {
        return;
      }

      seen.add(assignment.agent.id);
      assignments.push(assignment);
    };

    if (requestedAgents.length > 0) {
      for (const agent of requestedAgents) {
        include(this.assignmentForAgent(agent, content));
        thinkingAgents.push({ agentId: agent.id, name: agent.name, selected: true, matchedKeywords: ["@mentioned"] });
      }

      return { assignments, thinkingAgents, keywordsMatched: ["@mention"] };
    }

    // Use trigger keywords from role configs to decide which agents to dispatch
    const roleToAgent: Record<string, AgentDescriptor | undefined> = {};
    for (const [agentId, roleId] of Object.entries(AGENT_ID_TO_ROLE_ID)) {
      roleToAgent[roleId] = defaultAgentProfiles.find((a) => a.id === agentId);
    }

    const roles = this.agentRoles ?? [];
    for (const role of roles) {
      if (role.isQuickReply || role.triggerKeywords.length === 0) continue;
      const matched = role.triggerKeywords.filter((kw) => lower.includes(kw.toLowerCase()));
      const agent = roleToAgent[role.id];
      if (matched.length > 0 && agent) {
        include(this.assignmentForAgent(agent, content));
        allKeywordsMatched.push(...matched);
        thinkingAgents.push({ agentId: agent.id, name: agent.name, selected: true, matchedKeywords: matched });
      } else if (agent) {
        thinkingAgents.push({ agentId: agent.id, name: agent.name, selected: false, matchedKeywords: [] });
      }
    }

    if (assignments.length === 0) {
      // Default to executor if no keywords matched
      const executor = defaultAgentProfiles.find((a) => a.id === "agent-codex") ?? defaultAgentProfiles[1];
      include(this.assignmentForAgent(executor, content));
      thinkingAgents.push({ agentId: executor.id, name: executor.name, selected: true, matchedKeywords: ["default"] });
    }

    return { assignments, thinkingAgents, keywordsMatched: allKeywordsMatched };
  }

  private pushTerminalOutput(terminal: TerminalSessionSnapshot, text: string) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);

    if (lines.length === 0) {
      return;
    }

    terminal.recentOutput = [...terminal.recentOutput, ...lines].slice(-MAX_TERMINAL_LINES);
  }

  private pushTerminalBuffer(terminal: TerminalSessionSnapshot, text: string) {
    if (!text) {
      return;
    }

    terminal.buffer = [...terminal.buffer, text].slice(-MAX_TERMINAL_BUFFER_CHUNKS);
  }

  private findTerminalSession(terminalSessionId: string) {
    return this.getRequiredState().workspaceSnapshot.terminals.find(
      (entry) => entry.id === terminalSessionId,
    );
  }

  private schedule(delayMs: number, action: () => void) {
    const generation = this.generation;
    const timer = setTimeout(() => {
      this.scheduledActions.delete(timer);

      if (generation !== this.generation) {
        return;
      }

      action();
    }, delayMs);

    this.scheduledActions.add(timer);
  }

  private clearAsyncWork() {
    for (const timer of this.scheduledActions) {
      clearTimeout(timer);
    }

    this.scheduledActions.clear();

    for (const controller of this.conversationLoopAbortControllers.values()) {
      controller.abort();
    }

    this.conversationLoopAbortControllers.clear();

    for (const controller of this.runAbortControllers.values()) {
      controller.abort();
    }

    this.runAbortControllers.clear();

    for (const child of this.runningCommands.values()) {
      child.kill("SIGTERM");
    }

    this.runningCommands.clear();

    for (const terminal of this.interactiveTerminals.values()) {
      terminal.pty.kill();
    }

    this.interactiveTerminals.clear();
  }

  private appendEvent(event: AppEvent) {
    const state = this.getRequiredState();
    state.events = [...state.events, event];
    state.thread.updatedAt = event.ts;
    this.publish(event);
  }

  private publish(latestEvent?: AppEvent) {
    const snapshot = this.getState();

    if (!snapshot) {
      return;
    }

    for (const listener of this.listeners) {
      listener(snapshot, latestEvent);
    }
  }

  private getRequiredState(): ThreadBootstrap {
    if (!this.state) {
      throw new Error("No workspace session is currently open.");
    }

    return this.state;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private getDefaultLaneId() {
    const board = this.getRequiredState().board;
    return (
      board.lanes.find((lane) => /backlog|to do|todo/i.test(lane.name))?.id ??
      board.lanes[0]?.id ??
      "lane-default"
    );
  }

  private inferBoardFileTags(): KanbanFileTag[] {
    const state = this.getRequiredState();
    const activePath = state.workspaceSnapshot.activeDocumentPath;

    if (!activePath) {
      return [];
    }

    return [
      {
        path: activePath,
        kind: "file",
      },
    ];
  }
}
