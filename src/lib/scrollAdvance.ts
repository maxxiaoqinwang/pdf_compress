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
