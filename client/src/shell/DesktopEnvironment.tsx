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
import { useEffect, useState } from "react";

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

  // Win + Y → toggle Athena quick panel (rolls in from the selected edge)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        toggleAthenaQuick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleAthenaQuick]);

  // Win + F → toggle true fullscreen via the Fullscreen API.
  // Unlike F11, Firefox does not reveal its toolbar on cursor hover when
  // fullscreen is entered via the API, so this is a kiosk-style fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keyboard shortcuts for window management
  //   Win + Arrow keys  → snap to grid zones
  //   Win + Shift+Up    → maximize/restore
  //   Win + Shift+Down  → minimize
  //   Win + W           → close focused window
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Require Meta (Win/Cmd) key for window shortcuts
      if (!e.metaKey && !e.ctrlKey) return;
      // Don't interfere when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (!focusedId) return;

      const key = e.key;
      // Win + Arrow keys (with Shift for quadrants)
      if (key === "ArrowLeft" && e.shiftKey) {
        e.preventDefault();
        snap(focusedId, "top-left");
      } else if (key === "ArrowRight" && e.shiftKey) {
        e.preventDefault();
        snap(focusedId, "top-right");
      } else if (key === "ArrowLeft") {
        e.preventDefault();
        snap(focusedId, "left");
      } else if (key === "ArrowRight") {
        e.preventDefault();
        snap(focusedId, "right");
      } else if (key === "ArrowUp" && e.shiftKey) {
        e.preventDefault();
        toggleMaximize(focusedId);
      } else if (key === "ArrowUp") {
        e.preventDefault();
        snap(focusedId, "maximized");
      } else if (key === "ArrowDown" && e.shiftKey) {
        e.preventDefault();
        useWindows.getState().minimize(focusedId);
      } else if (key === "ArrowDown") {
        e.preventDefault();
        // Restore from maximized/snap, or minimize if already normal
        const w = useWindows.getState().windows.find((x) => x.id === focusedId);
        if (w && w.snap !== "none") {
          snap(focusedId, "none");
        }
      } else if (key === "w" || key === "W") {
        e.preventDefault();
        close(focusedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, snap, toggleMaximize, close]);

  // Workspace keyboard shortcuts (Ctrl-based to avoid Super/GNOME conflicts):
  //   Ctrl+Alt+PgUp / Ctrl+Alt+PgDn  → switch to prev/next workspace
  //   Ctrl+Shift+PgUp / Ctrl+Shift+PgDn → move focused window to prev/next workspace
  //   Alt+Space                       → toggle workspace overview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't interfere when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      // Alt+Space → toggle overview (no Ctrl/Meta required)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === " ") {
        e.preventDefault();
        setOverviewOpen((v) => !v);
        return;
      }

      // Ctrl-based workspace shortcuts — explicitly exclude Meta (Super) so
      // they don't fire when GNOME intercepts Super+PgUp/PgDn at the OS level.
      if (!e.ctrlKey || e.metaKey) return;

      if (e.altKey && !e.shiftKey && e.key === "PageUp") {
        e.preventDefault();
        switchRelative(-1);
      } else if (e.altKey && !e.shiftKey && e.key === "PageDown") {
        e.preventDefault();
        switchRelative(1);
      } else if (e.shiftKey && !e.altKey && e.key === "PageUp") {
        e.preventDefault();
        moveFocusedRelative(-1);
      } else if (e.shiftKey && !e.altKey && e.key === "PageDown") {
        e.preventDefault();
        moveFocusedRelative(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [switchRelative, moveFocusedRelative]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {isDemo && (
        <div className="absolute inset-x-0 top-0 z-[10001] flex items-center justify-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200 backdrop-blur-sm">
          <span>Demo mode — your work is temporary and will expire soon.</span>
          <button
            onClick={logout}
            className="rounded-md bg-amber-500/20 px-2 py-0.5 font-medium text-amber-100 transition hover:bg-amber-500/30"
          >
            Sign up / Log in
          </button>
        </div>
      )}
      <div className={isDemo ? "h-[calc(100%-2rem)]" : "h-full"}>
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
