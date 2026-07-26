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
      theme: "paper"
    });
  });

  it("saves and loads the current reader state", () => {
    saveReaderState({
      cfi: "epubcfi(/6/2!/4/2/2)",
      fontScale: 120,
      theme: "night"
    });

    expect(loadReaderState()).toEqual({
      cfi: "epubcfi(/6/2!/4/2/2)",
      fontScale: 120,
      theme: "night"
    });
  });

  it("falls back to defaults when stored data is invalid", () => {
    localStorage.setItem("epub-reader-state", "{broken");

    expect(loadReaderState()).toEqual({
      cfi: null,
      fontScale: 100,
      theme: "paper"
    });
  });
});
