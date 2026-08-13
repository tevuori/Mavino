// ===== Concept Bridge routes (Pro-tier interdisciplinary connection surfacer) =====
// List/view/mark-seen/delete bridges; LLM discovery; stats; concept lookup.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { isAppAvailableFor } from "../services/features";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../services/athena/llm";
import {
  listBridges,
  getBridge,
  markBridgeSeen,
  markAllBridgesSeen,
  deleteBridge,
  getBridgeStats,
  discoverBridges,
  getBridgesForConcept,
  getBridgesForLabel,
} from "../services/bridge";

const bridge = new Hono();
bridge.use("*", authMiddleware);

/** Middleware: 402 if the user can't access the Bridge feature (Pro-only). */
async function bridgeGate(c: any, next: any) {
  const { userId } = c.get("auth");
  if (!(await isAppAvailableFor(userId, "bridge"))) {
    return c.json({ error: "Concept Bridge is a Pro feature. Upgrade to Pro to discover interdisciplinary connections." }, 402);
  }
  await next();
}

bridge.use("*", bridgeGate);

/** GET / — list bridges (optionally only unseen). */
bridge.get("/", async (c) => {
  const { userId } = c.get("auth");
  const onlyUnseen = c.req.query("unseen") === "true";
  const bridges = await listBridges(userId, onlyUnseen);
  return c.json({ bridges });
});

/** GET /stats — bridge stats. */
bridge.get("/stats", async (c) => {
  const { userId } = c.get("auth");
  const stats = await getBridgeStats(userId);
  return c.json(stats);
});

/** POST /discover — run LLM bridge discovery. */
bridge.post("/discover", async (c) => {
  const { userId } = c.get("auth");
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
    const result = await discoverBridges(userId, model);
    return c.json(result, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Discovery failed" }, 400);
  }
});

/** GET /:id — get a specific bridge. */
bridge.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const b = await getBridge(userId, c.req.param("id"));
  if (!b) return c.json({ error: "Bridge not found" }, 404);
  return c.json({ bridge: b });
});

/** POST /:id/seen — mark a bridge as seen. */
bridge.post("/:id/seen", async (c) => {
  const { userId } = c.get("auth");
  await markBridgeSeen(userId, c.req.param("id"));
  return c.json({ ok: true });
});

/** POST /seen-all — mark all bridges as seen. */
bridge.post("/seen-all", async (c) => {
  const { userId } = c.get("auth");
  await markAllBridgesSeen(userId);
  return c.json({ ok: true });
});

/** DELETE /:id — delete a bridge. */
bridge.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  await deleteBridge(userId, c.req.param("id"));
  return c.json({ ok: true });
});

/** GET /concept/:conceptId — get bridges for a specific Atlas concept. */
bridge.get("/concept/:conceptId", async (c) => {
  const { userId } = c.get("auth");
  const bridges = await getBridgesForConcept(userId, c.req.param("conceptId"));
  return c.json({ bridges });
});

const labelSchema = z.object({
  label: z.string().max(500),
});

/** POST /label — find bridges involving a concept with the given label. */
bridge.post("/label", zValidator("json", labelSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const bridges = await getBridgesForLabel(userId, body.label);
  return c.json({ bridges });
});

export default bridge;
