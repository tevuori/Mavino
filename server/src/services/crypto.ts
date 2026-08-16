import * as crypto from "crypto";

// ===== Shared encryption helpers (AES-256-GCM) =====
// The encryption key is derived from ENCRYPTION_KEY (preferred) or falls back
// to JWT_SECRET for backward compatibility with existing deployments.
//
// SECURITY: Set ENCRYPTION_KEY to a separate secret (>= 32 chars) so that
// compromising JWT_SECRET does not also compromise all encrypted credentials.
// Generate one with: openssl rand -hex 32
//
// MIGRATION: If you already have encrypted data (API keys, etc.)
// and want to switch from JWT_SECRET to ENCRYPTION_KEY, you must either:
//   (a) set ENCRYPTION_KEY to the same value as JWT_SECRET (no re-encryption
//       needed, but no separation benefit), or
//   (b) set ENCRYPTION_KEY to a new value and re-enter all stored credentials
//       in Settings (old encrypted values become undecryptable).

const ALGO = "aes-256-gcm";
const isProduction = process.env.NODE_ENV === "production";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "";
const JWT_SECRET = process.env.JWT_SECRET ?? "";

// Prefer ENCRYPTION_KEY; fall back to JWT_SECRET for backward compatibility.
const RAW_KEY = ENCRYPTION_KEY || JWT_SECRET;

if (isProduction && !RAW_KEY) {
  console.error(
    "[mavino-server] FATAL: No encryption key available. Set ENCRYPTION_KEY (preferred) " +
      "or JWT_SECRET in your .env before starting in production.\n" +
      "Generate one with:  openssl rand -hex 32"
  );
  process.exit(1);
}

if (isProduction && !ENCRYPTION_KEY && JWT_SECRET) {
  console.warn(
    "[mavino-server] WARNING: ENCRYPTION_KEY is not set — falling back to JWT_SECRET for " +
      "AES-256-GCM encryption. This is a key-separation risk. Set ENCRYPTION_KEY to a " +
      "separate secret for better security."
  );
}

function deriveKey(): Buffer {
  // SHA-256 produces a 32-byte key suitable for AES-256.
  // Using the raw secret directly (no salt) is acceptable because the secret
  // itself is a high-entropy random value (>= 32 chars / 64 hex chars).
  return crypto.createHash("sha256").update(RAW_KEY || "athena-dev-encryption-key").digest();
}

export function encryptSecret(plain: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(encStr: string): string {
  const key = deriveKey();
  const [ivHex, tagHex, dataHex] = encStr.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Invalid encrypted data");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}
