// ===== Analytics & Gamification dashboard =====
// Aggregates the user's own data across Habits, Pomodoro, Flashcards, Grades,
// Study Hub, and Tasks into a single dashboard with charts (study hours over
// time, flashcard retention, grade trends, habit adherence) plus an XP/level
// system and achievements. All data comes from GET /api/analytics/me.

import { useState, useEffect, useCallback, useRef } from "react";
import * as Lucide from "lucide-react";
import { BarChart3, RefreshCw, Flame, Timer, Brain, CheckSquare, GraduationCap, TrendingUp, Sparkles, Clock, Star, Crown, Zap } from "lucide-react";
import { analyticsApi } from "../../services/analytics";
import { useDataRefreshVersion } from "../../store/dataRefresh";
import { useNotifications } from "../../store/notifications";
import type { AnalyticsDashboard, Achievement } from "../../types";
import { BarChart, LineChart, RateLineChart, DonutChart, Heatmap, LevelRing } from "./charts";
import { TIER_STYLES } from "./achievements";

const CHART_DAYS = 30; // per-day bar/line charts show the last 30 days

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

function shortDay(day: string): string {
  // YYYY-MM-DD → "M/D"
  const [, mo, d] = day.split("-");
  return `${parseInt(mo)}/${parseInt(d)}`;
}

const STUDY_TYPE_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6"];
const STUDY_TYPE_LABELS: Record<string, string> = {
  flashcards: "Flashcards",
  summary: "Summarize",
  quiz: "Quiz",
  explain: "Explain",
  study_guide: "Study Guide",
  syllabus: "Syllabus",
  notes: "Notes",
};

export default function AnalyticsApp() {
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshVersion = useDataRefreshVersion("analytics");
  const notifiedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await analyticsApi.myDashboard();
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when Athena mutates related data.
  useEffect(() => {
    if (refreshVersion > 0) load();
  }, [refreshVersion, load]);

  // Toast newly-unlocked achievements once per load.
  const push = useNotifications().push;
  useEffect(() => {
    if (!data || notifiedRef.current) return;
    notifiedRef.current = true;
    for (const id of data.newlyUnlocked) {
      const a = data.achievements.find((x) => x.id === id);
      if (a) {
        push({
          app: "analytics",
          title: "Achievement unlocked!",
          body: `${a.label} — ${a.description}`,
        });
      }
    }
  }, [data, push]);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <BarChart3 size={18} className="text-accent" />
        <span className="text-sm font-semibold">Analytics</span>
        <div className="flex-1" />
        <button onClick={load} className="rounded-md p-1.5 text-ink-muted hover:bg-surface-3" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 @sm:p-4">
        {loading && !data && (
          <div className="flex h-full items-center justify-center text-ink-muted">
            <RefreshCw size={22} className="animate-spin" />
          </div>
        )}
        {error && !loading && (
          <div className="flex h-full flex-col items-center justify-center text-center text-ink-muted">
            <p className="text-sm">Couldn't load analytics.</p>
            <p className="mt-1 text-xs">{error}</p>
            <button onClick={load} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white">Retry</button>
          </div>
        )}
        {data && <Dashboard data={data} />}
      </div>
    </div>
  );
}

// ===========================================================================
// Dashboard layout
// ===========================================================================

function Dashboard({ data }: { data: AnalyticsDashboard }) {
  const last30 = data.days.slice(-CHART_DAYS);
  const focusLast30 = data.focus.perDay.slice(-CHART_DAYS);
  const xpLast30 = data.xp.perDay.slice(-CHART_DAYS);
  const reviewLast30 = data.flashcards.reviewRetention.slice(-CHART_DAYS);
  const studyLast30 = data.study.perDay.slice(-CHART_DAYS);
  const tasksLast30 = data.tasks.perDay.slice(-CHART_DAYS);
  const adherenceRates = data.habits.adherence.map((a) => a.rate);

  const studySegments = Object.entries(data.study.byType)
    .filter(([, v]) => v > 0)
    .map(([k, v], i) => ({
      label: STUDY_TYPE_LABELS[k] ?? k,
      value: v,
      color: STUDY_TYPE_COLORS[i % STUDY_TYPE_COLORS.length],
    }));

  const maturitySegments = [
    { label: "Fresh", value: data.flashcards.maturity.fresh, color: "#64748b" },
    { label: "Learning", value: data.flashcards.maturity.learning, color: "#f59e0b" },
    { label: "Young", value: data.flashcards.maturity.young, color: "#3b82f6" },
    { label: "Mature", value: data.flashcards.maturity.mature, color: "#22c55e" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-3 @sm:space-y-4">
      {/* Hero: level + XP + key stats */}
      <HeroCard data={data} />

      {/* Newly unlocked banner */}
      {data.newlyUnlocked.length > 0 && (
        <div className="rounded-xl border border-warning bg-warning-soft p-3 @sm:p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
            <Sparkles size={16} /> {data.newlyUnlocked.length} new achievement{data.newlyUnlocked.length > 1 ? "s" : ""} unlocked!
          </div>
          <div className="flex flex-wrap gap-2">
            {data.newlyUnlocked.map((id) => {
              const a = data.achievements.find((x) => x.id === id);
              if (!a) return null;
              return <AchievementBadge key={id} a={a} />;
            })}
          </div>
        </div>
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-2 @sm:grid-cols-3 @3xl:grid-cols-6">
        <StatTile icon={<Timer size={15} />} label="Focus sessions" value={data.focus.totalSessions} />
        <StatTile icon={<Clock size={15} />} label="Focus time" value={fmtMinutes(data.focus.totalMinutes)} />
        <StatTile icon={<Brain size={15} />} label="Reviews" value={data.flashcards.totalReviews} />
        <StatTile icon={<CheckSquare size={15} />} label="Tasks done" value={data.tasks.totalDone} />
        <StatTile icon={<GraduationCap size={15} />} label="Study sessions" value={data.study.total} />
        <StatTile icon={<Flame size={15} />} label="Best streak" value={`${data.habits.maxStreak}d`} />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 gap-3 @sm:gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <Card title="Study hours over time" subtitle={`Last ${CHART_DAYS} days · ${fmtMinutes(focusLast30.reduce((s, d) => s + d.minutes, 0))}`}>
          <BarChart
            data={focusLast30.map((d) => ({ day: d.day, value: d.minutes }))}
            height={130}
            formatValue={(v) => fmtMinutes(v)}
          />
          <DayAxis days={last30} />
        </Card>

        <Card title="XP earned" subtitle={`Last ${CHART_DAYS} days · ${xpLast30.reduce((s, d) => s + d.xp, 0)} XP`}>
          <BarChart data={xpLast30.map((d) => ({ day: d.day, value: d.xp }))} height={130} color="rgb(245,158,11)" />
          <DayAxis days={last30} />
        </Card>

        <Card title="Flashcard reviews" subtitle={`Last ${CHART_DAYS} days · ${reviewLast30.reduce((s, d) => s + d.count, 0)} reviews`}>
          <BarChart data={reviewLast30.map((d) => ({ day: d.day, value: d.count }))} height={130} color="rgb(139,92,246)" />
          <DayAxis days={last30} />
        </Card>

        <Card title="Recall success rate" subtitle="Daily retention (quality ≥ 3)">
          <RateLineChart data={reviewLast30.map((d) => ({ day: d.day, rate: d.rate }))} height={130} color="rgb(34,197,94)" />
          <DayAxis days={last30} />
        </Card>

        <Card title="Card maturity" subtitle={`${data.flashcards.totalCards} cards · avg ease ${data.flashcards.avgEase.toFixed(2)}`}>
          <div className="flex items-center gap-4">
            <DonutChart
              segments={maturitySegments}
              centerLabel={`${data.flashcards.totalCards}`}
              centerSub="cards"
            />
            <Legend segments={maturitySegments} />
          </div>
        </Card>

        <Card title="Grade trend" subtitle={`${data.grades.assignmentCount} assignments`}>
          {data.grades.trend.length > 0 ? (
            <>
              <LineChart
                data={data.grades.trend.map((g) => ({ day: g.date, value: g.pct }))}
                height={130}
                color="rgb(99,102,241)"
                formatValue={(v) => `${v.toFixed(1)}%`}
              />
              <div className="mt-1 flex justify-between text-[10px] text-ink-muted">
                <span>{data.grades.trend[0] ? shortDay(data.grades.trend[0].date) : ""}</span>
                <span>{data.grades.trend[data.grades.trend.length - 1] ? shortDay(data.grades.trend[data.grades.trend.length - 1].date) : ""}</span>
              </div>
            </>
          ) : (
            <EmptyHint icon={<TrendingUp size={26} />} text="No grades recorded yet." />
          )}
        </Card>

        <Card title="Habit adherence" subtitle="Last 90 days">
          {data.habits.totalHabits > 0 ? (
            <>
              <Heatmap days={data.days} rates={adherenceRates} />
              <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-ink-muted">
                <span>Less</span>
                <div className="h-2.5 w-2.5 rounded-sm bg-accent" style={{ opacity: 0.08 }} />
                <div className="h-2.5 w-2.5 rounded-sm bg-accent" style={{ opacity: 0.4 }} />
                <div className="h-2.5 w-2.5 rounded-sm bg-accent" style={{ opacity: 0.7 }} />
                <div className="h-2.5 w-2.5 rounded-sm bg-accent" style={{ opacity: 1 }} />
                <span>More</span>
              </div>
            </>
          ) : (
            <EmptyHint icon={<Flame size={26} />} text="No habits yet." />
          )}
        </Card>

        <Card title="Study sessions by type" subtitle={`${data.study.total} total`}>
          {studySegments.length > 0 ? (
            <div className="flex items-center gap-4">
              <DonutChart segments={studySegments} centerLabel={`${data.study.total}`} centerSub="sessions" />
              <Legend segments={studySegments} />
            </div>
          ) : (
            <EmptyHint icon={<GraduationCap size={26} />} text="No Study Hub activity yet." />
          )}
        </Card>

        <Card title="Tasks completed" subtitle={`Last ${CHART_DAYS} days · ${tasksLast30.reduce((s, d) => s + d.count, 0)} done`}>
          <BarChart data={tasksLast30.map((d) => ({ day: d.day, value: d.count }))} height={130} color="rgb(34,197,94)" />
          <DayAxis days={last30} />
        </Card>
      </div>

      {/* Per-habit streaks */}
      {data.habits.perHabit.length > 0 && (
        <Card title="Habit streaks" subtitle={`${data.habits.perHabit.length} habits`}>
          <div className="grid grid-cols-1 gap-2 @sm:grid-cols-2 @3xl:grid-cols-3">
            {data.habits.perHabit.map((h) => (
              <div key={h.habitId} className="flex items-center gap-2 rounded-lg bg-surface-2/60 p-2">
                <span className="text-base">{h.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-ink">{h.name}</div>
                  <div className="flex items-center gap-1 text-[10px] text-ink-muted">
                    <Flame size={9} className="text-warning" />
                    {h.currentStreak}d · best {h.longestStreak}d · {h.totalLogs} total
                  </div>
                </div>
                {/* mini 14-day strip */}
                <div className="flex shrink-0 gap-0.5">
                  {Array.from({ length: 14 }, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - (13 - i));
                    const dk = d.toISOString().slice(0, 10);
                    const logged = h.last30.includes(dk);
                    return (
                      <div
                        key={i}
                        className="h-3 w-2 rounded-sm"
                        style={logged ? { background: h.color } : { background: "rgb(var(--surface-3))" }}
                        title={`${dk}: ${logged ? "done" : "—"}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Achievements grid */}
      <Card title="Achievements" subtitle={`${data.achievements.filter((a) => a.unlocked).length}/${data.achievements.length} unlocked`}>
        <div className="grid grid-cols-2 gap-2 @sm:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
          {data.achievements.map((a) => (
            <AchievementBadge key={a.id} a={a} showInfo />
          ))}
        </div>
      </Card>

      <p className="pb-2 text-center text-[10px] text-ink-muted">
        Analytics data is collected as you use Mavino. Historical focus &amp; review data starts from when this feature shipped.
      </p>
    </div>
  );
}

// ===========================================================================
// Hero card — level ring + XP progress + headline stats
// ===========================================================================

function HeroCard({ data }: { data: AnalyticsDashboard }) {
  const { xp } = data;
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-edge bg-gradient-to-br from-surface-2/80 to-surface p-4 @sm:flex-row @sm:items-center">
      <div className="flex shrink-0 items-center justify-center">
        <LevelRing level={xp.level} progress={xp.levelProgress} size={130} />
      </div>
      <div className="flex-1 text-center @sm:text-left">
        <div className="flex items-center justify-center gap-1.5 @sm:justify-start">
          <Zap size={16} className="text-warning" />
          <span className="text-2xl font-bold text-ink">{xp.total.toLocaleString()}</span>
          <span className="text-sm text-ink-muted">XP</span>
        </div>
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.round(xp.levelProgress * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-muted">
            {Math.round(xp.levelProgress * 100)}% to level {xp.level + 1} · {xp.nextLevelXp.toLocaleString()} XP needed
          </p>
        </div>
      </div>
      <div className="grid w-full grid-cols-3 gap-2 @sm:w-auto @sm:grid-cols-1 @sm:gap-1.5">
        <HeroStat label="Focus time" value={fmtMinutes(data.focus.totalMinutes)} icon={<Clock size={13} />} />
        <HeroStat label="Reviews" value={String(data.flashcards.totalReviews)} icon={<Brain size={13} />} />
        <HeroStat label="Best streak" value={`${data.habits.maxStreak}d`} icon={<Flame size={13} />} />
      </div>
    </div>
  );
}

function HeroStat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2/70 p-2 text-center @sm:text-left">
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-ink-muted @sm:justify-start">
        {icon} {label}
      </div>
      <div className="text-sm font-bold text-ink">{value}</div>
    </div>
  );
}

// ===========================================================================
// Small building blocks
// ===========================================================================

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-surface-2/40 p-3 @sm:p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-[11px] text-ink-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-2/40 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-muted">
        <span className="text-accent">{icon}</span>
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold text-ink">{value}</div>
    </div>
  );
}

function DayAxis({ days }: { days: string[] }) {
  // Show ~5 evenly spaced date labels.
  const n = days.length;
  const indices = n <= 1 ? [0] : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];
  const labels = Array.from(new Set(indices)).map((i) => shortDay(days[i]));
  return (
    <div className="mt-1 flex justify-between text-[10px] text-ink-muted">
      {labels.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </div>
  );
}

function Legend({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      {segments.map((s) => (
        <div key={s.label} className="flex items-center gap-1.5 text-[11px]">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          <span className="text-ink-muted">{s.label}</span>
          <span className="font-medium text-ink">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex h-[130px] flex-col items-center justify-center gap-1 text-ink-muted">
      <span className="opacity-30">{icon}</span>
      <span className="text-xs">{text}</span>
    </div>
  );
}

function AchievementBadge({ a, showInfo }: { a: Achievement; showInfo?: boolean }) {
  const tier = TIER_STYLES[a.tier];
  const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[a.icon] ?? Star;
  return (
    <div
      className={`relative flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition ${
        a.unlocked
          ? `${tier.ring} ${tier.bg} ${tier.glow}`
          : "border-edge bg-surface-2/30 opacity-50 grayscale"
      }`}
      title={a.description}
    >
      {a.isNew && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[8px] font-bold text-white">
          !
        </span>
      )}
      <Icon size={showInfo ? 22 : 18} />
      {showInfo && (
        <>
          <span className="text-[11px] font-semibold leading-tight text-ink">{a.label}</span>
          <span className="text-[9px] leading-tight text-ink-muted">{a.description}</span>
          <span className={`mt-0.5 text-[8px] font-semibold uppercase ${tier.text}`}>{tier.label}</span>
        </>
      )}
    </div>
  );
}
