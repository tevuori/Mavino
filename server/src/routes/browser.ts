import { Hono } from "hono";
import { authMiddlewareWithQuery } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";
import {
  proxyPage,
  fetchPageText,
  clearBrowserSession,
  isEmbeddable,
} from "../services/browser";

const browser = new Hono();
// Browser proxy routes are loaded via <iframe> src that can't set Authorization headers.
// Browser is a Paid-tier app — gate all routes.
browser.use("*", authMiddlewareWithQuery, appTierGate("browser"));

/**
 * GET /api/browser/proxy?url=...
 * Returns a proxied HTML page rewritten for iframe embedding, or passes through
 * non-HTML responses (JSON API calls, etc.) untouched so SPA runtime requests
 * work. Sets X-Final-Url so callers that can read headers know the post-redirect URL.
 */
browser.get("/proxy", async (c) => {
  const { userId } = c.get("auth");
  const url = c.req.query("url");
  if (!url) return c.text("Missing url parameter", 400);
  // Pass the token through to the proxy so the injected interception script
  // can build authenticated proxy URLs for runtime fetch/XHR calls.
  const token = c.req.query("token") ?? undefined;
  try {
    const page = await proxyPage(userId, url, token);
    c.header("X-Final-Url", page.finalUrl);
    if (page.kind === "raw") {
      c.header("Content-Type", page.contentType);
      // Pass through the original HTTP status for non-HTML responses (e.g.
      // 404 for a missing JS file, 500 for a failed API call) so the
      // browser/SPA JS can handle errors gracefully instead of seeing a 502.
      if (page.status) c.status(page.status as 200);
      return c.body(new Uint8Array(page.buffer));
    }
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.body(page.html);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Proxy error";
    return c.text(`Browser proxy error: ${msg}`, 502);
  }
});

/**
 * GET /api/browser/content?url=...&selector=...
 * Returns extracted main text of a page (used by Athena's get_browser_content).
 * Optional selector extracts text from specific DOM elements only.
 */
browser.get("/content", async (c) => {
  const { userId } = c.get("auth");
  const url = c.req.query("url");
  if (!url) return c.json({ error: "Missing url parameter" }, 400);
  const selector = c.req.query("selector") || undefined;
  try {
    const page = await fetchPageText(userId, url, 20_000, selector);
    return c.json(page);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fetch error";
    return c.json({ error: msg }, 502);
  }
});

/**
 * GET /api/browser/embeddable?url=...
 * Checks if a URL is known to be embeddable in an iframe (not in the
 * non-embeddable blocklist). The BrowserApp calls this before attempting to
 * load a page — if false, it opens the URL in the external browser instead.
 */
browser.get("/embeddable", (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "Missing url parameter" }, 400);
  return c.json({ embeddable: isEmbeddable(url) });
});

/** DELETE /api/browser/cookies — clear the user's browser cookie jar (log out). */
browser.delete("/cookies", (c) => {
  const { userId } = c.get("auth");
  clearBrowserSession(userId);
  return c.json({ ok: true });
});

export default browser;
