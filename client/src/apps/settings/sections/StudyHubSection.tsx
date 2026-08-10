import { useEffect, useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { SectionHeader, Card, SaveButton } from "../ui";
import { studyFunctionsApi, type StudyFunctionDef, type StudyFunctionConfig } from "../../../services/study-functions";

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

  const toggle = (id: string, tier: "free" | "paid") => {
    setConfig((prev) => ({
      ...prev,
      [id]: {
        free: tier === "free" ? !prev[id]?.free : Boolean(prev[id]?.free),
        paid: tier === "paid" ? !prev[id]?.paid : Boolean(prev[id]?.paid),
      },
    }));
  };

  return (
    <section id="study-hub" className="mb-8">
      <SectionHeader
        icon={<GraduationCap size={18} />}
        title="Study Hub Functions"
        description="Enable or disable each Study Hub AI function for Free and Paid tiers. Managers always have access; these settings do not affect admins or managers."
      />

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
