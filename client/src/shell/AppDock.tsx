import { useState, useMemo } from "react";
import * as Lucide from "lucide-react";
import { Sparkles, Settings, Lock } from "lucide-react";
import { useAccessibleApps } from "../store/features";
import { useWindows } from "../store/windows";
import { useAuth } from "../store/auth";

const DOCK_ORDER = ["today", "study", "atlas", "notes", "tasks", "files", "calendar", "grades", "athena"];

export default function AppDock() {
  const { open, focusedId, windows } = useWindows();
  const apps = useAccessibleApps();
  const user = useAuth((s) => s.user);
  const [hovered, setHovered] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const map = new Map(apps.map((a) => [a.id, a]));
    const curated = DOCK_ORDER.map((id) => map.get(id)).filter(Boolean) as typeof apps;
    const rest = apps.filter((a) => !DOCK_ORDER.includes(a.id));
    return [...curated, ...rest];
  }, [apps]);

  const runningIds = new Set(windows.map((w) => w.appId));
  const focusedAppId = windows.find((w) => w.id === focusedId)?.appId;

  const openApp = (app: (typeof apps)[number]) => {
    open({ appId: app.id, title: app.name, icon: app.icon });
  };

  const openSettings = () => {
    open({ appId: "settings", title: "Settings", icon: "Settings" });
  };

  const openAssistant = () => {
    open({ appId: "athena", title: "Mavino", icon: "Sparkles" });
  };

  return (
    <div className="fixed left-0 top-0 z-[10001] flex h-full w-[72px] flex-col items-center gap-3 border-r border-white/[0.06] bg-surface/70 py-4 backdrop-blur-2xl">
      {/* Logo */}
      <button
        onClick={openAssistant}
        className="group relative mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent transition hover:bg-accent/25 hover:text-white"
        title="Mavino"
      >
        <Sparkles size={22} className="text-glow" />
        <span className="absolute inset-0 rounded-2xl bg-accent/10 opacity-0 blur-lg transition group-hover:opacity-100" />
      </button>

      {/* App shortcuts */}
      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto px-1 py-2">
        {ordered.map((app) => {
          const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[app.icon] ?? Lucide.AppWindow;
          const isRunning = runningIds.has(app.id);
          const isActive = focusedAppId === app.id;
          return (
            <button
              key={app.id}
              onClick={() => openApp(app)}
              onMouseEnter={() => setHovered(app.id)}
              onMouseLeave={() => setHovered(null)}
              className={`group relative flex h-11 w-11 items-center justify-center rounded-xl transition ${
                isActive
                  ? "bg-accent text-white shadow-lg shadow-accent/30"
                  : "bg-white/[0.04] text-ink-muted hover:bg-white/[0.08] hover:text-ink"
              }`}
              title={app.name}
            >
              <Icon size={20} />
              {app.access === "preview" && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface text-amber-500 ring-1 ring-white/10">
                  <Lock size={8} />
                </span>
              )}
              {isRunning && !isActive && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent" />
              )}
              {hovered === app.id && (
                <span className="absolute left-full ml-3 rounded-lg border border-edge bg-surface-2 px-2 py-1 text-xs font-medium text-ink shadow-window whitespace-nowrap">
                  {app.name}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col items-center gap-2 border-t border-white/[0.06] pt-3">
        <button
          onClick={openSettings}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted transition hover:bg-white/[0.08] hover:text-ink"
          title="Settings"
        >
          <Settings size={19} />
        </button>
        <button
          onClick={openAssistant}
          className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-surface-2 text-accent transition hover:border-accent/40"
          title="Mavino Assistant"
        >
          <span className="absolute inset-0 bg-accent/10 opacity-50" />
          <span className="relative text-xs font-bold">
            {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
          </span>
        </button>
      </div>
    </div>
  );
}
