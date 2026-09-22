// ===== Athena LLM client (multi-llm-ts) =====
// Unified LLM access via https://github.com/nbonamy/multi-llm-ts
//
// Per-user config (encrypted in DB, AiCredential) takes priority over the
// server-wide fallback env vars below. If neither is configured, the LLM
// is unavailable — the user must provide their own API key.
//
// Env vars (server-wide fallback, all optional):
//   OPENAI_PROVIDER   — multi-llm-ts engine id (default "openai")
//   OPENAI_API_KEY    — Bearer token
//   OPENAI_BASE_URL   — base URL (optional, for OpenAI-compatible endpoints)
//   OPENAI_MODEL      — model id (optional)

import { randomUUID } from "node:crypto";
import {
  igniteModel,
  type LlmModel,
  type EngineCreateOpts,
  type ChatModel,
} from "multi-llm-ts";
import prisma from "../../db/client";
import { decryptSecret } from "../crypto";
import { llmRateLimiter } from "./rate-limiter";
import { getGlobalLlmConfig, getGlobalLlmSecrets, getRateLimitsForUser } from "../llm-config";
import { getDemoLlmSecrets } from "../demo";
import { releaseBudgetReservation, reserveHostedBudget, type BudgetSnapshot } from "../llm-budget";
import { getModelPrice } from "../llm-pricing";
import { meterModel, type LlmSource } from "../llm-usage";

export interface LlmUserConfig {
  /** multi-llm-ts engine id: "openai" | "deepseek" | "anthropic" | "openrouter" | "ollama" | ... */
  provider: string;
  apiKey: string;
  baseURL?: string;
  modelId: string;
}

export interface RateLimitConfig {
  enabled: boolean;
  rpd: number; // requests per day
  rpm: number; // requests per minute
}

export interface FallbackLlmConfig {
  provider: string;
  apiKey: string;
  baseURL?: string;
  modelId: string;
}

/** Result of acquireLlmModel — includes the model to use + rate limit metadata. */
export interface AcquiredModel {
  model: LlmModel;
  source: LlmSource;
  requestId: string;
  budget: BudgetSnapshot | null;
  /** True if the primary model was rate-limited and the fallback was used. */
  usingFallback: boolean;
  /** Current rate limit status (null if rate limiting is disabled). */
  rateLimit: {
    allowed: boolean;
    dayCount: number;
    minuteCount: number;
    dayLimit: number;
    minuteLimit: number;
  } | null;
}

const SERVER_KEY = process.env.OPENAI_API_KEY ?? "";
const SERVER_BASE_URL = process.env.OPENAI_BASE_URL ?? "";
const SERVER_MODEL = process.env.OPENAI_MODEL ?? "";
const SERVER_PROVIDER = process.env.OPENAI_PROVIDER ?? "openai";

/** Provider-specific default model IDs. Prevents falling back to OpenAI's
 *  `gpt-4o-mini` when the user has configured a different provider. */
const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  openai: "gpt-4o-mini",
  google: "gemini-3.8-flash",
  anthropic: "claude-3-5-sonnet-20241022",
  deepseek: "deepseek-chat",
  groq: "llama-3.1-70b-versatile",
  openrouter: "openrouter/auto",
  xai: "grok-2",
  mistralai: "mistral-large-latest",
  cerebras: "llama3.1-70b",
};

function providerDefaultModel(provider: string): string {
  return PROVIDER_DEFAULT_MODEL[provider] ?? "gpt-4o-mini";
}

/** Known vision-capable model name patterns (provider-agnostic fallback). */
const VISION_PATTERNS: RegExp[] = [
  /gpt-4o/,
  /gpt-4-turbo/,
  /gpt-4-vision/,
  /gemini/,
  /claude-3/,
  /pixtral/,
  /llama-?3\.2-vision/,
  /llama-?4/i,
  /grok-vision/,
  /qwen2-vl/i,
  /phi-4-multimodal/i,
  /deepseek-flash/i,
];

/** Return true if the provider+model combination is known to support image input. */
export function modelSupportsVision(provider: string, modelId: string): boolean {
  const id = `${provider}:${modelId}`.toLowerCase();
  return VISION_PATTERNS.some((p) => p.test(id));
}

/** Map known deprecated/shutdown models to current replacements so existing
 *  stored credentials don't break after a provider retires a model. */
const DEPRECATED_MODELS: Record<string, Record<string, string>> = {
  google: {
    "gemini-2.0-flash": "gemini-3.8-flash",
    "gemini-2.0-flash-001": "gemini-3.8-flash",
    "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.0-flash-lite-001": "gemini-3.5-flash-lite",
    "gemini-2.5-flash": "gemini-3.8-flash",
    "gemini-2.5-flash-001": "gemini-3.8-flash",
    "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite-001": "gemini-3.5-flash-lite",
    "gemini-2.5-flash-preview-05-20": "gemini-3.8-flash",
    "gemini-2.5-flash-preview-09-25": "gemini-3.8-flash",
    "gemini-2.5-flash-lite-preview-09-2025": "gemini-3.5-flash-lite",
  },
};

export function normalizeModelId(provider: string, modelId: string): string {
  const map = DEPRECATED_MODELS[provider];
  if (!map) return modelId;
  return map[modelId] ?? modelId;
}

export class LlmError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function decryptSafe(enc: string): string | null {
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

/** Resolve the user's LLM config.
 *
 * Priority (when global mode is "global"):
 *   1. Global LLM key (admin-configured) — per-user keys are ignored.
 *   2. Server-wide env vars (OPENAI_API_KEY, etc.) — fallback if no global key.
 *
 * Priority (when global mode is "per-user"):
 *   1. Per-user AiCredential (encrypted in DB).
 *   2. Server-wide env vars.
 *   3. No config — LLM unavailable.
 *
 * Returns apiKey="" if nothing is configured — callers should check isLlmConfiguredFor().
 */
function getServerConfig(): LlmUserConfig {
  return {
    provider: SERVER_PROVIDER,
    apiKey: SERVER_KEY,
    baseURL: SERVER_BASE_URL || undefined,
    modelId: SERVER_MODEL || (SERVER_KEY ? providerDefaultModel(SERVER_PROVIDER) : ""),
  };
}

async function getHostedConfig(): Promise<LlmUserConfig> {
  const secrets = await getGlobalLlmSecrets();
  if (secrets) {
    return {
      provider: secrets.provider,
      apiKey: secrets.apiKey,
      baseURL: secrets.baseUrl,
      modelId: secrets.modelId,
    };
  }
  return getServerConfig();
}

async function getByokConfig(userId: string): Promise<LlmUserConfig> {
  const cred = await prisma.aiCredential.findUnique({ where: { userId } });
  if (cred?.status === "active") {
    const apiKey = decryptSafe(cred.apiKeyEnc);
    if (apiKey?.trim()) {
      const provider = cred.provider?.trim() || "openai";
      return {
        provider,
        apiKey: apiKey.trim(),
        baseURL: cred.baseUrl?.trim() || undefined,
        modelId: normalizeModelId(provider, cred.modelId?.trim() || providerDefaultModel(provider)),
      };
    }
  }
  return { provider: "openai", apiKey: "", modelId: "" };
}

export async function getUserConfig(userId: string): Promise<LlmUserConfig> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, aiSource: true },
  });

  if (user?.role === "DEMO") {
    const demo = await getDemoLlmSecrets();
    if (demo) {
      return {
        provider: demo.provider,
        apiKey: demo.apiKey,
        baseURL: demo.baseUrl,
        modelId: demo.modelId,
      };
    }
  }

  const globalConfig = await getGlobalLlmConfig();
  if (globalConfig.mode === "global") return getHostedConfig();
  if (globalConfig.mode === "hybrid") {
    if (user?.aiSource === "hosted") return getHostedConfig();
    if (user?.aiSource === "byok") return getByokConfig(userId);
    return { provider: "openai", apiKey: "", modelId: "" };
  }

  const byok = await getByokConfig(userId);
  if (byok.apiKey) return byok;
  return getServerConfig();
}

/** Returns true if at least one key source is configured. */
export async function isLlmConfiguredFor(userId: string): Promise<boolean> {
  const cfg = await getUserConfig(userId);
  return Boolean(cfg.apiKey);
}

/** Build a fresh LlmModel for a request. Cheap — no network call (loadModels skipped). */
export function buildModel(cfg: LlmUserConfig): LlmModel {
  const config: EngineCreateOpts = { apiKey: cfg.apiKey };
  if (cfg.baseURL) config.baseURL = cfg.baseURL;
  // requestCooldown avoids rate-limit hits during multi-step tool loops.
  config.requestCooldown = 1500;
  // Pass an explicit ChatModel with tools enabled so tool calling works
  // regardless of how the provider names the model (the OpenAI engine infers
  // capabilities from the model id, which is unreliable for custom endpoints).
  // Enable vision when the model name matches a known vision-capable family so
  // image attachments can be sent to providers like Gemini, GPT-4o, and Claude 3.
  const chatModel: ChatModel = {
    id: cfg.modelId,
    name: cfg.modelId,
    capabilities: {
      tools: true,
      vision: modelSupportsVision(cfg.provider, cfg.modelId),
      reasoning: false,
      caching: false,
    },
  };
  return igniteModel(cfg.provider, chatModel, config);
}

/** Get the user's rate limit config from DB (or null if not configured). */
export async function getRateLimitConfig(userId: string): Promise<RateLimitConfig | null> {
  const cred = await prisma.aiCredential.findUnique({ where: { userId } });
  if (!cred || !cred.rateLimitEnabled) return null;
  return {
    enabled: cred.rateLimitEnabled,
    rpd: cred.rateLimitRpd,
    rpm: cred.rateLimitRpm,
  };
}

/** Get the user's fallback LLM config from DB (or null if not configured). */
export async function getFallbackConfig(userId: string): Promise<FallbackLlmConfig | null> {
  const cred = await prisma.aiCredential.findUnique({ where: { userId } });
  if (!cred || !cred.fallbackApiKeyEnc) return null;
  const apiKey = decryptSafe(cred.fallbackApiKeyEnc);
  if (!apiKey || !apiKey.trim()) return null;
  const provider = cred.fallbackProvider?.trim() || "openai";
  return {
    provider,
    apiKey: apiKey.trim(),
    baseURL: cred.fallbackBaseUrl?.trim() || undefined,
    modelId: normalizeModelId(provider, cred.fallbackModelId?.trim() || providerDefaultModel(provider)),
  };
}

/**
 * Acquire an LLM model for a request, respecting rate limits.
 *
 * In global mode:
 *   - Tier-based rate limits apply (admin = unlimited, paid = higher, free = lower).
 *   - Per-user rate limit config is ignored.
 *   - No fallback (the global key is the only key).
 *
 * In per-user mode:
 *   - The user's own rate limit config applies (if enabled).
 *   - Fallback to the user's fallback LLM if configured.
 *
 * Use this instead of `getUserConfig + buildModel` for all LLM requests.
 */
export async function acquireLlmModel(
  userId: string,
  context: { feature?: string; requestedMicros?: number } = {}
): Promise<AcquiredModel> {
  const [cfg, globalConfig, user, credential] = await Promise.all([
    getUserConfig(userId),
    getGlobalLlmConfig(),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, aiSource: true } }),
    prisma.aiCredential.findUnique({ where: { userId }, select: { status: true } }),
  ]);
  if (!user) throw new LlmError(404, "User not found.");
  if (!cfg.apiKey) {
    const message = globalConfig.mode === "hybrid" && user.aiSource === "choice_required"
      ? "Choose Mavino-hosted AI or your own provider in Settings → Mavino Assistant."
      : "No AI provider configured.";
    throw new LlmError(400, message);
  }

  let source: LlmSource;
  if (user.role === "DEMO") source = "demo";
  else if (globalConfig.mode === "global") source = "hosted";
  else if (globalConfig.mode === "hybrid") source = user.aiSource === "byok" ? "byok" : "hosted";
  else source = credential?.status === "active" ? "byok" : "hosted";

  let requestId: string = randomUUID();
  let budget: BudgetSnapshot | null = null;
  if (globalConfig.mode === "hybrid" && source === "hosted") {
    if (!getModelPrice(cfg.provider, cfg.modelId)) {
      throw new LlmError(500, `Hosted model ${cfg.provider}:${cfg.modelId} has no pricing configuration.`);
    }
    try {
      const reservation = await reserveHostedBudget(userId, context.requestedMicros);
      requestId = reservation.requestId;
      budget = reservation.snapshot;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "HOSTED_DISABLED") throw new LlmError(503, "Mavino-hosted AI is temporarily disabled.");
      if (code === "BUDGET_EXHAUSTED") throw new LlmError(402, "Your monthly AI allowance is exhausted.");
      if (code === "GLOBAL_BUDGET_EXHAUSTED") throw new LlmError(503, "The hosted AI monthly budget is exhausted.");
      throw error;
    }
  }

  const wrap = (config: LlmUserConfig, usingFallback: boolean, rateLimit: AcquiredModel["rateLimit"]): AcquiredModel => ({
    model: meterModel(buildModel(config), {
      userId,
      source,
      provider: config.provider,
      modelId: config.modelId,
      feature: context.feature ?? "unknown",
      requestId,
    }),
    source,
    requestId,
    budget,
    usingFallback,
    rateLimit,
  });

  if (source === "hosted" || source === "demo") {
    const { tier, limits } = await getRateLimitsForUser(userId);
    if (limits.rpd === 0 && limits.rpm === 0) {
      const stats = llmRateLimiter.stats(userId);
      return wrap(cfg, false, {
        allowed: true,
        dayCount: stats.dayCount,
        minuteCount: stats.minuteCount,
        dayLimit: 0,
        minuteLimit: 0,
      });
    }
    const status = llmRateLimiter.check(userId, limits.rpd, limits.rpm);
    if (!status.allowed) {
      if (budget) await releaseBudgetReservation(requestId);
      throw new LlmError(
        429,
        `Rate limit reached (${tier} tier): ${status.dayCount}/${status.dayLimit} requests today, ${status.minuteCount}/${status.minuteLimit} per minute. Try again later.`
      );
    }
    llmRateLimiter.record(userId);
    return wrap(cfg, false, status);
  }

  const rateLimitCfg = await getRateLimitConfig(userId);
  if (!rateLimitCfg?.enabled) return wrap(cfg, false, null);
  const status = llmRateLimiter.check(userId, rateLimitCfg.rpd, rateLimitCfg.rpm);
  if (status.allowed) {
    llmRateLimiter.record(userId);
    return wrap(cfg, false, status);
  }
  const fallback = await getFallbackConfig(userId);
  if (fallback) return wrap(fallback, true, status);
  throw new LlmError(
    429,
    `Rate limit reached: ${status.dayCount}/${status.dayLimit} requests today, ${status.minuteCount}/${status.minuteLimit} per minute. Configure a fallback model in Settings → AI to continue when limits are hit.`
  );
}
