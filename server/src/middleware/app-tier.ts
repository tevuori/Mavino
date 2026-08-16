import type { Context, Next } from "hono";
import { isAppAvailableFor } from "../services/features";

/** Must run AFTER an auth middleware. Returns 402 (Payment Required) if the
 *  user's subscription tier is too low for the given app, or 403 if the app
 *  is hidden (admin kill-switch).
 *
 *  This is the server-side enforcement of the app tier system defined in
 *  services/features.ts. It mirrors the client-side isAppAccessible() check
 *  in store/features.ts — the client paywall is advisory; this middleware is
 *  authoritative. Without it, a FREE user with a valid auth token could call
 *  paid-tier API routes directly (bypassing the client paywall overlay) and
 *  create/read/mutate data in paid-only apps. */
export function appTierGate(appId: string) {
  return async (c: Context, next: Next) => {
    const { userId } = c.get("auth");
    const allowed = await isAppAvailableFor(userId, appId);
    if (!allowed) {
      return c.json(
        {
          error: `This feature requires a higher subscription tier. Upgrade in Settings → Tiers to access ${appId}.`,
          code: "TIER_LOCKED",
          appId,
        },
        402
      );
    }
    await next();
  };
}
