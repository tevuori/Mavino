import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { encryptSecret, decryptSecret } from "../services/crypto";
import { isLlmConfiguredFor, normalizeModelId } from "../services/athena/llm";
import { llmRateLimiter } from "../services/athena/rate-limiter";
import { getGlobalLlmConfig, getRateLimitsForUser } from "../services/llm-config";
import { getBudgetSnapshot } from "../services/llm-budget";

const ai = new Hono();
ai.use("*", authMiddleware);

// ---------- API key management ----------

const keySchema = z.object({
  apiKey: z.string().min(1).max(512),
  provider: z.string().max(64).optional(), // multi-llm-ts engine id
  baseUrl: z.string().url().max(512).optional().or(z.literal("")),
  modelId: z.string().max(128).optional().or(z.literal("")),
});

const rateLimitSchema = z.object({
  rateLimitEnabled: z.boolean().optional(),
  rateLimitRpd: z.number().int().min(1).max(10000).optional(),
  rateLimitRpm: z.number().int().min(1).max(1000).optional(),
});

const fallbackSchema = z.object({
  fallbackApiKey: z.string().max(512).optional().or(z.literal("")),
  fallbackProvider: z.string().max(64).optional(),
  fallbackBaseUrl: z.string().url().max(512).optional().or(z.literal("")),
  fallbackModelId: z.string().max(128).optional().or(z.literal("")),
});

function decryptSafe(enc: string): string | null {
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

/** GET /api/ai/key — reports whether a key is set (never returns the secret). */
ai.get("/key", async (c) => {
  const { userId } = c.get("auth");
  const [cred, user, globalConfig, tierConfig, budget] = await Promise.all([
    prisma.aiCredential.findUnique({ where: { userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { aiSource: true, ageBand: true, guardianConsentStatus: true },
    }),
    getGlobalLlmConfig(),
    getRateLimitsForUser(userId),
    getBudgetSnapshot(userId),
  ]);
  const stats = llmRateLimiter.stats(userId);
  const { tier, limits } = tierConfig;
  const provider = cred?.provider ?? "openai";
  return c.json({
    hasKey: Boolean(cred),
    provider,
    baseUrl: cred?.baseUrl ?? "",
    modelId: normalizeModelId(provider, cred?.modelId ?? ""),
    configured: await isLlmConfiguredFor(userId),
    rateLimitEnabled: cred?.rateLimitEnabled ?? false,
    rateLimitRpd: cred?.rateLimitRpd ?? 50,
    rateLimitRpm: cred?.rateLimitRpm ?? 20,
    hasFallback: Boolean(cred?.fallbackApiKeyEnc),
    fallbackProvider: cred?.fallbackProvider ?? "",
    fallbackBaseUrl: cred?.fallbackBaseUrl ?? "",
    fallbackModelId: normalizeModelId(cred?.fallbackProvider ?? "openai", cred?.fallbackModelId ?? ""),
    rateLimitUsage: stats,
    // Global mode info
    llmMode: globalConfig.mode,
    globalKeySet: globalConfig.hasKey,
    // User's tier + applicable rate limits
    tier,
    tierRateLimits: limits,
    aiSource: user?.aiSource ?? "choice_required",
    ageBand: user?.ageBand ?? "UNKNOWN",
    guardianConsentStatus: user?.guardianConsentStatus ?? "NOT_REQUIRED",
    budget,
  });
});

const sourceSchema = z.object({ source: z.enum(["hosted", "byok"]) });

ai.put("/source", zValidator("json", sourceSchema), async (c) => {
  const { userId } = c.get("auth");
  const { source } = c.req.valid("json");
  if (source === "byok") {
    const credential = await prisma.aiCredential.findUnique({ where: { userId } });
    if (!credential || credential.status !== "active") {
      return c.json({ error: "Connect and validate your provider before selecting BYOK." }, 400);
    }
  } else {
    const config = await getGlobalLlmConfig();
    if (!config.hasKey && !process.env.OPENAI_API_KEY) {
      return c.json({ error: "Mavino-hosted AI is not configured." }, 503);
    }
  }
  await prisma.user.update({ where: { id: userId }, data: { aiSource: source } });
  return c.json({ ok: true, source });
});

/** PUT /api/ai/key — store (or replace) the user's encrypted API key + provider config. */
ai.put("/key", zValidator("json", keySchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const enc = encryptSecret(body.apiKey.trim());
  const provider = body.provider?.trim() || "openai";
  const baseUrl = body.baseUrl?.trim() || null;
  const rawModelId = body.modelId?.trim() || null;
  const modelId = rawModelId ? normalizeModelId(provider, rawModelId) : null;
  const cred = await prisma.aiCredential.upsert({
    where: { userId },
    create: { userId, apiKeyEnc: enc, provider, baseUrl, modelId, status: "active" },
    update: { apiKeyEnc: enc, provider, baseUrl, modelId, status: "active", lastError: null },
  });
  return c.json({ ok: true, provider: cred.provider });
});

/** DELETE /api/ai/key — remove the user's stored key. */
ai.delete("/key", async (c) => {
  const { userId } = c.get("auth");
  try {
    await prisma.aiCredential.delete({ where: { userId } });
  } catch {
    // already absent
  }
  await prisma.user.updateMany({ where: { id: userId, aiSource: "byok" }, data: { aiSource: "choice_required" } });
  llmRateLimiter.reset(userId);
  return c.json({ ok: true });
});

/** PUT /api/ai/rate-limit — update rate limit settings. */
ai.put("/rate-limit", zValidator("json", rateLimitSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const cred = await prisma.aiCredential.findUnique({ where: { userId } });
  if (!cred) return c.json({ error: "Set an API key first." }, 400);
  await prisma.aiCredential.update({
    where: { userId },
    data: {
      ...(body.rateLimitEnabled !== undefined && { rateLimitEnabled: body.rateLimitEnabled }),
      ...(body.rateLimitRpd !== undefined && { rateLimitRpd: body.rateLimitRpd }),
      ...(body.rateLimitRpm !== undefined && { rateLimitRpm: body.rateLimitRpm }),
    },
  });
  llmRateLimiter.reset(userId);
  return c.json({ ok: true });
});

/** PUT /api/ai/fallback — update fallback LLM config. */
ai.put("/fallback", zValidator("json", fallbackSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const cred = await prisma.aiCredential.findUnique({ where: { userId } });
  if (!cred) return c.json({ error: "Set an API key first." }, 400);

  const data: Record<string, string | null> = {};
  if (body.fallbackApiKey !== undefined) {
    data.fallbackApiKeyEnc = body.fallbackApiKey.trim()
      ? encryptSecret(body.fallbackApiKey.trim())
      : null;
  }
  if (body.fallbackProvider !== undefined) {
    data.fallbackProvider = body.fallbackProvider.trim() || null;
  }
  if (body.fallbackBaseUrl !== undefined) {
    data.fallbackBaseUrl = body.fallbackBaseUrl.trim() || null;
  }
  if (body.fallbackModelId !== undefined) {
    const fallbackProvider = (data.fallbackProvider as string | null | undefined) ?? cred?.fallbackProvider ?? "openai";
    const rawFallbackModelId = body.fallbackModelId.trim() || null;
    data.fallbackModelId = rawFallbackModelId
      ? normalizeModelId(fallbackProvider, rawFallbackModelId)
      : null;
  }

  await prisma.aiCredential.update({ where: { userId }, data });
  return c.json({ ok: true });
});

export default ai;
