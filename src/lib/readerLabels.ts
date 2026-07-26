import type { ReadingMode } from "./storage";

export function formatReadingModeLabel(mode: ReadingMode): string {
  return mode === "scroll" ? "模式：滚动" : "模式：分页";
}
