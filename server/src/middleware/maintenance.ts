import type { Context, Next } from "hono";
import prisma from "../db/client";
import { verifyToken } from "../services/jwt";
import { getMaintenanceStatus } from "../services/maintenance";

const EXEMPT_AUTH_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/login/totp",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/turnstile-config",
  "/api/auth/registration-status",
]);

export function isMaintenanceExempt(path: string, method: string): boolean {
  if (method === "OPTIONS" || !path.startsWith("/api/")) return true;
  return EXEMPT_AUTH_PATHS.has(path) || path.startsWith("/api/maintenance/");
}

function requestToken(c: Context): string | null {
  const header = c.req.header("Authorization") ?? "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  const path = new URL(c.req.url).pathname;
  if (c.req.method === "GET" && (path.startsWith("/api/files/") || path === "/api/browser/proxy")) {
    return c.req.query("token") ?? null;
  }
  return null;
}

export async function maintenanceMiddleware(c: Context, next: Next) {
  const path = new URL(c.req.url).pathname;
  if (isMaintenanceExempt(path, c.req.method)) return next();

  const status = await getMaintenanceStatus();
  if (!status.active) return next();

  const token = requestToken(c);
  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { role: true },
      });
      if (user?.role === "ADMIN") return next();
    }
  }

  if (status.retryAfterSeconds !== null) {
    c.header("Retry-After", String(status.retryAfterSeconds));
  }
  return c.json(
    {
      error: "Mavino is currently undergoing maintenance.",
      code: "MAINTENANCE_MODE",
      maintenance: status,
    },
    503
  );
}
