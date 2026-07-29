import type { Book } from "epubjs";
import { readBlobAsArrayBuffer, readBlobAsText } from "./blobReader";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 22 + 0xffff + 20;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const ZIP64_EXTRA_ID = 0x0001;
const UNICODE_PATH_EXTRA_ID = 0x7075;

export type FileArchiveStage =
  | "reading-index"
  | "reading-book-structure"
  | "ready";

type ArchiveStatusListener = (stage: FileArchiveStage) => void;

type ZipEntry = {
  name: string;
  compressionMethod: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataOffset?: number;
};

type EpubBookInternals = {
  archive?: FileBackedEpubArchive;
  unarchive: (input: unknown, encoding?: string) => Promise<unknown>;
};

/**
 * Replace epub.js' JSZip archive with a Blob-slice based reader.
 *
 * JSZip's loadAsync(File) still reads the complete EPUB into JavaScript memory
 * before metadata can be shown. This reader only loads the ZIP central
 * directory first, then slices and inflates individual entries on demand.
 */
export function installFileBackedEpubArchive(
  book: Book,
  onStatus?: ArchiveStatusListener
): FileBackedEpubArchive {
  const internals = book as unknown as EpubBookInternals;
  const archive = new FileBackedEpubArchive(onStatus);

  internals.unarchive = async (input: unknown) => {
    if (!(input instanceof Blob)) {
      throw new Error("Large EPUB loading requires a File or Blob input.");
    }

    internals.archive = archive;
    await archive.open(input);
    return archive;
  };

  return archive;
}

export class FileBackedEpubArchive {
  private file: Blob | null = null;
  private readonly entries = new Map<string, ZipEntry>();
  private readonly urlCache = new Map<string, string>();
  private readonly onStatus?: ArchiveStatusListener;
  private destroyed = false;

  constructor(onStatus?: ArchiveStatusListener) {
    this.onStatus = onStatus;
  }

  async open(input: Blob): Promise<void> {
    this.destroyed = false;
    this.file = input;
    this.entries.clear();
    this.onStatus?.("reading-index");

    const directory = await readCentralDirectoryLocation(input);
    const centralDirectoryBuffer = await readBlobAsArrayBuffer(
      input.slice(directory.offset, directory.offset + directory.size)
    );
    this.parseCentralDirectory(
      new Uint8Array(centralDirectoryBuffer),
      directory.totalEntries
    );

    if (!this.entries.has("META-INF/container.xml")) {
      throw new Error("EPUB container.xml was not found in the archive.");
    }

    this.onStatus?.("reading-book-structure");
    this.onStatus?.("ready");
  }

  async request(url: string, type?: string): Promise<unknown> {
    const resolvedType = type || getExtension(url);
    if (resolvedType === "blob") {
      const blob = await this.getBlob(url);
      if (!blob) {
        throw missingEntryError(url);
      }
      return blob;
    }

    const text = await this.getText(url);
    if (text === undefined) {
      throw missingEntryError(url);
    }

    const normalizedType = resolvedType.toLowerCase();
    if (normalizedType === "json") {
      return JSON.parse(text);
    }

    if (normalizedType === "xhtml") {
      return new DOMParser().parseFromString(text, "application/xhtml+xml");
    }

    if (normalizedType === "html" || normalizedType === "htm") {
      return new DOMParser().parseFromString(text, "text/html");
    }

    if (
      normalizedType === "xml" ||
      normalizedType === "opf" ||
      normalizedType === "ncx" ||
      normalizedType === "svg"
    ) {
      return new DOMParser().parseFromString(text, "text/xml");
    }

    return text;
  }

  async getBlob(url: string, mimeType?: string): Promise<Blob> {
    const entry = this.getEntry(url);
    if (!entry) {
      throw missingEntryError(url);
    }
    if ((entry.flags & ENCRYPTED_FLAG) !== 0) {
      throw new Error(`Encrypted ZIP entries are not supported: ${entry.name}`);
    }

    const file = this.requireFile();
    const dataOffset = await this.getDataOffset(entry);
    const compressedBlob = file.slice(
      dataOffset,
      dataOffset + entry.compressedSize,
      mimeType || lookupMimeType(entry.name)
    );

    if (entry.compressionMethod === 0) {
      return compressedBlob;
    }

    if (entry.compressionMethod !== 8) {
      throw new Error(
        `Unsupported ZIP compression method ${entry.compressionMethod}: ${entry.name}`
      );
    }

    const inflated = await inflateDeflateRaw(compressedBlob);
    return inflated.slice(0, inflated.size, mimeType || lookupMimeType(entry.name));
  }

  async getText(url: string): Promise<string> {
    const blob = await this.getBlob(url, "text/plain;charset=utf-8");
    return readBlobAsText(blob);
  }

  async getBase64(url: string, mimeType?: string): Promise<string> {
    const blob = await this.getBlob(url, mimeType);
    const buffer = new Uint8Array(await readBlobAsArrayBuffer(blob));
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      binary += String.fromCharCode(...buffer.subarray(offset, offset + chunkSize));
    }
    return `data:${mimeType || blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
  }

  async createUrl(
    url: string,
    options?: { base64?: boolean }
  ): Promise<string> {
    const key = normalizeEntryPath(url);
    const cached = this.urlCache.get(key);
    if (cached) {
      return cached;
    }

    const created = options?.base64
      ? await this.getBase64(url)
      : URL.createObjectURL(await this.getBlob(url));
    this.urlCache.set(key, created);
    return created;
  }

  revokeUrl(url: string): void {
    const key = normalizeEntryPath(url);
    const cached = this.urlCache.get(key);
    if (!cached) {
      return;
    }

    if (cached.startsWith("blob:")) {
      URL.revokeObjectURL(cached);
    }
    this.urlCache.delete(key);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    for (const cached of this.urlCache.values()) {
      if (cached.startsWith("blob:")) {
        URL.revokeObjectURL(cached);
      }
    }
    this.urlCache.clear();
    this.entries.clear();
    this.file = null;
  }

  /** Exposed for focused tests and diagnostics. */
  getEntryCount(): number {
    return this.entries.size;
  }

  private parseCentralDirectory(bytes: Uint8Array, expectedEntries: number) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    let parsedEntries = 0;

    while (offset + 46 <= bytes.byteLength) {
      if (view.getUint32(offset, true) !== CENTRAL_FILE_HEADER_SIGNATURE) {
        break;
      }

      const flags = view.getUint16(offset + 8, true);
      const compressionMethod = view.getUint16(offset + 10, true);
      let compressedSize = view.getUint32(offset + 20, true);
      let uncompressedSize = view.getUint32(offset + 24, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      let localHeaderOffset = view.getUint32(offset + 42, true);
      const recordLength = 46 + fileNameLength + extraLength + commentLength;
      if (offset + recordLength > bytes.byteLength) {
        throw new Error("The EPUB ZIP central directory is truncated.");
      }

      const nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
      const extraBytes = bytes.subarray(
        offset + 46 + fileNameLength,
        offset + 46 + fileNameLength + extraLength
      );
      const zip64Values = readZip64Extra(
        extraBytes,
        uncompressedSize === 0xffffffff,
        compressedSize === 0xffffffff,
        localHeaderOffset === 0xffffffff
      );
      uncompressedSize = zip64Values.uncompressedSize ?? uncompressedSize;
      compressedSize = zip64Values.compressedSize ?? compressedSize;
      localHeaderOffset = zip64Values.localHeaderOffset ?? localHeaderOffset;

      const unicodeName = readUnicodePathExtra(extraBytes);
      const decodedName = unicodeName || decodeFileName(nameBytes, (flags & UTF8_FLAG) !== 0);
      const name = normalizeEntryPath(decodedName);
      if (name && !name.endsWith("/")) {
        this.entries.set(name, {
          name,
          compressionMethod,
          flags,
          compressedSize,
          uncompressedSize,
          localHeaderOffset
        });
      }

      parsedEntries += 1;
      offset += recordLength;
    }

    if (parsedEntries === 0 || (expectedEntries > 0 && parsedEntries < expectedEntries)) {
      throw new Error("The EPUB ZIP index could not be parsed completely.");
    }
  }

  private getEntry(url: string): ZipEntry | undefined {
    const normalized = normalizeEntryPath(url);
    return this.entries.get(normalized);
  }

  private async getDataOffset(entry: ZipEntry): Promise<number> {
    if (entry.dataOffset !== undefined) {
      return entry.dataOffset;
    }

    const file = this.requireFile();
    const localHeader = new DataView(
      await readBlobAsArrayBuffer(
        file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30)
      )
    );
    if (
      localHeader.byteLength < 30 ||
      localHeader.getUint32(0, true) !== LOCAL_FILE_HEADER_SIGNATURE
    ) {
      throw new Error(`Invalid local ZIP header: ${entry.name}`);
    }

    const fileNameLength = localHeader.getUint16(26, true);
    const extraLength = localHeader.getUint16(28, true);
    entry.dataOffset = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
    return entry.dataOffset;
  }

  private requireFile(): Blob {
    if (!this.file || this.destroyed) {
      throw new Error("The EPUB archive is no longer available.");
    }
    return this.file;
  }
}

type CentralDirectoryLocation = {
  offset: number;
  size: number;
  totalEntries: number;
};

async function readCentralDirectoryLocation(file: Blob): Promise<CentralDirectoryLocation> {
  const tailStart = Math.max(0, file.size - MAX_EOCD_SEARCH);
  const tail = new Uint8Array(await readBlobAsArrayBuffer(file.slice(tailStart)));
  const eocdOffset = findSignatureBackwards(tail, EOCD_SIGNATURE);
  if (eocdOffset < 0 || eocdOffset + 22 > tail.byteLength) {
    throw new Error("The EPUB ZIP end-of-directory record was not found.");
  }

  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const directoryDisk = view.getUint16(eocdOffset + 6, true);
  if (diskNumber !== 0 || directoryDisk !== 0) {
    throw new Error("Multi-disk ZIP archives are not supported.");
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const directorySize = view.getUint32(eocdOffset + 12, true);
  const directoryOffset = view.getUint32(eocdOffset + 16, true);
  const requiresZip64 =
    totalEntries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff;

  if (!requiresZip64) {
    return {
      offset: directoryOffset,
      size: directorySize,
      totalEntries
    };
  }

  const absoluteEocdOffset = tailStart + eocdOffset;
  const locatorOffset = absoluteEocdOffset - 20;
  if (locatorOffset < 0) {
    throw new Error("The ZIP64 locator is missing.");
  }

  const locator = new DataView(
    await readBlobAsArrayBuffer(file.slice(locatorOffset, locatorOffset + 20))
  );
  if (
    locator.byteLength < 20 ||
    locator.getUint32(0, true) !== ZIP64_LOCATOR_SIGNATURE
  ) {
    throw new Error("The ZIP64 locator is invalid.");
  }

  const zip64RecordOffset = bigintToSafeNumber(locator.getBigUint64(8, true));
  const zip64Record = new DataView(
    await readBlobAsArrayBuffer(file.slice(zip64RecordOffset, zip64RecordOffset + 56))
  );
  if (
    zip64Record.byteLength < 56 ||
    zip64Record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE
  ) {
    throw new Error("The ZIP64 end-of-directory record is invalid.");
  }

  const zip64DiskNumber = zip64Record.getUint32(16, true);
  const zip64DirectoryDisk = zip64Record.getUint32(20, true);
  if (zip64DiskNumber !== 0 || zip64DirectoryDisk !== 0) {
    throw new Error("Multi-disk ZIP64 archives are not supported.");
  }

  return {
    totalEntries: bigintToSafeNumber(zip64Record.getBigUint64(32, true)),
    size: bigintToSafeNumber(zip64Record.getBigUint64(40, true)),
    offset: bigintToSafeNumber(zip64Record.getBigUint64(48, true))
  };
}

function readZip64Extra(
  extra: Uint8Array,
  needsUncompressedSize: boolean,
  needsCompressedSize: boolean,
  needsLocalHeaderOffset: boolean
): Partial<Pick<ZipEntry, "uncompressedSize" | "compressedSize" | "localHeaderOffset">> {
  let offset = 0;
  while (offset + 4 <= extra.byteLength) {
    const view = new DataView(extra.buffer, extra.byteOffset + offset, extra.byteLength - offset);
    const id = view.getUint16(0, true);
    const length = view.getUint16(2, true);
    if (offset + 4 + length > extra.byteLength) {
      break;
    }

    if (id === ZIP64_EXTRA_ID) {
      const values = new DataView(extra.buffer, extra.byteOffset + offset + 4, length);
      let valueOffset = 0;
      const result: Partial<
        Pick<ZipEntry, "uncompressedSize" | "compressedSize" | "localHeaderOffset">
      > = {};

      if (needsUncompressedSize && valueOffset + 8 <= values.byteLength) {
        result.uncompressedSize = bigintToSafeNumber(values.getBigUint64(valueOffset, true));
        valueOffset += 8;
      }
      if (needsCompressedSize && valueOffset + 8 <= values.byteLength) {
        result.compressedSize = bigintToSafeNumber(values.getBigUint64(valueOffset, true));
        valueOffset += 8;
      }
      if (needsLocalHeaderOffset && valueOffset + 8 <= values.byteLength) {
        result.localHeaderOffset = bigintToSafeNumber(values.getBigUint64(valueOffset, true));
      }
      return result;
    }

    offset += 4 + length;
  }

  return {};
}

function readUnicodePathExtra(extra: Uint8Array): string | null {
  let offset = 0;
  while (offset + 4 <= extra.byteLength) {
    const view = new DataView(extra.buffer, extra.byteOffset + offset, extra.byteLength - offset);
    const id = view.getUint16(0, true);
    const length = view.getUint16(2, true);
    if (offset + 4 + length > extra.byteLength) {
      break;
    }

    if (id === UNICODE_PATH_EXTRA_ID && length > 5) {
      const value = extra.subarray(offset + 4, offset + 4 + length);
      if (value[0] === 1) {
        return new TextDecoder("utf-8").decode(value.subarray(5));
      }
    }

    offset += 4 + length;
  }
  return null;
}

function decodeFileName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8 || bytes.every((byte) => byte < 0x80)) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  // EPUB paths are normally UTF-8. Latin-1 is a safer fallback than replacing
  // every non-ASCII byte when an older producer omitted the UTF-8 flag.
  return new TextDecoder("iso-8859-1").decode(bytes);
}

function normalizeEntryPath(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the original path when it contains a literal malformed percent sign.
  }

  const normalized = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function findSignatureBackwards(bytes: Uint8Array, signature: number): number {
  for (let offset = bytes.byteLength - 4; offset >= 0; offset -= 1) {
    if (
      bytes[offset] === (signature & 0xff) &&
      bytes[offset + 1] === ((signature >>> 8) & 0xff) &&
      bytes[offset + 2] === ((signature >>> 16) & 0xff) &&
      bytes[offset + 3] === ((signature >>> 24) & 0xff)
    ) {
      return offset;
    }
  }
  return -1;
}

function bigintToSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The EPUB ZIP is too large for this browser.");
  }
  return Number(value);
}

function getExtension(url: string): string {
  const clean = url.split(/[?#]/, 1)[0];
  const match = clean.match(/\.([^.\/]+)$/);
  return match?.[1]?.toLowerCase() || "text";
}

function missingEntryError(url: string): Error {
  return new Error(`File not found in the EPUB: ${url}`);
}

function lookupMimeType(path: string): string {
  const extension = getExtension(path);
  const mimeTypes: Record<string, string> = {
    css: "text/css",
    gif: "image/gif",
    html: "text/html",
    htm: "text/html",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript",
    json: "application/json",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    ncx: "application/x-dtbncx+xml",
    opf: "application/oebps-package+xml",
    otf: "font/otf",
    png: "image/png",
    svg: "image/svg+xml",
    ttf: "font/ttf",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
    xhtml: "application/xhtml+xml",
    xml: "application/xml"
  };
  return mimeTypes[extension] || "application/octet-stream";
}

async function inflateDeflateRaw(compressedBlob: Blob): Promise<Blob> {
  try {
    const stream = new DecompressionStream("deflate-raw");
    return await new Response(compressedBlob.stream().pipeThrough(stream)).blob();
  } catch {
    // Older embedded browsers can expose Compression Streams without raw
    // DEFLATE support. Inflate only this entry in JavaScript as a fallback;
    // the complete EPUB is still never copied into memory.
    const pakoModule = await import("pako");
    const compressed = new Uint8Array(await readBlobAsArrayBuffer(compressedBlob));
    const inflated = pakoModule.default.inflateRaw(compressed);
    const output = new Uint8Array(inflated.byteLength);
    output.set(inflated);
    return new Blob([output.buffer]);
  }
}
