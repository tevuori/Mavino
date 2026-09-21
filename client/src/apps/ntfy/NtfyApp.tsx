// ===== Ntfy app =====
// Bidirectional Athena communication channel + cron-job manager.
// Tabs: Setup (config + test), Messages (log + manual send), Cron (jobs).

import { useState, useEffect, useCallback } from "react";
import {
  Bell, Send, RefreshCw, Plus, Trash2, Play, Check, X, Clock, Settings as Cog,
} from "lucide-react";
import { ntfyApi } from "../../services/ntfy";
import { useDataRefreshVersion } from "../../store/dataRefresh";
import { confirmDialog } from "../../store/mobileDialog";
import type { NtfyStatus, NtfyMessage, NtfyCronJob, NtfyCronInput } from "../../services/ntfy";

type Tab = "setup" | "messages" | "cron";

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

export default function NtfyApp() {
  const [tab, setTab] = useState<Tab>("setup");
  const [status, setStatus] = useState<NtfyStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await ntfyApi.getStatus();
      setStatus(s);
      // If not configured, default to setup tab.
      if (!s.configured) setTab("setup");
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const configured = status?.configured ?? false;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <TabBtn icon={<Cog size={15} />} label="Setup" active={tab === "setup"} onClick={() => setTab("setup")} />
        <TabBtn icon={<Bell size={15} />} label="Messages" active={tab === "messages"} onClick={() => setTab("messages")} disabled={!configured} />
        <TabBtn icon={<Clock size={15} />} label="Cron Jobs" active={tab === "cron"} onClick={() => setTab("cron")} disabled={!configured} />
        <div className="ml-auto flex items-center gap-2 pr-1 pb-2">
          {configured ? (
            <span className={`text-xs px-2 py-0.5 rounded-full ${status?.enabled ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-zinc-500/15 text-zinc-500"}`}>
              {status?.enabled ? "Connected" : "Disabled"}
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">Not configured</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-400">Loading…</div>
        ) : tab === "setup" ? (
          <SetupTab status={status} onSaved={refreshStatus} />
        ) : tab === "messages" ? (
          <MessagesTab />
        ) : (
          <CronTab />
        )}
      </div>
    </div>
  );
}

function TabBtn({ icon, label, active, onClick, disabled }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors ${
        active
          ? "border-indigo-500 text-indigo-600 dark:text-indigo-400 font-medium"
          : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------- Setup tab ----------

function SetupTab({ status, onSaved }: { status: NtfyStatus | null; onSaved: () => void }) {
  const [serverUrl, setServerUrl] = useState(status?.serverUrl || "https://ntfy.sh");
  const [token, setToken] = useState("");
  const [notifyTopic, setNotifyTopic] = useState(status?.notifyTopic || "");
  const [inboxTopic, setInboxTopic] = useState(status?.inboxTopic || "");
  const [enabled, setEnabled] = useState(status?.enabled ?? true);
  const [defaultPriority, setDefaultPriority] = useState(status?.defaultPriority ?? 3);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (status) {
      setServerUrl(status.serverUrl || "https://ntfy.sh");
      setNotifyTopic(status.notifyTopic || "");
      setInboxTopic(status.inboxTopic || "");
      setEnabled(status.enabled);
      setDefaultPriority(status.defaultPriority);
    }
  }, [status]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await ntfyApi.saveConfig({
        serverUrl,
        token: token || undefined, // only send if user typed one
        notifyTopic,
        inboxTopic,
        enabled,
        defaultPriority,
      });
      setMsg({ kind: "ok", text: "Saved. Inbox subscriber restarted." });
      setToken("");
      onSaved();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog("Remove Ntfy configuration? This stops the inbox subscriber.", { danger: true, confirmLabel: "Remove" }))) return;
    try {
      await ntfyApi.deleteConfig();
      setMsg({ kind: "ok", text: "Configuration removed." });
      onSaved();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Delete failed" });
    }
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      await ntfyApi.test();
      setMsg({ kind: "ok", text: "Test notification sent to your notify topic." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const notifyUrl = `${serverUrl.replace(/\/+$/, "")}/${notifyTopic}`;
  const inboxUrl = `${serverUrl.replace(/\/+$/, "")}/${inboxTopic}`;

  return (
    <div className="p-5 max-w-full @5xl:max-w-2xl mx-auto space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Bell size={18} /> Ntfy Setup</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ntfy is a bidirectional channel: Mavino sends you push notifications and you can message
          Mavino from your phone. Subscribe to the <b>notify</b> topic in the ntfy app to receive
          Mavino's messages; publish to the <b>inbox</b> topic to talk to Mavino.
        </p>
      </div>

      <Field label="Server URL">
        <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://ntfy.sh"
          className="inp" />
      </Field>

      <Field label="Access token (optional)">
        <div className="flex gap-2">
          <input value={token} onChange={(e) => setToken(e.target.value)} type={showToken ? "text" : "password"}
            placeholder="tk_… (leave empty if your topics are public)" className="inp flex-1" />
          <button onClick={() => setShowToken((s) => !s)} className="btn-ghost">{showToken ? "Hide" : "Show"}</button>
        </div>
      </Field>

      <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
        <Field label="Notify topic (Mavino → you)">
          <input value={notifyTopic} onChange={(e) => setNotifyTopic(e.target.value)} placeholder="mavino-notify-…" className="inp" />
          {notifyTopic && <p className="mt-1 text-xs text-zinc-400 break-all">Subscribe to: {notifyUrl}</p>}
        </Field>
        <Field label="Inbox topic (you → Mavino)">
          <input value={inboxTopic} onChange={(e) => setInboxTopic(e.target.value)} placeholder="mavino-inbox-…" className="inp" />
          {inboxTopic && <p className="mt-1 text-xs text-zinc-400 break-all">Send to: {inboxUrl}</p>}
        </Field>
      </div>

      <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
        <Field label="Default priority">
          <select value={defaultPriority} onChange={(e) => setDefaultPriority(Number(e.target.value))} className="inp">
            {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Enabled">
          <label className="flex items-center gap-2 pt-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" />
            <span className="text-sm">Listen for inbound messages on the inbox topic</span>
          </label>
        </Field>
      </div>

      {msg && (
        <div className={`text-sm rounded-md px-3 py-2 ${msg.kind === "ok" ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save configuration"}
        </button>
        <button onClick={test} disabled={testing || !status?.configured} className="btn-ghost">
          {testing ? "Sending…" : "Send test notification"}
        </button>
        {status?.configured && (
          <button onClick={remove} className="btn-danger-ghost">Remove</button>
        )}
      </div>

      <style>{`
        .inp { width: 100%; padding: 0.5rem 0.6rem; border-radius: 0.5rem; border: 1px solid rgb(212 212 216); background: transparent; font-size: 0.875rem; }
        .dark .inp { border-color: rgb(63 63 70); }
        .btn-primary { padding: 0.5rem 1rem; border-radius: 0.5rem; background: rgb(99 102 241); color: white; font-size: 0.875rem; font-weight: 500; }
        .btn-primary:disabled { opacity: 0.6; }
        .btn-ghost { padding: 0.5rem 0.9rem; border-radius: 0.5rem; border: 1px solid rgb(212 212 216); font-size: 0.875rem; }
        .dark .btn-ghost { border-color: rgb(63 63 70); }
        .btn-danger-ghost { padding: 0.5rem 0.9rem; border-radius: 0.5rem; border: 1px solid rgb(248 113 113); color: rgb(239 68 68); font-size: 0.875rem; }
      `}</style>
    </div>
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

// ---------- Messages tab ----------

function MessagesTab() {
  const [messages, setMessages] = useState<NtfyMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState(3);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ntfyApi.getMessages(100);
      setMessages(res.messages);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    setErr(null);
    try {
      await ntfyApi.send({ title, body, priority });
      setBody("");
      setTitle("");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const dirBadge = (d: string) => {
    if (d === "in") return "bg-sky-500/15 text-sky-600 dark:text-sky-400";
    if (d === "cron") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    return "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400";
  };

  return (
    <div className="p-5 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Messages</h2>
        <button onClick={refresh} className="btn-ghost-sm"><RefreshCw size={14} /> Refresh</button>
      </div>

      {/* Manual send */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
        <div className="text-sm font-medium">Send a notification</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="inp" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message body…" rows={2} className="inp" />
        <div className="flex items-center gap-2">
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="inp w-auto">
            {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
          <button onClick={send} disabled={sending || !body.trim()} className="btn-primary-sm">
            <Send size={14} /> {sending ? "Sending…" : "Send"}
          </button>
        </div>
        {err && <div className="text-xs text-red-500">{err}</div>}
      </div>

      {/* Log */}
      {loading ? (
        <div className="text-sm text-zinc-400 text-center py-8">Loading…</div>
      ) : messages.length === 0 ? (
        <div className="text-sm text-zinc-400 text-center py-8">No messages yet.</div>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => (
            <div key={m.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded-full font-medium ${dirBadge(m.direction)}`}>{m.direction}</span>
                {m.title && <span className="text-sm font-medium">{m.title}</span>}
                <span className="ml-auto text-xs text-zinc-400">{fmtTime(m.createdAt)}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">{m.body}</div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .inp { width: 100%; padding: 0.5rem 0.6rem; border-radius: 0.5rem; border: 1px solid rgb(212 212 216); background: transparent; font-size: 0.875rem; }
        .dark .inp { border-color: rgb(63 63 70); }
        .btn-ghost-sm { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.35rem 0.7rem; border-radius: 0.5rem; border: 1px solid rgb(212 212 216); font-size: 0.8rem; }
        .dark .btn-ghost-sm { border-color: rgb(63 63 70); }
        .btn-primary-sm { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.4rem 0.8rem; border-radius: 0.5rem; background: rgb(99 102 241); color: white; font-size: 0.8rem; }
        .btn-primary-sm:disabled { opacity: 0.6; }
      `}</style>
    </div>
  );
}

// ---------- Cron tab ----------

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: "Every minute", cron: "* * * * *" },
  { label: "Every 30 min", cron: "*/30 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Daily 8am", cron: "0 8 * * *" },
  { label: "Daily 9pm", cron: "0 21 * * *" },
  { label: "Weekdays 8am", cron: "0 8 * * 1-5" },
];

function CronTab() {
  const [jobs, setJobs] = useState<NtfyCronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<NtfyCronJob | null>(null);
  const [showForm, setShowForm] = useState(false);
  const refreshVersion = useDataRefreshVersion("ntfy");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ntfyApi.listCronJobs();
      setJobs(res.jobs);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Refresh when Athena mutates ntfy cron jobs (create/update/delete_cron_job)
  useEffect(() => {
    if (refreshVersion > 0) refresh();
  }, [refreshVersion, refresh]);

  const toggle = async (job: NtfyCronJob) => {
    try {
      await ntfyApi.updateCronJob(job.id, { enabled: !job.enabled });
      refresh();
    } catch { /* ignore */ }
  };

  const runNow = async (job: NtfyCronJob) => {
    try {
      await ntfyApi.runCronJob(job.id);
      refresh();
    } catch { /* ignore */ }
  };

  const del = async (job: NtfyCronJob) => {
    if (!(await confirmDialog(`Delete cron job "${job.name}"?`, { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await ntfyApi.deleteCronJob(job.id);
      refresh();
    } catch { /* ignore */ }
  };

  return (
    <div className="p-5 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cron Jobs</h2>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary-sm">
          <Plus size={14} /> New
        </button>
      </div>

      {showForm && (
        <CronForm
          existing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh(); }}
        />
      )}

      {loading ? (
        <div className="text-sm text-zinc-400 text-center py-8">Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="text-sm text-zinc-400 text-center py-8">
          No cron jobs yet. Click "New" to schedule a notification or a Mavino-driven prompt.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{job.name}</span>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded-full font-medium ${job.type === "athena" ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" : "bg-sky-500/15 text-sky-600 dark:text-sky-400"}`}>{job.type}</span>
                    {!job.enabled && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded-full bg-zinc-500/15 text-zinc-500">paused</span>}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono">{job.cron}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Next: {fmtTime(job.nextRunAt)}{job.lastRunAt ? ` · Last: ${fmtTime(job.lastRunAt)}` : ""}
                  </div>
                  {job.type === "notification" && job.message && (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2">{job.message}</div>
                  )}
                  {job.type === "athena" && job.prompt && (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2 italic">prompt: {job.prompt}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggle(job)} title={job.enabled ? "Pause" : "Enable"} className="icon-btn">
                    {job.enabled ? <Check size={15} className="text-green-500" /> : <X size={15} className="text-zinc-400" />}
                  </button>
                  <button onClick={() => runNow(job)} title="Run now" className="icon-btn"><Play size={14} /></button>
                  <button onClick={() => { setEditing(job); setShowForm(true); }} title="Edit" className="icon-btn"><Cog size={14} /></button>
                  <button onClick={() => del(job)} title="Delete" className="icon-btn"><Trash2 size={14} className="text-red-500" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .btn-primary-sm { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.4rem 0.8rem; border-radius: 0.5rem; background: rgb(99 102 241); color: white; font-size: 0.8rem; }
        .icon-btn { padding: 0.35rem; border-radius: 0.4rem; border: 1px solid rgb(212 212 216); }
        .dark .icon-btn { border-color: rgb(63 63 70); }
        .icon-btn:hover { background: rgb(244 244 245); }
        .dark .icon-btn:hover { background: rgb(39 39 42); }
      `}</style>
    </div>
  );
}

function CronForm({ existing, onClose, onSaved }: {
  existing: NtfyCronJob | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || "");
  const [cron, setCron] = useState(existing?.cron || "0 8 * * *");
  const [type, setType] = useState<"notification" | "athena">(existing?.type as any || "notification");
  const [message, setMessage] = useState(existing?.message || "");
  const [prompt, setPrompt] = useState(existing?.prompt || "");
  const [title, setTitle] = useState(existing?.title || "");
  const [priority, setPriority] = useState(existing?.priority ?? 3);
  const [tags, setTags] = useState(existing?.tags || "");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [preview, setPreview] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const updatePreview = useCallback(async (c: string) => {
    if (!c.trim()) { setPreview([]); return; }
    try {
      const res = await ntfyApi.previewCron(c, 3);
      if ("runs" in res) setPreview(res.runs);
      else setPreview([]);
    } catch {
      setPreview([]);
    }
  }, []);

  useEffect(() => { updatePreview(cron); }, [cron, updatePreview]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    const input: NtfyCronInput = { name, cron, type, message, prompt, title, priority, tags, enabled };
    try {
      if (existing) await ntfyApi.updateCronJob(existing.id, input);
      else await ntfyApi.createCronJob(input);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-indigo-300 dark:border-indigo-700 p-4 space-y-3 bg-indigo-50/30 dark:bg-indigo-950/20">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">{existing ? "Edit cron job" : "New cron job"}</h3>
        <button onClick={onClose} className="icon-btn"><X size={14} /></button>
      </div>

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Job name (e.g. 'Morning summary')" className="inp" />

      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-500">Schedule (5-field cron)</label>
        <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 8 * * *" className="inp font-mono" />
        <div className="flex flex-wrap gap-1 pt-1">
          {CRON_PRESETS.map((p) => (
            <button key={p.cron} onClick={() => setCron(p.cron)}
              className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              {p.label}
            </button>
          ))}
        </div>
        {preview.length > 0 && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 pt-1">
            Next runs: {preview.map((r) => fmtTime(r)).join(" · ")}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-500">Type</label>
        <div className="flex gap-2">
          <button onClick={() => setType("notification")} className={`type-btn ${type === "notification" ? "active" : ""}`}>
            Notification (fixed message)
          </button>
          <button onClick={() => setType("athena")} className={`type-btn ${type === "athena" ? "active" : ""}`}>
            Mavino (LLM-generated)
          </button>
        </div>
      </div>

      {type === "notification" ? (
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message body sent each fire…" rows={3} className="inp" />
      ) : (
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Prompt run through Mavino each fire (e.g. 'Summarize my schedule and due tasks for today')…" rows={3} className="inp" />
      )}

      <div className="grid grid-cols-1 @md:grid-cols-3 gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="inp" />
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="inp">
          {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags (e.g. bell,alarm)" className="inp" />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" />
        Enabled
      </label>

      {err && <div className="text-xs text-red-500">{err}</div>}

      <div className="flex gap-2">
        <button onClick={save} disabled={saving || !name.trim()} className="btn-primary-sm">
          {saving ? "Saving…" : existing ? "Update" : "Create"}
        </button>
        <button onClick={onClose} className="btn-ghost-sm">Cancel</button>
      </div>

      <style>{`
        .inp { width: 100%; padding: 0.5rem 0.6rem; border-radius: 0.5rem; border: 1px solid rgb(212 212 216); background: transparent; font-size: 0.875rem; }
        .dark .inp { border-color: rgb(63 63 70); background: rgb(24 24 27); }
        .icon-btn { padding: 0.35rem; border-radius: 0.4rem; border: 1px solid rgb(212 212 216); }
        .dark .icon-btn { border-color: rgb(63 63 70); }
        .btn-primary-sm { padding: 0.4rem 0.9rem; border-radius: 0.5rem; background: rgb(99 102 241); color: white; font-size: 0.8rem; }
        .btn-primary-sm:disabled { opacity: 0.6; }
        .btn-ghost-sm { padding: 0.4rem 0.9rem; border-radius: 0.5rem; border: 1px solid rgb(212 212 216); font-size: 0.8rem; }
        .dark .btn-ghost-sm { border-color: rgb(63 63 70); }
        .type-btn { padding: 0.4rem 0.7rem; border-radius: 0.5rem; border: 1px solid rgb(212 212 216); font-size: 0.8rem; flex: 1; }
        .dark .type-btn { border-color: rgb(63 63 70); }
        .type-btn.active { background: rgb(99 102 241); color: white; border-color: rgb(99 102 241); }
      `}</style>
    </div>
  );
}
