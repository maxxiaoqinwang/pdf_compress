import { describe, expect, it } from "vitest";
import {
  getImageScaleStylesheet,
  getLocationSpineIndex,
  getPageImageFrameHeight,
  getPinchImageScale,
  getPageClickDirection,
  getProgressPercent,
  getScrollImagePageViewHeight,
  getScaledFixedLayoutWidth,
  getSwipeDirection,
  getToolbarPageControls,
  getTouchDistance,
  isTapGesture
} from "./readerInteraction";

describe("getPageClickDirection", () => {
  it("turns to the previous page when the left edge is tapped in default mode", () => {
    expect(
      getPageClickDirection({
        readingMode: "page",
        clientX: 80,
        boundsLeft: 20,
        boundsWidth: 400
      })
    ).toBe("prev");
  });

  it("turns to the next page when the right edge is tapped in default mode", () => {
    expect(
      getPageClickDirection({
        readingMode: "page",
        clientX: 380,
        boundsLeft: 20,
        boundsWidth: 400
      })
    ).toBe("next");
  });

  it("does not turn pages from the middle reading area", () => {
    expect(
      getPageClickDirection({
        readingMode: "page",
        clientX: 220,
        boundsLeft: 20,
        boundsWidth: 400
      })
    ).toBeNull();
  });

  it("puts next page on the left edge in left-hand mode", () => {
    expect(
      getPageClickDirection({
        readingMode: "page",
        gripMode: "left",
        clientX: 80,
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

describe("getSwipeDirection", () => {
  it("uses a left swipe for next and a right swipe for previous", () => {
    expect(getSwipeDirection({ startX: 300, startY: 200, endX: 220, endY: 205 })).toBe(
      "next"
    );
    expect(getSwipeDirection({ startX: 100, startY: 200, endX: 180, endY: 205 })).toBe(
      "prev"
    );
  });

  it("ignores short and mainly vertical gestures", () => {
    expect(getSwipeDirection({ startX: 100, startY: 200, endX: 130, endY: 205 })).toBeNull();
    expect(getSwipeDirection({ startX: 100, startY: 100, endX: 155, endY: 200 })).toBeNull();
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

  it("does not report the first chapter as already completed", () => {
    expect(getProgressPercent({ start: { index: 0 } }, 3)).toBe(0);
    expect(getProgressPercent({ start: { index: 4 } }, 20)).toBe(20);
    expect(getLocationSpineIndex({ start: { index: 4 } })).toBe(4);
  });
});

describe("getImageScaleStylesheet", () => {
  it("scales only fixed-layout single-image pages", () => {
    const stylesheet = getImageScaleStylesheet(175);

    expect(stylesheet).toContain("html.reader-image-page");
    expect(stylesheet).toContain("width: var(--reader-fixed-layout-width, 175%)");
    expect(stylesheet).toContain("html.reader-image-page img");
    expect(stylesheet).toContain("width: 100% !important");
    expect(stylesheet).not.toMatch(/(^|\n)\s*html, body/);
    expect(stylesheet).not.toMatch(/(^|\n)\s*img\s*\{/);
  });
});

describe("getScaledFixedLayoutWidth", () => {
  it("scales from the fixed-layout viewport width instead of the iframe width", () => {
    expect(getScaledFixedLayoutWidth("width=1920,height=2560", undefined, 175)).toBe(3360);
  });

  it("falls back to the image natural width when viewport metadata has no width", () => {
    expect(getScaledFixedLayoutWidth("height=2560", 1200, 150)).toBe(1800);
  });

  it("allows pinch zoom up to 400 percent", () => {
    expect(getScaledFixedLayoutWidth("width=1920,height=2560", undefined, 400)).toBe(7680);
  });
});

describe("single-image frame sizing", () => {
  it("uses the enlarged image height only for single-image scroll pages", () => {
    expect(getScrollImagePageViewHeight("scroll", true, 804.4)).toBe(805);
    expect(getScrollImagePageViewHeight("scroll", false, 804.4)).toBeNull();
  });

  it("uses the visible page height only for single-image paginated pages", () => {
    expect(getPageImageFrameHeight("page", true, 814.2)).toBe(815);
    expect(getPageImageFrameHeight("page", false, 814.2)).toBeNull();
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

describe("getToolbarPageControls", () => {
  it("puts next page near the left thumb in left-hand mode", () => {
    expect(getToolbarPageControls("left")).toEqual([
      { direction: "next", label: "下一页" },
      { direction: "prev", label: "上一页" }
    ]);
  });

  it("keeps previous page on the left in right-hand and both-hand modes", () => {
    expect(getToolbarPageControls("right")).toEqual([
      { direction: "prev", label: "上一页" },
      { direction: "next", label: "下一页" }
    ]);
  });
});

describe("touch helpers", () => {
  it("measures the distance between two touches", () => {
    expect(getTouchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
  });

  it("scales image size by the pinch distance ratio and clamps it", () => {
    expect(getPinchImageScale({ startScale: 150, startDistance: 100, currentDistance: 200 })).toBe(
      300
    );
    expect(getPinchImageScale({ startScale: 150, startDistance: 10, currentDistance: 100 })).toBe(
      400
    );
    expect(getPinchImageScale({ startScale: 150, startDistance: 100, currentDistance: 10 })).toBe(
      100
    );
  });
});
