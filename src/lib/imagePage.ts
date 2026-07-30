export type ImagePageMedia = {
  sourceElement: Element;
  displayElement: Element;
  intrinsicWidth: number | null;
  intrinsicHeight: number | null;
};

export type ImagePageInfo = {
  isImageDocument: boolean;
  isSingleImagePage: boolean;
  media: ImagePageMedia | null;
};

type ImagePageDocument = Document & {
  __readerFixedLayoutZoomState?: {
    baseTransform: string;
    appliedTransform: string;
  };
};

/**
 * Detect image-dominant EPUB documents without assuming that the page uses a
 * plain HTML <img>. Comic EPUBs commonly wrap the page image in an SVG
 * <image>, and those pages need the same sizing and gesture treatment.
 */
export function getImagePageInfo(document: Document): ImagePageInfo {
  const body = document.body;
  if (!body) {
    return { isImageDocument: false, isSingleImagePage: false, media: null };
  }

  const mediaElements = Array.from(body.querySelectorAll("img, svg image"));
  const textProbe = body.cloneNode(true) as Element;
  textProbe
    .querySelectorAll("img, picture, source, svg, style, script, noscript")
    .forEach((element) => element.remove());
  const meaningfulText = textProbe.textContent?.replace(/\s+/g, "") ?? "";
  const isImageDocument =
    mediaElements.length > 0 && meaningfulText.length <= Math.max(48, mediaElements.length * 12);
  const isSingleImagePage = mediaElements.length === 1 && isImageDocument;

  return {
    isImageDocument,
    isSingleImagePage,
    media: isSingleImagePage ? createImagePageMedia(mediaElements[0]) : null
  };
}

/**
 * Apply image zoom without enlarging the fixed-layout document canvas.
 *
 * epub.js already scales a pre-paginated body from its source viewport (for
 * example 1088px) down to the iframe width (for example 390px). Enlarging the
 * root element to 1360px while leaving epub.js' body transform in place creates
 * a mostly-empty scroll canvas; Safari can preserve a scroll position inside
 * that empty area and the page appears white. Appending the reader zoom to the
 * existing body transform keeps the scrollable area equal to the visible image.
 */
export function applyImagePageScale(
  document: Document,
  pageInfo: ImagePageInfo,
  imageScale: number,
  fixedLayoutBook: boolean
): { fixedLayoutPage: boolean; changed: boolean } {
  const root = document.documentElement;
  const body = document.body;
  const previousScale = root.style.getPropertyValue("--reader-image-scale");
  const previousFixedLayout = root.classList.contains("reader-fixed-layout-page");
  const previousZoomed = root.classList.contains("reader-image-zoomed");
  const previousTransform = body?.style.transform ?? "";
  const scale = normalizeImageScale(imageScale);
  const fixedLayoutPage = Boolean(
    body &&
      pageInfo.isSingleImagePage &&
      (fixedLayoutBook || hasFixedLayoutBodyTransform(document, body))
  );

  root.style.setProperty("--reader-image-scale", `${scale}%`);
  root.classList.toggle("reader-fixed-layout-page", fixedLayoutPage);
  root.classList.toggle("reader-image-zoomed", scale > 100);

  if (!body) {
    return {
      fixedLayoutPage: false,
      changed:
        previousScale !== `${scale}%` || previousFixedLayout || previousZoomed !== (scale > 100)
    };
  }

  if (fixedLayoutPage) {
    applyFixedLayoutBodyZoom(document as ImagePageDocument, body, scale);
  } else {
    restoreFixedLayoutBodyTransform(document as ImagePageDocument, body);
  }

  return {
    fixedLayoutPage,
    changed:
      previousScale !== `${scale}%` ||
      previousFixedLayout !== fixedLayoutPage ||
      previousZoomed !== (scale > 100) ||
      previousTransform !== body.style.transform
  };
}

export function getImagePageDisplayHeight(media: ImagePageMedia): number {
  try {
    const height = media.displayElement.getBoundingClientRect().height;
    return Number.isFinite(height) && height > 0 ? height : 0;
  } catch {
    return 0;
  }
}

export function getImagePageLoadTarget(media: ImagePageMedia): Element {
  return media.sourceElement;
}

function applyFixedLayoutBodyZoom(
  document: ImagePageDocument,
  body: HTMLElement,
  imageScale: number
) {
  const currentTransform = readBodyTransform(document, body);
  let state = document.__readerFixedLayoutZoomState;

  // epub.js can recalculate its fit-to-frame transform after rotation or view
  // resizing. If the current transform no longer equals the value we applied,
  // treat it as the new unzoomed base instead of multiplying the old value.
  if (!state || currentTransform !== state.appliedTransform) {
    state = {
      baseTransform: currentTransform,
      appliedTransform: currentTransform
    };
    document.__readerFixedLayoutZoomState = state;
  }

  const zoom = imageScale / 100;
  const nextTransform =
    zoom === 1
      ? state.baseTransform
      : `${state.baseTransform ? `${state.baseTransform} ` : ""}scale(${formatScale(zoom)})`;

  body.style.transform = nextTransform;
  state.appliedTransform = body.style.transform;
}

function restoreFixedLayoutBodyTransform(document: ImagePageDocument, body: HTMLElement) {
  const state = document.__readerFixedLayoutZoomState;
  if (!state) {
    return;
  }

  if (readBodyTransform(document, body) === state.appliedTransform) {
    body.style.transform = state.baseTransform;
  }
  delete document.__readerFixedLayoutZoomState;
}

function readBodyTransform(document: Document, body: HTMLElement): string {
  const inlineTransform = body.style.transform.trim();
  if (inlineTransform) {
    return inlineTransform;
  }

  try {
    const computedTransform = document.defaultView?.getComputedStyle(body).transform;
    return computedTransform && computedTransform !== "none" ? computedTransform : "";
  } catch {
    return "";
  }
}

function hasFixedLayoutBodyTransform(document: Document, body: HTMLElement): boolean {
  return readBodyTransform(document, body).length > 0;
}

function createImagePageMedia(sourceElement: Element): ImagePageMedia {
  if (sourceElement.localName.toLowerCase() === "img") {
    const image = sourceElement as HTMLImageElement;
    const intrinsicWidth = readPositiveNumber(image.naturalWidth) ?? readLengthAttribute(image, "width");
    const intrinsicHeight =
      readPositiveNumber(image.naturalHeight) ?? readLengthAttribute(image, "height");

    return {
      sourceElement: image,
      displayElement: image,
      intrinsicWidth,
      intrinsicHeight
    };
  }

  const svgImage = sourceElement as SVGImageElement;
  const svg = findOwningSvg(svgImage);
  const viewBox = svg ? readSvgViewBox(svg) : null;
  const intrinsicWidth =
    viewBox?.width ??
    (svg ? readLengthAttribute(svg, "width") : null) ??
    readLengthAttribute(svgImage, "width");
  const intrinsicHeight =
    viewBox?.height ??
    (svg ? readLengthAttribute(svg, "height") : null) ??
    readLengthAttribute(svgImage, "height");

  return {
    sourceElement: svgImage,
    displayElement: svg ?? svgImage,
    intrinsicWidth,
    intrinsicHeight
  };
}

function findOwningSvg(element: Element): SVGSVGElement | null {
  let current: Element | null = element.parentElement;
  let outermostSvg: SVGSVGElement | null = null;

  while (current) {
    if (current.localName.toLowerCase() === "svg") {
      outermostSvg = current as SVGSVGElement;
    }
    current = current.parentElement;
  }

  return outermostSvg;
}

function readSvgViewBox(svg: SVGSVGElement): { width: number; height: number } | null {
  const rawViewBox = svg.getAttribute("viewBox");
  if (!rawViewBox) {
    return null;
  }

  const values = rawViewBox
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number(value));
  if (values.length !== 4) {
    return null;
  }

  const width = readPositiveNumber(values[2]);
  const height = readPositiveNumber(values[3]);
  return width !== null && height !== null ? { width, height } : null;
}

function readLengthAttribute(element: Element, name: string): number | null {
  const value = element.getAttribute(name)?.trim();
  if (!value || value.endsWith("%")) {
    return null;
  }

  const match = value.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(?:px)?$/i);
  return match ? readPositiveNumber(Number(match[1])) : null;
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeImageScale(value: number): number {
  return Math.min(400, Math.max(100, Math.round(value)));
}

function formatScale(value: number): string {
  return Number(value.toFixed(4)).toString();
}
