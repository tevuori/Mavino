// ===== Proactive alerts routes =====
// Per-user config for the proactive daily briefing scheduler, plus a "test"
// endpoint that fires a one-off briefing immediately so the user can preview
// the output. The scheduler itself lives in services/ntfy/proactive-scheduler.ts.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";
import {
  computeNextRunAt,
  normalizeCategories,
  runProactiveAlertNow,
} from "../services/ntfy/proactive-scheduler";
import { getUserTimezone } from "../services/timezone";

const proactive = new Hono();
// Proactive alerts deliver via ntfy (Paid-tier app).
proactive.use("*", authMiddleware, appTierGate("ntfy"));

const DEFAULT_CATEGORIES = "calendar,tasks,flashcards,habits";

const configSchema = z.object({
  enabled: z.boolean().optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  categories: z.string().max(200).optional(),
  customPrompt: z.string().max(4000).optional(),
});

/** GET /api/proactive-alerts — returns the user's config (upserting a default row if missing). */
proactive.get("/", async (c) => {
  const { userId } = c.get("auth");
  let cfg = await prisma.proactiveAlertConfig.findUnique({ where: { userId } });
  if (!cfg) {
    const tz = await getUserTimezone(userId);
    cfg = await prisma.proactiveAlertConfig.create({
      data: {
        userId,
        enabled: false,
        hour: 8,
        minute: 0,
        categories: DEFAULT_CATEGORIES,
        customPrompt: "",
        nextRunAt: computeNextRunAt(8, 0, new Date(), tz),
      },
    });
  }
  return c.json({ config: cfg });
});

/** PUT /api/proactive-alerts — upsert the user's config and recompute nextRunAt. */
proactive.put("/", zValidator("json", configSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  const existing = await prisma.proactiveAlertConfig.findUnique({ where: { userId } });
  const hour = body.hour ?? existing?.hour ?? 8;
  const minute = body.minute ?? existing?.minute ?? 0;
  const categoriesRaw = body.categories ?? existing?.categories ?? DEFAULT_CATEGORIES;
  const categories = normalizeCategories(categoriesRaw).join(",");
  const enabled = body.enabled ?? existing?.enabled ?? false;
  const customPrompt = body.customPrompt ?? existing?.customPrompt ?? "";

  // Recompute next run to the next occurrence of the configured time in the
  // user's timezone. When disabled the row won't be picked up by the scheduler
  // (it filters on enabled=true), but nextRunAt stays valid for re-enabling.
  const tz = await getUserTimezone(userId);
  const nextRunAt = computeNextRunAt(hour, minute, new Date(), tz);

  const cfg = await prisma.proactiveAlertConfig.upsert({
    where: { userId },
    create: {
      userId,
      enabled,
      hour,
      minute,
      categories,
      customPrompt,
      nextRunAt,
    },
    update: {
      enabled,
      hour,
      minute,
      categories,
      customPrompt,
      nextRunAt,
    },
  });

  return c.json({ config: cfg });
});

/** POST /api/proactive-alerts/test — fire a one-off briefing now and return the generated text. */
proactive.post("/test", async (c) => {
  const { userId } = c.get("auth");
  try {
    const body = await runProactiveAlertNow(userId);
    return c.json({ ok: true, body });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to generate briefing" },
      500
    );
  }
});

export default proactive;
