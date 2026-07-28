import type { ReadingMode } from "./storage";

type PageClickInput = {
  readingMode: ReadingMode;
  clientX: number;
  boundsLeft: number;
  boundsWidth: number;
};

export type PageClickDirection = "prev" | "next";

export function getPageClickDirection({
  readingMode,
  clientX,
  boundsLeft,
  boundsWidth
}: PageClickInput): PageClickDirection | null {
  if (readingMode !== "page" || boundsWidth <= 0) {
    return null;
  }

  return clientX - boundsLeft < boundsWidth / 2 ? "prev" : "next";
}

export function getProgressPercent(location: unknown, spineItemCount?: number): number {
  const percentage = readPercentage(location);
  if (percentage !== null) {
    return Math.round(Math.min(1, Math.max(0, percentage)) * 100);
  }

  const spineIndex = readSpineIndex(location);
  if (spineIndex === null || !spineItemCount || spineItemCount <= 0) {
    return 0;
  }

  return Math.round(Math.min(1, Math.max(0, (spineIndex + 1) / spineItemCount)) * 100);
}

function readPercentage(location: unknown): number | null {
  if (!location || typeof location !== "object") {
    return null;
  }

  const candidate = location as {
    percentage?: unknown;
    start?: {
      percentage?: unknown;
    };
  };

  if (typeof candidate.start?.percentage === "number") {
    return candidate.start.percentage;
  }

  return typeof candidate.percentage === "number" ? candidate.percentage : null;
}

function readSpineIndex(location: unknown): number | null {
  if (!location || typeof location !== "object") {
    return null;
  }

  const candidate = location as {
    index?: unknown;
    start?: {
      index?: unknown;
    };
  };

  if (typeof candidate.start?.index === "number") {
    return candidate.start.index;
  }

  return typeof candidate.index === "number" ? candidate.index : null;
}
