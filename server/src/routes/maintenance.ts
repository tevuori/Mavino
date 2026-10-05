import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import {
  disableMaintenance,
  getMaintenanceStatus,
  saveMaintenanceConfig,
} from "../services/maintenance";

const maintenance = new Hono();

const configSchema = z.object({
  enabled: z.boolean(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  message: z.string().max(500).default(""),
}).superRefine((value, ctx) => {
  if (value.enabled && value.endsAt && value.startsAt) {
    if (new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "Maintenance end time must be after its start time.",
      });
    }
  }
});

maintenance.get("/status", async (c) => c.json(await getMaintenanceStatus()));

maintenance.get("/admin", authMiddleware, adminMiddleware, async (c) => {
  return c.json(await getMaintenanceStatus());
});

maintenance.put(
  "/admin",
  authMiddleware,
  adminMiddleware,
  zValidator("json", configSchema),
  async (c) => {
    const body = c.req.valid("json");
    await saveMaintenanceConfig(body);
    return c.json(await getMaintenanceStatus());
  }
);

maintenance.delete("/admin", authMiddleware, adminMiddleware, async (c) => {
  await disableMaintenance();
  return c.json(await getMaintenanceStatus());
});

export default maintenance;
