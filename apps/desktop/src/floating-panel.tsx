import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FloatingPanelProps = {
  id: string;
  title: string;
  children: ReactNode;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
  onClose: () => void;
  onDock?: () => void;
};

type DragState = {
  isDragging: boolean;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type ResizeState = {
  isResizing: boolean;
  edge: ResizeEdge;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originW: number;
  originH: number;
};

type ResizeEdge =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw"
  | null;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 400;
const DEFAULT_MIN_WIDTH = 300;
const DEFAULT_MIN_HEIGHT = 200;
const Z_INDEX = 9500;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  panel: {
    position: "fixed" as const,
    borderRadius: "var(--panel-radius)",
    border: "1px solid var(--color-panel-border)",
    background: "var(--color-panel)",
    boxShadow:
      "0 8px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03)",
    zIndex: Z_INDEX,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
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

  body: {
    flex: 1,
    overflow: "auto",
    minHeight: 0,
  } satisfies CSSProperties,
};

// ---------------------------------------------------------------------------
// Resize-edge hit-area styles (invisible strips around the panel edges)
// ---------------------------------------------------------------------------

const EDGE_SIZE = 6;

function edgeStyle(edge: ResizeEdge): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    zIndex: 1,
  };

  switch (edge) {
    case "n":
      return { ...base, top: -EDGE_SIZE / 2, left: EDGE_SIZE, right: EDGE_SIZE, height: EDGE_SIZE, cursor: "ns-resize" };
    case "s":
      return { ...base, bottom: -EDGE_SIZE / 2, left: EDGE_SIZE, right: EDGE_SIZE, height: EDGE_SIZE, cursor: "ns-resize" };
    case "e":
      return { ...base, right: -EDGE_SIZE / 2, top: EDGE_SIZE, bottom: EDGE_SIZE, width: EDGE_SIZE, cursor: "ew-resize" };
    case "w":
      return { ...base, left: -EDGE_SIZE / 2, top: EDGE_SIZE, bottom: EDGE_SIZE, width: EDGE_SIZE, cursor: "ew-resize" };
    case "ne":
      return { ...base, top: -EDGE_SIZE / 2, right: -EDGE_SIZE / 2, width: EDGE_SIZE * 2, height: EDGE_SIZE * 2, cursor: "nesw-resize" };
    case "nw":
      return { ...base, top: -EDGE_SIZE / 2, left: -EDGE_SIZE / 2, width: EDGE_SIZE * 2, height: EDGE_SIZE * 2, cursor: "nwse-resize" };
    case "se":
      return { ...base, bottom: -EDGE_SIZE / 2, right: -EDGE_SIZE / 2, width: EDGE_SIZE * 2, height: EDGE_SIZE * 2, cursor: "nwse-resize" };
    case "sw":
      return { ...base, bottom: -EDGE_SIZE / 2, left: -EDGE_SIZE / 2, width: EDGE_SIZE * 2, height: EDGE_SIZE * 2, cursor: "nesw-resize" };
    default:
      return base;
  }
}

const EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FloatingPanel({
  id,
  title,
  children,
  initialPosition,
  initialSize,
  minSize,
  onClose,
  onDock,
}: FloatingPanelProps) {
  const width0 = initialSize?.width ?? DEFAULT_WIDTH;
  const height0 = initialSize?.height ?? DEFAULT_HEIGHT;
  const minW = minSize?.width ?? DEFAULT_MIN_WIDTH;
  const minH = minSize?.height ?? DEFAULT_MIN_HEIGHT;

  const [position, setPosition] = useState({
    x: initialPosition?.x ?? Math.max(0, (window.innerWidth - width0) / 2),
    y: initialPosition?.y ?? Math.max(0, (window.innerHeight - height0) / 2),
  });
  const [size, setSize] = useState({ width: width0, height: height0 });

  // -- Drag (title bar) -----------------------------------------------------

  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const handleDragStart = useCallback(
    (e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setDragState({
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        originX: position.x,
        originY: position.y,
      });
    },
    [position],
  );

  useEffect(() => {
    if (!dragState.isDragging) return;

    function handleMouseMove(e: globalThis.MouseEvent) {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - size.width, dragState.originX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - size.height, dragState.originY + dy)),
      });
    }

    function handleMouseUp() {
      setDragState((prev) => ({ ...prev, isDragging: false }));
    }

    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, size.width, size.height]);

  // -- Resize (edges / corners) ---------------------------------------------

  const [resizeState, setResizeState] = useState<ResizeState>({
    isResizing: false,
    edge: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    originW: 0,
    originH: 0,
  });

  const handleResizeStart = useCallback(
    (edge: ResizeEdge) => (e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setResizeState({
        isResizing: true,
        edge,
        startX: e.clientX,
        startY: e.clientY,
        originX: position.x,
        originY: position.y,
        originW: size.width,
        originH: size.height,
      });
    },
    [position, size],
  );

  useEffect(() => {
    if (!resizeState.isResizing) return;

    function handleMouseMove(e: globalThis.MouseEvent) {
      const dx = e.clientX - resizeState.startX;
      const dy = e.clientY - resizeState.startY;
      const { edge, originX, originY, originW, originH } = resizeState;

      let newX = originX;
      let newY = originY;
      let newW = originW;
      let newH = originH;

      // Horizontal component
      if (edge === "e" || edge === "se" || edge === "ne") {
        newW = Math.max(minW, originW + dx);
      }
      if (edge === "w" || edge === "sw" || edge === "nw") {
        const dw = Math.min(dx, originW - minW);
        newW = originW - dw;
        newX = originX + dw;
      }

      // Vertical component
      if (edge === "s" || edge === "se" || edge === "sw") {
        newH = Math.max(minH, originH + dy);
      }
      if (edge === "n" || edge === "ne" || edge === "nw") {
        const dh = Math.min(dy, originH - minH);
        newH = originH - dh;
        newY = originY + dh;
      }

      // Viewport clamp
      newX = Math.max(0, newX);
      newY = Math.max(0, newY);

      setPosition({ x: newX, y: newY });
      setSize({ width: newW, height: newH });
    }

    function handleMouseUp() {
      setResizeState((prev) => ({ ...prev, isResizing: false, edge: null }));
    }

    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizeState, minW, minH]);

  // -- Render ----------------------------------------------------------------

  const panelStyle: CSSProperties = {
    ...styles.panel,
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height,
  };

  return (
    <div id={`floating-panel-${id}`} style={panelStyle}>
      {/* Resize edge handles */}
      {EDGES.map((edge) => (
        <div
          key={edge}
          style={edgeStyle(edge)}
          onMouseDown={handleResizeStart(edge)}
        />
      ))}

      {/* Title bar */}
      <div
        style={{
          ...styles.header,
          cursor: dragState.isDragging ? "grabbing" : "grab",
        }}
        onMouseDown={handleDragStart}
      >
        <span style={styles.headerTitle}>{title}</span>
        <div style={styles.headerControls}>
          {onDock && (
            <button
              type="button"
              style={styles.headerButton}
              title="Dock panel"
              onClick={onDock}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--color-surface)";
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--color-text)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--color-text-dim)";
              }}
            >
              {/* Down-arrow-to-line icon (Unicode) */}
              &#x2913;
            </button>
          )}
          <button
            type="button"
            style={styles.headerButton}
            title="Close panel"
            onClick={onClose}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--color-surface)";
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--color-text)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--color-text-dim)";
            }}
          >
            &#x00D7;
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>{children}</div>
    </div>
  );
}
