import { api } from "./api";
import type { AdminUser, UserRole } from "../types";

export interface OpenTestingConfig {
  enabled: boolean;
  open: boolean;
  maxActiveTesters: number;
  waitlistMessage: string;
}

export interface OpenTestingStats {
  activeTesters: number;
  pendingInvites: number;
  waitlistCount: number;
}

export interface OpenTestingInvite {
  id: string;
  email: string;
  status: "PENDING" | "SENT" | "USED" | "WAITLIST";
  createdAt: string;
  sentAt?: string;
  usedAt?: string;
  expiresAt?: string;
  username?: string | null;
}

export const usersApi = {
  list: () => api.get<AdminUser[]>("/api/users"),
  create: (data: {
    username: string;
    password: string;
    displayName?: string;
    avatarColor?: string;
    role?: UserRole;
  }) => api.post<AdminUser>("/api/users", data),
  update: (
    id: string,
    data: { displayName?: string; avatarColor?: string; role?: UserRole }
  ) => api.patch<AdminUser>(`/api/users/${id}`, data),
  resetPassword: (id: string, password: string) =>
    api.post(`/api/users/${id}/reset-password`, { password }),
  remove: (id: string) => api.delete(`/api/users/${id}`),
  getRegistration: () => api.get<{ enabled: boolean }>("/api/users/registration"),
  setRegistration: (enabled: boolean) =>
    api.put<{ enabled: boolean }>("/api/users/registration", { enabled }),

  // Open testing admin
  getOpenTesting: () => api.get<{ config: OpenTestingConfig; stats: OpenTestingStats }>("/api/admin/open-testing"),
  setOpenTesting: (config: Partial<OpenTestingConfig>) =>
    api.put<{ config: OpenTestingConfig }>("/api/admin/open-testing", config),
  listOpenTestingInvites: () => api.get<OpenTestingInvite[]>("/api/admin/open-testing/invites"),
  sendOpenTestingInvite: (id: string) =>
    api.post<{ ok: boolean; message: string }>(`/api/admin/open-testing/invites/${id}/send`),
  deleteOpenTestingInvite: (id: string) => api.delete(`/api/admin/open-testing/invites/${id}`),
  approveWaitlist: (id: string) =>
    api.post<{ ok: boolean; message: string }>(`/api/admin/open-testing/waitlist/${id}/approve`),
};
