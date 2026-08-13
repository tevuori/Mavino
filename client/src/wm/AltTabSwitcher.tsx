import { useEffect, useState } from "react";
import { useWindows } from "../store/windows";
import { useSettings } from "../store/settings";
import { matchesShortcut } from "../store/shortcuts";
import * as Lucide from "lucide-react";

/** Alt+Tab (and Shift+Alt+Tab) window switcher overlay.
 *  Uses the configurable `cycleWindows` shortcut (default: Alt+Tab). */
export default function AltTabSwitcher() {
  const { windows, focusedId, cycleFocus } = useWindows();
  const activeWorkspaceId = useWindows((s) => s.activeWorkspaceId);
  const cycleShortcut = useSettings((s) => s.shortcuts.cycleWindows);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let tabDown = false;
    let timer: number | undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcut(e, cycleShortcut)) {
        e.preventDefault();
        if (!tabDown) {
          tabDown = true;
          setVisible(true);
        }
        cycleFocus(e.shiftKey ? -1 : 1);
        window.clearTimeout(timer);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // Close the overlay when the modifier key is released.
      // For the default Alt+Tab, that's Alt; for a Ctrl-based shortcut, Ctrl; etc.
      if (
        (cycleShortcut.alt && e.key === "Alt") ||
        (cycleShortcut.ctrl && e.key === "Control") ||
        (cycleShortcut.meta && e.key === "Meta") ||
        (cycleShortcut.super && (e.key === "Meta" || e.key === "Control"))
      ) {
        tabDown = false;
        timer = window.setTimeout(() => setVisible(false), 120);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.clearTimeout(timer);
    };
  }, [cycleFocus, cycleShortcut]);

  if (!visible) return null;

  const sorted = [...windows]
    .filter((w) => !w.minimized && w.workspaceId === activeWorkspaceId)
    .sort((a, b) => b.zIndex - a.zIndex);

  return (
    <div className="pointer-events-none fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="flex max-w-2xl flex-wrap items-center justify-center gap-3 rounded-xl border border-edge bg-surface-2 p-5 shadow-window">
        {sorted.map((w) => {
          const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[w.icon] ?? Lucide.AppWindow;
          const active = w.id === focusedId;
          return (
            <div
              key={w.id}
              className={`flex w-32 flex-col items-center gap-2 rounded-lg border p-3 text-center ${
                active ? "border-accent bg-accent/15" : "border-edge bg-surface"
              }`}
            >
              <Icon size={24} />
              <span className="line-clamp-2 text-xs text-ink">{w.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
