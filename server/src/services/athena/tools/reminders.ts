// ===== Athena reminder tools =====
// One-shot reminders delivered via ntfy at a specific time. Two tools so the
// LLM chooses the right kind:
//   - create_reminder       (type="basic"):  pushes a fixed message at fireAt (no LLM).
//   - create_llm_reminder   (type="athena"): runs a prompt through the LLM at
//     fireAt so the reminder can gather context (calendar, tasks, exam details)
//     and be tailored at fire time.
// Plus list/cancel/delete for management.

import { type ToolDef, paidOnly } from "./plugin";
import prisma from "../../../db/client";
import { decryptNtfyConfig } from "../../ntfy/config";
import { getUserTimezone, parseFireAtInTz } from "../../timezone";

function parseFireAt(raw: unknown, tz: string): Date | null {
  return parseFireAtInTz(raw, tz);
}

// Reminders is a Paid-tier app — all reminder tools are paid-only.
export const reminderTools: ToolDef[] = paidOnly([
  {
    name: "create_reminder",
    description:
      "Schedule a ONE-SHOT reminder that pushes a fixed message to the user's phone via ntfy at a specific time (no AI at fire time — the exact message you provide is what gets sent). Use this when the user says 'remind me to X at TIME' and X is a concrete, fixed message. The reminder fires once and is then kept as history. Requires ntfy to be configured. Use create_llm_reminder instead if the reminder should be contextual at fire time (e.g. 'remind me to prep for my exam' — where the message should reference what's actually due).",
    destructive: true,
    parameters: [
      { name: "message", type: "string", description: "The exact reminder message body sent at fire time (e.g. 'Call mom', 'Submit the assignment').", required: true },
      { name: "fireAt", type: "string", description: "ISO 8601 datetime for when to fire the reminder (e.g. 2026-07-25T15:00:00Z). Use the current date/time from context to compute this.", required: true },
      { name: "title", type: "string", description: "Notification title (optional, defaults to 'Mavino reminder')" },
      { name: "priority", type: "number", description: "Priority 1 (min) to 5 (max). Default 3." },
      { name: "tags", type: "string", description: "Comma-separated emoji/text tags (e.g. 'bell,alarm_clock')" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await decryptNtfyConfig(userId);
      if (!cfg) {
        return {
          error:
            "Ntfy is not configured, so the reminder could not be scheduled. Ask the user to set up ntfy in the Ntfy app (Settings → Integrations or the Ntfy app).",
        };
      }
      const message = String(args.message ?? "").trim();
      if (!message) return { error: "A message is required for a reminder." };
      const tz = await getUserTimezone(userId);
      const fireAt = parseFireAt(args.fireAt, tz);
      if (!fireAt) return { error: `Invalid fireAt datetime: "${args.fireAt}"` };

      const reminder = await prisma.reminder.create({
        data: {
          userId,
          type: "basic",
          title: String(args.title ?? "").slice(0, 200),
          message,
          prompt: "",
          fireAt,
          priority: Number(args.priority ?? 3),
          tags: String(args.tags ?? ""),
        },
      });
      return {
        reminder: {
          id: reminder.id,
          type: reminder.type,
          title: reminder.title,
          message: reminder.message,
          fireAt: reminder.fireAt.toISOString(),
          priority: reminder.priority,
        },
        created: true,
      };
    },
  },
  {
    name: "create_llm_reminder",
    description:
      "Schedule a ONE-SHOT SMART reminder: at fireAt, the given prompt is run through you (Mavino, with all your tools) and the generated reply is pushed to the user's phone via ntfy. Use this when the reminder should be contextual at fire time — e.g. 'remind me to prep for my exam tomorrow' (at fire time you gather exam/task/calendar context and write a tailored reminder), or 'remind me to review my notes' (at fire time you pick the most relevant note). Requires ntfy AND a Mavino LLM provider to be configured. Use create_reminder instead for a simple fixed message.",
    destructive: true,
    parameters: [
      { name: "prompt", type: "string", description: "The prompt run through the LLM at fire time. The generated reply is pushed as the reminder body. Should be self-contained (e.g. 'Remind the user to prep for their exam. Check today's calendar and due tasks, then write a 2-3 sentence reminder naming what to focus on.').", required: true },
      { name: "fireAt", type: "string", description: "ISO 8601 datetime for when to fire the reminder (e.g. 2026-07-25T15:00:00Z). Use the current date/time from context to compute this.", required: true },
      { name: "title", type: "string", description: "Notification title (optional, defaults to 'Mavino reminder')" },
      { name: "priority", type: "number", description: "Priority 1 (min) to 5 (max). Default 3." },
      { name: "tags", type: "string", description: "Comma-separated emoji/text tags" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await decryptNtfyConfig(userId);
      if (!cfg) {
        return {
          error:
            "Ntfy is not configured, so the reminder could not be scheduled. Ask the user to set up ntfy in the Ntfy app.",
        };
      }
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) return { error: "A prompt is required for an LLM reminder." };
      const tz = await getUserTimezone(userId);
      const fireAt = parseFireAt(args.fireAt, tz);
      if (!fireAt) return { error: `Invalid fireAt datetime: "${args.fireAt}"` };

      const reminder = await prisma.reminder.create({
        data: {
          userId,
          type: "athena",
          title: String(args.title ?? "").slice(0, 200),
          message: "",
          prompt,
          fireAt,
          priority: Number(args.priority ?? 3),
          tags: String(args.tags ?? ""),
        },
      });
      return {
        reminder: {
          id: reminder.id,
          type: reminder.type,
          title: reminder.title,
          prompt: reminder.prompt,
          fireAt: reminder.fireAt.toISOString(),
          priority: reminder.priority,
        },
        created: true,
      };
    },
  },
  {
    name: "list_reminders",
    description:
      "List the user's reminders. By default returns pending (not yet fired, not cancelled) reminders. Pass status='all' to include fired/cancelled history. Returns id, type, title, message/prompt, fireAt, priority, fired, cancelled.",
    parameters: [
      {
        name: "status",
        type: "string",
        description: "Filter: 'pending' (default, unfired+uncancelled), 'fired', 'cancelled', or 'all'.",
        enum: ["pending", "fired", "cancelled", "all"],
      },
    ],
    handler: async (args, { userId }) => {
      const status = (args.status as string) ?? "pending";
      const where: Record<string, unknown> = { userId };
      if (status === "pending") {
        where.fired = false;
        where.cancelled = false;
      } else if (status === "fired") {
        where.fired = true;
      } else if (status === "cancelled") {
        where.cancelled = true;
      }
      const reminders = await prisma.reminder.findMany({
        where: where as never,
        orderBy: { fireAt: "asc" },
        take: 100,
      });
      return {
        count: reminders.length,
        reminders: reminders.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          message: r.message,
          prompt: r.prompt,
          fireAt: r.fireAt.toISOString(),
          priority: r.priority,
          tags: r.tags,
          fired: r.fired,
          firedAt: r.firedAt?.toISOString() ?? null,
          cancelled: r.cancelled,
        })),
      };
    },
  },
  {
    name: "cancel_reminder",
    description:
      "Cancel a pending reminder so it will not fire. The row is kept (marked cancelled) for history. Use list_reminders to find the id.",
    destructive: true,
    parameters: [
      { name: "reminderId", type: "string", description: "Reminder id from list_reminders", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.reminderId);
      const existing = await prisma.reminder.findUnique({ where: { id, userId } });
      if (!existing) return { error: "Reminder not found" };
      if (existing.fired) return { error: "Reminder already fired — cannot cancel." };
      await prisma.reminder.update({
        where: { id },
        data: { cancelled: true },
      });
      return { cancelled: true, reminderId: id, title: existing.title };
    },
  },
  {
    name: "delete_reminder",
    description: "Delete a reminder permanently (from history or pending).",
    destructive: true,
    parameters: [
      { name: "reminderId", type: "string", description: "Reminder id from list_reminders", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.reminderId);
      const existing = await prisma.reminder.findUnique({ where: { id, userId } });
      if (!existing) return { error: "Reminder not found" };
      await prisma.reminder.delete({ where: { id, userId } });
      return { deleted: true, reminderId: id, title: existing.title };
    },
  },
]);
