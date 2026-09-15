import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { encryptSecret } from "../services/crypto";
import { getAccessToken, getUserSpotifyConfig, isSpotifyConfiguredFor, spotifyFetch } from "../services/spotify";

const spotify = new Hono();
spotify.use("*", authMiddleware);

// ---------- Credential management (per-user) ----------

const credSchema = z.object({
  clientId: z.string().min(1).max(256),
  clientSecret: z.string().min(1).max(256),
  refreshToken: z.string().min(1).max(1024),
});

/** GET /spotify/credentials — reports whether per-user Spotify credentials are set. */
spotify.get("/credentials", async (c) => {
  const { userId } = c.get("auth");
  const cred = await prisma.spotifyCredential.findUnique({ where: { userId } });
  return c.json({
    hasCredentials: Boolean(cred),
    configured: await isSpotifyConfiguredFor(userId),
  });
});

/** PUT /spotify/credentials — store (or replace) the user's encrypted Spotify credentials. */
spotify.put("/credentials", zValidator("json", credSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  await prisma.spotifyCredential.upsert({
    where: { userId },
    create: {
      userId,
      clientIdEnc: encryptSecret(body.clientId.trim()),
      clientSecretEnc: encryptSecret(body.clientSecret.trim()),
      refreshTokenEnc: encryptSecret(body.refreshToken.trim()),
    },
    update: {
      clientIdEnc: encryptSecret(body.clientId.trim()),
      clientSecretEnc: encryptSecret(body.clientSecret.trim()),
      refreshTokenEnc: encryptSecret(body.refreshToken.trim()),
    },
  });
  return c.json({ ok: true });
});

/** DELETE /spotify/credentials — remove the user's stored Spotify credentials. */
spotify.delete("/credentials", async (c) => {
  const { userId } = c.get("auth");
  try {
    await prisma.spotifyCredential.delete({ where: { userId } });
  } catch {
    // already absent
  }
  return c.json({ ok: true });
});

// ---------- Spotify Web API proxy ----------

async function guardConfigured(c: Context): Promise<Response | null> {
  const { userId } = c.get("auth");
  const config = await getUserSpotifyConfig(userId);
  if (!config) {
    return c.json({ error: "Spotify not configured. Add your credentials in Settings → Integrations." }, 503);
  }
  return null;
}

/** GET /spotify/status — is Spotify configured for this user? */
spotify.get("/status", async (c) => {
  const { userId } = c.get("auth");
  return c.json({ configured: await isSpotifyConfiguredFor(userId) });
});

/** GET /spotify/token — returns a fresh access token for the Web Playback SDK. */
spotify.get("/token", async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  try {
    const token = await getAccessToken(userId);
    return c.json({ access_token: token });
  } catch (e) {
    return c.json({ error: (e as { message?: string }).message ?? "Token error" }, 500);
  }
});

/** GET /spotify/me */
spotify.get("/me", async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const res = await spotifyFetch(userId, "/me");
  return c.json(await res.json(), res.status as 200);
});

/** GET /spotify/current — currently playing track */
spotify.get("/current", async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const res = await spotifyFetch(userId, "/me/player/currently-playing");
  if (res.status === 204) return c.json({ is_playing: false, item: null }, 200);
  return c.json(await res.json(), res.status as 200);
});

/** GET /spotify/player — full player state */
spotify.get("/player", async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const res = await spotifyFetch(userId, "/me/player");
  if (res.status === 204) return c.json({ is_playing: false, item: null, device: null }, 200);
  return c.json(await res.json(), res.status as 200);
});

const deviceSchema = z.object({ device_id: z.string().optional() });

/** PUT /spotify/play */
spotify.put("/play", zValidator("json", z.object({ device_id: z.string().optional(), uris: z.array(z.string()).optional(), context_uri: z.string().optional(), position_ms: z.number().optional() }).optional()), async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const body = c.req.valid("json") ?? {};
  const qs = body.device_id ? `?device_id=${encodeURIComponent(body.device_id)}` : "";
  const payload: Record<string, unknown> = {};
  if (body.uris) payload.uris = body.uris;
  if (body.context_uri) payload.context_uri = body.context_uri;
  if (typeof body.position_ms === "number") payload.position_ms = body.position_ms;
  const res = await spotifyFetch(userId, `/me/player/play${qs}`, {
    method: "PUT",
    body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
  });
  if (res.status === 204) return c.body(null, 204);
  return c.json({ ok: res.ok }, res.status as 200);
});

/** PUT /spotify/pause */
spotify.put("/pause", zValidator("json", deviceSchema.optional()), async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const body = c.req.valid("json") ?? {};
  const qs = body.device_id ? `?device_id=${encodeURIComponent(body.device_id)}` : "";
  const res = await spotifyFetch(userId, `/me/player/pause${qs}`, { method: "PUT" });
  if (res.status === 204) return c.body(null, 204);
  return c.json({ ok: res.ok }, res.status as 200);
});

/** POST /spotify/next */
spotify.post("/next", zValidator("json", deviceSchema.optional()), async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const body = c.req.valid("json") ?? {};
  const qs = body.device_id ? `?device_id=${encodeURIComponent(body.device_id)}` : "";
  const res = await spotifyFetch(userId, `/me/player/next${qs}`, { method: "POST" });
  if (res.status === 204) return c.body(null, 204);
  return c.json({ ok: res.ok }, res.status as 200);
});

/** POST /spotify/previous */
spotify.post("/previous", zValidator("json", deviceSchema.optional()), async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const body = c.req.valid("json") ?? {};
  const qs = body.device_id ? `?device_id=${encodeURIComponent(body.device_id)}` : "";
  const res = await spotifyFetch(userId, `/me/player/previous${qs}`, { method: "POST" });
  if (res.status === 204) return c.body(null, 204);
  return c.json({ ok: res.ok }, res.status as 200);
});

/** PUT /spotify/seek?position_ms=... */
spotify.put("/seek", async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const position_ms = c.req.query("position_ms");
  const deviceId = c.req.query("device_id");
  if (!position_ms) return c.json({ error: "position_ms required" }, 400);
  let qs = `?position_ms=${encodeURIComponent(position_ms)}`;
  if (deviceId) qs += `&device_id=${encodeURIComponent(deviceId)}`;
  const res = await spotifyFetch(userId, `/me/player/seek${qs}`, { method: "PUT" });
  if (res.status === 204) return c.body(null, 204);
  return c.json({ ok: res.ok }, res.status as 200);
});

/** PUT /spotify/volume?volume_percent=... */
spotify.put("/volume", async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const volume = c.req.query("volume_percent");
  const deviceId = c.req.query("device_id");
  if (!volume) return c.json({ error: "volume_percent required" }, 400);
  let qs = `?volume_percent=${encodeURIComponent(volume)}`;
  if (deviceId) qs += `&device_id=${encodeURIComponent(deviceId)}`;
  const res = await spotifyFetch(userId, `/me/player/volume${qs}`, { method: "PUT" });
  if (res.status === 204) return c.body(null, 204);
  return c.json({ ok: res.ok }, res.status as 200);
});

/** PUT /spotify/shuffle?state=true|false */
spotify.put("/shuffle", async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const state = c.req.query("state");
  const deviceId = c.req.query("device_id");
  let qs = `?state=${state === "true" ? "true" : "false"}`;
  if (deviceId) qs += `&device_id=${encodeURIComponent(deviceId)}`;
  const res = await spotifyFetch(userId, `/me/player/shuffle${qs}`, { method: "PUT" });
  if (res.status === 204) return c.body(null, 204);
  return c.json({ ok: res.ok }, res.status as 200);
});

/** PUT /spotify/repeat?state=off|track|context */
spotify.put("/repeat", async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const state = c.req.query("state") ?? "off";
  const deviceId = c.req.query("device_id");
  let qs = `?state=${encodeURIComponent(state)}`;
  if (deviceId) qs += `&device_id=${encodeURIComponent(deviceId)}`;
  const res = await spotifyFetch(userId, `/me/player/repeat${qs}`, { method: "PUT" });
  if (res.status === 204) return c.body(null, 204);
  return c.json({ ok: res.ok }, res.status as 200);
});

/** GET /spotify/devices */
spotify.get("/devices", async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const res = await spotifyFetch(userId, "/me/player/devices");
  return c.json(await res.json(), res.status as 200);
});

/** PUT /spotify/transfer — transfer playback to a device */
spotify.put("/transfer", zValidator("json", z.object({ device_ids: z.array(z.string()), play: z.boolean().optional() })), async (c) => {
  const { userId } = c.get("auth");
  const guard = await guardConfigured(c);
  if (guard) return guard;
  const body = c.req.valid("json");
  const res = await spotifyFetch(userId, "/me/player", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (res.status === 204) return c.body(null, 204);
  return c.json({ ok: res.ok }, res.status as 200);
});

export default spotify;
