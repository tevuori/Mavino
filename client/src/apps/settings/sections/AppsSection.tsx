import { useState, useEffect, useCallback } from "react";
import { LayoutGrid, Loader2, Power, ShieldCheck, KeyRound } from "lucide-react";
import { featuresAdminApi, type AdminAppEntry } from "../../../services/features";
import { useFeatures } from "../../../store/features";
import { APP_MAP } from "../../registry";
import { SectionHeader, Card, MsgBox } from "../ui";

export default function AppsSection() {
  const [apps, setApps] = useState<AdminAppEntry[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refreshFeatures = useFeatures((s) => s.refresh);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await featuresAdminApi.getState();
      setApps(data.apps);
      setDisabled(new Set(data.disabledApps));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (app: AdminAppEntry) => {
    if (app.undisableable) return;
    const next = new Set(disabled);
    if (next.has(app.id)) next.delete(app.id);
    else next.add(app.id);
    setDisabled(next); // optimistic
    setBusyId(app.id);
    setErr(null);
    try {
      const data = await featuresAdminApi.setDisabled(Array.from(next));
      setDisabled(new Set(data.disabledApps));
      // Refresh the current user's own feature view in case this affected them.
      void refreshFeatures();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update");
      // revert
      setDisabled(new Set(disabled));
    } finally {
      setBusyId(null);
    }
  };

  const nameFor = (id: string) => (APP_MAP as Record<string, { name: string }>)[id]?.name ?? id;

  const free = apps.filter((a) => a.minTier === "free" && !a.requiresGrant);
  const paid = apps.filter((a) => (a.minTier === "paid" || a.minTier === "pro") && !a.requiresGrant);
  const grant = apps.filter((a) => a.requiresGrant === "vut");

  const renderRow = (app: AdminAppEntry) => {
    const isDisabled = disabled.has(app.id);
    const canToggle = !app.undisableable;
    return (
      <div
        key={app.id}
        className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2.5 last:border-0"
      >
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <span className="truncate">{nameFor(app.id)}</span>
            {app.requiresGrant === "vut" && (
              <KeyRound size={12} className="shrink-0 text-amber-500" aria-label="Admin-granted" />
            )}
            {app.undisableable && (
              <ShieldCheck size={12} className="shrink-0 text-accent" aria-label="Always on" />
            )}
          </p>
          <p className="text-xs text-ink-muted">
            {app.requiresGrant === "vut"
              ? "Admin-granted per user"
              : app.minTier === "free"
              ? "Free tier"
              : app.minTier === "pro"
              ? "Pro tier"
              : "Paid tier"}
          </p>
        </div>
        <button
          onClick={() => toggle(app)}
          disabled={!canToggle || busyId === app.id}
          title={canToggle ? (isDisabled ? "Enable" : "Disable") : "Always enabled"}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
            isDisabled
              ? "bg-red-500/15 text-red-500 hover:bg-red-500/25"
              : "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
          }`}
        >
          {busyId === app.id ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Power size={13} />
          )}
          {isDisabled ? "Disabled" : "Enabled"}
        </button>
      </div>
    );
  };

  return (
    <section id="apps" className="mb-8">
      <SectionHeader
        icon={<LayoutGrid size={18} />}
        title="App Availability"
        description="Temporarily disable any app for everyone (global kill switch). Disabled apps disappear from the taskbar, start menu, and command palette for all users. Core apps can be disabled too, except Settings. VUT/Moodle access is granted per user in the Users section."
      />

      {loading ? (
        <div className="flex items-center justify-center py-8 text-ink-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Free tier
          </h4>
          <Card className="mb-4 p-0">{free.map(renderRow)}</Card>

          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Paid / Pro tier
          </h4>
          <Card className="mb-4 p-0">{paid.map(renderRow)}</Card>

          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Admin-granted
          </h4>
          <Card className="p-0">{grant.map(renderRow)}</Card>
        </>
      )}

      <MsgBox msg={err} error />
    </section>
  );
}
