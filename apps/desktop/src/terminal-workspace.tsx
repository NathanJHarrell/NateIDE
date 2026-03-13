import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBookOpen,
  faCompass,
  faDesktop,
  faDiagramProject,
  faGear,
  faTableColumns,
  faTerminal,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import type { TerminalSessionSnapshot } from "@nateide/workspace";
import { TerminalPane } from "./terminal-pane";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionState = "loading" | "live" | "fallback";

type Rect = {
  /** Percentage 0–100 */
  x: number;
  y: number;
  w: number;
  h: number;
};

type TerminalInstance = {
  id: string;
  label: string;
  rect: Rect;
  terminalSnapshot: TerminalSessionSnapshot | null;
};

type TerminalWorkspaceProps = {
  workspacePath: string;
  connectionState: ConnectionState;
  cwd: string;
  fontSize: number;
  shell: string;
  terminals: TerminalSessionSnapshot[];
  onOpenSession: (input: {
    cols: number;
    cwd: string;
    id?: string;
    rows: number;
    shell: string;
  }) => Promise<void>;
  onResizeSession: (terminalSessionId: string, cols: number, rows: number) => Promise<void>;
  onSendInput: (terminalSessionId: string, data: string) => Promise<void>;
  onBackToIde?: () => void;
  activeView?: TerminalWorkspaceView;
  onNavigateView?: (view: TerminalWorkspaceView) => void;
};

type TerminalWorkspaceView =
  | "workspace"
  | "kanban"
  | "pipelines"
  | "souls"
  | "terminals"
  | "discovery"
  | "profile"
  | "settings";

const TERMINAL_WORKSPACE_NAV_ITEMS: Array<{
  id: TerminalWorkspaceView;
  icon: IconDefinition;
  label: string;
}> = [
  { id: "workspace", icon: faDesktop, label: "Workspace" },
  { id: "kanban", icon: faTableColumns, label: "Kanban" },
  { id: "pipelines", icon: faDiagramProject, label: "Pipelines" },
  { id: "souls", icon: faBookOpen, label: "Soul Editor" },
  { id: "terminals", icon: faTerminal, label: "Terminal Workspace" },
  { id: "discovery", icon: faCompass, label: "Discover" },
  { id: "profile", icon: faUser, label: "Profile" },
  { id: "settings", icon: faGear, label: "Settings" },
];

// ---------------------------------------------------------------------------
// Layout presets
// ---------------------------------------------------------------------------

type LayoutPreset = {
  label: string;
  cols: number;
  rows: number;
};

const LAYOUT_PRESETS: LayoutPreset[] = [
  { label: "1", cols: 1, rows: 1 },
  { label: "1×2", cols: 1, rows: 2 },
  { label: "2×1", cols: 2, rows: 1 },
  { label: "2×2", cols: 2, rows: 2 },
  { label: "3×2", cols: 3, rows: 2 },
  { label: "3×3", cols: 3, rows: 3 },
  { label: "4×2", cols: 4, rows: 2 },
  { label: "4×4", cols: 4, rows: 4 },
];

function buildGridRects(cols: number, rows: number, count: number): Rect[] {
  const rects: Rect[] = [];
  const cellW = 100 / cols;
  const cellH = 100 / rows;
  let idx = 0;

  for (let r = 0; r < rows && idx < count; r++) {
    for (let c = 0; c < cols && idx < count; c++) {
      rects.push({ x: c * cellW, y: r * cellH, w: cellW, h: cellH });
      idx++;
    }
  }

  return rects;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextTerminalId = 1;

function generateTerminalId(): string {
  return `tw-${Date.now()}-${nextTerminalId++}`;
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

const MIN_PANE_PCT = 8; // min 8% of container in any direction

function clampRect(r: Rect): Rect {
  return {
    x: Math.max(0, Math.min(100 - MIN_PANE_PCT, r.x)),
    y: Math.max(0, Math.min(100 - MIN_PANE_PCT, r.y)),
    w: Math.max(MIN_PANE_PCT, Math.min(100 - r.x, r.w)),
    h: Math.max(MIN_PANE_PCT, Math.min(100 - r.y, r.h)),
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    position: "fixed",
    inset: 0,
    display: "flex",
    background: "var(--color-background)",
    zIndex: 1000,
  } satisfies CSSProperties,

  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,

  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 36,
    minHeight: 36,
    padding: "0 8px",
    background: "var(--color-surface)",
    borderBottom: "1px solid var(--color-border)",
    gap: 4,
    flexShrink: 0,
  } satisfies CSSProperties,

  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    overflow: "hidden",
  } satisfies CSSProperties,

  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  } satisfies CSSProperties,

  tab: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 10px",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    fontWeight: active ? 500 : 400,
    color: active ? "var(--color-text-bright)" : "var(--color-text-dim)",
    background: active ? "var(--color-active)" : "transparent",
    border: "1px solid",
    borderColor: active ? "var(--color-accent)" : "transparent",
    borderRadius: 4,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "all 0.1s ease",
    lineHeight: "20px",
  }),

  tabClose: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    fontSize: 14,
    lineHeight: "16px",
    color: "var(--color-text-dimmer)",
    background: "transparent",
    border: "none",
    borderRadius: 3,
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
  } satisfies CSSProperties,

  addButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    fontSize: 16,
    color: "var(--color-text-dim)",
    background: "transparent",
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
  } satisfies CSSProperties,

  presetButton: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2px 8px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    fontWeight: active ? 600 : 400,
    color: active ? "var(--color-text-bright)" : "var(--color-text-dim)",
    background: active ? "var(--color-active)" : "transparent",
    border: "1px solid",
    borderColor: active ? "var(--color-accent)" : "var(--color-border)",
    borderRadius: 4,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "all 0.1s ease",
    lineHeight: "20px",
  }),

  presetGroup: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    marginLeft: 8,
    paddingLeft: 8,
    borderLeft: "1px solid var(--color-border)",
  } satisfies CSSProperties,

  backButton: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 10px",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    fontWeight: 400,
    color: "var(--color-text-dim)",
    background: "transparent",
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  canvas: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    minHeight: 0,
  } satisfies CSSProperties,

  pane: (rect: Rect, focused: boolean, fullscreen: boolean): CSSProperties => ({
    position: fullscreen ? "fixed" : "absolute",
    inset: fullscreen ? 0 : undefined,
    left: fullscreen ? undefined : `${rect.x}%`,
    top: fullscreen ? undefined : `${rect.y}%`,
    width: fullscreen ? undefined : `${rect.w}%`,
    height: fullscreen ? undefined : `${rect.h}%`,
    zIndex: fullscreen ? 2000 : focused ? 2 : 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    border: `1px solid ${focused ? "var(--color-accent)" : "var(--color-border)"}`,
    borderRadius: fullscreen ? 0 : 4,
    background: "var(--color-panel)",
    transition: "border-color 0.15s ease",
    boxSizing: "border-box",
  }),

  paneHeader: (focused: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 28,
    minHeight: 28,
    padding: "0 8px",
    background: focused ? "var(--color-active)" : "var(--color-surface)",
    borderBottom: "1px solid var(--color-border)",
    cursor: "move",
    userSelect: "none",
    flexShrink: 0,
  }),

  paneLabel: {
    fontSize: 11,
    fontFamily: "var(--font-ui)",
    fontWeight: 450,
    color: "var(--color-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  paneIndex: {
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    color: "var(--color-text-dimmer)",
    marginRight: 6,
    flexShrink: 0,
  } satisfies CSSProperties,

  paneActions: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  } satisfies CSSProperties,

  paneActionButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    fontSize: 12,
    color: "var(--color-text-dimmer)",
    background: "transparent",
    border: "none",
    borderRadius: 3,
    cursor: "pointer",
    padding: 0,
  } satisfies CSSProperties,

  paneBody: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  } satisfies CSSProperties,

  terminalWrapper: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,

  labelInput: {
    fontSize: 11,
    fontFamily: "var(--font-ui)",
    fontWeight: 450,
    color: "var(--color-text-bright)",
    background: "var(--color-input)",
    border: "1px solid var(--color-accent)",
    borderRadius: 3,
    padding: "1px 4px",
    outline: "none",
    width: 120,
  } satisfies CSSProperties,

  // Resize handles
  handleRight: {
    position: "absolute",
    top: 0,
    right: -3,
    width: 6,
    height: "100%",
    cursor: "ew-resize",
    zIndex: 10,
  } satisfies CSSProperties,

  handleBottom: {
    position: "absolute",
    bottom: -3,
    left: 0,
    width: "100%",
    height: 6,
    cursor: "ns-resize",
    zIndex: 10,
  } satisfies CSSProperties,

  handleCorner: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 10,
    height: 10,
    cursor: "nwse-resize",
    zIndex: 11,
  } satisfies CSSProperties,

  handleLeft: {
    position: "absolute",
    top: 0,
    left: -3,
    width: 6,
    height: "100%",
    cursor: "ew-resize",
    zIndex: 10,
  } satisfies CSSProperties,

  handleTop: {
    position: "absolute",
    top: -3,
    left: 0,
    width: "100%",
    height: 6,
    cursor: "ns-resize",
    zIndex: 10,
  } satisfies CSSProperties,
};

// ---------------------------------------------------------------------------
// TerminalWorkspace component
// ---------------------------------------------------------------------------

export { type TerminalWorkspaceView, type TerminalWorkspaceProps };

export function TerminalWorkspace(props: TerminalWorkspaceProps) {
  const {
    workspacePath,
    connectionState,
    cwd,
    fontSize,
    shell,
    terminals: externalTerminals,
    onOpenSession,
    onResizeSession,
    onSendInput,
    onBackToIde,
    activeView,
    onNavigateView,
  } = props;

  // -- State -----------------------------------------------------------------

  const [instances, setInstances] = useState<TerminalInstance[]>(() => {
    if (externalTerminals.length > 0) {
      const rects = buildGridRects(
        Math.ceil(Math.sqrt(externalTerminals.length)),
        Math.ceil(externalTerminals.length / Math.ceil(Math.sqrt(externalTerminals.length))),
        externalTerminals.length,
      );

      return externalTerminals.map((t, i) => ({
        id: t.id,
        label: t.title || `Terminal ${i + 1}`,
        rect: rects[i] ?? { x: 0, y: 0, w: 100, h: 100 },
        terminalSnapshot: t,
      }));
    }

    return [
      {
        id: generateTerminalId(),
        label: "Terminal 1",
        rect: { x: 0, y: 0, w: 100, h: 100 },
        terminalSnapshot: null,
      },
    ];
  });

  const [focusedId, setFocusedId] = useState<string>(instances[0]?.id ?? "");
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);

  // Sync external terminal snapshots into instances
  useEffect(() => {
    if (externalTerminals.length === 0) return;

    setInstances((prev) => {
      const updated = prev.map((inst) => {
        const match = externalTerminals.find((t) => t.id === inst.id);
        if (match) {
          return { ...inst, terminalSnapshot: match };
        }
        return inst;
      });

      for (const ext of externalTerminals) {
        if (!updated.some((u) => u.id === ext.id)) {
          updated.push({
            id: ext.id,
            label: ext.title || `Terminal ${updated.length + 1}`,
            rect: { x: 0, y: 0, w: 100, h: 100 },
            terminalSnapshot: ext,
          });
        }
      }

      return updated;
    });
  }, [externalTerminals]);

  // -- Actions ---------------------------------------------------------------

  const addTerminal = useCallback(() => {
    const id = generateTerminalId();

    setInstances((prev) => {
      const count = prev.length + 1;
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const rects = buildGridRects(cols, rows, count);

      return [
        ...prev.map((inst, i) => ({ ...inst, rect: rects[i] ?? inst.rect })),
        {
          id,
          label: `Terminal ${count}`,
          rect: rects[count - 1] ?? { x: 0, y: 0, w: 100, h: 100 },
          terminalSnapshot: null,
        },
      ];
    });
    setFocusedId(id);
  }, []);

  const closeTerminal = useCallback(
    (id: string) => {
      setInstances((prev) => {
        const next = prev.filter((t) => t.id !== id);

        if (next.length === 0) {
          const newId = generateTerminalId();
          return [{ id: newId, label: "Terminal 1", rect: { x: 0, y: 0, w: 100, h: 100 }, terminalSnapshot: null }];
        }

        // Re-layout remaining terminals
        const cols = Math.ceil(Math.sqrt(next.length));
        const rows = Math.ceil(next.length / cols);
        const rects = buildGridRects(cols, rows, next.length);

        return next.map((inst, i) => ({ ...inst, rect: rects[i] ?? inst.rect }));
      });

      setFocusedId((prevFocused) => {
        if (prevFocused === id) {
          const currentInstances = instances;
          const idx = currentInstances.findIndex((t) => t.id === id);
          const next = currentInstances.filter((t) => t.id !== id);

          if (next.length === 0) return prevFocused;

          return next[Math.min(idx, next.length - 1)].id;
        }

        return prevFocused;
      });

      if (fullscreenId === id) {
        setFullscreenId(null);
      }
    },
    [instances, fullscreenId],
  );

  const applyPreset = useCallback((preset: LayoutPreset) => {
    const total = preset.cols * preset.rows;

    setInstances((prev) => {
      const rects = buildGridRects(preset.cols, preset.rows, total);

      // Reuse existing instances, create new ones if needed, drop extras
      const result: TerminalInstance[] = [];

      for (let i = 0; i < total; i++) {
        if (i < prev.length) {
          result.push({ ...prev[i], rect: rects[i] ?? prev[i].rect });
        } else {
          result.push({
            id: generateTerminalId(),
            label: `Terminal ${i + 1}`,
            rect: rects[i] ?? { x: 0, y: 0, w: 100, h: 100 },
            terminalSnapshot: null,
          });
        }
      }

      return result;
    });
  }, []);

  const focusTerminalByIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < instances.length) {
        setFocusedId(instances[index].id);
      }
    },
    [instances],
  );

  const startRenaming = useCallback(
    (id: string) => {
      const inst = instances.find((t) => t.id === id);

      if (inst) {
        setEditingLabelId(id);
        setEditingLabelValue(inst.label);
      }
    },
    [instances],
  );

  const commitRename = useCallback(() => {
    if (!editingLabelId) return;

    const trimmed = editingLabelValue.trim();

    if (trimmed) {
      setInstances((prev) =>
        prev.map((t) => (t.id === editingLabelId ? { ...t, label: trimmed } : t)),
      );
    }

    setEditingLabelId(null);
    setEditingLabelValue("");
  }, [editingLabelId, editingLabelValue]);

  const toggleFullscreen = useCallback(
    (id: string) => {
      setFullscreenId((prev) => (prev === id ? null : id));
    },
    [],
  );

  // -- Per-pane resize / drag ------------------------------------------------

  const updateRect = useCallback((id: string, updater: (prev: Rect) => Rect) => {
    setInstances((prev) =>
      prev.map((inst) =>
        inst.id === id ? { ...inst, rect: clampRect(updater(inst.rect)) } : inst,
      ),
    );
  }, []);

  const startEdgeResize = useCallback(
    (id: string, edge: "right" | "bottom" | "left" | "top" | "corner", startX: number, startY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const canvasW = canvas.clientWidth;
      const canvasH = canvas.clientHeight;
      const inst = instances.find((t) => t.id === id);
      if (!inst) return;

      const startRect = { ...inst.rect };

      const onMouseMove = (e: MouseEvent) => {
        const dx = ((e.clientX - startX) / canvasW) * 100;
        const dy = ((e.clientY - startY) / canvasH) * 100;

        updateRect(id, () => {
          const next = { ...startRect };

          if (edge === "right" || edge === "corner") {
            next.w = startRect.w + dx;
          }
          if (edge === "bottom" || edge === "corner") {
            next.h = startRect.h + dy;
          }
          if (edge === "left") {
            next.x = startRect.x + dx;
            next.w = startRect.w - dx;
          }
          if (edge === "top") {
            next.y = startRect.y + dy;
            next.h = startRect.h - dy;
          }

          return next;
        });
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor =
        edge === "right" || edge === "left" ? "ew-resize" :
        edge === "bottom" || edge === "top" ? "ns-resize" : "nwse-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [instances, updateRect],
  );

  const startDrag = useCallback(
    (id: string, startX: number, startY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const canvasW = canvas.clientWidth;
      const canvasH = canvas.clientHeight;
      const inst = instances.find((t) => t.id === id);
      if (!inst) return;

      const startRect = { ...inst.rect };

      const onMouseMove = (e: MouseEvent) => {
        const dx = ((e.clientX - startX) / canvasW) * 100;
        const dy = ((e.clientY - startY) / canvasH) * 100;

        updateRect(id, () => ({
          ...startRect,
          x: startRect.x + dx,
          y: startRect.y + dy,
        }));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "move";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [instances, updateRect],
  );

  // -- Keyboard shortcuts ----------------------------------------------------

  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");

    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key === "t") {
        e.preventDefault();
        addTerminal();
        return;
      }

      if (mod && e.key === "w") {
        e.preventDefault();
        closeTerminal(focusedId);
        return;
      }

      if (mod && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        focusTerminalByIndex(parseInt(e.key, 10) - 1);
        return;
      }

      if (e.key === "Escape") {
        if (fullscreenId) {
          e.preventDefault();
          setFullscreenId(null);
        } else if (onBackToIde) {
          e.preventDefault();
          onBackToIde();
        }
        return;
      }

      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const currentIdx = instances.findIndex((t) => t.id === focusedId);
        const nextIdx = e.shiftKey
          ? (currentIdx - 1 + instances.length) % instances.length
          : (currentIdx + 1) % instances.length;
        setFocusedId(instances[nextIdx].id);
        return;
      }

      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        onBackToIde?.();
        return;
      }
    };

    window.addEventListener("keydown", handler, true);

    return () => window.removeEventListener("keydown", handler, true);
  }, [addTerminal, closeTerminal, focusedId, focusTerminalByIndex, fullscreenId, instances, onBackToIde]);

  // -- Detect active preset --------------------------------------------------

  const activePreset = useMemo(() => {
    for (const preset of LAYOUT_PRESETS) {
      if (preset.cols * preset.rows === instances.length) {
        return preset.label;
      }
    }
    return null;
  }, [instances.length]);

  // -- Render ----------------------------------------------------------------

  const fullscreenInstance = fullscreenId ? instances.find((t) => t.id === fullscreenId) : null;

  return (
    <div style={styles.container}>
      {onNavigateView ? (
        <aside className="activity-bar terminal-activity-bar">
          <div className="activity-bar-top">
            {TERMINAL_WORKSPACE_NAV_ITEMS.map((item) => {
              const isActive = item.id === activeView;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`activity-bar-item ${isActive ? "activity-bar-item-active" : ""}`}
                  onClick={() => onNavigateView(item.id)}
                  title={item.label}
                  aria-label={item.label}
                >
                  <FontAwesomeIcon icon={item.icon} fixedWidth />
                </button>
              );
            })}
          </div>
        </aside>
      ) : null}

      <aside className="terminal-sidebar-panel">
        <div className="terminal-sidebar-header">
          <span className="terminal-sidebar-eyebrow">Workspace Shell</span>
          <span className="terminal-sidebar-title">{basename(workspacePath)}</span>
          <span className="terminal-sidebar-path" title={workspacePath}>{workspacePath}</span>
        </div>

        <div className="terminal-sidebar-section terminal-sidebar-section-grow">
          <span className="terminal-sidebar-section-title">Terminals</span>
          <div className="terminal-session-list">
            {instances.map((inst, i) => {
              const isActive = inst.id === focusedId;
              const shortcutLabel = `${isMacPlatform() ? "Cmd" : "Ctrl"}+${i + 1}`;

              return (
                <button
                  key={inst.id}
                  type="button"
                  className={`terminal-session-button ${isActive ? "terminal-session-button-active" : ""}`}
                  onClick={() => setFocusedId(inst.id)}
                  title={`${inst.label} (${shortcutLabel})`}
                >
                  <span className={`terminal-session-index ${isActive ? "terminal-session-index-active" : ""}`}>{i + 1}</span>
                  <span className="terminal-session-meta">
                    <span className="terminal-session-label">{inst.label}</span>
                    <span className="terminal-session-hint">
                      {inst.terminalSnapshot?.cwd ?? cwd}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="terminal-session-new"
            onClick={addTerminal}
            title={`New terminal (${isMacPlatform() ? "Cmd" : "Ctrl"}+T)`}
          >
            + New Terminal
          </button>
        </div>

        <div className="terminal-sidebar-footer">
          <div>{connectionState === "live" ? "Daemon connected" : "Daemon offline"}</div>
          <div>{isMacPlatform() ? "Cmd" : "Ctrl"}+T new · {isMacPlatform() ? "Cmd" : "Ctrl"}+W close</div>
          <div>Drag edges to resize · Drag header to move</div>
        </div>
      </aside>

      <div style={styles.main}>
        {/* Toolbar */}
        <div style={styles.toolbar}>
          <div style={styles.toolbarLeft}>
            {instances.map((inst, i) => (
              <button
                key={inst.id}
                type="button"
                style={styles.tab(inst.id === focusedId)}
                onClick={() => setFocusedId(inst.id)}
                onDoubleClick={() => startRenaming(inst.id)}
                title={`${inst.label} (${isMacPlatform() ? "Cmd" : "Ctrl"}+${i + 1})`}
              >
                <span style={styles.paneIndex}>{i + 1}</span>
                {editingLabelId === inst.id ? (
                  <input
                    type="text"
                    value={editingLabelValue}
                    style={styles.labelInput}
                    autoFocus
                    onChange={(e) => setEditingLabelValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") {
                        setEditingLabelId(null);
                      }
                    }}
                  />
                ) : (
                  inst.label
                )}
                <button
                  type="button"
                  style={styles.tabClose}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminal(inst.id);
                  }}
                  title="Close terminal"
                >
                  ×
                </button>
              </button>
            ))}
            <button
              type="button"
              style={styles.addButton}
              onClick={addTerminal}
              title={`New terminal (${isMacPlatform() ? "Cmd" : "Ctrl"}+T)`}
            >
              +
            </button>

            {/* Layout presets */}
            <div style={styles.presetGroup}>
              {LAYOUT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  style={styles.presetButton(activePreset === preset.label)}
                  onClick={() => applyPreset(preset)}
                  title={`${preset.label} layout (${preset.cols * preset.rows} terminals)`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div style={styles.toolbarRight}>
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--color-text-dimmest)" }}>
              {instances.length} terminal{instances.length !== 1 ? "s" : ""}
            </span>
            {onBackToIde && (
              <button
                type="button"
                style={styles.backButton}
                onClick={onBackToIde}
                title="Back to IDE (Ctrl+`)"
              >
                ← Back to IDE
              </button>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div ref={canvasRef} style={styles.canvas}>
          {(fullscreenInstance ? [fullscreenInstance] : instances).map((inst) => {
            const isFocused = inst.id === focusedId;
            const isFullscreen = inst.id === fullscreenId;
            const idx = instances.indexOf(inst);

            return (
              <div
                key={inst.id}
                style={styles.pane(inst.rect, isFocused, isFullscreen)}
                onClick={() => setFocusedId(inst.id)}
              >
                {/* Header — draggable */}
                <div
                  style={styles.paneHeader(isFocused)}
                  onMouseDown={(e) => {
                    if (isFullscreen) return;
                    e.preventDefault();
                    startDrag(inst.id, e.clientX, e.clientY);
                  }}
                  onDoubleClick={() => toggleFullscreen(inst.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", overflow: "hidden" }}>
                    <span style={styles.paneIndex}>{idx + 1}</span>
                    <span style={styles.paneLabel}>{inst.label}</span>
                  </div>
                  <div style={styles.paneActions}>
                    <button
                      type="button"
                      style={styles.paneActionButton}
                      onClick={(e) => { e.stopPropagation(); toggleFullscreen(inst.id); }}
                      title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                    >
                      {isFullscreen ? "⊡" : "⊞"}
                    </button>
                    <button
                      type="button"
                      style={styles.paneActionButton}
                      onClick={(e) => { e.stopPropagation(); closeTerminal(inst.id); }}
                      title="Close terminal"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Terminal body */}
                <div style={styles.paneBody}>
                  <div style={styles.terminalWrapper}>
                    <TerminalPane
                      connectionState={connectionState}
                      cwd={cwd}
                      fontSize={fontSize}
                      onOpenSession={onOpenSession}
                      onResizeSession={onResizeSession}
                      onSendInput={onSendInput}
                      shell={shell}
                      terminal={inst.terminalSnapshot}
                      terminalId={inst.id}
                    />
                  </div>
                </div>

                {/* Resize handles — all edges + corner */}
                {!isFullscreen && (
                  <>
                    <div
                      style={styles.handleRight}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startEdgeResize(inst.id, "right", e.clientX, e.clientY); }}
                    />
                    <div
                      style={styles.handleBottom}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startEdgeResize(inst.id, "bottom", e.clientX, e.clientY); }}
                    />
                    <div
                      style={styles.handleCorner}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startEdgeResize(inst.id, "corner", e.clientX, e.clientY); }}
                    />
                    <div
                      style={styles.handleLeft}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startEdgeResize(inst.id, "left", e.clientX, e.clientY); }}
                    />
                    <div
                      style={styles.handleTop}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startEdgeResize(inst.id, "top", e.clientX, e.clientY); }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
