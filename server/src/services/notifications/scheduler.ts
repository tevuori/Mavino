// ===== Notification scheduler (time-based reminders) =====
// A 60-second tick that checks for time-based notifications:
//   1. Task due today / overdue — creates task_due / task_overdue notifications
//      (throttled: one per task per day).
//   2. Calendar events starting within 15 minutes — creates calendar_upcoming
//      notifications (throttled: one per event).
//
// Each check respects the user's per-category notification settings. The
// scheduler iterates all users that have tasks/calendar events with relevant
// due dates — consistent with the proactive-scheduler pattern.

import prisma from "../../db/client";
import {
  deliverNotification,
  alreadyNotifiedToday,
  isCategoryEnabled,
  type NotificationCategory,
} from "../notifications";

const TICK_MS = 60_000;
const CALENDAR_LOOKAHEAD_MIN = 15;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Check tasks for all users and create due/overdue notifications. */
async function checkTaskReminders(): Promise<void> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  // Find all non-done tasks with a dueDate <= end of today (covers due today
  // and overdue). Group by userId so we can check settings per user.
  const tasks = await prisma.task.findMany({
    where: {
      status: { not: "DONE" },
      dueDate: { not: null, lte: endOfToday },
    },
    select: {
      id: true,
      userId: true,
      title: true,
      dueDate: true,
      priority: true,
    },
  });

  // Group by user to batch settings checks.
  const byUser = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const arr = byUser.get(t.userId) ?? [];
    arr.push(t);
    byUser.set(t.userId, arr);
  }

  for (const [userId, userTasks] of byUser) {
    for (const t of userTasks) {
      const due = t.dueDate!;
      const isOverdue = due < startOfToday;
      const category: NotificationCategory = isOverdue ? "task_overdue" : "task_due";

      // Throttle: one notification per task per day.
      if (await alreadyNotifiedToday(userId, category, t.id)) continue;

      // Check per-category setting.
      if (!(await isCategoryEnabled(userId, category))) continue;

      const dueText = isOverdue
        ? `Overdue (was due ${due.toLocaleDateString()})`
        : `Due today`;

      await deliverNotification(userId, {
        category,
        title: t.title,
        body: dueText,
        icon: isOverdue ? "AlertCircle" : "CheckSquare",
        linkApp: "tasks",
        linkPayload: JSON.stringify({ taskId: t.id }),
        priority: isOverdue ? 4 : t.priority === "HIGH" ? 4 : 3,
        tags: isOverdue ? "warning,clipboard" : "clipboard",
      });
    }
  }
}

/** Check calendar events starting within the next 15 minutes. */
async function checkCalendarReminders(): Promise<void> {
  const now = new Date();
  const lookahead = new Date(now.getTime() + CALENDAR_LOOKAHEAD_MIN * 60_000);

  // Find events starting within the lookahead window that haven't been
  // notified yet. We use source != "task" to avoid double-notifying (tasks
  // with due dates create calendar events; the task reminder covers those).
  const events = await prisma.calendarEvent.findMany({
    where: {
      start: { gte: now, lte: lookahead },
      source: { not: "task" },
    },
    select: {
      id: true,
      userId: true,
      title: true,
      start: true,
      end: true,
      location: true,
      allDay: true,
    },
  });

  for (const e of events) {
    // Throttle: one notification per event per day.
    if (await alreadyNotifiedToday(e.userId, "calendar_upcoming", e.id)) continue;
    if (!(await isCategoryEnabled(e.userId, "calendar_upcoming"))) continue;

    const minsUntil = Math.round((e.start.getTime() - now.getTime()) / 60_000);
    const timeStr = e.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const body = e.location
      ? `Starts in ${minsUntil} min at ${timeStr} — ${e.location}`
      : `Starts in ${minsUntil} min at ${timeStr}`;

    await deliverNotification(e.userId, {
      category: "calendar_upcoming",
      title: e.title,
      body,
      icon: "Calendar",
      linkApp: "calendar",
      linkPayload: JSON.stringify({ eventId: e.id }),
      priority: 4,
      tags: "calendar",
    });
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await Promise.allSettled([checkTaskReminders(), checkCalendarReminders()]);
  } finally {
    running = false;
  }
}

/** Start the scheduler (idempotent). */
export function startNotificationScheduler(): void {
  if (timer) return;
  setTimeout(
    () => tick().catch((e) => console.error("[notifications] scheduler tick error:", e)),
    5000
  );
  timer = setInterval(
    () => tick().catch((e) => console.error("[notifications] scheduler tick error:", e)),
    TICK_MS
  );
}

export function stopNotificationScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
