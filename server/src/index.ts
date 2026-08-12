import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import auth from "./routes/auth";
import notes from "./routes/notes";
import tasks from "./routes/tasks";
import taskWorkspaces from "./routes/task-workspaces";
import files from "./routes/files";
import spotify from "./routes/spotify";
import lyrics from "./routes/lyrics";
import flashcards from "./routes/flashcards";
import grades from "./routes/grades";
import vut from "./routes/vut";
import ai from "./routes/ai";
import athena from "./routes/athena";
import conversations from "./routes/conversations";
import study from "./routes/study";
import studySources from "./routes/study-sources";
import studyChat from "./routes/study-chat";
import studyPodcasts from "./routes/study-podcasts";
import studyWorkspaces from "./routes/study-workspaces";
import studyHighlights from "./routes/study-highlights";
import studyGraph from "./routes/study-graph";
import moodle from "./routes/moodle";
import calendar from "./routes/calendar";
import habits from "./routes/habits";
import whiteboards from "./routes/whiteboards";
import capture from "./routes/capture";
import microsoft, { msOAuthCallback } from "./routes/microsoft";
import users from "./routes/users";
import ntfy from "./routes/ntfy";
import voice from "./routes/voice";
import links from "./routes/links";
import proactiveAlerts from "./routes/proactive-alerts";
import browser from "./routes/browser";
import teacher from "./routes/teacher";
import tts from "./routes/tts";
import reminders from "./routes/reminders";
import analytics from "./routes/analytics";
import focus from "./routes/focus";
import mapy from "./routes/mapy";
import atlas from "./routes/atlas";
import crunch from "./routes/crunch";
import compass from "./routes/compass";
import echo from "./routes/echo";
import pulse from "./routes/pulse";
import studyLectures from "./routes/study-lectures";
import settings from "./routes/settings";
import features from "./routes/features";
import subscriptions from "./routes/subscriptions";
import plugins from "./routes/plugins";
import clientErrors from "./routes/client-errors";
import adminErrors from "./routes/admin-errors";
import adminLlm from "./routes/admin-llm";
import adminStorage from "./routes/admin-storage";
import studyFunctions from "./routes/study-functions";
import { analyticsMiddleware, startAnalyticsFlusher } from "./services/analytics";
import { logError } from "./services/error-log";
import { startScheduler, stopScheduler } from "./services/ntfy/scheduler";
import { startAllSubscribers, stopAllSubscribers } from "./services/ntfy/subscriber";
import { startProactiveScheduler, stopProactiveScheduler } from "./services/ntfy/proactive-scheduler";
import { startReminderScheduler, stopReminderScheduler } from "./services/reminders/scheduler";
import { startDemoCleanup } from "./services/demo";
import prisma from "./db/client";

const app = new Hono();

// Catch stray promises that escape all try/catch — without this, Bun logs a
// warning but the error context is lost. With it, we get a clean log entry.
process.on("unhandledRejection", (reason) => {
  console.error("[mavino-server] Unhandled promise rejection:", reason);
  void logError({
    source: "server",
    level: "error",
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack ?? undefined : undefined,
  });
});

// Global error handler — returns JSON (not Hono's default plain-text "Internal
// Server Error") so the client's JSON.parse never fails on unhandled errors.
// Also persists the error to the ErrorLog table for admin monitoring.
app.onError((err, c) => {
  console.error("[mavino-server] Unhandled error:", err);
  const userId = c.get("auth")?.userId;
  void logError({
    source: "server",
    level: "error",
    message: err instanceof Error ? err.message : "Internal server error",
    stack: err instanceof Error ? err.stack ?? undefined : undefined,
    url: c.req.url,
    userAgent: c.req.header("user-agent") ?? undefined,
    userId,
  });
  const message =
    err instanceof Error ? err.message : "Internal server error";
  return c.json({ error: message }, 500);
});

app.use("*", logger());
// CORS: restrict to the configured client origin(s) for public deployments.
// CLIENT_ORIGIN may be a single origin or a comma-separated list. When unset
// (local dev), fall back to reflecting the request origin so dev still works.
// In production, CLIENT_ORIGIN MUST be set — otherwise the server refuses to
// start (a wide-open CORS policy lets any website make authenticated requests).
// The Capacitor native app always originates from https://localhost (or
// capacitor://localhost on some configs) — we allow these unconditionally
// so the APK can talk to the server without extra config.
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CAPACITOR_ORIGINS = ["https://localhost", "http://localhost", "capacitor://localhost"];
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && allowedOrigins.length === 0) {
  console.error(
    "[mavino-server] FATAL: CLIENT_ORIGIN is not set.\n" +
      "In production, set CLIENT_ORIGIN to your deployed origin(s), e.g.:\n" +
      "  CLIENT_ORIGIN=https://mavino.example.com\n" +
      "Comma-separated lists are supported. Without this, CORS is wide open."
  );
  process.exit(1);
}
if (!isProduction && allowedOrigins.length === 0) {
  console.warn(
    "[mavino-server] WARNING: CLIENT_ORIGIN unset — CORS reflects any origin (dev only). Set CLIENT_ORIGIN before deploying."
  );
}

app.use(
  "*",
  cors({
    origin: (origin) => {
      // In production, allowedOrigins is guaranteed non-empty (checked above).
      // In dev with no CLIENT_ORIGIN, reflect the origin so local dev works.
      if (allowedOrigins.length === 0) return origin ?? "*";
      if (origin && allowedOrigins.includes(origin)) return origin;
      if (origin && CAPACITOR_ORIGINS.includes(origin)) return origin;
      return null; // reject non-allowed origins
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
// Anonymous per-feature usage counter (in-memory, flushed every 30s).
// Runs after CORS so only allowed-origin requests are counted. Skips
// OPTIONS preflight and auth/analytics routes itself.
app.use("*", analyticsMiddleware);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "mavino-server",
    version: "0.1.0",
    // Spotify is now per-user; report whether the server-wide env fallback exists.
    spotifyEnvFallback: Boolean(
      process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_REFRESH_TOKEN
    ),
  })
);

// Public Microsoft OAuth2 callback — mounted at the root (not under /api/microsoft)
// so it bypasses the auth middleware. The redirect URI registered in Azure must
// match: https://<your-domain>/auth/callback (configurable via MS_REDIRECT_URI).
app.get("/auth/callback", msOAuthCallback);

app.route("/api/auth", auth);
app.route("/api/notes", notes);
app.route("/api/tasks", tasks);
app.route("/api/task-workspaces", taskWorkspaces);
app.route("/api/files", files);
app.route("/api/spotify", spotify);
app.route("/api/lyrics", lyrics);
app.route("/api/flashcards", flashcards);
app.route("/api/grades", grades);
app.route("/api/vut", vut);
app.route("/api/ai", ai);
app.route("/api/athena", athena);
app.route("/api/conversations", conversations);
app.route("/api/study", study);
app.route("/api/study/sources", studySources);
app.route("/api/study/chat", studyChat);
app.route("/api/study/podcasts", studyPodcasts);
app.route("/api/study/workspaces", studyWorkspaces);
app.route("/api/study/highlights", studyHighlights);
app.route("/api/study/graph", studyGraph);
app.route("/api/study/lectures", studyLectures);
app.route("/api/study-functions", studyFunctions);
app.route("/api/moodle", moodle);
app.route("/api/calendar", calendar);
app.route("/api/habits", habits);
app.route("/api/whiteboards", whiteboards);
app.route("/api/capture", capture);
app.route("/api/microsoft", microsoft);
app.route("/api/users", users);
app.route("/api/ntfy", ntfy);
app.route("/api/voice", voice);
app.route("/api/links", links);
app.route("/api/proactive-alerts", proactiveAlerts);
app.route("/api/browser", browser);
app.route("/api/teacher", teacher);
app.route("/api/tts", tts);
app.route("/api/reminders", reminders);
app.route("/api/analytics", analytics);
app.route("/api/focus", focus);
app.route("/api/settings", settings);
app.route("/api/features", features);
app.route("/api/subscriptions", subscriptions);
app.route("/api/plugins", plugins);
app.route("/api/mapy", mapy);
app.route("/api/atlas", atlas);
app.route("/api/crunch", crunch);
app.route("/api/compass", compass);
app.route("/api/echo", echo);
app.route("/api/pulse", pulse);
app.route("/api/client-errors", clientErrors);
app.route("/api/admin/errors", adminErrors);
app.route("/api/admin/llm", adminLlm);
app.route("/api/admin/storage", adminStorage);

// Start ntfy background workers (cron scheduler + per-user inbox subscribers).
startScheduler();
startAllSubscribers().catch((e) =>
  console.error("[mavino-server] ntfy subscriber startup error:", e)
);
// Start the proactive daily-briefing scheduler.
startProactiveScheduler();
// Start the one-shot reminder scheduler.
startReminderScheduler();
// Start demo-user cleanup (removes expired DEMO accounts + cascaded data).
startDemoCleanup();
// Start the anonymous usage-analytics flusher (writes buffered hits to DB every 30s).
startAnalyticsFlusher();

const port = Number(process.env.SERVER_PORT ?? 3000);
const hostname = process.env.SERVER_HOST ?? "0.0.0.0";

// Bun-native serve pattern: export default { port, fetch }.
// idleTimeout is in seconds — default 10s kills SSE streams mid-tool-loop.
// Set to 300s (5 min) so Athena chat streams with multi-step tool calls survive.
// maxRequestBodySize raised to 2 GB to support lecture video uploads.
console.log(`[mavino-server] Bun serving on http://${hostname}:${port}`);
export default {
  port,
  hostname,
  idleTimeout: 255,
  maxRequestBodySize: 2 * 1024 * 1024 * 1024, // 2 GB
  fetch: app.fetch,
};

// Graceful shutdown — stop background workers and close the Prisma connection
// pool so PostgreSQL doesn't accumulate orphaned connections on restart.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[mavino-server] Received ${signal}, shutting down gracefully...`);
  stopScheduler();
  stopAllSubscribers();
  stopProactiveScheduler();
  stopReminderScheduler();
  try {
    await prisma.$disconnect();
    console.log("[mavino-server] Prisma disconnected.");
  } catch (e) {
    console.error("[mavino-server] Error disconnecting Prisma:", e);
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
