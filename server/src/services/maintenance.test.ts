import { describe, expect, it } from "bun:test";
import { evaluateMaintenance, parseMaintenanceConfig } from "./maintenance";

const now = new Date("2026-01-01T12:00:00.000Z");

describe("maintenance configuration", () => {
  it("falls back safely for missing or malformed values", () => {
    expect(parseMaintenanceConfig(null).enabled).toBe(false);
    expect(parseMaintenanceConfig("not-json").enabled).toBe(false);
  });

  it("normalizes persisted timestamps and messages", () => {
    const config = parseMaintenanceConfig(JSON.stringify({
      enabled: true,
      startsAt: "2026-01-01T13:00:00Z",
      endsAt: "invalid",
      message: "  Planned work  ",
    }));
    expect(config.startsAt).toBe("2026-01-01T13:00:00.000Z");
    expect(config.endsAt).toBe(null);
    expect(config.message).toBe("Planned work");
  });
});

describe("maintenance window evaluation", () => {
  it("is inactive when disabled", () => {
    const status = evaluateMaintenance({ enabled: false, startsAt: null, endsAt: null, message: "x" }, now);
    expect(status.active).toBe(false);
    expect(status.scheduled).toBe(false);
  });

  it("supports indefinite immediate maintenance", () => {
    const status = evaluateMaintenance({ enabled: true, startsAt: null, endsAt: null, message: "x" }, now);
    expect(status.active).toBe(true);
    expect(status.retryAfterSeconds).toBe(null);
  });

  it("reports a future window as scheduled", () => {
    const status = evaluateMaintenance({
      enabled: true,
      startsAt: "2026-01-01T13:00:00.000Z",
      endsAt: "2026-01-01T14:00:00.000Z",
      message: "x",
    }, now);
    expect(status.active).toBe(false);
    expect(status.scheduled).toBe(true);
  });

  it("activates a current window and calculates retry-after", () => {
    const status = evaluateMaintenance({
      enabled: true,
      startsAt: "2026-01-01T11:00:00.000Z",
      endsAt: "2026-01-01T12:01:30.000Z",
      message: "x",
    }, now);
    expect(status.active).toBe(true);
    expect(status.retryAfterSeconds).toBe(90);
  });

  it("automatically expires an elapsed window", () => {
    const status = evaluateMaintenance({
      enabled: true,
      startsAt: "2026-01-01T10:00:00.000Z",
      endsAt: "2026-01-01T11:00:00.000Z",
      message: "x",
    }, now);
    expect(status.active).toBe(false);
    expect(status.scheduled).toBe(false);
  });
});
