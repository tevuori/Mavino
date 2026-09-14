import { api } from "./api";

export interface PollyAdminConfig { configured: boolean; source: "database" | "environment" | "none"; region: string }

export const adminPollyApi = {
  get: () => api.get<PollyAdminConfig>("/api/admin/polly"),
  save: (data: { accessKeyId: string; secretAccessKey: string; sessionToken?: string; region: string }) => api.put<{ ok: boolean }>("/api/admin/polly", data),
  test: () => api.post<{ ok: boolean; voiceCount: number }>("/api/admin/polly/test", {}),
  remove: () => api.delete<{ ok: boolean }>("/api/admin/polly"),
};
