import { describe, expect, it } from "vitest";
import { getNextSpineIndex, isNearScrollEnd } from "./scrollAdvance";

describe("isNearScrollEnd", () => {
  it("detects when a scroller is near the bottom", () => {
    expect(isNearScrollEnd({ scrollTop: 650, clientHeight: 300, scrollHeight: 980 }, 40)).toBe(
      true
    );
  });

  it("ignores scroll positions with more content below", () => {
    expect(isNearScrollEnd({ scrollTop: 200, clientHeight: 300, scrollHeight: 980 }, 40)).toBe(
      false
    );
  });
});

describe("getNextSpineIndex", () => {
  it("uses location.start.index from epub.js relocated events", () => {
    expect(getNextSpineIndex({ start: { index: 7 } })).toBe(8);
  });

  it("uses direct location.index when available", () => {
    expect(getNextSpineIndex({ index: 3 })).toBe(4);
  });

  it("returns null when no usable index is available", () => {
    expect(getNextSpineIndex({ start: {} })).toBeNull();
  });
});
