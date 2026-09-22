import { createHash, randomBytes } from "node:crypto";
import prisma from "../db/client";
import { encryptSecret } from "./crypto";
import { getAppBaseUrl, sendEmail } from "./email";

const CONSENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CONSENT_TERMS_VERSION = "2026-09-22";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestGuardianConsent(userId: string, guardianEmail: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  await prisma.$transaction([
    prisma.guardianConsent.updateMany({
      where: { userId, verifiedAt: null, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.guardianConsent.create({
      data: {
        userId,
        guardianEmailEnc: encryptSecret(guardianEmail.trim().toLowerCase()),
        tokenHash: hashToken(token),
        termsVersion: CONSENT_TERMS_VERSION,
        expiresAt: new Date(now.getTime() + CONSENT_TTL_MS),
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { guardianConsentStatus: "PENDING", guardianConsentVerifiedAt: null },
    }),
  ]);
  const confirmUrl = `${getAppBaseUrl()}/api/auth/guardian-consent/confirm?token=${token}`;
  try {
    await sendEmail({
      to: guardianEmail,
      subject: "Confirm Mavino AI access",
      text: `A student registered for Mavino and identified you as their guardian. Review and confirm AI access using this link:\n\n${confirmUrl}\n\nThe link expires in 7 days. If you did not expect this request, ignore this email.`,
      html: `<p>A student registered for Mavino and identified you as their guardian.</p><p><a href="${confirmUrl}">Review and confirm AI access</a></p><p>The link expires in 7 days. If you did not expect this request, ignore this email.</p>`,
    });
  } catch (error) {
    console.error("[guardian-consent] failed to send confirmation", error);
  }
}

export async function confirmGuardianConsent(token: string): Promise<boolean> {
  const now = new Date();
  const consent = await prisma.guardianConsent.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!consent || consent.verifiedAt || consent.revokedAt || consent.expiresAt <= now) return false;
  await prisma.$transaction([
    prisma.guardianConsent.update({ where: { id: consent.id }, data: { verifiedAt: now } }),
    prisma.user.update({
      where: { id: consent.userId },
      data: { guardianConsentStatus: "VERIFIED", guardianConsentVerifiedAt: now, aiSource: "hosted" },
    }),
  ]);
  return true;
}
