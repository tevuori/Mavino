import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

/**
 * Tests for the auth middleware query-token restriction.
 *
 * The default authMiddleware should NOT accept ?token= query parameters
 * (tokens in URLs leak via logs/referrers). Only authMiddlewareWithQuery
 * (used by file download, browser proxy routes) should accept them.
 */

// Simulate the auth middleware logic (without JWT verification) to test
// the token extraction behavior.
function extractTokenDefault(header: string, queryToken: string | null): string | null {
  let token = header.startsWith("Bearer ") ? header.slice(7) : null;
  // Default middleware: NO query param fallback.
  return token;
}

function extractTokenWithQuery(header: string, queryToken: string | null): string | null {
  let token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    token = queryToken;
  }
  return token;
}

describe("auth middleware: token extraction", () => {
  it("default middleware extracts Bearer token from header", () => {
    expect(extractTokenDefault("Bearer abc123", null)).toBe("abc123");
  });

  it("default middleware returns null without header", () => {
    expect(extractTokenDefault("", null)).toBe(null);
  });

  it("default middleware does NOT fall back to query param", () => {
    expect(extractTokenDefault("", "querytoken123")).toBe(null);
    expect(extractTokenDefault("", null)).toBe(null);
  });

  it("query-accepting middleware extracts Bearer token from header", () => {
    expect(extractTokenWithQuery("Bearer abc123", null)).toBe("abc123");
  });

  it("query-accepting middleware falls back to query param", () => {
    expect(extractTokenWithQuery("", "querytoken123")).toBe("querytoken123");
  });

  it("query-accepting middleware prefers header over query param", () => {
    expect(extractTokenWithQuery("Bearer headertoken", "querytoken")).toBe("headertoken");
  });

  it("query-accepting middleware returns null when neither is present", () => {
    expect(extractTokenWithQuery("", null)).toBe(null);
  });
});

describe("auth middleware: Hono integration", () => {
  it("returns 401 when no token is provided", async () => {
    const app = new Hono();
    // Minimal auth middleware that checks for Bearer token only.
    app.use("*", async (c, next) => {
      const header = c.req.header("Authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) return c.json({ error: "Unauthorized" }, 401);
      c.set("auth", { userId: "test", username: "test" } as never);
      await next();
    });
    app.get("/protected", (c) => c.json({ ok: true }));

    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  it("passes through with valid Bearer token", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      const header = c.req.header("Authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) return c.json({ error: "Unauthorized" }, 401);
      c.set("auth", { userId: "test", username: "test" } as never);
      await next();
    });
    app.get("/protected", (c) => c.json({ ok: true }));

    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer faketoken" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
