// ===== Feature flags / app availability =====
// Controls which apps a user can access based on a tier system:
//   - Each app has a minimum tier ("free" | "paid" | "pro").
//   - Each user has a subscription tier derived from their role.
//   - Apps below the user's tier are fully accessible; apps above are
//     shown in preview mode (the client renders a paywall overlay).
//   - Per-user "vut" grant: admin-gated access to the VUT + Moodle apps
//     (and their API routes). Moodle rides on the VUT SSO session, so a
//     single grant covers both.
//   - Global "disabled apps" kill switch (admin): temporarily disables an
//     app for everyone regardless of tier/grant. Settings is never disableable.
//
// All flags are stored in the Setting key/value table. Global flags use
// userId = null; per-user flags use the user's id. The app tier classification
// is mirrored on the client in client/src/apps/registry.tsx — keep them in sync.

import prisma from "../db/client";

export type AppTier = "free" | "paid" | "pro";

/** The result of an app accessibility check. */
export type AppAccess = "full" | "preview" | "hidden";

/** Apps that require an admin-granted "vut" access flag (VUT + Moodle). */
export const VUT_GRANT_APPS = new Set<string>(["vut", "moodle"]);

/** Settings can never be disabled (would lock the user out of configuration). */
export const UNDISABLEABLE_APPS = new Set<string>(["settings"]);

/** Default minimum tier for each app. Admins can override via setAppTier(). */
const DEFAULT_APP_TIERS: Record<string, AppTier> = {
  // Free tier (always accessible)
  notes: "free",
  tasks: "free",
  files: "free",
  whiteboard: "free",
  study: "free",
  athena: "free",
  today: "free",
  settings: "free",
  plans: "free",
  // Paid tier
  pomodoro: "paid",
  flashcards: "paid",
  grades: "paid",
  editor: "paid",
  viewer: "paid",
  calendar: "paid",
  habits: "paid",
  ntfy: "paid",
  voice: "paid",
  browser: "paid",
  reminders: "paid",
  analytics: "paid",
  maps: "paid",
  marketplace: "paid",
  // Pro tier
  atlas: "pro",
  crunch: "pro",
  compass: "pro",
  // VUT + Moodle are grant-based, not tier-based
};

/** Full catalog of app ids the admin can toggle. */
export const ALL_APP_IDS: string[] = [
  "notes", "tasks", "files", "whiteboard", "study", "athena", "today", "settings", "plans",
  "pomodoro", "flashcards", "grades", "editor", "viewer", "calendar", "habits",
  "ntfy", "voice", "browser", "reminders", "analytics", "maps", "marketplace",
  "atlas",
  "crunch",
  "compass",
  "vut", "moodle",
];

const TIER_RANK: Record<AppTier, number> = { free: 0, paid: 1, pro: 2 };

// ----- app tier overrides (admin-configurable) -----

const APP_TIERS_KEY = "app.tiers";

/** Get the tier for an app, considering admin overrides. */
export async function getAppTier(appId: string): Promise<AppTier> {
  const overrides = await getAppTierOverrides();
  if (overrides[appId]) return overrides[appId];
  return DEFAULT_APP_TIERS[appId] ?? "free";
}

/** Get all app tier overrides (admin-configured). */
async function getAppTierOverrides(): Promise<Record<string, AppTier>> {
  const s = await prisma.setting.findFirst({ where: { userId: null, key: APP_TIERS_KEY } });
  if (!s?.value) return {};
  try {
    const parsed = JSON.parse(s.value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, AppTier> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === "free" || v === "paid" || v === "pro") {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Get all app tier assignments (defaults + overrides). */
export async function getAppTiers(): Promise<Record<string, AppTier>> {
  const overrides = await getAppTierOverrides();
  const out: Record<string, AppTier> = {};
  for (const id of ALL_APP_IDS) {
    out[id] = overrides[id] ?? DEFAULT_APP_TIERS[id] ?? "free";
  }
  return out;
}

/** Set the tier for a specific app (admin override). */
export async function setAppTier(appId: string, tier: AppTier): Promise<void> {
  const overrides = await getAppTierOverrides();
  overrides[appId] = tier;
  await persistAppTierOverrides(overrides);
}

/** Bulk-set app tier overrides. */
export async function setAppTiers(assignments: Record<string, AppTier>): Promise<void> {
  const overrides = await getAppTierOverrides();
  for (const [k, v] of Object.entries(assignments)) {
    if (v === "free" || v === "paid" || v === "pro") {
      overrides[k] = v;
    }
  }
  await persistAppTierOverrides(overrides);
}

async function persistAppTierOverrides(overrides: Record<string, AppTier>): Promise<void> {
  const value = JSON.stringify(overrides);
  const existing = await prisma.setting.findFirst({ where: { userId: null, key: APP_TIERS_KEY } });
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { userId: null, key: APP_TIERS_KEY, value } });
  }
}

// ----- per-user VUT grant (admin-controlled) -----

const VUT_GRANT_KEY = "vut.access";

export async function getVutGrant(userId: string): Promise<boolean> {
  const s = await prisma.setting.findFirst({ where: { userId, key: VUT_GRANT_KEY } });
  return s?.value === "true";
}

export async function setVutGrant(userId: string, enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";
  const existing = await prisma.setting.findFirst({ where: { userId, key: VUT_GRANT_KEY } });
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { userId, key: VUT_GRANT_KEY, value } });
  }
}

// ----- global disabled-apps kill switch (admin) -----

const DISABLED_APPS_KEY = "apps.disabled";

export async function getGlobalDisabledApps(): Promise<Set<string>> {
  const s = await prisma.setting.findFirst({ where: { userId: null, key: DISABLED_APPS_KEY } });
  if (!s?.value) return new Set();
  try {
    const arr = JSON.parse(s.value) as unknown;
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
      return new Set(arr.filter((a) => !UNDISABLEABLE_APPS.has(a)));
    }
  } catch {
    /* corrupt JSON — treat as empty */
  }
  return new Set();
}

export async function setGlobalDisabledApps(apps: string[]): Promise<void> {
  // Filter out undisableable apps + dedupe.
  const clean = Array.from(new Set(apps.filter((a) => !UNDISABLEABLE_APPS.has(a))));
  const value = JSON.stringify(clean);
  const existing = await prisma.setting.findFirst({ where: { userId: null, key: DISABLED_APPS_KEY } });
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { userId: null, key: DISABLED_APPS_KEY, value } });
  }
}

// ----- subscription tier derivation -----

/** The subscription tier for a user role. Staff roles get "pro" (full access). */
export function roleToSubscriptionTier(role: string): AppTier {
  if (role === "ADMIN" || role === "MANAGER" || role === "PRO") return "pro";
  if (role === "PAID") return "paid";
  return "free"; // FREE, DEMO, unknown
}

/** Get the subscription tier for a specific user (from DB). */
export async function getSubscriptionTier(userId: string): Promise<AppTier> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return roleToSubscriptionTier(user?.role ?? "FREE");
}

// ----- combined availability check -----

/**
 * Whether `appId` is accessible for `userId`, combining the global kill
 * switch, the per-user VUT grant, and the tier system.
 * Returns "full" (unlocked), "preview" (locked but visible), or "hidden".
 */
export async function getAppAccessFor(userId: string, appId: string): Promise<AppAccess> {
  if (UNDISABLEABLE_APPS.has(appId)) return "full";
  const disabled = await getGlobalDisabledApps();
  if (disabled.has(appId)) return "hidden";
  if (VUT_GRANT_APPS.has(appId)) {
    return (await getVutGrant(userId)) ? "full" : "hidden";
  }
  const appTier = await getAppTier(appId);
  const userTier = await getSubscriptionTier(userId);
  if (TIER_RANK[userTier] >= TIER_RANK[appTier]) return "full";
  return "preview";
}

/**
 * Legacy boolean check — returns true only for "full" access.
 * Kept for backward compatibility with routes that just need a boolean.
 */
export async function isAppAvailableFor(userId: string, appId: string): Promise<boolean> {
  return (await getAppAccessFor(userId, appId)) === "full";
}
