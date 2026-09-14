import { DescribeVoicesCommand, PollyClient } from "@aws-sdk/client-polly";
import prisma from "../db/client";
import { decryptSecret, encryptSecret } from "./crypto";

const KEYS = {
  accessKeyId: "polly.aws.accessKeyId",
  secretAccessKey: "polly.aws.secretAccessKey",
  sessionToken: "polly.aws.sessionToken",
  region: "polly.aws.region",
} as const;

export interface PollyConfigStatus {
  configured: boolean;
  source: "database" | "environment" | "none";
  region: string;
}

export interface PollySecrets {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

async function getSetting(key: string) {
  const row = await prisma.setting.findFirst({ where: { userId: null, key } });
  return row?.value ?? "";
}

async function setSetting(key: string, value: string) {
  const row = await prisma.setting.findFirst({ where: { userId: null, key } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value } });
  else await prisma.setting.create({ data: { userId: null, key, value } });
}

function decrypt(value: string) {
  if (!value) return "";
  try { return decryptSecret(value); } catch { return ""; }
}

export async function getPollySecrets(): Promise<PollySecrets | null> {
  const [accessKeyEnc, secretKeyEnc, tokenEnc, storedRegion] = await Promise.all([
    getSetting(KEYS.accessKeyId), getSetting(KEYS.secretAccessKey),
    getSetting(KEYS.sessionToken), getSetting(KEYS.region),
  ]);
  const accessKeyId = decrypt(accessKeyEnc);
  const secretAccessKey = decrypt(secretKeyEnc);
  if (accessKeyId && secretAccessKey) {
    return {
      region: storedRegion || "eu-central-1",
      accessKeyId,
      secretAccessKey,
      sessionToken: decrypt(tokenEnc) || undefined,
    };
  }
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-central-1",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    };
  }
  return null;
}

export async function getPollyConfigStatus(): Promise<PollyConfigStatus> {
  const stored = Boolean(await getSetting(KEYS.accessKeyId));
  const env = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const region = await getSetting(KEYS.region);
  return {
    configured: stored || env,
    source: stored ? "database" : env ? "environment" : "none",
    region: region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-central-1",
  };
}

export async function savePollyConfig(input: PollySecrets) {
  await Promise.all([
    setSetting(KEYS.accessKeyId, encryptSecret(input.accessKeyId!.trim())),
    setSetting(KEYS.secretAccessKey, encryptSecret(input.secretAccessKey!.trim())),
    setSetting(KEYS.sessionToken, input.sessionToken?.trim() ? encryptSecret(input.sessionToken.trim()) : ""),
    setSetting(KEYS.region, input.region.trim()),
  ]);
}

export async function clearPollyConfig() {
  await Promise.all([
    setSetting(KEYS.accessKeyId, ""), setSetting(KEYS.secretAccessKey, ""),
    setSetting(KEYS.sessionToken, ""), setSetting(KEYS.region, "eu-central-1"),
  ]);
}

export function createPollyClient(config: PollySecrets) {
  return new PollyClient({
    region: config.region,
    credentials: config.accessKeyId && config.secretAccessKey ? {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
    } : undefined,
  });
}

export async function testPollyConfig(config?: PollySecrets) {
  const resolved = config ?? await getPollySecrets();
  if (!resolved) throw new Error("AWS Polly is not configured");
  const client = createPollyClient(resolved);
  try {
    const result = await client.send(new DescribeVoicesCommand({ LanguageCode: "en-US" }));
    return { ok: true, voiceCount: result.Voices?.length ?? 0 };
  } finally {
    client.destroy();
  }
}
