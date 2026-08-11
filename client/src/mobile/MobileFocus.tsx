import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Coffee, Play, Pause, RotateCcw, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useSettings } from "../store/settings";
import { MobileContainer, MobileHeader } from "./MobileUi";

type Phase = "focus" | "short-break" | "long-break";

const PHASES: Record<Phase, { label: string; minutes: number; color: string; icon: React.ReactNode }> = {
  focus: { label: "Focus", minutes: 25, color: "#ef4444", icon: <Brain size={16} /> },
  "short-break": { label: "Short break", minutes: 5, color: "#22c55e", icon: <Coffee size={16} /> },
  "long-break": { label: "Long break", minutes: 15, color: "#3b82f6", icon: <Coffee size={16} /> },
};

interface SessionStats {
  completedFocus: number;
  totalFocusMinutes: number;
  date: string;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadStats(): SessionStats {
  try {
    const raw = localStorage.getItem("pomodoro-stats");
    if (raw) {
      const s = JSON.parse(raw) as SessionStats;
      if (s.date === todayKey()) return s;
    }
  } catch { /* ignore */ }
  return { completedFocus: 0, totalFocusMinutes: 0, date: todayKey() };
}

function saveStats(s: SessionStats) {
  localStorage.setItem("pomodoro-stats", JSON.stringify(s));
}

export default function MobileFocus({ onClose }: { onClose?: () => void }) {
  const [phase, setPhase] = useState<Phase>("focus");
  const [secondsLeft, setSecondsLeft] = useState(PHASES.focus.minutes * 60);
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  const [dnd, setDnd] = useState(false);
  const [stats, setStats] = useState<SessionStats>(loadStats);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { doNotDisturb, setDoNotDisturb } = useSettings();

  const config = PHASES[phase];
  const total = config.minutes * 60;
  const progress = 1 - secondsLeft / total;

  const playSound = useCallback(() => {
    if (muted) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch { /* ignore */ }
  }, [muted]);

  const nextPhase = useCallback(() => {
    setRunning(false);
    playSound();
    if (phase === "focus") {
      const nextStats = {
        ...stats,
        completedFocus: stats.completedFocus + 1,
        totalFocusMinutes: stats.totalFocusMinutes + config.minutes,
      };
      setStats(nextStats);
      saveStats(nextStats);
      const next: Phase = nextStats.completedFocus % 4 === 0 ? "long-break" : "short-break";
      setPhase(next);
      setSecondsLeft(PHASES[next].minutes * 60);
    } else {
      setPhase("focus");
      setSecondsLeft(PHASES.focus.minutes * 60);
    }
  }, [phase, stats, config.minutes, playSound]);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          nextPhase();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, nextPhase]);

  useEffect(() => {
    if (dnd && running && phase === "focus") setDoNotDisturb(true);
    else if (dnd) setDoNotDisturb(false);
    return () => {
      if (dnd) setDoNotDisturb(false);
    };
  }, [dnd, running, phase, setDoNotDisturb]);

  const switchPhase = (p: Phase) => {
    setRunning(false);
    setPhase(p);
    setSecondsLeft(PHASES[p].minutes * 60);
  };

  const reset = () => {
    setRunning(false);
    setSecondsLeft(config.minutes * 60);
  };

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
  const ss = (secondsLeft % 60).toString().padStart(2, "0");

  const radius = 120;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <MobileContainer>
      <MobileHeader title="Focus" subtitle="Pomodoro timer" onClose={onClose} />

      <div className="mb-6 flex gap-1 rounded-full bg-surface-2 p-1">
        {(Object.keys(PHASES) as Phase[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => switchPhase(p)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-2 text-xs font-medium transition ${
              phase === p ? "bg-accent text-ink" : "text-ink-muted"
            }`}
          >
            {PHASES[p].icon}
            {PHASES[p].label}
          </button>
        ))}
      </div>

      <div className="relative mx-auto mb-6 flex aspect-square w-full max-w-[280px] items-center justify-center">
        <svg viewBox="0 0 280 280" className="h-full w-full -rotate-90">
          <circle cx="140" cy="140" r={radius} fill="none" stroke="currentColor" strokeWidth="10" className="text-ink/[.08]" />
          <circle
            cx="140" cy="140" r={radius}
            fill="none" stroke={config.color}
            strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ strokeDashoffset: dashOffset, transition: "stroke-dashoffset 0.5s linear" }}
          />
        </svg>
        <div className="absolute flex flex-col items-center text-ink">
          <div className="mb-1 flex items-center gap-1 text-sm font-medium" style={{ color: config.color }}>
            {config.icon} {config.label}
          </div>
          <div className="font-mono text-5xl font-bold tabular-nums">
            {mm}:{ss}
          </div>
          <p className="mt-1 text-xs text-ink-muted">{running ? "Running" : "Ready"}</p>
        </div>
      </div>

      <div className="mb-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink active:bg-surface-3"
        >
          <RotateCcw size={20} />
        </button>
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className="flex h-16 w-16 items-center justify-center rounded-full text-ink shadow-lg active:scale-[.98]"
          style={{ backgroundColor: config.color }}
        >
          {running ? <Pause size={28} /> : <Play size={28} className="ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={nextPhase}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink active:bg-surface-3"
        >
          <SkipForward size={20} />
        </button>
      </div>

      <div className="mb-6 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => setDnd((v) => !v)}
          className={`flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-medium ${
            dnd ? "bg-accent/15 text-accent" : "bg-surface-2 text-ink-muted"
          }`}
        >
          {dnd || doNotDisturb ? <VolumeX size={14} /> : <Volume2 size={14} />}
          Auto DND {dnd ? "on" : "off"}
        </button>
        <button
          type="button"
          onClick={() => setMuted((v) => !v)}
          className={`flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-medium ${
            muted ? "bg-surface-2 text-ink-muted" : "bg-surface-2 text-ink-muted"
          }`}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          Sound {muted ? "off" : "on"}
        </button>
      </div>

      <div className="rounded-2xl border border-edge bg-surface-2 p-4 text-center">
        <p className="text-xs text-ink-muted">Today</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className="text-2xl font-bold text-ink">{stats.completedFocus}</p>
            <p className="text-[11px] text-ink-muted">Sessions</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-ink">{stats.totalFocusMinutes}</p>
            <p className="text-[11px] text-ink-muted">Minutes</p>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`h-2 w-2 rounded-full ${
                i < (stats.completedFocus % 4 === 0 && stats.completedFocus > 0 ? 4 : stats.completedFocus % 4)
                  ? "bg-accent"
                  : "bg-surface-3"
              }`}
            />
          ))}
        </div>
      </div>
    </MobileContainer>
  );
}
