import { useEffect, useState } from "react";
import { GraduationCap, Loader2, Cloud, KeyRound, Trash2 } from "lucide-react";
import { SectionHeader, Card, SaveButton, Field, StatusPill, inputClass } from "../ui";
import { studyFunctionsApi, type StudyFunctionDef, type StudyFunctionConfig } from "../../../services/study-functions";
import { adminPollyApi, type PollyAdminConfig } from "../../../services/admin-polly";

function TierToggle({
  label,
  on,
  onClick,
  busy,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
        on
          ? "bg-emerald-500/15 text-emerald-500"
          : "bg-surface-3 text-ink-muted"
      } disabled:opacity-50`}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : null}
      {label}
    </button>
  );
}

function PollyConfigCard() {
  const [config, setConfig] = useState<PollyAdminConfig | null>(null);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [region, setRegion] = useState("eu-central-1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    const next = await adminPollyApi.get();
    setConfig(next);
    setRegion(next.region);
  };
  useEffect(() => { void refresh(); }, []);
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      await adminPollyApi.save({ accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim(), sessionToken: sessionToken.trim() || undefined, region });
      setAccessKeyId(""); setSecretAccessKey(""); setSessionToken("");
      await refresh(); setMessage("Credentials verified and saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save AWS credentials"); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setMessage("");
    try { const result = await adminPollyApi.test(); setMessage(`Connection successful. Found ${result.voiceCount} English voices.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Connection failed"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm("Remove the global AWS Polly credentials?")) return;
    setBusy(true);
    try { await adminPollyApi.remove(); await refresh(); setMessage("Stored credentials removed."); }
    finally { setBusy(false); }
  };
  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center gap-2">
        <Cloud size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">AWS Polly podcast audio</h3>
        {config && <StatusPill on={config.configured} onLabel={`Connected · ${config.region}`} offLabel="Not configured" />}
      </div>
      <p className="mb-4 text-xs text-ink-muted">Global credentials are encrypted on the server and used to render downloadable Study Hub podcasts for all users.</p>
      <div className="grid gap-3 @2xl:grid-cols-2">
        <Field label="AWS access key ID"><input className={inputClass} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} placeholder={config?.configured ? "Enter to replace current credentials" : "AKIA…"} autoComplete="off" /></Field>
        <Field label="AWS secret access key"><input type="password" className={inputClass} value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} placeholder="Secret access key" autoComplete="new-password" /></Field>
        <Field label="AWS region"><input className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="eu-central-1" /></Field>
        <Field label="Session token (optional)"><input type="password" className={inputClass} value={sessionToken} onChange={(e) => setSessionToken(e.target.value)} placeholder="Only for temporary credentials" autoComplete="new-password" /></Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SaveButton busy={busy} onClick={save} disabled={!accessKeyId.trim() || !secretAccessKey.trim()}><KeyRound size={13} /> Verify & save</SaveButton>
        {config?.configured && <button onClick={test} disabled={busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-muted hover:bg-surface-3">Test connection</button>}
        {config?.source === "database" && <button onClick={remove} disabled={busy} className="rounded-lg border border-edge p-2 text-ink-muted hover:text-red-500"><Trash2 size={14} /></button>}
        {message && <span className="text-xs text-ink-muted">{message}</span>}
      </div>
    </Card>
  );
}

export default function StudyHubSection() {
  const [functions, setFunctions] = useState<StudyFunctionDef[]>([]);
  const [config, setConfig] = useState<StudyFunctionConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await studyFunctionsApi.getAdminConfig();
      setFunctions(res.functions);
      setConfig(res.config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Study Hub settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await studyFunctionsApi.setAdminConfig(config);
      setConfig(res.config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save Study Hub settings");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string, tier: "free" | "paid" | "pro") => {
    setConfig((prev) => ({
      ...prev,
      [id]: {
        free: tier === "free" ? !prev[id]?.free : Boolean(prev[id]?.free),
        paid: tier === "paid" ? !prev[id]?.paid : Boolean(prev[id]?.paid),
        pro: tier === "pro" ? !prev[id]?.pro : Boolean(prev[id]?.pro ?? prev[id]?.paid),
      },
    }));
  };

  return (
    <section id="study-hub" className="mb-8">
      <SectionHeader
        icon={<GraduationCap size={18} />}
        title="Study Hub Functions"
        description="Enable or disable each Study Hub AI function for Free, Paid, and Pro tiers. Managers always have access; these settings do not affect admins or managers."
      />

      <PollyConfigCard />

      {loading ? (
        <Card className="flex items-center gap-2 p-4 text-ink-muted">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading functions…</span>
        </Card>
      ) : error ? (
        <Card className="p-4 text-sm text-red-500">{error}</Card>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between text-xs font-medium text-ink-muted">
            <span>Function</span>
            <div className="flex items-center gap-6 pr-2">
              <span className="w-16 text-center">Free</span>
              <span className="w-16 text-center">Paid</span>
              <span className="w-16 text-center">Pro</span>
            </div>
          </div>
          <div className="space-y-2">
            {functions.map((f) => (
              <Card
                key={f.id}
                className="flex items-center justify-between p-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{f.label}</p>
                  <p className="text-xs text-ink-muted">{f.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  <TierToggle
                    label="Free"
                    on={Boolean(config[f.id]?.free)}
                    onClick={() => toggle(f.id, "free")}
                    busy={saving}
                  />
                  <TierToggle
                    label="Paid"
                    on={Boolean(config[f.id]?.paid)}
                    onClick={() => toggle(f.id, "paid")}
                    busy={saving}
                  />
                  <TierToggle
                    label="Pro"
                    on={Boolean(config[f.id]?.pro ?? config[f.id]?.paid)}
                    onClick={() => toggle(f.id, "pro")}
                    busy={saving}
                  />
                </div>
              </Card>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            {error ? <p className="text-xs text-red-500">{error}</p> : <div />}
            <SaveButton busy={saving} onClick={save}>
              Save Study Hub settings
            </SaveButton>
          </div>
        </>
      )}
    </section>
  );
}
