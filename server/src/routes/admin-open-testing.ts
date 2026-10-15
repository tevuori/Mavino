import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import {
  getOpenTestingConfig,
  setOpenTestingConfig,
  countActiveTesters,
} from "../services/open-testing-config";
import { sendOpenTestingInviteEmail } from "../services/email";
import { createHash, randomBytes } from "node:crypto";

const adminOpenTesting = new Hono();
adminOpenTesting.use("*", authMiddleware, adminMiddleware);

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  open: z.boolean().optional(),
  maxActiveTesters: z.number().int().min(0).optional(),
  waitlistMessage: z.string().max(500).optional(),
});

/** GET /admin/open-testing – current settings + stats. */
adminOpenTesting.get("/", async (c) => {
  const config = await getOpenTestingConfig();
  const [activeTesters, pendingInvites, waitlistCount] = await Promise.all([
    countActiveTesters(),
    prisma.openTestingInvite.count({ where: { status: { in: ["PENDING", "SENT"] } } }),
    prisma.openTestingInvite.count({ where: { status: "WAITLIST" } }),
  ]);
  return c.json({
    config,
    stats: { activeTesters, pendingInvites, waitlistCount },
  });
});

/** PUT /admin/open-testing – update settings. */
adminOpenTesting.put("/", zValidator("json", settingsSchema), async (c) => {
  const patch = c.req.valid("json");
  const config = await setOpenTestingConfig(patch);
  return c.json({ config });
});

/** GET /admin/open-testing/invites – list invites + waitlist. */
adminOpenTesting.get("/invites", async (c) => {
  const invites = await prisma.openTestingInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { username: true } } },
  });
  return c.json(
    invites.map((i) => ({
      id: i.id,
      email: i.email,
      status: i.status,
      createdAt: i.createdAt.toISOString(),
      sentAt: i.sentAt?.toISOString(),
      usedAt: i.usedAt?.toISOString(),
      expiresAt: i.expiresAt?.toISOString(),
      username: i.user?.username ?? null,
    }))
  );
});

/** POST /admin/open-testing/invites/:id/send – resend or send a code manually. */
adminOpenTesting.post("/invites/:id/send", async (c) => {
  const id = c.req.param("id");
  const invite = await prisma.openTestingInvite.findUnique({ where: { id } });
  if (!invite) return c.json({ error: "Invite not found" }, 404);
  if (invite.status === "USED") return c.json({ error: "Invite already used" }, 400);

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.openTestingInvite.update({
    where: { id },
    data: { codeHash, status: "SENT", expiresAt, sentAt: new Date() },
  });

  const ok = await sendOpenTestingInviteEmail({ to: invite.email, code, expiresAt });
  return c.json({ ok, message: ok ? "Code sent." : "Failed to send email." });
});

/** DELETE /admin/open-testing/invites/:id – delete an invite or waitlist entry. */
adminOpenTesting.delete("/invites/:id", async (c) => {
  const id = c.req.param("id");
  const invite = await prisma.openTestingInvite.findUnique({ where: { id } });
  if (!invite) return c.json({ error: "Invite not found" }, 404);
  if (invite.status === "USED") return c.json({ error: "Cannot delete a used invite" }, 400);
  await prisma.openTestingInvite.delete({ where: { id } });
  return c.json({ ok: true });
});

/** POST /admin/open-testing/waitlist/:id/approve – move waitlist entry to sent invite. */
adminOpenTesting.post("/waitlist/:id/approve", async (c) => {
  const id = c.req.param("id");
  const invite = await prisma.openTestingInvite.findUnique({ where: { id } });
  if (!invite) return c.json({ error: "Entry not found" }, 404);
  if (invite.status !== "WAITLIST") return c.json({ error: "Entry is not on waitlist" }, 400);

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.openTestingInvite.update({
    where: { id },
    data: { codeHash, status: "SENT", expiresAt, sentAt: new Date() },
  });

  const ok = await sendOpenTestingInviteEmail({ to: invite.email, code, expiresAt });
  return c.json({ ok, message: ok ? "Invite sent." : "Failed to send email." });
});

export default adminOpenTesting;
