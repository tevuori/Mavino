// ===== Habit Tracker =====
// Daily/weekly habits with streaks, a GitHub-style heatmap, and
// auto-completion for pomodoro-linked habits (reads the same localStorage
// stats the Pomodoro app writes).

import { useState, useEffect, useCallback, useMemo } from "react";
import { Flame, Plus, Trash2, Check, X, RefreshCw, TrendingUp } from "lucide-react";
import { habitsApi } from "../../services/habits";
import { useDataRefreshVersion } from "../../store/dataRefresh";
import { alertDialog } from "../../store/mobileDialog";
import type { Habit, HabitStats } from "../../types";

interface PomodoroStats {
  completedFocus: number;
  totalFocusMinutes: number;
  date: string;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadPomodoroStats(): PomodoroStats | null {
  try {
    const raw = localStorage.getItem("pomodoro-stats");
    if (raw) {
      const stats = JSON.parse(raw) as PomodoroStats;
      if (stats.date === todayKey()) return stats;
    }
  } catch { /* ignore */ }
  return null;
}

const HABIT_ICONS = ["✅", "📚", "🧠", "💪", "🏃", "💧", "🎯", "✍️", "🌅", "🧘", "💻", "🎨"];
const HABIT_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6"];

export default function HabitsApp() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [stats, setStats] = useState<HabitStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedHabit, setSelectedHabit] = useState<Habit | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pomoStats, setPomoStats] = useState<PomodoroStats | null>(loadPomodoroStats);
  const refreshVersion = useDataRefreshVersion("habits");

  // Form state
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(HABIT_ICONS[0]);
  const [color, setColor] = useState(HABIT_COLORS[0]);
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
  const [target, setTarget] = useState(1);
  const [linkedApp, setLinkedApp] = useState<string | null>(null);
  const [linkedMetric, setLinkedMetric] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, sRes] = await Promise.all([
        habitsApi.list().catch(() => null),
        habitsApi.stats().catch(() => null),
      ]);
      if (hRes?.habits) setHabits(hRes.habits);
      if (sRes?.stats) setStats(sRes.stats);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => setPomoStats(loadPomodoroStats()), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Refresh when Athena mutates habits data (create_habit, log_habit, etc.)
  useEffect(() => {
    if (refreshVersion > 0) refresh();
  }, [refreshVersion, refresh]);

  const today = todayKey();

  // Compute auto-completion for pomodoro-linked habits.
  const autoCompleted = useMemo(() => {
    const out: Record<string, number> = {};
    if (!pomoStats) return out;
    for (const h of habits) {
      if (h.linkedApp === "pomodoro" && h.linkedMetric) {
        const val = h.linkedMetric === "focusSessions" ? pomoStats.completedFocus
          : h.linkedMetric === "focusMinutes" ? pomoStats.totalFocusMinutes
          : 0;
        if (val >= h.target) out[h.id] = val;
      }
    }
    return out;
  }, [habits, pomoStats]);

  const isDoneToday = (h: Habit): boolean => {
    const s = stats.find((x) => x.habitId === h.id);
    return Boolean(s?.last30.includes(today));
  };

  const toggleToday = async (h: Habit) => {
    const done = isDoneToday(h);
    try {
      if (done) {
        await habitsApi.unlog(h.id, today);
      } else {
        await habitsApi.log(h.id, today, autoCompleted[h.id] ?? 1);
      }
      refresh();
    } catch (e) {
      void alertDialog((e as Error).message);
    }
  };

  const createHabit = async () => {
    if (!name.trim()) return;
    try {
      await habitsApi.create({
        name: name.trim(),
        icon,
        color,
        cadence,
        target,
        linkedApp: linkedApp || null,
        linkedMetric: linkedMetric || null,
      });
      setShowForm(false);
      setName(""); setIcon(HABIT_ICONS[0]); setColor(HABIT_COLORS[0]);
      setCadence("daily"); setTarget(1); setLinkedApp(null); setLinkedMetric(null);
      refresh();
    } catch (e) {
      void alertDialog((e as Error).message);
    }
  };

  const deleteHabit = async (id: string) => {
    try {
      await habitsApi.delete(id);
      setSelectedHabit(null);
      setConfirmingDelete(false);
      refresh();
    } catch (e) {
      void alertDialog((e as Error).message);
    }
  };

  const statFor = (id: string): HabitStats | undefined => stats.find((s) => s.habitId === id);

  return (
    <div className="relative flex h-full bg-surface">
      {/* Habit list */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          <Flame size={18} className="text-accent" />
          <span className="text-sm font-semibold">Habits</span>
          <div className="flex-1" />
          <button onClick={refresh} className="rounded-md p-1.5 text-ink-muted hover:bg-surface-3" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90">
            <Plus size={13} /> New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {habits.length === 0 && !loading && (
            <div className="flex h-full flex-col items-center justify-center text-center text-ink-muted">
              <Flame size={40} className="mb-2 opacity-30" />
              <p className="text-sm">No habits yet.</p>
              <p className="text-xs">Create one to start building streaks.</p>
            </div>
          )}
          <div className="space-y-2">
            {habits.map((h) => {
              const s = statFor(h.id);
              const done = isDoneToday(h);
              const auto = autoCompleted[h.id];
              return (
                <div
                  key={h.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition cursor-pointer ${
                    selectedHabit?.id === h.id ? "border-accent bg-surface-2" : "border-edge bg-surface-2/40 hover:bg-surface-2/70"
                  }`}
                  onClick={() => setSelectedHabit(h)}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleToday(h); }}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      done ? "border-transparent text-white" : "border-edge text-transparent hover:border-accent"
                    }`}
                    style={done ? { background: h.color } : {}}
                    title={done ? "Done today — click to undo" : "Mark done today"}
                  >
                    <Check size={16} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{h.icon}</span>
                      <span className="truncate text-sm font-medium text-ink">{h.name}</span>
                      {auto && !done && (
                        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500" title={`Auto-completed via ${h.linkedApp}: ${auto}`}>
                          auto
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                      <span className="flex items-center gap-0.5">
                        <Flame size={10} className="text-orange-500" />
                        {s?.currentStreak ?? 0} day streak
                      </span>
                      <span>· best {s?.longestStreak ?? 0}</span>
                      {h.cadence === "weekly" && <span>· weekly</span>}
                      {h.target > 1 && <span>· target {h.target}</span>}
                    </div>
                  </div>
                  {/* Mini 7-day strip */}
                  <div className="flex shrink-0 gap-1">
                    {Array.from({ length: 7 }, (_, i) => {
                      const d = new Date();
                      d.setDate(d.getDate() - (6 - i));
                      const dk = d.toISOString().slice(0, 10);
                      const logged = s?.last30.includes(dk);
                      return (
                        <div
                          key={i}
                          className={`h-4 w-4 rounded-sm ${logged ? "" : "bg-surface-3"}`}
                          style={logged ? { background: h.color } : {}}
                          title={`${dk}: ${logged ? "done" : "—"}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail panel — inline @4xl+, auto-overlay when narrow */}
      {selectedHabit && (
        <>
          <div className="@4xl:hidden absolute inset-0 z-10 bg-black/40" onClick={() => { setSelectedHabit(null); setConfirmingDelete(false); }} />
          <HabitDetail
            habit={selectedHabit}
            stat={statFor(selectedHabit.id)}
            confirmingDelete={confirmingDelete}
            onClose={() => { setSelectedHabit(null); setConfirmingDelete(false); }}
            onDelete={() => {
              if (confirmingDelete) {
                deleteHabit(selectedHabit.id);
              } else {
                setConfirmingDelete(true);
              }
            }}
          />
        </>
      )}

      {/* Create form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-edge bg-surface p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">New Habit</h3>
              <button onClick={() => setShowForm(false)} className="rounded p-1 text-ink-muted hover:bg-surface-3"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-ink-muted">Name</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createHabit()}
                  className="w-full rounded-md border border-edge bg-surface-2 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
                  placeholder="e.g. Review flashcards"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-ink-muted">Icon</label>
                <div className="flex flex-wrap gap-1">
                  {HABIT_ICONS.map((ic) => (
                    <button
                      key={ic}
                      onClick={() => setIcon(ic)}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border text-lg ${icon === ic ? "border-accent bg-surface-2" : "border-edge"}`}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-[11px] font-medium text-ink-muted">Color</label>
                  <div className="flex flex-wrap gap-1">
                    {HABIT_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-ink" : "border-transparent"}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-ink-muted">Cadence</label>
                  <select
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value as "daily" | "weekly")}
                    className="rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-ink-muted">Target (count per period)</label>
                <input
                  type="number"
                  min={1}
                  value={target}
                  onChange={(e) => setTarget(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-md border border-edge bg-surface-2 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-ink-muted">Auto-complete from (optional)</label>
                <select
                  value={linkedApp ?? ""}
                  onChange={(e) => {
                    setLinkedApp(e.target.value || null);
                    setLinkedMetric(e.target.value === "pomodoro" ? "focusSessions" : null);
                  }}
                  className="w-full rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                >
                  <option value="">None (manual)</option>
                  <option value="pomodoro">Pomodoro focus sessions</option>
                </select>
                {linkedApp === "pomodoro" && (
                  <select
                    value={linkedMetric ?? ""}
                    onChange={(e) => setLinkedMetric(e.target.value || null)}
                    className="mt-1.5 w-full rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                  >
                    <option value="focusSessions">Focus sessions count</option>
                    <option value="focusMinutes">Focus minutes total</option>
                  </select>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded-md border border-edge px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-3">Cancel</button>
              <button onClick={createHabit} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Detail panel with heatmap =====
function HabitDetail({
  habit, stat, onClose, onDelete, confirmingDelete,
}: {
  habit: Habit;
  stat: HabitStats | undefined;
  onClose: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
}) {
  // Build a 7xN grid (weeks as columns, days as rows) for the last ~91 days.
  const days = 91;
  const cells: { date: string; logged: boolean }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dk = d.toISOString().slice(0, 10);
    cells.push({ date: dk, logged: Boolean(stat?.last30.includes(dk)) });
  }
  // Group into weeks (columns of 7).
  const weeks: { date: string; logged: boolean }[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return (
    <div className="absolute inset-y-0 right-0 z-20 shrink-0 flex w-72 flex-col border-l border-edge bg-surface-2/40 shadow-window @4xl:static @4xl:z-auto @4xl:shadow-none">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-lg">{habit.icon}</span>
          <span className="text-sm font-semibold text-ink">{habit.name}</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-surface-3"><X size={14} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {/* Stats */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-surface p-3">
            <div className="flex items-center gap-1 text-[11px] text-ink-muted">
              <Flame size={11} className="text-orange-500" /> Current
            </div>
            <div className="text-2xl font-bold text-ink">{stat?.currentStreak ?? 0}</div>
            <div className="text-[10px] text-ink-muted">days</div>
          </div>
          <div className="rounded-lg bg-surface p-3">
            <div className="flex items-center gap-1 text-[11px] text-ink-muted">
              <TrendingUp size={11} /> Best
            </div>
            <div className="text-2xl font-bold text-ink">{stat?.longestStreak ?? 0}</div>
            <div className="text-[10px] text-ink-muted">days</div>
          </div>
        </div>

        {/* Heatmap */}
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Last 13 weeks</div>
        <div className="flex gap-0.5 overflow-x-auto">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {week.map((cell, ci) => (
                <div
                  key={ci}
                  className={`h-3 w-3 rounded-sm ${cell.logged ? "" : "bg-surface-3"}`}
                  style={cell.logged ? { background: habit.color } : {}}
                  title={`${cell.date}: ${cell.logged ? "done" : "—"}`}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="mt-3 text-[11px] text-ink-muted">
          {stat?.totalLogs ?? 0} total completions
        </div>

        {habit.linkedApp && (
          <div className="mt-3 rounded-md bg-surface p-2 text-[11px] text-ink-muted">
            Auto-completes from <span className="font-medium text-ink">{habit.linkedApp}</span> ({habit.linkedMetric}) when target ≥ {habit.target}.
          </div>
        )}

        <button
          onClick={onDelete}
          className={`mt-4 flex items-center gap-1 rounded-md px-2 py-1 text-xs transition ${
            confirmingDelete
              ? "bg-red-500 text-white hover:bg-red-600"
              : "text-red-500 hover:bg-red-500/10"
          }`}
        >
          <Trash2 size={13} /> {confirmingDelete ? "Click again to confirm" : "Delete habit"}
        </button>
      </div>
    </div>
  );
}
