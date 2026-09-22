import { api } from "./api";
import type { LlmMode, RateTier } from "./ai";

export interface GlobalLlmConfig {
  mode: LlmMode;
  hasKey: boolean;
  provider: string;
  baseUrl: string;
  modelId: string;
}

export interface TierRateLimits {
  rpd: number;
  rpm: number;
}

export type TierRateLimitsMap = Record<RateTier, TierRateLimits>;

export interface HostedBudgetConfig {
  enabled: boolean;
  reservationMicros: number;
  maxOperationMicros: number;
  globalMonthlyMicros: number;
  tiers: Record<RateTier, number>;
}

export interface AdminUsageStats {
  monthStart: string;
  monthEnd: string;
  global: { limitMicros: number; spentMicros: number; reservedMicros: number; remainingMicros: number };
  totals: {
    requests: number;
    completed: number;
    estimated: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
  };
  byTier: Array<{ tier: RateTier; requests: number; costMicros: number }>;
  bySource: Array<{ source: string; requests: number; costMicros: number }>;
  byFeature: Array<{ feature: string; requests: number; costMicros: number }>;
  byModel: Array<{ provider: string; modelId: string; requests: number; costMicros: number }>;
  topUsers: Array<{ userId: string; username: string; tier: RateTier; requests: number; costMicros: number }>;
  daily: Array<{ day: string; requests: number; costMicros: number }>;
  reservations: { active: number; activeMicros: number };
}

export interface DemoConfig {
  enabled: boolean;
  hasKey: boolean;
  provider: string;
  baseUrl: string;
  modelId: string;
  ttlHours: number;
  rateLimits: { rpd: number; rpm: number };
}

export const adminLlmApi = {
  getConfig: () => api.get<GlobalLlmConfig>("/api/admin/llm"),
  setMode: (mode: LlmMode) => api.put<{ ok: boolean; mode: LlmMode }>("/api/admin/llm/mode", { mode }),
  setKey: (data: { apiKey: string; provider?: string; baseUrl?: string; modelId?: string }) =>
    api.put<{ ok: boolean }>("/api/admin/llm/key", data),
  deleteKey: () => api.delete<{ ok: boolean }>("/api/admin/llm/key"),
  getRateLimits: () => api.get<TierRateLimitsMap>("/api/admin/llm/rate-limits"),
  setRateLimits: (data: {
    proRpd?: number;
    proRpm?: number;
    paidRpd?: number;
    paidRpm?: number;
    freeRpd?: number;
    freeRpm?: number;
  }) => api.put<{ ok: boolean }>("/api/admin/llm/rate-limits", data),
  getHostedBudget: () => api.get<HostedBudgetConfig>("/api/admin/llm/hosted-budget"),
  setHostedBudget: (data: Partial<Omit<HostedBudgetConfig, "tiers">> & {
    tiers?: Partial<Record<RateTier, number>>;
  }) => api.put<{ ok: boolean }>("/api/admin/llm/hosted-budget", data),
  getUsage: () => api.get<AdminUsageStats>("/api/admin/llm/usage"),
  getDemoConfig: () => api.get<DemoConfig>("/api/admin/llm/demo"),
  setDemoConfig: (data: {
    enabled?: boolean;
    apiKey?: string;
    provider?: string;
    baseUrl?: string;
    modelId?: string;
    ttlHours?: number;
    rpd?: number;
    rpm?: number;
  }) => api.put<{ ok: boolean; config: DemoConfig }>("/api/admin/llm/demo", data),
  cleanupDemoUsers: () => api.post<{ ok: boolean; deleted: number }>("/api/admin/llm/demo/cleanup"),
};
