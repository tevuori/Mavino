import type { Context, Next } from "hono";
import prisma from "../db/client";
import { authMiddleware } from "./auth";
import { setRlsAdmin } from "../db/rls";

/** Loads the user and 403s if not an admin. */
export async function adminMiddleware(c: Context, next: Next) {
  const { userId } = c.get("auth");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") {
    return c.json({ error: "Admin access required" }, 403);
  }
  c.set("auth", { ...c.get("auth"), role: user.role });
  // Elevate the RLS context so admin queries can see all users' data.
  setRlsAdmin(true);
  await next();
}

/** Loads the user and 403s if not an admin or manager. */
export async function adminOrManagerMiddleware(c: Context, next: Next) {
  const { userId } = c.get("auth");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || (user.role !== "ADMIN" && user.role !== "MANAGER")) {
    return c.json({ error: "Admin or manager access required" }, 403);
  }
  c.set("auth", { ...c.get("auth"), role: user.role });
  // Elevate the RLS context so admin/manager queries can see all users' data.
  setRlsAdmin(true);
  await next();
}

/** Convenience: chain auth + admin for a route group. */
export const adminGuard = [authMiddleware, adminMiddleware] as const;

/** Convenience: chain auth + admin-or-manager for a route group. */
export const adminOrManagerGuard = [authMiddleware, adminOrManagerMiddleware] as const;
