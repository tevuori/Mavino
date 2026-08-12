import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import * as Lucide from "lucide-react";
import { Lock } from "lucide-react";
import AppLogo from "./AppLogo";
import StartMenu from "./StartMenu";
import SystemTray from "./SystemTray";
import WorkspaceSwitcher from "../wm/WorkspaceSwitcher";
import { useAccessibleApps } from "../store/features";
import { useWindows } from "../store/windows";

interface Props {
  onOpenOverview?: () => void;
}

export default function Taskbar({ onOpenOverview }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { open } = useWindows();
  const apps = useAccessibleApps();

  const pinned = useMemo(
    () => apps.filter((a) => a.pinnedToDesktop),
    [apps]
  );

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
      // Super/Meta toggles the dock; Ctrl+Shift+K is a fallback for browsers/OSes
      // that intercept the OS key.
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
      }
      if (e.ctrlKey && e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setStartOpen(false);
        setPanelOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const launch = (app: (typeof apps)[number]) => {
    open({ appId: app.id, title: app.name, icon: app.icon });
    setStartOpen(false);
    setPanelOpen(false);
    setHovered(false);
  };

  const visible = panelOpen || hovered || startOpen;

  return (
    <>
      {/* Thin hot trigger at the bottom edge to raise the dock on hover */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[10000] h-1.5"
        onMouseEnter={() => setHovered(true)}
      />

      {/* Bottom app launcher (GNOME-style dash) */}
      <motion.div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        initial={false}
        animate={{ y: visible ? "0%" : "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="fixed bottom-0 left-0 right-0 z-[10001] flex h-24 flex-col border-t border-white/[0.06] bg-surface/80 px-4 pb-2 pt-1.5 backdrop-blur-2xl"
      >
        <div className="flex h-8 shrink-0 items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStartOpen((v) => !v)}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
                startOpen
                  ? "bg-accent text-white"
                  : "text-ink-muted hover:bg-white/[0.06] hover:text-ink"
              }`}
              title="All apps"
            >
              <AppLogo size={18} />
            </button>
            <WorkspaceSwitcher onOpenOverview={() => onOpenOverview?.()} />
          </div>
          <SystemTray />
        </div>

        <div
          className="flex flex-1 items-center gap-1 overflow-x-auto py-1"
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
            return (
              <button
                key={app.id}
                onClick={() => launch(app)}
                className="group relative flex flex-col items-center justify-center gap-1 rounded-xl px-3 py-1 text-ink transition hover:bg-white/[0.06]"
                title={app.name}
              >
                <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent shadow-sm transition group-hover:scale-105 group-hover:bg-accent/25">
                  <Icon size={22} />
                  {app.access === "preview" && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface text-amber-500 ring-1 ring-white/10">
                      <Lock size={8} />
                    </span>
                  )}
                </div>
                <span className="max-w-[72px] truncate text-[10px] leading-tight text-ink-muted group-hover:text-ink">
                  {app.name}
                </span>
              </button>
            );
          })}
          {pinned.length === 0 && (
            <span className="px-2 text-xs text-ink-muted">
              No pinned apps
            </span>
          )}
        </div>
      </motion.div>

      <StartMenu
        open={startOpen}
        onClose={() => {
          setStartOpen(false);
          setPanelOpen(false);
        }}
      />
    </>
  );
}
