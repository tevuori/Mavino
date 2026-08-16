// ===== Forge routes (Pro-tier AI practice problem generator) =====
// CRUD for problem sets + problems; LLM generation; LLM grading; variant
// generation; attempt history; stats.
//
// Tier gating: Forge is a Pro-tier app. The middleware returns 402 for
// users below Pro (the client shows a paywall preview instead).

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { isAppAvailableFor } from "../services/features";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../services/athena/llm";
import {
  listProblemSets,
  getProblemSet,
  deleteProblemSet,
  generateProblemSet,
  gradeAttempt,
  generateVariant,
  listAttempts,
  getStats,
  type ForgeSource,
} from "../services/forge";

const forge = new Hono();
forge.use("*", authMiddleware);

/** Middleware: 402 if the user can't access the Forge app (Pro-only). */
async function forgeGate(c: any, next: any) {
  const { userId } = c.get("auth");
  if (!(await isAppAvailableFor(userId, "forge"))) {
    return c.json({ error: "Forge is a Pro feature. Upgrade to Pro to generate AI practice problems." }, 402);
  }
  await next();
}

forge.use("*", forgeGate);

const sourceSchema = z.object({
  kind: z.enum(["note", "file", "atlas", "text"]),
  refId: z.string().max(500).optional(),
  name: z.string().max(500),
  text: z.string().max(50000).optional(),
});

const generateSchema = z.object({
  title: z.string().max(500).optional(),
  source: sourceSchema,
  format: z.enum(["mcq", "short_answer", "step_by_step", "mixed"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard", "adaptive"]).optional(),
  count: z.number().int().min(3).max(20).optional(),
  conceptIds: z.array(z.string().max(200)).optional(),
});

const gradeSchema = z.object({
  problemId: z.string().max(200),
  submitted: z.string().max(10000),
});

const variantSchema = z.object({
  problemId: z.string().max(200),
});

/** GET /sets — list the user's problem sets. */
forge.get("/sets", async (c) => {
  const { userId } = c.get("auth");
  const sets = await listProblemSets(userId);
  return c.json({ sets });
});

/** POST /sets/generate — generate a new problem set (LLM). */
forge.post("/sets/generate", zValidator("json", generateSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  }
  let model;
  try {
    ({ model } = await acquireLlmModel(userId));
  } catch (e) {
    if (e instanceof LlmError) return c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500);
    return c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500);
  }
  try {
    const result = await generateProblemSet(userId, model, body as any);
    return c.json(result, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Generation failed" }, 400);
  }
});

/** GET /sets/:id — get a problem set with all problems. */
forge.get("/sets/:id", async (c) => {
  const { userId } = c.get("auth");
  const set = await getProblemSet(userId, c.req.param("id"));
  if (!set) return c.json({ error: "Problem set not found" }, 404);
  return c.json({ set });
});

/** DELETE /sets/:id — delete a problem set. */
forge.delete("/sets/:id", async (c) => {
  const { userId } = c.get("auth");
  await deleteProblemSet(userId, c.req.param("id"));
  return c.json({ ok: true });
});

/** POST /grade — grade a submitted answer (LLM for short_answer/step_by_step, deterministic for MCQ). */
forge.post("/grade", zValidator("json", gradeSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  // MCQ can be graded without LLM, but short_answer/step_by_step need it.
  // We always acquire the model for simplicity — the gradeAttempt function
  // skips LLM for MCQ.
  let model: any = null;
  const configured = await isLlmConfiguredFor(userId);
  if (configured) {
    try {
      ({ model } = await acquireLlmModel(userId));
    } catch (e) {
      if (e instanceof LlmError) return c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500);
    }
  }
  try {
    const attempt = await gradeAttempt(userId, model, body.problemId, body.submitted);
    return c.json({ attempt }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Grading failed" }, 400);
  }
});

/** POST /variant — generate a variant of a problem (LLM). */
forge.post("/variant", zValidator("json", variantSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  }
  let model;
  try {
    ({ model } = await acquireLlmModel(userId));
  } catch (e) {
    if (e instanceof LlmError) return c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500);
    return c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500);
  }
  try {
    const result = await generateVariant(userId, model, body.problemId);
    return c.json(result, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Variant generation failed" }, 400);
  }
});

/** GET /attempts — list attempt history (optionally filtered by set). */
forge.get("/attempts", async (c) => {
  const { userId } = c.get("auth");
  const setId = c.req.query("setId");
  const attempts = await listAttempts(userId, setId);
  return c.json({ attempts });
});

/** GET /stats — get Forge usage stats. */
forge.get("/stats", async (c) => {
  const { userId } = c.get("auth");
  const stats = await getStats(userId);
  return c.json(stats);
});

export default forge;
