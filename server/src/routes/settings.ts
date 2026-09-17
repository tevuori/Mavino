// ===== Settings routes =====
// Per-user server-side settings that backends/schedulers need (currently just
// the timezone). Stored in the Setting key/value table via services/timezone.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import {
  getUserTimezone,
  setUserTimezone,
  isValidTimezone,
  SERVER_TIMEZONE,
} from "../services/timezone";
import { computeNextRunAt } from "../services/ntfy/proactive-scheduler";
import { nextRunAt } from "../services/ntfy/scheduler";
import prisma from "../db/client";
import { getUserLanguage, setUserLanguage } from "../services/language";

const settings = new Hono();
settings.use("*", authMiddleware);

/** GET /api/settings/timezone — returns the user's timezone + server default. */
settings.get("/timezone", async (c) => {
  const { userId } = c.get("auth");
  const timezone = await getUserTimezone(userId);
  return c.json({ timezone, serverTimezone: SERVER_TIMEZONE });
});

const languageSchema = z.object({ language: z.enum(["en", "cs"]) });

settings.get("/language", async (c) => {
  const { userId } = c.get("auth");
  return c.json({ language: await getUserLanguage(userId) });
});

settings.put("/language", zValidator("json", languageSchema), async (c) => {
  const { userId } = c.get("auth");
  const { language } = c.req.valid("json");
  await setUserLanguage(userId, language);
  return c.json({ language });
});

const tzSchema = z.object({ timezone: z.string().min(1).max(100) });

/** PUT /api/settings/timezone — set the user's timezone (IANA name). */
settings.put("/timezone", zValidator("json", tzSchema), async (c) => {
  const { userId } = c.get("auth");
  const { timezone } = c.req.valid("json");
  if (!isValidTimezone(timezone)) {
    return c.json({ error: `Invalid timezone: "${timezone}"` }, 400);
  }
  await setUserTimezone(userId, timezone);

  // Recompute nextRunAt for the user's proactive alert + enabled cron jobs so
  // the new timezone takes effect immediately (otherwise they'd self-correct
  // only after the next fire/reschedule).
  try {
    const pa = await prisma.proactiveAlertConfig.findUnique({ where: { userId } });
    if (pa && pa.enabled) {
      const next = computeNextRunAt(pa.hour, pa.minute, new Date(), timezone);
      await prisma.proactiveAlertConfig.update({
        where: { id: pa.id },
        data: { nextRunAt: next },
      });
    }
  } catch {
    /* proactive alerts optional */
  }
  try {
    const jobs = await prisma.ntfyCronJob.findMany({
      where: { userId, enabled: true },
    });
    for (const job of jobs) {
      try {
        const next = nextRunAt(job.cron, new Date(), timezone);
        await prisma.ntfyCronJob.update({
          where: { id: job.id },
          data: { nextRunAt: next },
        });
      } catch {
        /* invalid cron — skip */
      }
    }
  } catch {
    /* cron jobs optional */
  }

  return c.json({ timezone });
});

export default settings;
