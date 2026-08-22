import { useMemo, useState } from "react";
import {
  BookOpen, Brain, FileText, Flame, Folder, Globe, GraduationCap,
  Mic, Music2, Network, NotebookPen, PenTool, Settings, Timer, BellRing,
  Search, Lock, CalendarClock, Radio, BarChart3, CreditCard, Store, Link2,
  Activity, Compass as CompassIcon, Users, PenLine, Map as MapIcon,
} from "lucide-react";
import { useFeatures, type SubscriptionTier } from "../store/features";
import { APP_MAP } from "../apps/registry";
import type { AppId } from "../store/windows";
import type { MobileToolPayload } from "./MobileToolPage";
import { MobileHeader, MobileIconChip } from "./MobileUi";

export type MobileTool =
  | "notes" | "study" | "teach" | "flashcards" | "focus" | "files" | "voice"
  | "habits" | "whiteboard" | "browser" | "reminders" | "ntfy"
  | "settings" | "editor" | "atlas" | "crunch" | "echo"
  | "analytics" | "maps" | "plans" | "marketplace"
  | "pulse" | "compass" | "forge" | "bridge" | "scribe" | "circle";

/** Maps a mobile tool id to the desktop AppId used for availability checks. */
const TOOL_TO_APP_ID: Record<MobileTool, AppId> = {
  notes: "notes",
  study: "study",
  teach: "study",
  flashcards: "flashcards",
  focus: "pomodoro",
  files: "files",
  voice: "voice",
  habits: "habits",
  whiteboard: "whiteboard",
  browser: "browser",
  reminders: "reminders",
  ntfy: "ntfy",
  settings: "settings",
  editor: "editor",
  atlas: "atlas",
  crunch: "crunch",
  echo: "echo",
  analytics: "analytics",
  maps: "maps",
  plans: "plans",
  marketplace: "marketplace",
  pulse: "pulse",
  compass: "compass",
  forge: "forge",
  bridge: "bridge",
  scribe: "scribe",
  circle: "circle",
};

type AppCategory = "Study" | "Productivity" | "Pro tools" | "Account";

const ALL_APPS: { id: MobileTool; name: string; description: string; icon: typeof NotebookPen; category: AppCategory }[] = [
  { id: "study", name: "Study Hub", description: "AI study workflows", icon: BookOpen, category: "Study" },
  { id: "teach", name: "Teach Me", description: "Interactive AI tutor", icon: GraduationCap, category: "Study" },
  { id: "flashcards", name: "Flashcards", description: "Review what matters", icon: Brain, category: "Study" },
  { id: "analytics", name: "Analytics", description: "Your progress at a glance", icon: BarChart3, category: "Study" },

  { id: "notes", name: "Notes", description: "Capture and organize ideas", icon: NotebookPen, category: "Productivity" },
  { id: "focus", name: "Focus", description: "Pomodoro sessions", icon: Timer, category: "Productivity" },
  { id: "files", name: "Files", description: "Your study materials", icon: Folder, category: "Productivity" },
  { id: "voice", name: "Voice Notes", description: "Record, transcribe, remember", icon: Mic, category: "Productivity" },
  { id: "habits", name: "Habits", description: "Small wins, daily", icon: Flame, category: "Productivity" },
  { id: "whiteboard", name: "Whiteboard", description: "Sketch your thinking", icon: PenTool, category: "Productivity" },
  { id: "browser", name: "Browser", description: "Research with Mavino", icon: Globe, category: "Productivity" },
  { id: "reminders", name: "Reminders", description: "Never lose a deadline", icon: BellRing, category: "Productivity" },
  { id: "maps", name: "Maps", description: "Hiking routes and trips", icon: MapIcon, category: "Productivity" },
  { id: "ntfy", name: "Ntfy", description: "Messages and automations", icon: Music2, category: "Productivity" },
  { id: "editor", name: "Editor", description: "Text and code files", icon: FileText, category: "Productivity" },

  { id: "atlas", name: "Atlas", description: "Your global knowledge map", icon: Network, category: "Pro tools" },
  { id: "crunch", name: "Crunch", description: "Adaptive exam prep planner", icon: CalendarClock, category: "Pro tools" },
  { id: "echo", name: "Echo", description: "Live lecture companion", icon: Radio, category: "Pro tools" },
  { id: "pulse", name: "Pulse", description: "Predicts your mastery over time", icon: Activity, category: "Pro tools" },
  { id: "compass", name: "Compass", description: "Research & literature review", icon: CompassIcon, category: "Pro tools" },
  { id: "forge", name: "Forge", description: "AI practice problems", icon: Flame, category: "Pro tools" },
  { id: "bridge", name: "Concept Bridge", description: "Connections across courses", icon: Link2, category: "Pro tools" },
  { id: "scribe", name: "Scribe", description: "Thesis & essay writing coach", icon: PenLine, category: "Pro tools" },
  { id: "circle", name: "Circle", description: "Shared study spaces", icon: Users, category: "Pro tools" },

  { id: "marketplace", name: "Marketplace", description: "Browse and install plugins", icon: Store, category: "Account" },
  { id: "plans", name: "Plans", description: "Billing and subscription", icon: CreditCard, category: "Account" },
  { id: "settings", name: "Settings", description: "Account and preferences", icon: Settings, category: "Account" },
];

const CATEGORY_ORDER: AppCategory[] = ["Study", "Productivity", "Pro tools", "Account"];

const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, paid: 1, pro: 2 };

export default function MobileLauncher({ onClose, onOpen }: { onClose: () => void; onOpen: (tool: MobileTool, payload?: MobileToolPayload) => void }) {
  const [query, setQuery] = useState("");
  // Filter tools by the same availability rules as the desktop launch surfaces.
  const subscriptionTier = useFeatures((s) => s.subscriptionTier);
  const disabledApps = useFeatures((s) => s.disabledApps);
  const appTiers = useFeatures((s) => s.appTiers);
  const apps = useMemo(() => ALL_APPS.map((a) => {
    const appId = TOOL_TO_APP_ID[a.id];
    const def = APP_MAP[appId];
    let access: "full" | "preview" | "hidden" = "full";
    if (appId === "settings") access = "full";
    else if (disabledApps.has(appId)) access = "hidden";
    else if (!def) access = "hidden";
    else {
      const minTier = appTiers[appId] ?? def.minTier ?? "free";
      access = TIER_RANK[subscriptionTier] >= TIER_RANK[minTier] ? "full" : "preview";
    }
    return { ...a, access };
  }).filter((a) => a.access !== "hidden"), [subscriptionTier, disabledApps, appTiers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
  }, [apps, query]);

  const grouped = useMemo(() => {
    const byCategory = new Map<AppCategory, typeof filtered>();
    for (const cat of CATEGORY_ORDER) byCategory.set(cat, []);
    for (const app of filtered) byCategory.get(app.category)?.push(app);
    return CATEGORY_ORDER.map((cat) => ({ cat, items: byCategory.get(cat) ?? [] })).filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <div className="mx-auto min-w-0 max-w-md px-5 pb-7 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <MobileHeader title="Your tools" subtitle="Everything else" onBack={onClose} compact />
      <label className="mb-5 flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-ink-muted transition focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/15">
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </label>
      {grouped.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-edge px-4 py-5 text-sm text-ink-muted">No apps match "{query}".</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ cat, items }) => (
            <section key={cat}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-accent">{cat}</h2>
              <div className="grid grid-cols-2 gap-3">
                {items.map(({ id, name, description, icon: Icon, access }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onOpen(id)}
                    className="relative min-h-32 rounded-3xl border border-edge bg-surface-2 p-4 text-left transition active:scale-[.98] active:bg-surface-3"
                  >
                    <div className="mb-5">
                      <MobileIconChip icon={<Icon size={20} />} size="md" />
                    </div>
                    <p className="flex items-center gap-1.5 font-semibold text-ink">
                      {name}
                      {access === "preview" && <Lock size={12} className="text-amber-400" />}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-ink-muted">{description}</p>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
