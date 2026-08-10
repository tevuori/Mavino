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
