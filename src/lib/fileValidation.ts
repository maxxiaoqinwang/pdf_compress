export type ValidationResult = { ok: true } | { ok: false; message: string };

const EPUB_MIME_TYPES = new Set(["application/epub+zip", "application/zip"]);
const EPUB_COMPATIBLE_EXTENSIONS = [".epub", ".tks"];

export function validateEpubFile(file: File | null | undefined): ValidationResult {
  if (!file) {
    return { ok: false, message: "Choose an EPUB file first." };
  }

  const lowerName = file.name.toLowerCase();
  if (
    EPUB_COMPATIBLE_EXTENSIONS.some((extension) => lowerName.endsWith(extension)) ||
    EPUB_MIME_TYPES.has(file.type)
  ) {
    return { ok: true };
  }

  return { ok: false, message: "This does not look like an EPUB file." };
}
