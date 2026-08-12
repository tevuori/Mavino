// ===== Pulse routes (Pro-tier predictive forgetting-curve & mastery forecast) =====
// Build (fire-and-forget + polling), fetch, and query the user's predictive
// mastery forecast — per-card forgetting curves fit from FlashcardReview
// history, projected forward to each Crunch exam date.
//
// Tier gating: Pulse is a Pro-tier app. The middleware returns 402 for
// users below Pro (the client shows a paywall preview instead).
//
// Unlike Atlas/Crunch, the Pulse forecast is deterministic (no LLM needed),
// so the /build endpoint doesn't require an AI provider to be configured.

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { isAppAvailableFor } from "../services/features";
import {
  getPulseStatus,
  startBuildPulse,
  isPulseStale,
  getAtRiskConcepts,
  checkAtRiskAlert,
  deletePulseForecast,
} from "../services/pulse";

const pulse = new Hono();
pulse.use("*", authMiddleware);

/** Middleware: 402 if the user can't access the Pulse app (Pro-only). */
async function pulseGate(c: any, next: any) {
  const { userId } = c.get("auth");
  if (!(await isAppAvailableFor(userId, "pulse"))) {
    return c.json({ error: "Pulse is a Pro feature. Upgrade to Pro to forecast your mastery and find at-risk concepts." }, 402);
  }
  await next();
}

pulse.use("*", pulseGate);

/** GET / — the user's pulse forecast (status + data if ready). Also triggers
 *  an at-risk alert check (fire-and-forget) so alerts fire when the user
 *  views the forecast or Athena checks status. */
pulse.get("/", async (c) => {
  const { userId } = c.get("auth");
  const status = await getPulseStatus(userId);
  if (!status) return c.json({ status: "empty", data: null, stale: true, lastAlertAt: null });
  const stale = await isPulseStale(userId);
  // Fire-and-forget at-risk alert check.
  void checkAtRiskAlert(userId).catch(() => {});
  return c.json({ ...status, stale });
});

/** POST /build — kick off a background forecast build (or rebuild if stale).
 *  Returns immediately with status "building"; the client polls GET / until
 *  ready. No LLM required — the forecast is deterministic. */
pulse.post("/build", async (c) => {
  const { userId } = c.get("auth");
  const result = await startBuildPulse(userId);
  return c.json({ id: result.id, status: result.status, data: result.data }, 202);
});

/** GET /at-risk — concepts predicted to drop below mastery before the nearest
 *  exam (for Athena + UI highlights). */
pulse.get("/at-risk", async (c) => {
  const { userId } = c.get("auth");
  const atRisk = await getAtRiskConcepts(userId);
  return c.json({ concepts: atRisk });
});

/** DELETE / — delete the user's pulse forecast. */
pulse.delete("/", async (c) => {
  const { userId } = c.get("auth");
  await deletePulseForecast(userId);
  return c.json({ ok: true });
});

export default pulse;
