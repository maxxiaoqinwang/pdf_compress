import type { ReadingMode } from "./storage";

type RenditionPerformanceOptions = {
  lowMemoryScroll?: boolean;
};

type ReaderRenditionOptions = {
  width: string;
  height: string;
  flow: "scrolled" | "paginated";
  manager: "continuous" | "default";
  spread: "none";
  afterScrolledTimeout?: number;
  offset?: number;
  offsetDelta?: number;
};

/**
 * epub.js' continuous manager normally preloads the neighbouring spine items.
 * That is useful for small books, but several decoded comic pages can exhaust a
 * mobile browser's memory. Low-memory mode uses a narrow look-ahead window so
 * epub.js appends sections near the viewport and trims older iframe views.
 */
export function getRenditionOptions(
  readingMode: ReadingMode,
  { lowMemoryScroll = false }: RenditionPerformanceOptions = {}
): ReaderRenditionOptions {
  const scrollingOptions =
    readingMode === "scroll"
      ? {
          afterScrolledTimeout: 100,
          ...(lowMemoryScroll
            ? {
                // Keep only a small look-ahead window. epub.js appends
                // sections near the viewport and trims older iframe views.
                offset: 240,
                offsetDelta: 0
              }
            : {})
        }
      : {};

  return {
    width: "100%",
    height: "100%",
    flow: readingMode === "scroll" ? "scrolled" : "paginated",
    manager: readingMode === "scroll" ? "continuous" : "default",
    spread: "none",
    ...scrollingOptions
  };
}
