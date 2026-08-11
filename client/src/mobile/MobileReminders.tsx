import { useCallback, useEffect, useState } from "react";
import { BellRing, Plus, Sparkles, Trash2, X } from "lucide-react";
import { remindersApi } from "../services/reminders";
import type { Reminder, ReminderInput, ReminderStatus } from "../services/reminders";
import { MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileInput, MobileLoading, MobileSelect, MobileTextarea } from "./MobileUi";

type Tab = "pending" | "fired" | "cancelled" | "new";

const PRIORITIES = [
  { v: 1, label: "1 · Min" },
  { v: 2, label: "2 · Low" },
  { v: 3, label: "3 · Default" },
  { v: 4, label: "4 · High" },
  { v: 5, label: "5 · Max" },
];

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function relativeTime(iso: string, now: number): { text: string; overdue: boolean } {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return { text: iso, overdue: false };
  const diff = t - now;
  const abs = Math.abs(diff);
  const overdue = diff < 0;
  const mins = Math.round(abs / 60000);
  if (mins < 1) return { text: overdue ? "just now" : "in <1 min", overdue };
  if (mins < 60) {
    return {
      text: `${overdue ? "" : "in "}${mins} min${mins === 1 ? "" : "s"}${overdue ? " ago" : ""}`,
      overdue,
    };
  }
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  const hrLabel = `${hrs} hr${hrs === 1 ? "" : "s"}`;
  const minLabel = rem ? ` ${rem} min` : "";
  return {
    text: `${overdue ? "" : "in "}${hrLabel}${minLabel}${overdue ? " ago" : ""}`,
    overdue,
  };
}

export default function MobileReminders({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>("pending");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (tab === "new") {
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await remindersApi.list(tab as ReminderStatus).catch(() => null);
    setReminders(res?.reminders ?? []);
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (tab !== "pending") return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [tab]);

  const onCancel = async (id: string) => {
    await remindersApi.cancel(id).catch(() => {});
    setRefreshKey((k) => k + 1);
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("Delete this reminder permanently?")) return;
    await remindersApi.delete(id).catch(() => {});
    setRefreshKey((k) => k + 1);
  };

  if (tab === "new") {
    return <NewReminderForm onCreated={() => { setTab("pending"); setRefreshKey((k) => k + 1); }} onCancel={() => setTab("pending")} />;
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Reminders"
        subtitle="Don't forget"
        onClose={onClose}
        right={<MobileFab onClick={() => setTab("new")} icon={<Plus size={22} />} />}
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {(["pending", "fired", "cancelled"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium capitalize ${
              tab === t ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {loading ? (
          <MobileLoading />
        ) : reminders.length ? (
          reminders.map((r) => (
            <ReminderCard
              key={r.id}
              reminder={r}
              now={now}
              showCountdown={tab === "pending"}
              onCancel={() => void onCancel(r.id)}
              onDelete={() => void onDelete(r.id)}
            />
          ))
        ) : (
          <MobileEmpty text={`No ${tab} reminders. Tap + to schedule one.`} />
        )}
      </div>
    </MobileContainer>
  );
}

function ReminderCard({
  reminder,
  now,
  showCountdown,
  onCancel,
  onDelete,
}: {
  reminder: Reminder;
  now: number;
  showCountdown: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const isAthena = reminder.type === "athena";
  const { text: relText, overdue } = relativeTime(reminder.fireAt, now);
  return (
    <article className="rounded-2xl border border-edge bg-surface-2 p-4">
      <div className="flex items-start gap-3">
        <div className={`shrink-0 pt-0.5 ${isAthena ? "text-accent" : "text-amber-400"}`}>
          {isAthena ? <Sparkles size={18} /> : <BellRing size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">
              {reminder.title || (isAthena ? "Smart reminder" : reminder.message.slice(0, 40) || "Reminder")}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isAthena ? "bg-accent/15 text-accent" : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {isAthena ? "smart" : "basic"}
            </span>
            {reminder.priority >= 4 && (
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                P{reminder.priority}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {fmtTime(reminder.fireAt)}
            {showCountdown && (
              <span className={`ml-2 ${overdue ? "text-rose-400" : "text-ink-muted"}`}>· {relText}</span>
            )}
            {reminder.fired && reminder.firedAt && (
              <span className="ml-2 text-emerald-400">· fired {fmtTime(reminder.firedAt)}</span>
            )}
            {reminder.cancelled && <span className="ml-2 text-ink-muted">· cancelled</span>}
          </p>
          {(isAthena ? reminder.prompt : reminder.message) && (
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-ink-muted">
              {isAthena ? `Prompt: ${reminder.prompt}` : reminder.message}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {!reminder.fired && !reminder.cancelled && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl p-2 text-ink-muted active:text-amber-400"
            >
              <X size={18} />
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="rounded-xl p-2 text-ink-muted active:text-rose-400"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}

function defaultFireAt(): string {
  const d = new Date(Date.now() + 3600000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NewReminderForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [type, setType] = useState<"basic" | "athena">("basic");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [fireAt, setFireAt] = useState(defaultFireAt);
  const [priority, setPriority] = useState(3);
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const iso = new Date(fireAt).toISOString();
    if (isNaN(new Date(fireAt).getTime())) {
      setErr("Invalid date/time.");
      return;
    }
    if (type === "basic" && !message.trim()) {
      setErr("A message is required for a basic reminder.");
      return;
    }
    if (type === "athena" && !prompt.trim()) {
      setErr("A prompt is required for a smart reminder.");
      return;
    }

    const input: ReminderInput = {
      type,
      title: title.trim() || undefined,
      fireAt: iso,
      priority,
      tags: tags.trim() || undefined,
    };
    if (type === "basic") input.message = message.trim();
    else input.prompt = prompt.trim();

    setSaving(true);
    try {
      await remindersApi.create(input);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create reminder");
    } finally {
      setSaving(false);
    }
  };

  return (
    <MobileContainer>
      <MobileHeader title="New reminder" subtitle="Schedule" onBack={onCancel} />

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setType("basic")}
          className={`flex-1 rounded-2xl py-2.5 text-sm font-medium ${
            type === "basic" ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
          }`}
        >
          Basic
        </button>
        <button
          type="button"
          onClick={() => setType("athena")}
          className={`flex-1 rounded-2xl py-2.5 text-sm font-medium ${
            type === "athena" ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
          }`}
        >
          Smart
        </button>
      </div>

      <MobileInput
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="mb-3"
      />

      {type === "basic" ? (
        <MobileTextarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="The message to send at fire time"
          rows={4}
          className="mb-3"
        />
      ) : (
        <MobileTextarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="The prompt Mavino will run when the reminder fires"
          rows={4}
          className="mb-3"
        />
      )}

      <div className="mb-3 grid grid-cols-1 gap-3 @sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Fire at</label>
          <input
            type="datetime-local"
            value={fireAt}
            onChange={(e) => setFireAt(e.target.value)}
            className="w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none focus:border-indigo-400/50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Priority</label>
          <MobileSelect value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {PRIORITIES.map((p) => (
              <option key={p.v} value={p.v}>
                {p.label}
              </option>
            ))}
          </MobileSelect>
        </div>
      </div>

      <MobileInput
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="Tags, comma-separated"
        className="mb-4"
      />

      {err && <p className="mb-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{err}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-2xl bg-surface-2 py-3 text-sm font-medium text-ink-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="flex-1 rounded-2xl bg-accent py-3 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {saving ? "Saving…" : "Schedule"}
        </button>
      </div>
    </MobileContainer>
  );
}
