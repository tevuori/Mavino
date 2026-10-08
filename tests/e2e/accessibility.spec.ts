import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function reachLogin(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByPlaceholder("Username")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
}

test("login has no serious accessibility violations", async ({ page }) => {
  await reachLogin(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("login supports keyboard navigation and visible focus", async ({ page }) => {
  await reachLogin(page);
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus-visible");
  await expect(focused).toBeVisible();
});

test("login remains usable with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await reachLogin(page);
  await expect(page.getByPlaceholder("Username")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
});
