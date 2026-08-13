import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import * as Lucide from "lucide-react";
import { Lock, Pin, PinOff, X } from "lucide-react";
import AppLogo from "./AppLogo";
import StartMenu from "./StartMenu";
import SystemTray from "./SystemTray";
import WorkspaceSwitcher from "../wm/WorkspaceSwitcher";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { useAccessibleApps } from "../store/features";
import { useWindows, type AppId, type WindowInstance } from "../store/windows";
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
  const hideTimer = useRef<number | null>(null);

  // Reveal immediately and cancel any pending hide (e.g. when moving between
  // the dock and the corner panels).
  const reveal = useCallback(() => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHovered(true);
  }, []);

  // Schedule a hide after a short delay so the panels don't flicker away when
  // the cursor briefly crosses a gap between the three panels.
  const scheduleHide = useCallback(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setHovered(false);
      hideTimer.current = null;
    }, 400);
  }, []);

  useEffect(() => () => { if (hideTimer.current !== null) clearTimeout(hideTimer.current); }, []);
  const { open, restoreOrMinimize } = useWindows();
  const windows = useWindows((s) => s.windows);
  const focusedId = useWindows((s) => s.focusedId);
  const activeWorkspaceId = useWindows((s) => s.activeWorkspaceId);
  const apps = useAccessibleApps();
  const dockFavorites = useSettings((s) => s.dockFavorites);
  const setDockFavorites = useSettings((s) => s.setDockFavorites);
  const toggleDockShortcut = useSettings((s) => s.shortcuts.toggleDock);

  const appMap = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);

  const pinned = useMemo(
    () =>
      dockFavorites
        .map((id) => appMap.get(id))
        .filter((a): a is (typeof apps)[number] => !!a),
    [appMap, dockFavorites]
  );

  // Apps that have at least one window on the current workspace (minimized or
  // not). These get a running indicator and, if not pinned, appear in the dock.
  const runningOnWorkspace = useMemo(() => {
    const set = new Set<AppId>();
    for (const w of windows) {
      if (w.workspaceId === activeWorkspaceId && !w.closing) set.add(w.appId);
    }
    return set;
  }, [windows, activeWorkspaceId]);

  // Apps with at least one visible (non-minimized) window — used to render a
  // stronger indicator than a fully-minimized app.
  const activeAppIds = useMemo(() => {
    const set = new Set<AppId>();
    for (const w of windows) {
      if (w.workspaceId === activeWorkspaceId && !w.minimized && !w.closing) set.add(w.appId);
    }
    return set;
  }, [windows, activeWorkspaceId]);

  // Running apps that aren't pinned — appended after a separator.
  const runningUnpinned = useMemo(
    () =>
      apps.filter(
        (a) => runningOnWorkspace.has(a.id) && !dockFavorites.includes(a.id)
      ),
    [apps, runningOnWorkspace, dockFavorites]
  );

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
        if (hideTimer.current !== null) {
          clearTimeout(hideTimer.current);
          hideTimer.current = null;
        }
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

  // Click behavior (GNOME dash):
  //  - no window for this app on the current workspace → launch a new one
  //  - otherwise toggle the focused window of this app (focus ↔ minimize);
  //    if none of the app's windows is focused, focus its topmost one.
  const handleAppClick = (app: (typeof apps)[number]) => {
    const wins = windows
      .filter(
        (w) => w.appId === app.id && w.workspaceId === activeWorkspaceId && !w.closing
      )
      .sort((a, b) => b.zIndex - a.zIndex);
    if (wins.length === 0) {
      open({ appId: app.id, title: app.name, icon: app.icon });
    } else {
      const focused = wins.find((w) => w.id === focusedId);
      const target: WindowInstance = focused ?? wins[0];
      restoreOrMinimize(target.id);
    }
    setPanelOpen(false);
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHovered(false);
  };

  const closeAllWindows = (appId: AppId) => {
    for (const w of windows) {
      if (w.appId === appId && w.workspaceId === activeWorkspaceId && !w.closing) {
        useWindows.getState().close(w.id);
      }
    }
  };

  const dockVisible = panelOpen || hovered || startOpen;
  const contextApp = contextMenu ? appMap.get(contextMenu.appId) : null;
  const contextAppIsPinned = contextApp ? dockFavorites.includes(contextApp.id) : false;
  const contextAppIsRunning = contextApp ? runningOnWorkspace.has(contextApp.id) : false;

  const renderApp = (app: (typeof apps)[number]) => {
    const Icon =
      (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[
        app.icon
      ] ?? Lucide.AppWindow;
    const accent = getAppAccent(app.id);
    const isRunning = runningOnWorkspace.has(app.id);
    const isActive = activeAppIds.has(app.id);
    const isFocused = windows.some(
      (w) => w.appId === app.id && w.id === focusedId && !w.minimized
    );
    return (
      <button
        key={app.id}
        onClick={() => handleAppClick(app)}
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
          <Icon size={26} />
          {app.access === "preview" && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface text-amber-500 ring-1 ring-white/10">
              <Lock size={8} />
            </span>
          )}
        </div>
        {/* Running indicator: a bar under the icon, stronger when focused/active */}
        <span
          className={`h-1 rounded-full transition-all ${
            isFocused
              ? "w-5 bg-accent"
              : isActive
              ? "w-3.5 bg-accent/70"
              : isRunning
              ? "w-2 bg-ink-muted/60"
              : "w-0 bg-transparent"
          }`}
        />
      </button>
    );
  };

  const isEmpty = pinned.length === 0 && runningUnpinned.length === 0;

  return (
    <>
      {/* Hot trigger at the bottom edge to raise the centered dock */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[10000] h-3"
        onMouseEnter={reveal}
      />

      {/* Bottom-left corner: start button + workspaces (flush with the corner).
          Auto-hides like the dock — slides down out of view when not hovered. */}
      <motion.div
        onMouseEnter={reveal}
        onMouseLeave={scheduleHide}
        initial={false}
        animate={{ y: dockVisible ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="fixed bottom-0 left-0 z-[10002] flex items-center gap-1.5 rounded-tr-2xl border-t border-r border-white/[0.06] bg-surface/70 px-2 py-2 shadow-lg backdrop-blur-xl"
      >
        <button
          onClick={() => setStartOpen((v) => !v)}
          className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
            startOpen
              ? "bg-accent text-accent-fg ring-2 ring-accent/40"
              : "bg-surface-3 text-ink hover:bg-surface-2 hover:text-accent"
          }`}
          title="All apps"
        >
          <AppLogo size={20} />
        </button>
        <div className="h-6 w-px bg-white/10" />
        <WorkspaceSwitcher onOpenOverview={() => onOpenOverview?.()} />
      </motion.div>

      {/* Bottom-right corner: system tray (flush with the corner).
          Auto-hides like the dock — slides down out of view when not hovered. */}
      <motion.div
        onMouseEnter={reveal}
        onMouseLeave={scheduleHide}
        initial={false}
        animate={{ y: dockVisible ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="fixed bottom-0 right-0 z-[10002] flex items-center gap-1.5 rounded-tl-2xl border-t border-l border-white/[0.06] bg-surface/70 px-2 py-2 shadow-lg backdrop-blur-xl"
      >
        <SystemTray />
      </motion.div>

      {/* GNOME-style centered floating dock — app icons only.
          framer-motion owns the full transform (x + y) so the X centering
          isn't clobbered by the Y slide animation. */}
      <motion.div
        onMouseEnter={reveal}
        onMouseLeave={scheduleHide}
        initial={false}
        animate={{ y: dockVisible ? 0 : "130%", x: "-50%" }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="fixed bottom-4 left-1/2 z-[10001] flex max-w-[92vw] items-center gap-1.5 rounded-[28px] border border-white/[0.08] bg-surface/80 px-2.5 py-2 shadow-2xl backdrop-blur-2xl"
      >
        {pinned.map(renderApp)}

        {runningUnpinned.length > 0 && (
          <>
            <div className="mx-0.5 h-10 w-px bg-white/10" />
            {runningUnpinned.map(renderApp)}
          </>
        )}

        {isEmpty && (
          <span className="px-3 py-2 text-xs text-ink-muted">
            Pin apps from the start menu, or open one to see it here
          </span>
        )}
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
          items={
            [
              contextAppIsPinned
                ? {
                    label: "Unpin from dock",
                    icon: <PinOff size={16} />,
                    onClick: () => togglePinned(contextApp.id, false),
                  }
                : {
                    label: "Pin to dock",
                    icon: <Pin size={16} />,
                    onClick: () => togglePinned(contextApp.id, true),
                  },
              contextAppIsRunning
                ? {
                    label: "Close all windows",
                    icon: <X size={16} />,
                    danger: true,
                    onClick: () => closeAllWindows(contextApp.id),
                  }
                : null,
            ].filter(Boolean) as MenuItem[]
          }
        />
      )}
    </>
  );
}
