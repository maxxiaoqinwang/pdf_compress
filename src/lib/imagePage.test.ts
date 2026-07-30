import { describe, expect, it } from "vitest";
import { applyImagePageScale, getImagePageInfo } from "./imagePage";

function createDocument(bodyHtml: string): Document {
  const value = document.implementation.createHTMLDocument("image page");
  value.body.innerHTML = bodyHtml;
  return value;
}

describe("getImagePageInfo", () => {
  it("recognizes a plain single-image page", () => {
    const page = createDocument('<img src="page.jpg" width="1088" height="1536" />');
    const info = getImagePageInfo(page);

    expect(info.isImageDocument).toBe(true);
    expect(info.isSingleImagePage).toBe(true);
    expect(info.media?.sourceElement.localName).toBe("img");
    expect(info.media?.intrinsicWidth).toBe(1088);
    expect(info.media?.intrinsicHeight).toBe(1536);
  });

  it("recognizes an SVG-wrapped comic image and uses its viewBox", () => {
    const page = createDocument(`
      <svg viewBox="0 0 1200 1800" xmlns="http://www.w3.org/2000/svg">
        <image href="page.jpg" width="1200" height="1800" />
      </svg>
    `);
    const info = getImagePageInfo(page);

    expect(info.isImageDocument).toBe(true);
    expect(info.isSingleImagePage).toBe(true);
    expect(info.media?.sourceElement.localName).toBe("image");
    expect(info.media?.displayElement.localName).toBe("svg");
    expect(info.media?.intrinsicWidth).toBe(1200);
    expect(info.media?.intrinsicHeight).toBe(1800);
  });

  it("does not classify a normal illustrated text chapter as an image page", () => {
    const page = createDocument(`
      <h1>Chapter 1</h1>
      <p>This is a normal text chapter with an illustration and enough meaningful content.</p>
      <img src="illustration.jpg" />
    `);

    expect(getImagePageInfo(page).isImageDocument).toBe(false);
  });
});

describe("applyImagePageScale", () => {
  it("appends zoom to epub.js fixed-layout transform without enlarging the root canvas", () => {
    const page = createDocument('<img src="page.jpg" width="1088" height="1536" />');
    page.body.style.transform = "scale(0.35)";
    const info = getImagePageInfo(page);

    applyImagePageScale(page, info, 125, true);
    expect(page.body.style.transform).toBe("scale(0.35) scale(1.25)");
    expect(page.documentElement.style.getPropertyValue("--reader-image-scale")).toBe("125%");
    expect(page.documentElement.classList.contains("reader-fixed-layout-page")).toBe(true);

    applyImagePageScale(page, info, 200, true);
    expect(page.body.style.transform).toBe("scale(0.35) scale(2)");

    applyImagePageScale(page, info, 100, true);
    expect(page.body.style.transform).toBe("scale(0.35)");
  });

  it("recaptures a new epub.js fit transform after the iframe is resized", () => {
    const page = createDocument('<img src="page.jpg" width="1088" height="1536" />');
    page.body.style.transform = "scale(0.35)";
    const info = getImagePageInfo(page);

    applyImagePageScale(page, info, 150, true);
    page.body.style.transform = "scale(0.4)";
    applyImagePageScale(page, info, 150, true);

    expect(page.body.style.transform).toBe("scale(0.4) scale(1.5)");
  });
});
