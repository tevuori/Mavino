import { api } from "./api";

export type LlmMode = "per-user" | "global" | "hybrid";
export type RateTier = "admin" | "pro" | "paid" | "free" | "demo";

export interface TierRateLimits {
  rpd: number; // 0 = unlimited
  rpm: number; // 0 = unlimited
}

export interface AiKeyStatus {
  hasKey: boolean;
  provider: string;
  baseUrl: string;
  modelId: string;
  configured: boolean;
  rateLimitEnabled: boolean;
  rateLimitRpd: number;
  rateLimitRpm: number;
  hasFallback: boolean;
  fallbackProvider: string;
  fallbackBaseUrl: string;
  fallbackModelId: string;
  rateLimitUsage: { dayCount: number; minuteCount: number };
  // Global mode info
  llmMode: LlmMode;
  globalKeySet: boolean;
  // User's tier + applicable rate limits
  tier: RateTier;
  tierRateLimits: TierRateLimits;
  aiSource: "choice_required" | "hosted" | "byok";
  ageBand: "UNKNOWN" | "AGE_13_17" | "AGE_18_PLUS";
  guardianConsentStatus: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REVOKED";
  budget: {
    tier: RateTier;
    limitMicros: number;
    spentMicros: number;
    reservedMicros: number;
    remainingMicros: number;
    resetAt: string;
  };
}

export const aiApi = {
  getKeyStatus: () => api.get<AiKeyStatus>("/api/ai/key"),
  setKey: (apiKey: string, provider?: string, baseUrl?: string, modelId?: string) =>
    api.put<{ ok: boolean; provider: string }>("/api/ai/key", { apiKey, provider, baseUrl, modelId }),
  deleteKey: () => api.delete<{ ok: boolean }>("/api/ai/key"),
  setSource: (source: "hosted" | "byok") =>
    api.put<{ ok: boolean; source: "hosted" | "byok" }>("/api/ai/source", { source }),
  setRateLimit: (data: {
    rateLimitEnabled?: boolean;
    rateLimitRpd?: number;
    rateLimitRpm?: number;
  }) => api.put<{ ok: boolean }>("/api/ai/rate-limit", data),
  setFallback: (data: {
    fallbackApiKey?: string;
    fallbackProvider?: string;
    fallbackBaseUrl?: string;
    fallbackModelId?: string;
  }) => api.put<{ ok: boolean }>("/api/ai/fallback", data),
};
