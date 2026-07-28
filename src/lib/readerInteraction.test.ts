import { describe, expect, it } from "vitest";
import { getPageClickDirection, getProgressPercent } from "./readerInteraction";

describe("getPageClickDirection", () => {
  it("turns to the previous page when the left half is clicked in paginated mode", () => {
    expect(
      getPageClickDirection({
        readingMode: "page",
        clientX: 120,
        boundsLeft: 20,
        boundsWidth: 400
      })
    ).toBe("prev");
  });

  it("turns to the next page when the right half is clicked in paginated mode", () => {
    expect(
      getPageClickDirection({
        readingMode: "page",
        clientX: 330,
        boundsLeft: 20,
        boundsWidth: 400
      })
    ).toBe("next");
  });

  it("does not turn pages from clicks in scrolling mode", () => {
    expect(
      getPageClickDirection({
        readingMode: "scroll",
        clientX: 330,
        boundsLeft: 20,
        boundsWidth: 400
      })
    ).toBeNull();
  });
});

describe("getProgressPercent", () => {
  it("uses epub.js start percentage when available", () => {
    expect(getProgressPercent({ start: { percentage: 0.384 } })).toBe(38);
  });

  it("clamps progress into a 0-100 range", () => {
    expect(getProgressPercent({ start: { percentage: 1.8 } })).toBe(100);
    expect(getProgressPercent({ start: { percentage: -0.4 } })).toBe(0);
  });

  it("falls back to zero when progress cannot be read", () => {
    expect(getProgressPercent({ start: {} })).toBe(0);
  });

  it("falls back to spine index when percentage is unavailable", () => {
    expect(getProgressPercent({ start: { index: 4 } }, 20)).toBe(25);
  });
});
