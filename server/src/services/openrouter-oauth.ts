import { createHash, randomBytes } from "node:crypto";
import prisma from "../db/client";
import { decryptSecret, encryptSecret } from "./crypto";
import { getAppBaseUrl } from "./email";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function base64url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createOpenRouterAuthorization(userId: string): Promise<string> {
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(sha256(verifier));
  const callbackUrl = `${getAppBaseUrl()}/api/auth/openrouter/callback?state=${encodeURIComponent(state)}`;
  await prisma.llmOAuthState.create({
    data: {
      userId,
      provider: "openrouter",
      stateHash: sha256(state).toString("hex"),
      codeVerifierEnc: encryptSecret(verifier),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: challenge,
    code_challenge_method: "S256",
    key_label: "Mavino",
  });
  return `https://openrouter.ai/auth?${params.toString()}`;
}

export async function completeOpenRouterAuthorization(code: string, state: string): Promise<string | null> {
  const now = new Date();
  const row = await prisma.llmOAuthState.findUnique({
    where: { stateHash: sha256(state).toString("hex") },
  });
  if (!row || row.provider !== "openrouter" || row.consumedAt || row.expiresAt <= now) return null;
  const claimed = await prisma.llmOAuthState.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (claimed.count !== 1) return null;
  const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: decryptSecret(row.codeVerifierEnc),
      code_challenge_method: "S256",
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { key?: string };
  if (!payload.key) return null;
  const apiKey = payload.key;
  const validation = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!validation.ok) return null;
  // Interactive $transaction (function form) — the RLS extension only
  // intercepts this form; array-form inner ops would each be wrapped in
  // their own transaction and deadlock.
  await prisma.$transaction(async (tx) => {
    await tx.aiCredential.upsert({
      where: { userId: row.userId },
      create: {
        userId: row.userId,
        apiKeyEnc: encryptSecret(apiKey),
        provider: "openrouter",
        modelId: "openrouter/auto",
        authType: "oauth_key",
        status: "active",
        externalKeyHash: sha256(apiKey).toString("hex"),
        lastValidatedAt: now,
      },
      update: {
        apiKeyEnc: encryptSecret(apiKey),
        provider: "openrouter",
        baseUrl: null,
        modelId: "openrouter/auto",
        authType: "oauth_key",
        status: "active",
        externalKeyHash: sha256(apiKey).toString("hex"),
        lastValidatedAt: now,
        lastError: null,
      },
    });
    await tx.user.update({ where: { id: row.userId }, data: { aiSource: "byok" } });
  });
  return row.userId;
}
