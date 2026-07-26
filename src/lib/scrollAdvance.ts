type ScrollMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export function isNearScrollEnd(scroller: ScrollMetrics, threshold = 96): boolean {
  return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - threshold;
}

export function getNextSpineIndex(location: unknown): number | null {
  if (!location || typeof location !== "object") {
    return null;
  }

  const candidate = location as {
    index?: unknown;
    start?: {
      index?: unknown;
    };
  };

  const directIndex = candidate.index;
  if (typeof directIndex === "number") {
    return directIndex + 1;
  }

  const startIndex = candidate.start?.index;
  if (typeof startIndex === "number") {
    return startIndex + 1;
  }

  return null;
}
