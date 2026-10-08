import { useState, useEffect, useCallback } from "react";
import { BellRing, ExternalLink, Loader2, Send } from "lucide-react";
import { proactiveAlertsApi, type ProactiveAlertConfig } from "../../../services/proactive-alerts";
import { ntfyApi } from "../../../services/ntfy";
import { aiApi, type AiKeyStatus } from "../../../services/ai";
import { useWindows } from "../../../store/windows";
import { SectionHeader, Card, Field, ToggleRow, StatusPill, SaveButton, MsgBox, inputClass } from "../ui";

const ALL_CATEGORIES = [
  { id: "calendar", label: "Calendar events" },
  { id: "tasks", label: "Due tasks" },
  { id: "flashcards", label: "Due flashcards" },
  { id: "habits", label: "Habits & streaks" },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export default function ProactiveAlertsSection() {
  return (
    <section id="proactive-alerts" className="mb-8">
      <SectionHeader
        icon={<BellRing size={18} />}
        title="Proactive Alerts"
        description="Let Mavino check your workspace once a day and push a concise briefing to your phone — upcoming exams, due tasks, unreviewed flashcards, and habit streaks."
      />
      <ProactiveAlertsCard />
    </section>
  );
}

function ProactiveAlertsCard() {
  const [cfg, setCfg] = useState<ProactiveAlertConfig | null>(null);
  const [ntfyStatus, setNtfyStatus] = useState<{ configured: boolean; enabled: boolean } | null>(null);
  const [aiStatus, setAiStatus] = useState<AiKeyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const openWindow = useWindows((s) => s.open);

  const refresh = useCallback(async () => {
    try {
      const [c, n, a] = await Promise.all([
        proactiveAlertsApi.getConfig(),
        ntfyApi.getStatus(),
        aiApi.getKeyStatus(),
      ]);
      setCfg(c.config);
      setNtfyStatus({ configured: n.configured, enabled: n.enabled });
      setAiStatus(a);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Local editable state derived from cfg.
  const enabled = cfg?.enabled ?? false;
  const hour = cfg?.hour ?? 8;
  const minute = cfg?.minute ?? 0;
  const categories = (cfg?.categories ?? "calendar,tasks,flashcards,habits")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const customPrompt = cfg?.customPrompt ?? "";

  const setHour = (h: number) => setCfg((c) => (c ? { ...c, hour: h } : c));
  const setMinute = (m: number) => setCfg((c) => (c ? { ...c, minute: m } : c));
  const toggleCategory = (id: string) => {
    setCfg((c) => {
      if (!c) return c;
      const current = c.categories.split(",").map((s) => s.trim()).filter(Boolean);
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      return { ...c, categories: next.join(",") };
    });
  };
  const setCustomPrompt = (p: string) => setCfg((c) => (c ? { ...c, customPrompt: p } : c));

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    setTestResult(null);
    try {
      const res = await proactiveAlertsApi.saveConfig({
        enabled: cfg.enabled,
        hour: cfg.hour,
        minute: cfg.minute,
        categories: cfg.categories,
        customPrompt: cfg.customPrompt,
      });
      setCfg(res.config);
      setMsg("Proactive alert settings saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async () => {
    if (!cfg) return;
    const next = !cfg.enabled;
    setCfg({ ...cfg, enabled: next });
    setBusy(true);
    setErr(false);
    setMsg(null);
    setTestResult(null);
    try {
      const res = await proactiveAlertsApi.saveConfig({ enabled: next });
      setCfg(res.config);
      setMsg(next ? "Proactive alerts enabled." : "Proactive alerts disabled.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to toggle");
      setCfg({ ...cfg, enabled: !next }); // revert
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setErr(false);
    setTestResult(null);
    try {
      const res = await proactiveAlertsApi.test();
      if (res.ok && res.body) {
        setTestResult(res.body);
      } else {
        setErr(true);
        setTestResult(res.error ?? "Failed to generate briefing.");
      }
    } catch (e) {
      setErr(true);
      setTestResult(e instanceof Error ? e.message : "Failed to generate briefing.");
    } finally {
      setTesting(false);
    }
  };

  const ntfyReady = !!ntfyStatus?.configured && !!ntfyStatus?.enabled;
  const athenaReady = !!aiStatus?.hasKey || !!aiStatus?.configured;
  const ready = ntfyReady && athenaReady;

  // Not configured gate.
  if (!ntfyStatus || !cfg) {
    return (
      <Card>
        <Loader2 size={16} className="animate-spin text-ink-muted" />
      </Card>
    );
  }

  if (!ntfyReady) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <BellRing size={18} className="mt-0.5 text-ink-muted" />
          <div className="flex-1">
            <h4 className="mb-1 text-sm font-semibold text-ink">Ntfy not configured</h4>
            <p className="mb-3 text-xs text-ink-muted">
              Proactive alerts are delivered as push notifications through ntfy. Configure ntfy first,
              then come back here to enable daily briefings.
            </p>
            <button
              onClick={() => openWindow({ appId: "ntfy", title: "Ntfy", icon: "Bell" })}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-ink hover:bg-surface-3"
            >
              <ExternalLink size={12} /> Open Ntfy
            </button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <StatusPill on={ntfyReady} onLabel="Ntfy ready" offLabel="Ntfy not configured" />
          <StatusPill
            on={athenaReady}
            onLabel={aiStatus?.hasKey ? "Mavino LLM ready" : "Server LLM fallback"}
            offLabel="No Mavino LLM"
          />
          {!athenaReady && (
            <span className="text-xs text-ink-muted">
              (configure an AI provider in the Mavino Assistant section)
            </span>
          )}
        </div>
        <ToggleRow
          label="Enable daily proactive briefing"
          description={`Mavino will check your workspace once a day at ${pad(hour)}:${pad(minute)} (your timezone — set in Date & Time) and push a concise briefing to your phone via ntfy.`}
          on={enabled}
          onClick={toggleEnabled}
        />
      </Card>

      <Card className="mb-4">
        <h4 className="mb-3 text-sm font-semibold text-ink">Schedule</h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hour (0-23)">
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
              className={inputClass}
            />
          </Field>
          <Field label="Minute (0-59)">
            <input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
              className={inputClass}
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Times are in your timezone (configure in Date & Time). Next scheduled run:{" "}
          {cfg.nextRunAt ? new Date(cfg.nextRunAt).toLocaleString() : "—"}
        </p>
      </Card>

      <Card className="mb-4">
        <h4 className="mb-3 text-sm font-semibold text-ink">What to include</h4>
        <div className="space-y-2">
          {ALL_CATEGORIES.map((cat) => (
            <label
              key={cat.id}
              className="flex items-center gap-2.5 rounded-lg border border-edge bg-surface-2 px-3 py-2"
            >
              <input
                type="checkbox"
                checked={categories.includes(cat.id)}
                onChange={() => toggleCategory(cat.id)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-sm text-ink">{cat.label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <h4 className="mb-1 text-sm font-semibold text-ink">Custom prompt (optional)</h4>
        <p className="mb-3 text-xs text-ink-muted">
          Override the default briefing prompt. Leave blank to use the built-in one that gathers
          context from the selected categories.
        </p>
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          rows={4}
          placeholder="e.g. Focus only on my CS exam tomorrow. Be very brief and end with a study plan."
          className={`mb-2 w-full resize-y rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-focus ${inputClass}`}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-muted">{customPrompt.length}/4000</span>
          <div className="flex gap-2">
            <button
              onClick={test}
              disabled={testing || !ready}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface-3 disabled:opacity-40"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send test briefing
            </button>
            <SaveButton busy={busy} onClick={save} disabled={!cfg}>
              Save
            </SaveButton>
          </div>
        </div>
        <MsgBox msg={msg} error={err} />
        {testResult && (
          <div className="mt-3 rounded-lg border border-edge bg-surface p-3">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-ink-muted">
              Test briefing preview
            </p>
            <p className={`whitespace-pre-wrap text-sm ${err ? "text-danger" : "text-ink"}`}>
              {testResult}
            </p>
          </div>
        )}
      </Card>
    </>
  );
}
