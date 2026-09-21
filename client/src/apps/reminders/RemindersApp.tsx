// ===== Reminders app =====
// One-shot ntfy-delivered reminders. Two types:
//   - "basic":  pushes a fixed message at fireAt (no LLM).
//   - "athena": runs a prompt through Athena at fireAt and pushes the reply.
// Sections: Pending (with countdown), Fired history, Cancelled, plus a
// "New reminder" form. Reminders can also be created via Athena chat.

import { useState, useEffect, useCallback } from "react";
import {
  BellRing, Plus, Trash2, X, Clock, Sparkles, RefreshCw, Check,
} from "lucide-react";
import { remindersApi } from "../../services/reminders";
import type { Reminder, ReminderInput, ReminderStatus } from "../../services/reminders";
import { confirmDialog } from "../../store/mobileDialog";

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
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** "in 3 min" / "in 2 hr 15 min" / "fired 5 min ago" / "overdue 10 min". */
function relativeTime(iso: string, now: number): { text: string; overdue: boolean } {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return { text: iso, overdue: false };
  const diff = t - now;
  const abs = Math.abs(diff);
  const overdue = diff < 0;
  const mins = Math.round(abs / 60000);
  if (mins < 1) return { text: overdue ? "just now" : "in <1 min", overdue };
  if (mins < 60) return { text: `${overdue ? "" : "in "}${mins} min${mins === 1 ? "" : "s"}${overdue ? " ago" : ""}`, overdue };
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  const hrLabel = `${hrs} hr${hrs === 1 ? "" : "s"}`;
  const minLabel = rem ? ` ${rem} min` : "";
  return { text: `${overdue ? "" : "in "}${hrLabel}${minLabel}${overdue ? " ago" : ""}`, overdue };
}

export default function RemindersApp() {
  const [tab, setTab] = useState<Tab>("pending");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refreshKey, setRefreshKey] = useState(0);

  const statusForTab: ReminderStatus =
    tab === "pending" ? "pending" : tab === "fired" ? "fired" : tab === "cancelled" ? "cancelled" : "pending";

  const refresh = useCallback(async () => {
    if (tab === "new") { setLoading(false); return; }
    setLoading(true);
    setErr(null);
    try {
      const res = await remindersApi.list(statusForTab);
      setReminders(res.reminders);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load reminders");
    } finally {
      setLoading(false);
    }
  }, [statusForTab, tab]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  // Live countdown for pending reminders.
  useEffect(() => {
    if (tab !== "pending") return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [tab]);

  const onCancel = async (id: string) => {
    try {
      await remindersApi.cancel(id);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancel failed");
    }
  };

  const onDelete = async (id: string) => {
    if (!(await confirmDialog("Delete this reminder permanently?", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await remindersApi.delete(id);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-3 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <TabBtn icon={<Clock size={15} />} label="Pending" active={tab === "pending"} onClick={() => setTab("pending")} />
        <TabBtn icon={<Check size={15} />} label="Fired" active={tab === "fired"} onClick={() => setTab("fired")} />
        <TabBtn icon={<X size={15} />} label="Cancelled" active={tab === "cancelled"} onClick={() => setTab("cancelled")} />
        <div className="ml-auto flex items-center gap-1 pr-1 pb-2">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => setTab("new")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md bg-indigo-500 text-white hover:bg-indigo-600"
          >
            <Plus size={15} /> New
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {err && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 text-sm">
            {err}
          </div>
        )}
        {tab === "new" ? (
          <NewReminderForm
            onCreated={() => { setTab("pending"); setRefreshKey((k) => k + 1); }}
            onCancel={() => setTab("pending")}
          />
        ) : loading ? (
          <div className="p-8 text-center text-sm text-zinc-400">Loading…</div>
        ) : reminders.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="p-4 space-y-2 @3xl:grid @3xl:grid-cols-2 @3xl:gap-3 @3xl:space-y-0">
            {reminders.map((r) => (
              <ReminderCard
                key={r.id}
                reminder={r}
                now={now}
                showCountdown={tab === "pending"}
                onCancel={() => onCancel(r.id)}
                onDelete={() => onDelete(r.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors ${
        active
          ? "border-indigo-500 text-indigo-600 dark:text-indigo-400 font-medium"
          : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const msg =
    tab === "pending" ? "No pending reminders. Ask Mavino to \"remind me to …\" or click New."
    : tab === "fired" ? "No fired reminders yet."
    : tab === "cancelled" ? "No cancelled reminders."
    : "";
  return (
    <div className="p-10 text-center text-sm text-zinc-400">
      <BellRing size={32} className="mx-auto mb-2 opacity-40" />
      {msg}
    </div>
  );
}

function ReminderCard({ reminder, now, showCountdown, onCancel, onDelete }: {
  reminder: Reminder;
  now: number;
  showCountdown: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const isAthena = reminder.type === "athena";
  const { text: relText, overdue } = relativeTime(reminder.fireAt, now);
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-3">
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 shrink-0 ${isAthena ? "text-indigo-500" : "text-amber-500"}`}>
          {isAthena ? <Sparkles size={16} /> : <BellRing size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">
              {reminder.title || (isAthena ? "(smart reminder)" : reminder.message.slice(0, 40) || "(reminder)")}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              isAthena
                ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            }`}>
              {isAthena ? "smart" : "basic"}
            </span>
            {reminder.priority >= 4 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 font-medium">
                P{reminder.priority}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Clock size={11} className="inline -mt-0.5 mr-1" />
            {fmtTime(reminder.fireAt)}
            {showCountdown && (
              <span className={`ml-2 ${overdue ? "text-red-500" : "text-zinc-400"}`}>
                · {relText}
              </span>
            )}
            {reminder.fired && reminder.firedAt && (
              <span className="ml-2 text-green-500">· fired {fmtTime(reminder.firedAt)}</span>
            )}
            {reminder.cancelled && <span className="ml-2 text-zinc-400">· cancelled</span>}
          </div>
          {(isAthena ? reminder.prompt : reminder.message) && (
            <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300 line-clamp-3 whitespace-pre-wrap">
              {isAthena ? `Prompt: ${reminder.prompt}` : reminder.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!reminder.fired && !reminder.cancelled && (
            <button
              onClick={onCancel}
              className="p-1.5 rounded-md text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10"
              title="Cancel reminder"
            >
              <X size={15} />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10"
            title="Delete reminder"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- New reminder form ----------

function NewReminderForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [type, setType] = useState<"basic" | "athena">("basic");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [fireAt, setFireAt] = useState(() => {
    // Default: 1 hour from now, in local datetime-local format.
    const d = new Date(Date.now() + 3600000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
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
    <div className="p-5 max-w-full @5xl:max-w-2xl mx-auto space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold flex items-center gap-2"><BellRing size={18} /> New Reminder</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          A one-shot reminder pushed to your phone via ntfy at the chosen time.{" "}
          <b>Basic</b> sends a fixed message; <b>Smart</b> runs a prompt through Mavino at fire time
          (so it can reference what's actually due that day). Requires ntfy to be configured.
        </p>
      </div>

      <div className="flex gap-2">
        <TypeBtn active={type === "basic"} onClick={() => setType("basic")} icon={<BellRing size={15} />} label="Basic" />
        <TypeBtn active={type === "athena"} onClick={() => setType("athena")} icon={<Sparkles size={15} />} label="Smart (LLM)" />
      </div>

      <Field label="Title (optional)">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call mom" className="inp" />
      </Field>

      {type === "basic" ? (
        <Field label="Message">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
            placeholder="The exact message pushed at fire time (e.g. 'Call mom')" className="inp" />
        </Field>
      ) : (
        <Field label="Prompt (run through Mavino at fire time)">
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
            placeholder="e.g. 'Remind the user to prep for their exam. Check today's calendar and due tasks, then write a 2-3 sentence reminder naming what to focus on.'" className="inp" />
        </Field>
      )}

      <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
        <Field label="Fire at">
          <input type="datetime-local" value={fireAt} onChange={(e) => setFireAt(e.target.value)} className="inp" />
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="inp">
            {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Tags (optional, comma-separated)">
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. bell,alarm_clock" className="inp" />
      </Field>

      {err && <div className="px-3 py-2 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{err}</div>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Schedule reminder"}
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm rounded-md btn-ghost">Cancel</button>
      </div>
    </div>
  );
}

function TypeBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
        active
          ? "border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
          : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
