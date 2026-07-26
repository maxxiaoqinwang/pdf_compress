import type { ReadingMode } from "./storage";

type ReaderRenditionOptions = {
  width: string;
  height: string;
  flow: "scrolled" | "paginated";
  manager: "continuous" | "default";
  spread: "none";
  afterScrolledTimeout?: number;
};

export function getRenditionOptions(readingMode: ReadingMode): ReaderRenditionOptions {
  const scrollingOptions =
    readingMode === "scroll"
      ? {
          afterScrolledTimeout: 80
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
