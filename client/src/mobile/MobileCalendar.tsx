import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { calendarApi } from "../services/calendar";
import type { CalendarEvent } from "../types";
import {
  MobileButton, MobileContainer, MobileEmpty, MobileFab, MobileInput, MobileModal, MobileTextarea,
} from "./MobileUi";
import { useMobileDialog } from "../store/mobileDialog";
import { useMobileToast } from "../store/mobileToast";
import { usePullToRefresh } from "./usePullToRefresh";

type ViewMode = "agenda" | "day" | "month";
const EVENT_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#ef4444"];

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtKey(d: Date) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

export default function MobileCalendar() {
  const [view, setView] = useState<ViewMode>("agenda");
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor state
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startDt, setStartDt] = useState("");
  const [endDt, setEndDt] = useState("");
  const [color, setColor] = useState(EVENT_COLORS[0]);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const { confirm } = useMobileDialog();
  const toast = useMobileToast((s) => s.show);
  const loadRef = useRef<() => Promise<void>>();

  // Agenda: 14-day window starting at cursor
  const agendaStart = useMemo(() => startOfDay(cursor), [cursor]);
  const agendaEnd = useMemo(() => addDays(agendaStart, 14), [agendaStart]);

  // Day view bounds
  const dayStart = useMemo(() => startOfDay(cursor), [cursor]);
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart]);

  // Month view bounds
  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor]);
  const monthEnd = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999), [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    let from: string, to: string;
    if (view === "agenda") { from = agendaStart.toISOString(); to = agendaEnd.toISOString(); }
    else if (view === "month") { from = monthStart.toISOString(); to = monthEnd.toISOString(); }
    else { from = dayStart.toISOString(); to = dayEnd.toISOString(); }
    const result = await calendarApi.feed(from, to).catch(() => null);
    setEvents((result?.events ?? []).sort((a, b) => +new Date(a.start) - +new Date(b.start)));
    setLoading(false);
  }, [view, agendaStart, agendaEnd, dayStart, dayEnd, monthStart, monthEnd]);

  loadRef.current = load;
  const { pullDist, refreshing, touchHandlers, pullIndicatorStyle } = usePullToRefresh(
    useCallback(async () => { await loadRef.current?.(); }, []),
  );

  useEffect(() => { void load(); }, [load]);

  const openEditor = (event?: CalendarEvent) => {
    if (event) {
      setEditing(event);
      setTitle(event.title);
      setAllDay(event.allDay);
      setStartDt(new Date(event.start).toISOString().slice(0, 16));
      setEndDt(new Date(event.end).toISOString().slice(0, 16));
      setColor(event.color || EVENT_COLORS[0]);
      setLocation(event.location ?? "");
      setDescription(event.description ?? "");
    } else {
      // New event defaulting to cursor at 09:00
      setEditing(null);
      const base = new Date(cursor);
      base.setHours(9, 0, 0, 0);
      const end = new Date(base.getTime() + 60 * 60 * 1000);
      setTitle("");
      setAllDay(false);
      setStartDt(base.toISOString().slice(0, 16));
      setEndDt(end.toISOString().slice(0, 16));
      setColor(EVENT_COLORS[0]);
      setLocation("");
      setDescription("");
    }
    setEditorOpen(true);
  };

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const payload: Partial<CalendarEvent> = {
      title: title.trim(),
      allDay,
      start: new Date(startDt).toISOString(),
      end: new Date(endDt).toISOString(),
      color,
      location: location.trim(),
      description: description.trim(),
    };
    try {
      if (editing) {
        const res = await calendarApi.update(editing.id, payload);
        if (res?.event) setEvents((list) => list.map((e) => (e.id === res.event.id ? res.event : e)));
      } else {
        const res = await calendarApi.create(payload);
        if (res?.event) setEvents((list) => [...list, res.event]);
      }
      setEditorOpen(false);
    } catch {
      /* ignore */
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!editing) return;
    if (!(await confirm("Delete this event?"))) return;
    await calendarApi.delete(editing.id).catch(() => { toast("Failed to delete event", "error"); });
    setEvents((list) => list.filter((e) => e.id !== editing.id));
    setEditorOpen(false);
  };

  // Group events by day for agenda view
  const agendaGroups = useMemo(() => {
    const groups: { date: Date; events: CalendarEvent[] }[] = [];
    for (let i = 0; i < 14; i++) {
      const date = addDays(agendaStart, i);
      const dayEvents = events.filter((e) => sameDay(new Date(e.start), date));
      if (dayEvents.length) groups.push({ date, events: dayEvents });
    }
    return groups;
  }, [events, agendaStart]);

  const dayEvents = useMemo(() => events.filter((e) => sameDay(new Date(e.start), dayStart)), [events, dayStart]);

  return (
    <MobileContainer {...touchHandlers}>
      <div className="flex items-center justify-center overflow-hidden transition-[height] duration-200" style={pullIndicatorStyle}>
        <Loader2 size={20} className={`text-accent ${refreshing || pullDist > 8 ? "animate-spin" : ""}`} />
      </div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-accent">Keep the day clear</p>
          <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight text-ink">Calendar</h1>
        </div>
        <MobileFab onClick={() => openEditor()} icon={<Plus size={22} />} label="New event" />
      </header>

      {/* View toggle */}
      <div className="mb-4 flex justify-center">
        <div className="inline-flex rounded-full border border-edge bg-surface-2 p-1">
          <button type="button" onClick={() => setView("agenda")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${view === "agenda" ? "brand-gradient text-white" : "text-ink-muted"}`}>Agenda</button>
          <button type="button" onClick={() => setView("day")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${view === "day" ? "brand-gradient text-white" : "text-ink-muted"}`}>Day</button>
          <button type="button" onClick={() => setView("month")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${view === "month" ? "brand-gradient text-white" : "text-ink-muted"}`}>Month</button>
        </div>
      </div>

      {/* Date navigation */}
      <div className="mb-5 flex items-center justify-between rounded-2xl border border-edge bg-surface-2 p-2">
        <button type="button" onClick={() => setCursor((d) => view === "agenda" ? addDays(d, -14) : view === "month" ? new Date(d.getFullYear(), d.getMonth() - 1, 1) : addDays(d, -1))} className="flex h-9 w-9 items-center justify-center rounded-xl text-ink active:bg-surface-3" aria-label="Previous">
          <ChevronLeft size={20} />
        </button>
        <button type="button" onClick={() => setCursor(new Date())} className="rounded-xl px-4 py-2 text-sm font-semibold text-ink">
          {view === "agenda"
            ? `${agendaStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(agendaStart, 13).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
            : view === "month"
            ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
            : cursor.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
        </button>
        <button type="button" onClick={() => setCursor((d) => view === "agenda" ? addDays(d, 14) : view === "month" ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : addDays(d, 1))} className="flex h-9 w-9 items-center justify-center rounded-xl text-ink active:bg-surface-3" aria-label="Next">
          <ChevronRight size={20} />
        </button>
      </div>

      {loading ? (
        <div className="h-16 animate-pulse rounded-2xl bg-surface-3" />
      ) : view === "agenda" ? (
        agendaGroups.length ? (
          <div className="space-y-5">
            {agendaGroups.map(({ date, events: dayEvts }) => (
              <div key={fmtKey(date)}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                </p>
                <div className="space-y-2">
                  {dayEvts.map((event) => (
                    <EventCard key={event.id} event={event} onClick={() => openEditor(event)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <MobileEmpty text="No events in the next two weeks. Tap + to add one." />
        )
      ) : view === "month" ? (
        <MonthGrid
          year={cursor.getFullYear()}
          month={cursor.getMonth()}
          events={events}
          onSelectDay={(d) => { setCursor(d); setView("day"); }}
        />
      ) : dayEvents.length ? (
        <div className="space-y-2">
          {dayEvents.map((event) => (
            <EventCard key={event.id} event={event} onClick={() => openEditor(event)} />
          ))}
        </div>
      ) : (
        <MobileEmpty text="Nothing scheduled today. Tap + to add an event." />
      )}

      {/* Event editor */}
      <MobileModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? "Edit event" : "New event"}
        footer={
          <>
            {editing && <MobileButton variant="danger" onClick={() => void remove()}><Trash2 size={16} /> Delete</MobileButton>}
            <MobileButton variant="ghost" onClick={() => setEditorOpen(false)}>Cancel</MobileButton>
            <MobileButton onClick={() => void save()} disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save"}</MobileButton>
          </>
        }
      >
        <label className="block text-xs font-medium text-ink-muted">Title</label>
        <MobileInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" />
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 rounded border-edge" />
          All day
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-muted">Starts</label>
            <input type={allDay ? "date" : "datetime-local"} value={allDay ? startDt.slice(0, 10) : startDt} onChange={(e) => setStartDt(e.target.value)} className="w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none focus:border-accent/60" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted">Ends</label>
            <input type={allDay ? "date" : "datetime-local"} value={allDay ? endDt.slice(0, 10) : endDt} onChange={(e) => setEndDt(e.target.value)} className="w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none focus:border-accent/60" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted">Color</label>
          <div className="flex gap-2">
            {EVENT_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className={`h-8 w-8 rounded-full border-2 ${color === c ? "border-ink" : "border-transparent"}`} style={{ backgroundColor: c }} aria-label="Pick color" />
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted">Location</label>
          <MobileInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add location" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted">Description</label>
          <MobileTextarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add details…" rows={3} />
        </div>
      </MobileModal>
    </MobileContainer>
  );
}

function EventCard({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-2xl border border-edge bg-surface-2 p-4 text-left active:bg-surface-3">
      <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: event.color || "#818cf8" }} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{event.title}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
          <Clock size={12} />
          {event.allDay
            ? "All day"
            : `${new Date(event.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(event.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </p>
        {event.location && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
            <MapPin size={12} /> {event.location}
          </p>
        )}
      </div>
    </button>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthGrid({
  year,
  month,
  events,
  onSelectDay,
}: {
  year: number;
  month: number;
  events: CalendarEvent[];
  onSelectDay: (d: Date) => void;
}) {
  const today = new Date();
  const isToday = (d: Date) => sameDay(d, today);

  // Build the grid: weeks start on Monday
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // 0=Sun,1=Mon...6=Sat → shift so Monday=0
  const startDow = (firstOfMonth.getDay() + 6) % 7;

  // Map events by day key
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const key = fmtKey(new Date(ev.start));
    const list = eventsByDay.get(key);
    if (list) list.push(ev);
    else eventsByDay.set(key, [ev]);
  }

  // Build 6-week grid (42 cells)
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length < 42) cells.push(null);

  return (
    <div className="rounded-2xl border border-edge bg-surface-2 p-3">
      <div className="mb-2 grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} className="aspect-square" />;
          const dayEvts = eventsByDay.get(fmtKey(date)) ?? [];
          const isT = isToday(date);
          return (
            <button
              key={date.getDate()}
              type="button"
              onClick={() => onSelectDay(date)}
              className={`flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition active:bg-surface-3 ${
                isT ? "bg-accent font-bold text-white" : "text-ink hover:bg-surface-3"
              }`}
            >
              {date.getDate()}
              {dayEvts.length > 0 && (
                <div className="mt-0.5 flex gap-0.5">
                  {dayEvts.slice(0, 3).map((ev, j) => (
                    <span
                      key={j}
                      className="h-1 w-1 rounded-full"
                      style={{ backgroundColor: ev.color || "#818cf8" }}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
