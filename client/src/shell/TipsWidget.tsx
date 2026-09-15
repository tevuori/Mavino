import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";

const TIPS = [
  "Ask Mavino to turn your notes into a study guide, flashcards, or a quiz.",
  "Use Quick Capture to save a thought, task, or note without breaking focus.",
  "Tell Mavino to create tasks, set priorities, and schedule due dates for you.",
  "Drag tasks onto Calendar to turn your plan into a realistic study schedule.",
  "Study Hub can explain sources, generate podcasts, and guide review sessions.",
  "Press the command palette shortcut to find apps and actions in seconds.",
  "Plan hiking routes and multi-day tours with maps, elevation, and useful stops.",
  "Customize wallpapers, animated backgrounds, themes, and shortcuts in Settings.",
];

const ROTATION_INTERVAL = 10_000;

export default function TipsWidget() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setIndex((current) => (current + 1) % TIPS.length);
    }, ROTATION_INTERVAL);
    return () => window.clearInterval(interval);
  }, []);

  const showPrevious = () => setIndex((current) => (current - 1 + TIPS.length) % TIPS.length);
  const showNext = () => setIndex((current) => (current + 1) % TIPS.length);

  return (
    <section className="w-72 rounded-xl border border-edge bg-surface/80 p-3 shadow-window backdrop-blur-xl" aria-label="Mavino tips">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Lightbulb size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Mavino tip</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink">{TIPS[index]}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-edge pt-2">
        <span className="text-[10px] tabular-nums text-ink-muted">{index + 1} / {TIPS.length}</span>
        <div className="flex items-center gap-1">
          <button onClick={showPrevious} className="rounded p-1 text-ink-muted hover:bg-surface-3 hover:text-ink" aria-label="Previous tip">
            <ChevronLeft size={13} />
          </button>
          <button onClick={showNext} className="rounded p-1 text-ink-muted hover:bg-surface-3 hover:text-ink" aria-label="Next tip">
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}
