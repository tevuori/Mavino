import type { Context, Next } from "hono";
import { verifyToken } from "../services/jwt";
import { runWithRls } from "../db/rls";

export interface AuthVars {
  userId: string;
  username: string;
  /** Set by role-aware middleware (admin/adminOrManager). */
  role?: string;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthVars;
  }
}

/** Extracts a Bearer token from the Authorization header, verifies the JWT,
 *  and attaches `c.set("auth", {...})`. Does NOT accept ?token= query params
 *  (tokens in URLs leak via logs/referrers). Use `authMiddlewareWithQuery`
 *  only for routes that genuinely can't set headers (img/iframe src). */
export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("auth", { userId: payload.sub, username: payload.username });
  // Wrap the entire downstream chain in an RLS context so that all Prisma
  // queries are automatically scoped to this user by PostgreSQL RLS.
  return runWithRls(payload.sub, false, () => next());
}

/** Like authMiddleware, but also accepts a ?token= query parameter as a
 *  fallback. Use ONLY for routes loaded via <img>/<iframe> src attributes
 *  that cannot set Authorization headers (file download, browser proxy).
 *  Tokens in URLs may be logged by proxies — restrict to these specific GET
 *  routes only. */
export async function authMiddlewareWithQuery(c: Context, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  let token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    token = c.req.query("token") ?? null;
  }
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("auth", { userId: payload.sub, username: payload.username });
  return runWithRls(payload.sub, false, () => next());
}

/** Optional auth: attaches auth if a valid token is present, but never blocks. */
export async function optionalAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      c.set("auth", { userId: payload.sub, username: payload.username });
      return runWithRls(payload.sub, false, () => next());
    }
  }
  await next();
}
