// ===== Admin storage quota management =====
// Lets admins view and edit per-role storage caps. Only admins can access.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import { getQuota, setQuota, listQuotas } from "../services/storage-quota";

const adminStorage = new Hono();
adminStorage.use("*", authMiddleware, adminMiddleware);

/** GET /api/admin/storage/quotas — list quotas for all roles. */
adminStorage.get("/quotas", async (c) => {
  const quotas = await listQuotas();
  return c.json({ quotas });
});

/** GET /api/admin/storage/quotas/:role — quota for a single role. */
adminStorage.get("/quotas/:role", async (c) => {
  const role = c.req.param("role").toUpperCase();
  const quota = await getQuota(role);
  return c.json({ role, ...quota });
});

const quotaSchema = z.object({
  enabled: z.boolean(),
  maxBytes: z.number().int().min(0).max(100 * 1024 * 1024 * 1024), // max 100 TB
});

/** PUT /api/admin/storage/quotas/:role — update a role's quota. */
adminStorage.put("/quotas/:role", zValidator("json", quotaSchema), async (c) => {
  const role = c.req.param("role").toUpperCase();
  const body = c.req.valid("json");
  await setQuota(role, body);
  const quota = await getQuota(role);
  return c.json({ ok: true, role, ...quota });
});

export default adminStorage;
