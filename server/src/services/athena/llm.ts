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
  google: "gemini-3.6-flash",
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

/** Map known deprecated/shutdown models to current replacements so existing
 *  stored credentials don't break after a provider retires a model. */
const DEPRECATED_MODELS: Record<string, Record<string, string>> = {
  google: {
    "gemini-2.0-flash": "gemini-3.6-flash",
    "gemini-2.0-flash-001": "gemini-3.6-flash",
    "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.0-flash-lite-001": "gemini-3.5-flash-lite",
    "gemini-2.5-flash": "gemini-3.6-flash",
    "gemini-2.5-flash-001": "gemini-3.6-flash",
    "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite-001": "gemini-3.5-flash-lite",
    "gemini-2.5-flash-preview-05-20": "gemini-3.6-flash",
    "gemini-2.5-flash-preview-09-25": "gemini-3.6-flash",
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
export async function getUserConfig(userId: string): Promise<LlmUserConfig> {
  const globalConfig = await getGlobalLlmConfig();

  // Global mode: use the admin-configured global key, ignore per-user keys.
  if (globalConfig.mode === "global") {
    const secrets = await getGlobalLlmSecrets();
    if (secrets) {
      return {
        provider: secrets.provider,
        apiKey: secrets.apiKey,
        baseURL: secrets.baseUrl,
        modelId: secrets.modelId,
      };
    }
    // No global key set — fall through to env vars.
    if (SERVER_KEY) {
      return {
        provider: SERVER_PROVIDER,
        apiKey: SERVER_KEY,
        baseURL: SERVER_BASE_URL || undefined,
        modelId: SERVER_MODEL || providerDefaultModel(SERVER_PROVIDER),
      };
    }
    return {
      provider: SERVER_PROVIDER,
      apiKey: "",
      baseURL: undefined,
      modelId: "",
    };
  }

  // Per-user mode: use the user's own key.
  const cred = await prisma.aiCredential.findUnique({ where: { userId } });
  if (cred) {
    const apiKey = decryptSafe(cred.apiKeyEnc);
    if (apiKey && apiKey.trim()) {
      const provider = cred.provider?.trim() || "openai";
      return {
        provider,
        apiKey: apiKey.trim(),
        baseURL: cred.baseUrl?.trim() || undefined,
        modelId: normalizeModelId(provider, cred.modelId?.trim() || SERVER_MODEL || providerDefaultModel(provider)),
      };
    }
  }
  // Server-wide env fallback (optional — may be empty)
  if (SERVER_KEY) {
    return {
      provider: SERVER_PROVIDER,
      apiKey: SERVER_KEY,
      baseURL: SERVER_BASE_URL || undefined,
      modelId: SERVER_MODEL || providerDefaultModel(SERVER_PROVIDER),
    };
  }
  // No config at all — LLM unavailable
  return {
    provider: SERVER_PROVIDER,
    apiKey: "",
    baseURL: undefined,
    modelId: "",
  };
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
  const chatModel: ChatModel = {
    id: cfg.modelId,
    name: cfg.modelId,
    capabilities: { tools: true, vision: false, reasoning: false, caching: false },
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
export async function acquireLlmModel(userId: string): Promise<AcquiredModel> {
  const cfg = await getUserConfig(userId);
  const globalConfig = await getGlobalLlmConfig();

  // Global mode: tier-based rate limits.
  if (globalConfig.mode === "global") {
    const { tier, limits } = await getRateLimitsForUser(userId);

    // Admin tier = unlimited (rpd=0, rpm=0 means no limit).
    if (limits.rpd === 0 && limits.rpm === 0) {
      return {
        model: buildModel(cfg),
        usingFallback: false,
        rateLimit: {
          allowed: true,
          dayCount: llmRateLimiter.stats(userId).dayCount,
          minuteCount: llmRateLimiter.stats(userId).minuteCount,
          dayLimit: 0,
          minuteLimit: 0,
        },
      };
    }

    const status = llmRateLimiter.check(userId, limits.rpd, limits.rpm);
    if (status.allowed) {
      llmRateLimiter.record(userId);
      return {
        model: buildModel(cfg),
        usingFallback: false,
        rateLimit: status,
      };
    }

    // Rate-limited — no fallback in global mode.
    throw new LlmError(
      429,
      `Rate limit reached (${tier} tier): ${status.dayCount}/${status.dayLimit} requests today, ${status.minuteCount}/${status.minuteLimit} per minute. Try again later.`
    );
  }

  // Per-user mode: use the user's own rate limit config.
  const rateLimitCfg = await getRateLimitConfig(userId);

  // No rate limiting — just return the primary model.
  if (!rateLimitCfg || !rateLimitCfg.enabled) {
    return {
      model: buildModel(cfg),
      usingFallback: false,
      rateLimit: null,
    };
  }

  // Check rate limits for the primary model.
  const status = llmRateLimiter.check(userId, rateLimitCfg.rpd, rateLimitCfg.rpm);

  if (status.allowed) {
    // Primary model is available — record the request and return it.
    llmRateLimiter.record(userId);
    return {
      model: buildModel(cfg),
      usingFallback: false,
      rateLimit: status,
    };
  }

  // Primary model is rate-limited — try fallback.
  const fallback = await getFallbackConfig(userId);
  if (fallback) {
    return {
      model: buildModel(fallback),
      usingFallback: true,
      rateLimit: status,
    };
  }

  // No fallback — reject the request.
  throw new LlmError(
    429,
    `Rate limit reached: ${status.dayCount}/${status.dayLimit} requests today, ${status.minuteCount}/${status.minuteLimit} per minute. Configure a fallback model in Settings → AI to continue when limits are hit.`
  );
}
