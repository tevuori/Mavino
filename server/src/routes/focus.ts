// ===== Focus session logging (Pomodoro → Analytics) =====
// The Pomodoro app POSTs here each time a focus phase completes (natural
// completion or skip). The row feeds the Analytics dashboard's "study hours
// over time" chart and XP. Best-effort from the client — the timer still
// works if this call fails.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";

const focus = new Hono();
focus.use("*", authMiddleware, appTierGate("pomodoro"));

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const logSchema = z.object({
  durationMinutes: z.number().int().min(1).max(600),
  phase: z.string().optional().default("focus"),
  date: z.string().optional(), // YYYY-MM-DD; defaults to today
});

focus.post("/sessions", zValidator("json", logSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const session = await prisma.focusSession.create({
    data: {
      userId,
      date: body.date ?? todayKey(),
      durationMinutes: body.durationMinutes,
      phase: body.phase,
    },
  });
  return c.json({ session }, 201);
});

export default focus;
