import { useState, useEffect, useCallback } from "react";
import { Sparkles, Trash2, Loader2, Check, Gauge, Shield, Volume2, Crown, Zap, Globe } from "lucide-react";
import { aiApi, type AiKeyStatus, type RateTier } from "../../../services/ai";
import { getAthenaInstructions, setAthenaInstructions } from "../../../services/athena";
import { ttsApi, type TtsConfig } from "../../../services/tts";
import { useAuth } from "../../../store/auth";
import { SectionHeader, Card, Field, StatusPill, SaveButton, MsgBox, inputClass } from "../ui";
import { confirmDialog } from "../../../store/mobileDialog";

export default function AthenaSection() {
  return (
    <section id="athena" className="mb-8">
      <SectionHeader
        icon={<Sparkles size={18} />}
        title="Mavino Assistant"
        description="Connect an LLM provider and customize how Mavino responds."
      />
      <TierInfoCard />
      <EligibilityCard />
      <LlmConfigCard />
      <RateLimitCard />
      <FallbackCard />
      <TtsConfigCard />
      <InstructionsCard />
    </section>
  );
}

// ===== Tier info card (shows the user's tier + rate limits) =====

function EligibilityCard() {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [ageBand, setAgeBand] = useState<"AGE_13_17" | "AGE_18_PLUS">("AGE_18_PLUS");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try { setStatus(await aiApi.getKeyStatus()); } catch {}
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!status || status.ageBand !== "UNKNOWN") {
    if (status?.ageBand === "AGE_13_17" && status.guardianConsentStatus !== "VERIFIED") {
      return (
        <Card className="mb-4 border-amber-500/30">
          <p className="text-sm font-medium text-ink">Waiting for guardian consent</p>
          <p className="mt-1 text-xs text-ink-muted">Hosted AI will become available after your parent or guardian confirms the email request.</p>
        </Card>
      );
    }
    return null;
  }

  const save = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await aiApi.setEligibility({
        ageBand,
        guardianEmail: ageBand === "AGE_13_17" ? guardianEmail.trim() : undefined,
        acceptTerms: true,
        acceptPrivacy: true,
      });
      await refresh();
      setMsg("AI eligibility saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save eligibility");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4">
      <p className="text-sm font-medium text-ink">Confirm AI eligibility</p>
      <p className="mt-1 text-xs text-ink-muted">Mavino needs your age group to apply the correct AI safety and consent rules.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setAgeBand("AGE_18_PLUS")} className={`rounded-lg border p-2 text-sm ${ageBand === "AGE_18_PLUS" ? "border-accent bg-accent/10" : "border-edge"}`}>18 or older</button>
        <button type="button" onClick={() => setAgeBand("AGE_13_17")} className={`rounded-lg border p-2 text-sm ${ageBand === "AGE_13_17" ? "border-accent bg-accent/10" : "border-edge"}`}>13–17</button>
      </div>
      {ageBand === "AGE_13_17" && (
        <input type="email" value={guardianEmail} onChange={(e) => setGuardianEmail(e.target.value)} placeholder="Parent or guardian email" className={`mt-3 w-full ${inputClass}`} />
      )}
      <label className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
        <span>I accept the Terms and Privacy Policy for hosted AI processing.</span>
      </label>
      <div className="mt-3"><SaveButton busy={busy} onClick={save} disabled={!accepted || ageBand === "AGE_13_17" && !guardianEmail.trim()}>Continue</SaveButton></div>
      <MsgBox msg={msg} error={err} />
    </Card>
  );
}

function TierInfoCard() {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);

  const refresh = useCallback(async () => {
    try { setStatus(await aiApi.getKeyStatus()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!status) return null;

  const tierLabel: Record<RateTier, string> = {
    admin: "Admin",
    pro: "Pro",
    paid: "Paid",
    free: "Free",
    demo: "Demo",
  };
  const tierIcon: Record<RateTier, typeof Crown> = {
    admin: Crown,
    pro: Zap,
    paid: Zap,
    free: Globe,
    demo: Sparkles,
  };
  const TierIcon = tierIcon[status.tier];
  const limits = status.tierRateLimits;
  const isGlobal = status.llmMode === "global";
  const isHostedMode = isGlobal || status.llmMode === "hybrid" && status.aiSource === "hosted";

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            status.tier === "admin" ? "bg-amber-500/15 text-amber-500"
            : status.tier === "paid" ? "bg-indigo-500/15 text-indigo-400"
            : status.tier === "demo" ? "bg-amber-500/15 text-amber-400"
            : "bg-surface-3 text-ink-muted"
          }`}>
            <TierIcon size={16} />
          </div>
          <div>
            <p className="text-sm font-medium text-ink">{tierLabel[status.tier]} tier</p>
            <p className="text-xs text-ink-muted">
              {isHostedMode ? "Mavino-hosted AI" : status.llmMode === "hybrid" ? "Your AI provider" : "Per-user key mode"}
            </p>
          </div>
        </div>
        <StatusPill on={status.configured} onLabel="AI ready" offLabel="Not configured" />
      </div>
      {isHostedMode && (
        <div className="mt-3 flex gap-4 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-xs text-ink-muted">
          <span>
            Rate limits:{" "}
            <strong className="text-ink">
              {limits.rpd === 0 ? "Unlimited" : `${limits.rpd}/day`}
            </strong>
            {" · "}
            <strong className="text-ink">
              {limits.rpm === 0 ? "Unlimited" : `${limits.rpm}/min`}
            </strong>
          </span>
          {status.tier !== "admin" && limits.rpd > 0 && (
            <span>
              Today: <strong className="text-ink">{status.rateLimitUsage.dayCount}</strong> / {limits.rpd}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

// ===== TTS config for Interactive Teacher voice =====

function TtsConfigCard() {
  const [cfg, setCfg] = useState<TtsConfig | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const c = await ttsApi.getConfig();
      setCfg(c);
      setVoiceId(c.voiceId || "");
      setModelId(c.modelId || "");
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    if (!keyInput.trim()) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await ttsApi.saveCredential({
        apiKey: keyInput.trim(),
        voiceId: voiceId.trim() || undefined,
        modelId: modelId.trim() || undefined,
      });
      setKeyInput("");
      await refresh();
      setMsg("ElevenLabs key saved. Teach Me will use ElevenLabs as the premium voice.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog("Remove your stored ElevenLabs API key?", { danger: true, confirmLabel: "Remove" }))) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await ttsApi.deleteCredential();
      await refresh();
      setMsg("ElevenLabs key removed. Teach Me will use Edge TTS (free, neural voices).");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setBusy(false);
    }
  };

  const usingElevenLabs = cfg?.provider === "elevenlabs";

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Volume2 size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">Voice (Teach Me mode)</h3>
        {cfg && (
          <StatusPill
            on={true}
            onLabel={usingElevenLabs ? "ElevenLabs" : "Edge TTS"}
            offLabel="Off"
          />
        )}
      </div>
      <p className="mb-3 text-xs text-ink-muted">
        Mavino uses <strong className="text-ink">Microsoft Edge TTS</strong> by default — free,
        high-quality neural voices with Czech support (Antonin, Vlasta) and no API key needed.
        Optionally add an ElevenLabs key for premium voice quality.
      </p>
      <div className="mb-3 rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-ink-muted">
        <strong className="text-ink">Current provider:</strong>{" "}
        {usingElevenLabs ? "ElevenLabs (premium)" : "Edge TTS (free)"}
        {cfg?.hasUserKey && " — your ElevenLabs key is active"}
      </div>
      <details className="mb-3">
        <summary className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink">
          ElevenLabs premium key (optional)
        </summary>
        <div className="mt-2">
          <Field label="ElevenLabs API Key">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={cfg?.hasUserKey ? "•••••••• (enter a new key to replace)" : "Enter your ElevenLabs API key"}
              className={inputClass}
              autoComplete="off"
            />
          </Field>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Voice ID (optional)">
              <input
                type="text"
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="Default: Rachel"
                className={inputClass}
              />
            </Field>
            <Field label="Model ID (optional)">
              <input
                type="text"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="eleven_turbo_v2_5"
                className={inputClass}
              />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <SaveButton onClick={save} busy={busy} disabled={!keyInput.trim()}>
              Save ElevenLabs Key
            </SaveButton>
            {cfg?.hasUserKey && (
              <button
                onClick={remove}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs text-ink-muted transition hover:text-red-400 disabled:opacity-40"
              >
                <Trash2 size={13} /> Remove
              </button>
            )}
          </div>
        </div>
      </details>
      {msg && <MsgBox msg={msg} error={err} />}
    </Card>
  );
}

function LlmConfigCard() {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const { user } = useAuth();
  const isDemo = user?.role === "DEMO";

  const refresh = useCallback(async () => {
    try {
      const s = await aiApi.getKeyStatus();
      setStatus(s);
      setProvider(s.provider || "openai");
      setBaseUrl(s.baseUrl || "");
      setModelId(s.modelId || "");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (!keyInput.trim()) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await aiApi.setKey(
        keyInput.trim(),
        provider.trim() || undefined,
        baseUrl.trim() || undefined,
        modelId.trim() || undefined
      );
      setKeyInput("");
      await refresh();
      setMsg("AI configuration saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog("Remove your stored AI API key?", { danger: true, confirmLabel: "Remove" }))) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await aiApi.deleteKey();
      await refresh();
      setMsg("API key removed.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to remove key");
    } finally {
      setBusy(false);
    }
  };

  const selectSource = async (source: "hosted" | "byok") => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await aiApi.setSource(source);
      await refresh();
      setMsg(source === "hosted" ? "Mavino-hosted AI selected." : "Your provider selected.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to change AI source");
    } finally {
      setBusy(false);
    }
  };

  const hasKey = status?.hasKey ?? false;
  const isGlobal = status?.llmMode === "global";
  const isHybrid = status?.llmMode === "hybrid";

  // Demo accounts always use the admin demo key and cannot set a personal one.
  if (isDemo) {
    return (
      <Card className="mb-4">
        <div className="mb-3 flex items-center gap-2 text-sm">
          <Sparkles size={16} className="text-accent" />
          <span className="font-medium text-ink">Demo account</span>
        </div>
        <p className="text-xs text-ink-muted">
          Demo accounts use the admin-configured demo LLM. You cannot set a personal key —
          Mavino AI is ready to use while the demo session is active.
        </p>
      </Card>
    );
  }

  // In global mode, per-user keys are ignored — show an info banner instead.
  if (isGlobal) {
    return (
      <Card className="mb-4">
        <div className="mb-3 flex items-center gap-2 text-sm">
          <Globe size={16} className="text-accent" />
          <span className="font-medium text-ink">Global key mode active</span>
        </div>
        <p className="text-xs text-ink-muted">
          The administrator has configured a global LLM key. You don't need to set up your own API key —
          Mavino AI is ready to use. Your rate limits depend on your account tier (shown above).
        </p>
        {hasKey && (
          <p className="mt-2 text-xs text-ink-muted">
            You have a personal key stored, but it is ignored in global mode. Switch to per-user mode
            (admin setting) to use it.
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <StatusPill
          on={isHybrid ? status?.aiSource !== "choice_required" : hasKey}
          onLabel={isHybrid ? status?.aiSource === "hosted" ? "Hosted AI" : "My provider" : "Key set"}
          offLabel={isHybrid ? "Choose AI source" : "No key set"}
        />
        {!hasKey && !isHybrid && (
          <span className="text-xs text-ink-muted">Mavino AI requires a key to function</span>
        )}
      </div>
      {isHybrid && status && (
        <div className="mb-4 rounded-lg border border-edge bg-surface-2 p-3">
          <p className="mb-2 text-xs font-medium text-ink">AI source</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void selectSource("hosted")}
              className={`rounded-lg border p-3 text-left text-sm ${status.aiSource === "hosted" ? "border-accent bg-accent/10" : "border-edge"}`}
            >
              <span className="font-medium text-ink">Hosted by Mavino</span>
              <span className="mt-1 block text-xs text-ink-muted">No API key. Uses your monthly allowance.</span>
            </button>
            <button
              type="button"
              disabled={busy || !hasKey}
              onClick={() => void selectSource("byok")}
              className={`rounded-lg border p-3 text-left text-sm ${status.aiSource === "byok" ? "border-accent bg-accent/10" : "border-edge"} disabled:opacity-50`}
            >
              <span className="font-medium text-ink">My provider</span>
              <span className="mt-1 block text-xs text-ink-muted">Uses your stored key and provider limits.</span>
            </button>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${status.budget.limitMicros > 0 ? Math.max(0, Math.min(100, status.budget.remainingMicros / status.budget.limitMicros * 100)) : 0}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Hosted allowance: {status.budget.limitMicros > 0 ? Math.round(status.budget.remainingMicros / status.budget.limitMicros * 100) : 0}% remaining
          </p>
        </div>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className={inputClass}
          >
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
      <Field
        label="Base URL (optional — for OpenAI-compatible endpoints)"
      >
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
          placeholder="API key"
          className={`flex-1 ${inputClass}`}
        />
        <SaveButton busy={busy} onClick={save} disabled={!keyInput.trim()}>
          Save
        </SaveButton>
        {hasKey && (
          <button
            onClick={remove}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-red-500 hover:text-white disabled:opacity-40"
            title="Remove key"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <MsgBox msg={msg} error={err} />
      <p className="mt-3 text-xs text-ink-muted">
        The key is encrypted (AES-256-GCM) and stored only on the server. Without a key,
        Mavino's chat and AI features are unavailable.
      </p>
    </Card>
  );
}

function RateLimitCard() {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [rpd, setRpd] = useState(50);
  const [rpm, setRpm] = useState(20);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await aiApi.getKeyStatus();
      setStatus(s);
      setEnabled(s.rateLimitEnabled);
      setRpd(s.rateLimitRpd);
      setRpm(s.rateLimitRpm);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await aiApi.setRateLimit({ rateLimitEnabled: enabled, rateLimitRpd: rpd, rateLimitRpm: rpm });
      await refresh();
      setMsg("Rate limit settings saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const hasKey = status?.hasKey ?? false;
  const usage = status?.rateLimitUsage;
  const isGlobal = status?.llmMode === "global" || status?.llmMode === "hybrid" && status.aiSource === "hosted";

  // In global mode, per-user rate limits are managed by the admin via tier config.
  if (isGlobal) return null;

  return (
    <Card className="mb-4">
      <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <Gauge size={14} /> Rate limit protection
      </h4>
      <p className="mb-3 text-xs text-ink-muted">
        Prevent requests from exceeding your LLM provider's free-tier rate limits. When enabled,
        requests that would exceed the limit are blocked (or routed to your fallback model if configured).
        Defaults match OpenRouter's free model limits.
      </p>
      {!hasKey ? (
        <p className="text-xs text-ink-muted">Set an API key first to configure rate limits.</p>
      ) : (
        <>
          <label className="mb-3 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 accent-accent"
            />
            Enable rate limit protection
          </label>
          {enabled && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Field label="Requests per day (RPD)">
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={rpd}
                  onChange={(e) => setRpd(Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
              <Field label="Requests per minute (RPM)">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={rpm}
                  onChange={(e) => setRpm(Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
            </div>
          )}
          {enabled && usage && (
            <div className="mb-3 flex gap-4 text-xs text-ink-muted">
              <span>Today: <strong className="text-ink">{usage.dayCount}</strong> / {rpd}</span>
              <span>This minute: <strong className="text-ink">{usage.minuteCount}</strong> / {rpm}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <SaveButton busy={busy} onClick={save} disabled={!hasKey}>
              Save
            </SaveButton>
          </div>
          <MsgBox msg={msg} error={err} />
        </>
      )}
    </Card>
  );
}

function FallbackCard() {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await aiApi.getKeyStatus();
      setStatus(s);
      setProvider(s.fallbackProvider || "openai");
      setBaseUrl(s.fallbackBaseUrl || "");
      setModelId(s.fallbackModelId || "");
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await aiApi.setFallback({
        fallbackApiKey: keyInput.trim() || undefined,
        fallbackProvider: provider.trim() || undefined,
        fallbackBaseUrl: baseUrl.trim() || undefined,
        fallbackModelId: modelId.trim() || undefined,
      });
      setKeyInput("");
      await refresh();
      setMsg("Fallback LLM saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const hasKey = status?.hasKey ?? false;
  const hasFallback = status?.hasFallback ?? false;
  const isGlobal = status?.llmMode === "global" || status?.llmMode === "hybrid" && status.aiSource === "hosted";

  // In global mode, fallback is not used (the global key is the only key).
  if (isGlobal) return null;

  return (
    <Card className="mb-4">
      <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <Shield size={14} /> Fallback LLM
      </h4>
      <p className="mb-3 text-xs text-ink-muted">
        Secondary LLM used when the primary model hits rate limits. Leave the API key blank to clear
        the fallback. The fallback is used automatically when rate limit protection is enabled.
      </p>
      {!hasKey ? (
        <p className="text-xs text-ink-muted">Set a primary API key first.</p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <StatusPill on={hasFallback} onLabel="Fallback set" offLabel="No fallback" />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Field label="Fallback provider">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className={inputClass}
              >
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
            <Field label="Fallback model id (optional)">
              <input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="e.g. gpt-4o-mini, deepseek-chat"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Fallback base URL (optional)">
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
              placeholder={hasFallback ? "New fallback API key (leave blank to keep)" : "Fallback API key"}
              className={`flex-1 ${inputClass}`}
            />
            <SaveButton busy={busy} onClick={save} disabled={!hasKey}>
              Save
            </SaveButton>
          </div>
          <MsgBox msg={msg} error={err} />
        </>
      )}
    </Card>
  );
}

function InstructionsCard() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getAthenaInstructions()
      .then((t) => {
        setText(t);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await setAthenaInstructions(text);
      setMsg("Instructions saved.");
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
        <Check size={14} /> Custom instructions
      </h4>
      <p className="mb-3 text-xs text-ink-muted">
        Tell Mavino how to behave — tone, language, formatting preferences, things to always
        remember. Injected into every chat turn.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!loaded}
        rows={5}
        placeholder="e.g. Always answer in Spanish. Be concise. I'm studying computer science."
        className={`mb-3 w-full resize-y rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent ${inputClass}`}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-muted">{text.length}/4000</span>
        <SaveButton busy={busy} onClick={save} disabled={!loaded || text.length > 4000}>
          Save instructions
        </SaveButton>
      </div>
      <MsgBox msg={msg} error={err} />
    </Card>
  );
}
