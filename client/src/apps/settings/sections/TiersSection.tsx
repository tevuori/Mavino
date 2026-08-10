// ===== Tiers & Plans admin section =====
// Lets admins:
//   - Assign each app to a tier (free / paid / pro)
//   - Configure Stripe price IDs for the paid and pro plans
//   - See whether Stripe is configured (env var present)
//
// App tier assignments override the defaults in apps/registry.tsx. The global
// kill switch (enable/disable) lives in the Apps section; this section is
// only about which tier an app belongs to.

import { useState, useEffect, useCallback } from "react";
import { CreditCard, Loader2, Check, AlertCircle, Save } from "lucide-react";
import { featuresAdminApi, type AdminAppEntry, type AppTier } from "../../../services/features";
import { subscriptionsApi, type AdminPrices } from "../../../services/subscriptions";
import { useFeatures } from "../../../store/features";
import { APP_MAP } from "../../registry";
import { SectionHeader, Card, MsgBox, SaveButton } from "../ui";

const TIER_OPTIONS: AppTier[] = ["free", "paid", "pro"];

const TIER_COLORS: Record<AppTier, string> = {
  free: "bg-emerald-500/15 text-emerald-500",
  paid: "bg-indigo-500/15 text-indigo-400",
  pro: "bg-amber-500/15 text-amber-500",
};

export default function TiersSection() {
  const [apps, setApps] = useState<AdminAppEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prices, setPrices] = useState<AdminPrices | null>(null);
  const [paidPriceId, setPaidPriceId] = useState("");
  const [proPriceId, setProPriceId] = useState("");
  const [savingPrices, setSavingPrices] = useState(false);
  const [pricesSaved, setPricesSaved] = useState(false);
  const refreshFeatures = useFeatures((s) => s.refresh);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [data, p] = await Promise.all([
        featuresAdminApi.getState(),
        subscriptionsApi.getPrices(),
      ]);
      setApps(data.apps);
      setPrices(p);
      setPaidPriceId(p.paidPriceId ?? "");
      setProPriceId(p.proPriceId ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeTier = async (appId: string, tier: AppTier) => {
    setBusyId(appId);
    setErr(null);
    try {
      await featuresAdminApi.setAppTier(appId, tier);
      setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, minTier: tier } : a)));
      void refreshFeatures();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update tier");
    } finally {
      setBusyId(null);
    }
  };

  const savePrices = async () => {
    setSavingPrices(true);
    setErr(null);
    setPricesSaved(false);
    try {
      if (paidPriceId) await subscriptionsApi.setPrice("paid", paidPriceId);
      if (proPriceId) await subscriptionsApi.setPrice("pro", proPriceId);
      setPricesSaved(true);
      setTimeout(() => setPricesSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save price IDs");
    } finally {
      setSavingPrices(false);
    }
  };

  const nameFor = (id: string) => (APP_MAP as Record<string, { name: string }>)[id]?.name ?? id;

  const tieredApps = apps.filter((a) => !a.requiresGrant);

  return (
    <section id="tiers" className="mb-8">
      <SectionHeader
        icon={<CreditCard size={18} />}
        title="Tiers & Plans"
        description="Assign each app to a tier (Free / Paid / Pro). Users on a lower tier see the app in preview mode with a paywall. Configure Stripe price IDs to enable paid upgrades."
      />

      {/* Stripe configuration */}
      <Card className="mb-6 p-4">
        <h4 className="mb-3 text-sm font-semibold text-ink">Stripe configuration</h4>
        <div className="mb-3 flex items-center gap-2 text-sm">
          {prices?.stripeConfigured ? (
            <>
              <Check size={16} className="text-emerald-500" />
              <span className="text-ink">Stripe is configured (secret key detected)</span>
            </>
          ) : (
            <>
              <AlertCircle size={16} className="text-amber-500" />
              <span className="text-ink-muted">
                Stripe is not configured. Set <code className="rounded bg-surface-3 px-1 text-xs">STRIPE_SECRET_KEY</code> and <code className="rounded bg-surface-3 px-1 text-xs">STRIPE_WEBHOOK_SECRET</code> env vars to enable payments.
              </span>
            </>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">
              Paid plan price ID (€5/mo)
            </label>
            <input
              type="text"
              value={paidPriceId}
              onChange={(e) => setPaidPriceId(e.target.value)}
              placeholder="price_..."
              className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">
              Pro plan price ID (€10/mo)
            </label>
            <input
              type="text"
              value={proPriceId}
              onChange={(e) => setProPriceId(e.target.value)}
              placeholder="price_..."
              className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <SaveButton busy={savingPrices} onClick={savePrices}>
            {pricesSaved ? "Saved!" : "Save price IDs"}
          </SaveButton>
          <span className="text-xs text-ink-muted">
            Leave blank to use the env var fallback (<code className="rounded bg-surface-3 px-1">STRIPE_PRICE_PAID</code> / <code className="rounded bg-surface-3 px-1">STRIPE_PRICE_PRO</code>).
          </span>
        </div>
      </Card>

      {/* App tier assignments */}
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        App tier assignments
      </h4>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-ink-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <Card className="p-0">
          {tieredApps.map((app) => (
            <div
              key={app.id}
              className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2.5 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{nameFor(app.id)}</p>
                <p className="text-xs text-ink-muted">
                  {app.undisableable ? "Always available" : "Tier-gated"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {busyId === app.id && <Loader2 size={13} className="animate-spin text-ink-muted" />}
                {TIER_OPTIONS.map((tier) => (
                  <button
                    key={tier}
                    onClick={() => changeTier(app.id, tier)}
                    disabled={busyId === app.id || app.undisableable}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition disabled:opacity-40 ${
                      app.minTier === tier
                        ? TIER_COLORS[tier]
                        : "text-ink-muted hover:bg-surface-3"
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}

      <MsgBox msg={err} error />
    </section>
  );
}
