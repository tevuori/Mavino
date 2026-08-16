// ===== Notification service (persistent in-app + ntfy push bridge) =====
// The single entry point for creating notifications. Each notification is:
//   1. Persisted in the Notification table (surfaced in the system tray bell).
//   2. Pushed to the user's ntfy notify topic (phone) if ntfy is configured
//      and the user hasn't disabled ntfy push for this category.
//
// Per-category opt-in settings are stored as per-user Setting rows
// (key="notify.<category>", value="1"/"0"). Defaults are on ("1").
//
// Categories: task_due, task_overdue, calendar_upcoming, circle_join,
// circle_share, achievement, system.

import prisma from "../db/client";
import { decryptNtfyConfig, isNtfyEnabled } from "./ntfy/config";
import { publish, type NtfyUsableConfig } from "./ntfy/client";

export type NotificationCategory =
  | "task_due"
  | "task_overdue"
  | "calendar_upcoming"
  | "circle_join"
  | "circle_share"
  | "achievement"
  | "system";

export interface DeliverNotificationInput {
  category: NotificationCategory;
  title: string;
  body?: string;
  icon?: string; // lucide icon name
  linkApp?: string; // app id to open when clicked
  linkPayload?: string; // JSON payload for opening
  /** ntfy priority (1-5). Default 3. */
  priority?: number;
  /** ntfy tags. */
  tags?: string;
}

export interface NotificationRow {
  id: string;
  userId: string;
  category: string;
  title: string;
  body: string;
  icon: string;
  linkApp: string;
  linkPayload: string;
  read: boolean;
  createdAt: string;
}

function serialize(n: any): NotificationRow {
  return {
    id: n.id,
    userId: n.userId,
    category: n.category,
    title: n.title,
    body: n.body,
    icon: n.icon,
    linkApp: n.linkApp,
    linkPayload: n.linkPayload,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

// ----- per-category settings -----

const SETTING_PREFIX = "notify.";
// Master switch: if "notify.enabled" is "0", all notifications are suppressed.
const MASTER_KEY = "notify.enabled";
// ntfy push toggle: if "notify.ntfy" is "0", in-app only (no phone push).
const NTFY_KEY = "notify.ntfy";

async function getSettingBool(userId: string, key: string, defaultVal: boolean): Promise<boolean> {
  const row = await prisma.setting.findUnique({
    where: { userId_key: { userId, key } },
  });
  if (!row) return defaultVal;
  return row.value === "1" || row.value === "true";
}

/** Whether the user has notifications enabled for a category. */
export async function isCategoryEnabled(
  userId: string,
  category: NotificationCategory
): Promise<boolean> {
  const master = await getSettingBool(userId, MASTER_KEY, true);
  if (!master) return false;
  return getSettingBool(userId, `${SETTING_PREFIX}${category}`, true);
}

/** Whether the user wants ntfy push for notifications (in addition to in-app). */
export async function isNtfyPushEnabled(userId: string): Promise<boolean> {
  return getSettingBool(userId, NTFY_KEY, true);
}

/** Set the per-category toggle. */
export async function setCategoryEnabled(
  userId: string,
  category: NotificationCategory | "enabled" | "ntfy",
  enabled: boolean
): Promise<void> {
  const key =
    category === "enabled" ? MASTER_KEY : category === "ntfy" ? NTFY_KEY : `${SETTING_PREFIX}${category}`;
  await prisma.setting.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value: enabled ? "1" : "0" },
    update: { value: enabled ? "1" : "0" },
  });
}

/** Get all notification settings for the user (for the settings UI). */
export async function getNotifySettings(userId: string): Promise<{
  enabled: boolean;
  ntfy: boolean;
  categories: Record<NotificationCategory, boolean>;
}> {
  const rows = await prisma.setting.findMany({
    where: { userId, key: { startsWith: SETTING_PREFIX } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const masterRow = await prisma.setting.findUnique({
    where: { userId_key: { userId, key: MASTER_KEY } },
  });
  const ntfyRow = await prisma.setting.findUnique({
    where: { userId_key: { userId, key: NTFY_KEY } },
  });

  const cats: NotificationCategory[] = [
    "task_due",
    "task_overdue",
    "calendar_upcoming",
    "circle_join",
    "circle_share",
    "achievement",
    "system",
  ];
  const categories = {} as Record<NotificationCategory, boolean>;
  for (const c of cats) {
    const v = map.get(`${SETTING_PREFIX}${c}`);
    categories[c] = v ? v === "1" || v === "true" : true;
  }
  return {
    enabled: masterRow ? masterRow.value === "1" || masterRow.value === "true" : true,
    ntfy: ntfyRow ? ntfyRow.value === "1" || ntfyRow.value === "true" : true,
    categories,
  };
}

// ----- core deliver -----

/**
 * Create a persistent notification and (optionally) push it to ntfy.
 * Checks the user's per-category settings before creating.
 * Returns the created Notification row, or null if the category is disabled.
 */
export async function deliverNotification(
  userId: string,
  input: DeliverNotificationInput
): Promise<NotificationRow | null> {
  const enabled = await isCategoryEnabled(userId, input.category);
  if (!enabled) return null;

  const row = await prisma.notification.create({
    data: {
      userId,
      category: input.category,
      title: input.title.slice(0, 200),
      body: (input.body ?? "").slice(0, 4000),
      icon: input.icon || "Bell",
      linkApp: input.linkApp || "",
      linkPayload: input.linkPayload || "",
    },
  });

  // Best-effort ntfy push (don't fail the notification if ntfy is down).
  void pushToNtfy(userId, input).catch((e) => {
    console.error(`[notifications] ntfy push failed (user ${userId}):`, e instanceof Error ? e.message : e);
  });

  return serialize(row);
}

/** Like deliverNotification but skips the per-category setting check.
 *  Used for "system" notifications that must always be delivered. */
export async function deliverNotificationForced(
  userId: string,
  input: DeliverNotificationInput
): Promise<NotificationRow> {
  const row = await prisma.notification.create({
    data: {
      userId,
      category: input.category,
      title: input.title.slice(0, 200),
      body: (input.body ?? "").slice(0, 4000),
      icon: input.icon || "Bell",
      linkApp: input.linkApp || "",
      linkPayload: input.linkPayload || "",
    },
  });

  void pushToNtfy(userId, input).catch((e) => {
    console.error(`[notifications] ntfy push failed (user ${userId}):`, e instanceof Error ? e.message : e);
  });

  return serialize(row);
}

async function pushToNtfy(userId: string, input: DeliverNotificationInput): Promise<void> {
  const pushEnabled = await isNtfyPushEnabled(userId);
  if (!pushEnabled) return;
  const ntfyReady = await isNtfyEnabled(userId);
  if (!ntfyReady) return;
  const cfg: NtfyUsableConfig | null = await decryptNtfyConfig(userId);
  if (!cfg) return;

  await publish(cfg, {
    topic: cfg.notifyTopic,
    title: input.title,
    body: input.body || "",
    priority: input.priority ?? cfg.defaultPriority,
    tags: input.tags,
  });
}

// ----- CRUD -----

export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {}
): Promise<NotificationRow[]> {
  const where: Record<string, unknown> = { userId };
  if (opts.unreadOnly) where.read = false;
  const rows = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
  });
  return rows.map(serialize);
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}

export async function markRead(id: string, userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id, userId },
    data: { read: true },
  });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

export async function dismissNotification(id: string, userId: string): Promise<void> {
  await prisma.notification.deleteMany({
    where: { id, userId },
  });
}

export async function clearAll(userId: string): Promise<void> {
  await prisma.notification.deleteMany({
    where: { userId },
  });
}

// ----- throttling helper -----

/** Check whether a notification with the given category + linkPayload was
 *  already created for this user today. Used by the scheduler to avoid
 *  duplicate notifications on every tick. */
export async function alreadyNotifiedToday(
  userId: string,
  category: NotificationCategory,
  linkPayload: string
): Promise<boolean> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await prisma.notification.count({
    where: {
      userId,
      category,
      linkPayload,
      createdAt: { gte: start },
    },
  });
  return count > 0;
}
