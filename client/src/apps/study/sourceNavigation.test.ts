import { describe, expect, it } from "bun:test";
import { positiveInteger, sourceNavigationFromAction, sourceNavigationFromCommand, sourceNavigationFromHistory, sourceNavigationHistoryPatch } from "./sourceNavigation";

describe("sourceNavigationFromAction", () => {
  it("reads navigation from a nested highlight", () => {
    expect(sourceNavigationFromAction({
      scrollToPage: 2,
      scrollToSlide: 3,
      highlight: { scrollToPage: 7, scrollToSlide: 8 },
    })).toEqual({ page: 7, slide: 8 });
  });

  it("falls back to top-level navigation", () => {
    expect(sourceNavigationFromAction({ scrollToPage: 4, scrollToSlide: 5, highlight: {} }))
      .toEqual({ page: 4, slide: 5 });
  });

  it("ignores malformed navigation values", () => {
    expect(sourceNavigationFromAction({
      scrollToPage: "4",
      scrollToSlide: 0,
      highlight: { scrollToPage: Number.NaN, scrollToSlide: 1.5 },
    })).toEqual({ page: undefined, slide: undefined });
  });

  it("falls back when nested navigation is malformed", () => {
    expect(sourceNavigationFromAction({ scrollToPage: 4, highlight: { scrollToPage: -1 } }))
      .toEqual({ page: 4, slide: undefined });
  });
});

describe("positiveInteger", () => {
  it("accepts only finite positive integers", () => {
    expect(positiveInteger(3)).toBe(3);
    for (const value of [undefined, null, "3", 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(positiveInteger(value)).toBeUndefined();
    }
  });
});

describe("sourceNavigationFromCommand", () => {
  it("reads valid command navigation", () => {
    expect(sourceNavigationFromCommand({ pageNumber: 3, slideNumber: 4 }))
      .toEqual({ page: 3, slide: 4 });
  });

  it("rejects malformed command navigation", () => {
    expect(sourceNavigationFromCommand({ pageNumber: Number.NaN, slideNumber: 2.5 }))
      .toEqual({ page: undefined, slide: undefined });
  });
});

describe("sourceNavigationFromHistory", () => {
  it("preserves stored PDF and PPTX navigation for speech-synced reopening", () => {
    expect(sourceNavigationFromHistory({ lastPage: 6, lastSlide: 9 }))
      .toEqual({ page: 6, slide: 9 });
  });

  it("rejects malformed stored navigation", () => {
    expect(sourceNavigationFromHistory({ lastPage: 0, lastSlide: 2.5 }))
      .toEqual({ page: undefined, slide: undefined });
  });
});

describe("sourceNavigationHistoryPatch", () => {
  it("stores only the active document navigation type", () => {
    expect(sourceNavigationHistoryPatch({ page: 4 }, false))
      .toEqual({ lastPage: 4, lastSlide: undefined });
    expect(sourceNavigationHistoryPatch({ slide: 7 }, false))
      .toEqual({ lastPage: undefined, lastSlide: 7 });
  });

  it("clears stale document navigation for text anchors", () => {
    expect(sourceNavigationHistoryPatch({}, true))
      .toEqual({ lastPage: undefined, lastSlide: undefined });
  });

  it("preserves navigation when an action has no new anchor", () => {
    expect(sourceNavigationHistoryPatch({}, false)).toEqual({});
  });
});
