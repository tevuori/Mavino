// ===== Subscription routes =====
// User-facing subscription management (checkout, portal, cancel, status)
// and the Stripe webhook endpoint.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import {
  createCheckoutSession,
  createPortalSession,
  cancelSubscription,
  getSubscriptionStatus,
  getPriceId,
  setPriceId,
  handleStripeEvent,
  isStripeConfigured,
} from "../services/stripe";

const subscriptions = new Hono();

// ----- user: subscription status + checkout -----

/** GET /api/subscriptions — current user's subscription status. */
subscriptions.get("/", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  const status = await getSubscriptionStatus(userId);
  return c.json(status);
});

const checkoutSchema = z.object({
  plan: z.enum(["paid", "pro"]),
});

/** POST /api/subscriptions/checkout — create a Stripe checkout session. */
subscriptions.post("/checkout", authMiddleware, zValidator("json", checkoutSchema), async (c) => {
  const { userId } = c.get("auth");
  const { plan } = c.req.valid("json");
  const result = await createCheckoutSession(userId, plan);
  if ("error" in result) return c.json({ error: result.error }, 400);
  return c.json(result);
});

/** POST /api/subscriptions/portal — create a Stripe billing portal session. */
subscriptions.post("/portal", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  const result = await createPortalSession(userId);
  if ("error" in result) return c.json({ error: result.error }, 400);
  return c.json(result);
});

/** POST /api/subscriptions/cancel — cancel the current subscription. */
subscriptions.post("/cancel", authMiddleware, async (c) => {
  const { userId } = c.get("auth");
  const result = await cancelSubscription(userId);
  if ("error" in result) return c.json({ error: result.error }, 400);
  return c.json(result);
});

// ----- admin: price ID management -----

const admin = new Hono();

/** GET /api/subscriptions/admin/prices — get configured price IDs. */
admin.get("/prices", adminMiddleware, async (c) => {
  const [paidPriceId, proPriceId] = await Promise.all([
    getPriceId("paid"),
    getPriceId("pro"),
  ]);
  return c.json({
    paidPriceId,
    proPriceId,
    stripeConfigured: isStripeConfigured(),
  });
});

const priceSchema = z.object({
  plan: z.enum(["paid", "pro"]),
  priceId: z.string().min(1).max(256),
});

/** PUT /api/subscriptions/admin/prices — set a price ID for a plan. */
admin.put("/prices", adminMiddleware, zValidator("json", priceSchema), async (c) => {
  const { plan, priceId } = c.req.valid("json");
  await setPriceId(plan, priceId);
  return c.json({ ok: true });
});

subscriptions.route("/admin", admin);

// ----- Stripe webhook (no auth — verified by signature) -----

/** POST /api/subscriptions/webhook — Stripe webhook endpoint. */
subscriptions.post("/webhook", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "Missing stripe-signature header" }, 400);

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return c.json({ error: "Webhook secret not configured" }, 500);

  // Import getStripe lazily to avoid circular dependency
  const { getStripe } = await import("../services/stripe");
  const stripe = getStripe();
  if (!stripe) return c.json({ error: "Stripe not configured" }, 500);

  // Read raw body
  const rawBody = await c.req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Invalid signature" }, 400);
  }

  try {
    await handleStripeEvent(event);
  } catch (e) {
    console.error("[stripe] webhook handler error:", e);
    return c.json({ error: "Webhook handler failed" }, 500);
  }

  return c.json({ received: true });
});

export default subscriptions;
