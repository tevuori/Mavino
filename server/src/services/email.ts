/**
 * Email service — sends transactional emails (password reset, etc.) via SMTP.
 *
 * Configured via SMTP_URL env var (e.g. "smtps://user:pass@smtp.gmail.com:465").
 * When SMTP_URL is not set, emails are logged to the console instead of sent
 * (useful for local dev and testing). When APP_BASE_URL is set, reset links
 * use it as the origin; otherwise the server's own URL is used.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

let transporter: Transporter | null = null;
let transporterInitPromise: Promise<Transporter | null> | null = null;

async function getTransporter(): Promise<Transporter | null> {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  if (transporter) return transporter;
  if (transporterInitPromise) return transporterInitPromise;
  transporterInitPromise = (async () => {
    const t = nodemailer.createTransport(url);
    // Bounded wait so a stalling SMTP server can't hang request handlers.
    // (createTransport's second arg is mail defaults, not socket options.)
    await Promise.race([
      t.verify(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SMTP verify timeout")), 15_000)),
    ]);
    transporter = t;
    return t;
  })().catch((err) => {
    // Allow retry on the next send instead of caching a rejected promise.
    transporterInitPromise = null;
    throw err;
  });
  return transporterInitPromise;
}

interface SendOpts {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send an email. When SMTP_URL is not configured, logs to console instead.
 */
export async function sendEmail(opts: SendOpts): Promise<boolean> {
  const from = process.env.SMTP_FROM ?? "Mavino <noreply@mavino.local>";
  const t = await getTransporter();
  if (!t) {
    console.log(`[email] (no SMTP configured — would send)`);
    console.log(`  From: ${from}`);
    console.log(`  To: ${opts.to}`);
    console.log(`  Subject: ${opts.subject}`);
    console.log(`  Body: ${opts.text.slice(0, 200)}...`);
    return false;
  }
  try {
    await Promise.race([
      t.sendMail({
        from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SMTP send timeout")), 30_000)),
    ]);
    return true;
  } catch (err) {
    console.error("[email] Failed to send:", (err as Error).message);
    return false;
  }
}

/**
 * Get the base URL for building links in emails.
 * Falls back to the SERVER_HOST:SERVER_PORT if APP_BASE_URL is not set.
 */
export function getAppBaseUrl(): string {
  const baseUrl = process.env.APP_BASE_URL;
  if (baseUrl) return baseUrl.replace(/\/$/, "");
  const host = process.env.SERVER_HOST ?? "localhost";
  const port = process.env.SERVER_PORT ?? "3001";
  const isProd = process.env.NODE_ENV === "production";
  return `${isProd ? "https" : "http"}://${host}:${port}`;
}

/**
 * Send a password reset email. Returns true if the email was sent (or would
 * have been sent in dev mode), false on error.
 */
export async function sendPasswordResetEmail(opts: {
  to: string;
  username: string;
  resetToken: string;
}): Promise<boolean> {
  const baseUrl = getAppBaseUrl();
  const resetUrl = `${baseUrl}/reset-password?token=${opts.resetToken}`;
  const subject = "Mavino — Password reset";
  const text = `Hello ${opts.username},

You requested a password reset for your Mavino account. Click the link below to set a new password:

${resetUrl}

This link expires in 1 hour. If you didn't request this, you can safely ignore this email.

— Mavino Student OS`;
  const html = `<p>Hello ${opts.username},</p>
<p>You requested a password reset for your Mavino account. Click the link below to set a new password:</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
<p>— Mavino Student OS</p>`;
  return sendEmail({ to: opts.to, subject, text, html });
}
