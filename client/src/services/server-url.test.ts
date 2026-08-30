import { describe, expect, it } from "bun:test";
import { PLAY_SERVER_URL, resolveServerUrl } from "./server-url";

describe("resolveServerUrl", () => {
  it("uses relative API paths on web", () => {
    expect(resolveServerUrl(false, false, "https://custom.example")).toBe("");
    expect(resolveServerUrl(false, true, null)).toBe("");
  });

  it("hard-wires Play builds to the production server", () => {
    expect(resolveServerUrl(true, true, null)).toBe(PLAY_SERVER_URL);
    expect(resolveServerUrl(true, true, "https://custom.example")).toBe("https://mavino.net");
  });

  it("keeps configurable server URLs for standard native builds", () => {
    expect(resolveServerUrl(true, false, "http://192.168.1.100:3001///")).toBe(
      "http://192.168.1.100:3001"
    );
    expect(resolveServerUrl(true, false, null)).toBe("");
  });
});
