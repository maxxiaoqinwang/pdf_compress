import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBookKey,
  loadBookProgress,
  loadReaderPreferences,
  saveBookProgress,
  saveReaderPreferences
} from "./storage";

describe("reader storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns separate defaults for preferences and book progress", () => {
    expect(loadReaderPreferences()).toEqual({
      fontScale: 100,
      gripMode: "right",
      imageScale: 100,
      lineHeight: 175,
      theme: "paper"
    });

    expect(loadBookProgress("book-a")).toEqual({
      cfi: null,
      percentage: null,
      readingMode: "page",
      updatedAt: 0
    });
  });

  it("saves global display preferences", () => {
    saveReaderPreferences({
      fontScale: 120,
      gripMode: "left",
      imageScale: 150,
      lineHeight: 190,
      theme: "night"
    });

    expect(loadReaderPreferences()).toEqual({
      fontScale: 120,
      gripMode: "left",
      imageScale: 150,
      lineHeight: 190,
      theme: "night"
    });
  });

  it("stores reading positions independently for each book", () => {
    saveBookProgress("book-a", {
      cfi: "epubcfi(/6/2!/4/2/2)",
      percentage: 42,
      readingMode: "page",
      updatedAt: 123
    });
    saveBookProgress("book-b", {
      cfi: "epubcfi(/8/2!/4/2/2)",
      percentage: 7,
      readingMode: "scroll",
      updatedAt: 456
    });

    expect(loadBookProgress("book-a")).toMatchObject({
      cfi: "epubcfi(/6/2!/4/2/2)",
      percentage: 42,
      readingMode: "page"
    });
    expect(loadBookProgress("book-b")).toMatchObject({
      cfi: "epubcfi(/8/2!/4/2/2)",
      percentage: 7,
      readingMode: "scroll"
    });
  });

  it("migrates legacy display preferences without applying an old CFI to a new book", () => {
    localStorage.setItem(
      "epub-reader-state",
      JSON.stringify({
        cfi: "epubcfi(/6/2!/4/2/2)",
        fontScale: 130,
        gripMode: "both",
        imageScale: 175,
        lineHeight: 200,
        readingMode: "page",
        theme: "night"
      })
    );

    expect(loadReaderPreferences()).toMatchObject({
      fontScale: 130,
      gripMode: "both",
      imageScale: 175,
      lineHeight: 200,
      theme: "night"
    });
    expect(loadBookProgress("new-book").cfi).toBeNull();
  });

  it("normalizes invalid values", () => {
    saveReaderPreferences({
      fontScale: 400,
      gripMode: "upside-down" as never,
      imageScale: 999,
      lineHeight: 20,
      theme: "paper"
    });
    saveBookProgress("book-a", {
      cfi: null,
      percentage: 500,
      readingMode: "sideways" as never,
      updatedAt: -1
    });

    expect(loadReaderPreferences()).toEqual({
      fontScale: 160,
      gripMode: "right",
      imageScale: 400,
      lineHeight: 140,
      theme: "paper"
    });
    expect(loadBookProgress("book-a")).toEqual({
      cfi: null,
      percentage: 100,
      readingMode: "page",
      updatedAt: 0
    });
  });

  it("keeps reading when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });

    expect(loadReaderPreferences().theme).toBe("paper");
    expect(() =>
      saveReaderPreferences({
        fontScale: 100,
        gripMode: "right",
        imageScale: 100,
        lineHeight: 175,
        theme: "paper"
      })
    ).not.toThrow();
  });

  it("creates a stable book key from file metadata", () => {
    const file = { name: "My Book.epub", size: 1234, lastModified: 9876 };
    expect(createBookKey(file)).toBe(createBookKey(file));
    expect(createBookKey(file)).not.toBe(
      createBookKey({ ...file, name: "Another Book.epub" })
    );
  });
});
