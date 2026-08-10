// ===== Atlas routes (Pro-tier global knowledge graph) =====
// Build (fire-and-forget + polling), fetch, and query the user's global
// knowledge graph — a stitched map of all their Study Hub concept graphs +
// notes + flashcards + tasks + courses, with mastery/weak-spot signals.
//
// Tier gating: Atlas is a Pro-tier app. The middleware returns 402 for
// users below Pro (the client shows a paywall preview instead).

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { isAppAvailableFor } from "../services/features";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../services/athena/llm";
import {
  getAtlasStatus,
  startBuildAtlas,
  getConceptDetail,
  getWeakConcepts,
  isAtlasStale,
} from "../services/atlas";

const atlas = new Hono();
atlas.use("*", authMiddleware);

/** Middleware: 402 if the user can't access the Atlas app (Pro-only). */
async function atlasGate(c: any, next: any) {
  const { userId } = c.get("auth");
  if (!(await isAppAvailableFor(userId, "atlas"))) {
    return c.json({ error: "Atlas is a Pro feature. Upgrade to Pro to build your global knowledge graph." }, 402);
  }
  await next();
}

atlas.use("*", atlasGate);

/** GET / — the user's atlas (status + data if ready). */
atlas.get("/", async (c) => {
  const { userId } = c.get("auth");
  const status = await getAtlasStatus(userId);
  if (!status) return c.json({ status: "empty", data: null, stale: true });
  const stale = await isAtlasStale(userId);
  return c.json({ ...status, stale });
});

/** POST /build — kick off a background build (or rebuild if stale). Returns
 *  immediately with status "building"; the client polls GET / until ready. */
atlas.post("/build", async (c) => {
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
  const result = await startBuildAtlas(userId, model);
  return c.json({ id: result.id, status: result.status, data: result.data }, 202);
});

/** GET /concept/:id — a single concept with its linked items + related
 *  concepts (for the detail sidebar). */
atlas.get("/concept/:id", async (c) => {
  const { userId } = c.get("auth");
  const detail = await getConceptDetail(userId, c.req.param("id"));
  if (!detail) return c.json({ error: "Concept not found" }, 404);
  return c.json(detail);
});

/** GET /weak — concepts flagged as weak (low mastery or low grades). */
atlas.get("/weak", async (c) => {
  const { userId } = c.get("auth");
  const weak = await getWeakConcepts(userId);
  return c.json({ concepts: weak });
});

export default atlas;
