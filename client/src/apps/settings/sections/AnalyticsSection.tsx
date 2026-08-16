import { useState, useEffect, useCallback } from "react";
import { BarChart3, Users as UsersIcon, Activity, Loader2, RefreshCw } from "lucide-react";
import { analyticsApi } from "../../../services/analytics";
import type { AnalyticsOverview } from "../../../types";
import { SectionHeader, Card } from "../ui";

// Friendly labels for the internal feature names recorded by the server.
const FEATURE_LABELS: Record<string, string> = {
  notes: "Notes",
  tasks: "Tasks",
  files: "Files",
  athena: "Mavino",
  study: "Study Hub",
  flashcards: "Flashcards",
  grades: "Grades",
  calendar: "Calendar",
  habits: "Habits",
  whiteboard: "Whiteboard",
  spotify: "Spotify",
  voice: "Voice Notes",
  ntfy: "Ntfy",
  browser: "Browser",
  microsoft: "Microsoft",
  teacher: "Teach Me",
  capture: "Quick Capture",
  ai: "AI",
  reminders: "Reminders",
  "proactive-alerts": "Proactive Alerts",
  links: "Links",
  tts: "TTS",
  users: "User Mgmt",
};

function featureLabel(f: string): string {
  return FEATURE_LABELS[f] ?? f;
}

export default function AnalyticsSection() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await analyticsApi.overview());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section id="analytics" className="mb-8">
      <SectionHeader
        icon={<BarChart3 size={18} />}
        title="User Analytics"
        description="Aggregate, anonymous usage patterns across all users. No personal data is collected or shown."
      />

      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-ink-muted">
          {data ? `Last ${data.windowDays} days` : "Loading…"}
        </span>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-ink-muted hover:bg-surface-3 disabled:opacity-40"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      {err && (
        <Card className="mb-4">
          <p className="text-sm text-red-500">{err}</p>
        </Card>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-12 text-ink-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : data ? (
        <div className="space-y-6">
          <SummaryCards data={data} />
          <FeatureUsage
            data={data}
            expanded={expanded}
            onToggle={(f) => setExpanded((cur) => (cur === f ? null : f))}
          />
          <AdoptionGrid data={data} />
          <ContentTotals data={data} />
          <p className="pt-2 text-center text-[11px] text-ink-muted">
            Counts are anonymous aggregates. No user IDs, names, or content are recorded.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function SummaryCards({ data }: { data: AnalyticsOverview }) {
  const cards = [
    { label: "Total users", value: data.users.total, icon: <UsersIcon size={16} /> },
    { label: "Active (7 days)", value: data.users.active7d, icon: <Activity size={16} /> },
    { label: "Active (30 days)", value: data.users.active30d, icon: <Activity size={16} /> },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className="p-3">
          <div className="mb-1 flex items-center gap-1.5 text-ink-muted">
            {c.icon}
            <span className="text-[11px] uppercase tracking-wide">{c.label}</span>
          </div>
          <p className="text-2xl font-semibold text-ink">{c.value.toLocaleString()}</p>
        </Card>
      ))}
    </div>
  );
}

function FeatureUsage({
  data,
  expanded,
  onToggle,
}: {
  data: AnalyticsOverview;
  expanded: string | null;
  onToggle: (f: string) => void;
}) {
  const rows = data.featureUsage;
  const max = rows.length > 0 ? rows[0].total : 1;

  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-4 text-center text-sm text-ink-muted">
          No feature activity recorded yet in the last {data.windowDays} days.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-ink">Feature usage (last {data.windowDays} days)</h4>
      <Card className="p-0">
        <div className="divide-y divide-edge">
          {rows.map((row) => {
            const isOpen = expanded === row.feature;
            const trend = data.trend[row.feature];
            return (
              <div key={row.feature}>
                <button
                  onClick={() => onToggle(row.feature)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-surface-3"
                >
                  <span className="w-28 shrink-0 truncate text-sm text-ink">
                    {featureLabel(row.feature)}
                  </span>
                  <div className="relative h-5 flex-1 overflow-hidden rounded bg-surface-3">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-accent/70"
                      style={{ width: `${Math.max(2, (row.total / max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-sm tabular-nums text-ink-muted">
                    {row.total.toLocaleString()}
                  </span>
                </button>
                {isOpen && trend && (
                  <div className="bg-surface-3/40 px-3 pb-3 pt-1">
                    <Sparkline points={trend.map((p) => p.count)} />
                    <p className="mt-1 text-[11px] text-ink-muted">
                      Daily hits over the last {data.windowDays} days (click row to collapse)
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/** Minimal inline SVG sparkline. */
function Sparkline({ points }: { points: number[] }) {
  const w = 240;
  const h = 36;
  const max = Math.max(1, ...points);
  if (points.length === 0) return null;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = h - (p / max) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-9 w-full"
      aria-hidden="true"
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-accent"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function AdoptionGrid({ data }: { data: AnalyticsOverview }) {
  const items = [
    { label: "Spotify", value: data.adoption.spotify },
    { label: "Microsoft Calendar", value: data.adoption.microsoft },
    { label: "AI keys", value: data.adoption.ai },
    { label: "Ntfy", value: data.adoption.ntfy },
    { label: "Proactive Alerts", value: data.adoption.proactiveAlerts },
    { label: "TTS", value: data.adoption.tts },
  ];
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-ink">Feature adoption</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 @sm:grid-cols-4">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-lg border border-edge bg-surface-2 px-3 py-2"
          >
            <p className="truncate text-[11px] uppercase tracking-wide text-ink-muted">
              {it.label}
            </p>
            <p className="text-lg font-semibold text-ink">
              {it.value.toLocaleString()}{" "}
              <span className="text-xs font-normal text-ink-muted">users</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContentTotals({ data }: { data: AnalyticsOverview }) {
  const items: { label: string; value: number }[] = [
    { label: "Notes", value: data.content.notes },
    { label: "Tasks", value: data.content.tasks },
    { label: "Tasks done", value: data.content.tasksDone },
    { label: "Files", value: data.content.files },
    { label: "Flashcard decks", value: data.content.flashcardDecks },
    { label: "Flashcards", value: data.content.flashcards },
    { label: "Courses", value: data.content.courses },
    { label: "Assignments", value: data.content.assignments },
    { label: "Calendar events", value: data.content.calendarEvents },
    { label: "Mavino chats", value: data.content.chatConversations },
    { label: "Study sessions", value: data.content.studySessions },
    { label: "Whiteboards", value: data.content.whiteboards },
    { label: "Habits", value: data.content.habits },
    { label: "Study sources", value: data.content.studySources },
    { label: "Study chats", value: data.content.studyChats },
    { label: "Podcasts", value: data.content.podcasts },
    { label: "Teach Me sessions", value: data.content.teacherSessions },
    { label: "Ntfy messages", value: data.content.ntfyMessages },
  ];
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-ink">Content totals</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 @sm:grid-cols-4">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-lg border border-edge bg-surface-2 px-3 py-2"
          >
            <p className="truncate text-[11px] uppercase tracking-wide text-ink-muted">
              {it.label}
            </p>
            <p className="text-lg font-semibold text-ink">
              {it.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
