import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import prisma from "../db/client";

const isProduction = process.env.NODE_ENV === "production";

// Known insecure placeholder values that must never be used in production.
const INSECURE_SECRETS = new Set([
  "dev-secret-change-me",
  "change-me-to-a-long-random-string",
  "athena-dev-secret-not-for-production",
  "athena-dev-secret-change-me",
  "admin",
  "",
]);

const MIN_SECRET_LENGTH = 32;

const rawSecret = process.env.JWT_SECRET ?? "";

if (isProduction && (INSECURE_SECRETS.has(rawSecret) || rawSecret.length < MIN_SECRET_LENGTH)) {
  console.error(
    `[mavino-server] FATAL: JWT_SECRET is not set, is an insecure placeholder, or is shorter ` +
      `than ${MIN_SECRET_LENGTH} characters (got ${rawSecret.length}).\n` +
      "Generate one with:  openssl rand -hex 32\n" +
      "Set it in your .env (or environment) before starting in production."
  );
  process.exit(1);
}

if (!isProduction && INSECURE_SECRETS.has(rawSecret)) {
  console.warn(
    "[mavino-server] WARNING: JWT_SECRET is unset/insecure — using a fixed dev secret. DO NOT use in production."
  );
}

// In production the real secret is used. In dev with no secret set, fall back to a
// fixed dev-only secret so local testing works without configuration.
const secret = new TextEncoder().encode(
  rawSecret && !INSECURE_SECRETS.has(rawSecret) ? rawSecret : "athena-dev-secret-not-for-production"
);

const ISSUER = "athena-student-os";
const AUDIENCE = "athena-user";
const ACCESS_EXPIRY = "15m";
// Refresh tokens live 90 days when "Remember this device" is checked.
const REFRESH_TTL_DAYS = 90;

export interface JwtPayload {
  sub: string; // user id or invite id
  username: string;
  totpChallenge?: boolean;
  invite?: boolean;
}

/**
 * Sign a JWT. Accepts an optional expiry override (e.g. "10m" for short-lived
 * challenge tokens) and extra payload fields.
 */
export async function signToken(payload: JwtPayload, expiresIn?: string): Promise<string> {
  const jwtBuilder = new SignJWT({
    username: payload.username,
    ...(payload.totpChallenge ? { totpChallenge: true } : {}),
    ...(payload.invite ? { invite: true } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn ?? ACCESS_EXPIRY);
  return jwtBuilder.sign(secret);
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.username !== "string") {
      return null;
    }
    return {
      sub: payload.sub,
      username: payload.username as string,
      totpChallenge: payload.totpChallenge === true,
      invite: payload.invite === true,
    };
  } catch {
    return null;
  }
}

// ---------- Refresh tokens (device-remembering) ----------

/** Generate a raw refresh token (48 random bytes, base64url) + its SHA-256 hash. */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString("base64url");
  const tokenHash = hashToken(token);
  return { token, tokenHash };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Issue + persist a refresh token bound to a device fingerprint. */
export async function issueRefreshToken(args: {
  userId: string;
  deviceFingerprint: string;
  deviceLabel: string;
}): Promise<string> {
  const { token, tokenHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      userId: args.userId,
      tokenHash,
      deviceFingerprint: args.deviceFingerprint,
      deviceLabel: args.deviceLabel,
      expiresAt,
    },
  });
  return token;
}

/**
 * Verify a raw refresh token against the stored hash, check expiry + fingerprint.
 * On success, rotates the token (deletes the old row, issues a new one) and
 * returns the new raw token. Returns null on any failure.
 */
export async function rotateRefreshToken(args: {
  token: string;
  deviceFingerprint: string;
}): Promise<{ token: string; userId: string } | null> {
  const tokenHash = hashToken(args.token);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.refreshToken.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  // Fingerprint mismatch → treat as compromised, revoke without rotating.
  if (row.deviceFingerprint !== args.deviceFingerprint) {
    await prisma.refreshToken.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  // Rotate: delete old, issue new bound to same device.
  await prisma.refreshToken.delete({ where: { id: row.id } });
  const newToken = await issueRefreshToken({
    userId: row.userId,
    deviceFingerprint: row.deviceFingerprint,
    deviceLabel: row.deviceLabel,
  });
  await prisma.refreshToken
    .update({
      where: { tokenHash: hashToken(newToken) },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});
  return { token: newToken, userId: row.userId };
}

/** Delete a refresh token row by raw token. No-op if not found. */
export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await prisma.refreshToken.delete({ where: { tokenHash } }).catch(() => {});
}
