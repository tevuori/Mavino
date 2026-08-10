// ===== Athena ntfy tools =====
// send_notification + full cron-job CRUD. Ntfy is a bidirectional channel:
// the user can also message Athena from their phone (handled by the inbox
// subscriber), but these tools cover outbound notifications + scheduling.

import { type ToolDef, paidOnly } from "./plugin";
import prisma from "../../../db/client";
import { decryptNtfyConfig } from "../../ntfy/config";
import { publish } from "../../ntfy/client";
import { isValidCron, nextRunAt } from "../../ntfy/scheduler";
import { getUserTimezone } from "../../timezone";

// Ntfy is a Paid-tier app — all ntfy tools are paid-only.
export const ntfyTools: ToolDef[] = paidOnly([
  {
    name: "send_notification",
    description:
      "Send a push notification to the user's phone/desktop via ntfy. Use to deliver reminders, summaries, or any message the user should see immediately even when the Mavino web app is closed. Requires ntfy to be configured.",
    parameters: [
      { name: "title", type: "string", description: "Notification title" },
      { name: "body", type: "string", description: "Notification body text", required: true },
      { name: "priority", type: "number", description: "Priority 1 (min) to 5 (max). Default 3." },
      { name: "tags", type: "string", description: "Comma-separated emoji/text tags (e.g. 'bell,alarm_clock')" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await decryptNtfyConfig(userId);
      if (!cfg) return { error: "Ntfy is not configured. Ask the user to set it up in the Ntfy app (Settings → Integrations or the Ntfy app)." };
      try {
        await publish(cfg, {
          topic: cfg.notifyTopic,
          title: String(args.title ?? ""),
          body: String(args.body ?? "").slice(0, 4000),
          priority: Number(args.priority ?? cfg.defaultPriority),
          tags: args.tags ? String(args.tags) : undefined,
        });
        await prisma.ntfyMessage.create({
          data: {
            userId,
            direction: "out",
            topic: cfg.notifyTopic,
            title: String(args.title ?? ""),
            body: String(args.body ?? "").slice(0, 4000),
            priority: Number(args.priority ?? cfg.defaultPriority),
            tags: args.tags ? String(args.tags) : "",
          },
        });
        return { sent: true };
      } catch (e) {
        return { error: `Failed to send notification: ${e instanceof Error ? e.message : "unknown"}` };
      }
    },
  },
  {
    name: "list_cron_jobs",
    description:
      "List the user's ntfy cron jobs (scheduled notifications or athena-driven prompts). Returns id, name, cron, type, enabled, nextRunAt, lastRunAt.",
    parameters: [],
    handler: async (_args, { userId }) => {
      const jobs = await prisma.ntfyCronJob.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return {
        count: jobs.length,
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          cron: j.cron,
          type: j.type,
          enabled: j.enabled,
          title: j.title,
          priority: j.priority,
          nextRunAt: j.nextRunAt.toISOString(),
          lastRunAt: j.lastRunAt?.toISOString() ?? null,
        })),
      };
    },
  },
  {
    name: "get_cron_job",
    description: "Get full details of a single ntfy cron job by id (from list_cron_jobs).",
    parameters: [
      { name: "jobId", type: "string", description: "Cron job id from list_cron_jobs", required: true },
    ],
    handler: async (args, { userId }) => {
      const job = await prisma.ntfyCronJob.findUnique({
        where: { id: String(args.jobId), userId },
      });
      if (!job) return { error: "Cron job not found" };
      return { job };
    },
  },
  {
    name: "create_cron_job",
    description:
      "Create a scheduled ntfy cron job. Two types: 'notification' sends a fixed message on a schedule (e.g. a daily reminder); 'athena' runs a prompt through you (Mavino) on a schedule and sends your generated reply via ntfy (e.g. a daily 8am summary of today's schedule). The cron expression is 5-field standard cron (min hour day-of-month month day-of-week), e.g. '0 8 * * *' = daily at 08:00, '*/30 * * * *' = every 30 minutes.",
    destructive: true,
    parameters: [
      { name: "name", type: "string", description: "Human-readable job name", required: true },
      { name: "cron", type: "string", description: "5-field cron expression (e.g. '0 8 * * *')", required: true },
      {
        name: "type",
        type: "string",
        description: "Job type",
        enum: ["notification", "athena"],
        required: true,
      },
      { name: "message", type: "string", description: "Required when type='notification': the fixed message body sent each fire." },
      { name: "prompt", type: "string", description: "Required when type='athena': the prompt run through the LLM each fire; the reply is sent via ntfy." },
      { name: "title", type: "string", description: "Notification title" },
      { name: "priority", type: "number", description: "Priority 1-5 (default 3)" },
      { name: "tags", type: "string", description: "Comma-separated tags" },
      { name: "enabled", type: "boolean", description: "Whether the job is active (default true)" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await decryptNtfyConfig(userId);
      if (!cfg) return { error: "Ntfy is not configured." };
      const cron = String(args.cron ?? "").trim();
      if (!isValidCron(cron)) return { error: `Invalid cron expression: "${cron}"` };
      const type = args.type === "athena" ? "athena" : "notification";
      if (type === "notification" && !String(args.message ?? "").trim()) {
        return { error: "A message is required for notification-type cron jobs." };
      }
      if (type === "athena" && !String(args.prompt ?? "").trim()) {
        return { error: "A prompt is required for athena-type cron jobs." };
      }
      const enabled = args.enabled !== false;
      const tz = await getUserTimezone(userId);
      const job = await prisma.ntfyCronJob.create({
        data: {
          userId,
          name: String(args.name ?? "").slice(0, 100),
          cron,
          type,
          message: String(args.message ?? ""),
          prompt: String(args.prompt ?? ""),
          title: String(args.title ?? ""),
          priority: Number(args.priority ?? 3),
          tags: String(args.tags ?? ""),
          enabled,
          nextRunAt: enabled ? nextRunAt(cron, new Date(), tz) : new Date(Date.now() + 86400000),
        },
      });
      return { job, created: true };
    },
  },
  {
    name: "update_cron_job",
    description: "Modify an existing ntfy cron job (schedule, message/prompt, enabled, etc.). Only provided fields are changed.",
    destructive: true,
    parameters: [
      { name: "jobId", type: "string", description: "Cron job id from list_cron_jobs", required: true },
      { name: "name", type: "string", description: "New job name" },
      { name: "cron", type: "string", description: "New 5-field cron expression" },
      { name: "type", type: "string", description: "Job type", enum: ["notification", "athena"] },
      { name: "message", type: "string", description: "New message body (notification type)" },
      { name: "prompt", type: "string", description: "New prompt (athena type)" },
      { name: "title", type: "string", description: "New notification title" },
      { name: "priority", type: "number", description: "Priority 1-5" },
      { name: "tags", type: "string", description: "Comma-separated tags" },
      { name: "enabled", type: "boolean", description: "Enable or disable the job" },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.jobId);
      const existing = await prisma.ntfyCronJob.findUnique({ where: { id, userId } });
      if (!existing) return { error: "Cron job not found" };
      const cron = args.cron !== undefined ? String(args.cron).trim() : existing.cron;
      if (args.cron !== undefined && !isValidCron(cron)) {
        return { error: `Invalid cron expression: "${cron}"` };
      }
      const enabled = args.enabled ?? existing.enabled;
      const tz = await getUserTimezone(userId);
      const next = enabled ? nextRunAt(cron, new Date(), tz) : new Date(Date.now() + 86400000);
      const job = await prisma.ntfyCronJob.update({
        where: { id },
        data: {
          ...(args.name !== undefined && { name: String(args.name).slice(0, 100) }),
          ...(args.cron !== undefined && { cron }),
          ...(args.type !== undefined && { type: args.type === "athena" ? "athena" : "notification" }),
          ...(args.message !== undefined && { message: String(args.message) }),
          ...(args.prompt !== undefined && { prompt: String(args.prompt) }),
          ...(args.title !== undefined && { title: String(args.title) }),
          ...(args.priority !== undefined && { priority: Number(args.priority) }),
          ...(args.tags !== undefined && { tags: String(args.tags) }),
          ...(args.enabled !== undefined && { enabled: Boolean(args.enabled) }),
          nextRunAt: next,
        },
      });
      return { job, updated: true };
    },
  },
  {
    name: "delete_cron_job",
    description: "Delete an ntfy cron job permanently.",
    destructive: true,
    parameters: [
      { name: "jobId", type: "string", description: "Cron job id from list_cron_jobs", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.jobId);
      const job = await prisma.ntfyCronJob.findUnique({ where: { id, userId } });
      if (!job) return { error: "Cron job not found" };
      await prisma.ntfyCronJob.delete({ where: { id, userId } });
      return { deleted: true, jobId: id, name: job.name };
    },
  },
]);
