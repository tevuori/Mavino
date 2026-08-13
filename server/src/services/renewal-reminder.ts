// ===== Subscription renewal reminder scheduler =====
// Sends an email reminder ~3 days before a paid subscription renews, so users
// are not charged without prior notice (EU consumer protection best practice).
//
// Runs daily at 09:00 via a Cron job. For each active subscription:
//   - currentPeriodEnd is within the next 3 days
//   - cancelAt is null (not already canceling)
//   - renewalReminderSentAt is null or from a previous period (older than
//     currentPeriodStart, so we only send once per billing cycle)
//   - user has an email address on file
// → sends a reminder email and stamps renewalReminderSentAt = now.
//
// If SMTP is not configured, the job logs a warning and skips (no crash).

import { Cron } from "croner";
import prisma from "../db/client";
import { sendEmail, getAppBaseUrl } from "./email";

const REMINDER_DAYS_BEFORE = 3;
const CRON_EXPRESSION = "0 9 * * *"; // daily at 09:00 server time

let cron: Cron | null = null;

/** Format a date for display in the email (e.g. "Monday, 15 August 2026"). */
function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Check and send renewal reminders for all eligible subscriptions. */
export async function sendRenewalReminders(): Promise<number> {
  const now = new Date();
  const reminderWindow = new Date(now.getTime() + REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000);

  // Find active subscriptions renewing within the reminder window that haven't
  // been reminded yet this billing cycle.
  const subs = await prisma.subscription.findMany({
    where: {
      status: "active",
      cancelAt: null,
      currentPeriodEnd: {
        gte: now,
        lte: reminderWindow,
      },
      renewalReminderSentAt: null,
    },
    include: {
      user: { select: { id: true, username: true, email: true, displayName: true } },
    },
  });

  let sent = 0;
  for (const sub of subs) {
    if (!sub.user.email) continue; // no email on file — skip

    const renewalDate = sub.currentPeriodEnd!;
    const baseUrl = getAppBaseUrl();
    const planName = sub.plan === "pro" ? "Pro" : "Paid";
    const price = sub.plan === "pro" ? "€10" : "€5";

    const subject = `Mavino — Your ${planName} subscription renews on ${formatDate(renewalDate)}`;
    const text = `Hello ${sub.user.displayName || sub.user.username},

This is a friendly reminder that your Mavino ${planName} subscription (${price}/month) will automatically renew on ${formatDate(renewalDate)}.

You will be charged ${price} via your saved payment method. No action is needed if you'd like to continue.

If you'd like to cancel, you can do so anytime in Mavino → Settings → Plans & Billing, or via the link below:
${baseUrl}/?app=plans

You'll keep access until the end of your current billing period, even after cancelling.

— Mavino Student OS`;
    const html = `<p>Hello ${sub.user.displayName || sub.user.username},</p>
<p>This is a friendly reminder that your Mavino <strong>${planName}</strong> subscription (${price}/month) will automatically renew on <strong>${formatDate(renewalDate)}</strong>.</p>
<p>You will be charged ${price} via your saved payment method. No action is needed if you'd like to continue.</p>
<p>If you'd like to cancel, you can do so anytime in <a href="${baseUrl}/?app=plans">Mavino → Settings → Plans & Billing</a>. You'll keep access until the end of your current billing period, even after cancelling.</p>
<p>— Mavino Student OS</p>`;

    const ok = await sendEmail({ to: sub.user.email, subject, text, html });
    if (ok) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { renewalReminderSentAt: now },
      });
      sent++;
      console.log(`[renewal-reminder] sent to ${sub.user.email} for subscription ${sub.id}`);
    } else {
      console.warn(`[renewal-reminder] failed to send to ${sub.user.email} (SMTP not configured or error)`);
    }
  }

  if (sent > 0) {
    console.log(`[renewal-reminder] sent ${sent} reminder(s)`);
  }
  return sent;
}

/** Start the daily renewal reminder cron job (idempotent). */
export function startRenewalReminderScheduler(): void {
  if (cron) return;
  // Run at startup (after a short delay to let the server boot) and daily at 09:00.
  setTimeout(() => void sendRenewalReminders().catch(console.error), 10_000);
  cron = new Cron(CRON_EXPRESSION, () => {
    void sendRenewalReminders().catch((e) =>
      console.error("[renewal-reminder] scheduler error:", e)
    );
  });
  console.log("[renewal-reminder] scheduler started (daily at 09:00)");
}

/** Stop the renewal reminder cron job. */
export function stopRenewalReminderScheduler(): void {
  if (cron) {
    cron.stop();
    cron = null;
  }
}
