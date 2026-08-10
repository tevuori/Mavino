// ===== Habit Tracker =====
// CRUD for Habit + HabitLog rows, plus a /stats endpoint that computes
// current/longest streaks and the last-30-day completion array.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";

const habits = new Hono();
habits.use("*", authMiddleware, appTierGate("habits"));

const habitSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().optional().default("✅"),
  color: z.string().optional().default("#6366f1"),
  cadence: z.enum(["daily", "weekly"]).optional().default("daily"),
  target: z.number().int().min(1).optional().default(1),
  linkedApp: z.string().nullable().optional(),
  linkedMetric: z.string().nullable().optional(),
});

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

habits.get("/", async (c) => {
  const { userId } = c.get("auth");
  const list = await prisma.habit.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { logs: true } } },
  });
  return c.json({ habits: list });
});

habits.post("/", zValidator("json", habitSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const habit = await prisma.habit.create({
    data: { ...body, userId } as never,
  });
  return c.json({ habit }, 201);
});

habits.patch("/:id", zValidator("json", habitSchema.partial()), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const habit = await prisma.habit.update({
    where: { id: c.req.param("id"), userId },
    data: body as never,
  });
  return c.json({ habit });
});

habits.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  await prisma.habit.delete({ where: { id: c.req.param("id"), userId } });
  return c.json({ ok: true });
});

// GET /:id/logs?from=&to=
habits.get("/:id/logs", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const where: Record<string, unknown> = { habitId: id, userId };
  if (from || to) {
    const range: Record<string, unknown> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    where.date = range;
  }
  const logs = await prisma.habitLog.findMany({
    where: where as never,
    orderBy: { date: "asc" },
  });
  return c.json({ logs });
});

// POST /:id/log — upsert today's (or given date's) log
const logSchema = z.object({
  date: z.string().optional(),
  value: z.number().int().min(0).optional().default(1),
});

habits.post("/:id/log", zValidator("json", logSchema), async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const date = body.date ?? todayKey();
  const habit = await prisma.habit.findUnique({ where: { id, userId } });
  if (!habit) return c.json({ error: "Habit not found" }, 404);
  const log = await prisma.habitLog.upsert({
    where: { habitId_date: { habitId: id, date } },
    create: { habitId: id, userId, date, value: body.value },
    update: { value: body.value },
  });
  return c.json({ log });
});

habits.delete("/:id/log", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  const date = c.req.query("date") ?? todayKey();
  await prisma.habitLog.deleteMany({ where: { habitId: id, userId, date } });
  return c.json({ ok: true });
});

// GET /stats — per-habit streak + last-30-day completion
habits.get("/stats", async (c) => {
  const { userId } = c.get("auth");
  const list = await prisma.habit.findMany({ where: { userId } });
  const today = todayKey();
  const thirtyAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const stats = await Promise.all(
    list.map(async (h) => {
      const logs = await prisma.habitLog.findMany({
        where: { habitId: h.id, userId, date: { gte: thirtyAgo, lte: today } },
        orderBy: { date: "asc" },
      });
      const logDates = new Set(logs.map((l) => l.date));
      const last30 = logs.map((l) => l.date);

      // Compute current streak (consecutive days ending today or yesterday).
      let currentStreak = 0;
      const cursor = new Date(today);
      // Allow today to be unlogged without breaking the streak (streak still
      // counts if yesterday was logged).
      if (!logDates.has(today)) {
        cursor.setDate(cursor.getDate() - 1);
      }
      while (logDates.has(cursor.toISOString().slice(0, 10))) {
        currentStreak++;
        cursor.setDate(cursor.getDate() - 1);
      }

      // Longest streak across all logs.
      const allLogs = await prisma.habitLog.findMany({
        where: { habitId: h.id, userId },
        orderBy: { date: "asc" },
      });
      let longest = 0;
      let run = 0;
      let prev: Date | null = null;
      for (const l of allLogs) {
        const d = new Date(l.date);
        if (prev) {
          const diff = Math.round((d.getTime() - prev.getTime()) / 86400000);
          run = diff === 1 ? run + 1 : 1;
        } else {
          run = 1;
        }
        if (run > longest) longest = run;
        prev = d;
      }

      return {
        habitId: h.id,
        currentStreak,
        longestStreak: longest,
        last30,
        totalLogs: allLogs.length,
      };
    })
  );
  return c.json({ stats });
});

export default habits;
