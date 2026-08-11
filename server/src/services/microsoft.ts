/**
 * Microsoft Graph Calendar service — per-user token management + Graph API.
 *
 * Each user stores their own Microsoft OAuth2 credentials (client id, secret,
 * tenant id, refresh token) encrypted in the DB. The refresh token may rotate
 * on each exchange, so the latest is persisted back to the DB. Server-wide
 * MS_* env vars serve as an optional fallback.
 *
 * Token endpoint: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 * Graph API base:  https://graph.microsoft.com/v1.0
 *
 * Required scope: Calendar.ReadWrite (offline_access for refresh tokens).
 */

import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import prisma from "../db/client";
import { encryptSecret, decryptSecret } from "./crypto";

const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const AUTHORIZE_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Server-wide fallback (env vars)
const ENV_CLIENT_ID = process.env.MS_CLIENT_ID ?? "";
const ENV_CLIENT_SECRET = process.env.MS_CLIENT_SECRET ?? "";
const ENV_TENANT_ID = process.env.MS_TENANT_ID ?? "common";
const ENV_REFRESH_TOKEN = process.env.MS_REFRESH_TOKEN ?? "";

// Redirect URI registered in the Azure app (Authentication → Web → Redirect URI).
// Must match exactly what Microsoft has on file. Defaults to the production URL.
const ENV_REDIRECT_URI =
  process.env.MS_REDIRECT_URI ?? "https://mavino.net/auth/callback";

// Reuse the JWT secret for signing OAuth state tokens (short-lived, separate audience).
const STATE_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-me"
);
const STATE_ISSUER = "athena-student-os";
const STATE_AUDIENCE = "athena-ms-oauth";
const STATE_EXPIRY = "10m";

export interface MsTokens {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

export interface MsApiError {
  status: number;
  message: string;
}

export interface MsGraphEvent {
  id: string;
  subject: string;
  body?: { contentType: string; content: string };
  // Graph returns `dateTime` for timed events and `date` (yyyy-MM-dd) for
  // all-day events. The missing field is null/undefined.
  start: { dateTime: string | null; date: string | null; timeZone: string };
  end: { dateTime: string | null; date: string | null; timeZone: string };
  isAllDay: boolean;
  location?: { displayName: string };
  showAs?: string;
}

export interface MsUserConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  refreshToken: string;
  /** True if using per-user DB credentials (vs env fallback). */
  perUser: boolean;
}

function decryptSafe(enc: string): string {
  try {
    return decryptSecret(enc);
  } catch {
    return "";
  }
}

/** Load a user's Microsoft config: per-user DB → env fallback. */
export async function getUserMsConfig(userId: string): Promise<MsUserConfig | null> {
  const cred = await prisma.microsoftCredential.findUnique({ where: { userId } });
  if (cred) {
    const clientId = decryptSafe(cred.clientIdEnc);
    const clientSecret = decryptSafe(cred.clientSecretEnc);
    const refreshToken = decryptSafe(cred.refreshTokenEnc);
    if (clientId && clientSecret && refreshToken) {
      return {
        clientId,
        clientSecret,
        tenantId: cred.tenantId || "common",
        refreshToken,
        perUser: true,
      };
    }
  }
  // Fallback to server env vars
  if (ENV_CLIENT_ID && ENV_CLIENT_SECRET && ENV_REFRESH_TOKEN) {
    return {
      clientId: ENV_CLIENT_ID,
      clientSecret: ENV_CLIENT_SECRET,
      tenantId: ENV_TENANT_ID,
      refreshToken: ENV_REFRESH_TOKEN,
      perUser: false,
    };
  }
  return null;
}

/** Check if Microsoft Calendar is configured for a given user. */
export async function isMicrosoftConfiguredFor(userId: string): Promise<boolean> {
  const config = await getUserMsConfig(userId);
  return config !== null;
}

// Per-user token cache: userId → { accessToken, expiresAt }
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

/** Exchange the refresh token for a fresh access token. Handles rotation. */
async function refreshAccessToken(userId: string, config: MsUserConfig): Promise<MsTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "offline_access Calendars.ReadWrite",
  });
  const res = await fetch(TOKEN_URL(config.tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[ms] token refresh failed (${res.status}) for user ${userId}:`, text);
    throw { status: res.status, message: `MS token refresh failed: ${text}` } as MsApiError;
  }
  const data = (await res.json()) as MsTokens;
  console.log(`[ms] token refresh OK for user ${userId}: scope="${data.scope}" expires_in=${data.expires_in}`);
  tokenCache.set(userId, {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  // Persist the rotated refresh token if a new one was returned.
  if (data.refresh_token && data.refresh_token !== config.refreshToken && config.perUser) {
    await prisma.microsoftCredential.update({
      where: { userId },
      data: { refreshTokenEnc: encryptSecret(data.refresh_token) },
    });
  }
  return data;
}

/** Get a valid access token for a user, refreshing if the cached one is near expiry. */
export async function getAccessToken(userId: string): Promise<string> {
  const config = await getUserMsConfig(userId);
  if (!config) {
    throw { status: 500, message: "Microsoft not configured for this user" } as MsApiError;
  }
  const margin = 60_000;
  const cached = tokenCache.get(userId);
  if (cached && Date.now() < cached.expiresAt - margin) {
    return cached.accessToken;
  }
  const tokens = await refreshAccessToken(userId, config);
  return tokens.access_token;
}

// ===== Graph API helpers =====

async function graphFetch(userId: string, path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken(userId);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
  });
  return res;
}

/** List events in a time range from the user's default calendar. */
export async function listEvents(
  userId: string,
  startDateTime: string,
  endDateTime: string
): Promise<MsGraphEvent[]> {
  // Decode the JWT access token to diagnose the 401 on calendar endpoints.
  const token = await getAccessToken(userId);
  let tokenIssuer = "";
  try {
    const payloadB64 = token.split(".")[1];
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    );
    tokenIssuer = payload.iss ?? "";
    console.log(`[ms] access token decoded for user ${userId}: aud="${payload.aud}" iss="${payload.iss}" idtyp="${payload.idtyp ?? "(none)"}"`);
  } catch (e) {
    console.error(`[ms] could not decode access token JWT for user ${userId}`);
  }

  // If the token was issued by a tenant-specific endpoint (sts.windows.net/<tenant>/)
  // instead of the consumer endpoint (login.live.com), the user signed in with a
  // personal Microsoft account through the "common" tenant. Personal accounts
  // authenticated via "common" get a tenant-specific token that can access /me
  // but NOT calendar endpoints (401 empty body). They must use the "consumers"
  // tenant to get a token for the personal Outlook.com calendar store.
  if (tokenIssuer.includes("sts.windows.net") && tokenIssuer !== "https://sts.windows.net/9188040d-6c67-4c5b-b112-36a304b66dad/") {
    // 9188040d-... is the consumer tenant — if issuer is that, it's already correct.
    // Any other sts.windows.net tenant with a personal account = wrong endpoint.
    throw {
      status: 401,
      message: "Personal Microsoft account authenticated via the 'common' tenant, which cannot access calendar data. Please disconnect and sign in again with the Tenant ID set to 'consumers' (not 'common').",
    } as MsApiError;
  }

  // Standard v1.0 /me/events with $filter
  const startNorm = startDateTime.replace(/\.\d{3}Z$/, "Z");
  const endNorm = endDateTime.replace(/\.\d{3}Z$/, "Z");
  const filter = `start/dateTime ge '${startNorm}' and end/dateTime le '${endNorm}'`;
  const params = new URLSearchParams({
    $filter: filter,
    $select: "id,subject,body,start,end,isAllDay,location,showAs",
    $top: "250",
    $orderby: "start/dateTime",
  });
  const res = await graphFetch(userId, `/me/events?${params}`);
  if (!res.ok) {
    const text = await res.text();
    console.error(`[ms] listEvents failed (${res.status}) for user ${userId}: body="${text}"`);
    throw { status: res.status, message: `MS listEvents failed: ${text}` } as MsApiError;
  }
  const data = (await res.json()) as { value: MsGraphEvent[] };
  return data.value ?? [];
}

/** Create an event in the user's default calendar. */
export async function createEvent(
  userId: string,
  event: {
    subject: string;
    body?: string;
    start: string; // ISO
    end: string; // ISO
    isAllDay?: boolean;
    location?: string;
  }
): Promise<MsGraphEvent> {
  const body = {
    subject: event.subject,
    body: event.body ? { contentType: "Text", content: event.body } : undefined,
    start: { dateTime: event.start, timeZone: "UTC" },
    end: { dateTime: event.end, timeZone: "UTC" },
    isAllDay: event.isAllDay ?? false,
    location: event.location ? { displayName: event.location } : undefined,
  };
  const res = await graphFetch(userId, "/me/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw { status: res.status, message: `MS createEvent failed: ${text}` } as MsApiError;
  }
  return (await res.json()) as MsGraphEvent;
}

/** Update an event in the user's default calendar. */
export async function updateEvent(
  userId: string,
  id: string,
  event: {
    subject?: string;
    body?: string;
    start?: string;
    end?: string;
    isAllDay?: boolean;
    location?: string;
  }
): Promise<MsGraphEvent> {
  const body: Record<string, unknown> = {};
  if (event.subject !== undefined) body.subject = event.subject;
  if (event.body !== undefined) body.body = { contentType: "Text", content: event.body };
  if (event.start !== undefined) body.start = { dateTime: event.start, timeZone: "UTC" };
  if (event.end !== undefined) body.end = { dateTime: event.end, timeZone: "UTC" };
  if (event.isAllDay !== undefined) body.isAllDay = event.isAllDay;
  if (event.location !== undefined) body.location = { displayName: event.location };
  const res = await graphFetch(userId, `/me/events/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw { status: res.status, message: `MS updateEvent failed: ${text}` } as MsApiError;
  }
  return (await res.json()) as MsGraphEvent;
}

/** Delete an event from the user's default calendar. */
export async function deleteEvent(userId: string, id: string): Promise<void> {
  const res = await graphFetch(userId, `/me/events/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw { status: res.status, message: `MS deleteEvent failed: ${text}` } as MsApiError;
  }
}

// ===== OAuth2 authorization-code flow =====
//
// The flow:
//   1. User enters clientId/clientSecret/tenantId in Settings → Integrations
//   2. POST /api/microsoft/oauth/start stores them (with an empty refresh token)
//      and returns the Microsoft authorize URL (with a signed state JWT)
//   3. User consents on Microsoft → browser redirects to GET /auth/callback
//   4. The callback handler verifies the state, exchanges the code for tokens,
//      and persists the refresh token (encrypted) against the user

/** Build the Microsoft OAuth2 authorize URL. */
export function buildAuthorizeUrl(
  clientId: string,
  tenantId: string,
  state: string,
  redirectUri: string = ENV_REDIRECT_URI
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "offline_access Calendars.ReadWrite",
    state,
    prompt: "select_account",
  });
  return `${AUTHORIZE_URL(tenantId || "common")}?${params}`;
}

/** Sign a short-lived OAuth state JWT binding the flow to the given user. */
export async function generateOAuthState(userId: string): Promise<string> {
  return new SignJWT({ nonce: randomBytes(16).toString("hex") })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(STATE_ISSUER)
    .setAudience(STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(STATE_EXPIRY)
    .sign(STATE_SECRET);
}

/** Verify an OAuth state JWT. Returns the userId on success, null on failure. */
export async function verifyOAuthState(state: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, STATE_SECRET, {
      issuer: STATE_ISSUER,
      audience: STATE_AUDIENCE,
    });
    if (typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/**
 * Store partial Microsoft credentials (clientId/clientSecret/tenantId) with an
 * empty refresh token. Used during the OAuth start step — the real refresh
 * token is filled in by the callback handler after the code exchange.
 */
export async function storePartialCredentials(
  userId: string,
  clientId: string,
  clientSecret: string,
  tenantId: string
): Promise<void> {
  const tenant = tenantId.trim() || "common";
  await prisma.microsoftCredential.upsert({
    where: { userId },
    create: {
      userId,
      clientIdEnc: encryptSecret(clientId.trim()),
      clientSecretEnc: encryptSecret(clientSecret.trim()),
      tenantId: tenant,
      refreshTokenEnc: encryptSecret(""),
    },
    update: {
      clientIdEnc: encryptSecret(clientId.trim()),
      clientSecretEnc: encryptSecret(clientSecret.trim()),
      tenantId: tenant,
    },
  });
}

/**
 * Exchange a Microsoft OAuth2 authorization code for access + refresh tokens,
 * then persist the refresh token (encrypted) against the user. The client
 * credentials are loaded from the DB (stored during the start step).
 * Returns true on success, false on failure.
 */
export async function exchangeAuthCode(
  userId: string,
  code: string,
  redirectUri: string = ENV_REDIRECT_URI
): Promise<boolean> {
  const cred = await prisma.microsoftCredential.findUnique({ where: { userId } });
  if (!cred) return false;
  const clientId = decryptSafe(cred.clientIdEnc);
  const clientSecret = decryptSafe(cred.clientSecretEnc);
  if (!clientId || !clientSecret) return false;
  const tenantId = cred.tenantId || "common";

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    scope: "offline_access Calendars.ReadWrite",
  });
  const res = await fetch(TOKEN_URL(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[ms] auth code exchange failed (${res.status}) for user ${userId}:`, text);
    return false;
  }
  const data = (await res.json()) as MsTokens;
  if (!data.refresh_token) {
    console.error(`[ms] auth code exchange for user ${userId}: no refresh_token in response`);
    return false;
  }

  await prisma.microsoftCredential.update({
    where: { userId },
    data: { refreshTokenEnc: encryptSecret(data.refresh_token) },
  });
  console.log(`[ms] auth code exchange succeeded for user ${userId}, refresh token stored`);
  return true;
}

/** The configured redirect URI (for the start endpoint to send to Microsoft). */
export function getRedirectUri(): string {
  return ENV_REDIRECT_URI;
}
