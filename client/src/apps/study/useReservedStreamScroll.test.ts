import { describe, expect, it } from "bun:test";
import { distanceFromBottom, reservedStreamHeight, shouldFollowStream } from "./useReservedStreamScroll";

describe("reserved stream scroll calculations", () => {
  it("reserves the visible transcript height minus a compact gutter", () => {
    expect(reservedStreamHeight(600)).toBe(504);
    expect(reservedStreamHeight(140)).toBe(120);
    expect(reservedStreamHeight(0)).toBe(0);
    expect(reservedStreamHeight(Number.NaN)).toBe(0);
  });

  it("clamps overscrolled positions at the bottom", () => {
    expect(distanceFromBottom(1000, 700, 300)).toBe(0);
    expect(distanceFromBottom(1000, 740, 300)).toBe(0);
  });

  it("follows only while the reader remains near the bottom", () => {
    expect(shouldFollowStream(1000, 660, 300)).toBe(true);
    expect(shouldFollowStream(1000, 652, 300)).toBe(false);
  });
});
