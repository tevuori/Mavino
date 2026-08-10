// ===== Crunch routes (Pro-tier AI exam planner) =====
// Generate (fire-and-forget + polling), fetch, log progress, and delete the
// user's adaptive exam-prep study plan.
//
// Tier gating: Crunch is a Pro-tier app. The middleware returns 402 for
// users below Pro (the client shows a paywall preview instead).

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { isAppAvailableFor } from "../services/features";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../services/athena/llm";
import {
  getCrunchStatus,
  startGenerateCrunch,
  logProgress,
  logDayComplete,
  checkBehindAlert,
  deleteCrunchPlan,
  type CrunchGenerateInput,
  type LogProgressInput,
} from "../services/crunch";

const crunch = new Hono();
crunch.use("*", authMiddleware);

/** Middleware: 402 if the user can't access the Crunch app (Pro-only). */
async function crunchGate(c: any, next: any) {
  const { userId } = c.get("auth");
  if (!(await isAppAvailableFor(userId, "crunch"))) {
    return c.json({ error: "Crunch is a Pro feature. Upgrade to Pro to generate adaptive exam-prep plans." }, 402);
  }
  await next();
}

crunch.use("*", crunchGate);

/** GET / — the user's crunch plan (status + data if ready). Also triggers a
 *  behind-alert check (fire-and-forget) so alerts fire when the user views
 *  the plan or Athena checks status. */
crunch.get("/", async (c) => {
  const { userId } = c.get("auth");
  const status = await getCrunchStatus(userId);
  if (!status) return c.json({ status: "empty", data: null, lastAlertAt: null });
  // Fire-and-forget behind-alert check.
  void checkBehindAlert(userId).catch(() => {});
  return c.json(status);
});

/** POST /generate — kick off a background plan generation. Returns immediately
 *  with status "building"; the client polls GET / until ready. */
crunch.post("/generate", async (c) => {
  const { userId } = c.get("auth");
  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  }
  let model;
  try {
    ({ model } = await acquireLlmModel(userId));
  } catch (e) {
    if (e instanceof LlmError) {
      return c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500);
    }
    return c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500);
  }
  const body = await c.req.json().catch(() => ({})) as CrunchGenerateInput;
  if (!body.exams || !Array.isArray(body.exams) || body.exams.length === 0) {
    return c.json({ error: "Provide at least one exam with a name and date." }, 400);
  }
  // Validate exam fields.
  for (const e of body.exams) {
    if (!e.name?.trim()) return c.json({ error: "Each exam needs a name." }, 400);
    if (!e.date) return c.json({ error: `Exam "${e.name}" needs a date.` }, 400);
    const d = new Date(e.date.length === 10 ? e.date + "T00:00:00Z" : e.date);
    if (isNaN(d.getTime())) return c.json({ error: `Exam "${e.name}" has an invalid date.` }, 400);
  }
  const result = await startGenerateCrunch(userId, model, body);
  return c.json({ id: result.id, status: result.status, data: result.data }, 202);
});

/** POST /progress — log progress on a single task (mark done/not-done). */
crunch.post("/progress", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json().catch(() => ({})) as LogProgressInput;
  if (!body.taskId) return c.json({ error: "taskId is required" }, 400);
  const data = await logProgress(userId, body);
  if (!data) return c.json({ error: "Task not found or plan not ready" }, 404);
  return c.json({ data });
});

/** POST /day-complete — mark all tasks on a given date as done. */
crunch.post("/day-complete", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json().catch(() => ({})) as { date: string };
  if (!body.date) return c.json({ error: "date is required (YYYY-MM-DD)" }, 400);
  const data = await logDayComplete(userId, body.date);
  if (!data) return c.json({ error: "Day not found or plan not ready" }, 404);
  return c.json({ data });
});

/** DELETE / — delete the user's crunch plan. */
crunch.delete("/", async (c) => {
  const { userId } = c.get("auth");
  await deleteCrunchPlan(userId);
  return c.json({ ok: true });
});

export default crunch;
