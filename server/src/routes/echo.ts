// ===== Echo routes (Pro-tier live lecture companion) =====
// Start a live session, upload audio chunks for real-time transcription +
// concept matching, stop + finalize (generate structured note + new terms),
// list/delete past sessions.
//
// Tier gating: Echo is a Pro-tier app. The middleware returns 402 for
// users below Pro (the client shows a paywall preview instead).

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { isAppAvailableFor } from "../services/features";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../services/athena/llm";
import {
  startSession,
  getSession,
  getActiveSession,
  listSessions,
  deleteSession,
  processChunk,
  stopSession,
} from "../services/echo";

const echo = new Hono();
echo.use("*", authMiddleware);

/** Middleware: 402 if the user can't access the Echo app (Pro-only). */
async function echoGate(c: any, next: any) {
  const { userId } = c.get("auth");
  if (!(await isAppAvailableFor(userId, "echo"))) {
    return c.json({ error: "Echo is a Pro feature. Upgrade to Pro to use the live lecture companion." }, 402);
  }
  await next();
}

echo.use("*", echoGate);

const startSessionSchema = z.object({
  title: z.string().max(1000).optional(),
  language: z.enum(["en", "cs"]).optional(),
});

/** POST /sessions — start a new live lecture session (or reuse the active one).
 *  Body: { title?: string, language?: "en" | "cs" } */
echo.post("/sessions", zValidator("json", startSessionSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const session = await startSession(userId, {
    title: body.title,
    language: body.language === "cs" ? "cs" : "en",
  });
  return c.json(session, 201);
});

/** GET /sessions/active — the user's currently active session (or null). */
echo.get("/sessions/active", async (c) => {
  const { userId } = c.get("auth");
  const session = await getActiveSession(userId);
  return c.json({ session });
});

/** GET /sessions/:id — a specific session (transcript + concepts + newTerms). */
echo.get("/sessions/:id", async (c) => {
  const { userId } = c.get("auth");
  const session = await getSession(userId, c.req.param("id"));
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(session);
});

/** GET /sessions — list past (completed/failed) sessions. */
echo.get("/sessions", async (c) => {
  const { userId } = c.get("auth");
  const sessions = await listSessions(userId);
  return c.json({ sessions });
});

/** POST /sessions/:id/chunk — upload an audio chunk for transcription.
 *  Multipart: audio (File) + offsetSec (string, seconds from session start) +
 *  durationSec (string, seconds of audio in this chunk).
 *  Transcribes the chunk, appends to the transcript, re-matches concepts,
 *  and returns the updated session. */
echo.post("/sessions/:id/chunk", async (c) => {
  const { userId } = c.get("auth");
  const sessionId = c.req.param("id");
  const formData = await c.req.formData();
  const audio = formData.get("audio");
  const offsetSec = parseFloat((formData.get("offsetSec") as string) ?? "0");
  const durationSec = parseFloat((formData.get("durationSec") as string) ?? "0");

  if (!(audio instanceof File)) {
    return c.json({ error: "No audio chunk provided" }, 400);
  }
  if (!audio.type.startsWith("audio/") && !audio.type.startsWith("video/")) {
    return c.json({ error: "File is not audio" }, 400);
  }
  if (isNaN(offsetSec) || offsetSec < 0) {
    return c.json({ error: "offsetSec must be a non-negative number" }, 400);
  }
  if (isNaN(durationSec) || durationSec < 0) {
    return c.json({ error: "durationSec must be a non-negative number" }, 400);
  }

  const audioBuf = Buffer.from(await audio.arrayBuffer());
  const session = await processChunk(userId, sessionId, audioBuf, audio.type, offsetSec, durationSec);
  if (!session) return c.json({ error: "Session not found or not active" }, 404);
  return c.json(session);
});

/** POST /sessions/:id/stop — stop the session and finalize (generate note +
 *  new terms via LLM). Returns the completed session. */
echo.post("/sessions/:id/stop", async (c) => {
  const { userId } = c.get("auth");
  const sessionId = c.req.param("id");
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
  const session = await stopSession(userId, sessionId, model);
  if (!session) return c.json({ error: "Session not found or not active" }, 404);
  return c.json(session);
});

/** DELETE /sessions/:id — delete a session. */
echo.delete("/sessions/:id", async (c) => {
  const { userId } = c.get("auth");
  const ok = await deleteSession(userId, c.req.param("id"));
  if (!ok) return c.json({ error: "Session not found" }, 404);
  return c.json({ ok: true });
});

export default echo;
