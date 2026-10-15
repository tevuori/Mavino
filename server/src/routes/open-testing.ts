import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createHash, randomBytes } from "node:crypto";
import prisma from "../db/client";
import { rateLimit } from "../middleware/rateLimit";
import { verifyTurnstileToken } from "../services/turnstile";
import { sendOpenTestingInviteEmail } from "../services/email";
import { signToken } from "../services/jwt";
import { getOpenTestingConfig, isOpenForInvites, isAtCapacity } from "../services/open-testing-config";

const openTesting = new Hono();

const requestSchema = z.object({
  email: z.string().email().min(1).max(320),
  turnstileToken: z.string().optional(),
});

const verifySchema = z.object({
  email: z.string().email().min(1).max(320),
  code: z.string().min(6).max(12),
  turnstileToken: z.string().optional(),
});

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateCode(): string {
  // 8-character alphanumeric code, easy to type.
  return randomBytes(4).toString("hex").toUpperCase();
}

/** Public status endpoint used by the landing page to show/hide the signup CTA. */
openTesting.get("/status", async (c) => {
  const config = await getOpenTestingConfig();
  return c.json({
    enabled: config.enabled,
    mode: config.enabled ? (config.open ? "open" : "closed") : "disabled",
    waitlistMessage: config.waitlistMessage,
  });
});

const requestLimiter = rateLimit({ max: 3, windowMs: 60_000 });

/**
 * POST /open-testing/request
 * Request an open-testing invite. If open and under capacity, creates a code
 * and emails it. If closed or at capacity, adds the email to the waitlist.
 */
openTesting.post("/request", requestLimiter, zValidator("json", requestSchema), async (c) => {
  const { email, turnstileToken } = c.req.valid("json");

  const turnstileOk = await verifyTurnstileToken(turnstileToken, c.req.header("x-real-ip") ?? undefined);
  if (!turnstileOk) {
    return c.json({ error: "Bot verification failed. Please try again." }, 403);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const config = await getOpenTestingConfig();

  if (!config.enabled) {
    return c.json({ error: "Open testing is not enabled." }, 403);
  }

  // If already used by a registered user, don't leak that — just say waitlist.
  const existingUsed = await prisma.openTestingInvite.findFirst({
    where: { email: normalizedEmail, status: "USED" },
  });
  if (existingUsed) {
    return c.json({
      mode: "waitlist",
      message: "This email is already registered.",
    });
  }

  // If a pending/sent invite already exists, resend it (refresh code + expiry).
  const existing = await prisma.openTestingInvite.findFirst({
    where: { email: normalizedEmail, status: { in: ["PENDING", "SENT"] } },
  });

  const atCapacity = await isAtCapacity(config);

  if (!config.open || atCapacity) {
    // Closed or full → waitlist.
    if (!existing) {
      await prisma.openTestingInvite.create({
        data: {
          email: normalizedEmail,
          codeHash: "",
          status: "WAITLIST",
        },
      });
    } else if (existing.status === "PENDING") {
      await prisma.openTestingInvite.update({
        where: { id: existing.id },
        data: { status: "WAITLIST" },
      });
    }
    return c.json({
      mode: "waitlist",
      message: config.waitlistMessage || "Open testing is currently full. We'll email you when a spot opens up.",
    });
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  if (existing) {
    await prisma.openTestingInvite.update({
      where: { id: existing.id },
      data: { codeHash, status: "SENT", expiresAt, sentAt: new Date() },
    });
  } else {
    await prisma.openTestingInvite.create({
      data: {
        email: normalizedEmail,
        codeHash,
        status: "SENT",
        expiresAt,
        sentAt: new Date(),
      },
    });
  }

  await sendOpenTestingInviteEmail({ to: normalizedEmail, code, expiresAt });

  return c.json({
    mode: "invite",
    message: "Check your inbox for the activation code.",
  });
});

const verifyLimiter = rateLimit({ max: 5, windowMs: 60_000 });

/**
 * POST /open-testing/verify
 * Verify an emailed code and issue a short-lived registration token.
 */
openTesting.post("/verify", verifyLimiter, zValidator("json", verifySchema), async (c) => {
  const { email, code, turnstileToken } = c.req.valid("json");

  const turnstileOk = await verifyTurnstileToken(turnstileToken, c.req.header("x-real-ip") ?? undefined);
  if (!turnstileOk) {
    return c.json({ error: "Bot verification failed. Please try again." }, 403);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const codeHash = hashCode(code);
  const now = new Date();

  const invite = await prisma.openTestingInvite.findUnique({
    where: { codeHash },
  });

  if (!invite || invite.email !== normalizedEmail || invite.status !== "SENT" || (invite.expiresAt && invite.expiresAt < now)) {
    return c.json({ error: "Invalid or expired code." }, 400);
  }

  const registrationToken = await signToken(
    { sub: invite.id, username: invite.email, invite: true },
    "10m"
  );

  return c.json({
    registrationToken,
    email: invite.email,
  });
});

export default openTesting;
