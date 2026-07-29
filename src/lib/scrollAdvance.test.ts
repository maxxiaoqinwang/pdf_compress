import { describe, expect, it, vi } from "vitest";
import { advanceContinuousScroll, isNearScrollEnd, primeContinuousScroll } from "./scrollAdvance";

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
    expect(calls).toEqual([[0, 1600]]);
  });

  it("reports unsupported when the rendition has no continuous manager check hook", async () => {
    await expect(primeContinuousScroll({})).resolves.toBe(false);
  });

  it("treats a busy continuous manager as unsupported instead of throwing", async () => {
    await expect(
      primeContinuousScroll({
        manager: {
          check() {
            return Promise.reject(new Error("manager is busy"));
          }
        }
      })
    ).resolves.toBe(false);
  });
});

describe("advanceContinuousScroll", () => {
  it("moves almost one viewport forward and primes nearby content", async () => {
    const scrollTo = vi.fn();
    const check = vi.fn(async () => undefined);
    const rendition = {
      manager: {
        container: {
          scrollTop: 200,
          clientHeight: 800,
          scrollHeight: 3000,
          scrollTo
        },
        check
      }
    };

    await expect(advanceContinuousScroll(rendition, "next")).resolves.toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 904, behavior: "smooth" });
    expect(check).toHaveBeenCalledWith(0, 1600);
  });

  it("moves backward and falls back to assigning scrollTop", async () => {
    const container = {
      scrollTop: 900,
      clientHeight: 500,
      scrollHeight: 3000
    };

    await expect(
      advanceContinuousScroll({ manager: { container } }, "prev")
    ).resolves.toBe(true);
    expect(container.scrollTop).toBe(460);
  });

  it("returns false at the beginning or end of the scrolling document", async () => {
    await expect(
      advanceContinuousScroll(
        { manager: { container: { scrollTop: 0, clientHeight: 800, scrollHeight: 2400 } } },
        "prev"
      )
    ).resolves.toBe(false);

    await expect(
      advanceContinuousScroll(
        { manager: { container: { scrollTop: 1600, clientHeight: 800, scrollHeight: 2400 } } },
        "next"
      )
    ).resolves.toBe(false);
  });
});
