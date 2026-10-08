import Wallpaper from "./Wallpaper";
import MusicWidget from "./MusicWidget";
import TipsWidget from "./TipsWidget";
import Desktop from "./Desktop";
import Taskbar from "./Taskbar";
import WindowLayer from "../wm/WindowLayer";
import SnapPreview from "../wm/SnapPreview";
import AltTabSwitcher from "../wm/AltTabSwitcher";
import WorkspaceOverview from "../wm/WorkspaceOverview";
import CommandPalette from "./CommandPalette";
import DialogRenderer from "./DialogRenderer";
import QuickCapture from "./QuickCapture";
import AthenaQuickPanel from "./AthenaQuickPanel";
import OnboardingOverlay from "./OnboardingOverlay";
import { useWindows } from "../store/windows";
import { useAthenaQuick } from "../store/athenaQuick";
import { useHasOnboarded } from "../store/settings";
import { useAuth } from "../store/auth";
import { useShortcut } from "../store/shortcuts";
import { useEffect, useState } from "react";

export default function DesktopEnvironment() {
  const { open, focusedId, snap, toggleMaximize, close } = useWindows();
  const switchRelative = useWindows((s) => s.switchRelative);
  const moveFocusedRelative = useWindows((s) => s.moveFocusedRelative);
  const toggleAthenaQuick = useAthenaQuick((s) => s.toggle);
  const { user, logout } = useAuth();
  const hasOnboarded = useHasOnboarded(user?.id);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const isDemo = user?.role === "DEMO";

  // Demo bootstrap: skip onboarding (demo users never see it) and auto-open
  // Study Hub once after login.
  useEffect(() => {
    if (!isDemo) return;
    if (sessionStorage.getItem("demo-just-logged-in") === "1") {
      sessionStorage.removeItem("demo-just-logged-in");
      open({
        appId: "study",
        title: "Study Hub",
        icon: "BookOpen",
        payload: { mode: "home" },
      });
    }
  }, [isDemo, open]);

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
    <div className="flex h-full w-full flex-col overflow-clip">
      {isDemo && (
        <div className="z-10 flex shrink-0 items-center justify-center gap-3 border-b border-warning bg-warning-soft px-4 py-1.5 text-xs text-warning backdrop-blur-sm">
          <span>Demo mode — your work is temporary and will expire soon.</span>
          <button
            onClick={logout}
            className="rounded-md bg-warning-soft px-2 py-0.5 font-medium text-warning transition hover:bg-warning-soft"
          >
            Sign up / Log in
          </button>
        </div>
      )}
      <div className="relative flex-1 overflow-clip">
        <Wallpaper />
        <div className="fixed right-4 top-4 z-[5] flex flex-col items-end gap-3">
          <TipsWidget />
          <MusicWidget />
        </div>
        <Desktop />
        <WindowLayer />
        <AthenaQuickPanel />
        <SnapPreview />
        <Taskbar onOpenOverview={() => setOverviewOpen(true)} />
        <AltTabSwitcher />
        <WorkspaceOverview open={overviewOpen} onClose={() => setOverviewOpen(false)} />
        <CommandPalette />
        <QuickCapture />
        <DialogRenderer />
        {!hasOnboarded && !isDemo && <OnboardingOverlay />}
      </div>
    </div>
  );
}
