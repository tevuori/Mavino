// ===== Reminder scheduler =====
// A 30-second tick that fires due Reminder rows (one-shot, ntfy-delivered).
//   - type="basic": publishes the fixed `message` to the notify topic (no LLM).
//   - type="athena": runs an Athena LLM turn (with tools) using `prompt` and
//     publishes the generated reply — so the reminder can gather context at
//     fire time (calendar, tasks, exam details) and be tailored.
// After firing, the row is marked fired=true (kept for history; never refires).
// Skips gracefully if ntfy isn't configured (marks fired to avoid a stuck loop).

import prisma from "../../db/client";
import { decryptNtfyConfig } from "../ntfy/config";
import { publish, type NtfyUsableConfig } from "../ntfy/client";
import { runAthenaTurn } from "../ntfy/athena-turn";

const TICK_MS = 30_000;
const MAX_BODY_LEN = 4000;
// Max consecutive publish failures before we give up on a reminder and mark it
// fired. Without this, a permanent failure (e.g. a header value Bun's fetch
// rejects on every attempt) retries every tick forever and the reminder is
// never delivered nor surfaced. 5 ticks ≈ 2.5 minutes of retrying transient
// errors before giving up.
const MAX_PUBLISH_FAILURES = 5;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
// In-memory consecutive-failure counter per reminder id. Cleared on success.
// Lost on restart — acceptable: a truly permanent failure re-hits the cap
// within MAX_PUBLISH_FAILURES ticks after a restart.
const publishFailures = new Map<string, number>();

async function fireReminder(reminder: {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  prompt: string;
  priority: number;
  tags: string;
}): Promise<void> {
  const cfg: NtfyUsableConfig | null = await decryptNtfyConfig(reminder.userId);
  if (!cfg) {
    // No ntfy config — mark fired so we don't loop on it forever.
    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { fired: true, firedAt: new Date() },
    });
    console.warn(
      `[reminders] reminder ${reminder.id} skipped — ntfy not configured for user ${reminder.userId}`
    );
    return;
  }

  let body = "";
  const title = reminder.title || "Mavino reminder";

  if (reminder.type === "athena") {
    try {
      body =
        (await runAthenaTurn(reminder.userId, reminder.prompt || reminder.title || "Remind the user." )) ??
        "[Mavino is not configured with an AI provider — cannot generate a contextual reminder.]";
    } catch (e) {
      body = `[Mavino reminder error: ${e instanceof Error ? e.message : "unknown"}]`;
    }
  } else {
    body = reminder.message || reminder.title || "Reminder";
  }

  body = body.slice(0, MAX_BODY_LEN);

  try {
    await publish(cfg, {
      topic: cfg.notifyTopic,
      title,
      body,
      priority: reminder.priority || cfg.defaultPriority,
      tags: reminder.tags || "bell",
    });
    await prisma.ntfyMessage.create({
      data: {
        userId: reminder.userId,
        direction: "reminder",
        topic: cfg.notifyTopic,
        title,
        body,
        priority: reminder.priority || cfg.defaultPriority,
        tags: reminder.tags || "bell",
      },
    });
  } catch (e) {
    const n = (publishFailures.get(reminder.id) ?? 0) + 1;
    publishFailures.set(reminder.id, n);
    console.error(
      `[reminders] publish failed (reminder ${reminder.id}, attempt ${n}/${MAX_PUBLISH_FAILURES}):`,
      e instanceof Error ? e.message : e
    );
    if (n >= MAX_PUBLISH_FAILURES) {
      // Permanent failure — give up so the row doesn't loop forever. Mark
      // fired (kept for history) and surface the failure to the user via the
      // inbox topic so it's not silently swallowed.
      console.error(
        `[reminders] giving up on reminder ${reminder.id} after ${n} consecutive failures`
      );
      publishFailures.delete(reminder.id);
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { fired: true, firedAt: new Date() },
      });
      try {
        await publish(cfg, {
          topic: cfg.notifyTopic,
          title: "Athena reminder failed",
          body: `Could not deliver reminder "${reminder.title || reminder.message || reminder.id}" after ${n} attempts. Last error: ${
            e instanceof Error ? e.message : "unknown"
          }`.slice(0, MAX_BODY_LEN),
          priority: cfg.defaultPriority,
          tags: "warning",
        });
      } catch {
        /* best-effort surfacing; ignore */
      }
    }
    // Otherwise retry on the next tick.
    return;
  }

  publishFailures.delete(reminder.id);
  await prisma.reminder.update({
    where: { id: reminder.id },
    data: { fired: true, firedAt: new Date() },
  });
}

async function tick(): Promise<void> {
  if (running) return; // guard against overlap
  running = true;
  try {
    const now = new Date();
    const due = await prisma.reminder.findMany({
      where: { fired: false, cancelled: false, fireAt: { lte: now } },
      take: 100,
      orderBy: { fireAt: "asc" },
    });
    for (const reminder of due) {
      try {
        await fireReminder(reminder);
      } catch (e) {
        console.error(
          `[reminders] fire error (reminder ${reminder.id}):`,
          e instanceof Error ? e.message : e
        );
      }
    }
  } finally {
    running = false;
  }
}

/** Start the scheduler (idempotent). */
export function startReminderScheduler(): void {
  if (timer) return;
  // Fire shortly after boot, then every 30s.
  setTimeout(
    () => tick().catch((e) => console.error("[reminders] scheduler tick error:", e)),
    5000
  );
  timer = setInterval(
    () => tick().catch((e) => console.error("[reminders] scheduler tick error:", e)),
    TICK_MS
  );
}

export function stopReminderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
