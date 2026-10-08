import { expect, test } from "@playwright/test";
import { reachShell } from "./helpers";

test("login visual baseline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Username")).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveScreenshot("login-coastal.png", { animations: "disabled", maxDiffPixelRatio: 0.005 });
});

test("login light-theme visual baseline", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("athena.settings", JSON.stringify({ theme: "light", wallpaper: "ocean", accent: "#3b82f6" }));
  });
  await page.goto("/");
  await expect(page.getByPlaceholder("Username")).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveScreenshot("login-light.png", { animations: "disabled", maxDiffPixelRatio: 0.005 });
});

test("desktop shell visual baseline", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop shell baseline uses the desktop project");
  await reachShell(page);
  await expect(page.getByRole("button", { name: "Open application menu" })).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveScreenshot("desktop-shell.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.005,
    mask: [page.getByRole("region", { name: /Mavino tips/i }), page.getByRole("button", { name: "Open calendar and clock" })],
  });
});

test("command palette visual baseline", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Command palette is desktop-only");
  await reachShell(page);
  await expect(page.getByRole("button", { name: "Open application menu" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Control+Space");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(palette).toHaveScreenshot("command-palette.png", { animations: "disabled", maxDiffPixelRatio: 0.005 });
});

test("mobile launcher visual baseline", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Launcher baseline uses the mobile shell");
  await reachShell(page);
  await expect(page.getByRole("main", { name: "Mavino mobile" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("heading", { name: "Your tools" })).toBeVisible();
  await expect(page).toHaveScreenshot("mobile-launcher.png", { animations: "disabled", maxDiffPixelRatio: 0.005 });
});
