import { describe, expect, it } from "vitest";
import {
  getImageScaleStylesheet,
  getPageImageFrameHeight,
  getPinchImageScale,
  getPageClickDirection,
  getProgressPercent,
  getScrollImagePageViewHeight,
  getScaledFixedLayoutWidth,
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

    expect(
      getPageClickDirection({
        readingMode: "page",
        gripMode: "left",
        clientX: 380,
        boundsLeft: 20,
        boundsWidth: 400
      })
    ).toBe("prev");
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

  it("allows pinch zoom up to 400 percent", () => {
    expect(getScaledFixedLayoutWidth("width=1920,height=2560", undefined, 400)).toBe(7680);
  });
});

describe("getScrollImagePageViewHeight", () => {
  it("uses the enlarged image height for single-image pages in scroll mode", () => {
    expect(getScrollImagePageViewHeight("scroll", true, 804.4)).toBe(805);
  });

  it("does not resize paginated or non-image pages", () => {
    expect(getScrollImagePageViewHeight("page", true, 804.4)).toBeNull();
    expect(getScrollImagePageViewHeight("scroll", false, 804.4)).toBeNull();
  });
});

describe("getPageImageFrameHeight", () => {
  it("uses the visible page height for single-image pages in paginated mode", () => {
    expect(getPageImageFrameHeight("page", true, 814.2)).toBe(815);
  });

  it("does not force frame height outside paginated single-image pages", () => {
    expect(getPageImageFrameHeight("scroll", true, 814.2)).toBeNull();
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
      { direction: "next", label: "下章" },
      { direction: "prev", label: "上章" }
    ]);
  });

  it("keeps previous page on the left in right-hand and both-hand modes", () => {
    expect(getToolbarPageControls("right")).toEqual([
      { direction: "prev", label: "上章" },
      { direction: "next", label: "下章" }
    ]);
    expect(getToolbarPageControls("both")).toEqual([
      { direction: "prev", label: "上章" },
      { direction: "next", label: "下章" }
    ]);
  });
});

describe("getTouchDistance", () => {
  it("measures the distance between two touches", () => {
    expect(getTouchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
  });
});

describe("getPinchImageScale", () => {
  it("scales image size by the pinch distance ratio", () => {
    expect(getPinchImageScale({ startScale: 150, startDistance: 100, currentDistance: 200 })).toBe(300);
  });

  it("clamps pinch image scale to a 100-400 range", () => {
    expect(getPinchImageScale({ startScale: 150, startDistance: 10, currentDistance: 100 })).toBe(400);
    expect(getPinchImageScale({ startScale: 150, startDistance: 100, currentDistance: 10 })).toBe(100);
  });
});
