import { describe, expect, it } from "vitest";
import {
  getImageScaleStylesheet,
  getPageClickDirection,
  getProgressPercent,
  getScaledFixedLayoutWidth,
  isTapGesture
} from "./readerInteraction";

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

describe("getImageScaleStylesheet", () => {
  it("scales fixed-layout single-image pages by enlarging the page container", () => {
    const stylesheet = getImageScaleStylesheet(175);

    expect(stylesheet).toContain("html.reader-image-page");
    expect(stylesheet).toContain("width: 175% !important");
    expect(stylesheet).toContain("html.reader-image-page img");
    expect(stylesheet).toContain("width: 100% !important");
  });
});

describe("getScaledFixedLayoutWidth", () => {
  it("scales from the fixed-layout viewport width instead of the iframe width", () => {
    expect(getScaledFixedLayoutWidth("width=1920,height=2560", undefined, 175)).toBe(3360);
  });

  it("falls back to the image natural width when viewport metadata has no width", () => {
    expect(getScaledFixedLayoutWidth("height=2560", 1200, 150)).toBe(1800);
  });
});

describe("isTapGesture", () => {
  it("treats small touch movement as a tap", () => {
    expect(isTapGesture({ startX: 100, startY: 200, endX: 106, endY: 205 })).toBe(true);
  });

  it("does not treat a drag as a tap", () => {
    expect(isTapGesture({ startX: 100, startY: 200, endX: 150, endY: 205 })).toBe(false);
  });
});
