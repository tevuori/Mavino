/**
 * Client-side error reporting.
 *
 * Captures unhandled errors and React render crashes, then sends them to the
 * server's /api/client-errors endpoint. This is a lightweight self-hosted
 * alternative to Sentry — errors appear in `docker logs athena-server` with
 * context (URL, user agent, stack trace, user ID if authenticated).
 *
 * If SENTRY_DSN is configured on the server, the server can forward errors
 * to Sentry (future enhancement). For now, all errors are logged server-side.
 */

import { isStaleChunkError, reloadWithCacheBust } from "./stale-chunk";

interface ErrorReport {
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  url: string;
  userAgent: string;
  userId?: string;
  componentStack?: string;
  timestamp: string;
}

const QUEUE: ErrorReport[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Get the current user ID from localStorage (if authenticated). */
function getUserId(): string | undefined {
  try {
    const token = localStorage.getItem("athena.token");
    if (!token) return undefined;
    // Decode JWT payload without verification (server will re-derive user).
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub;
  } catch {
    return undefined;
  }
}

/** Send queued errors to the server. Best-effort — never throws. */
async function flushErrors() {
  if (QUEUE.length === 0) return;
  const batch = QUEUE.splice(0, QUEUE.length);
  try {
    const token = localStorage.getItem("athena.token");
    await fetch("/api/client-errors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ errors: batch }),
      keepalive: true, // allow sending even during page unload
    });
  } catch {
    // Network failure — re-queue the errors for the next flush.
    QUEUE.unshift(...batch);
  }
}

/** Queue an error report and schedule a flush (debounced 2s). */
export function reportError(report: Omit<ErrorReport, "url" | "userAgent" | "timestamp" | "userId">) {
  const full: ErrorReport = {
    ...report,
    url: location.href,
    userAgent: navigator.userAgent,
    userId: getUserId(),
    timestamp: new Date().toISOString(),
  };
  QUEUE.push(full);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushErrors, 2000);
}

/** Install global listeners for uncaught errors and unhandled rejections. */
export function installGlobalErrorHandlers() {
  window.addEventListener("error", (event) => {
    reportError({
      message: event.message || "Unknown error",
      stack: event.error?.stack,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    // Stale chunk after a deploy — auto-reload to pick up the new index.html.
    // This catches dynamic import failures that escape React's Suspense boundary.
    if (isStaleChunkError(reason)) {
      reloadWithCacheBust();
      event.preventDefault();
      return;
    }
    const msg = reason instanceof Error ? reason.message : String(reason);
    reportError({
      message: msg,
      stack: reason instanceof Error ? reason.stack : undefined,
      source: "unhandledrejection",
    });
  });

  // Flush on page unload (best-effort via keepalive).
  window.addEventListener("beforeunload", flushErrors);
}
