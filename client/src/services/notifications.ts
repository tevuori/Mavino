// ===== Notifications API client =====
// Wraps the /api/notifications endpoints for the notification store + settings UI.

import { api } from "./api";
import type { NotificationItem, NotificationSettings, NotificationCategory } from "../types";

export const notificationsApi = {
  /** List the user's notifications (newest first). */
  list: (opts: { unreadOnly?: boolean; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.unreadOnly) params.set("unreadOnly", "1");
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<{ notifications: NotificationItem[] }>(
      `/api/notifications${qs ? `?${qs}` : ""}`
    );
  },

  /** Lightweight unread count for the badge. */
  unreadCount: () => api.get<{ count: number }>("/api/notifications/unread-count"),

  /** Per-category notification settings. */
  getSettings: () => api.get<NotificationSettings>("/api/notifications/settings"),

  /** Update per-category toggles. */
  saveSettings: (data: {
    enabled?: boolean;
    ntfy?: boolean;
    categories?: Partial<Record<NotificationCategory, boolean>>;
  }) => api.put<NotificationSettings>("/api/notifications/settings", data),

  /** Mark a single notification as read. */
  markRead: (id: string) => api.post<{ ok: boolean }>(`/api/notifications/${id}/read`),

  /** Mark all notifications as read. */
  markAllRead: () => api.post<{ ok: boolean }>("/api/notifications/read-all"),

  /** Dismiss (delete) a single notification. */
  dismiss: (id: string) => api.delete<{ ok: boolean }>(`/api/notifications/${id}`),

  /** Clear all notifications. */
  clearAll: () => api.delete<{ ok: boolean }>("/api/notifications"),
};
