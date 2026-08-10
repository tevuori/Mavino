// ===== Global LLM configuration =====
// Controls whether the server uses per-user API keys (each user configures
// their own) or a single global key (admin-provided, no user setup needed).
// When mode is "global", all LLM requests use the global key regardless of
// per-user AiCredential — users never need to configure their own key.
//
// All config is stored in the Setting table (userId = null for global).

import prisma from "../db/client";
import { encryptSecret, decryptSecret } from "./crypto";
import { getDemoConfig } from "./demo";

export type LlmMode = "per-user" | "global";

export interface GlobalLlmConfig {
  mode: LlmMode;
  hasKey: boolean;
  provider: string;
  baseUrl: string;
  modelId: string;
}

export interface GlobalLlmSecrets {
  apiKey: string;
  provider: string;
  baseUrl?: string;
  modelId: string;
}

const MODE_KEY = "llm.mode";
const KEY_KEY = "llm.global.key";
const PROVIDER_KEY = "llm.global.provider";
const BASEURL_KEY = "llm.global.baseUrl";
const MODELID_KEY = "llm.global.modelId";

async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.setting.findFirst({ where: { userId: null, key } });
  return s?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const existing = await prisma.setting.findFirst({ where: { userId: null, key } });
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { userId: null, key, value } });
  }
}

/** Get the global LLM config (never returns the decrypted key). */
export async function getGlobalLlmConfig(): Promise<GlobalLlmConfig> {
  const [mode, keyEnc, provider, baseUrl, modelId] = await Promise.all([
    getSetting(MODE_KEY),
    getSetting(KEY_KEY),
    getSetting(PROVIDER_KEY),
    getSetting(BASEURL_KEY),
    getSetting(MODELID_KEY),
  ]);
  return {
    mode: (mode === "global" ? "global" : "per-user") as LlmMode,
    hasKey: Boolean(keyEnc),
    provider: provider ?? "openai",
    baseUrl: baseUrl ?? "",
    modelId: modelId ?? "",
  };
}

/** Get the decrypted global LLM key (server-side only). Returns null if not set. */
export async function getGlobalLlmSecrets(): Promise<GlobalLlmSecrets | null> {
  const keyEnc = await getSetting(KEY_KEY);
  if (!keyEnc) return null;
  try {
    const apiKey = decryptSecret(keyEnc);
    if (!apiKey.trim()) return null;
    const [provider, baseUrl, modelId] = await Promise.all([
      getSetting(PROVIDER_KEY),
      getSetting(BASEURL_KEY),
      getSetting(MODELID_KEY),
    ]);
    return {
      apiKey: apiKey.trim(),
      provider: provider?.trim() || "openai",
      baseUrl: baseUrl?.trim() || undefined,
      modelId: modelId?.trim() || "gpt-4o-mini",
    };
  } catch {
    return null;
  }
}

/** Set the global LLM mode. */
export async function setGlobalLlmMode(mode: LlmMode): Promise<void> {
  await setSetting(MODE_KEY, mode);
}

/** Set the global LLM key + provider config. */
export async function setGlobalLlmKey(config: {
  apiKey: string;
  provider?: string;
  baseUrl?: string;
  modelId?: string;
}): Promise<void> {
  const enc = encryptSecret(config.apiKey.trim());
  await setSetting(KEY_KEY, enc);
  await setSetting(PROVIDER_KEY, config.provider?.trim() || "openai");
  await setSetting(BASEURL_KEY, config.baseUrl?.trim() || "");
  await setSetting(MODELID_KEY, config.modelId?.trim() || "");
}

/** Remove the global LLM key. */
export async function clearGlobalLlmKey(): Promise<void> {
  await setSetting(KEY_KEY, "");
  await setSetting(PROVIDER_KEY, "openai");
  await setSetting(BASEURL_KEY, "");
  await setSetting(MODELID_KEY, "");
}

// ----- Rate limit tier config (global, admin-configurable) -----

export type RateTier = "admin" | "pro" | "paid" | "free" | "demo";

export interface TierRateLimits {
  rpd: number; // requests per day (0 = unlimited)
  rpm: number; // requests per minute (0 = unlimited)
}

const DEFAULT_LIMITS: Record<RateTier, TierRateLimits> = {
  admin: { rpd: 0, rpm: 0 }, // unlimited
  pro: { rpd: 2000, rpm: 60 },
  paid: { rpd: 500, rpm: 30 },
  free: { rpd: 50, rpm: 10 },
  demo: { rpd: 100, rpm: 10 },
};

const PRO_RPD_KEY = "ratelimit.pro.rpd";
const PRO_RPM_KEY = "ratelimit.pro.rpm";
const PAID_RPD_KEY = "ratelimit.paid.rpd";
const PAID_RPM_KEY = "ratelimit.paid.rpm";
const FREE_RPD_KEY = "ratelimit.free.rpd";
const FREE_RPM_KEY = "ratelimit.free.rpm";

/** Get the rate limits for each tier (admin-configurable). */
export async function getTierRateLimits(): Promise<Record<RateTier, TierRateLimits>> {
  const [proRpd, proRpm, paidRpd, paidRpm, freeRpd, freeRpm] = await Promise.all([
    getSetting(PRO_RPD_KEY),
    getSetting(PRO_RPM_KEY),
    getSetting(PAID_RPD_KEY),
    getSetting(PAID_RPM_KEY),
    getSetting(FREE_RPD_KEY),
    getSetting(FREE_RPM_KEY),
  ]);
  return {
    admin: DEFAULT_LIMITS.admin, // always unlimited
    pro: {
      rpd: proRpd ? Number(proRpd) : DEFAULT_LIMITS.pro.rpd,
      rpm: proRpm ? Number(proRpm) : DEFAULT_LIMITS.pro.rpm,
    },
    paid: {
      rpd: paidRpd ? Number(paidRpd) : DEFAULT_LIMITS.paid.rpd,
      rpm: paidRpm ? Number(paidRpm) : DEFAULT_LIMITS.paid.rpm,
    },
    free: {
      rpd: freeRpd ? Number(freeRpd) : DEFAULT_LIMITS.free.rpd,
      rpm: freeRpm ? Number(freeRpm) : DEFAULT_LIMITS.free.rpm,
    },
    demo: DEFAULT_LIMITS.demo, // demo limits are controlled in demo config
  };
}

/** Update the rate limits for pro, paid, and/or free tiers. */
export async function setTierRateLimits(config: {
  proRpd?: number;
  proRpm?: number;
  paidRpd?: number;
  paidRpm?: number;
  freeRpd?: number;
  freeRpm?: number;
}): Promise<void> {
  if (config.proRpd !== undefined) await setSetting(PRO_RPD_KEY, String(config.proRpd));
  if (config.proRpm !== undefined) await setSetting(PRO_RPM_KEY, String(config.proRpm));
  if (config.paidRpd !== undefined) await setSetting(PAID_RPD_KEY, String(config.paidRpd));
  if (config.paidRpm !== undefined) await setSetting(PAID_RPM_KEY, String(config.paidRpm));
  if (config.freeRpd !== undefined) await setSetting(FREE_RPD_KEY, String(config.freeRpd));
  if (config.freeRpm !== undefined) await setSetting(FREE_RPM_KEY, String(config.freeRpm));
}

/** Map a user role to a rate tier. */
export function roleToTier(role: string): RateTier {
  if (role === "ADMIN") return "admin";
  if (role === "PRO" || role === "MANAGER") return "pro";
  if (role === "PAID") return "paid";
  if (role === "DEMO") return "demo";
  return "free";
}

/** Get the rate limits that apply to a specific user. */
export async function getRateLimitsForUser(userId: string): Promise<{
  tier: RateTier;
  limits: TierRateLimits;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const tier = roleToTier(user?.role ?? "FREE");
  if (tier === "demo") {
    const cfg = await getDemoConfig();
    return { tier, limits: cfg.rateLimits };
  }
  const allLimits = await getTierRateLimits();
  return { tier, limits: allLimits[tier] };
}
