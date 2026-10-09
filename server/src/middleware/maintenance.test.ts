import { describe, expect, it } from "bun:test";
import { isMaintenanceExempt } from "./maintenance";

describe("maintenance middleware exclusions", () => {
  it("keeps infrastructure and browser preflight available", () => {
    expect(isMaintenanceExempt("/health", "GET")).toBe(true);
    expect(isMaintenanceExempt("/api/tasks", "OPTIONS")).toBe(true);
  });

  it("keeps status, management, and admin sign-in routes available", () => {
    expect(isMaintenanceExempt("/api/maintenance/status", "GET")).toBe(true);
    expect(isMaintenanceExempt("/api/maintenance/admin", "PUT")).toBe(true);
    expect(isMaintenanceExempt("/api/auth/login", "POST")).toBe(true);
    expect(isMaintenanceExempt("/api/auth/login/totp", "POST")).toBe(true);
    expect(isMaintenanceExempt("/api/auth/refresh", "POST")).toBe(true);
    expect(isMaintenanceExempt("/api/auth/password", "POST")).toBe(true);
    expect(isMaintenanceExempt("/api/auth/reset-password", "POST")).toBe(true);
    expect(isMaintenanceExempt("/api/auth/me", "GET")).toBe(true);
  });

  it("does not exempt normal application or auth mutation routes", () => {
    expect(isMaintenanceExempt("/api/tasks", "GET")).toBe(false);
    expect(isMaintenanceExempt("/api/files/abc", "GET")).toBe(false);
    expect(isMaintenanceExempt("/api/auth/profile", "PATCH")).toBe(false);
    expect(isMaintenanceExempt("/api/auth/demo", "POST")).toBe(false);
  });
});
