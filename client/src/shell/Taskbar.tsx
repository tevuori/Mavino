import { useState, useEffect } from "react";
import * as Lucide from "lucide-react";
import { Lock } from "lucide-react";
import AppLogo from "./AppLogo";
import { useWindows } from "../store/windows";
import { useAccessibleApps } from "../store/features";
import StartMenu from "./StartMenu";
import SystemTray from "./SystemTray";
import WorkspaceSwitcher from "../wm/WorkspaceSwitcher";

interface Props {
  onOpenOverview?: () => void;
}

export default function Taskbar({ onOpenOverview }: Props) {
  const { windows, focusedId, restoreOrMinimize, open } = useWindows();
  const apps = useAccessibleApps();
  const activeWorkspaceId = useWindows((s) => s.activeWorkspaceId);
  const switchWorkspace = useWindows((s) => s.switchWorkspace);
  const [startOpen, setStartOpen] = useState(false);

  // Escape closes the start menu (the Win/Meta key is not bound here because it
  // triggers native OS shortcuts on Linux and other platforms).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStartOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Group windows by appId for taskbar buttons
  const taskbarApps = apps.filter((a) => windows.some((w) => w.appId === a.id));

  return (
    <>
      <div className="absolute bottom-0 left-0 right-0 z-[10000] flex h-12 items-center gap-1 border-t border-edge bg-surface/80 px-2 backdrop-blur-xl">
        {/* Left: Start button (flex-1 keeps apps centered) */}
        <div className="flex flex-1 items-center gap-1">
          <button
            onClick={() => setStartOpen((v) => !v)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
              startOpen ? "bg-accent text-accent-fg" : "text-ink hover:bg-surface-3"
            }`}
            title="Start"
          >
            <AppLogo size={22} />
          </button>
          <div className="mx-1 h-6 w-px bg-edge" />
          <WorkspaceSwitcher onOpenOverview={() => onOpenOverview?.()} />
        </div>

        {/* Center: Pinned + running apps (GNOME-style centered dash) */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {apps.map((app) => {
            const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[app.icon] ?? Lucide.AppWindow;
            const appWindows = windows.filter((w) => w.appId === app.id);
            const isRunning = appWindows.length > 0;
            const isActive = appWindows.some((w) => w.id === focusedId && !w.minimized);
            return (
              <button
                key={app.id}
                onClick={() => {
                  if (appWindows.length === 0) {
                    open({ appId: app.id, title: app.name, icon: app.icon });
                  } else {
                    // Prefer the topmost window of this app on the current workspace.
                    const onCurrent = appWindows.filter((w) => w.workspaceId === activeWorkspaceId);
                    const top = [...(onCurrent.length > 0 ? onCurrent : appWindows)]
                      .sort((a, b) => b.zIndex - a.zIndex)[0];
                    // If the chosen window is on another workspace, switch to it.
                    if (top.workspaceId !== activeWorkspaceId) {
                      switchWorkspace(top.workspaceId);
                    }
                    restoreOrMinimize(top.id);
                  }
                }}
                className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition ${
                  isActive
                    ? "bg-accent/20 text-accent"
                    : isRunning
                    ? "text-ink hover:bg-surface-3"
                    : "text-ink-muted hover:bg-surface-3 hover:text-ink"
                }`}
                title={app.name}
              >
                <Icon size={18} />
                {app.access === "preview" && (
                  <span className="absolute right-0 top-0 text-amber-500">
                    <Lock size={8} />
                  </span>
                )}
                {isRunning && (
                  <span
                    className={`absolute bottom-0.5 left-1/2 h-1 -translate-x-1/2 rounded-full ${
                      isActive ? "w-4 bg-accent" : "w-2 bg-ink-muted"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Right: System tray (flex-1 keeps apps centered) */}
        <div className="flex flex-1 items-center justify-end">
          <SystemTray />
        </div>
      </div>

      <StartMenu open={startOpen} onClose={() => setStartOpen(false)} />
    </>
  );
}
