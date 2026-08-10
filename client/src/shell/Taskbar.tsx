import { useState, useEffect } from "react";
import * as Lucide from "lucide-react";
import { Lock, Pin, PinOff } from "lucide-react";
import AppLogo from "./AppLogo";
import { useWindows } from "../store/windows";
import { useAccessibleApps } from "../store/features";
import { useTaskbarPins } from "../store/taskbarPins";
import StartMenu from "./StartMenu";
import SystemTray from "./SystemTray";
import WorkspaceSwitcher from "../wm/WorkspaceSwitcher";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import type { AppId } from "../store/windows";

interface Props {
  onOpenOverview?: () => void;
}

export default function Taskbar({ onOpenOverview }: Props) {
  const { windows, focusedId, restoreOrMinimize, open } = useWindows();
  const apps = useAccessibleApps();
  const activeWorkspaceId = useWindows((s) => s.activeWorkspaceId);
  const switchWorkspace = useWindows((s) => s.switchWorkspace);
  const { pins, isPinned, togglePin } = useTaskbarPins();
  const [startOpen, setStartOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; appId: AppId } | null>(null);

  // Escape closes the start menu (the Win/Meta key is not bound here because it
  // triggers native OS shortcuts on Linux and other platforms).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStartOpen(false);
        setCtxMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Build the taskbar app list: pinned apps first (in pin order), then any
  // running apps that aren't pinned (appended in encounter order).
  const appById = new Map(apps.map((a) => [a.id, a]));
  const taskbarAppIds: AppId[] = [];
  for (const id of pins) {
    if (appById.has(id)) taskbarAppIds.push(id);
  }
  for (const w of windows) {
    if (!taskbarAppIds.includes(w.appId) && appById.has(w.appId)) {
      taskbarAppIds.push(w.appId);
    }
  }

  const ctxItems = (appId: AppId): MenuItem[] => {
    const app = appById.get(appId);
    if (!app) return [];
    return [
      {
        label: isPinned(appId) ? "Unpin from taskbar" : "Pin to taskbar",
        icon: isPinned(appId) ? <PinOff size={15} /> : <Pin size={15} />,
        onClick: () => togglePin(appId),
      },
      {
        label: `Open ${app.name}`,
        onClick: () => open({ appId: app.id, title: app.name, icon: app.icon }),
      },
    ];
  };

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
          {taskbarAppIds.map((appId) => {
            const app = appById.get(appId)!;
            const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[app.icon] ?? Lucide.AppWindow;
            const appWindows = windows.filter((w) => w.appId === app.id);
            const isRunning = appWindows.length > 0;
            const isActive = appWindows.some((w) => w.id === focusedId && !w.minimized);
            const pinned = isPinned(app.id);
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, appId: app.id });
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
                {pinned && !isRunning && (
                  <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-ink-muted/50" />
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

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems(ctxMenu.appId)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}
