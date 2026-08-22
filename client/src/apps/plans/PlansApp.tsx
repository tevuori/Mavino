// ===== Plans app =====
// Subscription management UI: shows the user's current plan, lets them
// upgrade/downgrade via Stripe checkout, manage their subscription via the
// Stripe billing portal, or cancel. Also shows a feature comparison table.
//
// If Stripe isn't configured (self-hosted / dev), the upgrade buttons are
// disabled with a note. Admins can set price IDs in Settings → Tiers & Plans.

import { useState, useEffect } from "react";
import {
  Check, X, Sparkles, CreditCard, Loader2, AlertCircle, RefreshCw,
  ExternalLink, Calendar, Ban, Lock, GraduationCap,
} from "lucide-react";
import type { WindowInstance } from "../../store/windows";
import { subscriptionsApi, type SubscriptionStatus, type SubscriptionPlan } from "../../services/subscriptions";
import { useFeatures } from "../../store/features";
import { studyFunctionsApi, type StudyFunctionDef } from "../../services/study-functions";
import { APPS } from "../registry";

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
      "Atlas — global knowledge graph",
      "Crunch — adaptive exam planner",
      "Pro-tier AI rate limits",
      "50 GB storage",
      "Priority new features",
      "All Study Hub functions",
    ],
    cta: "Upgrade to Pro",
  },
];

export default function PlansApp({ win: _win }: { win: WindowInstance }) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<SubscriptionPlan | "portal" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [studyFunctions, setStudyFunctions] = useState<StudyFunctionDef[]>([]);
  const [studyMinTiers, setStudyMinTiers] = useState<Record<string, "free" | "paid" | "pro" | null>>({});
  const subscriptionTier = useFeatures((s) => s.subscriptionTier);
  const refreshFeatures = useFeatures((s) => s.refresh);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, sf] = await Promise.all([
        subscriptionsApi.getStatus(),
        studyFunctionsApi.getMyFunctions(),
      ]);
      setStatus(s);
      setStudyFunctions(sf.functions ?? []);
      setStudyMinTiers(sf.minTiers ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load subscription status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCheckout = async (plan: SubscriptionPlan) => {
    setActionLoading(plan);
    setError(null);
    try {
      const result = await subscriptionsApi.checkout(plan);
      if ("error" in result) {
        setError(result.error);
      } else if (result.url) {
        window.location.href = result.url;
      }
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
      if ("error" in result) {
        setError(result.error);
      } else if (result.url) {
        window.open(result.url, "_blank");
      }
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
      if ("error" in result) {
        setError(result.error);
      } else {
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
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="border-b border-edge px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
              <CreditCard size={22} className="text-accent" />
              Plans & Billing
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Choose the plan that fits your study workflow.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400/70 hover:text-red-400">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Current plan banner */}
        {status && (
          <div className="mb-6 rounded-xl border border-edge bg-surface-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Current plan</p>
                <p className="mt-0.5 text-lg font-semibold text-ink capitalize">
                  {currentPlan}
                  {isActive && (
                    <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-normal text-emerald-500">
                      Active
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {status.currentPeriodEnd && (
                  <span className="flex items-center gap-1 text-xs text-ink-muted">
                    <Calendar size={12} />
                    Renews {new Date(status.currentPeriodEnd).toLocaleDateString()}
                  </span>
                )}
                {status.cancelAt && (
                  <span className="flex items-center gap-1 text-xs text-amber-500">
                    <Ban size={12} />
                    Cancels {new Date(status.cancelAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            {isActive && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handlePortal}
                  disabled={actionLoading === "portal"}
                  className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-ink hover:bg-surface-3"
                >
                  {actionLoading === "portal" ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                  Manage billing
                </button>
                <button
                  onClick={handleCancel}
                  disabled={actionLoading === "cancel"}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                >
                  {actionLoading === "cancel" ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                  Cancel subscription
                </button>
              </div>
            )}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const isUpgrade = plan.id !== "free" && !isCurrent;
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border p-5 ${
                  plan.highlight
                    ? "border-accent/40 bg-accent/5"
                    : "border-edge bg-surface-2"
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-fg">
                    Popular
                  </span>
                )}
                <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
                <p className="mt-0.5 text-sm text-ink-muted">{plan.description}</p>
                <p className="mt-3 text-2xl font-bold text-ink">
                  {plan.price}
                </p>
                <ul className="mt-4 flex-1 space-y-2">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink">
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5">
                  {isCurrent ? (
                    <button
                      disabled
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-edge px-4 py-2 text-sm font-medium text-ink-muted"
                    >
                      <Check size={14} />
                      Current plan
                    </button>
                  ) : plan.id === "free" ? (
                    <button
                      disabled
                      className="w-full rounded-lg border border-edge px-4 py-2 text-sm font-medium text-ink-muted"
                    >
                      Downgrade not available
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCheckout(plan.id as SubscriptionPlan)}
                      disabled={actionLoading === plan.id || !isStripeConfigured}
                      className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
                        plan.highlight
                          ? "bg-accent text-accent-fg hover:bg-accent/90"
                          : "border border-edge text-ink hover:bg-surface-3"
                      } disabled:opacity-50`}
                    >
                      {actionLoading === plan.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      {plan.cta}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!isStripeConfigured && (
          <p className="mt-4 text-center text-xs text-ink-muted">
            Payments are not configured on this instance. Contact your administrator.
          </p>
        )}

        {/* Feature comparison: which apps are in which tier */}
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-ink">Apps by tier</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["free", "paid", "pro"] as const).map((tier) => {
              const tierApps = APPS.filter((a) => (a.minTier ?? "free") === tier);
              return (
                <div key={tier} className="rounded-xl border border-edge bg-surface-2 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {tier} tier
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tierApps.map((a) => (
                      <span
                        key={a.id}
                        className="rounded-md bg-surface-3 px-2 py-1 text-xs text-ink"
                      >
                        {a.name}
                      </span>
                    ))}
                    {tierApps.length === 0 && (
                      <span className="text-xs text-ink-muted">No apps</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Study Hub functions by tier */}
        {studyFunctions.length > 0 && (
          <div className="mt-8">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
              <GraduationCap size={16} className="text-accent" />
              Study Hub AI functions by tier
            </h3>
            <p className="mb-3 text-xs text-ink-muted">
              Each AI-powered Study Hub feature is unlocked at a specific plan. Your current plan:{" "}
              <span className="font-medium capitalize text-ink">{currentPlan}</span>.
            </p>
            <div className="overflow-hidden rounded-xl border border-edge">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-edge bg-surface-2">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Function
                    </th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Free
                    </th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Paid
                    </th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Pro
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {studyFunctions.map((fn, i) => {
                    const minTier = studyMinTiers[fn.id] ?? "free";
                    const inFree = minTier === "free";
                    const inPaid = minTier === "free" || minTier === "paid";
                    const inPro = minTier === "free" || minTier === "paid" || minTier === "pro";
                    const rowBg = i % 2 === 0 ? "bg-surface" : "bg-surface-2/50";
                    return (
                      <tr key={fn.id} className={`border-b border-edge/50 ${rowBg}`}>
                        <td className="px-4 py-2.5">
                          <p className="text-xs font-medium text-ink">{fn.label}</p>
                          <p className="text-[10px] text-ink-muted">{fn.description}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {inFree ? (
                            <Check size={14} className="mx-auto text-emerald-500" />
                          ) : (
                            <Lock size={12} className="mx-auto text-ink-muted/30" />
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {inPaid ? (
                            <Check size={14} className="mx-auto text-emerald-500" />
                          ) : (
                            <Lock size={12} className="mx-auto text-ink-muted/30" />
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {inPro ? (
                            <Check size={14} className="mx-auto text-emerald-500" />
                          ) : (
                            <Lock size={12} className="mx-auto text-ink-muted/30" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
