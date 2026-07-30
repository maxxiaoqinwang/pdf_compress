import type { GripMode, ReadingMode } from "./storage";

type PageClickInput = {
  readingMode: ReadingMode;
  gripMode?: GripMode;
  clientX: number;
  boundsLeft: number;
  boundsWidth: number;
  edgeRatio?: number;
};

type VerticalPageSwipeInput = {
  readingMode?: ReadingMode;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  viewportHeight?: number;
  allowPrev?: boolean;
  allowNext?: boolean;
  minDistance?: number;
  maxDistance?: number;
  distanceRatio?: number;
  dominanceRatio?: number;
};

type PageSwipeBoundsInput = {
  contentTop: number;
  contentBottom: number;
  viewportHeight: number;
  tolerance?: number;
};

export type PageClickDirection = "prev" | "next";
export type ToolbarPageControl = {
  direction: PageClickDirection;
  label: string;
};
export type PageSwipeAvailability = {
  prev: boolean;
  next: boolean;
  scrollable: boolean;
};

type TapGestureInput = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  maxDistance?: number;
};

type TouchPointLike = {
  clientX: number;
  clientY: number;
};

type PinchImageScaleInput = {
  startScale: number;
  startDistance: number;
  currentDistance: number;
};

type EstimatedSingleImageHeightInput = {
  viewportContent?: string | null;
  naturalWidth?: number | null;
  naturalHeight?: number | null;
  attributeWidth?: number | null;
  attributeHeight?: number | null;
  frameWidth: number;
  imageScale?: number;
  fallbackHeight?: number;
};

export function getPageClickDirection({
  readingMode,
  gripMode = "right",
  clientX,
  boundsLeft,
  boundsWidth,
  edgeRatio = 0.2
}: PageClickInput): PageClickDirection | null {
  if ((readingMode !== "page" && readingMode !== "scroll") || boundsWidth <= 0) {
    return null;
  }

  const position = (clientX - boundsLeft) / boundsWidth;
  const side = position <= edgeRatio ? "left" : position >= 1 - edgeRatio ? "right" : null;
  if (!side) {
    return null;
  }

  if (gripMode === "left") {
    return side === "left" ? "next" : "prev";
  }

  return side === "left" ? "prev" : "next";
}

export function getVerticalPageSwipeDirection({
  readingMode = "page",
  startX,
  startY,
  endX,
  endY,
  viewportHeight = 0,
  allowPrev = true,
  allowNext = true,
  minDistance = 56,
  maxDistance = 96,
  distanceRatio = 0.12,
  dominanceRatio = 1.2
}: VerticalPageSwipeInput): PageClickDirection | null {
  if (readingMode !== "page") {
    return null;
  }

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const verticalDistance = Math.abs(deltaY);
  const horizontalDistance = Math.abs(deltaX);
  const safeViewportHeight =
    typeof viewportHeight === "number" && Number.isFinite(viewportHeight)
      ? Math.max(0, viewportHeight)
      : 0;
  const distanceThreshold = Math.min(
    Math.max(minDistance, maxDistance),
    Math.max(minDistance, safeViewportHeight * distanceRatio)
  );

  if (
    verticalDistance < distanceThreshold ||
    verticalDistance < horizontalDistance * dominanceRatio
  ) {
    return null;
  }

  const direction: PageClickDirection = deltaY < 0 ? "next" : "prev";
  if ((direction === "next" && !allowNext) || (direction === "prev" && !allowPrev)) {
    return null;
  }

  return direction;
}

export function getPageSwipeAvailability({
  contentTop,
  contentBottom,
  viewportHeight,
  tolerance = 4
}: PageSwipeBoundsInput): PageSwipeAvailability {
  const safeViewportHeight = finiteOrZero(viewportHeight);
  const safeTop = finiteOrZero(contentTop);
  const safeBottom = finiteOrZero(contentBottom);
  const safeTolerance = Math.max(0, finiteOrZero(tolerance));

  if (safeViewportHeight <= 0 || safeBottom <= safeTop) {
    return { prev: true, next: true, scrollable: false };
  }

  const contentHeight = safeBottom - safeTop;
  if (contentHeight <= safeViewportHeight + safeTolerance) {
    return { prev: true, next: true, scrollable: false };
  }

  return {
    prev: safeTop >= -safeTolerance,
    next: safeBottom <= safeViewportHeight + safeTolerance,
    scrollable: true
  };
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
  const scale = normalizeImageScale(imageScale);
  const cursor = scale > 100 ? "grab" : "auto";

  return `
      html.reader-image-document {
        width: var(--reader-fixed-layout-width, ${scale}%) !important;
        min-width: 100% !important;
        max-width: none !important;
        height: auto !important;
        min-height: 100% !important;
        overflow: auto !important;
        overscroll-behavior: contain !important;
        touch-action: pan-x pan-y !important;
      }
      html.reader-image-document body {
        display: block !important;
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        min-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        touch-action: pan-x pan-y !important;
      }
      html.reader-image-document img {
        display: block !important;
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        object-fit: contain !important;
        margin: 0 !important;
        cursor: ${cursor} !important;
        user-select: none !important;
        -webkit-user-drag: none !important;
        touch-action: pan-x pan-y !important;
      }
      html.reader-image-document svg {
        display: block !important;
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        margin: 0 !important;
        cursor: ${cursor} !important;
        user-select: none !important;
        touch-action: pan-x pan-y !important;
      }
      html.reader-image-document svg image {
        user-select: none !important;
        -webkit-user-drag: none !important;
        touch-action: pan-x pan-y !important;
      }
    `;
}

/**
 * Estimate a fixed-layout image page height before the image has decoded.
 * epub.js measures each continuous view while it is being added. Without a
 * non-zero placeholder, image-heavy books can look like a stack of 0px views
 * and the manager may try to load many spine items at once.
 */
export function getEstimatedSingleImageHeight({
  viewportContent,
  naturalWidth,
  naturalHeight,
  attributeWidth,
  attributeHeight,
  frameWidth,
  imageScale = 100,
  fallbackHeight = 0
}: EstimatedSingleImageHeightInput): number | null {
  const viewportSize = readViewportSize(viewportContent);
  const naturalSize = readSizePair(naturalWidth, naturalHeight);
  const attributeSize = readSizePair(attributeWidth, attributeHeight);
  const sourceSize = viewportSize ?? naturalSize ?? attributeSize;
  const usableFrameWidth = readPositiveNumber(frameWidth);
  const scale = normalizeImageScale(imageScale) / 100;

  if (sourceSize && usableFrameWidth !== null) {
    return Math.max(1, Math.ceil(usableFrameWidth * (sourceSize.height / sourceSize.width) * scale));
  }

  const safeFallback = readPositiveNumber(fallbackHeight);
  return safeFallback === null ? null : Math.ceil(safeFallback);
}

export function getScaledFixedLayoutWidth(
  viewportContent: string | null | undefined,
  imageNaturalWidth: number | null | undefined,
  imageScale: number
): number | null {
  const scale = normalizeImageScale(imageScale);
  const viewportWidth = readViewportWidth(viewportContent);
  const baseWidth = viewportWidth ?? readPositiveNumber(imageNaturalWidth);

  return baseWidth === null ? null : Math.round((baseWidth * scale) / 100);
}

export function getToolbarPageControls(gripMode: GripMode): ToolbarPageControl[] {
  if (gripMode === "left") {
    return [
      { direction: "next", label: "下一页" },
      { direction: "prev", label: "上一页" }
    ];
  }

  return [
    { direction: "prev", label: "上一页" },
    { direction: "next", label: "下一页" }
  ];
}

export function getTouchDistance(first: TouchPointLike, second: TouchPointLike): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

export function getPinchImageScale({
  startScale,
  startDistance,
  currentDistance
}: PinchImageScaleInput): number {
  if (!Number.isFinite(startDistance) || startDistance <= 0) {
    return normalizeImageScale(startScale);
  }

  return normalizeImageScale((startScale * currentDistance) / startDistance);
}

export function getScrollImagePageViewHeight(
  readingMode: ReadingMode,
  isSingleImagePage: boolean,
  imageHeight: number
): number | null {
  if (
    readingMode !== "scroll" ||
    !isSingleImagePage ||
    !Number.isFinite(imageHeight) ||
    imageHeight <= 0
  ) {
    return null;
  }

  return Math.ceil(imageHeight);
}

export function getPageImageFrameHeight(
  readingMode: ReadingMode,
  isSingleImagePage: boolean,
  pageHeight: number
): number | null {
  if (
    readingMode !== "page" ||
    !isSingleImagePage ||
    !Number.isFinite(pageHeight) ||
    pageHeight <= 0
  ) {
    return null;
  }

  return Math.ceil(pageHeight);
}

export function getProgressPercent(location: unknown, spineItemCount?: number): number {
  const percentage = readPercentage(location);
  if (percentage !== null) {
    return Math.round(Math.min(1, Math.max(0, percentage)) * 100);
  }

  const spineIndex = getLocationSpineIndex(location);
  if (spineIndex === null || !spineItemCount || spineItemCount <= 0) {
    return 0;
  }

  return Math.round(Math.min(1, Math.max(0, spineIndex / spineItemCount)) * 100);
}

export function getLocationPercentage(location: unknown): number | null {
  return readPercentage(location);
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

export function getLocationSpineIndex(location: unknown): number | null {
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
  return readViewportDimension(viewportContent, "width");
}

function readViewportSize(
  viewportContent: string | null | undefined
): { width: number; height: number } | null {
  const width = readViewportDimension(viewportContent, "width");
  const height = readViewportDimension(viewportContent, "height");
  return readSizePair(width, height);
}

function readViewportDimension(
  viewportContent: string | null | undefined,
  dimension: "width" | "height"
): number | null {
  if (!viewportContent) {
    return null;
  }

  const match = viewportContent.match(
    new RegExp(`(?:^|[,]?\\s*)${dimension}\\s*=\\s*([0-9.]+)`, "i")
  );
  return match ? readPositiveNumber(Number(match[1])) : null;
}

function readSizePair(
  width: number | null | undefined,
  height: number | null | undefined
): { width: number; height: number } | null {
  const safeWidth = readPositiveNumber(width);
  const safeHeight = readPositiveNumber(height);
  return safeWidth === null || safeHeight === null
    ? null
    : { width: safeWidth, height: safeHeight };
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeImageScale(value: number): number {
  return Math.min(400, Math.max(100, Math.round(value)));
}
