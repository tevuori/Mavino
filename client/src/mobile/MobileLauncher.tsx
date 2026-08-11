import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Brain, FileText, Flame, Folder, Globe, GraduationCap, Mic, Music2, Network, NotebookPen, PenTool, Settings, Timer, BellRing, Search, Lock, CalendarClock } from "lucide-react";
import { useFeatures, type SubscriptionTier } from "../store/features";
import { APP_MAP } from "../apps/registry";
import type { AppId } from "../store/windows";
import type { MobileToolPayload } from "./MobileToolPage";

export type MobileTool = "notes" | "study" | "teach" | "flashcards" | "focus" | "files" | "voice" | "grades" | "vut" | "habits" | "whiteboard" | "browser" | "reminders" | "ntfy" | "settings" | "editor" | "moodle" | "atlas" | "crunch";

/** Maps a mobile tool id to the desktop AppId used for availability checks. */
const TOOL_TO_APP_ID: Record<MobileTool, AppId> = {
  notes: "notes",
  study: "study",
  teach: "study",
  flashcards: "flashcards",
  focus: "pomodoro",
  files: "files",
  voice: "voice",
  grades: "grades",
  vut: "vut",
  habits: "habits",
  whiteboard: "whiteboard",
  browser: "browser",
  reminders: "reminders",
  ntfy: "ntfy",
  settings: "settings",
  editor: "editor",
  moodle: "moodle",
  atlas: "atlas",
  crunch: "crunch",
};

const ALL_APPS: { id: MobileTool; name: string; description: string; icon: typeof NotebookPen }[] = [
  { id: "notes", name: "Notes", description: "Capture and organize ideas", icon: NotebookPen }, { id: "study", name: "Study Hub", description: "AI study workflows", icon: BookOpen }, { id: "teach", name: "Teach Me", description: "Interactive AI tutor", icon: GraduationCap }, { id: "flashcards", name: "Flashcards", description: "Review what matters", icon: Brain }, { id: "focus", name: "Focus", description: "Pomodoro sessions", icon: Timer },
  { id: "files", name: "Files", description: "Your study materials", icon: Folder }, { id: "voice", name: "Voice Notes", description: "Record, transcribe, remember", icon: Mic }, { id: "grades", name: "Grades", description: "Courses and progress", icon: GraduationCap }, { id: "vut", name: "VUT", description: "Classes and grades", icon: GraduationCap },
  { id: "moodle", name: "Moodle", description: "Courses, materials, deadlines", icon: GraduationCap },
  { id: "habits", name: "Habits", description: "Small wins, daily", icon: Flame }, { id: "whiteboard", name: "Whiteboard", description: "Sketch your thinking", icon: PenTool }, { id: "browser", name: "Browser", description: "Research with Mavino", icon: Globe }, { id: "reminders", name: "Reminders", description: "Never lose a deadline", icon: BellRing },
  { id: "ntfy", name: "Ntfy", description: "Messages and automations", icon: Music2 }, { id: "settings", name: "Settings", description: "Account and preferences", icon: Settings }, { id: "editor", name: "Editor", description: "Text and code files", icon: FileText },
  { id: "atlas", name: "Atlas", description: "Your global knowledge map", icon: Network },
  { id: "crunch", name: "Crunch", description: "Adaptive exam prep planner", icon: CalendarClock },
];

const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, paid: 1, pro: 2 };

export default function MobileLauncher({ onClose, onOpen }: { onClose: () => void; onOpen: (tool: MobileTool, payload?: MobileToolPayload) => void }) {
  const [query, setQuery] = useState("");
  // Filter tools by the same availability rules as the desktop launch surfaces.
  const subscriptionTier = useFeatures((s) => s.subscriptionTier);
  const vutGranted = useFeatures((s) => s.vutGranted);
  const disabledApps = useFeatures((s) => s.disabledApps);
  const appTiers = useFeatures((s) => s.appTiers);
  const apps = useMemo(() => ALL_APPS.map((a) => {
    const appId = TOOL_TO_APP_ID[a.id];
    const def = APP_MAP[appId];
    let access: "full" | "preview" | "hidden" = "full";
    if (appId === "settings") access = "full";
    else if (disabledApps.has(appId)) access = "hidden";
    else if (!def) access = "hidden";
    else if (def.requiresGrant === "vut") access = vutGranted ? "full" : "hidden";
    else {
      const minTier = appTiers[appId] ?? def.minTier ?? "free";
      access = TIER_RANK[subscriptionTier] >= TIER_RANK[minTier] ? "full" : "preview";
    }
    return { ...a, access };
  }).filter((a) => a.access !== "hidden"), [subscriptionTier, vutGranted, disabledApps, appTiers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
  }, [apps, query]);

  return (
    <div className="mx-auto min-w-0 max-w-md px-5 pb-7 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="mb-6 flex items-center gap-3">
        <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink active:bg-surface-3" aria-label="Back">
          <ArrowLeft size={21} />
        </button>
        <div>
          <p className="text-sm font-medium text-accent">Everything else</p>
          <h1 className="text-3xl font-bold text-ink">Your tools</h1>
        </div>
      </header>
      <label className="mb-5 flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-ink-muted">
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {filtered.map(({ id, name, description, icon: Icon, access }) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(id)}
            className="relative min-h-32 rounded-3xl border border-edge bg-surface-2 p-4 text-left active:scale-[.98] active:bg-surface-3"
          >
            <span className="mb-5 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/15 text-accent">
              <Icon size={20} />
            </span>
            <p className="flex items-center gap-1.5 font-semibold text-ink">
              {name}
              {access === "preview" && <Lock size={12} className="text-amber-400" />}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{description}</p>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-2 rounded-2xl border border-dashed border-edge px-4 py-5 text-sm text-ink-muted">No apps match "{query}".</p>
        )}
      </div>
    </div>
  );
}
