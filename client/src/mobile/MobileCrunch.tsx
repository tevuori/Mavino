// ===== Mobile Crunch (Pro-tier AI exam planner) =====
// Mobile-optimized view of the user's Crunch exam-prep plan — shows today's
// tasks as tappable cards with progress checkboxes, a behind-alert banner,
// and exam setup when no plan exists.

import { useState, useEffect, useCallback } from "react";
import {
  CalendarClock, Plus, Trash2, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, Circle, Clock, Brain, BookOpen, Target, Zap,
  TrendingDown, Sparkles, GraduationCap,
} from "lucide-react";
import {
  crunchApi,
  type CrunchState, type CrunchPlanData, type CrunchExamInput,
  type CrunchDayTask, type CrunchTopic, type CrunchTaskType,
} from "../services/crunch";
import type { MobileTool } from "./MobileLauncher";
import { MobileContainer, MobileHeader, MobileEmpty } from "./MobileUi";

const TASK_TYPE_META: Record<CrunchTaskType, { label: string; icon: typeof Brain; color: string }> = {
  new: { label: "Learn", icon: BookOpen, color: "#6366f1" },
  review: { label: "Review", icon: Brain, color: "#06b6d4" },
  practice: { label: "Practice", icon: Target, color: "#f59e0b" },
  mock: { label: "Mock", icon: Zap, color: "#ec4899" },
};

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function MobileCrunch({ onClose, onOpenTool }: { onClose: () => void; onOpenTool: (tool: MobileTool) => void }) {
  const [state, setState] = useState<CrunchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [examRows, setExamRows] = useState([{ id: "tmp_1", name: "", date: "", syllabus: "" }]);
  const [dailyMinutes, setDailyMinutes] = useState(120);

  const poll = useCallback(async () => {
    const id = setInterval(async () => {
      try {
        const s = await crunchApi.get();
        setState(s);
        if (s.status === "ready" || s.status === "error") {
          clearInterval(id);
          setGenerating(false);
          setShowSetup(false);
          if (s.status === "error") setError(s.error || "Generation failed");
        }
      } catch {
        clearInterval(id);
        setGenerating(false);
        setError("Failed to check status");
      }
    }, 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await crunchApi.get();
      setState(s);
      if (s.status === "building") { setGenerating(true); void poll(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plan");
    } finally {
      setLoading(false);
    }
  }, [poll]);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    const valid = examRows.filter((r) => r.name.trim() && r.date);
    if (valid.length === 0) { setError("Add at least one exam with a name and date."); return; }
    setGenerating(true);
    setError(null);
    try {
      const exams: CrunchExamInput[] = valid.map((r) => ({
        name: r.name.trim(),
        date: r.date,
        syllabus: r.syllabus.trim(),
      }));
      await crunchApi.generate(exams, dailyMinutes);
      void poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
      setGenerating(false);
    }
  };

  const toggleTask = async (taskId: string, done: boolean) => {
    if (!state?.data) return;
    setState((prev) => {
      if (!prev?.data) return prev;
      const newData = { ...prev.data, days: prev.data.days.map((d) => ({
        ...d,
        tasks: d.tasks.map((t) => t.id === taskId ? { ...t, done, completedAt: done ? new Date().toISOString() : null } : t),
      }))};
      return { ...prev, data: newData };
    });
    try {
      const res = await crunchApi.logProgress(taskId, done);
      setState((prev) => prev ? { ...prev, data: res.data } : prev);
    } catch {
      void load();
    }
  };

  const completeDay = async (date: string) => {
    try {
      const res = await crunchApi.completeDay(date);
      setState((prev) => prev ? { ...prev, data: res.data } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  const deletePlan = async () => {
    if (!confirm("Delete your Crunch plan?")) return;
    try {
      await crunchApi.delete();
      setState(null);
      setShowSetup(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  const data = state?.data ?? null;
  const today = todayStr();
  const todayDay = data?.days.find((d) => d.date === today);
  const upcomingDays = data?.days.filter((d) => d.date > today).slice(0, 7) ?? [];
  const behindPct = data?.stats.behindPct ?? 0;

  const topicById = (id: string): CrunchTopic | undefined => data?.topics.find((t) => t.id === id);
  const examName = (id: string): string => data?.exams.find((e) => e.id === id)?.name ?? "Unknown";

  return (
    <MobileContainer>
      <MobileHeader
        title="Crunch"
        subtitle="Exam prep planner"
        onClose={onClose}
        right={
          data ? (
            <button
              onClick={deletePlan}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[.06] text-red-300"
            >
              <Trash2 size={20} />
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {generating && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
          <Sparkles size={16} className="animate-pulse" />
          Generating your study plan…
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-slate-500" />
        </div>
      )}

      {/* Setup form */}
      {!loading && showSetup && !data && (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-slate-400">
            Add your upcoming exams. Crunch reads your flashcard mastery + grades, then builds a spaced-repetition plan.
          </p>
          {examRows.map((r, i) => (
            <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase text-slate-500">Exam {i + 1}</span>
                {examRows.length > 1 && (
                  <button onClick={() => setExamRows(examRows.filter((x) => x.id !== r.id))} className="text-red-300">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <input
                value={r.name}
                onChange={(e) => setExamRows(examRows.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x))}
                placeholder="Exam name"
                className="mb-2 w-full rounded-xl border border-white/10 bg-white/[.05] px-3 py-2.5 text-sm text-white outline-none"
              />
              <input
                type="date"
                value={r.date}
                onChange={(e) => setExamRows(examRows.map((x) => x.id === r.id ? { ...x, date: e.target.value } : x))}
                className="mb-2 w-full rounded-xl border border-white/10 bg-white/[.05] px-3 py-2.5 text-sm text-white outline-none"
              />
              <textarea
                value={r.syllabus}
                onChange={(e) => setExamRows(examRows.map((x) => x.id === r.id ? { ...x, syllabus: e.target.value } : x))}
                placeholder="Syllabus — topics, chapters, material to cover"
                rows={3}
                className="w-full resize-y rounded-xl border border-white/10 bg-white/[.05] px-3 py-2.5 text-sm text-white outline-none"
              />
            </div>
          ))}
          <button
            onClick={() => setExamRows([...examRows, { id: `tmp_${Date.now()}`, name: "", date: "", syllabus: "" }])}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-400"
          >
            <Plus size={16} /> Add exam
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">Daily target:</span>
            <input
              type="number"
              value={dailyMinutes}
              onChange={(e) => setDailyMinutes(Math.max(15, Math.min(600, Number(e.target.value) || 120)))}
              min={15}
              max={600}
              step={15}
              className="w-20 rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-sm text-white outline-none"
            />
            <span className="text-xs text-slate-400">min/day</span>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-5 py-3.5 text-sm font-semibold text-white active:scale-[.98] disabled:opacity-50"
          >
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            Generate plan
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !data && !showSetup && !generating && (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-500/15">
            <CalendarClock size={32} className="text-indigo-300" />
          </div>
          <p className="max-w-xs text-sm leading-6 text-slate-400">
            Crunch builds an adaptive spaced-repetition study plan from your exam dates + syllabi, reading your flashcard mastery + grades.
          </p>
          <button
            onClick={() => setShowSetup(true)}
            className="flex items-center gap-2 rounded-2xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white active:scale-[.98]"
          >
            <Sparkles size={16} /> Set up my exams
          </button>
        </div>
      )}

      {/* Plan view */}
      {data && (
        <>
          {/* Stats */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/[.05] p-3 text-center">
              <p className="text-2xl font-bold text-white">{data.stats.examCount}</p>
              <p className="text-[11px] text-slate-400">Exams</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[.05] p-3 text-center">
              <p className="text-2xl font-bold text-white">{data.stats.topicCount}</p>
              <p className="text-[11px] text-slate-400">Topics</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[.05] p-3 text-center">
              <p className={`text-2xl font-bold ${behindPct >= 20 ? "text-amber-400" : "text-white"}`}>{behindPct}%</p>
              <p className="text-[11px] text-slate-400">Behind</p>
            </div>
          </div>

          {/* Behind alert */}
          {behindPct >= 20 && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <TrendingDown size={16} /> You're {behindPct}% behind. Catch up!
            </div>
          )}

          {/* Next exam */}
          {data.stats.nextExamName && data.stats.nextExamDays !== null && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3">
              <GraduationCap size={18} className="text-indigo-300" />
              <div>
                <p className="text-sm font-semibold text-white">{data.stats.nextExamName}</p>
                <p className="text-[11px] text-slate-400">in {data.stats.nextExamDays} day{data.stats.nextExamDays === 1 ? "" : "s"}</p>
              </div>
            </div>
          )}

          {/* Today's tasks */}
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Today</h2>
            {todayDay && todayDay.tasks.length > 0 && !todayDay.tasks.every((t) => t.done) && (
              <button
                onClick={() => completeDay(todayDay.date)}
                className="rounded-lg bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-300"
              >
                Complete all
              </button>
            )}
          </div>

          {!todayDay || todayDay.tasks.length === 0 ? (
            <MobileEmpty text="No tasks scheduled for today." />
          ) : (
            <div className="mb-6 space-y-2">
              {todayDay.tasks.map((task) => (
                <MobileTaskRow
                  key={task.id}
                  task={task}
                  topicLabel={topicById(task.topicId)?.label ?? "Exam day"}
                  examName={examName(task.examId)}
                  mastery={topicById(task.topicId)?.mastery ?? -1}
                  onToggle={toggleTask}
                />
              ))}
            </div>
          )}

          {/* Upcoming days */}
          <h2 className="mb-2 text-sm font-semibold text-white">Upcoming</h2>
          {upcomingDays.length === 0 ? (
            <MobileEmpty text="No upcoming tasks." />
          ) : (
            <div className="space-y-3">
              {upcomingDays.map((day) => (
                <div key={day.date} className="rounded-2xl border border-white/10 bg-white/[.04] p-3.5">
                  <p className="mb-2 text-xs font-semibold text-slate-300">
                    {new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </p>
                  {day.tasks.length === 0 ? (
                    <p className="text-xs text-slate-500">No tasks.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {day.tasks.map((task) => (
                        <MobileTaskRow
                          key={task.id}
                          task={task}
                          topicLabel={topicById(task.topicId)?.label ?? "Exam day"}
                          examName={examName(task.examId)}
                          mastery={topicById(task.topicId)?.mastery ?? -1}
                          onToggle={toggleTask}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Edit button */}
          <button
            onClick={() => { setShowSetup(true); void load(); }}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[.05] px-4 py-3 text-sm text-slate-300"
          >
            <RefreshCw size={16} /> Regenerate plan
          </button>
        </>
      )}
    </MobileContainer>
  );
}

function MobileTaskRow({
  task,
  topicLabel,
  examName,
  mastery,
  onToggle,
}: {
  task: CrunchDayTask;
  topicLabel: string;
  examName: string;
  mastery: number;
  onToggle: (taskId: string, done: boolean) => void;
}) {
  const meta = TASK_TYPE_META[task.type] ?? TASK_TYPE_META.new;
  const Icon = meta.icon;
  const isExamDay = task.topicId === "exam-day";
  return (
    <button
      onClick={() => onToggle(task.id, !task.done)}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
        task.done ? "border-emerald-500/20 bg-emerald-500/5" : "border-white/10 bg-white/[.03]"
      }`}
    >
      {task.done ? <CheckCircle2 size={18} className="shrink-0 text-emerald-400" /> : <Circle size={18} className="shrink-0 text-slate-500" />}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.color}20`, color: meta.color }}>
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${task.done ? "text-slate-500 line-through" : "text-white"}`}>
          {isExamDay ? `${examName} — Exam day` : topicLabel}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span style={{ color: meta.color }}>{meta.label}</span>
          {!isExamDay && <span>{examName}</span>}
          {mastery >= 0 && <span>{Math.round(mastery * 100)}% mastery</span>}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
        <Clock size={11} /> {fmtMinutes(task.duration)}
      </span>
    </button>
  );
}
