// ===== Ntfy routes =====
// Config CRUD (encrypted token), test, message log, manual send, and full
// cron-job CRUD + run-now. Inbox subscribers are kept in sync with config
// changes via the subscriber manager.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";
import { decryptNtfyConfig, ntfyStatus, saveNtfyConfig, deleteNtfyConfig } from "../services/ntfy/config";
import { publish, pollMessages } from "../services/ntfy/client";
import { isValidCron, nextRunAt } from "../services/ntfy/scheduler";
import { restartSubscriberFor, stopSubscriberFor } from "../services/ntfy/subscriber";
import { getUserTimezone } from "../services/timezone";

const ntfy = new Hono();
ntfy.use("*", authMiddleware, appTierGate("ntfy"));

const MAX_MSG_LOG = 200;

async function pruneMessages(userId: string): Promise<void> {
  const count = await prisma.ntfyMessage.count({ where: { userId } });
  if (count <= MAX_MSG_LOG) return;
  const excess = count - MAX_MSG_LOG;
  // Delete the oldest excess rows.
  const oldest = await prisma.ntfyMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    take: excess,
    select: { id: true },
  });
  if (oldest.length) {
    await prisma.ntfyMessage.deleteMany({ where: { id: { in: oldest.map((m) => m.id) } } });
  }
}

// ---------- Config ----------

ntfy.get("/status", async (c) => {
  const { userId } = c.get("auth");
  return c.json(await ntfyStatus(userId));
});

const configSchema = z.object({
  serverUrl: z.string().max(200).optional(),
  token: z.string().max(500).optional(),
  notifyTopic: z.string().max(100).optional(),
  inboxTopic: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
  defaultPriority: z.number().int().min(1).max(5).optional(),
});

ntfy.put("/config", zValidator("json", configSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const status = await saveNtfyConfig(userId, body);
  // Keep the inbox subscriber in sync.
  if (status.enabled) {
    await restartSubscriberFor(userId);
  } else {
    stopSubscriberFor(userId);
  }
  return c.json(status);
});

ntfy.delete("/config", async (c) => {
  const { userId } = c.get("auth");
  stopSubscriberFor(userId);
  await deleteNtfyConfig(userId);
  return c.json({ ok: true });
});

// ---------- Test / send / messages ----------

ntfy.post("/test", async (c) => {
  const { userId } = c.get("auth");
  const cfg = await decryptNtfyConfig(userId);
  if (!cfg) return c.json({ error: "Ntfy is not configured." }, 400);
  try {
    await publish(cfg, {
      topic: cfg.notifyTopic,
      title: "Mavino test",
      body: "Ntfy is working! This is a test notification from Mavino.",
      priority: cfg.defaultPriority,
      tags: "white_check_mark",
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Publish failed" }, 502);
  }
});

const sendSchema = z.object({
  title: z.string().max(200).optional().default(""),
  body: z.string().min(1).max(4000),
  priority: z.number().int().min(1).max(5).optional(),
  tags: z.string().max(200).optional().default(""),
});

ntfy.post("/send", zValidator("json", sendSchema), async (c) => {
  const { userId } = c.get("auth");
  const cfg = await decryptNtfyConfig(userId);
  if (!cfg) return c.json({ error: "Ntfy is not configured." }, 400);
  const body = c.req.valid("json");
  const priority = body.priority ?? cfg.defaultPriority;
  try {
    await publish(cfg, {
      topic: cfg.notifyTopic,
      title: body.title,
      body: body.body,
      priority,
      tags: body.tags || undefined,
    });
    await prisma.ntfyMessage.create({
      data: {
        userId,
        direction: "out",
        topic: cfg.notifyTopic,
        title: body.title,
        body: body.body,
        priority,
        tags: body.tags || "",
      },
    });
    await pruneMessages(userId);
    return c.json({ ok: true }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Publish failed" }, 502);
  }
});

ntfy.get("/messages", async (c) => {
  const { userId } = c.get("auth");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), MAX_MSG_LOG);
  const msgs = await prisma.ntfyMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return c.json({ messages: msgs });
});

/** GET /api/ntfy/inbox-poll — fetch recent inbox messages (for the UI log). */
ntfy.get("/inbox-poll", async (c) => {
  const { userId } = c.get("auth");
  const cfg = await decryptNtfyConfig(userId);
  if (!cfg) return c.json({ messages: [] });
  try {
    const msgs = await pollMessages(cfg, cfg.inboxTopic, "all");
    return c.json({ messages: msgs.filter((m) => m.event === "message").slice(-50) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Poll failed" }, 502);
  }
});

// ---------- Cron jobs ----------

const cronSchema = z.object({
  name: z.string().min(1).max(100),
  cron: z.string().min(1).max(100),
  type: z.enum(["notification", "athena"]).default("notification"),
  message: z.string().max(4000).optional().default(""),
  prompt: z.string().max(4000).optional().default(""),
  title: z.string().max(200).optional().default(""),
  priority: z.number().int().min(1).max(5).optional().default(3),
  tags: z.string().max(200).optional().default(""),
  enabled: z.boolean().optional().default(true),
});

function validateCronBody(body: z.infer<typeof cronSchema>): string | null {
  if (!isValidCron(body.cron)) return `Invalid cron expression: "${body.cron}"`;
  if (body.type === "notification" && !body.message.trim()) {
    return "A message is required for notification-type cron jobs.";
  }
  if (body.type === "athena" && !body.prompt.trim()) {
    return "A prompt is required for athena-type cron jobs.";
  }
  return null;
}

ntfy.get("/cron", async (c) => {
  const { userId } = c.get("auth");
  const jobs = await prisma.ntfyCronJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ jobs });
});

ntfy.post("/cron", zValidator("json", cronSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const err = validateCronBody(body);
  if (err) return c.json({ error: err }, 400);
  const tz = await getUserTimezone(userId);
  const job = await prisma.ntfyCronJob.create({
    data: {
      userId,
      name: body.name,
      cron: body.cron,
      type: body.type,
      message: body.message,
      prompt: body.prompt,
      title: body.title,
      priority: body.priority,
      tags: body.tags,
      enabled: body.enabled,
      nextRunAt: body.enabled ? nextRunAt(body.cron, new Date(), tz) : new Date(Date.now() + 86400000),
    },
  });
  return c.json({ job }, 201);
});

ntfy.get("/cron/:id", async (c) => {
  const { userId } = c.get("auth");
  const job = await prisma.ntfyCronJob.findUnique({
    where: { id: c.req.param("id"), userId },
  });
  if (!job) return c.json({ error: "Cron job not found" }, 404);
  return c.json({ job });
});

ntfy.put("/cron/:id", zValidator("json", cronSchema.partial()), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json") as Partial<z.infer<typeof cronSchema>>;
  if (body.cron !== undefined && !isValidCron(body.cron)) {
    return c.json({ error: `Invalid cron expression: "${body.cron}"` }, 400);
  }
  if (body.type === "notification" && body.message !== undefined && !body.message.trim()) {
    return c.json({ error: "A message is required for notification-type cron jobs." }, 400);
  }
  if (body.type === "athena" && body.prompt !== undefined && !body.prompt.trim()) {
    return c.json({ error: "A prompt is required for athena-type cron jobs." }, 400);
  }
  const existing = await prisma.ntfyCronJob.findUnique({
    where: { id: c.req.param("id"), userId },
  });
  if (!existing) return c.json({ error: "Cron job not found" }, 404);

  const enabled = body.enabled ?? existing.enabled;
  const cron = body.cron ?? existing.cron;
  const tz = await getUserTimezone(userId);
  const next = enabled ? nextRunAt(cron, new Date(), tz) : new Date(Date.now() + 86400000);

  const job = await prisma.ntfyCronJob.update({
    where: { id: existing.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.cron !== undefined && { cron: body.cron }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.message !== undefined && { message: body.message }),
      ...(body.prompt !== undefined && { prompt: body.prompt }),
      ...(body.title !== undefined && { title: body.title }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      nextRunAt: next,
    },
  });
  return c.json({ job });
});

ntfy.delete("/cron/:id", async (c) => {
  const { userId } = c.get("auth");
  await prisma.ntfyCronJob.deleteMany({ where: { id: c.req.param("id"), userId } });
  return c.json({ ok: true });
});

/** POST /api/ntfy/cron/:id/run — fire a cron job immediately. */
ntfy.post("/cron/:id/run", async (c) => {
  const { userId } = c.get("auth");
  const job = await prisma.ntfyCronJob.findUnique({
    where: { id: c.req.param("id"), userId },
  });
  if (!job) return c.json({ error: "Cron job not found" }, 404);
  const cfg = await decryptNtfyConfig(userId);
  if (!cfg) return c.json({ error: "Ntfy is not configured." }, 400);

  let body = "";
  const title = job.title || "Mavino";
  if (job.type === "athena") {
    const { runAthenaTurn } = await import("../services/ntfy/athena-turn");
    try {
      body = (await runAthenaTurn(userId, job.prompt || job.name)) ?? "[Mavino not configured.]";
    } catch (e) {
      body = `[Mavino error: ${e instanceof Error ? e.message : "unknown"}]`;
    }
  } else {
    body = job.message || job.name;
  }
  body = body.slice(0, 4000);

  try {
    await publish(cfg, {
      topic: cfg.notifyTopic,
      title,
      body,
      priority: job.priority || cfg.defaultPriority,
      tags: job.tags || undefined,
    });
    await prisma.ntfyMessage.create({
      data: {
        userId,
        direction: "cron",
        topic: cfg.notifyTopic,
        title,
        body,
        priority: job.priority || cfg.defaultPriority,
        tags: job.tags || "",
        cronJobId: job.id,
      },
    });
    await pruneMessages(userId);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Publish failed" }, 502);
  }

  // Reschedule next run.
  const tz = await getUserTimezone(userId);
  const next = nextRunAt(job.cron, new Date(), tz);
  await prisma.ntfyCronJob.update({
    where: { id: job.id },
    data: { lastRunAt: new Date(), nextRunAt: next },
  });
  return c.json({ ok: true });
});

/** POST /api/ntfy/cron/preview — preview the next N runs of a cron expression. */
const previewSchema = z.object({
  cron: z.string().min(1).max(100),
  count: z.number().int().min(1).max(10).optional().default(3),
});

ntfy.post("/cron/preview", zValidator("json", previewSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  if (!isValidCron(body.cron)) {
    return c.json({ error: `Invalid cron expression: "${body.cron}"` }, 400);
  }
  const tz = await getUserTimezone(userId);
  const { Cron } = await import("croner");
  const cron = new Cron(body.cron, { timezone: tz });
  const runs: string[] = [];
  let prev: Date | null = new Date();
  for (let i = 0; i < body.count; i++) {
    const next = cron.nextRun(prev);
    if (!next) break;
    runs.push(next.toISOString());
    prev = next;
  }
  return c.json({ runs });
});

export default ntfy;
