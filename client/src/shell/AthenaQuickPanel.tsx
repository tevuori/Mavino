import { useRef, useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AthenaApp from "../apps/athena/AthenaApp";
import { useAthenaQuick } from "../store/athenaQuick";
import { useSettings, type AthenaRollEdge, type AthenaQuickSize } from "../store/settings";
import { useWindows } from "../store/windows";

const TASKBAR_H = 0; // bottom bar auto-hides, so full viewport is usable
const MIN_W = 360;
const MIN_H = 240;
// Above normal windows AND always-on-top Athena app windows (10000 + zCounter),
// but below other shell overlays (StartMenu 11000, ContextMenu 12000, etc.).
// The panel is positioned above the taskbar area so it never overlaps it.
const PANEL_Z = 10990;

type DragMode = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Compute the default size for a given edge (used on first open / edge change). */
function defaultSize(edge: AthenaRollEdge): AthenaQuickSize {
  const vw = window.innerWidth;
  const vh = window.innerHeight - TASKBAR_H;
  if (edge === "bottom" || edge === "top") {
    return { width: Math.round(vw * 0.8), height: Math.round(vh * 0.75) };
  }
  return { width: Math.round(vw * 0.75), height: vh };
}

/** Compute the anchored position for a panel of given size on a given edge. */
function anchorRect(edge: AthenaRollEdge, size: AthenaQuickSize): PanelRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight - TASKBAR_H;
  const width = Math.min(size.width, vw - 20);
  const height = Math.min(size.height, vh - 20);
  switch (edge) {
    case "bottom":
      return { x: Math.round((vw - width) / 2), y: vh - height, width, height };
    case "top":
      return { x: Math.round((vw - width) / 2), y: 0, width, height };
    case "left":
      return { x: 0, y: Math.round((vh - height) / 2), width, height };
    case "right":
      return { x: vw - width, y: Math.round((vh - height) / 2), width, height };
  }
}

/** Which resize handles to show for a given edge (the anchored side is hidden). */
function handlesForEdge(edge: AthenaRollEdge): DragMode[] {
  switch (edge) {
    case "bottom":
      return ["n", "e", "w", "ne", "nw"];
    case "top":
      return ["s", "e", "w", "se", "sw"];
    case "left":
      return ["e", "n", "s", "ne", "se"];
    case "right":
      return ["w", "n", "s", "nw", "sw"];
  }
}

/** Initial transform offset so the panel starts fully off-screen on the edge. */
function initialOffset(edge: AthenaRollEdge, rect: PanelRect) {
  const buf = 60;
  switch (edge) {
    case "bottom":
      return { x: 0, y: rect.height + TASKBAR_H + buf };
    case "top":
      return { x: 0, y: -(rect.height + buf) };
    case "left":
      return { x: -(rect.width + buf), y: 0 };
    case "right":
      return { x: rect.width + buf, y: 0 };
  }
}

export default function AthenaQuickPanel() {
  const open = useAthenaQuick((s) => s.open);
  const setOpen = useAthenaQuick((s) => s.setOpen);
  const edge = useSettings((s) => s.athenaRollEdge);
  const quickSize = useSettings((s) => s.athenaQuickSize);
  const setAthenaQuickSize = useSettings((s) => s.setAthenaQuickSize);
  const openWindow = useWindows((s) => s.open);

  // Current panel rect (recomputed when edge or saved size changes).
  const size: AthenaQuickSize = quickSize ?? defaultSize(edge);
  const [rect, setRect] = useState<PanelRect>(() => anchorRect(edge, size));

  // Recompute rect when edge changes or when opening (viewport may have resized).
  useEffect(() => {
    setRect(anchorRect(edge, quickSize ?? defaultSize(edge)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edge]);

  useEffect(() => {
    if (open) setRect(anchorRect(edge, quickSize ?? defaultSize(edge)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // ===== Resize logic =====
  const dragState = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (mode: DragMode) => (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragState.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height,
      };
    },
    [rect.width, rect.height]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const st = dragState.current;
      if (!st) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      let width = st.startW;
      let height = st.startH;

      if (st.mode.includes("e")) width = Math.max(MIN_W, st.startW + dx);
      if (st.mode.includes("w")) width = Math.max(MIN_W, st.startW - dx);
      if (st.mode.includes("s")) height = Math.max(MIN_H, st.startH + dy);
      if (st.mode.includes("n")) height = Math.max(MIN_H, st.startH - dy);

      // Clamp to viewport.
      const vw = window.innerWidth;
      const vh = window.innerHeight - TASKBAR_H;
      width = Math.min(width, vw - 20);
      height = Math.min(height, vh - 20);

      setRect(anchorRect(edge, { width, height }));
    },
    [edge]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const st = dragState.current;
      dragState.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (st) {
        // Persist the final size.
        setAthenaQuickSize({ width: rect.width, height: rect.height });
      }
    },
    [rect.width, rect.height, setAthenaQuickSize]
  );

  const handleExpand = useCallback(() => {
    setOpen(false);
    openWindow({ appId: "athena", title: "Mavino", icon: "Sparkles" });
  }, [setOpen, openWindow]);

  const handles = handlesForEdge(edge);
  const cursorFor: Record<DragMode, string> = {
    n: "cursor-n-resize",
    s: "cursor-s-resize",
    e: "cursor-e-resize",
    w: "cursor-w-resize",
    ne: "cursor-ne-resize",
    nw: "cursor-nw-resize",
    se: "cursor-se-resize",
    sw: "cursor-sw-resize",
  };
  const handleClass: Record<DragMode, string> = {
    n: "top-0 left-0 h-1.5 w-full",
    s: "bottom-0 left-0 h-1.5 w-full",
    e: "right-0 top-0 h-full w-1.5",
    w: "left-0 top-0 h-full w-1.5",
    ne: "top-0 right-0 h-3 w-3",
    nw: "top-0 left-0 h-3 w-3",
    se: "bottom-0 right-0 h-3 w-3",
    sw: "bottom-0 left-0 h-3 w-3",
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="athena-quick-panel"
          initial={initialOffset(edge, rect)}
          animate={{ x: 0, y: 0, opacity: 1 }}
          exit={initialOffset(edge, rect)}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="absolute flex flex-col overflow-hidden rounded-lg border border-edge bg-surface shadow-window"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            zIndex: PANEL_Z,
          }}
        >
          <AthenaApp mode="quick" onExpand={handleExpand} />

          {/* Resize handles */}
          {handles.map((h) => (
            <div
              key={h}
              onPointerDown={onPointerDown(h)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className={`absolute ${handleClass[h]} ${cursorFor[h]}`}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
