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

  it("does not accept an arbitrary zip file as an epub", () => {
    expect(getSelectedFileAction(makeFile("archive.zip", "application/zip"))).toEqual({
      ok: false,
      message: "暂时无法处理这个文件。"
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
      message: "请选择一个文件。"
    });
  });

  it("rejects unsupported files", () => {
    expect(getSelectedFileAction(makeFile("notes.txt", "text/plain"))).toEqual({
      ok: false,
      message: "暂时无法处理这个文件。"
    });
  });
});
