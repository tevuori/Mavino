import { useState, useEffect } from "react";
import { Cpu } from "lucide-react";
import AppLogo from "./AppLogo";
import StartMenu from "./StartMenu";
import SystemTray from "./SystemTray";
import WorkspaceSwitcher from "../wm/WorkspaceSwitcher";

interface Props {
  onOpenOverview?: () => void;
}

export default function Taskbar({ onOpenOverview }: Props) {
  const [startOpen, setStartOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStartOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="absolute bottom-0 left-0 right-0 z-[10000] flex h-10 items-center justify-between border-t border-white/[0.06] bg-surface/60 px-4 text-xs backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStartOpen((v) => !v)}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
              startOpen ? "bg-accent text-white" : "text-ink-muted hover:bg-white/[0.06] hover:text-ink"
            }`}
            title="Start"
          >
            <AppLogo size={18} />
          </button>
          <WorkspaceSwitcher onOpenOverview={() => onOpenOverview?.()} />
          <span className="hidden items-center gap-1.5 text-ink-muted sm:flex">
            <Cpu size={12} className="text-accent" />
            <span className="font-medium text-ink">Mavino OS</span>
            <span className="h-1 w-1 rounded-full bg-emerald-400" />
            All systems online
          </span>
        </div>
        <SystemTray />
      </div>

      <StartMenu open={startOpen} onClose={() => setStartOpen(false)} />
    </>
  );
}
