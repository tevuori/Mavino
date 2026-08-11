import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, FilePlus2, ListPlus, Loader2, Mic, Play, Sparkles, Timer } from "lucide-react";
import { useAuth } from "../store/auth";
import { tasksApi } from "../services/tasks";
import { calendarApi } from "../services/calendar";
import { flashcardsApi } from "../services/flashcards";
import type { CalendarEvent, Task } from "../types";
import type { MobileRoute } from "../shell/mobile/MobileShell";
import type { MobileTool } from "./MobileLauncher";
import type { MobileToolPayload } from "./MobileToolPage";

export default function MobileHome({
  onNavigate,
  onOpenTool,
}: {
  onNavigate: (route: MobileRoute) => void;
  onOpenTool: (tool: MobileTool, payload?: MobileToolPayload) => void;
}) {
  const user = useAuth((s) => s.user);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [due, setDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Pull-to-refresh state
  const startYRef = useRef<number | null>(null);
  const [pullDist, setPullDist] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const [taskResult, eventResult, cardResult] = await Promise.all([
      tasksApi.list().catch(() => null),
      calendarApi.feed(start.toISOString(), end.toISOString()).catch(() => null),
      flashcardsApi.getDue().catch(() => null),
    ]);
    setTasks(taskResult?.tasks ?? []);
    setEvents(eventResult?.events ?? []);
    setDue(cardResult?.totalDue ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // Pull-to-refresh: only trigger when scrolled to top.
  const onTouchStart = (e: React.TouchEvent) => {
    if ((containerRef.current?.scrollTop ?? 0) <= 0) {
      startYRef.current = e.touches[0].clientY;
    } else {
      startYRef.current = null;
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    const dist = e.touches[0].clientY - startYRef.current;
    if (dist > 0) setPullDist(Math.min(dist * 0.5, 64));
  };
  const onTouchEnd = () => {
    if (pullDist > 48) void doRefresh();
    setPullDist(0);
    startYRef.current = null;
  };

  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  const firstName = (user?.displayName || user?.username || "").trim().split(/\s+/)[0];
  const openTasks = tasks.filter((task) => task.status !== "DONE").sort((a, b) => Number(a.priority === "HIGH") - Number(b.priority === "HIGH")).slice(0, 3);
  const nextEvent = useMemo(() => [...events].sort((a, b) => +new Date(a.start) - +new Date(b.start))[0], [events]);

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="mx-auto min-w-0 max-w-md px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]"
    >
      {/* Pull-to-refresh indicator */}
      <div className="flex items-center justify-center overflow-hidden transition-[height] duration-200" style={{ height: pullDist }}>
        <Loader2 size={20} className={`text-accent ${refreshing || pullDist > 8 ? "animate-spin" : ""}`} />
      </div>

      <header className="mb-7 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-accent">{greeting}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">{firstName ? `Hello, ${firstName}` : "Hello"}</h1>
          <p className="mt-2 text-sm text-ink-muted">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-sm font-bold text-accent-fg shadow-lg shadow-accent/30">{(firstName.slice(0, 1) || "A").toUpperCase()}</div>
      </header>

      <section className="mb-6 rounded-3xl border border-accent/20 bg-gradient-to-br from-accent/25 to-accent/5 p-5 shadow-xl shadow-black/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-accent">Your next step</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">{nextEvent?.title || "Create a focused plan"}</h2>
            <p className="mt-1 text-sm text-ink-muted">{nextEvent ? new Date(nextEvent.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Turn your priorities into progress."}</p>
          </div>
          <Timer className="text-accent" size={27} />
        </div>
        <button type="button" onClick={() => onNavigate("calendar")} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-fg px-4 py-3 text-sm font-semibold text-accent active:scale-[.98]">
          View today <ChevronRight size={17} />
        </button>
      </section>

      <section className="mb-7">
        <p className="mb-3 text-sm font-semibold text-ink-muted">Quick actions</p>
        <div className="grid grid-cols-4 gap-2">
          <QuickAction icon={<ListPlus size={21} />} label="Task" onClick={() => onNavigate("tasks")} />
          <QuickAction icon={<FilePlus2 size={21} />} label="Note" onClick={() => onOpenTool("notes")} />
          <QuickAction icon={<Play size={21} />} label="Focus" onClick={() => onOpenTool("focus")} />
          <QuickAction icon={<Mic size={21} />} label="Voice" onClick={() => onOpenTool("voice")} />
        </div>
      </section>

      <section className="space-y-3">
        <SectionHead title="Today" action="See tasks" onClick={() => onNavigate("tasks")} />
        {loading ? <LoadingCard /> : openTasks.length ? openTasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onNavigate("tasks")}
            className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-4 text-left active:bg-surface-3"
          >
            <CheckCircle2 size={20} className={task.priority === "HIGH" ? "text-rose-400" : "text-ink-muted"} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{task.title}</span>
            <ChevronRight size={17} className="text-ink-muted" />
          </button>
        )) : <Empty text="Your task list is clear. Add something worth doing." />}
        <SectionHead title="Study pulse" action="Open Mavino" onClick={() => onNavigate("athena")} />
        <div className="grid grid-cols-2 gap-3">
          <Pulse label="Flashcards due" value={due} icon={<BookOpen size={18} />} onClick={() => onOpenTool("flashcards")} />
          <Pulse label="Open tasks" value={tasks.filter((task) => task.status !== "DONE").length} icon={<Sparkles size={18} />} onClick={() => onNavigate("tasks")} />
        </div>
      </section>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-edge bg-surface-2 text-ink active:scale-[.97] active:bg-surface-3">
      <span className="text-accent">{icon}</span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
function SectionHead({ title, action, onClick }: { title: string; action: string; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between pt-2">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <button type="button" onClick={onClick} className="text-sm font-medium text-accent">{action}</button>
    </div>
  );
}
function Pulse({ label, value, icon, onClick }: { label: string; value: number; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-2xl border border-edge bg-surface-2 p-4 text-left active:bg-surface-3">
      <div className="mb-5 text-accent">{icon}</div>
      <p className="text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{label}</p>
    </button>
  );
}
function LoadingCard() { return <div className="h-14 animate-pulse rounded-2xl bg-surface-3" />; }
function Empty({ text }: { text: string }) { return <p className="rounded-2xl border border-dashed border-edge px-4 py-5 text-sm leading-6 text-ink-muted">{text}</p>; }
