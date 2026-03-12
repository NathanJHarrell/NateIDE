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

type TerminalInstance = {
  id: string;
  label: string;
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
// Grid layout calculation
// ---------------------------------------------------------------------------

type GridLayout = {
  cols: number;
  rows: number;
  cells: GridCell[];
};

type GridCell = {
  index: number;
  row: number;
  col: number;
  colSpan: number;
};

function computeGridLayout(count: number): GridLayout {
  if (count === 0) {
    return { cols: 1, rows: 1, cells: [] };
  }

  if (count === 1) {
    return {
      cols: 1,
      rows: 1,
      cells: [{ index: 0, row: 0, col: 0, colSpan: 1 }],
    };
  }

  if (count === 2) {
    return {
      cols: 2,
      rows: 1,
      cells: [
        { index: 0, row: 0, col: 0, colSpan: 1 },
        { index: 1, row: 0, col: 1, colSpan: 1 },
      ],
    };
  }

  if (count === 3) {
    return {
      cols: 2,
      rows: 2,
      cells: [
        { index: 0, row: 0, col: 0, colSpan: 1 },
        { index: 1, row: 0, col: 1, colSpan: 1 },
        { index: 2, row: 1, col: 0, colSpan: 2 },
      ],
    };
  }

  if (count === 4) {
    return {
      cols: 2,
      rows: 2,
      cells: [
        { index: 0, row: 0, col: 0, colSpan: 1 },
        { index: 1, row: 0, col: 1, colSpan: 1 },
        { index: 2, row: 1, col: 0, colSpan: 1 },
        { index: 3, row: 1, col: 1, colSpan: 1 },
      ],
    };
  }

  // General case: cols = ceil(sqrt(n)), rows = ceil(n / cols)
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cells: GridCell[] = [];

  let index = 0;

  for (let row = 0; row < rows; row++) {
    const remaining = count - index;
    const itemsInRow = row === rows - 1 ? remaining : cols;
    // If last row has fewer items, they stretch to fill
    const colSpan = row === rows - 1 && remaining < cols
      ? Math.floor(cols / remaining) + (0 < cols % remaining ? 1 : 0)
      : 1;

    for (let col = 0; col < itemsInRow; col++) {
      // For the last row, compute span so items fill the full width
      let span = 1;

      if (row === rows - 1 && remaining < cols) {
        const baseSpan = Math.floor(cols / remaining);
        const extraCols = cols % remaining;
        span = baseSpan + (col < extraCols ? 1 : 0);
      }

      cells.push({ index, row, col, colSpan: span });
      index++;
    }
  }

  return { cols, rows, cells };
}

// ---------------------------------------------------------------------------
// Styles (inline, self-contained)
// ---------------------------------------------------------------------------

const styles = {
  container: {
    position: "fixed",
    inset: 0,
    display: "flex",
    background: "var(--color-background)",
    zIndex: 1000,
  } satisfies CSSProperties,

  sidebar: {
    width: 248,
    minWidth: 248,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "14px 12px 12px",
    background: "var(--color-surface)",
    borderRight: "1px solid var(--color-border)",
    overflow: "hidden",
  } satisfies CSSProperties,

  sidebarHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "0 6px 12px",
    borderBottom: "1px solid var(--color-border)",
  } satisfies CSSProperties,

  sidebarEyebrow: {
    fontSize: 10,
    fontFamily: "var(--font-ui)",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--color-text-dimmest)",
  } satisfies CSSProperties,

  sidebarTitle: {
    fontSize: 16,
    fontFamily: "var(--font-ui)",
    fontWeight: 600,
    color: "var(--color-text-bright)",
  } satisfies CSSProperties,

  sidebarPath: {
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    color: "var(--color-text-dimmer)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  sidebarSection: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minHeight: 0,
  } satisfies CSSProperties,

  sidebarSectionTitle: {
    padding: "0 6px",
    fontSize: 10,
    fontFamily: "var(--font-ui)",
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--color-text-dimmest)",
  } satisfies CSSProperties,

  sidebarNavList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,

  sidebarNavButton: (active: boolean): CSSProperties => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    background: active ? "var(--color-active)" : "transparent",
    color: active ? "var(--color-text-bright)" : "var(--color-text-dim)",
    border: "1px solid",
    borderColor: active ? "var(--color-accent)" : "transparent",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    fontWeight: active ? 600 : 450,
    transition: "all 0.15s ease",
  }),

  sidebarNavIcon: {
    width: 16,
    flexShrink: 0,
    display: "inline-flex",
    justifyContent: "center",
  } satisfies CSSProperties,

  sidebarTerminalList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minHeight: 0,
    overflow: "auto",
    paddingRight: 4,
  } satisfies CSSProperties,

  sidebarTerminalButton: (active: boolean): CSSProperties => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 10px",
    background: active ? "rgba(94, 165, 232, 0.12)" : "transparent",
    color: active ? "var(--color-text-bright)" : "var(--color-text)",
    border: "1px solid",
    borderColor: active ? "rgba(94, 165, 232, 0.28)" : "var(--color-border)",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.15s ease",
  }),

  sidebarTerminalIndex: (active: boolean): CSSProperties => ({
    width: 18,
    flexShrink: 0,
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    color: active ? "var(--color-accent)" : "var(--color-text-dimmer)",
  }),

  sidebarTerminalMeta: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,

  sidebarTerminalLabel: {
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  sidebarTerminalHint: {
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    color: "var(--color-text-dimmer)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  sidebarNewTerminalButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "9px 10px",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    fontWeight: 600,
    color: "var(--color-text-bright)",
    background: "rgba(94, 165, 232, 0.12)",
    border: "1px solid rgba(94, 165, 232, 0.28)",
    borderRadius: 8,
    cursor: "pointer",
  } satisfies CSSProperties,

  sidebarFooter: {
    marginTop: "auto",
    padding: "12px 6px 0",
    borderTop: "1px solid var(--color-border)",
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    color: "var(--color-text-dimmer)",
    lineHeight: 1.5,
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

  grid: {
    flex: 1,
    display: "grid",
    gap: 2,
    padding: 2,
    overflow: "auto",
    minHeight: 0,
  } satisfies CSSProperties,

  cell: (focused: boolean, fullscreen: boolean): CSSProperties => ({
    position: fullscreen ? "fixed" : "relative",
    inset: fullscreen ? 0 : undefined,
    zIndex: fullscreen ? 2000 : undefined,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    borderRadius: 4,
    border: `1px solid ${focused ? "var(--color-accent)" : "var(--color-border)"}`,
    background: "var(--color-panel)",
    transition: "border-color 0.15s ease",
  }),

  cellHeader: (focused: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 28,
    minHeight: 28,
    padding: "0 8px",
    background: focused ? "var(--color-active)" : "var(--color-surface)",
    borderBottom: "1px solid var(--color-border)",
    cursor: "default",
    userSelect: "none",
    flexShrink: 0,
  }),

  cellLabel: {
    fontSize: 11,
    fontFamily: "var(--font-ui)",
    fontWeight: 450,
    color: "var(--color-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  cellIndex: {
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    color: "var(--color-text-dimmer)",
    marginRight: 6,
    flexShrink: 0,
  } satisfies CSSProperties,

  cellActions: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  } satisfies CSSProperties,

  cellActionButton: {
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

  cellBody: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  } satisfies CSSProperties,

  // Override the terminal-live-card styles to fill the cell
  terminalWrapper: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,

  shortcutHint: {
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    color: "var(--color-text-dimmest)",
    marginLeft: 4,
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
};

// ---------------------------------------------------------------------------
// Resizable grid hook
// ---------------------------------------------------------------------------

type ResizeState = {
  // Custom column widths as fractions (null means equal/auto)
  colWidths: number[] | null;
  // Custom row heights as fractions (null means equal/auto)
  rowHeights: number[] | null;
};

function useResizableGrid(cols: number, rows: number) {
  const [resizeState, setResizeState] = useState<ResizeState>({
    colWidths: null,
    rowHeights: null,
  });

  // Reset when grid shape changes
  useEffect(() => {
    setResizeState({ colWidths: null, rowHeights: null });
  }, [cols, rows]);

  const startColResize = useCallback(
    (colIndex: number, startX: number, containerWidth: number) => {
      const initialWidths = resizeState.colWidths ?? Array(cols).fill(1 / cols);

      const onMouseMove = (e: MouseEvent) => {
        const delta = (e.clientX - startX) / containerWidth;
        const newWidths = [...initialWidths];
        const minFraction = 0.1;

        newWidths[colIndex] = Math.max(minFraction, initialWidths[colIndex] + delta);
        newWidths[colIndex + 1] = Math.max(minFraction, initialWidths[colIndex + 1] - delta);

        // Normalize
        const total = newWidths.reduce((s, w) => s + w, 0);

        for (let i = 0; i < newWidths.length; i++) {
          newWidths[i] /= total;
        }

        setResizeState((prev) => ({ ...prev, colWidths: newWidths }));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [cols, resizeState.colWidths],
  );

  const startRowResize = useCallback(
    (rowIndex: number, startY: number, containerHeight: number) => {
      const initialHeights = resizeState.rowHeights ?? Array(rows).fill(1 / rows);

      const onMouseMove = (e: MouseEvent) => {
        const delta = (e.clientY - startY) / containerHeight;
        const newHeights = [...initialHeights];
        const minFraction = 0.1;

        newHeights[rowIndex] = Math.max(minFraction, initialHeights[rowIndex] + delta);
        newHeights[rowIndex + 1] = Math.max(minFraction, initialHeights[rowIndex + 1] - delta);

        // Normalize
        const total = newHeights.reduce((s, h) => s + h, 0);

        for (let i = 0; i < newHeights.length; i++) {
          newHeights[i] /= total;
        }

        setResizeState((prev) => ({ ...prev, rowHeights: newHeights }));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [rows, resizeState.rowHeights],
  );

  const gridTemplateColumns = resizeState.colWidths
    ? resizeState.colWidths.map((w) => `${(w * 100).toFixed(2)}%`).join(" ")
    : `repeat(${cols}, 1fr)`;

  const gridTemplateRows = resizeState.rowHeights
    ? resizeState.rowHeights.map((h) => `${(h * 100).toFixed(2)}%`).join(" ")
    : `repeat(${rows}, 1fr)`;

  return { gridTemplateColumns, gridTemplateRows, startColResize, startRowResize };
}

// ---------------------------------------------------------------------------
// Resize handle components
// ---------------------------------------------------------------------------

function ColResizeHandle({
  colIndex,
  row,
  totalRows,
  onStartResize,
}: {
  colIndex: number;
  row: number;
  totalRows: number;
  onStartResize: (colIndex: number, startX: number, containerWidth: number) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: -3,
        width: 6,
        height: "100%",
        cursor: "col-resize",
        zIndex: 10,
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        const gridEl = (e.currentTarget as HTMLElement).closest("[data-terminal-grid]");

        if (gridEl) {
          onStartResize(colIndex, e.clientX, gridEl.clientWidth);
        }
      }}
    />
  );
}

function RowResizeHandle({
  rowIndex,
  onStartResize,
}: {
  rowIndex: number;
  onStartResize: (rowIndex: number, startY: number, containerHeight: number) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: -3,
        left: 0,
        width: "100%",
        height: 6,
        cursor: "row-resize",
        zIndex: 10,
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        const gridEl = (e.currentTarget as HTMLElement).closest("[data-terminal-grid]");

        if (gridEl) {
          onStartResize(rowIndex, e.clientY, gridEl.clientHeight);
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// TerminalWorkspace component
// ---------------------------------------------------------------------------

let nextTerminalId = 1;

function generateTerminalId(): string {
  return `tw-${Date.now()}-${nextTerminalId++}`;
}

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
    activeView = "terminals",
    onNavigateView,
  } = props;

  const [instances, setInstances] = useState<TerminalInstance[]>(() => {
    // Initialize with existing terminals, or create a first one
    if (externalTerminals.length > 0) {
      return externalTerminals.map((t, i) => ({
        id: t.id,
        label: t.title || `Terminal ${i + 1}`,
        terminalSnapshot: t,
      }));
    }

    return [
      {
        id: generateTerminalId(),
        label: "Terminal 1",
        terminalSnapshot: null,
      },
    ];
  });

  const [focusedId, setFocusedId] = useState<string>(instances[0]?.id ?? "");
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);

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

      // Add any new external terminals not yet tracked
      for (const ext of externalTerminals) {
        if (!updated.some((u) => u.id === ext.id)) {
          updated.push({
            id: ext.id,
            label: ext.title || `Terminal ${updated.length + 1}`,
            terminalSnapshot: ext,
          });
        }
      }

      return updated;
    });
  }, [externalTerminals]);

  // ---------- Actions ----------

  const addTerminal = useCallback(() => {
    const id = generateTerminalId();

    setInstances((prev) => [
      ...prev,
      {
        id,
        label: `Terminal ${prev.length + 1}`,
        terminalSnapshot: null,
      },
    ]);
    setFocusedId(id);
  }, []);

  const closeTerminal = useCallback(
    (id: string) => {
      setInstances((prev) => {
        const next = prev.filter((t) => t.id !== id);

        if (next.length === 0) {
          // Always keep at least one terminal
          const newId = generateTerminalId();
          return [{ id: newId, label: "Terminal 1", terminalSnapshot: null }];
        }

        return next;
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

  const focusTerminalByIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < instances.length) {
        setFocusedId(instances[index].id);
      }
    },
    [instances],
  );

  const moveFocus = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      const layout = computeGridLayout(instances.length);
      const currentIdx = instances.findIndex((t) => t.id === focusedId);

      if (currentIdx === -1) return;

      const currentCell = layout.cells[currentIdx];

      if (!currentCell) return;

      let targetRow = currentCell.row;
      let targetCol = currentCell.col;

      switch (direction) {
        case "up":
          targetRow = Math.max(0, currentCell.row - 1);
          break;
        case "down":
          targetRow = Math.min(layout.rows - 1, currentCell.row + 1);
          break;
        case "left":
          if (currentCell.col > 0) {
            targetCol = currentCell.col - 1;
          } else if (currentCell.row > 0) {
            targetRow = currentCell.row - 1;
            targetCol = layout.cols - 1;
          }
          break;
        case "right":
          targetCol = currentCell.col + 1;
          break;
      }

      // Find the cell at the target position
      const targetCell = layout.cells.find(
        (c) => c.row === targetRow && c.col <= targetCol && targetCol < c.col + c.colSpan,
      ) ?? layout.cells.find((c) => c.row === targetRow);

      if (targetCell && targetCell.index !== currentIdx) {
        setFocusedId(instances[targetCell.index].id);
      }
    },
    [instances, focusedId],
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

  // ---------- Keyboard shortcuts ----------

  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");

    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+T: new terminal
      if (mod && e.key === "t") {
        e.preventDefault();
        addTerminal();
        return;
      }

      // Cmd/Ctrl+W: close focused terminal
      if (mod && e.key === "w") {
        e.preventDefault();
        closeTerminal(focusedId);
        return;
      }

      // Cmd/Ctrl+1-9: focus terminal by number
      if (mod && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        focusTerminalByIndex(parseInt(e.key, 10) - 1);
        return;
      }

      // Alt+Arrow: move focus
      if (e.altKey && !mod) {
        switch (e.key) {
          case "ArrowUp":
            e.preventDefault();
            moveFocus("up");
            return;
          case "ArrowDown":
            e.preventDefault();
            moveFocus("down");
            return;
          case "ArrowLeft":
            e.preventDefault();
            moveFocus("left");
            return;
          case "ArrowRight":
            e.preventDefault();
            moveFocus("right");
            return;
        }
      }

      // Escape: exit fullscreen or back to IDE
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

      // Ctrl+Tab: cycle focus
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const currentIdx = instances.findIndex((t) => t.id === focusedId);
        const nextIdx = e.shiftKey
          ? (currentIdx - 1 + instances.length) % instances.length
          : (currentIdx + 1) % instances.length;
        setFocusedId(instances[nextIdx].id);
        return;
      }

      // Ctrl+` : back to IDE
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        onBackToIde?.();
        return;
      }
    };

    window.addEventListener("keydown", handler, true);

    return () => window.removeEventListener("keydown", handler, true);
  }, [addTerminal, closeTerminal, focusedId, focusTerminalByIndex, fullscreenId, instances, moveFocus, onBackToIde]);

  // ---------- Layout ----------

  const layout = useMemo(() => computeGridLayout(instances.length), [instances.length]);
  const { gridTemplateColumns, gridTemplateRows, startColResize, startRowResize } =
    useResizableGrid(layout.cols, layout.rows);
  const focusedInstance = instances.find((instance) => instance.id === focusedId) ?? instances[0] ?? null;

  // ---------- Render ----------

  // If a terminal is fullscreen, render only that one
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
          <div>Alt+Arrow move · Ctrl+` back</div>
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
                <span style={styles.cellIndex}>{i + 1}</span>
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
                        setEditingLabelValue("");
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span>{inst.label}</span>
                )}
                {instances.length > 1 && (
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
                )}
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
          </div>
          <div style={styles.toolbarRight}>
            {focusedInstance ? (
              <span style={styles.shortcutHint}>
                {focusedInstance.label} · {basename(focusedInstance.terminalSnapshot?.cwd ?? cwd)}
              </span>
            ) : null}
            <span style={styles.shortcutHint}>
              {isMacPlatform() ? "⌘T" : "Ctrl+T"} new &middot;{" "}
              {isMacPlatform() ? "⌘W" : "Ctrl+W"} close &middot;{" "}
              Alt+Arrow move
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

        {/* Grid */}
        {fullscreenInstance ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <TerminalCell
              instance={fullscreenInstance}
              index={instances.indexOf(fullscreenInstance)}
              focused={true}
              fullscreen={true}
              connectionState={connectionState}
              cwd={cwd}
              fontSize={fontSize}
              shell={shell}
              onOpenSession={onOpenSession}
              onResizeSession={onResizeSession}
              onSendInput={onSendInput}
              onFocus={() => setFocusedId(fullscreenInstance.id)}
              onClose={() => closeTerminal(fullscreenInstance.id)}
              onToggleFullscreen={() => toggleFullscreen(fullscreenInstance.id)}
              onStartRename={() => startRenaming(fullscreenInstance.id)}
              showResizeCol={false}
              showResizeRow={false}
              onStartColResize={() => {}}
              onStartRowResize={() => {}}
            />
          </div>
        ) : (
          <div
            ref={gridRef}
            data-terminal-grid
            style={{
              ...styles.grid,
              gridTemplateColumns,
              gridTemplateRows,
            }}
          >
            {layout.cells.map((cell) => {
              const inst = instances[cell.index];

              if (!inst) return null;

              const isFocused = inst.id === focusedId;
              const isLastCol = cell.col + cell.colSpan >= layout.cols;
              const isLastRow = cell.row >= layout.rows - 1;

              return (
                <div
                  key={inst.id}
                  style={{
                    gridColumn: cell.colSpan > 1 ? `span ${cell.colSpan}` : undefined,
                    position: "relative",
                    minHeight: 0,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <TerminalCell
                    instance={inst}
                    index={cell.index}
                    focused={isFocused}
                    fullscreen={false}
                    connectionState={connectionState}
                    cwd={cwd}
                    fontSize={fontSize}
                    shell={shell}
                    onOpenSession={onOpenSession}
                    onResizeSession={onResizeSession}
                    onSendInput={onSendInput}
                    onFocus={() => setFocusedId(inst.id)}
                    onClose={() => closeTerminal(inst.id)}
                    onToggleFullscreen={() => toggleFullscreen(inst.id)}
                    onStartRename={() => startRenaming(inst.id)}
                    showResizeCol={!isLastCol}
                    showResizeRow={!isLastRow}
                    onStartColResize={(startX, containerWidth) =>
                      startColResize(cell.col + cell.colSpan - 1, startX, containerWidth)
                    }
                    onStartRowResize={(startY, containerHeight) =>
                      startRowResize(cell.row, startY, containerHeight)
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TerminalCell — wraps TerminalPane with header and resize handles
// ---------------------------------------------------------------------------

type TerminalCellProps = {
  instance: TerminalInstance;
  index: number;
  focused: boolean;
  fullscreen: boolean;
  connectionState: ConnectionState;
  cwd: string;
  fontSize: number;
  shell: string;
  onOpenSession: TerminalWorkspaceProps["onOpenSession"];
  onResizeSession: TerminalWorkspaceProps["onResizeSession"];
  onSendInput: TerminalWorkspaceProps["onSendInput"];
  onFocus: () => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
  onStartRename: () => void;
  showResizeCol: boolean;
  showResizeRow: boolean;
  onStartColResize: (startX: number, containerWidth: number) => void;
  onStartRowResize: (startY: number, containerHeight: number) => void;
};

function TerminalCell(props: TerminalCellProps) {
  const {
    instance,
    index,
    focused,
    fullscreen,
    connectionState,
    cwd,
    fontSize,
    shell,
    onOpenSession,
    onResizeSession,
    onSendInput,
    onFocus,
    onClose,
    onToggleFullscreen,
    onStartRename,
    showResizeCol,
    showResizeRow,
    onStartColResize,
    onStartRowResize,
  } = props;

  return (
    <div
      style={styles.cell(focused, fullscreen)}
      onClick={onFocus}
    >
      {/* Cell header */}
      <div
        style={styles.cellHeader(focused)}
        onDoubleClick={onToggleFullscreen}
      >
        <div style={{ display: "flex", alignItems: "center", overflow: "hidden" }}>
          <span style={styles.cellIndex}>{index + 1}</span>
          <span style={styles.cellLabel} onDoubleClick={(e) => { e.stopPropagation(); onStartRename(); }}>
            {instance.label}
          </span>
        </div>
        <div style={styles.cellActions}>
          <button
            type="button"
            style={styles.cellActionButton}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFullscreen();
            }}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? "⊡" : "⊞"}
          </button>
          <button
            type="button"
            style={styles.cellActionButton}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Close terminal"
          >
            ×
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div style={styles.cellBody}>
        <div style={styles.terminalWrapper}>
          <TerminalPane
            connectionState={connectionState}
            cwd={cwd}
            fontSize={fontSize}
            onOpenSession={onOpenSession}
            onResizeSession={onResizeSession}
            onSendInput={onSendInput}
            shell={shell}
            terminal={instance.terminalSnapshot}
          />
        </div>
      </div>

      {/* Resize handles */}
      {showResizeCol && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: -3,
            width: 6,
            height: "100%",
            cursor: "col-resize",
            zIndex: 10,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            const gridEl = (e.currentTarget as HTMLElement).closest("[data-terminal-grid]");

            if (gridEl) {
              onStartColResize(e.clientX, gridEl.clientWidth);
            }
          }}
        />
      )}
      {showResizeRow && (
        <div
          style={{
            position: "absolute",
            bottom: -3,
            left: 0,
            width: "100%",
            height: 6,
            cursor: "row-resize",
            zIndex: 10,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            const gridEl = (e.currentTarget as HTMLElement).closest("[data-terminal-grid]");

            if (gridEl) {
              onStartRowResize(e.clientY, gridEl.clientHeight);
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}
