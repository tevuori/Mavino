/**
 * Stale-chunk detection and recovery.
 *
 * After a deploy, the browser or service worker may serve a cached
 * `index.html` that references old content-hashed JS chunks (e.g.
 * `SettingsApp-g9n-wqbS.js`) that no longer exist on the server. When
 * the app tries to dynamically import one of these deleted chunks, the
 * browser throws a "Failed to fetch dynamically imported module" error.
 *
 * The fix is to reload the page with a cache-busting query param so the
 * browser fetches a fresh `index.html` with the new chunk hashes.
 *
 * This is used in three places (defence in depth):
 *  1. `lazyImport()` in apps/registry.tsx — catches the error at the
 *     React.lazy() promise level (ideal — React stays in Suspense).
 *  2. `installGlobalErrorHandlers()` in services/errorReporter.ts —
 *     catches the error as an unhandledrejection if it escapes the
 *     promise catch.
 *  3. `GlobalErrorBoundary` — catches the error if it reaches React's
 *     render phase (last resort before the user sees "Something went
 *     wrong").
 */

/** Error messages that indicate a stale chunk after a deploy. */
const STALE_CHUNK_PATTERNS = [
  // Chrome / Edge
  "Failed to fetch dynamically imported module",
  // Firefox
  "error loading dynamically imported module",
  // Safari
  "Importing a module script failed",
];

/** True if the error message looks like a stale-chunk import failure. */
export function isStaleChunkError(error: Error | unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return STALE_CHUNK_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Reload the page with a `?_reload=<timestamp>` cache-busting query param
 * so the browser fetches a fresh `index.html`. No-op if the URL already
 * has `_reload=` (prevents an infinite reload loop if the fresh HTML
 * still references missing chunks — e.g. a broken deploy).
 */
export function reloadWithCacheBust(): void {
  if (location.search.includes("_reload=")) return;
  location.replace(`${location.pathname}?_reload=${Date.now()}${location.hash}`);
}
