import { afterEach, describe, expect, test } from "bun:test";
import { isContentFlagged } from "./llm-safety";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("LLM safety moderation", () => {
  test("returns the provider moderation decision", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ results: [{ flagged: true }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await isContentFlagged("key", "input")).toBe(true);
  });

  test("fails closed when moderation is unavailable", async () => {
    globalThis.fetch = (async () => new Response("error", { status: 503 })) as unknown as typeof fetch;
    expect(isContentFlagged("key", "input")).rejects.toThrow("SAFETY_CHECK_UNAVAILABLE");
  });
});
