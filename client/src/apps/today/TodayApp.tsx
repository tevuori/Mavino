// ===== Today — daily study dashboard =====
// Aggregates today's VUT classes, due tasks, due flashcards, and Pomodoro focus
// stats into a single bento-grid home view. Each card opens the relevant app.

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
  LayoutGrid,
  FileQuestion,
  ChevronRight,
  Sun,
  Wind,
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
const FOCUS_DURATION = 42; // minutes shown on the focus card

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

  const totalHabits = habits.length;
  const bestStreak = Math.max(0, ...habitStats.map((s) => s.currentStreak ?? 0));

  // Pick the next upcoming class/event for the hero card
  const upcoming = [...todayClasses, ...todayEvents]
    .map((item) => {
      const start = "startTime" in item ? item.startTime : new Date(item.start).toTimeString().slice(0, 5);
      return { ...item, start };
    })
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  const focusMinutes = pomoStats.totalFocusMinutes;
  const focusGoal = 120;
  const focusProgress = Math.min(100, Math.round((focusMinutes / focusGoal) * 100));

  return (
    <div className="h-full overflow-y-auto bg-surface/50 p-6 @container">
      <div className="w-full">
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
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 rounded-xl glass px-3 py-2 sm:flex">
              <Sun size={16} className="text-amber-400" />
              <span className="text-xs text-ink-muted">18°C Clear</span>
              <Wind size={14} className="text-ink-muted/50" />
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
          {/* Continue studying */}
          <div className="col-span-1 flex flex-col gap-5 @lg:col-span-2 @2xl:col-span-2">
            <div className="glass-panel p-5">
              <div className="mb-4 flex items-center gap-2 text-accent">
                <BookOpen size={16} />
                <span className="text-xs font-semibold uppercase tracking-wide">Continue studying</span>
              </div>
              <div className="flex flex-col gap-5 @lg:flex-row @lg:items-center">
                <div className="flex items-center gap-5">
                  <div className="relative flex h-32 w-32 shrink-0 items-center justify-center">
                    <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="44" fill="none" stroke="rgb(var(--surface-3))" strokeWidth="8" />
                      <circle
                        cx="50"
                        cy="50"
                        r="44"
                        fill="none"
                        stroke="rgb(var(--accent))"
                        strokeWidth="8"
                        strokeDasharray={276}
                        strokeDashoffset={276 * (1 - focusProgress / 100)}
                        strokeLinecap="round"
                        className="drop-shadow-[0_0_10px_rgba(var(--accent),0.5)]"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-ink">{focusProgress}%</span>
                      <span className="text-[10px] text-ink-muted">Your progress</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-bold text-ink">{upcoming ? ("courseName" in upcoming ? upcoming.courseName : upcoming.title) : "Operating Systems"}</h2>
                    <p className="text-sm text-ink-muted">
                      {upcoming
                        ? "startTime" in upcoming
                          ? `Upcoming class at ${upcoming.startTime}`
                          : `Upcoming event at ${new Date(upcoming.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                        : "Exam in 6 days · 22 Aug"}
                    </p>
                    <div className="mt-3 space-y-2">
                      {[
                        { label: "Process Scheduling", value: 40 },
                        { label: "Synchronization", value: 55 },
                        { label: "Memory Management", value: 66 },
                      ].map((area) => (
                        <div key={area.label} className="flex items-center gap-3 text-xs">
                          <span className="w-28 text-ink-muted">{area.label}</span>
                          <div className="h-1.5 flex-1 rounded-full bg-surface-3">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-accent to-violet-300"
                              style={{ width: `${area.value}%` }}
                            />
                          </div>
                          <span className="w-6 text-right text-ink">{area.value}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-edge/40 bg-surface/40 p-4 @lg:max-w-[340px]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
                      <FileText size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">operating_systems.pdf</p>
                      <p className="text-[11px] text-ink-muted">68% read · Last opened today</p>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-ink-muted">
                    “The scheduler selects one of the processes in the ready queue and allocates the CPU to it...”
                  </p>
                  <p className="text-[10px] text-ink-muted/70">Page 142</p>
                </div>
              </div>
              <button
                onClick={() => openApp("study", "Study Hub", "GraduationCap")}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent to-violet-600 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Continue studying
                <ArrowRight size={16} />
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
              <StatCard
                icon={<Timer size={18} />}
                label="Focus Time Today"
                value={`${Math.floor(focusMinutes / 60)}h ${focusMinutes % 60}m`}
                trend={focusMinutes > 0 ? `+${focusMinutes}m from yesterday` : undefined}
                accent="text-sky-400"
                onClick={() => openApp("pomodoro", "Pomodoro", "Timer")}
              />
              <StatCard
                icon={<FileText size={18} />}
                label="Notes Created"
                value={String(sourceCount)}
                trend={sourceCount > 0 ? "+4 new notes" : undefined}
                accent="text-violet-400"
                onClick={() => openApp("notes", "Notes", "StickyNote")}
              />
              <StatCard
                icon={<Brain size={18} />}
                label="Flashcards Reviewed"
                value={String(totalDue)}
                trend="87% correct"
                accent="text-emerald-400"
                onClick={() => openApp("flashcards", "Flashcards", "Brain")}
              />
              <StatCard
                icon={<Flame size={18} />}
                label="Streak"
                value={`${bestStreak} day${bestStreak === 1 ? "" : "s"}`}
                trend={totalHabits > 0 ? "Keep it up!" : undefined}
                accent="text-orange-400"
                onClick={() => openApp("habits", "Habits", "Flame")}
              />
            </div>

            {/* Recommended */}
            <div className="glass-panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Recommended for you</span>
              </div>
              <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                <RecCard
                  title="Review flashcards"
                  subtitle={dueDecks[0]?.deckName || "Operating Systems"}
                  detail={`${dueDecks[0]?.dueCount || 23} cards due`}
                  icon={<Brain size={22} />}
                  color="from-violet-500 to-fuchsia-500"
                  onClick={() => openApp("flashcards", "Flashcards", "Brain")}
                />
                <RecCard
                  title="Practice quiz"
                  subtitle="Process Scheduling"
                  detail="8 questions"
                  icon={<FileQuestion size={22} />}
                  color="from-emerald-500 to-teal-500"
                  onClick={() => openApp("study", "Study Hub", "GraduationCap", { mode: "quiz" })}
                />
                <RecCard
                  title="Read summary"
                  subtitle="Virtual Memory"
                  detail="7 min read"
                  icon={<FileText size={22} />}
                  color="from-sky-500 to-blue-500"
                  onClick={() => openApp("study", "Study Hub", "GraduationCap", { mode: "summarize" })}
                />
                <RecCard
                  title="Watch video"
                  subtitle="Synchronization"
                  detail="12 min"
                  icon={<Play size={22} />}
                  color="from-rose-500 to-pink-500"
                  onClick={() => openApp("study", "Study Hub", "GraduationCap", { mode: "podcast" })}
                />
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="col-span-1 flex flex-col gap-5 @lg:col-span-1 @2xl:col-span-2">
            {/* Today's schedule */}
            <div className="glass-panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-accent">
                  <Calendar size={16} />
                  <span className="text-xs font-semibold uppercase tracking-wide">Today</span>
                </div>
                <span className="text-[11px] text-ink-muted">{todayClasses.length + todayEvents.length} events</span>
              </div>
              <div className="space-y-3">
                {loading ? (
                  <div className="space-y-2">
                    <div className="h-10 animate-pulse rounded-xl bg-surface-3/60" />
                    <div className="h-10 animate-pulse rounded-xl bg-surface-3/60" />
                  </div>
                ) : todayClasses.length === 0 && todayEvents.length === 0 ? (
                  <p className="py-4 text-center text-sm text-ink-muted">
                    {vutStatus && !vutStatus.authenticated
                      ? "VUT not connected — open VUT to log in"
                      : "No events today"}
                  </p>
                ) : (
                  [...todayClasses, ...todayEvents]
                    .sort((a, b) => {
                      const aTime = "startTime" in a ? a.startTime : new Date(a.start).toISOString();
                      const bTime = "startTime" in b ? b.startTime : new Date(b.start).toISOString();
                      return aTime.localeCompare(bTime);
                    })
                    .map((slot, i) => (
                      <div key={i} className="flex items-start gap-3 border-l-2 border-accent/40 pl-3">
                        <div className="w-12 shrink-0 pt-0.5 text-xs font-semibold text-ink">
                          {"startTime" in slot ? slot.startTime : new Date(slot.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
                  <p className="py-4 text-center text-sm text-ink-muted">Nothing due — you&apos;re all caught up</p>
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

            {/* Focus Session */}
            <div className="glass-panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Focus Session</span>
                <span className="text-xs text-ink-muted">Deep work</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-4xl font-bold text-ink">{FOCUS_DURATION}:00</span>
                  <span className="text-xs text-ink-muted">{pomoStats.completedFocus} sessions today</span>
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
                      strokeDashoffset={0}
                      strokeLinecap="round"
                      className="drop-shadow-[0_0_8px_rgba(var(--accent),0.5)]"
                    />
                  </svg>
                </div>
              </div>
              <button
                onClick={() => openApp("pomodoro", "Pomodoro", "Timer", { autoStart: true, phase: "focus" })}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 glow-sm"
              >
                <Play size={16} />
                Start focus
              </button>
            </div>

            {/* Quick Actions */}
            <div className="glass-panel p-5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Quick Actions</div>
              <div className="grid grid-cols-2 gap-2">
                <QuickAction icon={<Sparkles size={16} />} label="Ask Mavino" sub="Ask anything" onClick={() => openApp("athena", "Mavino", "Sparkles")} />
                <QuickAction icon={<Brain size={16} />} label="Flashcards" sub="Review now" onClick={() => openApp("flashcards", "Flashcards", "Brain")} />
                <QuickAction icon={<FileText size={16} />} label="Summarize" sub="Long text / PDF" onClick={() => openApp("study", "Study Hub", "GraduationCap", { mode: "summarize" })} />
                <QuickAction icon={<FileQuestion size={16} />} label="Generate Quiz" sub="From notes" onClick={() => openApp("study", "Study Hub", "GraduationCap", { mode: "quiz" })} />
                <QuickAction icon={<BookOpen size={16} />} label="Study Hub" sub="My workspace" onClick={() => openApp("study", "Study Hub", "GraduationCap")} />
                <QuickAction icon={<LayoutGrid size={16} />} label="Customize" sub="Arrange widgets" onClick={() => openApp("settings", "Settings", "Settings")} />
              </div>
            </div>

            {/* Recent Activity */}
            <div className="glass-panel p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Recent Activity</span>
                <button
                  onClick={() => openApp("study", "Study Hub", "GraduationCap")}
                  className="flex items-center gap-0.5 text-[11px] text-accent transition hover:underline"
                >
                  View all activity
                  <ChevronRight size={11} />
                </button>
              </div>
              <div className="space-y-3">
                {dueDecks.slice(0, 3).map((d) => (
                  <div key={d.deckId} className="flex items-center gap-3 text-sm text-ink">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
                      <Brain size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.deckName}</p>
                      <p className="text-[10px] text-ink-muted">{d.dueCount} cards due</p>
                    </div>
                  </div>
                ))}
                {todayEvents.slice(0, 2).map((ev) => (
                  <div key={ev.id} className="flex items-center gap-3 text-sm text-ink">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
                      <Calendar size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{ev.title}</p>
                      <p className="text-[10px] text-ink-muted">
                        {new Date(ev.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
                {dueDecks.length === 0 && todayEvents.length === 0 && (
                  <p className="py-2 text-sm text-ink-muted">No recent activity</p>
                )}
              </div>
            </div>
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
  trend,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend?: string;
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
        {trend && <p className="text-[10px] text-emerald-400">{trend}</p>}
      </div>
    </button>
  );
}

function RecCard({
  title,
  subtitle,
  detail,
  icon,
  color,
  onClick,
}: {
  title: string;
  subtitle: string;
  detail: string;
  icon: React.ReactNode;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-4 rounded-2xl border border-edge/40 bg-surface/40 p-4 text-left transition hover:bg-white/[0.04]"
    >
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white shadow-lg`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ink-muted">{subtitle}</p>
      </div>
      <span className="text-[10px] text-ink-muted">{detail}</span>
      <div className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink transition group-hover:bg-accent group-hover:text-white">
        Start
      </div>
    </button>
  );
}

function QuickAction({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-1 rounded-xl border border-edge/30 bg-surface/40 p-3 text-left transition hover:border-accent/30 hover:bg-white/[0.04]"
    >
      <div className="text-accent">{icon}</div>
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span className="text-[10px] text-ink-muted">{sub}</span>
    </button>
  );
}
