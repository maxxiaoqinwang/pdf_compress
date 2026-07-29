type ScrollMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export const SCROLL_PREFETCH_OFFSET = 1600;

export function isNearScrollEnd(scroller: ScrollMetrics, threshold = 96): boolean {
  return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - threshold;
}

type ContinuousManagerLike = {
  check?: (this: ContinuousManagerLike, offsetLeft: number, offsetTop: number) => Promise<unknown>;
};

type ContinuousRenditionLike = {
  manager?: ContinuousManagerLike;
};

export async function primeContinuousScroll(
  rendition: unknown,
  offsetTop = SCROLL_PREFETCH_OFFSET
): Promise<boolean> {
  const manager = (rendition as ContinuousRenditionLike).manager;
  if (!manager || typeof manager.check !== "function") {
    return false;
  }

  try {
    await manager.check.call(manager, 0, offsetTop);
    return true;
  } catch {
    return false;
  }
}

type ScrollDirection = "prev" | "next";

type ScrollContainerLike = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollTo?: (options: ScrollToOptions) => void;
};

type ScrollableRenditionLike = {
  manager?: {
    container?: ScrollContainerLike;
    check?: (offsetLeft?: number, offsetTop?: number) => Promise<unknown>;
  };
};

/**
 * Treat the left and right reading zones as viewport navigation in scroll mode.
 * This also works when a producer put hundreds of comic images in one XHTML
 * chapter, where rendition.next() cannot move between the individual images.
 */
export async function advanceContinuousScroll(
  rendition: unknown,
  direction: ScrollDirection
): Promise<boolean> {
  const manager = (rendition as ScrollableRenditionLike).manager;
  const scroller = manager?.container;
  if (!scroller || scroller.clientHeight <= 0) {
    return false;
  }

  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const delta = Math.max(240, Math.round(scroller.clientHeight * 0.88));
  const target = Math.min(
    maxScrollTop,
    Math.max(0, scroller.scrollTop + (direction === "next" ? delta : -delta))
  );
  if (Math.abs(target - scroller.scrollTop) < 2) {
    return false;
  }

  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: target, behavior: "smooth" });
  } else {
    scroller.scrollTop = target;
  }

  try {
    await manager?.check?.(0, SCROLL_PREFETCH_OFFSET);
  } catch {
    // The scroll itself succeeded; prefetch failure should not block navigation.
  }
  return true;
}
