import { useState, type ReactNode } from "react";
import { PanelLeftClose, PanelRightClose } from "lucide-react";

interface Props {
  /** Which side the sidebar sits on. */
  side: "left" | "right";
  /** Tailwind width class for the sidebar, e.g. "w-56". */
  width: string;
  /** Container-query breakpoint at which the sidebar is always visible inline,
   *  e.g. "@5xl". Below this width the sidebar collapses and a toggle button
   *  reveals it as an overlay. */
  showAt: string;
  /** Icon + label for the toggle button shown when collapsed. */
  toggleIcon?: ReactNode;
  toggleLabel?: string;
  /** Extra classes for the sidebar panel itself (e.g. "bg-surface-2"). */
  panelClassName?: string;
  children: ReactNode;
}

/**
 * A sidebar that is inline when the surrounding @container is wide enough,
 * and collapses into a toggleable overlay when narrow.
 *
 * The children are rendered exactly once (preserving their internal state):
 * the wrapper switches between `hidden`, absolute overlay, and static inline
 * purely via container-query utilities + a local `open` flag.
 */
export default function CollapsibleSidebar({
  side,
  width,
  showAt,
  toggleIcon,
  toggleLabel,
  panelClassName = "",
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const isLeft = side === "left";

  // Toggle button — only visible below the breakpoint.
  const Toggle = (
    <button
      onClick={() => setOpen(true)}
      className={`${showAt}:hidden flex items-center gap-1.5 rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink`}
      title={toggleLabel ?? "Show panel"}
    >
      {toggleIcon ?? (isLeft ? <PanelLeftClose size={14} /> : <PanelRightClose size={14} />)}
      {toggleLabel && <span className="max-w-[120px] truncate">{toggleLabel}</span>}
    </button>
  );

  return (
    <>
      {Toggle}

      {/* Backdrop — only when narrow + overlay open */}
      {open && (
        <div
          className={`${showAt}:hidden absolute inset-0 z-10 bg-black/40`}
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar panel: hidden when narrow+closed, overlay when narrow+open,
          static inline when wide. */}
      <div
        className={[
          // base (narrow): absolute overlay or hidden
          `absolute inset-y-0 z-20 shrink-0 flex flex-col border-edge shadow-window`,
          isLeft ? "left-0 border-r" : "right-0 border-l",
          width,
          panelClassName,
          open ? "flex" : "hidden",
          // wide: inline, no overlay chrome
          `${showAt}:static ${showAt}:z-auto ${showAt}:shadow-none ${showAt}:flex`,
        ].join(" ")}
      >
        {/* Close button — only meaningful in overlay mode (narrow) */}
        <div className={`${showAt}:hidden flex items-center justify-between border-b border-edge px-2 py-1.5`}>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {toggleLabel ?? "Panel"}
          </span>
          <button
            onClick={() => setOpen(false)}
            className="rounded p-0.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Hide panel"
          >
            {isLeft ? <PanelLeftClose size={14} /> : <PanelRightClose size={14} />}
          </button>
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden">{children}</div>
      </div>
    </>
  );
}
