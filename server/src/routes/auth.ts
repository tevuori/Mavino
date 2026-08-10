import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import prisma from "../db/client";
import { signToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from "../services/jwt";
import { authMiddleware } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import {
  generateTotpSecret,
  encryptTotpSecret,
  buildTotpUri,
  verifyTotp,
  verifyTotpPlain,
} from "../services/totp";
import { sendPasswordResetEmail } from "../services/email";
import { getDemoConfig, isDemoReady, createDemoUser } from "../services/demo";

const auth = new Hono();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().optional().default(false),
  deviceFingerprint: z.string().max(256).optional().default(""),
  deviceLabel: z.string().max(256).optional().default(""),
});

const registerSchema = z.object({
  username: z.string().min(2).max(32),
  password: z.string().min(4).max(128),
  displayName: z.string().max(64).optional().default(""),
});

function publicUser(u: {
  id: string;
  username: string;
  email?: string;
  displayName: string;
  avatarColor: string;
  role: string;
  passwordMustChange?: boolean;
}) {
  return {
    id: u.id,
    username: u.username,
    email: u.email ?? "",
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    role: u.role,
    passwordMustChange: u.passwordMustChange ?? false,
  };
}

/** Derive a short human-readable device label from the User-Agent header. */
function deviceLabelFromUA(ua: string): string {
  if (!ua) return "Unknown device";
  let os = "Unknown OS";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  let browser = "Browser";
  if (/Edg/i.test(ua)) browser = "Edge";
  else if (/Chrome/i.test(ua)) browser = "Chrome";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/Safari/i.test(ua)) browser = "Safari";
  return `${browser} on ${os}`;
}

// 5 login attempts per 15s per IP — brute-force protection for the public site.
const loginLimiter = rateLimit({ max: 5, windowMs: 15_000 });

/** POST /auth/login */
auth.post("/login", loginLimiter, zValidator("json", loginSchema), async (c) => {
  const { username, password, rememberMe, deviceFingerprint, deviceLabel } = c.req.valid("json");
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return c.json({ error: "Invalid username or password" }, 401);
  }

  // If 2FA is enabled, don't issue tokens yet — require a TOTP code.
  if (user.totpEnabled && user.totpSecret) {
    // Issue a short-lived challenge token (10 min) so the TOTP endpoint can
    // identify the user without re-sending the password.
    const challengeToken = await signToken(
      { sub: user.id, username: user.username, totpChallenge: true },
      "10m"
    );
    return c.json({ totpRequired: true, challengeToken, user: publicUser(user) });
  }

  const token = await signToken({ sub: user.id, username: user.username });
  let refreshToken: string | null = null;
  if (rememberMe && deviceFingerprint) {
    const label = deviceLabel || deviceLabelFromUA(c.req.header("user-agent") ?? "");
    refreshToken = await issueRefreshToken({
      userId: user.id,
      deviceFingerprint,
      deviceLabel: label,
    });
  }
  return c.json({ token, refreshToken, user: publicUser(user) });
});

const loginTotpSchema = z.object({
  challengeToken: z.string().min(1),
  totpCode: z.string().min(6).max(6),
  rememberMe: z.boolean().optional().default(false),
  deviceFingerprint: z.string().max(256).optional().default(""),
  deviceLabel: z.string().max(256).optional().default(""),
});

/** POST /auth/login/totp — complete login with a TOTP code after password verification. */
auth.post(
  "/login/totp",
  loginLimiter,
  zValidator("json", loginTotpSchema),
  async (c) => {
    const { challengeToken, totpCode, rememberMe, deviceFingerprint, deviceLabel } =
      c.req.valid("json");

    // Verify the challenge token to get the user ID.
    const { verifyToken } = await import("../services/jwt");
    const payload = await verifyToken(challengeToken);
    if (!payload || !payload.totpChallenge) {
      return c.json({ error: "Invalid or expired challenge" }, 401);
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.totpEnabled || !user.totpSecret) {
      return c.json({ error: "2FA is not enabled for this account" }, 400);
    }

    if (!verifyTotp(user.totpSecret, totpCode)) {
      return c.json({ error: "Invalid verification code" }, 401);
    }

    const token = await signToken({ sub: user.id, username: user.username });
    let refreshToken: string | null = null;
    if (rememberMe && deviceFingerprint) {
      const label = deviceLabel || deviceLabelFromUA(c.req.header("user-agent") ?? "");
      refreshToken = await issueRefreshToken({
        userId: user.id,
        deviceFingerprint,
        deviceLabel: label,
      });
    }
    return c.json({ token, refreshToken, user: publicUser(user) });
  }
);

/**
 * GET /auth/registration-status — public endpoint.
 * Returns whether self-registration is open (for the login screen to show/hide
 * the "Create account" form). Bootstrap mode (zero users) always returns true.
 */
auth.get("/registration-status", async (c) => {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    // Bootstrap mode — first admin can always register.
    return c.json({ enabled: true, bootstrap: true });
  }
  // Check the global registration.enabled setting (userId = null for global).
  // Use findFirst because Prisma's SQLite compound unique doesn't support null
  // in findUnique where clauses.
  const setting = await prisma.setting.findFirst({
    where: { userId: null, key: "registration.enabled" },
  });
  const enabled = setting?.value === "true";
  return c.json({ enabled, bootstrap: false });
});

/**
 * GET /auth/demo-status — public endpoint.
 * Returns whether the demo flow is enabled and ready (has a demo LLM key).
 */
auth.get("/demo-status", async (c) => {
  const [ready, config] = await Promise.all([isDemoReady(), getDemoConfig()]);
  return c.json({
    enabled: config.enabled,
    configured: ready,
    hasKey: config.hasKey,
  });
});

const demoSchema = z.object({
  deviceFingerprint: z.string().max(256).optional().default(""),
  deviceLabel: z.string().max(256).optional().default(""),
});

// 5 demo sessions per minute per IP — demo creation is expensive and public.
const demoLimiter = rateLimit({ max: 5, windowMs: 60_000 });

/**
 * POST /auth/demo — create a fresh demo user, seed data, and log in.
 */
auth.post("/demo", demoLimiter, zValidator("json", demoSchema), async (c) => {
  const ready = await isDemoReady();
  if (!ready) {
    return c.json({ error: "Demo is not available." }, 403);
  }
  const { deviceFingerprint, deviceLabel } = c.req.valid("json");
  const ua = c.req.header("user-agent") ?? "";
  const label = deviceLabel || (ua ? `Demo on ${ua.split(" ")[0]?.replace(/[^a-zA-Z0-9]/g, "-") ?? "Browser"}` : "Demo browser");
  try {
    const result = await createDemoUser({
      deviceFingerprint,
      deviceLabel: label.slice(0, 50),
    });
    const user = await prisma.user.findUnique({ where: { id: result.userId } });
    if (!user) {
      return c.json({ error: "Demo user creation failed" }, 500);
    }
    return c.json({
      token: result.token,
      refreshToken: result.refreshToken,
      user: publicUser(user),
    });
  } catch (e) {
    console.error("[auth/demo] error:", e);
    return c.json({ error: "Failed to create demo session. Try again later." }, 500);
  }
});

/**
 * POST /auth/register — self-registration.
 * Allowed in two cases:
 *   1. Bootstrap mode (zero users exist) → creates the first ADMIN.
 *   2. Open registration (admin enabled the setting) → creates a USER.
 * Otherwise returns 403.
 */
auth.post("/register", rateLimit({ max: 5, windowMs: 60_000 }), zValidator("json", registerSchema), async (c) => {
  const userCount = await prisma.user.count();
  const isBootstrap = userCount === 0;

  // If not bootstrap, check if open registration is enabled.
  if (!isBootstrap) {
    const setting = await prisma.setting.findFirst({
      where: { userId: null, key: "registration.enabled" },
    });
    if (setting?.value !== "true") {
      return c.json({ error: "Registration is closed. Ask an administrator for an account." }, 403);
    }
  }

  const { username, password, displayName } = c.req.valid("json");
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return c.json({ error: "Username already taken" }, 409);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  // Bootstrap user is ADMIN; open-registration users are FREE.
  const role = isBootstrap ? "ADMIN" : "FREE";
  const user = await prisma.user.create({
    data: { username, passwordHash, displayName, role },
  });
  const token = await signToken({ sub: user.id, username: user.username });
  return c.json({ token, refreshToken: null, user: publicUser(user) });
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  deviceFingerprint: z.string().min(1).max(256),
});

/** POST /auth/refresh — exchange a refresh token for a new access JWT (rotates the refresh token). */
auth.post("/refresh", zValidator("json", refreshSchema), async (c) => {
  const { refreshToken, deviceFingerprint } = c.req.valid("json");
  const result = await rotateRefreshToken({ token: refreshToken, deviceFingerprint });
  if (!result) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }
  const user = await prisma.user.findUnique({ where: { id: result.userId } });
  if (!user) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }
  const token = await signToken({ sub: user.id, username: user.username });
  return c.json({ token, refreshToken: result.token, user: publicUser(user) });
});

const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

/** POST /auth/logout — revoke the provided refresh token (device). */
auth.post("/logout", zValidator("json", logoutSchema), async (c) => {
  const { refreshToken } = c.req.valid("json");
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  return c.json({ ok: true });
});

/** GET /auth/me */
auth.get("/me", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return c.json({ error: "Not found" }, 404);
  return c.json(publicUser(user));
});

// ---------- Devices (active sessions) ----------

/** GET /auth/devices — list the current user's remembered devices. */
auth.get("/devices", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  const rows = await prisma.refreshToken.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: {
      id: true,
      deviceLabel: true,
      deviceFingerprint: true,
      lastUsedAt: true,
      createdAt: true,
      expiresAt: true,
    },
  });
  return c.json(
    rows.map((r) => ({
      id: r.id,
      deviceLabel: r.deviceLabel,
      lastUsedAt: r.lastUsedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }))
  );
});

/** DELETE /auth/devices/:id — revoke a remembered device (ends that session). */
auth.delete("/devices/:id", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  const targetId = c.req.param("id");
  const row = await prisma.refreshToken.findUnique({ where: { id: targetId } });
  if (!row || row.userId !== userId) {
    return c.json({ error: "Device not found" }, 404);
  }
  await prisma.refreshToken.delete({ where: { id: targetId } });
  return c.json({ ok: true });
});

/** DELETE /auth/devices — revoke all of the current user's devices (force re-login everywhere). */
auth.delete("/devices", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  await prisma.refreshToken.deleteMany({ where: { userId } });
  return c.json({ ok: true });
});

// ---------- Profile + password (self-service) ----------

const profileSchema = z.object({
  displayName: z.string().max(64).optional(),
  avatarColor: z.string().max(32).optional(),
  email: z.string().max(256).optional(),
});

/** PATCH /auth/profile — update own display name / avatar color / email. */
auth.patch("/profile", authMiddleware, zValidator("json", profileSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const data: Record<string, string> = {};
  if (body.displayName !== undefined) data.displayName = body.displayName;
  if (body.avatarColor !== undefined) data.avatarColor = body.avatarColor;
  if (body.email !== undefined) data.email = body.email.trim();
  const user = await prisma.user.update({
    where: { id: userId },
    data,
  });
  return c.json(publicUser(user));
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4).max(128),
});

/** POST /auth/password — change own password (verifies current). */
auth.post("/password", authMiddleware, zValidator("json", passwordSchema), async (c) => {
  const { userId } = c.get("auth");
  const { currentPassword, newPassword } = c.req.valid("json");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return c.json({ error: "Not found" }, 404);
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 10), passwordMustChange: false },
  });
  // Revoke all refresh tokens — force re-login on other devices after a password change.
  await prisma.refreshToken.deleteMany({ where: { userId } });
  return c.json({ ok: true });
});

// ---------- 2FA (TOTP) ----------

/** GET /auth/2fa/setup — generate a new TOTP secret + QR URI (not yet enabled). */
auth.get("/2fa/setup", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return c.json({ error: "Not found" }, 404);
  if (user.totpEnabled) {
    return c.json({ error: "2FA is already enabled. Disable it first to reconfigure." }, 400);
  }
  const secret = generateTotpSecret();
  const label = user.displayName || user.username;
  const uri = buildTotpUri({ secret, label });
  // Temporarily store the encrypted secret in the DB (not enabled yet).
  // The user must verify a code to enable it. If they abandon setup, the
  // unverified secret is harmless (tottpEnabled stays false).
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: encryptTotpSecret(secret) },
  });
  return c.json({ secret, uri });
});

const verify2faSchema = z.object({
  code: z.string().min(6).max(6),
});

/** POST /auth/2fa/verify — verify a TOTP code to enable 2FA. */
auth.post("/2fa/verify", authMiddleware, zValidator("json", verify2faSchema), async (c) => {
  const { userId } = c.get("auth");
  const { code } = c.req.valid("json");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return c.json({ error: "Not found" }, 404);
  if (!user.totpSecret) {
    return c.json({ error: "No 2FA setup in progress. Call /auth/2fa/setup first." }, 400);
  }
  if (user.totpEnabled) {
    return c.json({ error: "2FA is already enabled." }, 400);
  }
  // Verify against the plaintext secret (decrypt then check).
  const { decryptTotpSecret } = await import("../services/totp");
  const plainSecret = decryptTotpSecret(user.totpSecret);
  if (!verifyTotpPlain(plainSecret, code)) {
    return c.json({ error: "Invalid verification code" }, 401);
  }
  // Enable 2FA.
  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: true },
  });
  return c.json({ ok: true });
});

const disable2faSchema = z.object({
  password: z.string().min(1),
  code: z.string().min(6).max(6).optional(),
});

/** POST /auth/2fa/disable — disable 2FA (requires password + current TOTP code). */
auth.post("/2fa/disable", authMiddleware, zValidator("json", disable2faSchema), async (c) => {
  const { userId } = c.get("auth");
  const { password, code } = c.req.valid("json");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return c.json({ error: "Not found" }, 404);
  if (!user.totpEnabled) {
    return c.json({ error: "2FA is not enabled." }, 400);
  }
  // Require password confirmation.
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    return c.json({ error: "Password is incorrect" }, 401);
  }
  // Require TOTP code if the user still has access to their authenticator.
  // (If they lost their device, an admin can clear totpEnabled in the DB.)
  if (code !== undefined) {
    if (!verifyTotp(user.totpSecret, code)) {
      return c.json({ error: "Invalid verification code" }, 401);
    }
  }
  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: false, totpSecret: "" },
  });
  return c.json({ ok: true });
});

/** GET /auth/2fa/status — check if 2FA is enabled for the current user. */
auth.get("/2fa/status", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true },
  });
  if (!user) return c.json({ error: "Not found" }, 404);
  return c.json({ enabled: user.totpEnabled });
});

// ---------- Password reset (self-service via email) ----------

// Stricter rate limit for password reset requests — 3 per 15 minutes per IP.
const resetLimiter = rateLimit({ max: 3, windowMs: 15 * 60 * 1000 });

const forgotPasswordSchema = z.object({
  usernameOrEmail: z.string().min(1).max(256),
});

/** POST /auth/forgot-password — request a password reset link. */
auth.post(
  "/forgot-password",
  resetLimiter,
  zValidator("json", forgotPasswordSchema),
  async (c) => {
    const { usernameOrEmail } = c.req.valid("json");
    // Look up user by username or email. Always return 200 to avoid leaking
    // which accounts exist (timing/email enumeration protection).
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: usernameOrEmail },
          { email: usernameOrEmail },
        ],
      },
    });
    if (!user || !user.email) {
      // No user or no email on file — return success without sending.
      return c.json({ ok: true });
    }

    // Generate a random token (48 bytes, base64url) + SHA-256 hash.
    const rawToken = randomBytes(48).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    // Send the email (async, but we await to report errors).
    await sendPasswordResetEmail({
      to: user.email,
      username: user.username,
      resetToken: rawToken,
    });

    return c.json({ ok: true });
  }
);

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(4).max(128),
});

/** POST /auth/reset-password — set a new password using a reset token. */
auth.post(
  "/reset-password",
  resetLimiter,
  zValidator("json", resetPasswordSchema),
  async (c) => {
    const { token, newPassword } = c.req.valid("json");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "Invalid or expired reset token" }, 400);
    }

    // Set the new password and clear the must-change flag.
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash, passwordMustChange: false },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      // Revoke all refresh tokens — force re-login on all devices.
      prisma.refreshToken.deleteMany({ where: { userId: resetRecord.userId } }),
    ]);

    return c.json({ ok: true });
  }
);

// ---------- Data export + account deletion ----------

/** GET /auth/export — download the user's data as a JSON document. */
auth.get("/export", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  const [user, notes, tasks, courses, decks, habits, events, files, folders, studySessions, workspaces] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true, avatarColor: true, role: true, createdAt: true },
      }),
      prisma.note.findMany({ where: { userId }, select: { title: true, content: true, tags: true, pinned: true, createdAt: true, updatedAt: true } }),
      prisma.task.findMany({ where: { userId }, select: { title: true, description: true, status: true, priority: true, dueDate: true, createdAt: true, updatedAt: true } }),
      prisma.course.findMany({ where: { userId }, include: { assignments: { select: { name: true, score: true, maxScore: true, weight: true, category: true } } } }),
      prisma.flashcardDeck.findMany({ where: { userId }, include: { cards: { select: { front: true, back: true } } } }),
      prisma.habit.findMany({ where: { userId }, select: { name: true, icon: true, cadence: true, target: true, logs: { select: { date: true, value: true } } } }),
      prisma.calendarEvent.findMany({ where: { userId }, select: { title: true, description: true, start: true, end: true, allDay: true, location: true, source: true } }),
      prisma.vFile.findMany({ where: { userId }, select: { name: true, mimeType: true, size: true, starred: true, createdAt: true } }),
      prisma.vFolder.findMany({ where: { userId }, select: { name: true, parentId: true, createdAt: true } }),
      prisma.studySession.findMany({ where: { userId }, select: { type: true, title: true, createdAt: true } }),
      prisma.workspace.findMany({ where: { userId }, select: { name: true, layout: true, createdAt: true } }),
    ]);
  if (!user) return c.json({ error: "Not found" }, 404);

  const dump = {
    exportedAt: new Date().toISOString(),
    user,
    notes,
    tasks,
    courses,
    flashcardDecks: decks,
    habits,
    calendarEvents: events,
    files: { folders, files },
    studySessions,
    workspaces,
  };
  // Return as a downloadable JSON attachment.
  const body = JSON.stringify(dump, null, 2);
  c.header("Content-Type", "application/json");
  c.header(
    "Content-Disposition",
    `attachment; filename="athena-export-${user.username}-${Date.now()}.json"`
  );
  return c.body(body);
});

const deleteSchema = z.object({
  password: z.string().min(1),
});

/** DELETE /auth/account — delete own account (requires password confirmation). */
auth.delete("/account", authMiddleware, zValidator("json", deleteSchema), async (c) => {
  const { userId } = c.get("auth");
  const { password } = c.req.valid("json");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return c.json({ error: "Not found" }, 404);
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    return c.json({ error: "Password is incorrect" }, 401);
  }
  // Cascade deletes handle all related user data (notes, tasks, files, refresh tokens, etc.).
  await prisma.user.delete({ where: { id: userId } });
  return c.json({ ok: true });
});

export default auth;
