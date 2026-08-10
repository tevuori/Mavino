// ===== Feature flags routes =====
// Per-user beta toggle, admin global app kill-switch, and admin per-user
// VUT access grants. Backed by services/features.ts (Setting key/value rows).

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware, adminOrManagerMiddleware } from "../middleware/admin";
import prisma from "../db/client";
import {
  ALL_APP_IDS,
  CORE_APPS,
  VUT_GRANT_APPS,
  UNDISABLEABLE_APPS,
  getUserBeta,
  setUserBeta,
  getVutGrant,
  setVutGrant,
  getGlobalDisabledApps,
  setGlobalDisabledApps,
} from "../services/features";

const features = new Hono();
features.use("*", authMiddleware);

/** App catalog entry returned to admins. */
function appCatalog() {
  return ALL_APP_IDS.map((id) => ({
    id,
    tier: CORE_APPS.has(id) ? "core" : "beta",
    requiresGrant: VUT_GRANT_APPS.has(id) ? "vut" : undefined,
    undisableable: UNDISABLEABLE_APPS.has(id),
  }));
}

// ----- user: own feature state + beta toggle -----

/** GET /api/features — current user's feature state. */
features.get("/", async (c) => {
  const { userId } = c.get("auth");
  const [betaEnabled, vutGranted, disabled] = await Promise.all([
    getUserBeta(userId),
    getVutGrant(userId),
    getGlobalDisabledApps(),
  ]);
  return c.json({
    betaEnabled,
    vutGranted,
    disabledApps: Array.from(disabled),
  });
});

const betaSchema = z.object({ enabled: z.boolean() });

/** PUT /api/features/beta — toggle own beta-apps access. */
features.put("/beta", zValidator("json", betaSchema), async (c) => {
  const { userId } = c.get("auth");
  const { enabled } = c.req.valid("json");
  await setUserBeta(userId, enabled);
  return c.json({ betaEnabled: enabled });
});

// ----- admin: global kill switch (admin only) + per-user VUT grants (admin or manager) -----

const admin = new Hono();

/** GET /api/features/admin — app catalog + currently disabled apps. */
admin.get("/", adminMiddleware, async (c) => {
  const disabled = await getGlobalDisabledApps();
  return c.json({
    apps: appCatalog(),
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
