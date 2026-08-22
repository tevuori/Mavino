// ===== Mobile Analytics =====
// Mobile-optimized summary of the user's gamification & study-analytics
// dashboard: XP/level, focus minutes, flashcard reviews/retention, habits,
// grades trend, and recently unlocked achievements.

import { useEffect, useState } from "react";
import {
  Loader2, AlertCircle, Zap, Timer, Brain, Flame,
  GraduationCap, CheckSquare, Trophy, TrendingUp,
} from "lucide-react";
import { analyticsApi } from "../services/analytics";
import type { AnalyticsDashboard } from "../types";
import { MobileContainer, MobileHeader, MobileEmpty } from "./MobileUi";

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-edge bg-surface-2 p-3.5">
      <div className="mb-2 text-accent">{icon}</div>
      <p className="text-xl font-bold text-ink">{value}</p>
      <p className="text-[11px] text-ink-muted">{label}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink-muted">{sub}</p>}
    </div>
  );
}

/** Small horizontal bar-list (used for maturity + habit adherence-style breakdowns). */
function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="font-medium text-ink">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function MobileAnalytics({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        setData(await analyticsApi.myDashboard());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load analytics");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <MobileContainer>
        <MobileHeader title="Analytics" subtitle="Your progress" onClose={onClose} />
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-ink-muted" />
        </div>
      </MobileContainer>
    );
  }

  if (error || !data) {
    return (
      <MobileContainer>
        <MobileHeader title="Analytics" subtitle="Your progress" onClose={onClose} />
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0" /> {error ?? "No analytics available."}
        </div>
      </MobileContainer>
    );
  }

  const retentionDays = data.flashcards.reviewRetention.filter((d) => d.rate !== null);
  const avgRetention = retentionDays.length
    ? Math.round((retentionDays.reduce((s, d) => s + (d.rate ?? 0), 0) / retentionDays.length) * 100)
    : null;
  const topHabits = [...data.habits.perHabit].sort((a, b) => b.currentStreak - a.currentStreak).slice(0, 4);
  const recentGrades = [...data.grades.trend].slice(-4).reverse();

  return (
    <MobileContainer>
      <MobileHeader title="Analytics" subtitle={`Last ${data.windowDays} days`} onClose={onClose} />

      {/* XP / Level */}
      <section className="mb-5 rounded-3xl border border-accent/20 bg-gradient-to-br from-accent/20 to-accent/5 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-accent">Level {data.xp.level}</p>
            <p className="mt-0.5 text-2xl font-bold text-ink">{data.xp.total.toLocaleString()} XP</p>
          </div>
          <Zap className="text-accent" size={28} />
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(data.xp.levelProgress * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-ink-muted">{data.xp.nextLevelXp} XP to next level</p>
      </section>

      {/* Stat grid */}
      <div className="mb-5 grid grid-cols-2 gap-2.5">
        <StatCard
          icon={<Timer size={20} />}
          label="Focus time"
          value={`${Math.round(data.focus.totalMinutes / 60)}h`}
          sub={`${data.focus.totalSessions} sessions`}
        />
        <StatCard
          icon={<Brain size={20} />}
          label="Flashcard reviews"
          value={String(data.flashcards.totalReviews)}
          sub={avgRetention !== null ? `${avgRetention}% retention` : undefined}
        />
        <StatCard
          icon={<Flame size={20} />}
          label="Habit streak"
          value={String(data.habits.maxStreak)}
          sub={`${data.habits.totalHabits} habits tracked`}
        />
        <StatCard
          icon={<CheckSquare size={20} />}
          label="Tasks done"
          value={String(data.tasks.totalDone)}
          sub={`${data.study.total} study sessions`}
        />
      </div>

      {/* Flashcard maturity */}
      {data.flashcards.totalCards > 0 && (
        <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <Brain size={16} className="text-accent" /> Card maturity
          </h2>
          <div className="space-y-2.5">
            <BarRow label="Fresh" value={data.flashcards.maturity.fresh} max={data.flashcards.totalCards} color="#94a3b8" />
            <BarRow label="Learning" value={data.flashcards.maturity.learning} max={data.flashcards.totalCards} color="#f59e0b" />
            <BarRow label="Young" value={data.flashcards.maturity.young} max={data.flashcards.totalCards} color="#06b6d4" />
            <BarRow label="Mature" value={data.flashcards.maturity.mature} max={data.flashcards.totalCards} color="#22c55e" />
          </div>
        </section>
      )}

      {/* Top habits */}
      {topHabits.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-ink">Top streaks</h2>
          <div className="space-y-2">
            {topHabits.map((h) => (
              <div key={h.habitId} className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${h.color}20`, color: h.color }}>
                  <Flame size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{h.name}</p>
                  <p className="text-[11px] text-ink-muted">{h.totalLogs} total logs</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-ink">{h.currentStreak}</p>
                  <p className="text-[10px] text-ink-muted">best {h.longestStreak}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent grades */}
      {recentGrades.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
            <GraduationCap size={16} className="text-accent" /> Recent grades
          </h2>
          <div className="space-y-2">
            {recentGrades.map((g, i) => (
              <div key={`${g.date}-${i}`} className="flex items-center justify-between gap-2 rounded-2xl border border-edge bg-surface-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{g.name}</p>
                  <p className="text-[11px] text-ink-muted">{g.course}</p>
                </div>
                <span className={`text-lg font-bold ${g.pct >= 80 ? "text-emerald-400" : g.pct >= 60 ? "text-amber-400" : "text-red-400"}`}>
                  {Math.round(g.pct)}%
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Achievements */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <Trophy size={16} className="text-accent" /> Achievements
        </h2>
        {data.achievements.length === 0 ? (
          <MobileEmpty text="No achievements unlocked yet — keep studying to earn your first one." />
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {data.achievements.map((a) => (
              <div
                key={a.id}
                title={a.description}
                className={`rounded-2xl border p-3 text-center ${a.unlocked ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-edge bg-surface-2 opacity-50"}`}
              >
                <Trophy size={20} className={`mx-auto mb-1.5 ${a.unlocked ? "text-amber-400" : "text-ink-muted"}`} />
                <p className="truncate text-xs font-semibold text-ink">{a.label}</p>
                <p className="mt-0.5 text-[9px] uppercase tracking-wide text-ink-muted">{a.tier}</p>
                {a.isNew && <p className="mt-1 text-[10px] font-medium text-accent">New!</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.study.total === 0 && data.flashcards.totalReviews === 0 && data.tasks.totalDone === 0 && (
        <div className="mt-5 flex items-center gap-2 rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-xs text-ink-muted">
          <TrendingUp size={14} className="shrink-0" /> Your dashboard fills in as you study, review cards, and complete tasks.
        </div>
      )}
    </MobileContainer>
  );
}
