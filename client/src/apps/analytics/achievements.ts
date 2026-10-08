// ===== Achievement tier styling (client-side) =====
// The achievement definitions themselves (id/label/description/icon/tier/
// unlocked) come from the server in the /api/analytics/me payload. This file
// just maps a tier to display colors so the badge grid is consistent.

import type { AchievementTier } from "../../types";

export const TIER_STYLES: Record<
  AchievementTier,
  { ring: string; bg: string; text: string; glow: string; label: string }
> = {
  bronze: {
    ring: "border-warning",
    bg: "bg-warning-soft",
    text: "text-warning",
    glow: "shadow-panel",
    label: "Bronze",
  },
  silver: {
    ring: "border-edge-strong",
    bg: "bg-surface-2",
    text: "text-ink-muted",
    glow: "shadow-panel",
    label: "Silver",
  },
  gold: {
    ring: "border-warning",
    bg: "bg-warning-soft",
    text: "text-warning",
    glow: "shadow-panel",
    label: "Gold",
  },
  platinum: {
    ring: "border-accent",
    bg: "bg-accent-soft",
    text: "text-accent",
    glow: "shadow-panel",
    label: "Platinum",
  },
};
