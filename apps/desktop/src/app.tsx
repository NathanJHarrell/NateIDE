import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBookOpen,
  faChevronRight,
  faCodeBranch,
  faCompass,
  faDesktop,
  faDiagramProject,
  faFileLines,
  faFolder,
  faFolderOpen,
  faFolderTree,
  faGear,
  faRobot,
  faTableColumns,
  faTerminal,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import Markdown from "react-markdown";
import type { AgentDescriptor } from "@nateide/agents";
import {
  createDemoThreadBootstrap,
  type ThreadBootstrap,
} from "@nateide/orchestrator";
import {
  brandTheme,
  type PanelDescriptor,
  type ShellLayout,
  type ShellZone,
} from "@nateide/ui";
import type {
  AgentDelegationEvent,
  AppEvent,
  ConversationCompletedEvent,
  ConversationRoundCompletedEvent,
  ConversationRoundStartedEvent,
  ControllerThinkingEvent,
  DissentDetectedEvent,
  Run,
  Task,
  ThreadMessageCreatedEvent,
  TokenUsage,
  WorkspaceCandidate,
} from "@nateide/protocol";
import type {
  FileTreeNode,
  TerminalSessionSnapshot,
} from "@nateide/workspace";
import { KanbanView } from "./kanban-view";
import { ProjectLauncher } from "./project-launcher";
import { SettingsView, type IdeSettings, type AgentRoleConfig, type SoulDocument } from "./settings-view";
import { PipelineEditor } from "./pipeline-editor";
import { TerminalPane } from "./terminal-pane";
import { AuthGate, useCurrentUser } from "./auth-gate";
import { FloatingChat } from "./floating-chat";
import { TerminalWorkspace } from "./terminal-workspace";
import { SoulEditor } from "./soul-editor";
import { MemberPanel } from "./member-panel";
import { ApprovalPanel } from "./approval-panel";
import { DiscoveryView } from "./discovery-view";
import { ProfileView } from "./profile-view";
import type { Id } from "../../../convex/_generated/dataModel";

// Convex hooks — all state that lives in Convex
import {
  useMe,
  useWorkspaces as useConvexWorkspaces,
  useWorkspace,
  useThreads,
  useThread,
  useEvents,
  useTasks,
  useRuns,
  useSettings,
  useCreateWorkspace as useConvexCreateWorkspace,
  useCreateThread,
  useAppendEvent,
  useCreateTask,
  useUpdateTask,
  useStartRun,
  useCompleteRun,
  useUpdateSettings,
  useUpdateWorkspace,
  useUpdateThreadStatus,
  useHarnesses,
  usePendingApprovals,
  useActiveConflicts,
} from "./convex-hooks";

// ---------------------------------------------------------------------------
// ARCHITECTURE
//
// Convex handles: auth, workspaces, threads, events, tasks, runs, settings,
// members, presence, approvals, conflicts, harnesses, souls, pipelines,
// profiles, discovery, stars.
//
// Local daemon handles: filesystem (file tree, documents), terminal/PTY,
// git status. These use fetch(API_ROOT + ...) and SSE.
// ---------------------------------------------------------------------------

const DEFAULT_DAEMON_ORIGIN = "http://127.0.0.1:4317";
const API_ROOT_CANDIDATES = [
  import.meta.env.VITE_API_ROOT,
  "/api",
  import.meta.env.VITE_LOCAL_DAEMON_URL,
  DEFAULT_DAEMON_ORIGIN,
].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
let resolvedApiRoot: string | null = null;
const PROJECT_TABS_STORAGE_KEY = "nateide.project-tabs.v1";
const SHELL_LAYOUT_STORAGE_KEY = "nateide.shell-layout.v1";
const SHELL_ZONES: ShellZone[] = ["left", "center", "right", "bottom"];
const DEFAULT_SETTINGS: IdeSettings = {
  apiKeys: {
    anthropic: "",
    openrouter: "",
    google: "",
    openai: "",
  },
  agentRoles: [
    { id: "planner", name: "Planner", provider: "anthropic", model: "claude-opus-4-6", systemPrompt: "You are the orchestration planner. Decompose work, plan execution strategy, route tasks to other agents, and keep thread state coherent.", triggerKeywords: [] },
    { id: "executor", name: "Executor", provider: "openai", model: "gpt-5.4", systemPrompt: "You are the executor agent. Implement code changes, run terminal commands, and deliver working solutions.", triggerKeywords: ["build", "implement", "code", "fix", "refactor", "scaffold", "wire", "terminal", "daemon", "editor", "ide", "api"] },
    { id: "reviewer", name: "Reviewer", provider: "google", model: "gemini-3.1-pro-preview", systemPrompt: "You are the reviewer agent. Review code, design frontend UI, and validate integration and visual quality.", triggerKeywords: ["review", "test", "validate", "risk", "audit", "check", "regression", "ui", "ux", "frontend", "design", "layout", "css"] },
    { id: "generalist", name: "Generalist", provider: "openrouter", model: "moonshotai/kimi-k2.5", systemPrompt: "You are a general-purpose reasoning agent. Brainstorm, analyze problems, and provide thorough analysis.", triggerKeywords: ["brainstorm", "analyze", "reason", "think", "research", "explain"] },
    { id: "quick-reply", name: "Quick Reply", provider: "google", model: "gemini-3-flash-preview", systemPrompt: "You are a helpful assistant. The user is chatting casually. Be friendly, concise, and conversational.", triggerKeywords: [], isQuickReply: true },
  ],
  soulDocuments: {},
  conversationLoop: {
    maxRounds: 10,
    enabled: true,
  },
  appearance: {
    density: "comfortable",
    showBoardHints: true,
    theme: "default",
  },
  terminal: {
    fontSize: 14,
    shell: "bash",
  },
};

type ConnectionState = "loading" | "live" | "fallback";
type AppView = "workspace" | "kanban" | "settings" | "pipelines" | "souls" | "discovery" | "profile" | "terminals";
type ProjectTab = {
  name: string;
  path: string;
};

type HealthResponse = {
  mode: string;
  ok: boolean;
  platform?: string;
  port: number;
  userHome?: string;
  workspaceRoot: string;
  workspaceRoots?: string[];
};

const SUPPORTED_VIEWS: AppView[] = [
  "workspace",
  "kanban",
  "settings",
  "pipelines",
  "souls",
  "discovery",
  "profile",
  "terminals",
];

const VIEW_ICONS: Record<AppView, IconDefinition> = {
  workspace: faDesktop,
  kanban: faTableColumns,
  pipelines: faDiagramProject,
  souls: faBookOpen,
  terminals: faTerminal,
  discovery: faCompass,
  profile: faUser,
  settings: faGear,
};

const PANEL_ICONS: Record<string, IconDefinition> = {
  explorer: faFolderTree,
  git: faCodeBranch,
  agents: faRobot,
};

function emptyShellLayout(): ShellLayout {
  return {
    left: [],
    center: [],
    right: [],
    bottom: [],
  };
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");

  if (lastSlash <= 0) {
    return normalized || "/";
  }

  return normalized.slice(0, lastSlash);
}

function splitWorkspaceRelativePath(filePath: string): { name: string; parent: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length === 0) {
    return {
      name: filePath,
      parent: "workspace root",
    };
  }

  if (parts.length === 1) {
    return {
      name: parts[0] ?? filePath,
      parent: "workspace root",
    };
  }

  return {
    name: parts.at(-1) ?? filePath,
    parent: parts.slice(0, -1).join("/"),
  };
}

function isWindowsClient(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

function isWindowsPath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\");
}

function isCrossPlatformStalePath(filePath: string): boolean {
  const trimmed = filePath.trim();

  if (!trimmed) {
    return true;
  }

  return isWindowsClient() ? trimmed.startsWith("/") : isWindowsPath(trimmed);
}

function guessFallbackRoot(): string {
  if (isWindowsClient()) {
    return "C:\\";
  }

  if (typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent)) {
    return "/Users";
  }

  return "~/";
}

function loadProjectTabs(): ProjectTab[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(PROJECT_TABS_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as ProjectTab[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((tab): tab is ProjectTab =>
        Boolean(tab) &&
        typeof tab === "object" &&
        typeof tab.name === "string" &&
        typeof tab.path === "string" &&
        !isCrossPlatformStalePath(tab.path),
      )
      .slice(0, 8);
  } catch {
    return [];
  }
}

function saveProjectTabs(tabs: ProjectTab[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PROJECT_TABS_STORAGE_KEY, JSON.stringify(tabs.slice(0, 8)));
}

function loadShellLayout(): ShellLayout | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as ShellLayout;
  } catch {
    return null;
  }
}

function saveShellLayout(layout: ShellLayout) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SHELL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

function flattenShellLayout(layout: ShellLayout): PanelDescriptor[] {
  return SHELL_ZONES.flatMap((zone) => layout[zone]);
}

function normalizeShellLayout(layout: ShellLayout | null, fallback: ShellLayout): ShellLayout {
  const fallbackById = new Map(flattenShellLayout(fallback).map((panel) => [panel.id, panel]));
  const next = emptyShellLayout();
  const seen = new Set<string>();

  if (layout) {
    for (const zone of SHELL_ZONES) {
      for (const panel of layout[zone] ?? []) {
        const basePanel = fallbackById.get(panel.id);

        if (!basePanel || seen.has(panel.id)) {
          continue;
        }

        seen.add(panel.id);
        next[zone].push({ ...basePanel, zone });
      }
    }
  }

  for (const zone of SHELL_ZONES) {
    for (const panel of fallback[zone]) {
      if (seen.has(panel.id)) {
        continue;
      }

      seen.add(panel.id);
      next[zone].push(panel);
    }
  }

  return next;
}

function moveShellPanel(
  layout: ShellLayout,
  panelId: string,
  targetZone: ShellZone,
  targetIndex: number,
): ShellLayout {
  const next = emptyShellLayout();
  let moved: PanelDescriptor | null = null;
  let sourceZone: ShellZone | null = null;
  let sourceIndex = -1;

  for (const zone of SHELL_ZONES) {
    next[zone] = layout[zone].filter((panel, i) => {
      if (panel.id !== panelId) {
        return true;
      }

      moved = panel;
      sourceZone = zone;
      sourceIndex = i;
      return false;
    });
  }

  if (!moved) {
    return layout;
  }

  // When moving within the same zone to a later position, adjust for the
  // removal shifting indices down by one.
  let insertIndex = targetIndex;

  if (sourceZone === targetZone && sourceIndex < targetIndex) {
    insertIndex--;
  }

  const movedPanel = moved as PanelDescriptor;
  next[targetZone] = [...next[targetZone]];
  next[targetZone].splice(insertIndex, 0, {
    id: movedPanel.id,
    title: movedPanel.title,
    description: movedPanel.description,
    zone: targetZone,
  });
  return next;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "Failed to fetch") {
    return "Could not reach the local daemon. Start `bun --cwd apps/daemon dev` or use `bun run dev` from the project root.";
  }

  return error instanceof Error ? error.message : "Unexpected error";
}

function isNoSessionOpenError(error: unknown): boolean {
  return error instanceof Error && error.message === "No session open.";
}

function isDaemonUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message === "Failed to fetch";
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const apiRoots = resolvedApiRoot
    ? [resolvedApiRoot]
    : pathname === "/health"
      ? API_ROOT_CANDIDATES
      : API_ROOT_CANDIDATES.slice(0, 1);
  let lastError: Error | null = null;

  for (const apiRoot of apiRoots) {
    const normalizedRoot = apiRoot.endsWith("/") ? apiRoot.slice(0, -1) : apiRoot;

    try {
      const response = await fetch(`${normalizedRoot}${pathname}`, init);

      if (!response.ok) {
        let message = `${pathname} failed with ${response.status}`;

        try {
          const payload = (await response.json()) as { message?: string };

          if (payload.message) {
            message = payload.message;
          }
        } catch {
          // Ignore JSON parsing failures and fall back to the status code.
        }

        const error = new Error(message);

        if (!resolvedApiRoot && pathname === "/health") {
          lastError = error;
          continue;
        }

        throw error;
      }

      resolvedApiRoot = normalizedRoot;
      return (await response.json()) as T;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Unexpected error");

      if (!resolvedApiRoot && pathname === "/health") {
        lastError = normalizedError;
        continue;
      }

      throw normalizedError;
    }
  }

  throw lastError ?? new Error(`${pathname} failed`);
}

function eventSummary(event: AppEvent): string {
  switch (event.type) {
    case "thread.message.created":
      return event.payload.content;
    case "task.created":
      return `Task created: ${event.payload.task.title}`;
    case "task.assigned":
      return `Assigned to ${event.payload.agentId}`;
    case "task.status.changed":
      return event.payload.reason ?? `Task status -> ${event.payload.status}`;
    case "handoff.created":
      return `Handoff to ${event.payload.toAgentId}: ${event.payload.goal}`;
    case "run.started":
      return `Run started by ${event.payload.run.agentId}`;
    case "run.output.delta":
      return event.payload.text;
    case "run.completed":
      return event.payload.summary;
    case "artifact.created":
      return `Artifact created: ${event.payload.artifact.type}`;
    case "board.lane.created":
      return `Board lane created: ${event.payload.lane.name}`;
    case "board.lane.updated":
      return `Board lane updated: ${event.payload.lane.name}`;
    case "board.card.created":
      return `Board card created: ${event.payload.card.title}`;
    case "board.card.updated":
      return `Board card updated: ${event.payload.card.title}`;
    case "board.card.moved":
      return `Board card moved to ${event.payload.toLaneId}`;
    case "patch.proposed":
      return `Patch proposed for ${event.payload.paths.join(", ")}`;
    case "terminal.session.opened":
      return `Opened terminal in ${event.payload.cwd}`;
    case "terminal.command.started":
      return event.payload.command;
    case "terminal.output.delta":
      return event.payload.text;
    case "terminal.command.completed":
      return `Command exited with code ${event.payload.exitCode}`;
    case "file.opened":
      return `Opened ${event.payload.path}`;
    default:
      return event.type;
  }
}

function runTone(run: Run): string {
  if (run.status === "completed") {
    return "status-complete";
  }

  if (run.status === "streaming" || run.status === "starting") {
    return "status-live";
  }

  return "status-muted";
}

function taskTone(task: Task): string {
  if (task.status === "completed") {
    return "status-complete";
  }

  if (task.status === "in_progress") {
    return "status-live";
  }

  return "status-muted";
}

function TreeNodeView(props: {
  activePath: string;
  depth?: number;
  node: FileTreeNode;
  onOpenFile: (path: string) => void;
}) {
  const { activePath, depth = 0, node, onOpenFile } = props;
  const isDirectory = node.kind === "directory";
  const hasChildren = isDirectory && Boolean(node.children?.length);
  const [isOpen, setIsOpen] = useState(() => activePath.startsWith(node.path) || depth < 1);

  useEffect(() => {
    if (isDirectory && activePath.startsWith(node.path)) {
      setIsOpen(true);
    }
  }, [activePath, isDirectory, node.path]);

  return (
    <li className={`tree-node tree-node-${node.kind}`}>
      {isDirectory ? (
        <button
          type="button"
          className={`tree-entry tree-entry-directory ${isOpen ? "tree-entry-open" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
        >
          <span className={`tree-chevron ${isOpen ? "tree-chevron-open" : ""}`} aria-hidden="true">
            <FontAwesomeIcon icon={faChevronRight} />
          </span>
          <span className="tree-icon" aria-hidden="true">
            <FontAwesomeIcon icon={isOpen ? faFolderOpen : faFolder} />
          </span>
          <span className="tree-name">{node.name}</span>
        </button>
      ) : (
        <button
          type="button"
          className={`tree-entry tree-entry-file ${
            activePath === node.path ? "tree-entry-file-active" : ""
          }`}
          onClick={() => onOpenFile(node.path)}
        >
          <span className="tree-chevron tree-chevron-spacer" aria-hidden="true" />
          <span className="tree-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faFileLines} />
          </span>
          <span className="tree-name">{node.name}</span>
        </button>
      )}
      {hasChildren && isOpen ? (
        <ul className="tree-children">
          {(node.children ?? []).map((child) => (
            <TreeNodeView
              key={child.path}
              activePath={activePath}
              depth={depth + 1}
              node={child}
              onOpenFile={onOpenFile}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function AgentCard({ agent }: { agent: AgentDescriptor }) {
  return (
    <article className="agent-card" style={{ borderColor: agent.color }}>
      <header>
        <span className="agent-name">{agent.name}</span>
        <span className="agent-role">{agent.role}</span>
      </header>
      <p>{agent.specialty}</p>
    </article>
  );
}

function AddAgentModal({ onClose, onSave }: { onClose: () => void; onSave: (role: AgentRoleConfig) => void }) {
  const [draft, setDraft] = useState<AgentRoleConfig>({
    id: `custom-${Date.now()}`,
    name: "",
    provider: "openrouter",
    model: "",
    systemPrompt: "",
    triggerKeywords: [],
  });

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-surface">
        <header className="modal-header">
          <h2>Add Agent</h2>
          <button type="button" className="modal-close" onClick={onClose}>&times;</button>
        </header>
        <div className="modal-body">
          <div className="modal-row">
            <label>
              <span>Name</span>
              <input
                className="text-input"
                placeholder="e.g. Security Auditor"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
          </div>
          <div className="modal-row modal-row-2col">
            <label>
              <span>Provider</span>
              <select
                className="text-input"
                value={draft.provider}
                onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value as AgentRoleConfig["provider"] }))}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </label>
            <label>
              <span>Model</span>
              <input
                className="text-input"
                placeholder="e.g. google/gemini-3-flash-preview"
                value={draft.model}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              />
            </label>
          </div>
          <label>
            <span>System Prompt</span>
            <textarea
              className="text-input"
              rows={4}
              placeholder="Describe this agent's role, behavior, and expertise..."
              value={draft.systemPrompt}
              onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
            />
          </label>
          <label>
            <span>Trigger Keywords <span className="settings-hint-inline">(comma-separated, controls auto-dispatch)</span></span>
            <input
              className="text-input"
              placeholder="e.g. security, audit, vulnerability, pentest"
              value={draft.triggerKeywords.join(", ")}
              onChange={(e) => setDraft((d) => ({ ...d, triggerKeywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) }))}
            />
          </label>
        </div>
        <footer className="modal-footer">
          <button type="button" className="modal-cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="action-button"
            disabled={!draft.name.trim() || !draft.model.trim()}
            onClick={() => {
              onSave({
                ...draft,
                id: `custom-${draft.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
              });
            }}
          >
            Add Agent
          </button>
        </footer>
      </div>
    </div>
  );
}

type ConversationRoundGroup = {
  roundNumber: number;
  events: AppEvent[];
  completed?: ConversationRoundCompletedEvent;
};

type TaskGroup = {
  userMessage: AppEvent;
  thinkingEvent?: ControllerThinkingEvent;
  events: AppEvent[];
  conversationRounds: ConversationRoundGroup[];
  conversationCompleted?: ConversationCompletedEvent;
  dissents: DissentDetectedEvent[];
  delegations: AgentDelegationEvent[];
};

function groupEventsByRequest(events: AppEvent[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  let current: TaskGroup | null = null;
  let currentRound: ConversationRoundGroup | null = null;

  for (const evt of events) {
    if (evt.type === "thread.message.created" && evt.actor.type === "user") {
      if (currentRound && current) {
        current.conversationRounds.push(currentRound);
        currentRound = null;
      }
      if (current) groups.push(current);
      current = { userMessage: evt, events: [], conversationRounds: [], dissents: [], delegations: [] };
    } else if (current) {
      if (evt.type === "controller.thinking") {
        current.thinkingEvent = evt as ControllerThinkingEvent;
      }

      if (evt.type === "conversation.round.started") {
        if (currentRound) {
          current.conversationRounds.push(currentRound);
        }
        const payload = (evt as ConversationRoundStartedEvent).payload;
        currentRound = { roundNumber: payload.roundNumber, events: [] };
      } else if (evt.type === "conversation.round.completed") {
        if (currentRound) {
          currentRound.completed = evt as ConversationRoundCompletedEvent;
          current.conversationRounds.push(currentRound);
          currentRound = null;
        }
      } else if (evt.type === "conversation.completed") {
        current.conversationCompleted = evt as ConversationCompletedEvent;
      } else if (evt.type === "dissent.detected") {
        current.dissents.push(evt as DissentDetectedEvent);
      } else if (evt.type === "agent.delegation") {
        current.delegations.push(evt as AgentDelegationEvent);
      }

      if (currentRound) {
        currentRound.events.push(evt);
      }
      current.events.push(evt);
    } else {
      if (!current) {
        current = { userMessage: evt, events: [], conversationRounds: [], dissents: [], delegations: [] };
      }
    }
  }

  if (currentRound && current) {
    current.conversationRounds.push(currentRound);
  }
  if (current) groups.push(current);
  return groups;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number | undefined): string {
  if (!usd) return "";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function ThinkingBlock({ event }: { event: ControllerThinkingEvent }) {
  const [expanded, setExpanded] = useState(false);
  const p = event.payload;

  return (
    <div className="thinking-block">
      <button type="button" className="thinking-toggle" onClick={() => setExpanded(!expanded)}>
        <span className="thinking-chevron">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span>Controller reasoning</span>
        {p.keywordsMatched.length > 0 && (
          <span className="thinking-keywords">{p.keywordsMatched.join(", ")}</span>
        )}
      </button>
      {expanded && (
        <div className="thinking-detail">
          <p className="thinking-decision">{p.decision}</p>
          <ul className="thinking-agent-list">
            {p.agents.map((a) => (
              <li key={a.agentId} className={a.selected ? "thinking-agent-selected" : "thinking-agent-skipped"}>
                <strong>{a.name}</strong>
                {a.selected ? " \u2713" : " \u2014 skipped"}
                {a.matchedKeywords.length > 0 && (
                  <span className="thinking-match-keywords"> ({a.matchedKeywords.join(", ")})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence?: number }) {
  if (confidence === undefined) return null;
  return <span className="confidence-badge">{confidence}% confident</span>;
}

function DissentCallout({ event }: { event: DissentDetectedEvent }) {
  const p = event.payload;
  const isHigh = p.confidence >= 40;
  return (
    <div className={`dissent-callout ${isHigh ? "dissent-high" : "dissent-low"}`}>
      <span className="dissent-badge">{isHigh ? "\u26A0 Dissent" : "\u25CF Dissent"}</span>
      <span className="dissent-agent">{p.dissentingAgentId}</span>
      {p.topic && <span className="dissent-topic">{p.topic}</span>}
    </div>
  );
}

function DelegationNotice({ event }: { event: AgentDelegationEvent }) {
  const p = event.payload;
  return (
    <div className="delegation-notice">
      <span className="delegation-label">{p.fromAgentId} asked {p.toAgentId}:</span>
      <span className="delegation-question">{p.question.slice(0, 120)}</span>
    </div>
  );
}

function ConversationRoundHeader({ round, isExpanded, onToggle }: {
  round: ConversationRoundGroup;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const completed = round.completed?.payload;
  const respondCount = completed?.responses.filter((r) => r.action === "respond").length ?? 0;
  const passCount = completed?.responses.filter((r) => r.action === "pass" || r.action === "satisfied").length ?? 0;

  return (
    <button type="button" className="round-header" onClick={onToggle}>
      <span className="round-chevron">{isExpanded ? "\u25BC" : "\u25B6"}</span>
      <span className="round-label">Round {round.roundNumber}</span>
      {completed && (
        <span className="round-meta">
          {respondCount} responded{passCount > 0 ? `, ${passCount} passed` : ""}
        </span>
      )}
    </button>
  );
}

function ConversationCompletedBanner({ event }: { event: ConversationCompletedEvent }) {
  const p = event.payload;
  const reasonText: Record<string, string> = {
    converged: `Converged after ${p.totalRounds} round${p.totalRounds > 1 ? "s" : ""}`,
    max_rounds: `Reached maximum ${p.totalRounds} rounds`,
    user_ended: "Discussion ended by user",
    canceled: "Discussion canceled",
  };
  return (
    <div className="conversation-completed-banner">
      <span className="conversation-completed-icon">{p.reason === "converged" ? "\u2713" : "\u25A0"}</span>
      <span>{reasonText[p.reason] ?? `Completed after ${p.totalRounds} rounds`}</span>
    </div>
  );
}

function FeedbackButtons({ agentId, messageContent }: { agentId: string; messageContent: string }) {
  const [sent, setSent] = useState<"positive" | "negative" | null>(null);

  const sendFeedback = (type: "positive" | "negative") => {
    setSent(type);
    // Feedback stored locally — Convex feedback table can be added later
  };

  return (
    <span className="feedback-buttons">
      <button
        type="button"
        className={`feedback-btn ${sent === "positive" ? "feedback-btn-active" : ""}`}
        onClick={() => sendFeedback("positive")}
        disabled={sent !== null}
        title="Good response"
      >
        +
      </button>
      <button
        type="button"
        className={`feedback-btn ${sent === "negative" ? "feedback-btn-active" : ""}`}
        onClick={() => sendFeedback("negative")}
        disabled={sent !== null}
        title="Could be better"
      >
        -
      </button>
    </span>
  );
}

function TokenFooter({ usage }: { usage: TokenUsage }) {
  return (
    <span className="token-footer">
      {formatTokens(usage.inputTokens)} in / {formatTokens(usage.outputTokens)} out
      {usage.estimatedCostUsd ? ` (~${formatCost(usage.estimatedCostUsd)})` : ""}
    </span>
  );
}

function renderAgentMessage(evt: AppEvent, runs: Run[]) {
  if (evt.type === "run.output.delta") {
    const payload = evt.payload as { channel: string; text: string; runId: string };
    if (payload.channel === "debug") {
      return (
        <div key={evt.id} className="chat-message chat-message-debug">
          <span className="chat-debug-notice">{payload.text}</span>
        </div>
      );
    }
    return null;
  }

  const isUser = evt.actor.type === "user";
  if (isUser) return null;
  const isSystem = evt.actor.type === "system";
  const kind = isSystem ? "system" : "agent";
  const content =
    evt.type === "thread.message.created"
      ? (evt as ThreadMessageCreatedEvent).payload.content
      : eventSummary(evt);

  const matchingRun = runs.find(
    (r) => r.agentId === evt.actor.id && (r.status === "streaming" || r.status === "completed" || r.status === "canceled"),
  );
  const isStreaming = matchingRun?.status === "streaming" || matchingRun?.status === "starting";
  const isCanceled = matchingRun?.status === "canceled";

  // Extract confidence from round completed events if available
  const confidenceMatch = content.match(/\[CONFIDENCE:(\d+)\]/i);
  const confidence = confidenceMatch ? parseInt(confidenceMatch[1], 10) : undefined;

  // Check for dissent keywords
  const hasDissent = /\b(disagree|incorrect|actually|however|push back)\b/i.test(content);

  return (
    <div
      key={evt.id}
      className={`chat-message chat-message-${kind}${isCanceled ? " chat-message-canceled" : ""}${hasDissent ? " dissent-high" : ""}`}
    >
      <span className="chat-sender">
        {evt.actor.id}
        {isCanceled && <span className="canceled-badge">canceled</span>}
        <ConfidenceBadge confidence={confidence} />
      </span>
      <div className="chat-bubble">
        <Markdown>{content}</Markdown>
        {isStreaming && matchingRun && (
          <button
            type="button"
            className="cancel-run-btn"
            onClick={() => {
              // TODO: Cancel run via Convex mutation
            }}
          >
            Stop
          </button>
        )}
      </div>
      <span className="chat-message-footer">
        {matchingRun?.tokenUsage && <TokenFooter usage={matchingRun.tokenUsage} />}
        {evt.type === "thread.message.created" && evt.actor.type === "agent" && (
          <FeedbackButtons agentId={evt.actor.id} messageContent={content} />
        )}
      </span>
    </div>
  );
}

function AgentMessagesView({ events, runs }: { events: AppEvent[]; runs: Run[] }) {
  return (
    <>
      {events
        .filter(
          (evt) =>
            evt.type === "thread.message.created" ||
            evt.type === "handoff.created" ||
            evt.type === "run.output.delta",
        )
        .map((evt) => renderAgentMessage(evt, runs))}
    </>
  );
}

function ConversationRoundsView({
  rounds,
  dissents,
  delegations,
  runs,
  conversationCompleted,
}: {
  rounds: ConversationRoundGroup[];
  dissents: DissentDetectedEvent[];
  delegations: AgentDelegationEvent[];
  runs: Run[];
  conversationCompleted?: ConversationCompletedEvent;
}) {
  const [collapsedRounds, setCollapsedRounds] = useState<Set<number>>(new Set());
  const isLoopActive = !conversationCompleted;

  // Auto-collapse older rounds
  const toggleRound = (roundNum: number) => {
    setCollapsedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(roundNum)) next.delete(roundNum);
      else next.add(roundNum);
      return next;
    });
  };

  return (
    <div className="conversation-rounds">
      {rounds.map((round) => {
        const isLast = round.roundNumber === rounds[rounds.length - 1]?.roundNumber;
        const isCollapsed = !isLast && collapsedRounds.has(round.roundNumber);
        const roundDissents = dissents.filter((d) => d.payload.roundNumber === round.roundNumber);
        const roundDelegations = delegations.filter((d) => d.payload.roundNumber === round.roundNumber);

        return (
          <div key={round.roundNumber} className={`conversation-round ${isCollapsed ? "conversation-round-collapsed" : ""}`}>
            {rounds.length > 1 && (
              <ConversationRoundHeader
                round={round}
                isExpanded={!isCollapsed}
                onToggle={() => toggleRound(round.roundNumber)}
              />
            )}
            {!isCollapsed && (
              <div className="conversation-round-body">
                {roundDelegations.map((d) => (
                  <DelegationNotice key={d.id} event={d} />
                ))}
                {round.events
                  .filter(
                    (evt) =>
                      evt.type === "thread.message.created" ||
                      evt.type === "handoff.created" ||
                      evt.type === "run.output.delta",
                  )
                  .map((evt) => renderAgentMessage(evt, runs))}
                {roundDissents.map((d) => (
                  <DissentCallout key={d.id} event={d} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {conversationCompleted && <ConversationCompletedBanner event={conversationCompleted} />}

      {isLoopActive && rounds.length > 0 && (
        <button
          type="button"
          className="end-discussion-btn"
          onClick={() => {
            // TODO: End conversation via Convex mutation
          }}
        >
          End Discussion
        </button>
      )}
    </div>
  );
}

function ThreadEventCard({ event }: { event: AppEvent }) {
  const message =
    event.type === "thread.message.created"
      ? (event as ThreadMessageCreatedEvent).payload.content
      : eventSummary(event);

  return (
    <article className="timeline-card">
      <header>
        <span>{event.actor.id}</span>
        <span>{event.type}</span>
      </header>
      <p>{message}</p>
    </article>
  );
}

function TerminalCard({ terminal }: { terminal: TerminalSessionSnapshot }) {
  return (
    <article className="terminal-card terminal-window">
      <header className="terminal-window-header">
        <div className="terminal-lights" aria-hidden="true">
          <span className="terminal-light terminal-light-close" />
          <span className="terminal-light terminal-light-minimize" />
          <span className="terminal-light terminal-light-maximize" />
        </div>
        <div className="terminal-window-meta">
          <span className="terminal-window-title">{terminal.title}</span>
          <span className="terminal-window-path">{terminal.cwd}</span>
        </div>
        <span className={`terminal-window-state terminal-window-state-${terminal.status}`}>
          {terminal.status}
        </span>
      </header>
      <div className="terminal-output">
        {terminal.recentOutput.length > 0 ? (
          terminal.recentOutput.map((line, index) => (
            <div key={`${line}-${index}`} className="terminal-line">
              <span className="terminal-line-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="terminal-line-text">{line}</span>
            </div>
          ))
        ) : (
          <div className="terminal-empty">No terminal output yet.</div>
        )}
      </div>
      <div className="terminal-history">
        {terminal.commands.map((command) => (
          <div key={command.id} className="terminal-history-item">
            <span className="terminal-prompt-marker">$</span>
            <span className="terminal-history-command">{command.command}</span>
            <span className="terminal-history-status">
              {command.status === "running" ? "running" : `exit ${command.exitCode ?? 0}`}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

function AgentRoutingButton(props: {
  agent: AgentDescriptor;
  isSelected: boolean;
  onToggle: (agentId: string) => void;
}) {
  const { agent, isSelected, onToggle } = props;

  return (
    <button
      type="button"
      className={`agent-routing-button ${isSelected ? "agent-routing-button-active" : ""}`}
      onClick={() => onToggle(agent.id)}
      style={
        {
          "--agent-color": agent.color,
        } as CSSProperties
      }
    >
      <span className="agent-routing-swatch" />
      <span className="agent-routing-copy">
        <span className="agent-routing-name">{agent.name}</span>
        <span className="agent-routing-role">{agent.role}</span>
      </span>
    </button>
  );
}

function MentionDropdown(props: {
  agents: AgentDescriptor[];
  query: string;
  onSelect: (name: string) => void;
  onClose: () => void;
  position: { top: number; left: number };
}) {
  const { agents, query, onSelect, onClose, position } = props;
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = agents.filter(
    (a) =>
      a.id !== "agent-controller" &&
      (a.name.toLowerCase().startsWith(query.toLowerCase()) ||
        a.role.toLowerCase().startsWith(query.toLowerCase())),
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (filtered[activeIndex]) onSelect(filtered[activeIndex].name);
      } else if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [activeIndex, filtered, onSelect, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div className="mention-dropdown" style={{ top: position.top, left: position.left }}>
      {filtered.map((agent, i) => (
        <button
          type="button"
          key={agent.id}
          className={`mention-item ${i === activeIndex ? "mention-item-active" : ""}`}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(agent.name);
          }}
        >
          <span className="mention-item-dot" style={{ background: agent.color }} />
          <span className="mention-item-name">{agent.name}</span>
          <span className="mention-item-role">{agent.role}</span>
        </button>
      ))}
    </div>
  );
}

function WorkspaceCandidateButton(props: {
  candidate: WorkspaceCandidate;
  currentPath: string;
  onOpen: (path: string) => void;
}) {
  const { candidate, currentPath, onOpen } = props;

  return (
    <button
      type="button"
      className={`workspace-candidate ${
        currentPath === candidate.path ? "workspace-candidate-active" : ""
      }`}
      onClick={() => onOpen(candidate.path)}
    >
      <span className="workspace-candidate-name">{candidate.name}</span>
      <span className="workspace-candidate-path">{candidate.path}</span>
      <div className="workspace-candidate-badges">
        {candidate.hasGit && <span className="badge badge-git">git</span>}
        {candidate.hasPackageJson && <span className="badge badge-package">pkg</span>}
        {!candidate.hasGit && !candidate.hasPackageJson && (
          <span className="badge badge-source">{candidate.source}</span>
        )}
      </div>
    </button>
  );
}

export function App() {
  return (
    <AuthGate>
      <AppContent />
    </AuthGate>
  );
}

function AppContent() {
  const { userId, user } = useCurrentUser();

  // Convex data subscriptions
  const convexWorkspaces = useConvexWorkspaces(userId ?? undefined);
  const convexSettings = useSettings(userId ?? undefined);
  const updateSettingsMutation = useUpdateSettings();
  const createWorkspaceMutation = useConvexCreateWorkspace();
  const appendEventMutation = useAppendEvent();
  const createThreadMutation = useCreateThread();

  // Active Convex workspace (selected from convexWorkspaces)
  const [activeConvexWorkspaceId, setActiveConvexWorkspaceId] = useState<Id<"workspaces"> | null>(null);
  const activeConvexWorkspace = useWorkspace(activeConvexWorkspaceId ?? undefined);
  const convexThreads = useThreads(activeConvexWorkspaceId ?? undefined);
  const [activeThreadId, setActiveThreadId] = useState<Id<"threads"> | null>(null);
  const convexEvents = useEvents(activeThreadId ?? undefined);
  const convexTasks = useTasks(activeThreadId ?? undefined);
  const convexRuns = useRuns(activeThreadId ?? undefined);
  const harnesses = useHarnesses(activeConvexWorkspaceId ?? undefined);
  const pendingApprovals = usePendingApprovals(activeConvexWorkspaceId ?? undefined);
  const activeConflicts = useActiveConflicts(activeConvexWorkspaceId ?? undefined);

  // Profile view state
  const [profileUserId, setProfileUserId] = useState<Id<"users"> | null>(null);

  const [sessions, setSessions] = useState<Map<string, ThreadBootstrap>>(new Map());
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [view, setView] = useState<AppView>(() => {
    if (typeof window === "undefined") {
      return "workspace";
    }

    const requestedView = new URL(window.location.href).searchParams.get("view");
    return SUPPORTED_VIEWS.includes(requestedView as AppView)
      ? (requestedView as AppView)
      : "workspace";
  });
  const [projectTabs, setProjectTabs] = useState<ProjectTab[]>(() => loadProjectTabs());
  const [shellLayout, setShellLayout] = useState<ShellLayout | null>(null);
  const [settings, setSettings] = useState<IdeSettings>(DEFAULT_SETTINGS);
  const [workspaces, setWorkspaces] = useState<WorkspaceCandidate[]>([]);
  const [workspacePath, setWorkspacePath] = useState(() => loadProjectTabs()[0]?.path ?? guessFallbackRoot());
  const [daemonPaths, setDaemonPaths] = useState({ homePath: "", workspaceRoot: "" });
  const [messageDraft, setMessageDraft] = useState(
    "Have Claude route this change, let Codex implement the shell, and ask Gemini to review terminal attribution.",
  );
  const [commandDraft, setCommandDraft] = useState("bun run typecheck");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [isProjectLauncherOpen, setIsProjectLauncherOpen] = useState(false);
  const [isSubmittingWorkspace, setIsSubmittingWorkspace] = useState(false);
  const [isSubmittingMessage, setIsSubmittingMessage] = useState(false);
  const [isSubmittingCommand, setIsSubmittingCommand] = useState(false);
  const [isAddAgentOpen, setIsAddAgentOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [activePanelIdByZone, setActivePanelIdByZone] = useState<Record<ShellZone, string | null>>({
    left: "explorer",
    center: "editor",
    right: "thread",
    bottom: "terminal",
  });
  const [draggedPanelId, setDraggedPanelId] = useState<string | null>(null);
  const [colLeftPx, setColLeftPx] = useState<number>(240);
  const [colRightPx, setColRightPx] = useState<number>(420);
  const [rowBottomPx, setRowBottomPx] = useState<number>(200);

  function upsertSession(snapshot: ThreadBootstrap) {
    setSessions((prev) => {
      const next = new Map(prev);
      next.set(snapshot.workspace.rootPath, snapshot);
      return next;
    });
  }

  function applyBootstrap(snapshot: ThreadBootstrap) {
    startTransition(() => {
      upsertSession(snapshot);
      setActiveProjectPath(snapshot.workspace.rootPath);
      setWorkspacePath(snapshot.workspace.rootPath);
      setProjectTabs((current) => {
        const next = [
          { name: snapshot.workspace.name, path: snapshot.workspace.rootPath },
          ...current.filter((tab) => tab.path !== snapshot.workspace.rootPath),
        ];
        return next.slice(0, 8);
      });
    });
  }

  function syncTerminalSnapshot(rootPath: string, terminalSnapshot: TerminalSessionSnapshot) {
    setSessions((prev) => {
      const session = prev.get(rootPath);

      if (!session) {
        return prev;
      }

      const nextSnapshot = structuredClone(session);
      nextSnapshot.workspaceSnapshot.terminals = [
        terminalSnapshot,
        ...nextSnapshot.workspaceSnapshot.terminals.filter((entry) => entry.id !== terminalSnapshot.id),
      ];

      const next = new Map(prev);
      next.set(rootPath, nextSnapshot);
      return next;
    });
  }

  async function loadWorkspaceCandidates() {
    const candidates = await requestJson<WorkspaceCandidate[]>("/workspaces");

    startTransition(() => {
      setWorkspaces(candidates);
    });
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);

    if (view !== "workspace") {
      url.searchParams.set("view", view);
    } else {
      url.searchParams.delete("view");
    }

    window.history.replaceState({}, "", url);
  }, [view]);

  useEffect(() => {
    saveProjectTabs(projectTabs);
  }, [projectTabs]);

  useEffect(() => {
    if (shellLayout) {
      saveShellLayout(shellLayout);
    }
  }, [shellLayout]);

  // Sync Convex settings into local state when they arrive
  useEffect(() => {
    if (convexSettings) {
      const prefs = convexSettings.preferences as Partial<IdeSettings> | undefined;
      if (prefs) {
        setSettings((current) => ({
          ...current,
          apiKeys: {
            anthropic: convexSettings.apiKeys?.anthropic ?? current.apiKeys.anthropic,
            openai: convexSettings.apiKeys?.openai ?? current.apiKeys.openai,
            google: convexSettings.apiKeys?.google ?? current.apiKeys.google,
            openrouter: convexSettings.apiKeys?.openrouter ?? current.apiKeys.openrouter,
          },
          agentRoles: (prefs.agentRoles as AgentRoleConfig[]) ?? current.agentRoles,
          soulDocuments: (prefs.soulDocuments as Record<string, SoulDocument>) ?? current.soulDocuments,
          conversationLoop: prefs.conversationLoop ?? current.conversationLoop,
          appearance: prefs.appearance ?? current.appearance,
          terminal: prefs.terminal ?? current.terminal,
        }));
      }
    }
  }, [convexSettings]);

  // Auto-select first Convex workspace when they load
  useEffect(() => {
    if (!activeConvexWorkspaceId && convexWorkspaces && convexWorkspaces.length > 0) {
      const first = convexWorkspaces[0];
      if (first) {
        setActiveConvexWorkspaceId(first._id as Id<"workspaces">);
      }
    }
  }, [convexWorkspaces, activeConvexWorkspaceId]);

  // Auto-select first thread when threads load
  useEffect(() => {
    if (!activeThreadId && convexThreads && convexThreads.length > 0) {
      setActiveThreadId(convexThreads[0]._id as Id<"threads">);
    }
  }, [convexThreads, activeThreadId]);

  useEffect(() => {
    const theme = settings.appearance.theme;
    if (theme && theme !== "default") {
      document.documentElement.dataset.theme = theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
  }, [settings.appearance.theme]);

  // Probe daemon availability for terminal/file operations
  useEffect(() => {
    let cancelled = false;

    async function probe() {
      try {
        const health = await requestJson<HealthResponse>("/health");
        if (cancelled || !health.ok) return;

        const [candidates, ideSettings] = await Promise.all([
          requestJson<WorkspaceCandidate[]>("/workspaces"),
          requestJson<IdeSettings>("/settings"),
        ]);
        let session: ThreadBootstrap | null = null;

        try {
          session = await requestJson<ThreadBootstrap>("/session");
        } catch (error) {
          if (!isNoSessionOpenError(error)) {
            throw error;
          }

          const initialPath = candidates[0]?.path
            ?? health.userHome
            ?? health.workspaceRoot
            ?? guessFallbackRoot();
          session = await requestJson<ThreadBootstrap>("/workspace/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: initialPath }),
          });
        }

        if (cancelled) return;

        startTransition(() => {
          setConnectionState("live");
          setDaemonPaths({
            homePath: health.userHome ?? "",
            workspaceRoot: health.workspaceRoot,
          });
          setWorkspaces(candidates);
          setSettings(ideSettings);
          setNotice("");
        });
        applyBootstrap(session);
      } catch (error) {
        if (cancelled) return;
        const fallbackPath = projectTabs[0]?.path ?? guessFallbackRoot();
        startTransition(() => {
          const demo = createDemoThreadBootstrap(fallbackPath);
          upsertSession(demo);
          setActiveProjectPath(fallbackPath);
          setWorkspacePath(fallbackPath);
          setConnectionState("fallback");
          setNotice(getErrorMessage(error));
        });
      }
    }

    void probe();
    return () => { cancelled = true; };
  }, []);

  // SSE removed — Convex subscriptions provide real-time updates.
  // Terminal output still streams via daemon WebSocket.

  const currentBootstrap = activeProjectPath
    ? sessions.get(activeProjectPath) ?? null
    : null;
  const activeDocument =
    currentBootstrap?.workspaceSnapshot.documents.find(
      (document) => document.path === currentBootstrap.workspaceSnapshot.activeDocumentPath,
    ) ?? currentBootstrap?.workspaceSnapshot.documents[0] ?? null;
  const workerAgents = currentBootstrap?.agents.filter(
    (agent) => agent.id !== "agent-controller",
  ) ?? [];
  const selectedAgents = workerAgents.filter((agent) => selectedAgentIds.includes(agent.id));
  const hasStreamingRuns = (currentBootstrap?.runs ?? []).some(
    (r) => r.status === "streaming" || r.status === "starting",
  );
  const sessionTokenUsage = (currentBootstrap as { sessionTokenUsage?: TokenUsage } | null)?.sessionTokenUsage;
  const activeWorkspaceRoot =
    (currentBootstrap?.workspace.rootPath ?? workspacePath) || guessFallbackRoot();
  const interactiveTerminal =
    currentBootstrap?.workspaceSnapshot.terminals.find((terminal) => terminal.id === "terminal-main") ??
    null;
  const diagnosticsTerminal =
    currentBootstrap?.workspaceSnapshot.terminals.find(
      (terminal) => terminal.id === "terminal-diagnostics",
    ) ?? null;
  const resolvedShellLayout = useMemo(
    () => (currentBootstrap ? normalizeShellLayout(shellLayout, currentBootstrap.layout) : null),
    [currentBootstrap, shellLayout],
  );

  useEffect(() => {
    if (!currentBootstrap) {
      return;
    }

    setShellLayout(normalizeShellLayout(loadShellLayout(), currentBootstrap.layout));
  }, [currentBootstrap?.workspace.id]);

  function toggleSelectedAgent(agentId: string) {
    setSelectedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  }

  function closeProjectTab(path: string) {
    const remaining = projectTabs.filter((tab) => tab.path !== path);
    setProjectTabs(remaining);

    // Remove the session for the closed tab
    setSessions((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });

    if (activeProjectPath !== path) {
      return;
    }

    const nextTab = remaining[0];

    if (nextTab) {
      setActiveProjectPath(nextTab.path);
      setWorkspacePath(nextTab.path);
      // Refresh from daemon if needed
      void openWorkspace(nextTab.path);
      return;
    }

    setActiveProjectPath(null);
    setIsProjectLauncherOpen(true);
  }

  async function openWorkspace(targetPath: string) {
    const trimmedPath = targetPath.trim();

    if (!trimmedPath) {
      startTransition(() => {
        setNotice("Workspace path is required.");
      });
      return;
    }

    if (sessions.has(trimmedPath)) {
      setActiveProjectPath(trimmedPath);
      setWorkspacePath(trimmedPath);
      setView((current) => (current === "settings" ? "workspace" : current));
    }

    setIsSubmittingWorkspace(true);

    try {
      try {
        const snapshot = await requestJson<ThreadBootstrap>("/workspace/open", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: trimmedPath }),
        });

        applyBootstrap(snapshot);
        startTransition(() => {
          setConnectionState("live");
          setNotice("");
          setView((current) => (current === "settings" ? "workspace" : current));
        });
        await loadWorkspaceCandidates();
        return;
      } catch (error) {
        if (!isDaemonUnavailableError(error)) {
          throw error;
        }
      }

      const demo = createDemoThreadBootstrap(trimmedPath);
      startTransition(() => {
        upsertSession(demo);
        setActiveProjectPath(trimmedPath);
        setWorkspacePath(trimmedPath);
        setProjectTabs((current) => {
          const next = [
            { name: basename(trimmedPath), path: trimmedPath },
            ...current.filter((tab) => tab.path !== trimmedPath),
          ];
          return next.slice(0, 8);
        });
        setNotice("");
        setView((current) => (current === "settings" ? "workspace" : current));
      });
    } catch (error) {
      startTransition(() => {
        setNotice(getErrorMessage(error));
      });
    } finally {
      setIsSubmittingWorkspace(false);
    }
  }

  async function createWorkspace(targetPath: string) {
    setIsSubmittingWorkspace(true);

    try {
      let createdSnapshot: ThreadBootstrap | null = null;

      try {
        createdSnapshot = await requestJson<ThreadBootstrap>("/workspace/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: targetPath }),
        });
      } catch (error) {
        if (!isDaemonUnavailableError(error)) {
          throw error;
        }
      }

      // Create workspace in Convex
      if (userId) {
        const rootPath = createdSnapshot?.workspace.rootPath ?? targetPath;
        const workspaceName = createdSnapshot?.workspace.name ?? basename(targetPath);

        await createWorkspaceMutation({
          userId: userId,
          name: workspaceName,
          rootPath,
        });
      }

      if (createdSnapshot) {
        applyBootstrap(createdSnapshot);
        startTransition(() => {
          setConnectionState("live");
          setNotice("");
          setView("workspace");
        });
        await loadWorkspaceCandidates();
      } else {
        const demo = createDemoThreadBootstrap(targetPath);
        startTransition(() => {
          upsertSession(demo);
          setActiveProjectPath(targetPath);
          setWorkspacePath(targetPath);
          setProjectTabs((current) => {
            const next = [
              { name: basename(targetPath), path: targetPath },
              ...current.filter((tab) => tab.path !== targetPath),
            ];
            return next.slice(0, 8);
          });
          setNotice("");
          setView("workspace");
        });
      }
    } catch (error) {
      startTransition(() => {
        setNotice(getErrorMessage(error));
      });
    } finally {
      setIsSubmittingWorkspace(false);
    }
  }

  async function openDocument(path: string) {
    if (connectionState !== "live") {
      return;
    }

    try {
      const snapshot = await requestJson<ThreadBootstrap>("/documents/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });

      startTransition(() => {
        upsertSession(snapshot);
      });
    } catch (error) {
      startTransition(() => {
        setNotice(getErrorMessage(error));
      });
    }
  }

  async function openInteractiveTerminal(input: {
    cols: number;
    cwd: string;
    rows: number;
    shell: string;
  }) {
    try {
      const snapshot = await requestJson<TerminalSessionSnapshot>("/terminal/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });

      startTransition(() => {
        syncTerminalSnapshot(activeProjectPath ?? activeWorkspaceRoot, snapshot);
        setConnectionState("live");
        setNotice("");
      });
    } catch (error) {
      startTransition(() => {
        if (isDaemonUnavailableError(error)) {
          setConnectionState("fallback");
        }
        setNotice(getErrorMessage(error));
      });
    }
  }

  async function sendTerminalInput(terminalSessionId: string, data: string) {
    try {
      await requestJson<ThreadBootstrap>(
        `/terminal/sessions/${encodeURIComponent(terminalSessionId)}/input`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data }),
        },
      );
      startTransition(() => {
        setConnectionState("live");
      });
    } catch (error) {
      if (isDaemonUnavailableError(error)) {
        startTransition(() => {
          setConnectionState("fallback");
        });
      }

      throw error;
    }
  }

  async function resizeInteractiveTerminal(terminalSessionId: string, cols: number, rows: number) {
    try {
      const snapshot = await requestJson<TerminalSessionSnapshot>(
        `/terminal/sessions/${encodeURIComponent(terminalSessionId)}/resize`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cols, rows }),
        },
      );
      startTransition(() => {
        syncTerminalSnapshot(activeProjectPath ?? activeWorkspaceRoot, snapshot);
        setConnectionState("live");
      });
    } catch (error) {
      if (isDaemonUnavailableError(error)) {
        startTransition(() => {
          setConnectionState("fallback");
        });
      }

      throw error;
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmittingMessage(true);

    try {
      // If we have a Convex thread, append event there
      if (activeThreadId) {
        await appendEventMutation({
          threadId: activeThreadId,
          eventType: "thread.message.created",
          actor: { type: "user", id: userId ? String(userId) : "current-user" },
          payload: {
            messageId: crypto.randomUUID(),
            content: messageDraft,
            format: "markdown",
            requestedAgentIds: selectedAgentIds,
          },
        });
      }

      startTransition(() => {
        setMessageDraft("");
        setNotice("");
      });
    } catch (error) {
      startTransition(() => {
        setNotice(getErrorMessage(error));
      });
    } finally {
      setIsSubmittingMessage(false);
    }
  }

  async function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (connectionState !== "live") {
      return;
    }

    setIsSubmittingCommand(true);

    try {
      await requestJson<{ commandId: string; terminalSessionId: string }>("/terminal/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: commandDraft,
          cwd: activeDocument ? dirname(activeDocument.path) : activeWorkspaceRoot,
          shell: settings.terminal.shell,
        }),
      });
      startTransition(() => {
        setNotice("");
      });
    } catch (error) {
      startTransition(() => {
        setNotice(getErrorMessage(error));
      });
    } finally {
      setIsSubmittingCommand(false);
    }
  }

  // Board/kanban CRUD — local state only (will be backed by Convex in a future pass)
  async function createBoardLane(_input: { color?: string; name: string }) {
    // TODO: Convex kanban table
  }
  async function renameBoardLane(_laneId: string, _input: { color?: string; name?: string }) {
    // TODO: Convex kanban table
  }
  async function createBoardCard(_input: {
    assignedAgentId?: string;
    description?: string;
    fileTags?: Array<{ kind: "file" | "directory"; path: string }>;
    laneId?: string;
    priority?: "low" | "medium" | "high";
    title: string;
  }) {
    // TODO: Convex kanban table
  }
  async function moveBoardCard(_cardId: string, _laneId: string) {
    // TODO: Convex kanban table
  }

  async function saveSettings(nextSettings: IdeSettings) {
    // Save to Convex if we have a userId
    if (userId) {
      try {
        await updateSettingsMutation({
          userId: userId,
          apiKeys: nextSettings.apiKeys,
          preferences: {
            agentRoles: nextSettings.agentRoles,
            soulDocuments: nextSettings.soulDocuments,
            conversationLoop: nextSettings.conversationLoop,
            appearance: nextSettings.appearance,
            terminal: nextSettings.terminal,
          },
        });
      } catch {
        // Fall through to local update
      }
    }

    startTransition(() => {
      setSettings(nextSettings);
      setNotice("Settings saved.");
    });
  }

  const startResizing = useCallback((side: "left" | "right" | "bottom", event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidthLeft = colLeftPx;
    const startWidthRight = colRightPx;
    const startHeightBottom = rowBottomPx;

    document.body.style.cursor = side === "bottom" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";

    function onMove(e: globalThis.MouseEvent) {
      if (side === "left") {
        const delta = e.clientX - startX;
        setColLeftPx(Math.max(48, Math.min(600, startWidthLeft + delta)));
      } else if (side === "right") {
        const delta = startX - e.clientX;
        setColRightPx(Math.max(0, Math.min(600, startWidthRight + delta)));
      } else if (side === "bottom") {
        const delta = startY - e.clientY;
        setRowBottomPx(Math.max(40, Math.min(800, startHeightBottom + delta)));
      }
    }

    function onUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [colLeftPx, colRightPx, rowBottomPx]);

  function dropPanel(panelId: string, zone: ShellZone) {
    setShellLayout((current) => {
      if (!current) return current;
      // Find current zone of panel
      let sourceZone: ShellZone | null = null;
      for (const z of SHELL_ZONES) {
        if (current[z].some(p => p.id === panelId)) {
          sourceZone = z;
          break;
        }
      }

      const next = moveShellPanel(current, panelId, zone, current[zone].length);
      
      // Update active panel if needed
      setActivePanelIdByZone(prev => ({
        ...prev,
        [zone]: panelId,
        ...(sourceZone && sourceZone !== zone && prev[sourceZone] === panelId ? { [sourceZone]: current[sourceZone].find(p => p.id !== panelId)?.id ?? null } : {})
      }));

      return next;
    });
    setDraggedPanelId(null);
  }

  if (!currentBootstrap) {
    return <div>Loading workspace session...</div>;
  }

  const workspaceBootstrap = currentBootstrap;

  function renderZone(zone: ShellZone) {
    const panels = resolvedShellLayout?.[zone] ?? [];
    // Only hide empty zones when nothing is being dragged — keep drop targets visible during drag
    if (panels.length === 0 && zone !== "center" && !draggedPanelId) return null;

    const activeId = activePanelIdByZone[zone];
    const activePanel = panels.find(p => p.id === activeId) ?? panels[0];

    return (
      <div className={`shell-zone shell-zone-${zone}`} style={
        zone === "left" ? { width: colLeftPx } :
        zone === "right" ? { width: colRightPx } :
        zone === "bottom" ? { height: rowBottomPx } :
        {}
      }>
        <div className="panel-container">
          <div className="panel-tabs">
            {panels.map(p => (
              <button
                key={p.id}
                className={`panel-tab ${activePanel?.id === p.id ? "panel-tab-active" : ""}`}
                onClick={() => setActivePanelIdByZone(prev => ({ ...prev, [zone]: p.id }))}
                draggable
                onDragStart={() => setDraggedPanelId(p.id)}
              >
                {p.title}
              </button>
            ))}
            <div
              className={`panel-drop-slot ${draggedPanelId ? "panel-drop-slot-active" : ""}`}
              onDragOver={e => e.preventDefault()}
              onDrop={() => draggedPanelId && dropPanel(draggedPanelId, zone)}
              style={{ flex: 1, minHeight: 24 }}
            />
          </div>
          <div className="panel-content">
            {activePanel && (
              <article className={`panel-shell-card panel-shell-card-${activePanel.id}`}>
                <div className="panel-body">
                  {renderPanelBody(activePanel.id)}
                </div>
              </article>
            )}
          </div>
        </div>
        
        {zone === "left" && <div className="resize-handle resize-handle-vertical resize-handle-left" onMouseDown={e => startResizing("left", e)} />}
        {zone === "right" && <div className="resize-handle resize-handle-vertical resize-handle-right" onMouseDown={e => startResizing("right", e)} />}
        {zone === "bottom" && <div className="resize-handle resize-handle-horizontal resize-handle-bottom" onMouseDown={e => startResizing("bottom", e)} />}
      </div>
    );
  }

  function renderPanelBody(panelId: string) {
    switch (panelId) {
      case "explorer":
        return (
          <>
            <form
              className="action-form"
              onSubmit={(event) => {
                event.preventDefault();
                void openWorkspace(workspacePath);
              }}
            >
              <input
                className="text-input"
                value={workspacePath}
                onChange={(event) => setWorkspacePath(event.target.value)}
                placeholder="Type a workspace path"
              />
              {daemonPaths.homePath ? (
                <button
                  type="button"
                  className="action-button action-button-secondary"
                  onClick={() => setWorkspacePath(daemonPaths.homePath)}
                >
                  Home
                </button>
              ) : null}
              <button
                type="button"
                className="action-button action-button-secondary"
                onClick={() => setIsProjectLauncherOpen(true)}
              >
                Browse
              </button>
              <button className="action-button" type="submit" disabled={isSubmittingWorkspace}>
                {isSubmittingWorkspace ? "Opening..." : "Open"}
              </button>
            </form>
            <div className="workspace-candidate-grid">
              {workspaces.slice(0, 8).map((candidate) => (
                <WorkspaceCandidateButton
                  key={candidate.path}
                  candidate={candidate}
                  currentPath={workspaceBootstrap.workspace.rootPath}
                  onOpen={(path) => {
                    setWorkspacePath(path);
                    void openWorkspace(path);
                  }}
                />
              ))}
            </div>
            <ul className="tree-root">
              {workspaceBootstrap.workspaceSnapshot.tree.map((node) => (
                <TreeNodeView
                  key={node.path}
                  activePath={workspaceBootstrap.workspaceSnapshot.activeDocumentPath}
                  node={node}
                  onOpenFile={(path) => {
                    void openDocument(path);
                  }}
                />
              ))}
            </ul>
          </>
        );
      case "git":
        {
          const git = workspaceBootstrap.workspaceSnapshot.git;

          return (
            <div className="git-panel">
              <section className="git-summary-card">
                <div className="git-summary-top">
                  <div>
                    <span className="eyebrow">active branch</span>
                    <div className="git-branch-name">{git.branch}</div>
                  </div>
                  <div className="git-summary-count-block">
                    <span className="git-summary-count">{git.changedFiles.length}</span>
                    <span className="git-summary-label">
                      {git.changedFiles.length === 1 ? "changed file" : "changed files"}
                    </span>
                  </div>
                </div>
                <p className="git-summary-copy">
                  {git.changedFiles.length > 0
                    ? "Tracked workspace changes are ready for review."
                    : "Working tree is clean. New tracked changes will show up here."}
                </p>
              </section>
              <div className="panel-header panel-header-inline git-panel-header">
                <h2>Changed Files</h2>
                <span>{git.changedFiles.length === 0 ? "clean" : `${git.changedFiles.length} pending`}</span>
              </div>
              {git.changedFiles.length > 0 ? (
                <div className="git-file-list">
                  {git.changedFiles.map((filePath) => {
                    const { name, parent } = splitWorkspaceRelativePath(filePath);

                    return (
                      <article key={filePath} className="git-file-card">
                        <div className="git-file-copy">
                          <span className="git-file-name">{name}</span>
                          <span className="git-file-path">{parent}</span>
                        </div>
                        <span className="git-file-status">changed</span>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="git-empty-state">No tracked file changes yet.</div>
              )}
            </div>
          );
        }
      case "agents":
        return (
          <div className="agent-grid">
            {workspaceBootstrap.agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
            <button
              type="button"
              className="agent-card-add"
              onClick={() => setIsAddAgentOpen(true)}
            >
              <span className="agent-card-add-icon">+</span>
              <span>Add Agent</span>
            </button>
          </div>
        );
      case "editor":
        return (
          <div className="editor-frame">
            {activeDocument ? (
              <>
                <div className="editor-path">{activeDocument.path}</div>
                <pre>{activeDocument.preview}</pre>
              </>
            ) : (
              <div className="editor-empty">
                No document preview available for this workspace yet.
              </div>
            )}
          </div>
        );
      case "thread": {
        const taskGroups = groupEventsByRequest(workspaceBootstrap.events);

        return (
          <>
            <div className="session-token-bar">
              {sessionTokenUsage && sessionTokenUsage.totalTokens > 0 && (
                <span>
                  Session: {formatTokens(sessionTokenUsage.totalTokens)} tokens
                  {sessionTokenUsage.estimatedCostUsd ? ` (~${formatCost(sessionTokenUsage.estimatedCostUsd)})` : ""}
                </span>
              )}
              <button
                type="button"
                className="new-conversation-btn"
                onClick={() => {
                  // Thread clear is handled by Convex — create a new thread
                  if (activeConvexWorkspaceId) {
                    void createThreadMutation({
                      workspaceId: activeConvexWorkspaceId,
                      title: "New Conversation",
                    }).then((newThreadId) => {
                      setActiveThreadId(newThreadId as Id<"threads">);
                    });
                  }
                }}
              >
                New Conversation
              </button>
            </div>
            <div className="chat-thread">
              {taskGroups.map((group, groupIndex) => {
                const groupId = group.userMessage.id;
                const isLastGroup = groupIndex === taskGroups.length - 1;
                const isCollapsed = !isLastGroup && collapsedGroups.has(groupId);
                const agentMessages = group.events.filter(
                  (evt) =>
                    (evt.type === "thread.message.created" && evt.actor.type !== "user") ||
                    evt.type === "handoff.created",
                );
                const agentCount = new Set(agentMessages.map((e) => e.actor.id)).size;

                return (
                  <div key={groupId} className={`task-group ${isCollapsed ? "task-group-collapsed" : ""}`}>
                    {/* User message header — always visible */}
                    <div className="task-group-header">
                      {taskGroups.length > 1 && (
                        <button
                          type="button"
                          className="task-group-toggle"
                          onClick={() => {
                            setCollapsedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(groupId)) next.delete(groupId);
                              else next.add(groupId);
                              return next;
                            });
                          }}
                        >
                          {isCollapsed ? "\u25B6" : "\u25BC"}
                        </button>
                      )}
                      <div className={`chat-message chat-message-${group.userMessage.actor.type === "user" ? "user" : "system"}`}>
                        <span className="chat-sender">{group.userMessage.actor.id}</span>
                        <div className="chat-bubble">
                          {group.userMessage.type === "thread.message.created"
                            ? (group.userMessage as ThreadMessageCreatedEvent).payload.content
                            : eventSummary(group.userMessage)}
                        </div>
                      </div>
                      {isCollapsed && agentCount > 0 && (
                        <span className="task-group-badge">{agentCount} agent{agentCount > 1 ? "s" : ""}</span>
                      )}
                    </div>

                    {/* Collapsible body */}
                    {!isCollapsed && (
                      <div className="task-group-body">
                        {group.thinkingEvent && <ThinkingBlock event={group.thinkingEvent} />}

                        {/* Render conversation rounds if present */}
                        {group.conversationRounds.length > 0 ? (
                          <ConversationRoundsView
                            rounds={group.conversationRounds}
                            dissents={group.dissents}
                            delegations={group.delegations}
                            runs={workspaceBootstrap.runs}
                            conversationCompleted={group.conversationCompleted}
                          />
                        ) : (
                          /* Legacy: flat event rendering when no conversation loop */
                          <AgentMessagesView
                            events={group.events}
                            runs={workspaceBootstrap.runs}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <form
              className="chat-composer"
              onSubmit={(event) => void submitMessage(event)}
            >
              <div className="chat-routing-bar">
                <span className="chat-event-label">Route:</span>
                <button
                  type="button"
                  className={`agent-routing-button ${selectedAgentIds.length === 0 ? "agent-routing-button-active" : ""}`}
                  onClick={() => setSelectedAgentIds([])}
                  style={{ "--agent-color": "var(--color-accent)" } as CSSProperties}
                >
                  <span className="agent-routing-swatch" />
                  <span className="agent-routing-copy">
                    <span className="agent-routing-name">Auto</span>
                    <span className="agent-routing-role">Controller</span>
                  </span>
                </button>
                {workerAgents.map((agent) => (
                  <AgentRoutingButton
                    key={agent.id}
                    agent={agent}
                    isSelected={selectedAgentIds.includes(agent.id)}
                    onToggle={toggleSelectedAgent}
                  />
                ))}
              </div>
              <div className="chat-composer-row" style={{ position: "relative" }}>
                {mentionQuery !== null && (
                  <MentionDropdown
                    agents={workerAgents}
                    query={mentionQuery}
                    position={mentionPos}
                    onSelect={(name) => {
                      const textarea = composerRef.current;
                      if (!textarea) return;
                      const cursorPos = textarea.selectionStart;
                      const before = messageDraft.slice(0, cursorPos);
                      const atIndex = before.lastIndexOf("@");
                      if (atIndex >= 0) {
                        const newDraft = before.slice(0, atIndex) + `@${name} ` + messageDraft.slice(cursorPos);
                        setMessageDraft(newDraft);
                      }
                      setMentionQuery(null);
                    }}
                    onClose={() => setMentionQuery(null)}
                  />
                )}
                <textarea
                  ref={composerRef}
                  className="chat-composer-input"
                  value={messageDraft}
                  onChange={(event) => {
                    const value = event.target.value;
                    setMessageDraft(value);

                    // Check for @mention trigger
                    const cursorPos = event.target.selectionStart;
                    const textBefore = value.slice(0, cursorPos);
                    const atMatch = textBefore.match(/@([\w-]*)$/);
                    if (atMatch) {
                      setMentionQuery(atMatch[1]);
                      const rect = event.target.getBoundingClientRect();
                      setMentionPos({ top: -4, left: 8 });
                    } else {
                      setMentionQuery(null);
                    }
                  }}
                  placeholder="Describe what you want the agents to do... Use @agent to mention"
                  rows={1}
                  onKeyDown={(event) => {
                    if (mentionQuery !== null) return; // Let MentionDropdown handle keys
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (messageDraft.trim() && connectionState === "live" && !isSubmittingMessage) {
                        void submitMessage(event as unknown as FormEvent<HTMLFormElement>);
                      }
                    }
                  }}
                />
                <button
                  className="chat-send-button"
                  type="submit"
                  disabled={
                    connectionState !== "live" || isSubmittingMessage || !messageDraft.trim()
                  }
                >
                  {isSubmittingMessage ? "Sending..." : "Send"}
                </button>
              </div>
              {hasStreamingRuns && (
                <button
                  type="button"
                  className="stop-all-btn"
                  onClick={() => {
                    // TODO: Cancel runs via Convex mutation
                    setNotice("Stopping agents...");
                  }}
                >
                  Stop All Agents
                </button>
              )}
            </form>
          </>
        );
      }
      case "tasks":
        return (
          <>
            <div className="panel-header panel-header-inline">
              <h2>Tasks</h2>
              <span>{workspaceBootstrap.tasks.length} tracked</span>
            </div>
            <div className="stack-list">
              {workspaceBootstrap.tasks.map((task) => (
                <article key={task.id} className="stack-card">
                  <header>
                    <span>{task.title}</span>
                    <span className={`status-dot ${taskTone(task)}`}>{task.status}</span>
                  </header>
                  <p>{task.goal}</p>
                </article>
              ))}
            </div>

            <div className="panel-header panel-header-inline">
              <h2>Runs</h2>
              <span>{workspaceBootstrap.runs.length} tracked</span>
            </div>
            <div className="stack-list">
              {workspaceBootstrap.runs.map((run) => (
                <article key={run.id} className="stack-card">
                  <header>
                    <span>{run.agentId}</span>
                    <span className={`status-dot ${runTone(run)}`}>{run.status}</span>
                  </header>
                  <p>{run.summary ?? "Waiting for controller dispatch."}</p>
                </article>
              ))}
            </div>
          </>
        );
      case "terminal":
        return (
          <TerminalPane
            connectionState={connectionState}
            cwd={activeDocument ? dirname(activeDocument.path) : activeWorkspaceRoot}
            fontSize={settings.terminal.fontSize}
            onOpenSession={openInteractiveTerminal}
            onResizeSession={resizeInteractiveTerminal}
            onSendInput={sendTerminalInput}
            shell={settings.terminal.shell}
            terminal={interactiveTerminal}
          />
        );
      case "diagnostics":
        return (
          <div className="diagnostics-layout">
            <div className="diagnostics-grid">
              <article className="stack-card">
                <header>
                  <span>Connection</span>
                  <span className={`status-pill status-pill-${connectionState}`}>
                    {connectionState}
                  </span>
                </header>
                <div className="stack-card-body">
                  <div className="stack-card-row">
                    <span className="stack-card-label">Workspace</span>
                    <span className="stack-card-value">{workspaceBootstrap.workspace.rootPath}</span>
                  </div>
                  <div className="stack-card-row">
                    <span className="stack-card-label">Shell</span>
                    <span className="stack-card-value">{settings.terminal.shell}</span>
                  </div>
                  <div className="stack-card-row">
                    <span className="stack-card-label">Active file</span>
                    <span className="stack-card-value">{activeDocument?.path ?? "none"}</span>
                  </div>
                </div>
              </article>
              <article className="stack-card">
                <header>
                  <span>Quick Run</span>
                  <span className="stack-card-badge">{diagnosticsTerminal?.commands.length ?? 0} commands</span>
                </header>
                <form className="action-form" onSubmit={(event) => void submitCommand(event)}>
                  <input
                    className="text-input"
                    value={commandDraft}
                    onChange={(event) => setCommandDraft(event.target.value)}
                    placeholder="Run a command..."
                  />
                  <button
                    className="action-button"
                    type="submit"
                    disabled={
                      connectionState !== "live" || isSubmittingCommand || !commandDraft.trim()
                    }
                  >
                    {isSubmittingCommand ? "Running..." : "Run"}
                  </button>
                </form>
              </article>
            </div>
            <div className="diagnostics-output">
              {diagnosticsTerminal ? (
                <TerminalCard terminal={diagnosticsTerminal} />
              ) : (
                <div className="empty-note">
                  Command output will appear here after the first run.
                </div>
              )}
            </div>
          </div>
        );
      case "members":
        return (
          <MemberPanel
            workspaceId={activeConvexWorkspaceId ?? undefined}
            currentUserId={userId ?? undefined}
            activeThreadId={activeThreadId ?? undefined}
          />
        );
      case "approvals":
        return (
          <ApprovalPanel
            workspaceId={activeConvexWorkspaceId ?? undefined}
          />
        );
      case "harnesses":
        return (
          <div className="stack-list">
            <div className="panel-header panel-header-inline">
              <h2>Harnesses</h2>
              <span>{harnesses?.length ?? 0} configured</span>
            </div>
            {harnesses?.map((h) => (
              <article key={h._id} className="stack-card">
                <header>
                  <span style={{ color: h.color }}>{h.name}</span>
                  <span className="status-dot">{h.approvalPolicy}</span>
                </header>
                <p>{h.description}</p>
                <span className="chip">{h.provider}/{h.model}</span>
              </article>
            )) ?? <div className="empty-note">No harnesses configured.</div>}
          </div>
        );
      default:
        return <div className="empty-note">Panel is not implemented yet.</div>;
    }
  }

  return (
    <div
      className="app-shell"
      data-density={settings.appearance.density}
    >
      <header className="topbar">
        <h1>{currentBootstrap.thread.title}</h1>
        <div className="topbar-meta">
          <span className={`status-pill status-pill-${connectionState}`}>
            {connectionState === "live" ? "live" : connectionState}
          </span>
          <span>{currentBootstrap.workspaceSnapshot.git.branch}</span>
        </div>
      </header>
      {notice ? <div className="notice-banner">{notice}</div> : null}

      <div className="shell-container">
        <aside className="activity-bar">
          <div className="activity-bar-top">
            <button
              type="button"
              className={`activity-bar-item ${view === "workspace" ? "activity-bar-item-active" : ""}`}
              onClick={() => setView("workspace")}
              title="Workspace"
              aria-label="Workspace"
            >
              <FontAwesomeIcon icon={VIEW_ICONS.workspace} fixedWidth />
            </button>
            <button
              type="button"
              className={`activity-bar-item ${view === "kanban" ? "activity-bar-item-active" : ""}`}
              onClick={() => setView("kanban")}
              title="Kanban"
              aria-label="Kanban"
            >
              <FontAwesomeIcon icon={VIEW_ICONS.kanban} fixedWidth />
            </button>
            <button
              type="button"
              className={`activity-bar-item ${view === "pipelines" ? "activity-bar-item-active" : ""}`}
              onClick={() => setView("pipelines")}
              title="Pipelines"
              aria-label="Pipelines"
            >
              <FontAwesomeIcon icon={VIEW_ICONS.pipelines} fixedWidth />
            </button>
            <button
              type="button"
              className={`activity-bar-item ${view === "souls" ? "activity-bar-item-active" : ""}`}
              onClick={() => setView("souls")}
              title="Soul Editor"
              aria-label="Soul Editor"
            >
              <FontAwesomeIcon icon={VIEW_ICONS.souls} fixedWidth />
            </button>
            <button
              type="button"
              className={`activity-bar-item ${view === "terminals" ? "activity-bar-item-active" : ""}`}
              onClick={() => setView("terminals")}
              title="Terminal Workspace"
              aria-label="Terminal Workspace"
            >
              <FontAwesomeIcon icon={VIEW_ICONS.terminals} fixedWidth />
            </button>
            <button
              type="button"
              className={`activity-bar-item ${view === "discovery" ? "activity-bar-item-active" : ""}`}
              onClick={() => setView("discovery")}
              title="Discover"
              aria-label="Discover"
            >
              <FontAwesomeIcon icon={VIEW_ICONS.discovery} fixedWidth />
            </button>
            <button
              type="button"
              className={`activity-bar-item ${view === "profile" ? "activity-bar-item-active" : ""}`}
              onClick={() => { setProfileUserId(userId); setView("profile"); }}
              title="Profile"
              aria-label="Profile"
            >
              <FontAwesomeIcon icon={VIEW_ICONS.profile} fixedWidth />
            </button>
            <button
              type="button"
              className={`activity-bar-item ${view === "settings" ? "activity-bar-item-active" : ""}`}
              onClick={() => setView("settings")}
              title="Settings"
              aria-label="Settings"
            >
              <FontAwesomeIcon icon={VIEW_ICONS.settings} fixedWidth />
            </button>
          </div>
          
          <div className="activity-bar-separator" />

          {view === "workspace" && resolvedShellLayout?.left.map(p => (
            <button
              key={p.id}
              className={`activity-bar-item ${activePanelIdByZone.left === p.id ? "activity-bar-item-active" : ""}`}
              onClick={() => setActivePanelIdByZone(prev => ({ 
                ...prev, 
                left: p.id 
              }))}
              title={p.title}
              aria-label={p.title}
            >
              {PANEL_ICONS[p.id] ? (
                <FontAwesomeIcon icon={PANEL_ICONS[p.id]} fixedWidth />
              ) : (
                <span className="activity-bar-fallback-label">{p.id.slice(0, 1).toUpperCase()}</span>
              )}
            </button>
          ))}
        </aside>
        
        <main className="shell-main-content">
          {view === "settings" ? (
            <SettingsView
              onSave={saveSettings}
              onThemePreview={(themeId) => {
                if (themeId && themeId !== "default") {
                  document.documentElement.dataset.theme = themeId;
                } else {
                  delete document.documentElement.dataset.theme;
                }
              }}
              settings={settings}
            />
          ) : view === "pipelines" ? (
            <PipelineEditor
              agents={currentBootstrap.agents}
              workspaceId={activeConvexWorkspaceId ?? undefined}
              currentUserId={userId ? String(userId) : undefined}
            />
          ) : view === "souls" ? (
            <SoulEditor
              workspaceId={activeConvexWorkspaceId ?? undefined}
            />
          ) : view === "terminals" ? (
            <TerminalWorkspace
              workspacePath={activeWorkspaceRoot}
              connectionState={connectionState}
              cwd={activeDocument ? dirname(activeDocument.path) : activeWorkspaceRoot}
              fontSize={settings.terminal.fontSize}
              shell={settings.terminal.shell}
              terminals={currentBootstrap.workspaceSnapshot.terminals}
              onOpenSession={openInteractiveTerminal}
              onResizeSession={resizeInteractiveTerminal}
              onSendInput={sendTerminalInput}
              activeView={view}
              onNavigateView={(nextView) => {
                if (nextView === "profile") {
                  setProfileUserId(userId);
                }
                setView(nextView);
              }}
              onBackToIde={() => setView("workspace")}
            />
          ) : view === "discovery" ? (
            <DiscoveryView
              currentUserId={userId ?? undefined}
              currentWorkspaceId={activeConvexWorkspaceId ?? undefined}
              onNavigateToProfile={(uid) => {
                setProfileUserId(uid);
                setView("profile");
              }}
            />
          ) : view === "profile" ? (
            <ProfileView
              userId={profileUserId ?? userId ?? undefined}
              isOwnProfile={!profileUserId || profileUserId === userId}
            />
          ) : view === "kanban" ? (
            <KanbanView
              agents={currentBootstrap.agents}
              board={currentBootstrap.board}
              onCreateCard={createBoardCard}
              onCreateLane={createBoardLane}
              onMoveCard={moveBoardCard}
              onRenameLane={renameBoardLane}
            />
          ) : (
            <>
              {renderZone("left")}
              
              <div className="shell-zone-center">
                <div className="shell-center-stack">
                  <div className="project-tab-strip">
                    {projectTabs.map((tab) => (
                      <div
                        key={tab.path}
                        className={`project-tab ${
                          activeProjectPath === tab.path ? "project-tab-active" : ""
                        }`}
                      >
                        <button
                          type="button"
                          className="project-tab-button"
                          onClick={() => {
                            void openWorkspace(tab.path);
                          }}
                        >
                          {tab.name || basename(tab.path)}
                        </button>
                        <button
                          type="button"
                          className="project-tab-close"
                          onClick={() => closeProjectTab(tab.path)}
                        >
                          x
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="project-tab-add"
                      onClick={() => setIsProjectLauncherOpen(true)}
                    >
                      +
                    </button>
                  </div>

                  <div className="workspace-social-strip">
                    <button
                      type="button"
                      className="workspace-social-card"
                      onClick={() => setView("discovery")}
                    >
                      <span className="workspace-social-icon" aria-hidden="true">
                        <FontAwesomeIcon icon={VIEW_ICONS.discovery} fixedWidth />
                      </span>
                      <span className="workspace-social-copy">
                        <span className="workspace-social-title">Discover the community</span>
                        <span className="workspace-social-description">
                          Browse public projects, pipelines, harnesses, and soul documents.
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="workspace-social-card"
                      onClick={() => {
                        setProfileUserId(userId);
                        setView("profile");
                      }}
                    >
                      <span className="workspace-social-icon" aria-hidden="true">
                        <FontAwesomeIcon icon={VIEW_ICONS.profile} fixedWidth />
                      </span>
                      <span className="workspace-social-copy">
                        <span className="workspace-social-title">Build your profile</span>
                        <span className="workspace-social-description">
                          Update your bio, review published work, and manage starred artifacts.
                        </span>
                      </span>
                    </button>
                  </div>

                  <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    {renderZone("center")}
                  </div>
                  {renderZone("bottom")}
                </div>
              </div>

              {renderZone("right")}
            </>
          )}
        </main>
      </div>
      <ProjectLauncher
        onClose={() => setIsProjectLauncherOpen(false)}
        onCreateProject={createWorkspace}
        onOpenProject={openWorkspace}
        open={isProjectLauncherOpen}
        workspaceCandidates={workspaces}
      />
      {isAddAgentOpen && (
        <AddAgentModal
          onClose={() => setIsAddAgentOpen(false)}
          onSave={async (role) => {
            const next = { ...settings, agentRoles: [...settings.agentRoles, role] };
            await saveSettings(next);
            setIsAddAgentOpen(false);
          }}
        />
      )}

      {/* Floating chat — always available */}
      <FloatingChat workspaceId={activeConvexWorkspaceId ?? undefined} />

      {/* Approval/conflict notification badge */}
      {((pendingApprovals && pendingApprovals.length > 0) || (activeConflicts && activeConflicts.length > 0)) && (
        <div
          style={{
            position: "fixed",
            top: 8,
            right: 8,
            zIndex: 9000,
            display: "flex",
            gap: 6,
          }}
        >
          {pendingApprovals && pendingApprovals.length > 0 && (
            <button
              type="button"
              className="action-button"
              style={{
                fontSize: "0.72rem",
                padding: "4px 10px",
                background: "var(--color-warning, #f59e0b)",
                border: "none",
                borderRadius: 4,
                color: "#000",
                cursor: "pointer",
                fontWeight: 600,
              }}
              onClick={() => setView("workspace")}
              title="Pending approvals"
            >
              {pendingApprovals.length} approval{pendingApprovals.length > 1 ? "s" : ""} pending
            </button>
          )}
          {activeConflicts && activeConflicts.length > 0 && (
            <button
              type="button"
              className="action-button"
              style={{
                fontSize: "0.72rem",
                padding: "4px 10px",
                background: "var(--color-error, #ef4444)",
                border: "none",
                borderRadius: 4,
                color: "#fff",
                cursor: "pointer",
                fontWeight: 600,
              }}
              onClick={() => setView("workspace")}
              title="Active conflicts"
            >
              {activeConflicts.length} conflict{activeConflicts.length > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
