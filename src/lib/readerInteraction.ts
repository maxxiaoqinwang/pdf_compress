import type { ReadingMode } from "./storage";

type PageClickInput = {
  readingMode: ReadingMode;
  clientX: number;
  boundsLeft: number;
  boundsWidth: number;
};

export type PageClickDirection = "prev" | "next";

type TapGestureInput = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  maxDistance?: number;
};

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

export function isTapGesture({
  startX,
  startY,
  endX,
  endY,
  maxDistance = 12
}: TapGestureInput): boolean {
  return Math.hypot(endX - startX, endY - startY) <= maxDistance;
}

export function getImageScaleStylesheet(imageScale: number): string {
  const scale = Math.min(250, Math.max(100, Math.round(imageScale)));
  const cursor = scale > 100 ? "grab" : "auto";

  return `
      html, body {
        overflow: auto !important;
        touch-action: pan-x pan-y !important;
      }
      img {
        display: block !important;
        max-width: none !important;
        width: ${scale}% !important;
        height: auto !important;
        margin-right: auto !important;
        margin-left: auto !important;
        cursor: ${cursor} !important;
        user-select: none !important;
        -webkit-user-drag: none !important;
        touch-action: pan-x pan-y !important;
      }
      html.reader-image-page {
        width: var(--reader-fixed-layout-width, ${scale}%) !important;
        max-width: none !important;
        height: auto !important;
        min-height: 100% !important;
        overflow: auto !important;
      }
      html.reader-image-page body {
        display: block !important;
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        min-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      html.reader-image-page img {
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        object-fit: contain !important;
        margin: 0 !important;
      }
    `;
}

export function getScaledFixedLayoutWidth(
  viewportContent: string | null | undefined,
  imageNaturalWidth: number | null | undefined,
  imageScale: number
): number | null {
  const scale = Math.min(250, Math.max(100, Math.round(imageScale)));
  const viewportWidth = readViewportWidth(viewportContent);
  const baseWidth = viewportWidth ?? readPositiveNumber(imageNaturalWidth);

  return baseWidth === null ? null : Math.round((baseWidth * scale) / 100);
}

export function getScrollImagePageViewHeight(
  readingMode: ReadingMode,
  isSingleImagePage: boolean,
  imageHeight: number
): number | null {
  if (readingMode !== "scroll" || !isSingleImagePage || !Number.isFinite(imageHeight) || imageHeight <= 0) {
    return null;
  }

  return Math.ceil(imageHeight);
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

function readViewportWidth(viewportContent: string | null | undefined): number | null {
  if (!viewportContent) {
    return null;
  }

  const widthMatch = viewportContent.match(/(?:^|[,\s])width\s*=\s*([0-9.]+)/i);
  if (!widthMatch) {
    return null;
  }

  return readPositiveNumber(Number(widthMatch[1]));
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
