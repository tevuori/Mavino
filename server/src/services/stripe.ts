// ===== Stripe integration =====
// Handles checkout session creation, billing portal, and webhook processing.
// The user's role (PAID / PRO) is the authoritative tier indicator and is
// kept in sync with Stripe subscription state via webhook handlers.
//
// Env vars:
//   STRIPE_SECRET_KEY     — sk_test_... / sk_live_...
//   STRIPE_WEBHOOK_SECRET — whsec_...
//   STRIPE_PRICE_PAID     — Stripe price ID for €5/mo plan
//   STRIPE_PRICE_PRO      — Stripe price ID for €10/mo plan
//
// Admin can also configure price IDs via the Setting table (overrides env).

import Stripe from "stripe";
import prisma from "../db/client";

let stripeInstance: Stripe | null = null;

function getStripeKey(): string {
  return process.env.STRIPE_SECRET_KEY ?? "";
}

/** Lazily initialize the Stripe client. Returns null if not configured. */
export function getStripe(): Stripe | null {
  if (!stripeInstance && getStripeKey()) {
    stripeInstance = new Stripe(getStripeKey());
  }
  return stripeInstance;
}

/** Whether Stripe is configured (secret key present). */
export function isStripeConfigured(): boolean {
  return Boolean(getStripeKey());
}

// ----- price ID management (env fallback + admin override) -----

const PRICE_PAID_KEY = "stripe.price.paid";
const PRICE_PRO_KEY = "stripe.price.pro";

async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.setting.findFirst({ where: { userId: null, key } });
  return s?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const existing = await prisma.setting.findFirst({ where: { userId: null, key } });
  if (existing) {
    await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { userId: null, key, value } });
  }
}

/** Get the Stripe price ID for a plan (admin override or env fallback). */
export async function getPriceId(plan: "paid" | "pro"): Promise<string | null> {
  const key = plan === "pro" ? PRICE_PRO_KEY : PRICE_PAID_KEY;
  const override = await getSetting(key);
  if (override) return override;
  return plan === "pro"
    ? (process.env.STRIPE_PRICE_PRO ?? null)
    : (process.env.STRIPE_PRICE_PAID ?? null);
}

/** Set the Stripe price ID for a plan (admin override). */
export async function setPriceId(plan: "paid" | "pro", priceId: string): Promise<void> {
  const key = plan === "pro" ? PRICE_PRO_KEY : PRICE_PAID_KEY;
  await setSetting(key, priceId);
}

/** Map a Stripe price ID to a plan name. */
export async function getPlanFromPriceId(priceId: string): Promise<"paid" | "pro" | null> {
  const [paidId, proId] = await Promise.all([getPriceId("paid"), getPriceId("pro")]);
  if (priceId === proId) return "pro";
  if (priceId === paidId) return "paid";
  return null;
}

/**
 * Extract the current period start/end from a Stripe subscription.
 * In newer API versions, these fields live on the SubscriptionItem, not the
 * Subscription itself.
 */
function getPeriod(sub: Stripe.Subscription): { start: number | null; end: number | null } {
  const item = sub.items.data[0];
  if (item && item.current_period_start && item.current_period_end) {
    return { start: item.current_period_start, end: item.current_period_end };
  }
  return { start: null, end: null };
}

// ----- checkout & portal -----

/** The role to set for a given plan. */
function planToRole(plan: "paid" | "pro"): string {
  return plan === "pro" ? "PRO" : "PAID";
}

/** Create a Stripe Checkout session for upgrading to a plan. */
export async function createCheckoutSession(
  userId: string,
  plan: "paid" | "pro"
): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  if (!stripe) return { error: "Stripe is not configured." };
  const priceId = await getPriceId(plan);
  if (!priceId) return { error: `No Stripe price configured for the ${plan} plan.` };

  // Check if the user already has a subscription
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (existing?.stripeCustomerId) {
    // If they already have an active subscription to the same or higher plan,
    // redirect to the portal instead.
    if (existing.status === "active" && existing.plan === plan) {
      return createPortalSession(userId);
    }
  }

  const origin = process.env.STRIPE_SUCCESS_URL ?? `${process.env.PUBLIC_URL ?? ""}`;
  const successUrl = `${origin}/?checkout=success`;
  const cancelUrl = `${origin}/?checkout=cancelled`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId, plan },
      customer_email: existing?.stripeCustomerId ? undefined : undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
    });
    return { url: session.url ?? "" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create checkout session" };
  }
}

/** Create a Stripe Billing Portal session for managing an existing subscription. */
export async function createPortalSession(
  userId: string
): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  if (!stripe) return { error: "Stripe is not configured." };
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub?.stripeCustomerId) return { error: "No active subscription found." };

  const origin = process.env.STRIPE_SUCCESS_URL ?? `${process.env.PUBLIC_URL ?? ""}`;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: origin || undefined,
    });
    return { url: session.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create portal session" };
  }
}

/** Cancel a subscription at period end. */
export async function cancelSubscription(
  userId: string
): Promise<{ ok: boolean } | { error: string }> {
  const stripe = getStripe();
  if (!stripe) return { error: "Stripe is not configured." };
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub?.stripeSubscriptionId) return { error: "No active subscription found." };

  try {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    await prisma.subscription.update({
      where: { userId },
      data: { cancelAt: sub.currentPeriodEnd },
    });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to cancel subscription" };
  }
}

// ----- webhook handling -----

/** Process a Stripe webhook event. Called after signature verification. */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId ?? session.client_reference_id;
      const plan = session.metadata?.plan as "paid" | "pro" | undefined;
      if (!userId || !plan) break;
      await syncSubscriptionFromCheckout(userId, session, plan);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscriptionFromStripeObj(sub);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(sub);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      // In newer API versions, the subscription reference is nested under
      // parent.subscription_details.subscription (not invoice.subscription).
      const subRef = invoice.parent?.subscription_details?.subscription;
      const subId = typeof subRef === "string" ? subRef : null;
      if (subId) {
        const sub = await getStripe()?.subscriptions.retrieve(subId);
        if (sub) await syncSubscriptionFromStripeObj(sub, "past_due");
      }
      break;
    }
    default:
      // Unhandled event type — no action needed
      break;
  }
}

/** Sync subscription state from a completed checkout session. */
async function syncSubscriptionFromCheckout(
  userId: string,
  session: Stripe.Checkout.Session,
  plan: "paid" | "pro"
): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  // Get the subscription from the session
  const subscriptionId = session.subscription as string;
  const stripeSub = subscriptionId
    ? await stripe.subscriptions.retrieve(subscriptionId)
    : null;

  const period = stripeSub ? getPeriod(stripeSub) : { start: null, end: null };

  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      plan,
      status: stripeSub?.status ?? "active",
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: subscriptionId ?? null,
      stripePriceId: stripeSub?.items.data[0]?.price?.id ?? null,
      currentPeriodStart: period.start ? new Date(period.start * 1000) : null,
      currentPeriodEnd: period.end ? new Date(period.end * 1000) : null,
    },
    update: {
      plan,
      status: stripeSub?.status ?? "active",
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: subscriptionId ?? null,
      stripePriceId: stripeSub?.items.data[0]?.price?.id ?? null,
      currentPeriodStart: period.start ? new Date(period.start * 1000) : null,
      currentPeriodEnd: period.end ? new Date(period.end * 1000) : null,
      cancelAt: null,
    },
  });

  // Update the user's role
  await prisma.user.update({
    where: { id: userId },
    data: { role: planToRole(plan) },
  });
}

/** Sync subscription state from a Stripe subscription object. */
async function syncSubscriptionFromStripeObj(
  sub: Stripe.Subscription,
  overrideStatus?: string
): Promise<void> {
  const stripeCustomerId = sub.customer as string;
  // Find the user by stripeCustomerId
  const existing = await prisma.subscription.findFirst({
    where: { stripeCustomerId },
  });
  if (!existing) return;

  const priceId = sub.items.data[0]?.price?.id ?? null;
  const plan = priceId ? await getPlanFromPriceId(priceId) : null;
  const status = overrideStatus ?? mapStripeStatus(sub.status);
  const period = getPeriod(sub);

  await prisma.subscription.update({
    where: { userId: existing.userId },
    data: {
      status,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      currentPeriodStart: period.start ? new Date(period.start * 1000) : null,
      currentPeriodEnd: period.end ? new Date(period.end * 1000) : null,
      cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
      ...(plan ? { plan } : {}),
    },
  });

  // Update role based on status
  if (status === "active" || status === "trialing") {
    if (plan) {
      await prisma.user.update({
        where: { id: existing.userId },
        data: { role: planToRole(plan) },
      });
    }
  } else if (status === "canceled" || status === "unpaid") {
    await prisma.user.update({
      where: { id: existing.userId },
      data: { role: "FREE" },
    });
  }
}

/** Handle subscription deletion — revert user to FREE. */
async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const stripeCustomerId = sub.customer as string;
  const existing = await prisma.subscription.findFirst({
    where: { stripeCustomerId },
  });
  if (!existing) return;

  await prisma.subscription.update({
    where: { userId: existing.userId },
    data: {
      status: "canceled",
      cancelAt: null,
    },
  });

  await prisma.user.update({
    where: { id: existing.userId },
    data: { role: "FREE" },
  });
}

/** Map Stripe subscription status to our internal status. */
function mapStripeStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "active": return "active";
    case "trialing": return "trialing";
    case "past_due": return "past_due";
    case "canceled": return "canceled";
    case "unpaid": return "canceled";
    case "incomplete": return "incomplete";
    case "incomplete_expired": return "canceled";
    default: return "active";
  }
}

// ----- subscription status -----

/** Get the current user's subscription status (for the Plans app). */
export async function getSubscriptionStatus(userId: string): Promise<{
  plan: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  stripeConfigured: boolean;
}> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return {
    plan: sub?.plan ?? null,
    status: sub?.status ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    cancelAt: sub?.cancelAt?.toISOString() ?? null,
    stripeConfigured: isStripeConfigured(),
  };
}
