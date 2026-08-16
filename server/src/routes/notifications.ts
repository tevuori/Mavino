// ===== Notification routes =====
// CRUD for persistent in-app notifications. The system tray bell polls
// GET /api/notifications for the list and GET /api/notifications/unread-count
// for the badge count. Mark-read endpoints are called on click / "mark all read".

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  dismissNotification,
  clearAll,
  getNotifySettings,
  setCategoryEnabled,
  type NotificationCategory,
} from "../services/notifications";

const notifications = new Hono();
notifications.use("*", authMiddleware);

/** GET /api/notifications — list the user's notifications (newest first). */
notifications.get("/", async (c) => {
  const { userId } = c.get("auth");
  const unreadOnly = c.req.query("unreadOnly") === "1" || c.req.query("unreadOnly") === "true";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = await listNotifications(userId, { unreadOnly, limit });
  return c.json({ notifications: rows });
});

/** GET /api/notifications/unread-count — lightweight badge count. */
notifications.get("/unread-count", async (c) => {
  const { userId } = c.get("auth");
  const count = await getUnreadCount(userId);
  return c.json({ count });
});

/** GET /api/notifications/settings — per-category toggles. */
notifications.get("/settings", async (c) => {
  const { userId } = c.get("auth");
  const settings = await getNotifySettings(userId);
  return c.json(settings);
});

/** POST /api/notifications/:id/read — mark a single notification as read. */
notifications.post("/:id/read", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  await markRead(id, userId);
  return c.json({ ok: true });
});

/** POST /api/notifications/read-all — mark all as read. */
notifications.post("/read-all", async (c) => {
  const { userId } = c.get("auth");
  await markAllRead(userId);
  return c.json({ ok: true });
});

/** DELETE /api/notifications/:id — dismiss (delete) a single notification. */
notifications.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  await dismissNotification(id, userId);
  return c.json({ ok: true });
});

/** DELETE /api/notifications — clear all notifications. */
notifications.delete("/", async (c) => {
  const { userId } = c.get("auth");
  await clearAll(userId);
  return c.json({ ok: true });
});

const settingsSchema = {
  enabled: "boolean",
  ntfy: "boolean",
  categories: "object",
};

/** PUT /api/notifications/settings — update per-category toggles. */
notifications.put("/settings", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json().catch(() => ({}));
  const { enabled, ntfy, categories } = body as {
    enabled?: boolean;
    ntfy?: boolean;
    categories?: Record<string, boolean>;
  };

  if (typeof enabled === "boolean") {
    await setCategoryEnabled(userId, "enabled", enabled);
  }
  if (typeof ntfy === "boolean") {
    await setCategoryEnabled(userId, "ntfy", ntfy);
  }
  if (categories && typeof categories === "object") {
    for (const [cat, val] of Object.entries(categories)) {
      if (typeof val === "boolean") {
        await setCategoryEnabled(userId, cat as NotificationCategory, val);
      }
    }
  }

  const settings = await getNotifySettings(userId);
  return c.json(settings);
});

export default notifications;
