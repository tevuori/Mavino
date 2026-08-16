import { api } from "./api";

export type AppTier = "free" | "paid" | "pro";

export interface AdminAppEntry {
  id: string;
  minTier: AppTier;
  undisableable: boolean;
}

export interface AdminFeaturesState {
  apps: AdminAppEntry[];
  disabledApps: string[];
}

export const featuresAdminApi = {
  getState: () => api.get<AdminFeaturesState>("/api/features/admin"),
  setDisabled: (apps: string[]) =>
    api.put<{ disabledApps: string[] }>("/api/features/admin/disabled", { apps }),
  setAppTier: (appId: string, tier: AppTier) =>
    api.put<{ appTiers: Record<string, AppTier> }>("/api/features/admin/tiers", { appId, tier }),
  setAppTiersBulk: (assignments: Record<string, AppTier>) =>
    api.put<{ appTiers: Record<string, AppTier> }>("/api/features/admin/tiers/bulk", { assignments }),
};
