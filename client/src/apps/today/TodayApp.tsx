// ===== Home — daily study dashboard =====
// Shows only real, supported Mavino features: today's schedule (VUT classes +
// calendar events), tasks, flashcards due, focus stats, habits, and quick
// links to Study Hub modes. No fake data, no unsupported features (weather,
// video playback, hardcoded course progress, etc.).

import { useState, useEffect, useCallback } from "react";
import {
  CalendarCheck,
  Timer,
  Brain,
  CheckSquare,
  Play,
  RefreshCw,
  ArrowRight,
  AlertCircle,
  Calendar,
  Flame,
  Check,
  FileText,
  Sparkles,
  BookOpen,
  ChevronRight,
  MessageSquare,
  Lightbulb,
  HelpCircle,
  Mic,
  Presentation,
  ListTodo,
} from "lucide-react";
import { useWindows, type AppId } from "../../store/windows";
import { useAuth } from "../../store/auth";
import { tasksApi, PRIORITY_LABELS, PRIORITY_COLORS } from "../../services/tasks";
import { flashcardsApi } from "../../services/flashcards";
import { vutApi } from "../../services/vut";
import { calendarApi } from "../../services/calendar";
import { habitsApi } from "../../services/habits";
import { studySourcesApi } from "../../services/study-sources";
import type { Task, VutTimetableSlot, CalendarEvent, Habit, HabitStats } from "../../types";

interface DueDeck {
  deckId: string;
  deckName: string;
  deckColor: string;
  dueCount: number;
}

interface PomodoroStats {
  completedFocus: number;
  totalFocusMinutes: number;
  date: string;
}

interface VutStatus {
  configured: boolean;
  authenticated: boolean;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadPomodoroStats(): PomodoroStats {
  try {
    const raw = localStorage.getItem("pomodoro-stats");
    if (raw) {
      const stats = JSON.parse(raw) as PomodoroStats;
      if (stats.date === todayKey()) return stats;
    }
  } catch {
    /* ignore */
  }
  return { completedFocus: 0, totalFocusMinutes: 0, date: todayKey() };
}

function isOverdue(t: Task): boolean {
  if (!t.dueDate || t.status === "DONE") return false;
  const due = new Date(t.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

function isDueToday(t: Task): boolean {
  if (!t.dueDate || t.status === "DONE") return false;
  return t.dueDate.slice(0, 10) === todayKey();
}

const PRIORITY_RANK: Record<Task["priority"], number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export default function TodayApp() {
  const openWindow = useWindows((s) => s.open);
  const user = useAuth((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dueDecks, setDueDecks] = useState<DueDeck[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [todayClasses, setTodayClasses] = useState<VutTimetableSlot[]>([]);
  const [vutStatus, setVutStatus] = useState<VutStatus | null>(null);
  const [pomoStats, setPomoStats] = useState<PomodoroStats>(loadPomodoroStats);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitStats, setHabitStats] = useState<HabitStats[]>([]);
  const [sourceCount, setSourceCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    const today = new Date().getDay();
    const todayIndex = today === 0 ? 6 : today - 1;

    const statusPromise = vutApi.status().catch(() => null);

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);

    const [tasksRes, dueRes, statusRes, feedRes, habitsRes, habitStatsRes, sourcesRes] = await Promise.all([
      tasksApi.list().catch(() => null),
      flashcardsApi.getDue().catch(() => null),
      statusPromise,
      calendarApi.feed(dayStart.toISOString(), dayEnd.toISOString()).catch(() => null),
      habitsApi.list().catch(() => null),
      habitsApi.stats().catch(() => null),
      studySourcesApi.list().catch(() => null),
    ]);

    if (tasksRes?.tasks) setTasks(tasksRes.tasks);
    if (dueRes) {
      setDueDecks(
        dueRes.decks
          .filter((d: { dueCount: number }) => d.dueCount > 0)
          .map((d: { deckId: string; deckName: string; deckColor: string; dueCount: number }) => ({
            deckId: d.deckId,
            deckName: d.deckName,
            deckColor: d.deckColor,
            dueCount: d.dueCount,
          }))
      );
      setTotalDue(dueRes.totalDue ?? 0);
    }
    if (feedRes?.events) setTodayEvents(feedRes.events);
    if (habitsRes?.habits) setHabits(habitsRes.habits);
    if (habitStatsRes?.stats) setHabitStats(habitStatsRes.stats);
    if (sourcesRes?.sources) setSourceCount(sourcesRes.sources.length);
    const st = statusRes as VutStatus | null;
    setVutStatus(st);
    if (st?.authenticated) {
      const tt = await vutApi.timetable().catch(() => null);
      if (tt?.slots) {
        setTodayClasses(
          tt.slots
            .filter((s: { dayIndex: number }) => s.dayIndex === todayIndex)
            .sort((a: { startTime: string }, b: { startTime: string }) => a.startTime.localeCompare(b.startTime))
        );
      }
    } else {
      setTodayClasses([]);
    }
    setPomoStats(loadPomodoroStats());
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const openApp = (appId: AppId, title: string, icon: string, payload?: Record<string, unknown>) => {
    openWindow({ appId, title, icon, payload });
  };

  const overdueTasks = tasks.filter(isOverdue);
  const dueTodayTasks = tasks.filter(isDueToday);
  const activeTasks = tasks.filter((t) => t.status !== "DONE" && !isOverdue(t) && !isDueToday(t));
  const taskList = [...overdueTasks, ...dueTodayTasks, ...activeTasks]
    .sort((a, b) => {
      const aDue = isOverdue(a) || isDueToday(a) ? 0 : 1;
      const bDue = isOverdue(b) || isDueToday(b) ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    })
    .slice(0, 6);
  const taskCount = tasks.filter((t) => t.status !== "DONE").length;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const bestStreak = Math.max(0, ...habitStats.map((s) => s.currentStreak ?? 0));
  const habitsCompletedToday = habitStats.filter((s) => s.last30?.includes(todayKey())).length;

  const focusMinutes = pomoStats.totalFocusMinutes;
  const focusGoal = 120;
  const focusProgress = Math.min(100, Math.round((focusMinutes / focusGoal) * 100));

  const scheduleItems = [...todayClasses, ...todayEvents]
    .map((item) => {
      const start = "startTime" in item ? item.startTime : new Date(item.start).toTimeString().slice(0, 5);
      return { ...item, start };
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  const studyModes = [
    { mode: "chat", label: "Ask (grounded)", icon: MessageSquare, desc: "Q&A with citations", color: "text-sky-400" },
    { mode: "summarize", label: "Summarize", icon: FileText, desc: "TL;DR & key points", color: "text-violet-400" },
    { mode: "quiz", label: "Quiz Me", icon: HelpCircle, desc: "AI-graded test", color: "text-emerald-400" },
    { mode: "flashcards", label: "Flashcards", icon: Brain, desc: "Generate Q/A cards", color: "text-amber-400" },
    { mode: "teach", label: "Teach Me", icon: Presentation, desc: "Interactive tutoring", color: "text-fuchsia-400" },
    { mode: "podcast", label: "Podcast", icon: Mic, desc: "Audio overview", color: "text-orange-400" },
    { mode: "explain", label: "Explain", icon: Lightbulb, desc: "Concept at any depth", color: "text-yellow-400" },
    { mode: "syllabus", label: "Syllabus → Tasks", icon: ListTodo, desc: "Extract tasks", color: "text-rose-400" },
  ];

  return (
    <div className="h-full overflow-y-auto bg-surface/50 p-6 @container">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-accent">
              <CalendarCheck size={18} />
              <span className="text-xs font-semibold uppercase tracking-wide">Home</span>
            </div>
            <h1 className="mt-1 text-3xl font-bold text-ink">
              {greeting}{(user?.displayName || user?.username) ? `, ${user.displayName || user.username}` : ""}
            </h1>
            <p className="text-sm text-ink-muted">{dateStr}</p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl glass px-3 py-2 text-xs text-ink-muted transition hover:bg-white/[0.06] disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>{lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </button>
        </div>

        {/* Assistant prompt */}
        <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl glass-panel p-4">
          <div className="flex items-center gap-4">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full orb-glow">
              <div className="absolute inset-0 rounded-full orb-ring" />
              <div className="absolute inset-1 rounded-full bg-accent/20" />
              <Sparkles size={22} className="relative text-accent text-glow" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">I can help you study, plan and stay focused.</p>
              <p className="text-xs text-ink-muted">Ask Mavino anything about your courses, tasks or notes.</p>
            </div>
          </div>
          <button
            onClick={() => openApp("athena", "Mavino", "Sparkles")}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/90 glow-sm"
          >
            Ask Mavino
          </button>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 gap-5 @lg:grid-cols-3 @2xl:grid-cols-4">
          {/* Left column: schedule + tasks */}
          <div className="col-span-1 flex flex-col gap-5 @lg:col-span-2 @2xl:col-span-2">
            {/* Today's schedule */}
            <div className="glass-panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-accent">
                  <Calendar size={16} />
                  <span className="text-xs font-semibold uppercase tracking-wide">Today's Schedule</span>
                </div>
                <span className="text-[11px] text-ink-muted">{scheduleItems.length} events</span>
              </div>
              <div className="space-y-3">
                {loading ? (
                  <div className="space-y-2">
                    <div className="h-10 animate-pulse rounded-xl bg-surface-3/60" />
                    <div className="h-10 animate-pulse rounded-xl bg-surface-3/60" />
                  </div>
                ) : scheduleItems.length === 0 ? (
                  <p className="py-4 text-center text-sm text-ink-muted">
                    {vutStatus && !vutStatus.authenticated
                      ? "VUT not connected — open VUT to log in"
                      : "No events today"}
                  </p>
                ) : (
                  scheduleItems.map((slot, i) => (
                    <div key={i} className="flex items-start gap-3 border-l-2 border-accent/40 pl-3">
                      <div className="w-12 shrink-0 pt-0.5 text-xs font-semibold text-ink">
                        {slot.start}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">
                          {"courseName" in slot ? slot.courseName : slot.title}
                        </p>
                        <p className="text-[11px] text-ink-muted">
                          {"room" in slot ? slot.room : slot.location || ""}
                          {"type" in slot && slot.type ? ` · ${slot.type}` : ""}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <button
                onClick={() => openApp("calendar", "Calendar", "Calendar")}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-edge/50 bg-surface/40 py-2 text-xs font-medium text-ink transition hover:bg-white/[0.04]"
              >
                <Calendar size={14} />
                Open calendar
              </button>
            </div>

            {/* Tasks */}
            <div className="glass-panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-accent">
                  <CheckSquare size={16} />
                  <span className="text-xs font-semibold uppercase tracking-wide">Tasks</span>
                </div>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                  {taskCount} remaining
                </span>
              </div>
              <div className="space-y-2">
                {loading ? (
                  <>
                    <div className="h-8 animate-pulse rounded-lg bg-surface-3/60" />
                    <div className="h-8 animate-pulse rounded-lg bg-surface-3/60" />
                  </>
                ) : taskList.length === 0 ? (
                  <p className="py-4 text-center text-sm text-ink-muted">Nothing due — you're all caught up</p>
                ) : (
                  taskList.map((t) => {
                    const overdue = isOverdue(t);
                    const dueToday = isDueToday(t);
                    return (
                      <div
                        key={t.id}
                        onClick={() => openApp("tasks", "Tasks", "CheckSquare")}
                        className="group flex cursor-pointer items-start gap-2.5 rounded-xl border border-edge/30 bg-surface/30 p-2.5 transition hover:border-accent/30 hover:bg-white/[0.03]"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            tasksApi.update(t.id, { status: t.status === "DONE" ? "TODO" : "DONE" }).then(refresh);
                          }}
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                            t.status === "DONE" ? "border-accent bg-accent text-white" : "border-ink-muted/30 hover:border-accent"
                          }`}
                        >
                          {t.status === "DONE" && <Check size={10} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm ${t.status === "DONE" ? "text-ink-muted line-through" : "text-ink"}`}>
                            {t.title}
                          </p>
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_COLORS[t.priority]}`} />
                            <span className="text-ink-muted">{PRIORITY_LABELS[t.priority]}</span>
                            {overdue && (
                              <span className="flex items-center gap-0.5 text-red-400">
                                <AlertCircle size={10} /> Overdue
                              </span>
                            )}
                            {dueToday && <span className="text-amber-400">Due today</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <button
                onClick={() => openApp("tasks", "Tasks", "CheckSquare")}
                className="mt-4 flex items-center gap-1 text-xs font-medium text-accent transition hover:underline"
              >
                View all tasks
                <ChevronRight size={12} />
              </button>
            </div>
          </div>

          {/* Right column: stats + focus + flashcards */}
          <div className="col-span-1 flex flex-col gap-5 @lg:col-span-1 @2xl:col-span-2">
            {/* Stats row */}
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
              <StatCard
                icon={<Timer size={18} />}
                label="Focus Today"
                value={focusMinutes >= 60 ? `${Math.floor(focusMinutes / 60)}h ${focusMinutes % 60}m` : `${focusMinutes}m`}
                sub={`${pomoStats.completedFocus} session${pomoStats.completedFocus === 1 ? "" : "s"}`}
                accent="text-sky-400"
                onClick={() => openApp("pomodoro", "Pomodoro", "Timer")}
              />
              <StatCard
                icon={<FileText size={18} />}
                label="Study Sources"
                value={String(sourceCount)}
                sub={sourceCount === 1 ? "source" : "sources"}
                accent="text-violet-400"
                onClick={() => openApp("study", "Study Hub", "GraduationCap")}
              />
              <StatCard
                icon={<Brain size={18} />}
                label="Flashcards Due"
                value={String(totalDue)}
                sub={totalDue === 0 ? "all caught up" : `${dueDecks.length} deck${dueDecks.length === 1 ? "" : "s"}`}
                accent="text-emerald-400"
                onClick={() => openApp("flashcards", "Flashcards", "Brain")}
              />
              <StatCard
                icon={<Flame size={18} />}
                label="Best Streak"
                value={`${bestStreak}d`}
                sub={habits.length === 0 ? "no habits" : `${habitsCompletedToday}/${habits.length} today`}
                accent="text-orange-400"
                onClick={() => openApp("habits", "Habits", "Flame")}
              />
            </div>

            {/* Focus Session */}
            <div className="glass-panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Focus Session</span>
                <span className="text-xs text-ink-muted">{focusMinutes}/{focusGoal} min today</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-4xl font-bold text-ink">{pomoStats.completedFocus}</span>
                  <span className="text-xs text-ink-muted">sessions today</span>
                </div>
                <div className="relative h-20 w-20">
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="44" fill="none" stroke="rgb(var(--surface-3))" strokeWidth="6" />
                    <circle
                      cx="50"
                      cy="50"
                      r="44"
                      fill="none"
                      stroke="rgb(var(--accent))"
                      strokeWidth="6"
                      strokeDasharray={276}
                      strokeDashoffset={276 * (1 - focusProgress / 100)}
                      strokeLinecap="round"
                      className="drop-shadow-[0_0_8px_rgba(var(--accent),0.5)]"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold text-ink">{focusProgress}%</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => openApp("pomodoro", "Pomodoro", "Timer", { autoStart: true, phase: "focus" })}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 glow-sm"
              >
                <Play size={16} />
                Start focus session
              </button>
            </div>

            {/* Due flashcards */}
            {dueDecks.length > 0 && (
              <div className="glass-panel p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-accent">
                    <Brain size={16} />
                    <span className="text-xs font-semibold uppercase tracking-wide">Flashcards Due</span>
                  </div>
                  <span className="text-[11px] text-ink-muted">{totalDue} cards</span>
                </div>
                <div className="space-y-2">
                  {dueDecks.slice(0, 4).map((d) => (
                    <div
                      key={d.deckId}
                      onClick={() => openApp("flashcards", "Flashcards", "Brain", { deckId: d.deckId })}
                      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-edge/30 bg-surface/30 p-2.5 transition hover:border-accent/30 hover:bg-white/[0.03]"
                    >
                      <div
                        className="h-8 w-2 shrink-0 rounded-full"
                        style={{ background: d.deckColor || "rgb(var(--accent))" }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{d.deckName}</p>
                        <p className="text-[10px] text-ink-muted">{d.dueCount} cards due</p>
                      </div>
                      <ArrowRight size={14} className="text-ink-muted transition group-hover:text-accent" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Study Hub modes — all real, supported features */}
        <div className="mt-5 glass-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-accent">
              <BookOpen size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide">Study Hub</span>
            </div>
            <button
              onClick={() => openApp("study", "Study Hub", "GraduationCap")}
              className="flex items-center gap-0.5 text-[11px] text-accent transition hover:underline"
            >
              Open Study Hub
              <ChevronRight size={11} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
            {studyModes.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.mode}
                  onClick={() => openApp("study", "Study Hub", "GraduationCap", { mode: m.mode })}
                  className="group flex flex-col gap-2 rounded-2xl border border-edge/40 bg-surface/40 p-4 text-left transition hover:border-accent/30 hover:bg-white/[0.04]"
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 ${m.color}`}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">{m.label}</p>
                    <p className="text-[11px] text-ink-muted">{m.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-edge/40 bg-surface/40 p-4 text-left transition hover:bg-white/[0.04]"
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="text-lg font-bold text-ink">{value}</p>
        <p className="text-[10px] text-ink-muted">{sub}</p>
      </div>
    </button>
  );
}
