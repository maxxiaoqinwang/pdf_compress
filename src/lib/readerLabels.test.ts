import { describe, expect, it } from "vitest";
import { formatReadingModeLabel } from "./readerLabels";

describe("formatReadingModeLabel", () => {
  it("names the current scrolling mode clearly", () => {
    expect(formatReadingModeLabel("scroll")).toBe("模式：滚动");
  });

  it("names the current paginated mode clearly", () => {
    expect(formatReadingModeLabel("page")).toBe("模式：分页");
  });
});
