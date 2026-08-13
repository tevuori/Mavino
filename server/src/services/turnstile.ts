// ===== Cloudflare Turnstile bot protection =====
//
// Verifies Turnstile tokens server-side via the Cloudflare siteverify API.
// When TURNSTILE_SECRET_KEY is not set, verification is skipped (development mode).
//
// Env vars:
//   TURNSTILE_SITE_KEY   — public site key (sent to the client for the widget)
//   TURNSTILE_SECRET_KEY — secret key (server-side verification only)

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function getTurnstileSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY ?? null;
}

export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY);
}

/**
 * Verify a Turnstile token with Cloudflare's siteverify API.
 * Returns true if the token is valid, false otherwise.
 * When TURNSTILE_SECRET_KEY is not set, returns true (development mode — no verification).
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteip?: string
): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // Development mode — Turnstile not configured, skip verification.
    return true;
  }

  if (!token) {
    return false;
  }

  try {
    const body = new URLSearchParams();
    body.append("secret", secretKey);
    body.append("response", token);
    if (remoteip) body.append("remoteip", remoteip);

    const resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = (await resp.json()) as { success: boolean; "error-codes"?: string[] };
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] Verification failed:", err);
    // Fail closed — if Cloudflare is unreachable, reject the request.
    return false;
  }
}
