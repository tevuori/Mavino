import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import * as Lucide from "lucide-react";
import { Lock } from "lucide-react";
import AppLogo from "./AppLogo";
import StartMenu from "./StartMenu";
import SystemTray from "./SystemTray";
import WorkspaceSwitcher from "../wm/WorkspaceSwitcher";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { useAccessibleApps } from "../store/features";
import { useWindows, type AppId } from "../store/windows";
import { useSettings } from "../store/settings";
import { matchesShortcut } from "../store/shortcuts";
import { getAppAccent } from "../apps/registry";

interface Props {
  onOpenOverview?: () => void;
}

export default function Taskbar({ onOpenOverview }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; appId: AppId } | null>(null);
  const { open } = useWindows();
  const windows = useWindows((s) => s.windows);
  const activeWorkspaceId = useWindows((s) => s.activeWorkspaceId);
  const apps = useAccessibleApps();
  const dockFavorites = useSettings((s) => s.dockFavorites);
  const setDockFavorites = useSettings((s) => s.setDockFavorites);
  const toggleDockShortcut = useSettings((s) => s.shortcuts.toggleDock);

  const pinned = useMemo(() => {
    const map = new Map(apps.map((a) => [a.id, a]));
    return dockFavorites
      .map((id) => map.get(id))
      .filter((a): a is (typeof apps)[number] => !!a);
  }, [apps, dockFavorites]);

  const running = useMemo(() => {
    const set = new Set<AppId>();
    for (const w of windows) {
      if (!w.minimized && w.workspaceId === activeWorkspaceId) {
        set.add(w.appId);
      }
    }
    return set;
  }, [windows, activeWorkspaceId]);

  const togglePinned = (appId: AppId, pinnedValue: boolean) => {
    setDockFavorites(
      pinnedValue
        ? [...dockFavorites.filter((id) => id !== appId), appId]
        : dockFavorites.filter((id) => id !== appId)
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === "Escape") {
        setStartOpen(false);
        setPanelOpen(false);
        setHovered(false);
        return;
      }
      // Super/Meta always toggles the dock (GNOME-style).
      if (
        (e.key === "Meta" || e.key === "OS") &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat
      ) {
        e.preventDefault();
        setStartOpen(false);
        setPanelOpen((v) => !v);
        return;
      }
      // Configured shortcut, plus a Ctrl+Shift+K fallback for browsers that intercept Super.
      if (matchesShortcut(e, toggleDockShortcut)) {
        e.preventDefault();
        setStartOpen(false);
        setPanelOpen((v) => !v);
        return;
      }
      if (e.ctrlKey && e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setStartOpen(false);
        setPanelOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDockShortcut]);

  const launch = (app: (typeof apps)[number]) => {
    open({ appId: app.id, title: app.name, icon: app.icon });
    setStartOpen(false);
    setPanelOpen(false);
    setHovered(false);
  };

  const visible = panelOpen || hovered || startOpen;
  const contextApp = pinned.find((a) => a.id === contextMenu?.appId);

  return (
    <>
      {/* Hot trigger at the bottom edge to raise the centered dock */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[10000] h-2"
        onMouseEnter={() => setHovered(true)}
      />

      {/* GNOME-style centered floating dock */}
      <motion.div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        initial={false}
        animate={{ y: visible ? 0 : "120%" }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="fixed bottom-4 left-1/2 z-[10001] flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-[28px] border border-white/[0.08] bg-surface/80 px-2 py-2 shadow-2xl backdrop-blur-2xl"
      >
        {/* Left: launcher + workspaces */}
        <div className="flex items-center gap-1.5 rounded-2xl bg-white/[0.03] px-1.5 py-1.5">
          <button
            onClick={() => setStartOpen((v) => !v)}
            className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${
              startOpen
                ? "bg-accent text-accent-fg ring-2 ring-accent/40"
                : "bg-surface-3 text-ink hover:bg-surface-2 hover:text-accent"
            }`}
            title="All apps"
          >
            <AppLogo size={22} />
          </button>
          <div className="h-6 w-px bg-white/10" />
          <div className="rounded-xl bg-surface-3/50 px-1 py-1">
            <WorkspaceSwitcher onOpenOverview={() => onOpenOverview?.()} />
          </div>
        </div>

        {/* Center: pinned app icons, centered in the dock */}
        <div
          className="flex flex-1 items-center justify-center gap-1.5 overflow-x-auto px-1"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {pinned.map((app) => {
            const Icon =
              (
                Lucide as unknown as Record<
                  string,
                  React.ComponentType<{ size?: number }>
                >
              )[app.icon] ?? Lucide.AppWindow;
            const accent = getAppAccent(app.id);
            return (
              <button
                key={app.id}
                onClick={() => launch(app)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, appId: app.id });
                }}
                className="group relative flex flex-col items-center justify-center gap-1 rounded-2xl p-1.5 transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent/40"
                title={app.name}
              >
                <div
                  className={`relative flex h-12 w-12 items-center justify-center rounded-2xl ${accent.bg} ${accent.text} shadow-sm ring-1 ring-white/5 transition group-hover:scale-110 group-hover:shadow-lg`}
                >
                  <Icon size={24} />
                  {app.access === "preview" && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface text-amber-500 ring-1 ring-white/10">
                      <Lock size={8} />
                    </span>
                  )}
                </div>
                {running.has(app.id) && (
                  <span className="h-1 w-1 rounded-full bg-accent" />
                )}
                <span className="max-w-[64px] truncate text-[10px] leading-tight text-ink-muted transition group-hover:text-ink">
                  {app.name}
                </span>
              </button>
            );
          })}
          {pinned.length === 0 && (
            <span className="px-2 text-xs text-ink-muted">No pinned apps</span>
          )}
        </div>

        {/* Right: system tray */}
        <div className="flex items-center gap-1.5 rounded-2xl bg-white/[0.03] px-1.5 py-1.5">
          <div className="h-6 w-px bg-white/10" />
          <SystemTray />
        </div>
      </motion.div>

      <StartMenu
        open={startOpen}
        onClose={() => {
          setStartOpen(false);
          setPanelOpen(false);
        }}
        onTogglePin={togglePinned}
      />

      {contextMenu && contextApp && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "Unpin from dock",
              icon: <Lucide.PinOff size={16} />,
              onClick: () => togglePinned(contextApp.id, false),
            },
          ] as MenuItem[]}
        />
      )}
    </>
  );
}
