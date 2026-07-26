import { describe, expect, it } from "vitest";
import { isNearScrollEnd, primeContinuousScroll } from "./scrollAdvance";

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

describe("primeContinuousScroll", () => {
  it("asks epub.js continuous manager to append nearby sections without changing display target", async () => {
    const calls: Array<[number, number]> = [];

    const didPrime = await primeContinuousScroll({
      manager: {
        check(offsetLeft: number, offsetTop: number) {
          calls.push([offsetLeft, offsetTop]);
          return Promise.resolve();
        }
      }
    });

    expect(didPrime).toBe(true);
    expect(calls).toEqual([[0, 1200]]);
  });

  it("reports unsupported when the rendition has no continuous manager check hook", async () => {
    await expect(primeContinuousScroll({})).resolves.toBe(false);
  });
});
