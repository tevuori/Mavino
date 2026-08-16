// ===== Today — daily study dashboard =====
// Aggregates due tasks, due flashcards (all decks),
// and today's Pomodoro focus stats into a single view. Each card has a
// one-click action that opens the relevant app. Reuses existing client
// services — no new backend.

import { useState, useEffect, useCallback } from "react";
import {
  CalendarCheck,
  Timer,
  Brain,
  CheckSquare,
  GraduationCap,
  Play,
  RefreshCw,
  ArrowRight,
  Clock,
  MapPin,
  AlertCircle,
  Calendar,
  Flame,
  Check,
  Loader2,
  MessageSquare,
  Mic,
  FileText,
} from "lucide-react";
import { useWindows, type AppId } from "../../store/windows";
import { useAuth } from "../../store/auth";
import { tasksApi, PRIORITY_LABELS, PRIORITY_COLORS } from "../../services/tasks";
import { flashcardsApi } from "../../services/flashcards";
import { calendarApi } from "../../services/calendar";
import { habitsApi } from "../../services/habits";
import { studySourcesApi } from "../../services/study-sources";
import { studyChatApi } from "../../services/study-chat";
import { studyPodcastsApi } from "../../services/study-podcasts";
import type { Task, TaskPriority, CalendarEvent, Habit, HabitStats } from "../../types";

const DAYS_FULL = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"];

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

const PRIORITY_RANK: Record<TaskPriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export default function TodayApp() {
  const openWindow = useWindows((s) => s.open);
  const user = useAuth((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dueDecks, setDueDecks] = useState<DueDeck[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [pomoStats, setPomoStats] = useState<PomodoroStats>(loadPomodoroStats);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitStats, setHabitStats] = useState<HabitStats[]>([]);
  const [sourceCount, setSourceCount] = useState(0);
  const [chatCount, setChatCount] = useState(0);
  const [podcastCount, setPodcastCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);

    // Today's calendar range.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);

    const [tasksRes, dueRes, feedRes, habitsRes, habitStatsRes, sourcesRes, chatsRes, podcastsRes] = await Promise.all([
      tasksApi.list().catch(() => null),
      flashcardsApi.getDue().catch(() => null),
      calendarApi.feed(dayStart.toISOString(), dayEnd.toISOString()).catch(() => null),
      habitsApi.list().catch(() => null),
      habitsApi.stats().catch(() => null),
      studySourcesApi.list().catch(() => null),
      studyChatApi.list().catch(() => null),
      studyPodcastsApi.list().catch(() => null),
    ]);

    if (tasksRes?.tasks) setTasks(tasksRes.tasks);
    if (dueRes) {
      setDueDecks(
        dueRes.decks
          .filter((d) => d.dueCount > 0)
          .map((d) => ({
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
    if (chatsRes?.chats) setChatCount(chatsRes.chats.length);
    if (podcastsRes?.podcasts) setPodcastCount(podcastsRes.podcasts.length);
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
  const taskCount = overdueTasks.length + dueTodayTasks.length;

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

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-none @5xl:max-w-3xl p-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-accent">
              <CalendarCheck size={18} />
              <span className="text-xs font-semibold uppercase tracking-wide">Today</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold text-ink">
              {greeting}{(user?.displayName || user?.username) ? `, ${user.displayName || user.username}` : ""}
            </h1>
            <p className="text-sm text-ink-muted">{dateStr}</p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-xs text-ink-muted transition hover:bg-surface-3 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>{lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </button>
        </div>

        {/* Hero — start focus */}
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-edge bg-gradient-to-br from-accent/10 to-surface-2 p-4 @5xl:flex-row @5xl:items-center @5xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Timer size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">Ready to focus?</p>
              <p className="text-xs text-ink-muted">
                {pomoStats.completedFocus} sessions · {pomoStats.totalFocusMinutes} min today
              </p>
            </div>
          </div>
          <button
            onClick={() => openApp("pomodoro", "Pomodoro", "Timer", { autoStart: true, phase: "focus" })}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 @5xl:py-2"
          >
            <Play size={15} />
            Start focus
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Due tasks */}
          <SectionCard
            icon={<CheckSquare size={16} />}
            title="Due Tasks"
            accent="text-amber-500"
            badge={taskCount > 0 ? taskCount : undefined}
            onOpen={() => openApp("tasks", "Tasks", "CheckSquare")}
            openLabel="Open Tasks"
            loading={loading}
            empty="Nothing due — you're all caught up"
          >
            {taskList.map((t) => {
              const overdue = isOverdue(t);
              const dueToday = isDueToday(t);
              return (
                <div key={t.id} className="flex items-start gap-2.5 py-1.5">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_COLORS[t.priority]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{t.title}</p>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-ink-muted">{PRIORITY_LABELS[t.priority]}</span>
                      {overdue && (
                        <span className="flex items-center gap-0.5 text-red-500">
                          <AlertCircle size={10} /> Overdue
                        </span>
                      )}
                      {dueToday && <span className="text-amber-500">Due today</span>}
                      {t.status === "IN_PROGRESS" && (
                        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-ink-muted">In progress</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </SectionCard>

          {/* Due flashcards */}
          <SectionCard
            icon={<Brain size={16} />}
            title="Due Flashcards"
            accent="text-violet-500"
            badge={totalDue > 0 ? totalDue : undefined}
            onOpen={() => openApp("flashcards", "Flashcards", "Brain")}
            openLabel="Review"
            loading={loading}
            empty="No cards due — great job!"
          >
            {dueDecks.map((d) => (
              <div key={d.deckId} className="flex items-center gap-2.5 py-1.5">
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: d.deckColor || "#8b5cf6" }}
                />
                <p className="min-w-0 flex-1 truncate text-sm text-ink">{d.deckName}</p>
                <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-500">
                  {d.dueCount}
                </span>
              </div>
            ))}
            {totalDue > 0 && dueDecks.length === 0 && (
              <p className="py-2 text-sm text-ink-muted">{totalDue} cards due across your decks</p>
            )}
          </SectionCard>

          {/* Focus stats */}
          <SectionCard
            icon={<Timer size={16} />}
            title="Today's Focus"
            accent="text-rose-500"
            onOpen={() => openApp("pomodoro", "Pomodoro", "Timer")}
            openLabel="Open Timer"
            loading={loading}
            empty="No focus sessions yet today"
          >
            <div className="grid grid-cols-2 gap-3 py-1">
              <div className="rounded-lg bg-surface-2 p-3">
                <p className="text-2xl font-bold text-ink">{pomoStats.completedFocus}</p>
                <p className="text-[11px] text-ink-muted">sessions</p>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <p className="text-2xl font-bold text-ink">{pomoStats.totalFocusMinutes}</p>
                <p className="text-[11px] text-ink-muted">focus minutes</p>
              </div>
            </div>
          </SectionCard>

          {/* Today's schedule (Calendar) */}
          <SectionCard
            icon={<Calendar size={16} />}
            title="Today's Schedule"
            accent="text-indigo-500"
            badge={todayEvents.length > 0 ? todayEvents.length : undefined}
            onOpen={() => openApp("calendar", "Calendar", "Calendar")}
            openLabel="Open Calendar"
            loading={loading}
            empty="No events scheduled today"
          >
            {todayEvents
              .slice()
              .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
              .map((ev) => {
                const start = new Date(ev.start);
                const end = new Date(ev.end);
                return (
                  <div key={ev.id} className="flex items-start gap-2.5 py-1.5">
                    <div
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: ev.color || "#6366f1" }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{ev.title}</p>
                      <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          {ev.allDay
                            ? "All day"
                            : `${start.getHours().toString().padStart(2, "0")}:${start.getMinutes().toString().padStart(2, "0")}–${end.getHours().toString().padStart(2, "0")}:${end.getMinutes().toString().padStart(2, "0")}`}
                        </span>
                        {ev.location && (
                          <span className="flex items-center gap-1">
                            <MapPin size={10} />
                            {ev.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </SectionCard>

          {/* Habits */}
          <SectionCard
            icon={<Flame size={16} />}
            title="Habits"
            accent="text-orange-500"
            badge={habits.length > 0 ? habits.length : undefined}
            onOpen={() => openApp("habits", "Habits", "Flame")}
            openLabel="Open Habits"
            loading={loading}
            empty="No habits yet — create one to build streaks"
          >
            {habits.map((h) => {
              const s = habitStats.find((x) => x.habitId === h.id);
              const done = Boolean(s?.last30.includes(todayKey()));
              return (
                <div key={h.id} className="flex items-center gap-2.5 py-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (done) habitsApi.unlog(h.id, todayKey()).then(refresh);
                      else habitsApi.log(h.id, todayKey()).then(refresh);
                    }}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      done ? "border-transparent text-white" : "border-edge text-transparent hover:border-accent"
                    }`}
                    style={done ? { background: h.color } : {}}
                    title={done ? "Done — click to undo" : "Mark done"}
                  >
                    <Check size={13} />
                  </button>
                  <span className="text-base">{h.icon}</span>
                  <p className="min-w-0 flex-1 truncate text-sm text-ink">{h.name}</p>
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    <Flame size={10} className="mr-0.5 inline text-orange-500" />
                    {s?.currentStreak ?? 0}
                  </span>
                </div>
              );
            })}
          </SectionCard>

          {/* Study Hub */}
          <SectionCard
            icon={<GraduationCap size={16} />}
            title="Study Hub"
            accent="text-violet-500"
            badge={sourceCount > 0 ? sourceCount : undefined}
            onOpen={() => openApp("study", "Study Hub", "GraduationCap")}
            openLabel="Open Study Hub"
            loading={loading}
            empty="No sources yet — add notes, files, or URLs to ground your study"
          >
            <button
              onClick={() => openApp("study", "Study Hub", "GraduationCap", { mode: "chat" })}
              className="flex w-full items-center gap-2.5 py-1.5 text-left"
            >
              <MessageSquare size={15} className="shrink-0 text-violet-400" />
              <p className="min-w-0 flex-1 truncate text-sm text-ink">Ask (grounded Q&A)</p>
              {chatCount > 0 && <span className="shrink-0 text-[11px] text-ink-muted">{chatCount}</span>}
              <ArrowRight size={12} className="shrink-0 text-ink-muted" />
            </button>
            <button
              onClick={() => openApp("study", "Study Hub", "GraduationCap", { mode: "podcast" })}
              className="flex w-full items-center gap-2.5 py-1.5 text-left"
            >
              <Mic size={15} className="shrink-0 text-rose-400" />
              <p className="min-w-0 flex-1 truncate text-sm text-ink">Podcast overview</p>
              {podcastCount > 0 && <span className="shrink-0 text-[11px] text-ink-muted">{podcastCount}</span>}
              <ArrowRight size={12} className="shrink-0 text-ink-muted" />
            </button>
            <button
              onClick={() => openApp("study", "Study Hub", "GraduationCap", { mode: "flashcards" })}
              className="flex w-full items-center gap-2.5 py-1.5 text-left"
            >
              <FileText size={15} className="shrink-0 text-indigo-400" />
              <p className="min-w-0 flex-1 truncate text-sm text-ink">Generate flashcards</p>
              <ArrowRight size={12} className="shrink-0 text-ink-muted" />
            </button>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

interface SectionCardProps {
  icon: React.ReactNode;
  title: string;
  accent: string;
  badge?: number;
  onOpen: () => void;
  openLabel: string;
  loading: boolean;
  empty: string;
  emptyAction?: { label: string; onClick: () => void };
  children?: React.ReactNode;
}

function SectionCard({
  icon,
  title,
  accent,
  badge,
  onOpen,
  openLabel,
  loading,
  empty,
  emptyAction,
  children,
}: SectionCardProps) {
  // Count rendered rows to detect emptiness.
  let childCount = 0;
  if (Array.isArray(children)) childCount = children.filter(Boolean).length;
  else if (children) childCount = 1;

  return (
    <div className="flex flex-col rounded-xl border border-edge bg-surface-2/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={accent}>{icon}</span>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {badge !== undefined && (
            <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold text-ink-muted">
              {badge}
            </span>
          )}
        </div>
        <button
          onClick={onOpen}
          className="flex items-center gap-0.5 text-[11px] font-medium text-ink-muted transition hover:text-accent"
        >
          {openLabel}
          <ArrowRight size={11} />
        </button>
      </div>
      <div className="flex-1">
        {loading ? (
          <div className="space-y-2 py-1">
            {[0, 1].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded bg-surface-3/60" />
            ))}
          </div>
        ) : childCount === 0 ? (
          <div className="py-3 text-center">
            <p className="text-sm text-ink-muted">{empty}</p>
            {emptyAction && (
              <button
                onClick={emptyAction.onClick}
                className="mt-2 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90"
              >
                {emptyAction.label}
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-edge/60">{children}</div>
        )}
      </div>
    </div>
  );
}
