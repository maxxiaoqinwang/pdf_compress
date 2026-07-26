import { describe, expect, it } from "vitest";
import { validateEpubFile } from "./fileValidation";

function makeFile(name: string, type = "") {
  return new File(["book"], name, { type });
}

describe("validateEpubFile", () => {
  it("accepts files with an epub extension", () => {
    expect(validateEpubFile(makeFile("novel.epub"))).toEqual({ ok: true });
  });

  it("accepts tks files as epub-compatible containers", () => {
    expect(validateEpubFile(makeFile("archive.tks"))).toEqual({ ok: true });
  });

  it("accepts files with the epub MIME type", () => {
    expect(validateEpubFile(makeFile("download", "application/epub+zip"))).toEqual({
      ok: true
    });
  });

  it("rejects a missing file", () => {
    expect(validateEpubFile(null)).toEqual({
      ok: false,
      message: "Choose an EPUB file first."
    });
  });

  it("rejects non-EPUB files", () => {
    expect(validateEpubFile(makeFile("notes.pdf", "application/pdf"))).toEqual({
      ok: false,
      message: "This does not look like an EPUB file."
    });
  });
});
