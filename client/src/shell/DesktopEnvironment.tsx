import Wallpaper from "./Wallpaper";
import MusicWidget from "./MusicWidget";
import Desktop from "./Desktop";
import Taskbar from "./Taskbar";
import WindowLayer from "../wm/WindowLayer";
import SnapPreview from "../wm/SnapPreview";
import AltTabSwitcher from "../wm/AltTabSwitcher";
import WorkspaceOverview from "../wm/WorkspaceOverview";
import CommandPalette from "./CommandPalette";
import QuickCapture from "./QuickCapture";
import AthenaQuickPanel from "./AthenaQuickPanel";
import OnboardingOverlay from "./OnboardingOverlay";
import { useWindows } from "../store/windows";
import { useAthenaQuick } from "../store/athenaQuick";
import { useSettings } from "../store/settings";
import { useAuth } from "../store/auth";
import { matchesShortcut, type ShortcutAction } from "../store/shortcuts";
import { useEffect, useState, useCallback } from "react";

export default function DesktopEnvironment() {
  const { open, focusedId, snap, toggleMaximize, close } = useWindows();
  const switchRelative = useWindows((s) => s.switchRelative);
  const moveFocusedRelative = useWindows((s) => s.moveFocusedRelative);
  const toggleAthenaQuick = useAthenaQuick((s) => s.toggle);
  const hasOnboarded = useSettings((s) => s.hasOnboarded);
  const setHasOnboarded = useSettings((s) => s.setHasOnboarded);
  const { user, logout } = useAuth();
  const [overviewOpen, setOverviewOpen] = useState(false);
  const isDemo = user?.role === "DEMO";

  // Demo bootstrap: skip onboarding and auto-open Study Hub once after login.
  useEffect(() => {
    if (!isDemo) return;
    setHasOnboarded(true);
    if (sessionStorage.getItem("demo-just-logged-in") === "1") {
      sessionStorage.removeItem("demo-just-logged-in");
      open({
        appId: "study",
        title: "Study Hub",
        icon: "BookOpen",
        payload: { mode: "home" },
      });
    }
  }, [isDemo, setHasOnboarded, open]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  const minimize = useWindows((s) => s.minimize);

  const shortcuts = useSettings((s) => s.shortcuts);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const action = (Object.keys(shortcuts) as ShortcutAction[]).find((a) =>
        matchesShortcut(e, shortcuts[a])
      );
      if (!action) return;

      switch (action) {
        case "toggleAthenaQuickPanel":
          e.preventDefault();
          toggleAthenaQuick();
          break;
        case "toggleFullscreen":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "toggleWorkspaceOverview":
          e.preventDefault();
          setOverviewOpen((v) => !v);
          break;
        case "snapWindowLeft":
          if (focusedId) {
            e.preventDefault();
            snap(focusedId, "left");
          }
          break;
        case "snapWindowRight":
          if (focusedId) {
            e.preventDefault();
            snap(focusedId, "right");
          }
          break;
        case "snapWindowTopLeft":
          if (focusedId) {
            e.preventDefault();
            snap(focusedId, "top-left");
          }
          break;
        case "snapWindowTopRight":
          if (focusedId) {
            e.preventDefault();
            snap(focusedId, "top-right");
          }
          break;
        case "maximizeWindow":
          if (focusedId) {
            e.preventDefault();
            snap(focusedId, "maximized");
          }
          break;
        case "toggleMaximize":
          if (focusedId) {
            e.preventDefault();
            toggleMaximize(focusedId);
          }
          break;
        case "minimizeWindow":
          if (focusedId) {
            e.preventDefault();
            minimize(focusedId);
          }
          break;
        case "restoreWindow":
          if (focusedId) {
            e.preventDefault();
            snap(focusedId, "none");
          }
          break;
        case "closeWindow":
          if (focusedId) {
            e.preventDefault();
            close(focusedId);
          }
          break;
        case "previousWorkspace":
          e.preventDefault();
          switchRelative(-1);
          break;
        case "nextWorkspace":
          e.preventDefault();
          switchRelative(1);
          break;
        case "moveWindowPreviousWorkspace":
          e.preventDefault();
          moveFocusedRelative(-1);
          break;
        case "moveWindowNextWorkspace":
          e.preventDefault();
          moveFocusedRelative(1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, focusedId, toggleAthenaQuick, toggleFullscreen, setOverviewOpen, snap, toggleMaximize, minimize, close, switchRelative, moveFocusedRelative]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {isDemo && (
        <div className="z-10 flex shrink-0 items-center justify-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200 backdrop-blur-sm">
          <span>Demo mode — your work is temporary and will expire soon.</span>
          <button
            onClick={logout}
            className="rounded-md bg-amber-500/20 px-2 py-0.5 font-medium text-amber-100 transition hover:bg-amber-500/30"
          >
            Sign up / Log in
          </button>
        </div>
      )}
      <div className="relative flex-1 overflow-hidden">
        <Wallpaper />
        <MusicWidget />
        <Desktop />
        <WindowLayer />
        <AthenaQuickPanel />
        <SnapPreview />
        <Taskbar onOpenOverview={() => setOverviewOpen(true)} />
        <AltTabSwitcher />
        <WorkspaceOverview open={overviewOpen} onClose={() => setOverviewOpen(false)} />
        <CommandPalette />
        <QuickCapture />
        {!hasOnboarded && !isDemo && <OnboardingOverlay />}
      </div>
    </div>
  );
}
