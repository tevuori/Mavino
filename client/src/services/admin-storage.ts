import { api } from "./api";

export interface StorageQuota {
  role: string;
  enabled: boolean;
  maxBytes: number;
}

export const adminStorageApi = {
  listQuotas: () =>
    api.get<{ quotas: StorageQuota[] }>("/api/admin/storage/quotas"),
  getQuota: (role: string) =>
    api.get<StorageQuota>(`/api/admin/storage/quotas/${encodeURIComponent(role)}`),
  setQuota: (role: string, data: { enabled: boolean; maxBytes: number }) =>
    api.put<StorageQuota>(
      `/api/admin/storage/quotas/${encodeURIComponent(role)}`,
      data
    ),
};
