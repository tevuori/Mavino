// ===== Reminders routes =====
// CRUD for one-shot ntfy-delivered reminders. The scheduler that fires them
// lives in services/reminders/scheduler.ts. Reminders are also created via
// Athena tools (create_reminder / create_llm_reminder); these routes provide
// the manual UI path.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";
import { decryptNtfyConfig } from "../services/ntfy/config";
import { getUserTimezone, parseFireAtInTz } from "../services/timezone";

const reminders = new Hono();
reminders.use("*", authMiddleware, appTierGate("reminders"));

const createSchema = z.object({
  type: z.enum(["basic", "athena"]).default("basic"),
  title: z.string().max(200).optional().default(""),
  message: z.string().max(4000).optional().default(""),
  prompt: z.string().max(4000).optional().default(""),
  fireAt: z.string().min(1),
  priority: z.number().int().min(1).max(5).optional().default(3),
  tags: z.string().max(200).optional().default(""),
});

function validateCreate(body: z.infer<typeof createSchema>): string | null {
  const fireAt = new Date(body.fireAt);
  if (isNaN(fireAt.getTime())) return `Invalid fireAt datetime: "${body.fireAt}"`;
  if (body.type === "basic" && !body.message.trim()) {
    return "A message is required for basic reminders.";
  }
  if (body.type === "athena" && !body.prompt.trim()) {
    return "A prompt is required for athena (smart) reminders.";
  }
  return null;
}

/** Parse fireAt in the user's timezone (naive datetimes interpreted as local). */
async function resolveFireAt(userId: string, raw: string): Promise<Date | null> {
  const tz = await getUserTimezone(userId);
  return parseFireAtInTz(raw, tz);
}

/** GET /api/reminders?status=pending|fired|cancelled|all */
reminders.get("/", async (c) => {
  const { userId } = c.get("auth");
  const status = (c.req.query("status") ?? "pending") as string;
  const where: Record<string, unknown> = { userId };
  if (status === "pending") {
    where.fired = false;
    where.cancelled = false;
  } else if (status === "fired") {
    where.fired = true;
  } else if (status === "cancelled") {
    where.cancelled = true;
  }
  const rows = await prisma.reminder.findMany({
    where: where as never,
    orderBy: { fireAt: "asc" },
    take: 200,
  });
  return c.json({ reminders: rows });
});

/** POST /api/reminders */
reminders.post("/", zValidator("json", createSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const err = validateCreate(body);
  if (err) return c.json({ error: err }, 400);

  const cfg = await decryptNtfyConfig(userId);
  if (!cfg) {
    return c.json(
      { error: "Ntfy is not configured. Set it up in the Ntfy app first." },
      400
    );
  }

  const fireAt = await resolveFireAt(userId, body.fireAt);
  if (!fireAt) return c.json({ error: `Invalid fireAt datetime: "${body.fireAt}"` }, 400);

  const reminder = await prisma.reminder.create({
    data: {
      userId,
      type: body.type,
      title: body.title,
      message: body.message,
      prompt: body.prompt,
      fireAt,
      priority: body.priority,
      tags: body.tags,
    },
  });
  return c.json({ reminder }, 201);
});

/** DELETE /api/reminders/:id — hard delete. */
reminders.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  await prisma.reminder.deleteMany({ where: { id: c.req.param("id"), userId } });
  return c.json({ ok: true });
});

/** POST /api/reminders/:id/cancel — soft cancel (kept for history). */
reminders.post("/:id/cancel", async (c) => {
  const { userId } = c.get("auth");
  const existing = await prisma.reminder.findUnique({
    where: { id: c.req.param("id"), userId },
  });
  if (!existing) return c.json({ error: "Reminder not found" }, 404);
  if (existing.fired) return c.json({ error: "Reminder already fired" }, 400);
  const reminder = await prisma.reminder.update({
    where: { id: existing.id },
    data: { cancelled: true },
  });
  return c.json({ reminder });
});

export default reminders;
