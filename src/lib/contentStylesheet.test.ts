import type { Contents } from "epubjs";
import { describe, expect, it, vi } from "vitest";
import { applyContentStylesheet } from "./contentStylesheet";

function asContents(addStylesheetCss: (cssText: string, key: string) => unknown): Contents {
  return { addStylesheetCss } as unknown as Contents;
}

describe("applyContentStylesheet", () => {
  it("accepts epub.js' synchronous boolean return value", () => {
    const addStylesheetCss = vi.fn(() => true);

    expect(() =>
      applyContentStylesheet(asContents(addStylesheetCss), "img { width: 125%; }", "reader")
    ).not.toThrow();
    expect(addStylesheetCss).toHaveBeenCalledOnce();
  });

  it("absorbs rejected promise implementations", async () => {
    const addStylesheetCss = vi.fn(() => Promise.reject(new Error("detached iframe")));

    expect(() =>
      applyContentStylesheet(asContents(addStylesheetCss), "img { width: 125%; }", "reader")
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("absorbs synchronous errors from a removed iframe", () => {
    const addStylesheetCss = vi.fn(() => {
      throw new Error("document removed");
    });

    expect(() =>
      applyContentStylesheet(asContents(addStylesheetCss), "img { width: 125%; }", "reader")
    ).not.toThrow();
  });
});
