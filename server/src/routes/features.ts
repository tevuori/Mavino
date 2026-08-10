// ===== Feature flags routes =====
// Per-user subscription tier, app tier assignments, admin global app
// kill-switch, and admin per-user VUT access grants. Backed by
// services/features.ts (Setting key/value rows).

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware, adminOrManagerMiddleware } from "../middleware/admin";
import prisma from "../db/client";
import {
  ALL_APP_IDS,
  VUT_GRANT_APPS,
  UNDISABLEABLE_APPS,
  getAppTiers,
  setAppTier,
  setAppTiers,
  getVutGrant,
  setVutGrant,
  getGlobalDisabledApps,
  setGlobalDisabledApps,
  getSubscriptionTier,
  type AppTier,
} from "../services/features";

const features = new Hono();
features.use("*", authMiddleware);

/** App catalog entry returned to admins. */
function appCatalog(appTiers: Record<string, AppTier>) {
  return ALL_APP_IDS.map((id) => ({
    id,
    minTier: appTiers[id] ?? "free",
    requiresGrant: VUT_GRANT_APPS.has(id) ? "vut" : undefined,
    undisableable: UNDISABLEABLE_APPS.has(id),
  }));
}

// ----- user: own feature state -----

/** GET /api/features — current user's feature state. */
features.get("/", async (c) => {
  const { userId } = c.get("auth");
  const [subscriptionTier, vutGranted, disabled, appTiers] = await Promise.all([
    getSubscriptionTier(userId),
    getVutGrant(userId),
    getGlobalDisabledApps(),
    getAppTiers(),
  ]);
  return c.json({
    subscriptionTier,
    vutGranted,
    disabledApps: Array.from(disabled),
    appTiers,
  });
});

// ----- admin: app tier management + global kill switch -----

const admin = new Hono();

/** GET /api/features/admin — app catalog + currently disabled apps. */
admin.get("/", adminMiddleware, async (c) => {
  const [disabled, appTiers] = await Promise.all([
    getGlobalDisabledApps(),
    getAppTiers(),
  ]);
  return c.json({
    apps: appCatalog(appTiers),
    disabledApps: Array.from(disabled),
  });
});

const disabledSchema = z.object({ apps: z.array(z.string()) });

/** PUT /api/features/admin/disabled — set the global disabled-apps list. */
admin.put("/disabled", adminMiddleware, zValidator("json", disabledSchema), async (c) => {
  const { apps } = c.req.valid("json");
  await setGlobalDisabledApps(apps);
  const disabled = await getGlobalDisabledApps();
  return c.json({ disabledApps: Array.from(disabled) });
});

const tierSchema = z.object({
  appId: z.string(),
  tier: z.enum(["free", "paid", "pro"]),
});

/** PUT /api/features/admin/tiers — set the tier for a single app. */
admin.put("/tiers", adminMiddleware, zValidator("json", tierSchema), async (c) => {
  const { appId, tier } = c.req.valid("json");
  await setAppTier(appId, tier as AppTier);
  const appTiers = await getAppTiers();
  return c.json({ appTiers });
});

const bulkTierSchema = z.object({
  assignments: z.record(z.string(), z.enum(["free", "paid", "pro"])),
});

/** PUT /api/features/admin/tiers/bulk — set tiers for multiple apps at once. */
admin.put("/tiers/bulk", adminMiddleware, zValidator("json", bulkTierSchema), async (c) => {
  const { assignments } = c.req.valid("json");
  await setAppTiers(assignments as Record<string, AppTier>);
  const appTiers = await getAppTiers();
  return c.json({ appTiers });
});

// ----- admin: per-user VUT grants (admin or manager) -----

/** GET /api/features/admin/users/:userId/grants — a user's access grants. */
admin.get("/users/:userId/grants", adminOrManagerMiddleware, async (c) => {
  const userId = c.req.param("userId")!;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return c.json({ error: "User not found" }, 404);
  const vut = await getVutGrant(userId);
  return c.json({ vut });
});

const grantSchema = z.object({ vut: z.boolean() });

/** PUT /api/features/admin/users/:userId/grants — set a user's VUT access. */
admin.put("/users/:userId/grants", adminOrManagerMiddleware, zValidator("json", grantSchema), async (c) => {
  const userId = c.req.param("userId")!;
  const { vut } = c.req.valid("json");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return c.json({ error: "User not found" }, 404);
  await setVutGrant(userId, vut);
  return c.json({ vut });
});

features.route("/admin", admin);

export default features;
