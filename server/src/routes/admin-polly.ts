import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import { clearPollyConfig, getPollyConfigStatus, savePollyConfig, testPollyConfig } from "../services/polly-config";

const adminPolly = new Hono();
adminPolly.use("*", authMiddleware, adminMiddleware);

adminPolly.get("/", async (c) => c.json(await getPollyConfigStatus()));

const configSchema = z.object({
  accessKeyId: z.string().min(16).max(128),
  secretAccessKey: z.string().min(20).max(256),
  sessionToken: z.string().max(4096).optional(),
  region: z.string().regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/),
});

adminPolly.put("/", zValidator("json", configSchema), async (c) => {
  const config = c.req.valid("json");
  await testPollyConfig(config);
  await savePollyConfig(config);
  return c.json({ ok: true, ...(await getPollyConfigStatus()) });
});

adminPolly.post("/test", async (c) => c.json(await testPollyConfig()));

adminPolly.delete("/", async (c) => {
  await clearPollyConfig();
  return c.json({ ok: true });
});

export default adminPolly;
