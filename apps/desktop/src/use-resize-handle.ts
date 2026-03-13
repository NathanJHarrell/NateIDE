import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

// ---------------------------------------------------------------------------
// useResizeHandle – reusable drag-to-resize hook
// ---------------------------------------------------------------------------

export type ResizeDirection = "horizontal" | "vertical";

export type UseResizeHandleOptions = {
  direction: ResizeDirection;
  initialSize: number;
  min: number;
  max: number;
  /** Called on every resize frame with the clamped size. */
  onResize?: (size: number) => void;
};

export type UseResizeHandleReturn = {
  size: number;
  handleProps: { onMouseDown: (e: ReactMouseEvent) => void };
  isResizing: boolean;
};

type DragState = {
  active: boolean;
  startPos: number;
  startSize: number;
};

export function useResizeHandle(
  options: UseResizeHandleOptions,
): UseResizeHandleReturn {
  const { direction, initialSize, min, max, onResize } = options;

  const [size, setSize] = useState(initialSize);
  const dragRef = useRef<DragState>({ active: false, startPos: 0, startSize: 0 });
  const [isResizing, setIsResizing] = useState(false);

  // Keep callbacks in a ref so the effect closure always sees the latest.
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pos = direction === "horizontal" ? e.clientX : e.clientY;
      dragRef.current = { active: true, startPos: pos, startSize: size };
      setIsResizing(true);
      document.body.style.userSelect = "none";
    },
    [direction, size],
  );

  useEffect(() => {
    if (!isResizing) return;

    function handleMouseMove(e: globalThis.MouseEvent) {
      const drag = dragRef.current;
      if (!drag.active) return;
      const pos = direction === "horizontal" ? e.clientX : e.clientY;
      const delta = pos - drag.startPos;
      const next = Math.min(max, Math.max(min, drag.startSize + delta));
      setSize(next);
      onResizeRef.current?.(next);
    }

    function handleMouseUp() {
      dragRef.current.active = false;
      setIsResizing(false);
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, direction, min, max]);

  return { size, handleProps: { onMouseDown: handleMouseDown }, isResizing };
}
