import { describe, expect, it } from "bun:test";
import { teachLaunchInput } from "./launch";

describe("teachLaunchInput", () => {
  it("creates the canonical Teach Me launch descriptor", () => {
    expect(teachLaunchInput()).toEqual({
      appId: "teach",
      title: "Teach Me",
      icon: "Presentation",
      payload: undefined,
    });
  });

  it("preserves session deep links", () => {
    expect(teachLaunchInput("session-1")).toEqual({
      appId: "teach",
      title: "Teach Me",
      icon: "Presentation",
      payload: { sessionId: "session-1" },
    });
  });
});
