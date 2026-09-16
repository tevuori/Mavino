import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";

const TIPS = [
  "Ask Mavino to turn your notes into a study guide, flashcards, or a quiz.",
  "Use Quick Capture to save a thought, task, or note without breaking focus.",
  "Tell Mavino to create tasks, set priorities, and schedule due dates for you.",
  "Drag tasks onto Calendar to turn your plan into a realistic study schedule.",
  "Study Hub can explain sources, generate podcasts, and guide review sessions.",
  "Press the command palette shortcut to find apps and actions in seconds.",
  "Customize wallpapers, animated backgrounds, themes, and shortcuts in Settings.",
  "Pin important notes so they always stay at the top of your note list.",
  "Search Notes by title, tags, or words written anywhere inside a note.",
  "Search Files to find a document by name no matter which folder contains it.",
  "Star frequently used files to collect them in one convenient place.",
  "Use folders in Notes and Files to keep each course and project organized.",
  "Drop a file into Notes to create a direct reference without copying its content.",
  "Open text and code files in Editor for quick changes without leaving Mavino.",
  "Use Calendar agenda view for a focused list of everything coming up next.",
  "Break large assignments into smaller tasks with clear priorities and due dates.",
  "Review the Today page each morning to see your agenda and urgent tasks.",
  "Use focus sessions to work in short, intentional blocks with fewer distractions.",
  "Create flashcard decks from your own materials instead of entering every card manually.",
  "Rate flashcards honestly during review so difficult cards return more often.",
  "Ask Mavino to summarize a long note before you begin a deeper review.",
  "Turn lecture materials into a podcast when you want to study away from the screen.",
  "Link related notes, tasks, events, and files to keep project context together.",
  "Use tags in Notes to group ideas that belong to more than one folder.",
  "Export important notes as Markdown or PDF when you need an offline copy.",
  "Switch Notes to split view to edit Markdown and preview the result side by side.",
  "Use the whiteboard for diagrams, brainstorming, and visual problem solving.",
  "Check Analytics to understand your study habits and completed work over time.",
  "Connect Spotify in Settings to control study music from your dashboard.",
  "Choose a calm background and theme that help you stay focused during long sessions.",
  "Use keyboard shortcuts for saving, selecting, copying, and navigating more quickly.",
  "Install Mavino as a PWA for faster access and a more app-like experience.",
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
