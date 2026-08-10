import { Lock, Sparkles, Check, ArrowRight } from "lucide-react";
import { useWindows } from "../store/windows";

interface Props {
  /** The minimum tier required to unlock this content. */
  requiredTier: "paid" | "pro";
  /** Optional feature highlights to show in the paywall. */
  highlights?: string[];
  /** Whether the overlay can be dismissed (keeps the preview visible). */
  dismissible?: boolean;
  /** Called when the user dismisses the overlay ("Maybe later"). */
  onDismiss?: () => void;
}

const TIER_LABELS: Record<string, string> = {
  paid: "Paid",
  pro: "Pro",
};

const TIER_PRICES: Record<string, string> = {
  paid: "€5/mo",
  pro: "€10/mo",
};

/**
 * Semi-transparent paywall overlay shown over locked app content.
 * Renders a blur backdrop + upgrade CTA. Clicking "Upgrade" opens the
 * Plans app. "Maybe later" dismisses the overlay but keeps the preview.
 */
export default function PaywallOverlay({ requiredTier, highlights = [], dismissible = true, onDismiss }: Props) {
  const { open } = useWindows();
  const tierLabel = TIER_LABELS[requiredTier] ?? "Paid";
  const tierPrice = TIER_PRICES[requiredTier] ?? "€5/mo";

  return (
    <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-surface/80 backdrop-blur-sm">
      <div className="mx-4 max-w-sm rounded-2xl border border-edge bg-surface p-6 shadow-window">
        {/* Lock icon */}
        <div className="mb-4 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-500">
            <Lock size={26} />
          </div>
        </div>

        {/* Heading */}
        <h3 className="mb-1 text-center text-lg font-semibold text-ink">
          {tierLabel} feature
        </h3>
        <p className="mb-4 text-center text-sm text-ink-muted">
          You're viewing a preview. Upgrade to {tierLabel} ({tierPrice}) to unlock
          full access to this app.
        </p>

        {/* Feature highlights */}
        {highlights.length > 0 && (
          <ul className="mb-4 space-y-1.5">
            {highlights.map((h, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-ink">
                <Check size={14} className="shrink-0 text-emerald-500" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() =>
              open({ appId: "plans", title: "Plans", icon: "CreditCard" })
            }
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition hover:bg-accent/90"
          >
            <Sparkles size={16} />
            Upgrade to {tierLabel}
            <ArrowRight size={14} />
          </button>
          {dismissible && (
            <button
              onClick={onDismiss}
              className="text-center text-xs text-ink-muted hover:text-ink"
            >
              Maybe later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
