import { beforeEach, describe, expect, it } from "vitest";
import { loadReaderState, saveReaderState } from "./storage";

describe("reader state storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when nothing has been saved", () => {
    expect(loadReaderState()).toEqual({
      cfi: null,
      fontScale: 100,
      gripMode: "right",
      imageScale: 100,
      lineHeight: 175,
      readingMode: "scroll",
      theme: "paper"
    });
  });

  it("saves and loads the current reader state", () => {
    saveReaderState({
      cfi: "epubcfi(/6/2!/4/2/2)",
      fontScale: 120,
      gripMode: "left",
      imageScale: 150,
      lineHeight: 190,
      readingMode: "page",
      theme: "night"
    });

    expect(loadReaderState()).toEqual({
      cfi: "epubcfi(/6/2!/4/2/2)",
      fontScale: 120,
      gripMode: "left",
      imageScale: 150,
      lineHeight: 190,
      readingMode: "page",
      theme: "night"
    });
  });

  it("falls back to defaults when stored data is invalid", () => {
    localStorage.setItem("epub-reader-state", "{broken");

    expect(loadReaderState()).toEqual({
      cfi: null,
      fontScale: 100,
      gripMode: "right",
      imageScale: 100,
      lineHeight: 175,
      readingMode: "scroll",
      theme: "paper"
    });
  });

  it("normalizes out-of-range display settings", () => {
    saveReaderState({
      cfi: null,
      fontScale: 400,
      gripMode: "upside-down" as never,
      imageScale: 999,
      lineHeight: 20,
      readingMode: "sideways" as never,
      theme: "paper"
    });

    expect(loadReaderState()).toEqual({
      cfi: null,
      fontScale: 160,
      gripMode: "right",
      imageScale: 400,
      lineHeight: 140,
      readingMode: "scroll",
      theme: "paper"
    });
  });
});
