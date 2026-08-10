import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware, adminOrManagerMiddleware } from "../middleware/admin";

const users = new Hono();
users.use("*", authMiddleware, adminOrManagerMiddleware);

function publicUser(u: {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  role: string;
  createdAt: Date;
}) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Whether an admin/manager can create a user with the requested role. */
function canCreateRole(actorRole: string, requestedRole: string): boolean {
  if (actorRole === "ADMIN") return true;
  if (actorRole === "MANAGER") return requestedRole !== "ADMIN";
  return false;
}

/** Whether an admin/manager can mutate an existing user.
 *  requestedRole is undefined when the role is not being changed. */
function canManageUser(actorRole: string, targetRole: string, requestedRole?: string): boolean {
  if (actorRole === "ADMIN") return true;
  if (actorRole === "MANAGER") {
    if (targetRole === "ADMIN") return false;
    if (requestedRole === "ADMIN") return false;
    return true;
  }
  return false;
}

/** GET /api/users — list all users (admin or manager). */
users.get("/", async (c) => {
  const list = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarColor: true,
      role: true,
      createdAt: true,
    },
  });
  return c.json(list.map(publicUser));
});

/** GET /api/users/registration — get the open-registration setting (admin only). */
users.get("/registration", adminMiddleware, async (c) => {
  const setting = await prisma.setting.findFirst({
    where: { userId: null, key: "registration.enabled" },
  });
  return c.json({ enabled: setting?.value === "true" });
});

/** PUT /api/users/registration — toggle open self-registration (admin only). */
users.put("/registration", adminMiddleware, zValidator("json", z.object({ enabled: z.boolean() })), async (c) => {
  const { enabled } = c.req.valid("json");
  const value = enabled ? "true" : "false";
  const existing = await prisma.setting.findFirst({
    where: { userId: null, key: "registration.enabled" },
  });
  if (existing) {
    await prisma.setting.update({
      where: { id: existing.id },
      data: { value },
    });
  } else {
    await prisma.setting.create({
      data: { userId: null, key: "registration.enabled", value },
    });
  }
  return c.json({ enabled });
});

const createSchema = z.object({
  username: z.string().min(2).max(32),
  password: z.string().min(4).max(128),
  displayName: z.string().max(64).optional().default(""),
  avatarColor: z.string().max(32).optional(),
  role: z.enum(["FREE", "PAID", "MANAGER", "ADMIN"]).optional().default("FREE"),
});

/** POST /api/users — create a new user (admin or manager). */
users.post("/", zValidator("json", createSchema), async (c) => {
  const body = c.req.valid("json");
  const actorRole = c.get("auth").role ?? "";
  if (!canCreateRole(actorRole, body.role)) {
    return c.json({ error: "You cannot create an admin account." }, 403);
  }
  const existing = await prisma.user.findUnique({ where: { username: body.username } });
  if (existing) return c.json({ error: "Username already taken" }, 409);
  const user = await prisma.user.create({
    data: {
      username: body.username,
      passwordHash: await bcrypt.hash(body.password, 10),
      displayName: body.displayName,
      avatarColor: body.avatarColor ?? "#6366f1",
      role: body.role,
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarColor: true,
      role: true,
      createdAt: true,
    },
  });
  return c.json(publicUser(user), 201);
});

const updateSchema = z.object({
  displayName: z.string().max(64).optional(),
  avatarColor: z.string().max(32).optional(),
  role: z.enum(["FREE", "PAID", "MANAGER", "ADMIN"]).optional(),
});

/** PATCH /api/users/:id — update profile / role (admin or manager). */
users.patch("/:id", zValidator("json", updateSchema), async (c) => {
  const { userId } = c.get("auth");
  const targetId = c.req.param("id");
  const body = c.req.valid("json");
  const actorRole = c.get("auth").role ?? "";

  const existing = await prisma.user.findUnique({ where: { id: targetId } });
  if (!existing) return c.json({ error: "User not found" }, 404);

  // Users cannot change their own role (admins can re-affirm ADMIN, but no-op).
  if (targetId === userId && body.role !== undefined && body.role !== existing.role) {
    return c.json({ error: "You cannot change your own role. Ask another admin." }, 400);
  }

  if (!canManageUser(actorRole, existing.role, body.role)) {
    return c.json({ error: "You cannot edit this account." }, 403);
  }

  const data: Record<string, string> = {};
  if (body.displayName !== undefined) data.displayName = body.displayName;
  if (body.avatarColor !== undefined) data.avatarColor = body.avatarColor;
  if (body.role !== undefined) data.role = body.role;

  const user = await prisma.user.update({
    where: { id: targetId },
    data,
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarColor: true,
      role: true,
      createdAt: true,
    },
  });
  return c.json(publicUser(user));
});

const resetSchema = z.object({
  password: z.string().min(4).max(128),
});

/** POST /api/users/:id/reset-password — set a new password (admin or manager). */
users.post("/:id/reset-password", zValidator("json", resetSchema), async (c) => {
  const targetId = c.req.param("id");
  const { password } = c.req.valid("json");
  const actorRole = c.get("auth").role ?? "";
  const existing = await prisma.user.findUnique({ where: { id: targetId } });
  if (!existing) return c.json({ error: "User not found" }, 404);
  if (!canManageUser(actorRole, existing.role)) {
    return c.json({ error: "You cannot reset this account's password." }, 403);
  }
  await prisma.user.update({
    where: { id: targetId },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });
  return c.json({ ok: true });
});

/** DELETE /api/users/:id — delete a user (admin or manager). Blocks self-delete. */
users.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const targetId = c.req.param("id");
  if (targetId === userId) {
    return c.json({ error: "You cannot delete your own account here. Use Account settings." }, 400);
  }
  const actorRole = c.get("auth").role ?? "";
  const existing = await prisma.user.findUnique({ where: { id: targetId } });
  if (!existing) return c.json({ error: "User not found" }, 404);
  if (!canManageUser(actorRole, existing.role)) {
    return c.json({ error: "You cannot delete this account." }, 403);
  }
  await prisma.user.delete({ where: { id: targetId } });
  return c.json({ ok: true });
});

export default users;
