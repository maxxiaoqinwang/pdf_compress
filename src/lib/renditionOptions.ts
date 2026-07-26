import type { ReadingMode } from "./storage";

type ReaderRenditionOptions = {
  width: string;
  height: string;
  flow: "scrolled" | "paginated";
  manager: "continuous" | "default";
  spread: "none";
};

export function getRenditionOptions(readingMode: ReadingMode): ReaderRenditionOptions {
  return {
    width: "100%",
    height: "100%",
    flow: readingMode === "scroll" ? "scrolled" : "paginated",
    manager: readingMode === "scroll" ? "continuous" : "default",
    spread: "none"
  };
}
