/**
 * Anonymous per-feature usage analytics.
 *
 * The middleware in index.ts calls `recordHit(feature)` on every non-OPTIONS
 * API request. Hits are accumulated in an in-memory Map keyed by
 * `feature|YYYY-MM-DD` and flushed to the `UsageStat` table every 30s by
 * `startAnalyticsFlusher()`. This avoids a DB write per request while keeping
 * the data durable within ~30s.
 *
 * Privacy: NO userId is ever stored. Only `feature + day + count` aggregates.
 */

import type { Context, Next } from "hono";
import prisma from "../db/client";

// In-memory buffer: key = `${feature}|${YYYY-MM-DD}`, value = hit count.
const buffer = new Map<string, number>();

const FLUSH_INTERVAL_MS = 30_000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Truncate a Date to UTC midnight (used as the day bucket). */
export function dayBucket(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Format a Date as YYYY-MM-DD (UTC). Used for the in-memory key only. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Increment the in-memory counter for a feature on the current day. */
export function recordHit(feature: string): void {
  if (!feature) return;
  const key = `${feature}|${dayKey(new Date())}`;
  buffer.set(key, (buffer.get(key) ?? 0) + 1);
}

/**
 * Map a request path to a feature name. Returns "" for paths that should
 * not be counted (auth, analytics itself, health, OPTIONS preflight).
 */
function featureForPath(path: string): string {
  // Only count /api/* routes.
  if (!path.startsWith("/api/")) return "";
  // Exclude auth (login noise) and analytics itself (admin viewing skew).
  if (path.startsWith("/api/auth")) return "";
  if (path.startsWith("/api/analytics")) return "";

  // Order matters: longer/more specific prefixes first.
  const map: [string, string][] = [
    ["/api/study", "study"],
    ["/api/conversations", "athena"],
    ["/api/athena", "athena"],
    ["/api/notes", "notes"],
    ["/api/tasks", "tasks"],
    ["/api/files", "files"],
    ["/api/flashcards", "flashcards"],
    ["/api/grades", "grades"],
    ["/api/calendar", "calendar"],
    ["/api/habits", "habits"],
    ["/api/whiteboards", "whiteboard"],
    ["/api/spotify", "spotify"],
    ["/api/lyrics", "spotify"],
    ["/api/voice", "voice"],
    ["/api/ntfy", "ntfy"],
    ["/api/browser", "browser"],
    ["/api/microsoft", "microsoft"],
    ["/api/teacher", "teacher"],
    ["/api/capture", "capture"],
    ["/api/ai", "ai"],
    ["/api/reminders", "reminders"],
    ["/api/proactive-alerts", "proactive-alerts"],
    ["/api/links", "links"],
    ["/api/tts", "tts"],
    ["/api/users", "users"],
  ];
  for (const [prefix, feature] of map) {
    if (path.startsWith(prefix)) return feature;
  }
  return "";
}

/** Hono middleware: records an anonymous feature hit, then continues. */
export async function analyticsMiddleware(c: Context, next: Next) {
  if (c.req.method !== "OPTIONS") {
    const feature = featureForPath(c.req.path);
    if (feature) recordHit(feature);
  }
  await next();
}

/** Flush the in-memory buffer to the UsageStat table (upsert + sum). */
export async function flushAnalytics(): Promise<void> {
  if (buffer.size === 0) return;
  // Snapshot + clear atomically so concurrent recordHit() calls during the
  // flush don't get lost (they'll go into a fresh buffer).
  const snapshot = new Map(buffer);
  buffer.clear();
  try {
    await Promise.all(
      Array.from(snapshot.entries()).map(([key, count]) => {
        const [feature, dayStr] = key.split("|");
        const day = new Date(`${dayStr}T00:00:00.000Z`);
        return prisma.usageStat.upsert({
          where: { feature_day: { feature, day } },
          create: { feature, day, count },
          update: { count: { increment: count } },
        });
      })
    );
  } catch (e) {
    // On failure, re-add the snapshot counts back into the buffer so the
    // next flush retries them (capped to avoid unbounded growth on repeated
    // failures — we just accept the loss of this batch if re-adding fails).
    console.error("[analytics] flush failed:", e);
    for (const [key, count] of snapshot) {
      buffer.set(key, (buffer.get(key) ?? 0) + count);
    }
  }
}

/** Start the periodic flusher. Safe to call once at server startup. */
export function startAnalyticsFlusher(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushAnalytics().catch((e) =>
      console.error("[analytics] flusher error:", e)
    );
  }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive solely for the flusher.
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}
