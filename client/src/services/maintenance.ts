import { api } from "./api";

export interface MaintenanceStatus {
  enabled: boolean;
  active: boolean;
  scheduled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  message: string;
  serverTime: string;
  retryAfterSeconds: number | null;
}

export interface MaintenanceConfig {
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  message: string;
}

export const maintenanceApi = {
  status: () => api.get<MaintenanceStatus>("/api/maintenance/status"),
  adminStatus: () => api.get<MaintenanceStatus>("/api/maintenance/admin"),
  save: (config: MaintenanceConfig) =>
    api.put<MaintenanceStatus>("/api/maintenance/admin", config),
  stop: () => api.delete<MaintenanceStatus>("/api/maintenance/admin"),
};
