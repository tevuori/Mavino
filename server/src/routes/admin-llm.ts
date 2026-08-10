import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import {
  getGlobalLlmConfig,
  setGlobalLlmMode,
  setGlobalLlmKey,
  clearGlobalLlmKey,
  getTierRateLimits,
  setTierRateLimits,
  type LlmMode,
} from "../services/llm-config";
import { getDemoConfig, setDemoConfig, type DemoConfigInput } from "../services/demo";

const adminLlm = new Hono();
adminLlm.use("*", authMiddleware, adminMiddleware);

// ---------- Global LLM key ----------

/** GET /api/admin/llm — get global LLM config (never returns the key). */
adminLlm.get("/", async (c) => {
  const config = await getGlobalLlmConfig();
  return c.json(config);
});

const modeSchema = z.object({ mode: z.enum(["per-user", "global"]) });

/** PUT /api/admin/llm/mode — switch between per-user and global key mode. */
adminLlm.put("/mode", zValidator("json", modeSchema), async (c) => {
  const { mode } = c.req.valid("json");
  await setGlobalLlmMode(mode as LlmMode);
  return c.json({ ok: true, mode });
});

const keySchema = z.object({
  apiKey: z.string().min(1).max(512),
  provider: z.string().max(64).optional(),
  baseUrl: z.string().max(512).optional().or(z.literal("")),
  modelId: z.string().max(128).optional().or(z.literal("")),
});

/** PUT /api/admin/llm/key — set the global LLM key + provider config. */
adminLlm.put("/key", zValidator("json", keySchema), async (c) => {
  const body = c.req.valid("json");
  await setGlobalLlmKey({
    apiKey: body.apiKey,
    provider: body.provider,
    baseUrl: body.baseUrl || undefined,
    modelId: body.modelId || undefined,
  });
  return c.json({ ok: true });
});

/** DELETE /api/admin/llm/key — remove the global LLM key. */
adminLlm.delete("/key", async (c) => {
  await clearGlobalLlmKey();
  return c.json({ ok: true });
});

// ---------- Tier rate limits ----------

/** GET /api/admin/llm/rate-limits — get rate limits for each tier. */
adminLlm.get("/rate-limits", async (c) => {
  const limits = await getTierRateLimits();
  return c.json(limits);
});

const rateLimitSchema = z.object({
  paidRpd: z.number().int().min(0).max(100000).optional(),
  paidRpm: z.number().int().min(0).max(10000).optional(),
  freeRpd: z.number().int().min(0).max(100000).optional(),
  freeRpm: z.number().int().min(0).max(10000).optional(),
});

/** PUT /api/admin/llm/rate-limits — update tier rate limits. */
adminLlm.put("/rate-limits", zValidator("json", rateLimitSchema), async (c) => {
  const body = c.req.valid("json");
  await setTierRateLimits(body);
  return c.json({ ok: true });
});

// ---------- Demo mode ----------

/** GET /api/admin/llm/demo — get demo config (no decrypted key). */
adminLlm.get("/demo", async (c) => {
  const config = await getDemoConfig();
  return c.json(config);
});

const demoConfigSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().max(512).optional(),
  provider: z.string().max(64).optional(),
  baseUrl: z.string().max(512).optional().or(z.literal("")),
  modelId: z.string().max(128).optional().or(z.literal("")),
  ttlHours: z.number().int().min(1).max(720).optional(),
  rpd: z.number().int().min(0).max(100000).optional(),
  rpm: z.number().int().min(0).max(10000).optional(),
});

/** PUT /api/admin/llm/demo — save demo config. */
adminLlm.put("/demo", zValidator("json", demoConfigSchema), async (c) => {
  const body = c.req.valid("json") as DemoConfigInput;
  const config = await setDemoConfig(body);
  return c.json({ ok: true, config });
});

export default adminLlm;
