import { describe, expect, it } from "bun:test";
import { resolveAnchor, normalizeForMatch, buildNormalizedMap } from "./highlight-anchor";

const SRC = `The quick brown fox jumps over the lazy dog.
Mitochondria are the powerhouse of the cell.
In machine learning, gradient descent minimizes a loss function by moving
parameters in the direction of steepest descent.

Photosynthesis converts light energy into chemical energy stored in glucose.`;

describe("normalizeForMatch", () => {
  it("collapses whitespace, replaces smart quotes/dashes, lowercases", () => {
    expect(normalizeForMatch("  Hello   World  ")).toBe("hello world");
    expect(normalizeForMatch("it\u2019s \u201cquoted\u201d \u2014 dash")).toBe("it's \"quoted\" - dash");
  });
});

describe("buildNormalizedMap", () => {
  it("maps normalized indices back to original indices", () => {
    const src = "  A  B ";
    const { norm, map } = buildNormalizedMap(src);
    expect(norm).toBe("a b");
    // 'a' is original index 2, ' ' (collapsed) maps to first space index 3, 'b' to index 5
    expect(map).toEqual([2, 3, 5]);
  });
});

describe("resolveAnchor", () => {
  it("exact match returns verbatim text + offsets", () => {
    const r = resolveAnchor("the lazy dog", SRC);
    expect(r.exact).toBe(true);
    expect(r.score).toBe(1);
    expect(r.text).toBe("the lazy dog");
    expect(r.posStart).toBe(SRC.indexOf("the lazy dog"));
    expect(r.posEnd).toBe(SRC.indexOf("the lazy dog") + "the lazy dog".length);
  });

  it("exact match is case-insensitive and whitespace-flexible", () => {
    const r = resolveAnchor("THE LAZY   DOG", SRC);
    expect(r.exact).toBe(true);
    expect(r.text).toBe("the lazy dog");
  });

  it("handles smart quotes in the source (fuzzy match across quote chars)", () => {
    const r = resolveAnchor("it's quoted", "it\u2019s \u201cquoted\u201d here");
    expect(r.text).not.toBeNull();
    expect(r.score).toBeGreaterThanOrEqual(0.5);
    expect(r.text).toBe("it\u2019s \u201cquoted\u201d");
  });

  it("fuzzy match finds the right span when the phrase is paraphrased", () => {
    // Paraphrased: drops "the" and reorders slightly.
    const r = resolveAnchor("mitochondria are powerhouse of cell", SRC);
    expect(r.text).not.toBeNull();
    expect(r.exact).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(0.5);
    // The resolved verbatim span should be the original sentence.
    expect(r.text).toContain("Mitochondria are the powerhouse of the cell");
    expect(r.posStart).toBe(SRC.indexOf("Mitochondria"));
  });

  it("fuzzy match finds gradient descent span with extra words", () => {
    const r = resolveAnchor("gradient descent minimizes loss function", SRC);
    expect(r.text).not.toBeNull();
    expect(r.score).toBeGreaterThanOrEqual(0.5);
    expect(r.text).toContain("gradient descent minimizes a loss function");
  });

  it("returns null when nothing matches", () => {
    const r = resolveAnchor("quantum entanglement wormhole xyzzy", SRC);
    expect(r.text).toBeNull();
  });

  it("passes the phrase through when source text is unavailable", () => {
    const r = resolveAnchor("some phrase", undefined);
    expect(r.text).toBe("some phrase");
    expect(r.exact).toBe(false);
  });

  it("returns null for an empty phrase", () => {
    expect(resolveAnchor("   ", SRC).text).toBeNull();
  });

  it("offsets point at the exact verbatim slice", () => {
    const r = resolveAnchor("photosynthesis converts light energy", SRC);
    expect(r.text).not.toBeNull();
    expect(r.posStart).toBeGreaterThanOrEqual(0);
    expect(SRC.slice(r.posStart, r.posEnd)).toBe(r.text ?? "");
  });
});
