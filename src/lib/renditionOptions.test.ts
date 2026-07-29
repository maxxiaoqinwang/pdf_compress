import { describe, expect, it } from "vitest";
import { getRenditionOptions } from "./renditionOptions";

describe("getRenditionOptions", () => {
  it("uses the continuous manager for scrolling across spine items", () => {
    expect(getRenditionOptions("scroll")).toMatchObject({
      flow: "scrolled",
      manager: "continuous",
      afterScrolledTimeout: 100,
      spread: "none"
    });
    expect(getRenditionOptions("scroll")).not.toHaveProperty("offset");
    expect(getRenditionOptions("scroll")).not.toHaveProperty("offsetDelta");
  });

  it("uses demand-driven continuous loading for large or fixed-layout books", () => {
    expect(getRenditionOptions("scroll", { lowMemoryScroll: true })).toMatchObject({
      flow: "scrolled",
      manager: "continuous",
      offset: 240,
      offsetDelta: 0
    });
  });

  it("uses the default paginated renderer for page mode", () => {
    expect(getRenditionOptions("page")).toMatchObject({
      flow: "paginated",
      manager: "default",
      spread: "none"
    });
  });
});
