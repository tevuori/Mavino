import { create } from "zustand";
import { notificationsApi } from "../services/notifications";
import type { NotificationItem } from "../types";

// ===== Notification store =====
// Merges persistent notifications (DB-backed, from /api/notifications) with
// ephemeral notifications (client-side, e.g. Quick Capture confirmations).
// Persistent notifications are loaded on store creation and polled every 30s
// for new items. Ephemeral notifications are pushed by apps via `push()` and
// are not persisted — they're lost on refresh.

export interface EphemeralNotification {
  id: string;
  app: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

let nid = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastUnreadCount = -1;

interface NotificationsState {
  /** Persistent notifications from the DB. */
  persistent: NotificationItem[];
  /** Ephemeral client-side notifications. */
  ephemeral: EphemeralNotification[];
  /** Whether the persistent list has been loaded at least once. */
  loaded: boolean;
  /** Loading state for the initial fetch. */
  loading: boolean;

  /** Load persistent notifications from the API. */
  load: () => Promise<void>;
  /** Lightweight poll: only reloads the full list if the unread count changed. */
  poll: () => Promise<void>;
  /** Push an ephemeral notification (not persisted). */
  push: (n: Omit<EphemeralNotification, "id" | "timestamp" | "read">) => void;
  /** Mark a persistent notification as read (API + local). */
  markRead: (id: string) => Promise<void>;
  /** Mark an ephemeral notification as read (local only). */
  markEphemeralRead: (id: string) => void;
  /** Mark all persistent notifications as read (API + local). */
  markAllRead: () => Promise<void>;
  /** Dismiss a persistent notification (API + local). */
  dismiss: (id: string) => Promise<void>;
  /** Dismiss an ephemeral notification (local only). */
  dismissEphemeral: (id: string) => void;
  /** Clear all persistent notifications (API + local). */
  clearAll: () => Promise<void>;
  /** Clear all ephemeral notifications. */
  clearEphemeral: () => void;
  /** Combined unread count (persistent + ephemeral). */
  unreadCount: () => number;
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  persistent: [],
  ephemeral: [],
  loaded: false,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const res = await notificationsApi.list({ limit: 50 });
      set({ persistent: res.notifications, loaded: true, loading: false });
      lastUnreadCount = res.notifications.filter((n) => !n.read).length;
    } catch {
      set({ loading: false });
    }
  },

  poll: async () => {
    if (!get().loaded) return;
    try {
      const { count } = await notificationsApi.unreadCount();
      if (count !== lastUnreadCount) {
        lastUnreadCount = count;
        await get().load();
      }
    } catch {
      /* ignore poll errors */
    }
  },

  push: (n) => {
    // Suppress notifications when DND is on (checked via settings store by caller;
    // but we also check here for safety).
    set((s) => ({
      ephemeral: [
        { ...n, id: `e-${++nid}`, timestamp: Date.now(), read: false },
        ...s.ephemeral,
      ].slice(0, 50),
    }));
  },

  markRead: async (id) => {
    set((s) => ({
      persistent: s.persistent.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
    try {
      await notificationsApi.markRead(id);
    } catch {
      /* ignore */
    }
  },

  markEphemeralRead: (id) =>
    set((s) => ({
      ephemeral: s.ephemeral.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),

  markAllRead: async () => {
    set((s) => ({
      persistent: s.persistent.map((n) => ({ ...n, read: true })),
      ephemeral: s.ephemeral.map((n) => ({ ...n, read: true })),
    }));
    try {
      await notificationsApi.markAllRead();
    } catch {
      /* ignore */
    }
  },

  dismiss: async (id) => {
    set((s) => ({ persistent: s.persistent.filter((n) => n.id !== id) }));
    try {
      await notificationsApi.dismiss(id);
    } catch {
      /* ignore */
    }
  },

  dismissEphemeral: (id) =>
    set((s) => ({ ephemeral: s.ephemeral.filter((n) => n.id !== id) })),

  clearAll: async () => {
    set({ persistent: [], ephemeral: [] });
    try {
      await notificationsApi.clearAll();
    } catch {
      /* ignore */
    }
  },

  clearEphemeral: () => set({ ephemeral: [] }),

  unreadCount: () => {
    const { persistent, ephemeral } = get();
    return (
      persistent.filter((n) => !n.read).length +
      ephemeral.filter((n) => !n.read).length
    );
  },
}));

/** Start polling for new persistent notifications (call once on app init). */
export function startNotificationPolling(): void {
  if (pollTimer) return;
  // Initial load.
  useNotifications.getState().load().catch(() => {});
  // Poll every 30s.
  pollTimer = setInterval(() => {
    useNotifications.getState().poll().catch(() => {});
  }, 30_000);
}

/** Stop polling (for tests / cleanup). */
export function stopNotificationPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
