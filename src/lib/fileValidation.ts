export type SelectedFileAction =
  | { ok: true; action: "reader" }
  | { ok: true; action: "download" }
  | { ok: false; message: string };

const EPUB_MIME_TYPES = new Set(["application/epub+zip"]);
const EPUB_COMPATIBLE_EXTENSIONS = [".epub", ".tks"];
const PDF_MIME_TYPES = new Set(["application/pdf"]);

export function getSelectedFileAction(file: File | null | undefined): SelectedFileAction {
  if (!file) {
    return { ok: false, message: "请选择一个文件。" };
  }

  const lowerName = file.name.toLowerCase();
  if (
    EPUB_COMPATIBLE_EXTENSIONS.some((extension) => lowerName.endsWith(extension)) ||
    EPUB_MIME_TYPES.has(file.type.toLowerCase())
  ) {
    return { ok: true, action: "reader" };
  }

  if (lowerName.endsWith(".pdf") || PDF_MIME_TYPES.has(file.type.toLowerCase())) {
    return { ok: true, action: "download" };
  }

  return { ok: false, message: "暂时无法处理这个文件。" };
}
