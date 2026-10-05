// ===== Study Hub: inline upgrade card for locked functions =====
// Shown when a free-tier user clicks a Study Hub function that's not
// available in their plan. Displays the function name, description, the
// tier required, and an upgrade CTA that opens the Plans app.

import { Lock, Sparkles, ArrowRight } from "lucide-react";
import { useWindows } from "../../store/windows";
import type { StudyFunctionDef } from "../../services/study-functions";
import type { MinTier } from "./useStudyFunctions";

const TIER_LABELS: Record<string, string> = {
  paid: "Paid",
  pro: "Pro",
};

const TIER_PRICES: Record<string, string> = {
  paid: "€5/mo",
  pro: "€10/mo",
};

interface Props {
  fn: StudyFunctionDef;
  minTier: MinTier;
  /** Override the upgrade CTA (e.g. mobile opens the Plans tool instead of a desktop window). */
  onUpgrade?: () => void;
}

export default function StudyFunctionLocked({ fn, minTier, onUpgrade }: Props) {
  const { open } = useWindows();
  const handleUpgrade = onUpgrade ?? (() => open({ appId: "plans", title: "Plans", icon: "CreditCard" }));
  const tierLabel = minTier ? TIER_LABELS[minTier] ?? "Paid" : null;
  const tierPrice = minTier ? TIER_PRICES[minTier] ?? "€5/mo" : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-500">
        <Lock size={28} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-ink">{fn.label}</h2>
        <p className="mt-1 text-sm text-ink-muted">{fn.description}</p>
      </div>

      <div className="rounded-xl border border-edge bg-surface-2 px-5 py-4">
        {tierLabel ? (
          <>
            <p className="text-sm text-ink">
              <span className="font-medium">{fn.label}</span> is available in the{" "}
              <span className="font-semibold text-accent">{tierLabel}</span> plan ({tierPrice}).
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Upgrade to unlock this and all other {tierLabel}-tier Study Hub features.
            </p>
          </>
        ) : (
          <p className="text-sm text-ink">This feature is currently unavailable for all subscription plans.</p>
        )}
      </div>

      {tierLabel && (
        <button
          onClick={handleUpgrade}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:bg-accent/90"
        >
          <Sparkles size={16} />
          Upgrade to {tierLabel}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
