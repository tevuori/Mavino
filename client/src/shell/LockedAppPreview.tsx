import { useState, type ComponentType } from "react";
import type { WindowInstance } from "../store/windows";
import { APP_MAP } from "../apps/registry";
import PaywallOverlay from "./PaywallOverlay";

interface Props {
  win: WindowInstance;
}

/**
 * Wraps a real app component in preview mode: renders the actual app UI
 * (so the user sees what it looks like) but overlays a paywall that blocks
 * all interactions. The overlay can be dismissed to browse the preview,
 * but a small lock badge remains to remind the user it's locked.
 */
export default function LockedAppPreview({ win }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const def = APP_MAP[win.appId];
  if (!def) return null;
  const App = def.component;
  const requiredTier = def.minTier === "pro" ? "pro" : "paid";

  // Feature highlights based on the app
  const highlights = getAppHighlights(win.appId);

  return (
    <div className="relative h-full w-full">
      {/* The real app renders underneath (read-only feel) */}
      <div className="h-full w-full overflow-hidden" style={{ pointerEvents: dismissed ? "auto" : "none" }}>
        <App win={win} />
      </div>

      {/* Paywall overlay (or compact badge if dismissed) */}
      {!dismissed ? (
        <PaywallOverlay
          requiredTier={requiredTier}
          highlights={highlights}
          dismissible
          onDismiss={() => setDismissed(true)}
        />
      ) : (
        <button
          onClick={() => setDismissed(false)}
          className="absolute bottom-3 right-3 z-[9999] flex items-center gap-1.5 rounded-lg bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition hover:bg-amber-500"
        >
          <span className="text-amber-200">🔒</span>
          {requiredTier === "pro" ? "Pro" : "Paid"} preview — tap to upgrade
        </button>
      )}
    </div>
  );
}

/** Short feature highlights per app for the paywall copy. */
function getAppHighlights(appId: string): string[] {
  const highlights: Record<string, string[]> = {
    calendar: ["Month/week/day views", "ICS import", "Microsoft Outlook sync"],
    flashcards: ["Spaced repetition (SM-2)", "AI card generation", "Due-date tracking"],
    grades: ["GPA calculator", "Weighted assignments", "Semester overview"],
    habits: ["Daily/weekly streaks", "Linked to Pomodoro & flashcards", "Visual progress"],
    pomodoro: ["Focus timer", "Session tracking", "Habit integration"],
    editor: ["Code editing", "Syntax highlighting", "Mavino AI assistance"],
    viewer: ["PDF/image viewer", "Pinch-to-zoom", "File preview"],
    browser: ["In-app browsing", "Quick links", "Mavino page summarization"],
    voice: ["Voice recording", "AI transcription", "Lecture capture"],
    ntfy: ["Push notifications", "Athena 2-way chat", "Cron schedules"],
    reminders: ["One-shot reminders", "Athena-powered context", "Scheduled delivery"],
    analytics: ["Usage insights", "Study tracking", "Productivity metrics"],
    maps: ["Hiking maps", "Route planning", "Multi-day tour planner"],
  };
  return highlights[appId] ?? ["Full app access", "All features unlocked"];
}
