import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Flame, Plus, Trash2 } from "lucide-react";
import { habitsApi } from "../services/habits";
import type { Habit, HabitStats } from "../types";
import {
  MobileContainer,
  MobileEmpty,
  MobileFab,
  MobileHeader,
  MobileInput,
  MobileLoading,
  MobileSelect,
} from "./MobileUi";

const HABIT_ICONS = ["✅", "📚", "🧠", "💪", "🏃", "💧", "🎯", "✍️", "🌅", "🧘", "💻", "🎨"];
const HABIT_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6"];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function lastDays(count: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export default function MobileHabits({ onClose }: { onClose?: () => void }) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [stats, setStats] = useState<HabitStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "detail">("list");
  const [selected, setSelected] = useState<Habit | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [icon, setIcon] = useState(HABIT_ICONS[0]);
  const [color, setColor] = useState(HABIT_COLORS[0]);
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
  const [target, setTarget] = useState(1);

  const today = todayKey();
  const days = useMemo(() => lastDays(42), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [hRes, sRes] = await Promise.all([
      habitsApi.list().catch(() => null),
      habitsApi.stats().catch(() => null),
    ]);
    if (hRes) setHabits(hRes.habits);
    if (sRes) setStats(sRes.stats);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const statFor = (id: string) => stats.find((s) => s.habitId === id);
  const isDoneToday = (h: Habit) => Boolean(statFor(h.id)?.last30.includes(today));

  const toggleToday = async (h: Habit) => {
    const done = isDoneToday(h);
    if (done) await habitsApi.unlog(h.id, today).catch(() => {});
    else await habitsApi.log(h.id, today, 1).catch(() => {});
    await refresh();
  };

  const createHabit = async () => {
    if (!name.trim()) return;
    await habitsApi
      .create({
        name: name.trim(),
        icon,
        color,
        cadence,
        target,
        linkedApp: null,
        linkedMetric: null,
      })
      .catch(() => {});
    setName("");
    setIcon(HABIT_ICONS[0]);
    setColor(HABIT_COLORS[0]);
    setCadence("daily");
    setTarget(1);
    setShowForm(false);
    await refresh();
  };

  const deleteHabit = async () => {
    if (!selected) return;
    if (!window.confirm("Delete this habit?")) return;
    await habitsApi.delete(selected.id).catch(() => {});
    setSelected(null);
    setView("list");
    await refresh();
  };

  const HabitForm = () => (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={() => setShowForm(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-edge bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-semibold text-ink">New habit</h2>
        <MobileInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Read 30 pages"
          className="mb-3"
        />

        <div className="mb-3">
          <p className="mb-2 text-xs font-medium text-ink-muted">Icon</p>
          <div className="flex flex-wrap gap-2">
            {HABIT_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => setIcon(ic)}
                className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${
                  icon === ic ? "bg-surface-3 ring-1 ring-white/20" : "bg-surface-2"
                }`}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <p className="mb-2 text-xs font-medium text-ink-muted">Color</p>
          <div className="flex flex-wrap gap-2">
            {HABIT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full border-2 ${color === c ? "border-ink" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">Cadence</p>
            <MobileSelect value={cadence} onChange={(e) => setCadence(e.target.value as "daily" | "weekly")}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </MobileSelect>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">Target</p>
            <MobileInput
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="rounded-xl px-4 py-2 text-sm text-ink-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void createHabit()}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-ink"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );

  if (view === "detail" && selected) {
    const stat = statFor(selected.id);
    const done = isDoneToday(selected);
    return (
      <MobileContainer>
        <MobileHeader
          title={selected.name}
          subtitle="Habit"
          onBack={() => setView("list")}
          right={
            <button
              type="button"
              onClick={() => void deleteHabit()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:text-rose-400"
            >
              <Trash2 size={20} />
            </button>
          }
        />

        <div className="mb-6 flex items-center gap-4 rounded-2xl border border-edge bg-surface-2 p-4">
          <span className="text-4xl">{selected.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold text-ink">{stat?.currentStreak ?? 0} day streak</p>
            <p className="text-sm text-ink-muted">
              Best {stat?.longestStreak ?? 0} · Total {stat?.totalLogs ?? 0} completions
            </p>
          </div>
          <button
            type="button"
            onClick={() => void toggleToday(selected)}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 transition ${
              done ? "border-transparent text-ink" : "border-edge text-transparent"
            }`}
            style={done ? { background: selected.color } : {}}
          >
            <Check size={22} />
          </button>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-muted">Last 6 weeks</p>
          <span className="text-xs text-ink-muted">
            {selected.cadence} · target {selected.target}
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const logged = stat?.last30.includes(d);
            return (
              <div
                key={d}
                className={`aspect-square rounded-sm ${logged ? "" : "bg-surface-2"}`}
                style={logged ? { backgroundColor: selected.color } : {}}
                title={`${d}: ${logged ? "done" : "—"}`}
              />
            );
          })}
        </div>
      </MobileContainer>
    );
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Habits"
        subtitle="Small wins, daily"
        onClose={onClose}
        right={<MobileFab onClick={() => setShowForm(true)} icon={<Plus size={22} />} />}
      />

      <div className="space-y-2">
        {loading ? (
          <MobileLoading />
        ) : habits.length ? (
          habits.map((h) => {
            const stat = statFor(h.id);
            const done = isDoneToday(h);
            return (
              <article
                key={h.id}
                onClick={() => {
                  setSelected(h);
                  setView("detail");
                }}
                className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-4 active:bg-surface-3"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleToday(h);
                  }}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    done ? "border-transparent text-ink" : "border-edge text-transparent"
                  }`}
                  style={done ? { background: h.color } : {}}
                >
                  <Check size={20} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{h.icon}</span>
                    <span className="truncate font-medium text-ink">{h.name}</span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    <Flame size={12} className="mr-1 inline text-orange-500" />
                    {stat?.currentStreak ?? 0} day streak · best {stat?.longestStreak ?? 0}
                    {h.cadence === "weekly" ? " · weekly" : ""}
                    {h.target > 1 ? ` · target ${h.target}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  {Array.from({ length: 7 }).map((_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - (6 - i));
                    const dk = d.toISOString().slice(0, 10);
                    const logged = stat?.last30.includes(dk);
                    return (
                      <div
                        key={i}
                        className={`h-4 w-4 rounded-sm ${logged ? "" : "bg-surface-2"}`}
                        style={logged ? { backgroundColor: h.color } : {}}
                      />
                    );
                  })}
                </div>
              </article>
            );
          })
        ) : (
          <MobileEmpty text="No habits yet. Build your first streak." />
        )}
      </div>

      {showForm && <HabitForm />}
    </MobileContainer>
  );
}
