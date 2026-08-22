// ===== Mobile Plans (subscription management) =====
// Mobile-optimized view of Plans & Billing: current plan banner, plan cards
// stacked vertically with upgrade/manage actions, and a compact feature list.

import { useEffect, useState } from "react";
import {
  Check, Sparkles, CreditCard, Loader2, AlertCircle,
  ExternalLink, Calendar, Ban, RefreshCw,
} from "lucide-react";
import { subscriptionsApi, type SubscriptionStatus, type SubscriptionPlan } from "../services/subscriptions";
import { useFeatures } from "../store/features";
import { MobileContainer, MobileHeader, MobileEmpty } from "./MobileUi";

const PLANS: Array<{
  id: SubscriptionPlan | "free";
  name: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}> = [
  {
    id: "free",
    name: "Free",
    price: "€0",
    description: "For getting started",
    features: [
      "Notes, Tasks, Files, Whiteboard",
      "Study Hub (limited AI)",
      "Mavino assistant",
      "Today dashboard",
      "1 GB storage",
    ],
    cta: "Current plan",
  },
  {
    id: "paid",
    name: "Paid",
    price: "€5/mo",
    description: "For serious students",
    features: [
      "Everything in Free",
      "Pomodoro, Flashcards",
      "Calendar, Habits, Editor",
      "Browser, Voice Notes, Reminders",
      "Analytics, Maps",
      "10 GB storage",
      "Higher AI rate limits",
    ],
    cta: "Upgrade to Paid",
    highlight: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "€10/mo",
    description: "For power users",
    features: [
      "Everything in Paid",
      "Atlas, Crunch, Pulse, Compass",
      "Forge, Bridge, Scribe, Circle",
      "Pro-tier AI rate limits",
      "50 GB storage",
      "Priority new features",
      "All Study Hub functions",
    ],
    cta: "Upgrade to Pro",
  },
];

export default function MobilePlans({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<SubscriptionPlan | "portal" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscriptionTier = useFeatures((s) => s.subscriptionTier);
  const refreshFeatures = useFeatures((s) => s.refresh);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await subscriptionsApi.getStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load subscription status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleCheckout = async (plan: SubscriptionPlan) => {
    setActionLoading(plan);
    setError(null);
    try {
      const result = await subscriptionsApi.checkout(plan);
      if ("error" in result) setError(result.error);
      else if (result.url) window.location.href = result.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePortal = async () => {
    setActionLoading("portal");
    setError(null);
    try {
      const result = await subscriptionsApi.portal();
      if ("error" in result) setError(result.error);
      else if (result.url) window.open(result.url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open portal");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!confirm("Cancel your subscription? You'll keep access until the end of the current billing period.")) return;
    setActionLoading("cancel");
    setError(null);
    try {
      const result = await subscriptionsApi.cancel();
      if ("error" in result) setError(result.error);
      else {
        await load();
        await refreshFeatures();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setActionLoading(null);
    }
  };

  const currentPlan = status?.plan ?? (subscriptionTier === "pro" ? "pro" : subscriptionTier === "paid" ? "paid" : "free");
  const isActive = status?.status === "active" || status?.status === "trialing";
  const isStripeConfigured = status?.stripeConfigured ?? false;

  return (
    <MobileContainer>
      <MobileHeader
        title="Plans"
        subtitle="Billing"
        onClose={onClose}
        right={
          <button
            onClick={load}
            disabled={loading}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink-muted active:bg-surface-3"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {loading && !status ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-ink-muted" />
        </div>
      ) : (
        <>
          {status && (
            <div className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Current plan</p>
                  <p className="mt-0.5 flex items-center gap-2 text-lg font-semibold capitalize text-ink">
                    {currentPlan}
                    {isActive && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-normal text-emerald-400">Active</span>
                    )}
                  </p>
                </div>
                <CreditCard className="text-accent" size={22} />
              </div>
              {status.currentPeriodEnd && (
                <p className="mt-2 flex items-center gap-1 text-xs text-ink-muted">
                  <Calendar size={12} /> Renews {new Date(status.currentPeriodEnd).toLocaleDateString()}
                </p>
              )}
              {status.cancelAt && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-400">
                  <Ban size={12} /> Cancels {new Date(status.cancelAt).toLocaleDateString()}
                </p>
              )}
              {isActive && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handlePortal}
                    disabled={actionLoading === "portal"}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-edge px-3 py-2.5 text-xs font-medium text-ink active:bg-surface-3"
                  >
                    {actionLoading === "portal" ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
                    Manage billing
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading === "cancel"}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2.5 text-xs font-medium text-red-300 active:bg-red-500/10"
                  >
                    {actionLoading === "cancel" ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {!isStripeConfigured && (
            <MobileEmptyNote />
          )}

          <div className="space-y-3">
            {PLANS.map((plan) => {
              const isCurrent = currentPlan === plan.id;
              const isUpgrade = plan.id !== "free" && !isCurrent;
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border p-4 ${plan.highlight ? "border-accent/40 bg-accent/10" : "border-edge bg-surface-2"}`}
                >
                  {plan.highlight && (
                    <span className="absolute -top-2.5 left-4 rounded-full bg-accent px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-fg">
                      Popular
                    </span>
                  )}
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
                    <p className="text-xl font-bold text-ink">{plan.price}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">{plan.description}</p>
                  <ul className="mt-3 space-y-1.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-ink-muted">
                        <Check size={13} className="mt-0.5 shrink-0 text-emerald-400" /> {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => isUpgrade && plan.id !== "free" && handleCheckout(plan.id)}
                    disabled={!isUpgrade || actionLoading !== null || !isStripeConfigured}
                    className={`mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition active:scale-[.98] disabled:opacity-50 ${
                      isCurrent ? "bg-surface-3 text-ink-muted" : plan.highlight ? "bg-accent text-accent-fg" : "bg-surface-3 text-ink"
                    }`}
                  >
                    {actionLoading === plan.id ? <Loader2 size={16} className="animate-spin" /> : isCurrent ? null : <Sparkles size={15} />}
                    {isCurrent ? "Current plan" : plan.cta}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </MobileContainer>
  );
}

function MobileEmptyNote() {
  return (
    <div className="mb-4">
      <MobileEmpty text="Billing isn't configured on this server yet. An admin can set it up in Settings → Tiers & Plans." />
    </div>
  );
}
