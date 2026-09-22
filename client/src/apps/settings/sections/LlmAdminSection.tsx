import { useState, useEffect, useCallback } from "react";
import { Sparkles, KeyRound, Gauge, Trash2, Check, AlertCircle, Play, Loader2, WalletCards, BarChart3, RefreshCw } from "lucide-react";
import { adminLlmApi, type GlobalLlmConfig, type TierRateLimitsMap, type DemoConfig, type HostedBudgetConfig, type AdminUsageStats } from "../../../services/admin-llm";
import { SectionHeader, Card, Field, StatusPill, SaveButton, MsgBox, inputClass } from "../ui";
import { confirmDialog } from "../../../store/mobileDialog";

export default function LlmAdminSection() {
  return (
    <section id="llm-admin" className="mb-8">
      <SectionHeader
        icon={<Sparkles size={18} />}
        title="LLM Configuration"
        description="Control whether users provide their own API keys or use a single global key. Configure rate limits for each user tier and demo mode."
      />
      <GlobalKeyCard />
      <HostedBudgetCard />
      <HostedUsageCard />
      <DemoModeCard />
      <TierRateLimitsCard />
    </section>
  );
}

function GlobalKeyCard() {
  const [config, setConfig] = useState<GlobalLlmConfig | null>(null);
  const [mode, setMode] = useState<"per-user" | "global" | "hybrid">("per-user");
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
      setMsg(`Mode set to ${mode === "global" ? "global key" : mode === "hybrid" ? "hybrid hosted/BYOK" : "per-user keys"}.`);
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
    if (!(await confirmDialog("Remove the global LLM API key? Users will need their own keys (if in per-user mode).", { danger: true, confirmLabel: "Remove" }))) return;
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
            on={config.mode !== "per-user"}
            onLabel={config.mode === "global" ? "Global mode" : config.mode === "hybrid" ? "Hybrid mode" : "Per-user mode"}
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
          <button
            onClick={() => setMode("hybrid")}
            className={`flex-1 rounded-lg border p-3 text-left text-sm transition ${
              mode === "hybrid"
                ? "border-accent bg-accent/10 text-ink"
                : "border-edge bg-surface text-ink-muted hover:border-ink-muted"
            }`}
          >
            <p className="font-medium">Hybrid</p>
            <p className="mt-0.5 text-xs text-ink-muted">Hosted allowance with an explicit BYOK option.</p>
          </button>
        </div>
        <div className="mt-2 flex justify-end">
          <SaveButton busy={busy} onClick={saveMode} disabled={config?.mode === mode}>
            Apply mode
          </SaveButton>
        </div>
      </div>

      {/* Global key config (only relevant in global mode) */}
      {mode !== "per-user" && (
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
            The key is encrypted (AES-256-GCM) and stored on the server. Hybrid mode uses it only for users who select hosted AI.
          </p>
        </>
      )}
      <MsgBox msg={msg} error={err} />
    </Card>
  );
}

function HostedBudgetCard() {
  const [config, setConfig] = useState<HostedBudgetConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [globalMonthly, setGlobalMonthly] = useState(100);
  const [free, setFree] = useState(0.5);
  const [paid, setPaid] = useState(1.5);
  const [pro, setPro] = useState(3);
  const [admin, setAdmin] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const value = await adminLlmApi.getHostedBudget();
      setConfig(value);
      setEnabled(value.enabled);
      setGlobalMonthly(value.globalMonthlyMicros / 1_000_000);
      setFree(value.tiers.free / 1_000_000);
      setPaid(value.tiers.paid / 1_000_000);
      setPro(value.tiers.pro / 1_000_000);
      setAdmin(value.tiers.admin / 1_000_000);
    } catch {}
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await adminLlmApi.setHostedBudget({
        enabled,
        globalMonthlyMicros: Math.round(globalMonthly * 1_000_000),
        tiers: {
          free: Math.round(free * 1_000_000),
          paid: Math.round(paid * 1_000_000),
          pro: Math.round(pro * 1_000_000),
          admin: Math.round(admin * 1_000_000),
        },
      });
      await refresh();
      setMsg("Hosted AI budgets saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save hosted budgets");
    } finally {
      setBusy(false);
    }
  };

  const fields = [
    ["Free / month", free, setFree],
    ["Paid / month", paid, setPaid],
    ["Pro / month", pro, setPro],
    ["Admin / month", admin, setAdmin],
  ] as const;

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <WalletCards size={16} className="text-accent" />
        <h3 className="font-semibold text-ink">Hosted AI budgets</h3>
        <StatusPill on={enabled} onLabel="Enabled" offLabel="Disabled" />
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Allow hosted AI usage
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {fields.map(([label, value, setter]) => (
          <Field key={label} label={`${label} (USD)`}>
            <input type="number" min={0} step={0.1} value={value} onChange={(e) => setter(Number(e.target.value))} className={inputClass} />
          </Field>
        ))}
        <Field label="Global / month (USD)">
          <input type="number" min={0.01} step={1} value={globalMonthly} onChange={(e) => setGlobalMonthly(Number(e.target.value))} className={inputClass} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <SaveButton busy={busy} onClick={save}>Save hosted budgets</SaveButton>
        {config && <span className="text-xs text-ink-muted">Per-operation reserve: ${(config.reservationMicros / 1_000_000).toFixed(3)}</span>}
      </div>
      <MsgBox msg={msg} error={err} />
    </Card>
  );
}

function fmtUsd(micros: number): string {
  const dollars = micros / 1_000_000;
  return `$${dollars >= 1 ? dollars.toFixed(2) : dollars.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function HostedUsageCard() {
  const [stats, setStats] = useState<AdminUsageStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setStats(await adminLlmApi.getUsage());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load usage");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!stats && !err) return null;
  const usedPct = stats && stats.global.limitMicros > 0
    ? Math.min(100, ((stats.global.spentMicros + stats.global.reservedMicros) / stats.global.limitMicros) * 100)
    : 0;
  const maxDaily = stats ? Math.max(1, ...stats.daily.map((d) => d.costMicros)) : 1;

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <BarChart3 size={16} className="text-accent" />
        <h3 className="font-semibold text-ink">Hosted AI usage this month</h3>
        <button
          onClick={refresh}
          disabled={busy}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
          title="Refresh"
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      {stats && (
        <>
          <div className="mb-3 rounded-lg border border-edge bg-surface-2 p-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-ink-muted">Global hosted budget</span>
              <span className="text-ink">
                {fmtUsd(stats.global.spentMicros + stats.global.reservedMicros)} / {fmtUsd(stats.global.limitMicros)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full ${usedPct > 90 ? "bg-red-500" : usedPct > 70 ? "bg-amber-500" : "bg-accent"}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              {fmtUsd(stats.global.remainingMicros)} remaining · {stats.reservations.active} active reservation(s)
              ({fmtUsd(stats.reservations.activeMicros)}) · resets {new Date(stats.monthEnd).toLocaleDateString()}
            </p>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-lg border border-edge bg-surface-2 p-2">
              <p className="text-sm font-semibold text-ink">{stats.totals.requests}</p>
              <p className="text-[10px] text-ink-muted">requests</p>
            </div>
            <div className="rounded-lg border border-edge bg-surface-2 p-2">
              <p className="text-sm font-semibold text-ink">{fmtUsd(stats.totals.costMicros)}</p>
              <p className="text-[10px] text-ink-muted">est. cost (all sources)</p>
            </div>
            <div className="rounded-lg border border-edge bg-surface-2 p-2">
              <p className="text-sm font-semibold text-ink">
                {fmtTokens(stats.totals.inputTokens)} / {fmtTokens(stats.totals.outputTokens)}
              </p>
              <p className="text-[10px] text-ink-muted">in / out tokens</p>
            </div>
            <div className="rounded-lg border border-edge bg-surface-2 p-2">
              <p className="text-sm font-semibold text-ink">
                {stats.totals.failed > 0 ? <span className="text-red-400">{stats.totals.failed}</span> : 0}
              </p>
              <p className="text-[10px] text-ink-muted">failed ({stats.totals.estimated} estimated)</p>
            </div>
          </div>

          {stats.daily.length > 0 && (
            <div className="mb-3 rounded-lg border border-edge bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-medium text-ink-muted">Daily hosted spend</p>
              <div className="flex h-16 items-end gap-1">
                {stats.daily.slice(-30).map((d) => (
                  <div
                    key={d.day}
                    className="flex-1 rounded-sm bg-accent/70"
                    style={{ height: `${Math.max(4, (d.costMicros / maxDaily) * 100)}%` }}
                    title={`${d.day}: ${fmtUsd(d.costMicros)} · ${d.requests} req`}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-edge bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-medium text-ink-muted">By tier (hosted)</p>
              {stats.byTier.length === 0 && <p className="text-xs text-ink-muted">No hosted usage yet.</p>}
              {stats.byTier.map((row) => (
                <div key={row.tier} className="flex justify-between py-0.5 text-xs">
                  <span className="capitalize text-ink">{row.tier}</span>
                  <span className="text-ink-muted">{row.requests} req · {fmtUsd(row.costMicros)}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-edge bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-medium text-ink-muted">By source</p>
              {stats.bySource.map((row) => (
                <div key={row.source} className="flex justify-between py-0.5 text-xs">
                  <span className="capitalize text-ink">{row.source}</span>
                  <span className="text-ink-muted">{row.requests} req · {fmtUsd(row.costMicros)}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-edge bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-medium text-ink-muted">Top features</p>
              {stats.byFeature.length === 0 && <p className="text-xs text-ink-muted">No usage yet.</p>}
              {stats.byFeature.slice(0, 6).map((row) => (
                <div key={row.feature} className="flex justify-between py-0.5 text-xs">
                  <span className="truncate text-ink">{row.feature}</span>
                  <span className="shrink-0 text-ink-muted">{row.requests} req · {fmtUsd(row.costMicros)}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-edge bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-medium text-ink-muted">Top models</p>
              {stats.byModel.length === 0 && <p className="text-xs text-ink-muted">No usage yet.</p>}
              {stats.byModel.slice(0, 6).map((row) => (
                <div key={`${row.provider}/${row.modelId}`} className="flex justify-between py-0.5 text-xs">
                  <span className="truncate text-ink">{row.provider}/{row.modelId}</span>
                  <span className="shrink-0 text-ink-muted">{row.requests} req · {fmtUsd(row.costMicros)}</span>
                </div>
              ))}
            </div>
          </div>

          {stats.topUsers.length > 0 && (
            <div className="mt-3 rounded-lg border border-edge bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-medium text-ink-muted">Top hosted users</p>
              {stats.topUsers.map((row) => (
                <div key={row.userId} className="flex justify-between py-0.5 text-xs">
                  <span className="text-ink">
                    {row.username} <span className="text-ink-muted">({row.tier})</span>
                  </span>
                  <span className="text-ink-muted">{row.requests} req · {fmtUsd(row.costMicros)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
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
