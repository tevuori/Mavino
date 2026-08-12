import { useRef, useCallback, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Minus, Square, X, Copy } from "lucide-react";
import { useWindows, type WindowInstance, type SnapZone } from "../store/windows";
import { useShowControl } from "../store/showControl";
import ContextMenu, { type MenuItem } from "../shell/ContextMenu";

interface Props {
  win: WindowInstance;
  children: ReactNode;
}

const MIN_W = 320;
const MIN_H = 200;
const TASKBAR_H = 40; // matches slim status bar
const DOCK_W = 72; // fixed left AppDock width
const GRID_SIZE = 20; // px, for Shift+resize grid snapping
const SNAP_EDGE = 24; // px from edge/corner to trigger snap

/** Snap value to nearest grid increment. */
function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

/** Detect which snap zone the cursor is in during a drag. */
function detectSnapZone(clientX: number, clientY: number): SnapZone {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Corner detection (priority — needs to be near both edges)
  const nearLeft = clientX <= DOCK_W + SNAP_EDGE;
  const nearRight = clientX >= vw - SNAP_EDGE;
  const nearTop = clientY <= SNAP_EDGE;
  const nearBottom = clientY >= vh - TASKBAR_H - SNAP_EDGE;
  if (nearTop && nearLeft) return "top-left";
  if (nearTop && nearRight) return "top-right";
  if (nearBottom && nearLeft) return "bottom-left";
  if (nearBottom && nearRight) return "bottom-right";
  // Edge detection
  if (nearTop) return "maximized";
  if (nearLeft) return "left";
  if (nearRight) return "right";
  return "none";
}

export default function Window({ win, children }: Props) {
  const { focus, close, minimize, toggleMaximize, snap, setRect } = useWindows();
  const workspaces = useWindows((s) => s.workspaces);
  const focusedId = useWindows((s) => s.focusedId);
  // Teach Me: the source the tutor's voice is currently anchored to glows.
  const speaking = useShowControl((s) => s.speakingWindowId) === win.id;
  const moveWindowToWorkspace = useWindows((s) => s.moveWindowToWorkspace);
  const dragState = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startRect: { x: number; y: number; width: number; height: number };
    shiftKey: boolean;
  } | null>(null);
  const snapPreviewRef = useRef<SnapZone>("none");
  // Track whether the user is actively dragging/resizing to disable CSS transitions.
  const [isInteracting, setIsInteracting] = useState(false);
  // Title-bar context menu (right-click) for workspace management.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [ctxSubmenu, setCtxSubmenu] = useState(false);

  const onPointerDown = useCallback(
    (mode: DragMode) => (e: React.PointerEvent) => {
      if (win.snap === "maximized" && mode === "move") return;
      e.stopPropagation();
      focus(win.id);
      setIsInteracting(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragState.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...win.rect },
        shiftKey: e.shiftKey,
      };
    },
    [focus, win.id, win.rect, win.snap]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const st = dragState.current;
      if (!st) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      let { x, y, width, height } = st.startRect;
      const useGrid = st.shiftKey || e.shiftKey;

      if (st.mode === "move") {
        x += dx;
        y += dy;
        // Snap detection at screen edges + corners
        const zone = detectSnapZone(e.clientX, e.clientY);
        snapPreviewRef.current = zone;
        document.dispatchEvent(
          new CustomEvent("snap-preview", { detail: zone })
        );
        if (useGrid) {
          x = snapToGrid(x);
          y = snapToGrid(y);
        }
      } else {
        if (st.mode.includes("e")) {
          width = Math.max(MIN_W, st.startRect.width + dx);
          if (useGrid) width = snapToGrid(width);
        }
        if (st.mode.includes("s")) {
          height = Math.max(MIN_H, st.startRect.height + dy);
          if (useGrid) height = snapToGrid(height);
        }
        if (st.mode.includes("w")) {
          let newW = Math.max(MIN_W, st.startRect.width - dx);
          if (useGrid) newW = snapToGrid(newW);
          x = st.startRect.x + (st.startRect.width - newW);
          width = newW;
        }
        if (st.mode.includes("n")) {
          let newH = Math.max(MIN_H, st.startRect.height - dy);
          if (useGrid) newH = snapToGrid(newH);
          y = st.startRect.y + (st.startRect.height - newH);
          height = newH;
        }
      }

      // Clamp to viewport (right of dock, above taskbar)
      const maxY = window.innerHeight - TASKBAR_H - height;
      y = Math.max(0, Math.min(y, Math.max(0, maxY)));
      x = Math.max(DOCK_W, Math.min(x, window.innerWidth - width - 4));

      setRect(win.id, { x, y, width, height });
    },
    [setRect, win.id]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const st = dragState.current;
      dragState.current = null;
      setIsInteracting(false);
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      const zone = snapPreviewRef.current;
      snapPreviewRef.current = "none";
      document.dispatchEvent(new CustomEvent("snap-preview", { detail: "none" }));
      if (st?.mode === "move" && zone !== "none") {
        snap(win.id, zone);
      } else if (st?.mode === "move" && win.snap !== "none") {
        // dragging a snapped window unsnaps it
        snap(win.id, "none");
      }
    },
    [snap, win.id, win.snap]
  );

  if (win.minimized) {
    // Render a brief shrinking animation toward the taskbar before unmounting.
    return (
      <motion.div
        initial={{ opacity: 1, scale: 1 }}
        animate={{ opacity: 0, scale: 0.3, y: 200 }}
        transition={{ duration: 0.18, ease: "easeIn" }}
        className="absolute flex flex-col overflow-hidden rounded-2xl border border-edge/60 bg-surface/90 shadow-window backdrop-blur-xl"
        style={{
          left: win.rect.x,
          top: win.rect.y,
          width: win.rect.width,
          height: win.rect.height,
          zIndex: win.zIndex,
          pointerEvents: "none",
          transformOrigin: "bottom center",
        }}
      >
        <div className="flex h-10 shrink-0 items-center border-b border-edge/60 bg-surface-2/80 px-3 text-sm font-medium text-ink">
          <span className="text-accent">●</span>
          <span className="truncate">{win.title}</span>
        </div>
      </motion.div>
    );
  }

  const isMax =
    win.snap === "maximized" ||
    (win.rect.x <= DOCK_W + 4 &&
      win.rect.width >= window.innerWidth - DOCK_W - 4 &&
      win.rect.height >= window.innerHeight - TASKBAR_H - 4);
  // Enable smooth CSS transitions for position/size when auto-tiling.
  // Disable during drag/resize so the window follows the cursor instantly.
  const useTransition = win.tiling && !isInteracting;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: 8 }}
      animate={
        win.closing
          ? { opacity: 0, scale: 0.92, y: 10 }
          : { opacity: 1, scale: 1, y: 0 }
      }
      exit={{ opacity: 0, scale: 0.92, y: 10 }}
      transition={{
        duration: win.closing ? 0.18 : 0.16,
        ease: win.closing ? "easeIn" : "easeOut",
      }}
      onPointerDown={() => focus(win.id)}
      className={`absolute flex flex-col overflow-hidden rounded-2xl border bg-surface/85 shadow-window backdrop-blur-2xl ${
        speaking
          ? "border-accent/60 ring-2 ring-accent/40"
          : win.id === focusedId
          ? "border-accent/30 shadow-accent/10"
          : "border-edge/50"
      }`}
      style={{
        left: win.rect.x,
        top: win.rect.y,
        width: win.rect.width,
        height: win.rect.height,
        zIndex: win.zIndex,
        pointerEvents: "auto",
        transformOrigin: "center",
        ...(useTransition
          ? { transition: "left 0.3s ease, top 0.3s ease, width 0.3s ease, height 0.3s ease" }
          : {}),
      }}
    >
      {/* Title bar */}
      <div
        onPointerDown={onPointerDown("move")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => toggleMaximize(win.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxSubmenu(false);
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        className="flex h-10 shrink-0 cursor-grab select-none items-center justify-between border-b border-edge/50 bg-surface-2/40 px-3 active:cursor-grabbing"
      >
        <div className="flex items-center gap-2 px-1 text-sm font-medium text-ink">
          <span className="text-accent">●</span>
          <span className="truncate">{win.title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => minimize(win.id)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition hover:bg-white/[0.08] hover:text-ink"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toggleMaximize(win.id)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition hover:bg-white/[0.08] hover:text-ink"
            title={isMax ? "Restore" : "Maximize"}
          >
            {isMax ? <Copy size={12} /> : <Square size={11} />}
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => close(win.id)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition hover:bg-red-500/15 hover:text-red-400"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden bg-surface/60 @container">{children}</div>

      {/* Resize handles (hidden when maximized) */}
      {!isMax && (
        <>
          <div onPointerDown={onPointerDown("e")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute right-0 top-0 h-full w-1.5 cursor-e-resize" />
          <div onPointerDown={onPointerDown("w")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute left-0 top-0 h-full w-1.5 cursor-w-resize" />
          <div onPointerDown={onPointerDown("s")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute bottom-0 left-0 h-1.5 w-full cursor-s-resize" />
          <div onPointerDown={onPointerDown("n")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute top-0 left-0 h-1.5 w-full cursor-n-resize" />
          <div onPointerDown={onPointerDown("se")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize" />
          <div onPointerDown={onPointerDown("sw")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute bottom-0 left-0 h-3 w-3 cursor-sw-resize" />
          <div onPointerDown={onPointerDown("ne")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute top-0 right-0 h-3 w-3 cursor-ne-resize" />
          <div onPointerDown={onPointerDown("nw")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute top-0 left-0 h-3 w-3 cursor-nw-resize" />
        </>
      )}

      {/* Title-bar context menu: Move to workspace / Close */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxSubmenu
            ? [
                { label: "← Back", keepOpen: true, onClick: () => setCtxSubmenu(false) },
                { separator: true },
                ...workspaces.map((ws) => ({
                  label: ws.name,
                  disabled: ws.id === win.workspaceId,
                  keepOpen: false,
                  onClick: () => {
                    moveWindowToWorkspace(win.id, ws.id);
                    setCtxMenu(null);
                  },
                })),
              ] as MenuItem[]
            : [
                {
                  label: "Move to workspace…",
                  keepOpen: true,
                  onClick: () => setCtxSubmenu(true),
                },
                { separator: true },
                {
                  label: "Close",
                  danger: true,
                  onClick: () => {
                    close(win.id);
                    setCtxMenu(null);
                  },
                },
              ] as MenuItem[]
          }
          onClose={() => setCtxMenu(null)}
        />
      )}
    </motion.div>
  );
}

type DragMode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
