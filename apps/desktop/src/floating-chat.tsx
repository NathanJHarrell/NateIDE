import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from "react";
import Markdown from "react-markdown";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  useThreads,
  useEvents,
  useAppendEvent,
  useCreateThread,
} from "./convex-hooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = {
  id: string;
  sender: "user" | "agent" | "system";
  senderName: string;
  content: string;
  timestamp: string;
};

type DragState = {
  isDragging: boolean;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type WorkflowContext = {
  currentView: string;
  activeProjectPath?: string;
};

const PAGE_CONTEXT_HINTS: Record<string, string> = {
  workspace: "The user is in the main code editor workspace. They may need help with code, files, or git operations.",
  kanban: "The user is viewing the Kanban board for task management. They may want help creating, organizing, or prioritizing tasks.",
  settings: "The user is on the Settings page configuring IDE preferences, agent roles, or API keys.",
  pipelines: "The user is in the Pipeline Editor, designing DAG-based agent/tool orchestration workflows with nodes and edges. Help them build effective custom pipelines.",
  souls: "The user is editing Soul Documents that define agent personality and behavior guidelines.",
  discovery: "The user is browsing the Discovery page, exploring public projects, harnesses, pipelines, and souls shared by the community.",
  profile: "The user is viewing their profile page with their projects, harnesses, and social activity.",
  terminals: "The user is in the multi-terminal workspace managing shell sessions.",
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 500;

const styles = {
  toggleButton: {
    position: "fixed" as const,
    bottom: 24,
    right: 24,
    width: 52,
    height: 52,
    borderRadius: "50%",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-accent)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.04)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
    fontSize: 22,
    lineHeight: 1,
  } satisfies CSSProperties,

  toggleButtonHover: {
    transform: "scale(1.08)",
    boxShadow: "0 6px 28px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(94, 165, 232, 0.15)",
  } satisfies CSSProperties,

  toggleButtonActive: {
    background: "var(--color-accent)",
    color: "var(--color-background)",
    border: "1px solid var(--color-accent)",
  } satisfies CSSProperties,

  activityPulse: {
    position: "absolute" as const,
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "var(--color-success)",
    border: "2px solid var(--color-surface)",
    animation: "floating-chat-pulse 2s ease-in-out infinite",
  } satisfies CSSProperties,

  panel: {
    position: "fixed" as const,
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    borderRadius: "var(--panel-radius)",
    border: "1px solid var(--color-panel-border)",
    background: "var(--color-panel)",
    boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03)",
    zIndex: 9998,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    transition: "opacity 0.2s ease, transform 0.2s ease",
  } satisfies CSSProperties,

  panelHidden: {
    opacity: 0,
    transform: "translateY(16px) scale(0.97)",
    pointerEvents: "none" as const,
  } satisfies CSSProperties,

  panelVisible: {
    opacity: 1,
    transform: "translateY(0) scale(1)",
    pointerEvents: "auto" as const,
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: "1px solid var(--color-border)",
    cursor: "grab",
    userSelect: "none" as const,
    flexShrink: 0,
  } satisfies CSSProperties,

  headerTitle: {
    fontSize: "0.78rem",
    fontWeight: 500,
    color: "var(--color-text-bright)",
    letterSpacing: "0.01em",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    flex: 1,
  } satisfies CSSProperties,

  headerControls: {
    display: "flex",
    gap: 4,
  } satisfies CSSProperties,

  headerButton: {
    width: 26,
    height: 26,
    borderRadius: 4,
    border: "none",
    background: "transparent",
    color: "var(--color-text-dim)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.72rem",
    transition: "background 0.1s, color 0.1s",
  } satisfies CSSProperties,

  threadSelector: {
    padding: "6px 14px",
    borderBottom: "1px solid var(--color-border)",
    flexShrink: 0,
  } satisfies CSSProperties,

  threadSelect: {
    width: "100%",
    padding: "5px 8px",
    borderRadius: 4,
    border: "1px solid var(--color-input-border)",
    background: "var(--color-input)",
    color: "var(--color-text)",
    fontSize: "0.72rem",
    outline: "none",
    cursor: "pointer",
  } satisfies CSSProperties,

  messageList: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  } satisfies CSSProperties,

  messageRow: (isUser: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: isUser ? "flex-end" : "flex-start",
    maxWidth: "88%",
    alignSelf: isUser ? "flex-end" : "flex-start",
  }),

  messageSender: {
    fontSize: "0.62rem",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 3,
    color: "var(--color-text-dim)",
  } satisfies CSSProperties,

  messageBubble: (isUser: boolean): CSSProperties => ({
    padding: "8px 12px",
    borderRadius: 8,
    fontSize: "0.78rem",
    lineHeight: 1.5,
    background: isUser
      ? "rgba(94, 165, 232, 0.12)"
      : "var(--color-surface-alt)",
    border: `1px solid ${isUser ? "rgba(94, 165, 232, 0.15)" : "var(--color-border)"}`,
    color: "var(--color-text)",
    wordBreak: "break-word",
  }),

  messageBubbleMarkdown: {
    "& p": { margin: 0 },
    "& p + p": { marginTop: 8 },
    "& code": {
      fontFamily: "var(--font-mono)",
      fontSize: "0.72rem",
      background: "rgba(255, 255, 255, 0.04)",
      padding: "1px 4px",
      borderRadius: 3,
    },
    "& pre": {
      background: "rgba(0, 0, 0, 0.3)",
      padding: 8,
      borderRadius: 4,
      overflowX: "auto",
      margin: "4px 0",
    },
  },

  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    color: "var(--color-text-dimmer)",
    fontSize: "0.78rem",
    gap: 8,
    padding: 24,
    textAlign: "center" as const,
  } satisfies CSSProperties,

  inputArea: {
    padding: "10px 14px",
    borderTop: "1px solid var(--color-border)",
    flexShrink: 0,
  } satisfies CSSProperties,

  inputRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
  } satisfies CSSProperties,

  textInput: {
    flex: 1,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--color-input-border)",
    background: "var(--color-input)",
    color: "var(--color-text)",
    fontSize: "0.78rem",
    lineHeight: 1.4,
    outline: "none",
    resize: "none" as const,
    fontFamily: "var(--font-ui)",
    minHeight: 36,
    maxHeight: 100,
  } satisfies CSSProperties,

  sendButton: {
    padding: "8px 14px",
    borderRadius: 6,
    border: "none",
    background: "var(--color-accent)",
    color: "#fff",
    fontSize: "0.72rem",
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.02em",
    transition: "opacity 0.1s",
    whiteSpace: "nowrap" as const,
    height: 36,
  } satisfies CSSProperties,

  sendButtonDisabled: {
    opacity: 0.4,
    cursor: "default",
  } satisfies CSSProperties,

  shortcutHint: {
    fontSize: "0.58rem",
    color: "var(--color-text-dimmest)",
    marginTop: 4,
    textAlign: "right" as const,
  } satisfies CSSProperties,
} as const;

// Inject keyframes for the activity pulse animation
const KEYFRAMES_ID = "floating-chat-keyframes";

function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(KEYFRAMES_ID)) return;

  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes floating-chat-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }

    .floating-chat-message-content p {
      margin: 0;
    }
    .floating-chat-message-content p + p {
      margin-top: 8px;
    }
    .floating-chat-message-content code {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      background: rgba(255, 255, 255, 0.04);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .floating-chat-message-content pre {
      background: rgba(0, 0, 0, 0.3);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 4px 0;
    }
    .floating-chat-message-content pre code {
      background: none;
      padding: 0;
    }
    .floating-chat-message-content ul,
    .floating-chat-message-content ol {
      margin: 4px 0;
      padding-left: 18px;
    }
    .floating-chat-message-content blockquote {
      margin: 4px 0;
      padding-left: 10px;
      border-left: 2px solid var(--color-border);
      color: var(--color-text-dim);
    }
    .floating-chat-message-content a {
      color: var(--color-accent);
      text-decoration: none;
    }
    .floating-chat-message-content a:hover {
      text-decoration: underline;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Chat bubble SVG icon
// ---------------------------------------------------------------------------

function ChatIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helper: extract messages from Convex events
// ---------------------------------------------------------------------------

function extractMessages(events: unknown[] | undefined | null): ChatMessage[] {
  if (!events || !Array.isArray(events)) return [];

  const messages: ChatMessage[] = [];

  for (const evt of events) {
    const e = evt as Record<string, unknown>;
    if (e.type !== "thread.message.created") continue;

    const actor = e.actor as { type: string; id: string } | undefined;
    const payload = e.payload as { messageId?: string; content?: string } | undefined;

    if (!payload?.content) continue;

    const isUser = actor?.type === "user";
    const isSystem = actor?.type === "system";

    messages.push({
      id: payload.messageId ?? (e._id as string) ?? String(e.seq),
      sender: isUser ? "user" : isSystem ? "system" : "agent",
      senderName: isUser
        ? "You"
        : isSystem
          ? "System"
          : actor?.id ?? "Agent",
      content: payload.content,
      timestamp: (e.ts as string) ?? "",
    });
  }

  return messages;
}

// ---------------------------------------------------------------------------
// FloatingChat component
// ---------------------------------------------------------------------------

export function FloatingChat({
  workspaceId,
  workflowContext,
}: {
  workspaceId?: Id<"workspaces">;
  workflowContext?: WorkflowContext;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<Id<"threads"> | null>(null);
  const [hasActivity, setHasActivity] = useState(false);
  const [buttonHover, setButtonHover] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: -1, y: -1 });
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Convex hooks
  const threads = useThreads(workspaceId);
  const eventsResult = useEvents(selectedThreadId ?? undefined);
  const appendEvent = useAppendEvent();
  const createThread = useCreateThread();

  // Extract messages from events
  const events = eventsResult as { page?: unknown[] } | unknown[] | undefined;
  const rawPage = events && typeof events === "object" && "page" in events
    ? (events as { page: unknown[] }).page
    : Array.isArray(events)
      ? events
      : undefined;
  const messages = extractMessages(rawPage);

  // Inject CSS keyframes
  useEffect(() => {
    ensureKeyframes();
  }, []);

  // Auto-select first thread when threads load
  useEffect(() => {
    if (!selectedThreadId && threads && threads.length > 0) {
      setSelectedThreadId(threads[0]._id as Id<"threads">);
    }
  }, [threads, selectedThreadId]);

  // Default panel position (bottom-right, above the toggle button)
  useEffect(() => {
    if (panelPosition.x === -1) {
      setPanelPosition({
        x: window.innerWidth - PANEL_WIDTH - 24,
        y: window.innerHeight - PANEL_HEIGHT - 90,
      });
    }
  }, [panelPosition.x]);

  // Scroll to bottom on new messages
  useEffect(() => {
    const el = messageListRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Simulate activity (pulse) when agents are responding
  useEffect(() => {
    if (!isOpen && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.sender === "agent") {
        setHasActivity(true);
        const timeout = setTimeout(() => setHasActivity(false), 5000);
        return () => clearTimeout(timeout);
      }
    }
    return undefined;
  }, [messages.length, isOpen]);

  // Keyboard shortcut: Cmd/Ctrl+Shift+C
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "C") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      // Esc to close when panel is open
      if (e.key === "Escape" && isOpen) {
        const active = document.activeElement;
        if (panelRef.current?.contains(active) || active === document.body) {
          setIsOpen(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Drag handling
  const handleDragStart = useCallback(
    (e: ReactMouseEvent) => {
      // Only left-click
      if (e.button !== 0) return;
      e.preventDefault();
      setDragState({
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        originX: panelPosition.x,
        originY: panelPosition.y,
      });
    },
    [panelPosition],
  );

  useEffect(() => {
    if (!dragState.isDragging) return;

    function handleMouseMove(e: globalThis.MouseEvent) {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      setPanelPosition({
        x: Math.max(0, Math.min(window.innerWidth - PANEL_WIDTH, dragState.originX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - PANEL_HEIGHT, dragState.originY + dy)),
      });
    }

    function handleMouseUp() {
      setDragState((prev) => ({ ...prev, isDragging: false }));
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState]);

  // Send message
  const handleSend = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed) return;

      let threadId = selectedThreadId;

      // Create a thread if none selected and we have a workspace
      if (!threadId && workspaceId) {
        try {
          threadId = await createThread({
            workspaceId,
            title: trimmed.slice(0, 80),
          }) as Id<"threads">;
          setSelectedThreadId(threadId);
        } catch {
          // Thread creation failed — fall through
          return;
        }
      }

      if (!threadId) return;

      setInputValue("");

      try {
        await appendEvent({
          threadId,
          eventType: "thread.message.created",
          actor: { type: "user", id: "current-user" },
          payload: {
            messageId: crypto.randomUUID(),
            content: trimmed,
            format: "markdown",
            ...(workflowContext && {
              workflowContext: {
                currentView: workflowContext.currentView,
                activeProjectPath: workflowContext.activeProjectPath,
                pageHint: PAGE_CONTEXT_HINTS[workflowContext.currentView] ?? "",
              },
            }),
          },
        });
      } catch {
        // Restore the message on failure
        setInputValue(trimmed);
      }
    },
    [inputValue, selectedThreadId, workspaceId, appendEvent, createThread, workflowContext],
  );

  // Handle Enter to send (Shift+Enter for newline)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Toggle
  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Thread switcher
  const handleThreadChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === "__new__") {
        setSelectedThreadId(null);
        setInputValue("");
      } else {
        setSelectedThreadId(val as Id<"threads">);
      }
    },
    [],
  );

  // Button styles
  const buttonStyle: CSSProperties = {
    ...styles.toggleButton,
    ...(buttonHover ? styles.toggleButtonHover : {}),
    ...(isOpen ? styles.toggleButtonActive : {}),
  };

  // Panel styles
  const panelStyle: CSSProperties = {
    ...styles.panel,
    ...(isOpen ? styles.panelVisible : styles.panelHidden),
    left: panelPosition.x,
    top: panelPosition.y,
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        type="button"
        style={buttonStyle}
        onClick={togglePanel}
        onMouseEnter={() => setButtonHover(true)}
        onMouseLeave={() => setButtonHover(false)}
        title="Toggle chat (Ctrl+Shift+C)"
        aria-label="Toggle floating chat"
      >
        {isOpen ? <CloseIcon /> : <ChatIcon />}
        {hasActivity && !isOpen && <span style={styles.activityPulse} />}
      </button>

      {/* Chat panel */}
      <div ref={panelRef} style={panelStyle}>
        {/* Header — draggable */}
        <div
          style={{
            ...styles.header,
            cursor: dragState.isDragging ? "grabbing" : "grab",
          }}
          onMouseDown={handleDragStart}
        >
          <span style={styles.headerTitle}>
            {selectedThreadId
              ? threads?.find((t) => t._id === selectedThreadId)?.title ?? "Chat"
              : "New Thread"}
          </span>
          <div style={styles.headerControls}>
            <button
              type="button"
              style={styles.headerButton}
              onClick={() => setIsOpen(false)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--color-hover)";
                e.currentTarget.style.color = "var(--color-text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--color-text-dim)";
              }}
              title="Minimize"
            >
              <MinimizeIcon />
            </button>
          </div>
        </div>

        {/* Thread selector */}
        {threads && threads.length > 0 && (
          <div style={styles.threadSelector}>
            <select
              style={styles.threadSelect}
              value={selectedThreadId ?? "__new__"}
              onChange={handleThreadChange}
            >
              <option value="__new__">+ New thread</option>
              {threads.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.title || `Thread ${String(t._id).slice(-6)}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Messages */}
        <div ref={messageListRef} style={styles.messageList}>
          {messages.length === 0 ? (
            <div style={styles.emptyState}>
              <ChatIcon size={32} />
              <span>No messages yet</span>
              <span style={{ fontSize: "0.68rem" }}>
                {selectedThreadId
                  ? "Start the conversation below."
                  : "Type a message to create a new thread."}
              </span>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.sender === "user";
              return (
                <div key={msg.id} style={styles.messageRow(isUser)}>
                  <span style={styles.messageSender}>{msg.senderName}</span>
                  <div
                    className="floating-chat-message-content"
                    style={styles.messageBubble(isUser)}
                  >
                    <Markdown>{msg.content}</Markdown>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input area */}
        <div style={styles.inputArea}>
          <form style={styles.inputRow} onSubmit={handleSend}>
            <textarea
              ref={inputRef}
              style={styles.textInput}
              placeholder={
                selectedThreadId
                  ? "Type a message..."
                  : workspaceId
                    ? "Type to start a new thread..."
                    : "Select a workspace first"
              }
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={!workspaceId && !selectedThreadId}
            />
            <button
              type="submit"
              style={{
                ...styles.sendButton,
                ...(!inputValue.trim() ? styles.sendButtonDisabled : {}),
              }}
              disabled={!inputValue.trim()}
            >
              Send
            </button>
          </form>
          <div style={styles.shortcutHint}>
            Enter to send &middot; Shift+Enter for newline &middot; Ctrl+Shift+C to toggle
          </div>
        </div>
      </div>
    </>
  );
}
