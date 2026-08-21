import { describe, expect, it } from "vitest";
import {
  getCenteredScaledContentOffset,
  getEstimatedSingleImageHeight,
  getImageScaleStylesheet,
  getLocationSpineIndex,
  getPageImageFrameHeight,
  getPageSwipeAvailability,
  getPinchImageScale,
  getPageClickDirection,
  getProgressPercent,
  getScrollImagePageViewHeight,
  getScaledFixedLayoutWidth,
  getStableSingleImageHeight,
  getToolbarPageControls,
  getVerticalPageSwipeDirection,
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

  it("uses edge taps as viewport navigation in scrolling mode", () => {
    expect(
      getPageClickDirection({
        readingMode: "scroll",
        clientX: 380,
        boundsLeft: 20,
        boundsWidth: 400
      })
    ).toBe("next");
  });
});

describe("getVerticalPageSwipeDirection", () => {
  it("uses an upward swipe for next and a downward swipe for previous", () => {
    expect(
      getVerticalPageSwipeDirection({
        startX: 195,
        startY: 620,
        endX: 198,
        endY: 480,
        viewportHeight: 700
      })
    ).toBe("next");
    expect(
      getVerticalPageSwipeDirection({
        startX: 195,
        startY: 260,
        endX: 192,
        endY: 410,
        viewportHeight: 700
      })
    ).toBe("prev");
  });

  it("ignores short, mainly horizontal, and scrolling-mode gestures", () => {
    expect(
      getVerticalPageSwipeDirection({
        startX: 195,
        startY: 620,
        endX: 198,
        endY: 570,
        viewportHeight: 700
      })
    ).toBeNull();
    expect(
      getVerticalPageSwipeDirection({
        startX: 80,
        startY: 500,
        endX: 250,
        endY: 400,
        viewportHeight: 700
      })
    ).toBeNull();
    expect(
      getVerticalPageSwipeDirection({
        readingMode: "scroll",
        startX: 195,
        startY: 620,
        endX: 195,
        endY: 450,
        viewportHeight: 700
      })
    ).toBeNull();
  });

  it("honors the page-edge permissions captured at touch start", () => {
    const upwardSwipe = {
      startX: 195,
      startY: 620,
      endX: 195,
      endY: 460,
      viewportHeight: 700
    };
    const downwardSwipe = {
      startX: 195,
      startY: 260,
      endX: 195,
      endY: 420,
      viewportHeight: 700
    };

    expect(getVerticalPageSwipeDirection({ ...upwardSwipe, allowNext: false })).toBeNull();
    expect(getVerticalPageSwipeDirection({ ...upwardSwipe, allowNext: true })).toBe("next");
    expect(getVerticalPageSwipeDirection({ ...downwardSwipe, allowPrev: false })).toBeNull();
    expect(getVerticalPageSwipeDirection({ ...downwardSwipe, allowPrev: true })).toBe("prev");
  });
});

describe("getPageSwipeAvailability", () => {
  it("allows both directions when the visual image fits in the viewport", () => {
    expect(
      getPageSwipeAvailability({
        contentTop: 0,
        contentBottom: 551,
        viewportHeight: 844
      })
    ).toEqual({ prev: true, next: true, scrollable: false });
  });

  it("requires a fresh swipe from the matching edge for a tall or zoomed image", () => {
    expect(
      getPageSwipeAvailability({
        contentTop: 0,
        contentBottom: 1101,
        viewportHeight: 844
      })
    ).toEqual({ prev: true, next: false, scrollable: true });
    expect(
      getPageSwipeAvailability({
        contentTop: -130,
        contentBottom: 971,
        viewportHeight: 844
      })
    ).toEqual({ prev: false, next: false, scrollable: true });
    expect(
      getPageSwipeAvailability({
        contentTop: -257,
        contentBottom: 844,
        viewportHeight: 844
      })
    ).toEqual({ prev: false, next: true, scrollable: true });
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
  it("scales image-only documents without affecting text chapters", () => {
    const stylesheet = getImageScaleStylesheet(175);

    expect(stylesheet).toContain("html.reader-image-document");
    expect(stylesheet).toContain("width: var(--reader-fixed-layout-width, 175%)");
    expect(stylesheet).toContain("margin-left: auto !important");
    expect(stylesheet).toContain("background: #000 !important");
    expect(stylesheet).toContain("justify-content: center !important");
    expect(stylesheet).toContain("html.reader-image-document img");
    expect(stylesheet).toContain("width: 100% !important");
    expect(stylesheet).toContain("margin: 0 auto !important");
    expect(stylesheet).not.toMatch(/(^|\n)\s*html, body/);
    expect(stylesheet).not.toMatch(/(^|\n)\s*img\s*\{/);
  });
});

describe("getEstimatedSingleImageHeight", () => {
  it("uses fixed-layout viewport ratio before the image has decoded", () => {
    expect(
      getEstimatedSingleImageHeight({
        viewportContent: "width=1200,height=1800",
        frameWidth: 400
      })
    ).toBe(600);
  });

  it("uses image dimensions and zoom when viewport metadata is absent", () => {
    expect(
      getEstimatedSingleImageHeight({
        naturalWidth: 1000,
        naturalHeight: 1500,
        frameWidth: 400,
        imageScale: 150
      })
    ).toBe(900);
  });

  it("keeps a non-zero fallback for undecoded image pages", () => {
    expect(
      getEstimatedSingleImageHeight({
        frameWidth: 0,
        fallbackHeight: 812.2
      })
    ).toBe(813);
  });
});

describe("getStableSingleImageHeight", () => {
  it("prefers the width-fit estimate when epub.js has already shrunk a long image by height", () => {
    expect(
      getStableSingleImageHeight({
        measuredHeight: 844,
        estimatedHeight: 2275,
        fallbackHeight: 844
      })
    ).toBe(2275);
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

describe("getCenteredScaledContentOffset", () => {
  it("centers a scaled fixed-layout canvas in the visible iframe space", () => {
    expect(
      getCenteredScaledContentOffset({
        viewportWidth: 778,
        visualWidth: 576
      })
    ).toBe(101);
  });

  it("does not offset content that already fills the viewport", () => {
    expect(
      getCenteredScaledContentOffset({
        viewportWidth: 390,
        visualWidth: 390
      })
    ).toBe(0);
  });
});

describe("single-image frame sizing", () => {
  it("uses the enlarged image height only for single-image scroll pages", () => {
    expect(getScrollImagePageViewHeight("scroll", true, 804.4)).toBe(805);
    expect(getScrollImagePageViewHeight("scroll", false, 804.4)).toBeNull();
  });

  it("uses at least the visible page height for single-image paginated pages", () => {
    expect(getPageImageFrameHeight("page", true, 814.2, 3200.4)).toBe(3201);
    expect(getPageImageFrameHeight("page", true, 814.2, 600.1)).toBe(815);
    expect(getPageImageFrameHeight("page", false, 814.2)).toBeNull();
  });

  it("uses the estimated image height when epub.js reports a zero-height page during a turn", () => {
    expect(getPageImageFrameHeight("page", true, 0, 2059.1)).toBe(2060);
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
