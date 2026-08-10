import { useState, useEffect, useCallback } from "react";
import { Sparkles, KeyRound, Gauge, Trash2, Check, AlertCircle, Play, Loader2 } from "lucide-react";
import { adminLlmApi, type GlobalLlmConfig, type TierRateLimitsMap, type DemoConfig } from "../../../services/admin-llm";
import { SectionHeader, Card, Field, StatusPill, SaveButton, MsgBox, inputClass } from "../ui";

export default function LlmAdminSection() {
  return (
    <section id="llm-admin" className="mb-8">
      <SectionHeader
        icon={<Sparkles size={18} />}
        title="LLM Configuration"
        description="Control whether users provide their own API keys or use a single global key. Configure rate limits for each user tier and demo mode."
      />
      <GlobalKeyCard />
      <DemoModeCard />
      <TierRateLimitsCard />
    </section>
  );
}

function GlobalKeyCard() {
  const [config, setConfig] = useState<GlobalLlmConfig | null>(null);
  const [mode, setMode] = useState<"per-user" | "global">("per-user");
  const [keyInput, setKeyInput] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const c = await adminLlmApi.getConfig();
      setConfig(c);
      setMode(c.mode);
      setProvider(c.provider || "openai");
      setBaseUrl(c.baseUrl || "");
      setModelId(c.modelId || "");
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveMode = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await adminLlmApi.setMode(mode);
      await refresh();
      setMsg(`Mode set to ${mode === "global" ? "global key" : "per-user keys"}.`);
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to update mode");
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await adminLlmApi.setKey({
        apiKey: keyInput.trim(),
        provider: provider.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        modelId: modelId.trim() || undefined,
      });
      setKeyInput("");
      await refresh();
      setMsg("Global API key saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save key");
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    if (!confirm("Remove the global LLM API key? Users will need their own keys (if in per-user mode).")) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await adminLlmApi.deleteKey();
      await refresh();
      setMsg("Global API key removed.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to remove key");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <KeyRound size={16} className="text-accent" />
        <h3 className="font-semibold text-ink">Global LLM Key</h3>
        {config && (
          <StatusPill
            on={config.mode === "global"}
            onLabel={config.mode === "global" ? "Global mode" : "Per-user mode"}
            offLabel="Per-user mode"
          />
        )}
      </div>

      {/* Mode switch */}
      <div className="mb-4 rounded-lg border border-edge bg-surface-2 p-3">
        <p className="mb-2 text-xs font-medium text-ink">Key mode</p>
        <div className="flex gap-2">
          <button
            onClick={() => setMode("per-user")}
            className={`flex-1 rounded-lg border p-3 text-left text-sm transition ${
              mode === "per-user"
                ? "border-accent bg-accent/10 text-ink"
                : "border-edge bg-surface text-ink-muted hover:border-ink-muted"
            }`}
          >
            <p className="font-medium">Per-user keys</p>
            <p className="mt-0.5 text-xs text-ink-muted">Each user configures their own API key in Settings → Mavino.</p>
          </button>
          <button
            onClick={() => setMode("global")}
            className={`flex-1 rounded-lg border p-3 text-left text-sm transition ${
              mode === "global"
                ? "border-accent bg-accent/10 text-ink"
                : "border-edge bg-surface text-ink-muted hover:border-ink-muted"
            }`}
          >
            <p className="font-medium">Global key</p>
            <p className="mt-0.5 text-xs text-ink-muted">One admin-configured key for all users. No user setup needed.</p>
          </button>
        </div>
        <div className="mt-2 flex justify-end">
          <SaveButton busy={busy} onClick={saveMode} disabled={config?.mode === mode}>
            Apply mode
          </SaveButton>
        </div>
      </div>

      {/* Global key config (only relevant in global mode) */}
      {mode === "global" && (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs">
            {config?.hasKey ? (
              <span className="flex items-center gap-1 text-emerald-500">
                <Check size={12} /> Global key is set
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-500">
                <AlertCircle size={12} /> No global key set — users can't use AI
              </span>
            )}
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Field label="Provider">
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass}>
                <option value="openai">openai (OpenAI-compatible)</option>
                <option value="deepseek">deepseek</option>
                <option value="anthropic">anthropic</option>
                <option value="openrouter">openrouter</option>
                <option value="groq">groq</option>
                <option value="mistralai">mistralai</option>
                <option value="google">google</option>
                <option value="ollama">ollama (local)</option>
                <option value="xai">xai</option>
                <option value="meta">meta</option>
                <option value="cerebras">cerebras</option>
              </select>
            </Field>
            <Field label="Model id (optional)">
              <input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="e.g. gpt-4o-mini, deepseek-chat"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Base URL (optional — for OpenAI-compatible endpoints)">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className={inputClass}
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={config?.hasKey ? "Enter a new key to replace" : "Global API key"}
              className={`flex-1 ${inputClass}`}
              autoComplete="off"
            />
            <SaveButton busy={busy} onClick={saveKey} disabled={!keyInput.trim()}>
              Save key
            </SaveButton>
            {config?.hasKey && (
              <button
                onClick={removeKey}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-red-500 hover:text-white disabled:opacity-40"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            The key is encrypted (AES-256-GCM) and stored on the server. In global mode, per-user keys are ignored.
          </p>
        </>
      )}
      <MsgBox msg={msg} error={err} />
    </Card>
  );
}

function TierRateLimitsCard() {
  const [limits, setLimits] = useState<TierRateLimitsMap | null>(null);
  const [proRpd, setProRpd] = useState(2000);
  const [proRpm, setProRpm] = useState(60);
  const [paidRpd, setPaidRpd] = useState(500);
  const [paidRpm, setPaidRpm] = useState(30);
  const [freeRpd, setFreeRpd] = useState(50);
  const [freeRpm, setFreeRpm] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const l = await adminLlmApi.getRateLimits();
      setLimits(l);
      setProRpd(l.pro?.rpd ?? 2000);
      setProRpm(l.pro?.rpm ?? 60);
      setPaidRpd(l.paid.rpd);
      setPaidRpm(l.paid.rpm);
      setFreeRpd(l.free.rpd);
      setFreeRpm(l.free.rpm);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await adminLlmApi.setRateLimits({ proRpd, proRpm, paidRpd, paidRpm, freeRpd, freeRpm });
      await refresh();
      setMsg("Rate limits saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <Gauge size={14} /> Tier rate limits
      </h4>
      <p className="mb-3 text-xs text-ink-muted">
        Rate limits apply when global key mode is active. Admin tier is always unlimited.
        Set 0 for unlimited.
      </p>
      <div className="mb-3 rounded-lg border border-edge bg-surface-2 p-3">
        <p className="text-sm font-medium text-ink">Admin</p>
        <p className="mt-0.5 text-xs text-ink-muted">No restrictions — unlimited requests.</p>
      </div>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-edge bg-surface-2 p-3">
          <p className="mb-2 text-sm font-medium text-ink">Pro tier</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Requests / day">
              <input
                type="number"
                min={0}
                max={100000}
                value={proRpd}
                onChange={(e) => setProRpd(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
            <Field label="Requests / min">
              <input
                type="number"
                min={0}
                max={10000}
                value={proRpm}
                onChange={(e) => setProRpm(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
        <div className="rounded-lg border border-edge bg-surface-2 p-3">
          <p className="mb-2 text-sm font-medium text-ink">Paid tier</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Requests / day">
              <input
                type="number"
                min={0}
                max={100000}
                value={paidRpd}
                onChange={(e) => setPaidRpd(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
            <Field label="Requests / min">
              <input
                type="number"
                min={0}
                max={10000}
                value={paidRpm}
                onChange={(e) => setPaidRpm(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
        <div className="rounded-lg border border-edge bg-surface-2 p-3">
          <p className="mb-2 text-sm font-medium text-ink">Free tier</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Requests / day">
              <input
                type="number"
                min={0}
                max={100000}
                value={freeRpd}
                onChange={(e) => setFreeRpd(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
            <Field label="Requests / min">
              <input
                type="number"
                min={0}
                max={10000}
                value={freeRpm}
                onChange={(e) => setFreeRpm(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <SaveButton busy={busy} onClick={save}>Save rate limits</SaveButton>
      </div>
      <MsgBox msg={msg} error={err} />
    </Card>
  );
}

function DemoModeCard() {
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [ttlHours, setTtlHours] = useState(24);
  const [rpd, setRpd] = useState(100);
  const [rpm, setRpm] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const c = await adminLlmApi.getDemoConfig();
      setConfig(c);
      setEnabled(c.enabled);
      setProvider(c.provider || "openai");
      setBaseUrl(c.baseUrl || "");
      setModelId(c.modelId || "");
      setTtlHours(c.ttlHours ?? 24);
      setRpd(c.rateLimits?.rpd ?? 100);
      setRpm(c.rateLimits?.rpm ?? 10);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await adminLlmApi.setDemoConfig({
        enabled,
        apiKey: keyInput.trim() || undefined,
        provider: provider.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        modelId: modelId.trim() || undefined,
        ttlHours,
        rpd,
        rpm,
      });
      setKeyInput("");
      await refresh();
      setMsg("Demo settings saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const runCleanup = async () => {
    setCleanupBusy(true);
    try {
      const res = await adminLlmApi.cleanupDemoUsers();
      setMsg(`Cleaned up ${res.deleted} expired demo user(s).`);
      setErr(false);
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setCleanupBusy(false);
    }
  };

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <Play size={16} className="text-accent" />
        <h3 className="font-semibold text-ink">Demo Mode</h3>
        {config && (
          <StatusPill
            on={config.enabled && config.hasKey}
            onLabel={config.enabled && config.hasKey ? "Ready" : "Off"}
            offLabel="Off"
          />
        )}
      </div>

      <p className="mb-3 text-xs text-ink-muted">
        Let visitors try Mavino without creating an account. Demo users get fresh, pre-seeded accounts and use this separate LLM key.
      </p>

      <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-edge accent-[var(--accent)]"
        />
        Enable "Try Demo" button on the login screen
      </label>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Field label="Provider">
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass}>
            <option value="openai">openai (OpenAI-compatible)</option>
            <option value="deepseek">deepseek</option>
            <option value="anthropic">anthropic</option>
            <option value="openrouter">openrouter</option>
            <option value="groq">groq</option>
            <option value="mistralai">mistralai</option>
            <option value="google">google</option>
            <option value="ollama">ollama (local)</option>
            <option value="xai">xai</option>
            <option value="meta">meta</option>
            <option value="cerebras">cerebras</option>
          </select>
        </Field>
        <Field label="Model id (optional)">
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gpt-4o-mini" className={inputClass} />
        </Field>
      </div>
      <Field label="Base URL (optional)">
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className={inputClass} />
      </Field>
      <div className="mt-3 flex gap-2">
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={config?.hasKey ? "Enter a new key to replace" : "Demo API key"}
          className={`flex-1 ${inputClass}`}
          autoComplete="off"
        />
      </div>

      <div className="my-4 grid grid-cols-3 gap-2">
        <Field label="TTL (hours)">
          <input type="number" min={1} max={720} value={ttlHours} onChange={(e) => setTtlHours(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Demo requests / day">
          <input type="number" min={0} max={100000} value={rpd} onChange={(e) => setRpd(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Demo requests / min">
          <input type="number" min={0} max={10000} value={rpm} onChange={(e) => setRpm(Number(e.target.value))} className={inputClass} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SaveButton busy={busy} onClick={save} disabled={busy}>
          Save demo settings
        </SaveButton>
        <button
          type="button"
          onClick={runCleanup}
          disabled={cleanupBusy}
          className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-50"
        >
          {cleanupBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Clean up expired demo users
        </button>
      </div>
      <MsgBox msg={msg} error={err} />
    </Card>
  );
}
