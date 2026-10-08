import type { Page } from "@playwright/test";

export async function mockAuthenticatedSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("athena.token", "e2e-access-token");
    localStorage.setItem("athena.settings", JSON.stringify({ onboardedUserIds: ["e2e-user"] }));
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const respond = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname === "/api/auth/me") {
      return respond({
        id: "e2e-user",
        username: "e2e",
        displayName: "E2E User",
        avatarColor: "#3b82f6",
        role: "ADMIN",
        passwordMustChange: false,
        ageBand: "AGE_18_PLUS",
        guardianConsentStatus: "NOT_REQUIRED",
        aiSource: "hosted",
      });
    }
    if (url.pathname === "/api/features") return respond({ subscriptionTier: "pro", disabledApps: [], appTiers: {} });
    if (url.pathname === "/api/plugins/installed") return respond({ plugins: [] });
    if (url.pathname === "/api/settings/language") return respond({ language: "en" });
    if (url.pathname === "/api/maintenance/status") {
      return respond({ enabled: false, active: false, scheduled: false, startsAt: null, endsAt: null, message: "", serverTime: new Date().toISOString(), retryAfterSeconds: null });
    }
    if (url.pathname === "/api/notifications") return respond({ notifications: [] });
    if (url.pathname === "/api/notifications/unread-count") return respond({ count: 0 });
    return respond({ ok: true });
  });
}

export async function reachShell(page: Page) {
  await mockAuthenticatedSession(page);
  await page.goto("/");
}
