import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { reachShell } from "./helpers";

test("authenticated shell is keyboard reachable and accessible", async ({ page }, testInfo) => {
  await reachShell(page);

  if (testInfo.project.name === "desktop") {
    await expect(page.getByRole("button", { name: "Open application menu" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Open application menu" }).click();
    await expect(page.getByRole("dialog", { name: "Applications" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open application menu" })).toBeFocused();
  } else {
    await expect(page.getByRole("main", { name: "Mavino mobile" })).toBeVisible({ timeout: 10_000 });
  }

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("command palette traps and restores keyboard focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Command palette is a desktop workflow");
  await reachShell(page);

  const startButton = page.getByRole("button", { name: "Open application menu" });
  await expect(startButton).toBeVisible({ timeout: 10_000 });
  await startButton.focus();
  await expect(startButton).toBeFocused();
  await page.keyboard.press("Control+Space");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByPlaceholder(/Search apps/i)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(palette).not.toBeVisible();
  await expect(startButton).toBeFocused();
});

test("mobile launcher is searchable and accessible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Launcher coverage uses the mobile shell");
  await reachShell(page);

  await expect(page.getByRole("main", { name: "Mavino mobile" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("heading", { name: "Your tools" })).toBeVisible();
  await page.getByPlaceholder("Search apps").fill("Settings");
  await expect(page.getByRole("button", { name: /Settings/ })).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("desktop app windows expose controls and taskbar state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Window management is a desktop workflow");
  await reachShell(page);

  await page.getByRole("button", { name: "Open application menu" }).click();
  await page.getByRole("dialog", { name: "Applications" }).getByRole("button", { name: "Settings", exact: true }).click();

  const settingsWindow = page.getByRole("region", { name: "Settings window" });
  await expect(settingsWindow).toBeVisible();
  await expect(settingsWindow.getByRole("button", { name: "Close Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" }).last()).toBeVisible();

  await settingsWindow.getByRole("button", { name: "Close Settings" }).click();
  await expect(settingsWindow).not.toBeVisible();
});

test("quick capture is a labelled modal and restores focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Quick Capture shortcut is a desktop workflow");
  await reachShell(page);

  const startButton = page.getByRole("button", { name: "Open application menu" });
  await expect(startButton).toBeVisible({ timeout: 10_000 });
  await startButton.focus();
  await page.keyboard.press("Control+Shift+N");

  const capture = page.getByRole("dialog", { name: "Quick Capture" });
  await expect(capture).toBeVisible();
  await expect(capture.getByPlaceholder(/Type anything/i)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(capture).not.toBeVisible();
  await expect(startButton).toBeFocused();
});
