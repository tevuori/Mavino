import { describe, expect, it } from "bun:test";

// Minimal DOM stubs — settings.ts touches localStorage + documentElement at import time.
const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear(),
};
(globalThis as Record<string, unknown>).document = {
  documentElement: {
    classList: { toggle: () => {} },
    style: { setProperty: () => {} },
  },
};

// Simulate the pre-fix bug state: the browser-global "hasOnboarded" flag was
// set by a previous account on this browser (or the demo flow). A brand-new
// account on the same browser must still see the onboarding tour.
storage.set("athena.settings", JSON.stringify({ hasOnboarded: true, theme: "light" }));

const { useSettings } = await import("./settings");

describe("onboarding flag (per-account)", () => {
  it("does not let a stale global hasOnboarded flag skip onboarding for a new account", () => {
    expect(useSettings.getState().onboardedUserIds).toEqual([]);
    // A new user ID is not onboarded even though the legacy flag was true.
    expect(useSettings.getState().onboardedUserIds.includes("new-user")).toBe(false);
  });

  it("marks only the given user as onboarded", () => {
    useSettings.getState().setOnboarded("user-a", true);
    expect(useSettings.getState().onboardedUserIds).toContain("user-a");
    expect(useSettings.getState().onboardedUserIds).not.toContain("user-b");
  });

  it("persists the onboarded list to localStorage", () => {
    const raw = storage.get("athena.settings");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.onboardedUserIds).toContain("user-a");
  });

  it("un-marks a user (Replay tour)", () => {
    useSettings.getState().setOnboarded("user-a", false);
    expect(useSettings.getState().onboardedUserIds).not.toContain("user-a");
  });
});
