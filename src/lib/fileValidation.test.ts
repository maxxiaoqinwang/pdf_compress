import { describe, expect, it } from "vitest";
import { getSelectedFileAction } from "./fileValidation";

function makeFile(name: string, type = "") {
  return new File(["book"], name, { type });
}

describe("getSelectedFileAction", () => {
  it("routes files with an epub extension to the reader", () => {
    expect(getSelectedFileAction(makeFile("novel.epub"))).toEqual({
      ok: true,
      action: "reader"
    });
  });

  it("routes tks files to the reader", () => {
    expect(getSelectedFileAction(makeFile("archive.tks"))).toEqual({
      ok: true,
      action: "reader"
    });
  });

  it("routes files with the epub MIME type to the reader", () => {
    expect(getSelectedFileAction(makeFile("download", "application/epub+zip"))).toEqual({
      ok: true,
      action: "reader"
    });
  });

  it("routes pdf files to direct download", () => {
    expect(getSelectedFileAction(makeFile("report.pdf", "application/pdf"))).toEqual({
      ok: true,
      action: "download"
    });
  });

  it("rejects a missing file", () => {
    expect(getSelectedFileAction(null)).toEqual({
      ok: false,
      message: "Select a file first."
    });
  });

  it("rejects unsupported files", () => {
    expect(getSelectedFileAction(makeFile("notes.txt", "text/plain"))).toEqual({
      ok: false,
      message: "Unable to process this file."
    });
  });
});
