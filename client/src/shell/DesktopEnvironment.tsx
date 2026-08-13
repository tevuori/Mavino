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
import { useShortcut } from "../store/shortcuts";
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

  // Configurable keyboard shortcuts (via useShortcut hook)
  useShortcut("toggleAthenaQuickPanel", () => toggleAthenaQuick());
  useShortcut("toggleFullscreen", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  });
  useShortcut("toggleWorkspaceOverview", () => setOverviewOpen((v) => !v));

  // Window management shortcuts
  useShortcut("snapWindowLeft", () => { if (focusedId) snap(focusedId, "left"); });
  useShortcut("snapWindowRight", () => { if (focusedId) snap(focusedId, "right"); });
  useShortcut("snapWindowTopLeft", () => { if (focusedId) snap(focusedId, "top-left"); });
  useShortcut("snapWindowTopRight", () => { if (focusedId) snap(focusedId, "top-right"); });
  useShortcut("maximizeWindow", () => { if (focusedId) snap(focusedId, "maximized"); });
  useShortcut("toggleMaximize", () => { if (focusedId) toggleMaximize(focusedId); });
  useShortcut("minimizeWindow", () => { if (focusedId) useWindows.getState().minimize(focusedId); });
  useShortcut("restoreWindow", () => {
    if (focusedId) {
      const w = useWindows.getState().windows.find((x) => x.id === focusedId);
      if (w && w.snap !== "none") snap(focusedId, "none");
    }
  });
  useShortcut("closeWindow", () => { if (focusedId) close(focusedId); });

  // Workspace shortcuts
  useShortcut("previousWorkspace", () => switchRelative(-1));
  useShortcut("nextWorkspace", () => switchRelative(1));
  useShortcut("moveWindowPreviousWorkspace", () => moveFocusedRelative(-1));
  useShortcut("moveWindowNextWorkspace", () => moveFocusedRelative(1));

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
