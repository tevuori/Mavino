import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, MessageSquare, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { ntfyApi, type NtfyConfigInput, type NtfyCronJob, type NtfyMessage, type NtfyStatus } from "../services/ntfy";
import { MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileInput, MobileLoading, MobileSelect, MobileTextarea } from "./MobileUi";

type Tab = "status" | "messages" | "send" | "cron";

export default function MobileNtfy({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>("messages");

  return (
    <MobileContainer>
      <MobileHeader title="Ntfy" subtitle="Messages & automations" onClose={onClose} />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {(["messages", "send", "cron", "status"] as const).map((t) => (
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

      {tab === "messages" && <NtfyMessages />}
      {tab === "send" && <NtfySend onSent={() => setTab("messages")} />}
      {tab === "cron" && <NtfyCron />}
      {tab === "status" && <NtfyStatusView />}
    </MobileContainer>
  );
}

function NtfyMessages() {
  const [messages, setMessages] = useState<NtfyMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await ntfyApi.getMessages(50).catch(() => null);
    setMessages(res?.messages ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => void load()} className="rounded-xl p-2 text-ink-muted">
          <RefreshCw size={18} />
        </button>
      </div>
      {loading ? <MobileLoading /> : messages.length ? messages.map((m) => (
        <article key={m.id} className="rounded-2xl border border-edge bg-surface-2 p-4">
          <div className="flex items-start gap-3">
            <div className={`shrink-0 pt-0.5 ${m.direction === "out" ? "text-accent" : "text-emerald-400"}`}>
              {m.direction === "out" ? <Send size={18} /> : <MessageSquare size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{m.title}</p>
              <p className="mt-1 text-sm text-ink-muted">{m.body}</p>
              <p className="mt-2 text-[11px] text-ink-muted">{m.topic} · P{m.priority}</p>
            </div>
          </div>
        </article>
      )) : <MobileEmpty text="No ntfy messages yet." />}
    </div>
  );
}

function NtfySend({ onSent }: { onSent: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState(3);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!body.trim()) return;
    setSending(true);
    await ntfyApi.send({ title: title.trim() || undefined, body: body.trim(), priority }).catch(() => {});
    setSending(false);
    setTitle(""); setBody(""); setPriority(3);
    onSent();
  };

  return (
    <div>
      <MobileInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="mb-3" />
      <MobileTextarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message body" rows={4} className="mb-3" />
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-ink-muted">Priority (1-5)</label>
        <MobileInput type="number" min={1} max={5} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
      </div>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={sending || !body.trim()}
        className="w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-ink disabled:opacity-50"
      >
        {sending ? "Sending…" : "Send message"}
      </button>
    </div>
  );
}

function NtfyCron() {
  const [jobs, setJobs] = useState<NtfyCronJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await ntfyApi.listCronJobs().catch(() => null);
    setJobs(res?.jobs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (job: NtfyCronJob) => {
    await ntfyApi.updateCronJob(job.id, { enabled: !job.enabled }).catch(() => {});
    void load();
  };

  const run = async (job: NtfyCronJob) => {
    await ntfyApi.runCronJob(job.id).catch(() => {});
  };

  const remove = async (job: NtfyCronJob) => {
    if (!window.confirm(`Delete ${job.name}?`)) return;
    await ntfyApi.deleteCronJob(job.id).catch(() => {});
    void load();
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => void load()} className="rounded-xl p-2 text-ink-muted">
          <RefreshCw size={18} />
        </button>
      </div>
      {loading ? <MobileLoading /> : jobs.length ? jobs.map((job) => (
        <article key={job.id} className="rounded-2xl border border-edge bg-surface-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{job.name}</p>
              <p className="text-xs text-ink-muted">{job.cron}</p>
              <p className="mt-1 text-[11px] text-ink-muted">{job.type} · {job.enabled ? "enabled" : "paused"}</p>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => void toggle(job)} className="rounded-xl p-2 text-ink-muted">
                <Bell size={18} />
              </button>
              <button type="button" onClick={() => void run(job)} className="rounded-xl p-2 text-ink-muted">
                <Send size={18} />
              </button>
              <button type="button" onClick={() => void remove(job)} className="rounded-xl p-2 text-ink-muted active:text-rose-400">
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        </article>
      )) : <MobileEmpty text="No cron jobs configured." />}
    </div>
  );
}

function NtfyStatusView() {
  const [status, setStatus] = useState<NtfyStatus | null>(null);
  const [config, setConfig] = useState<NtfyConfigInput>({});

  const load = useCallback(async () => {
    const res = await ntfyApi.getStatus().catch(() => null);
    if (res) {
      setStatus(res);
      setConfig({
        serverUrl: res.serverUrl,
        notifyTopic: res.notifyTopic,
        inboxTopic: res.inboxTopic,
        defaultPriority: res.defaultPriority,
        enabled: res.enabled,
      });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    await ntfyApi.saveConfig(config).catch(() => {});
    void load();
  };

  if (!status) return <MobileLoading />;

  return (
    <div>
      <div className="mb-4 rounded-2xl border border-edge bg-surface-2 p-4 text-center">
        <BellRing size={24} className="mx-auto mb-2 text-accent" />
        <p className="text-sm font-semibold text-ink">{status.enabled ? "Enabled" : "Disabled"}</p>
        <p className="text-xs text-ink-muted">{status.serverUrl}</p>
      </div>

      <MobileInput
        value={config.serverUrl || ""}
        onChange={(e) => setConfig({ ...config, serverUrl: e.target.value })}
        placeholder="Server URL"
        className="mb-3"
      />
      <MobileInput
        value={config.notifyTopic || ""}
        onChange={(e) => setConfig({ ...config, notifyTopic: e.target.value })}
        placeholder="Notify topic"
        className="mb-3"
      />
      <MobileInput
        value={config.inboxTopic || ""}
        onChange={(e) => setConfig({ ...config, inboxTopic: e.target.value })}
        placeholder="Inbox topic"
        className="mb-3"
      />
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-ink-muted">Default priority</label>
        <MobileInput
          type="number"
          value={config.defaultPriority ?? 3}
          onChange={(e) => setConfig({ ...config, defaultPriority: Number(e.target.value) })}
        />
      </div>
      <div className="mb-4 flex items-center gap-2">
        <input
          id="ntfy-enabled"
          type="checkbox"
          checked={!!config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          className="h-5 w-5 rounded border-edge bg-surface-2 text-accent"
        />
        <label htmlFor="ntfy-enabled" className="text-sm text-ink-muted">Enabled</label>
      </div>
      <button
        type="button"
        onClick={() => void save()}
        className="w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-ink"
      >
        Save config
      </button>
    </div>
  );
}
