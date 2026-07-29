import type { Book } from "epubjs";
import pako from "pako";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileBackedEpubArchive,
  installFileBackedEpubArchive,
  type FileArchiveStage
} from "./fileBackedEpubArchive";

type ZipSource = {
  name: string;
  data: Uint8Array;
};

class TrackedBlob extends Blob {
  readonly slices: Array<{ start: number; end: number }> = [];

  override slice(start = 0, end = this.size, contentType?: string): Blob {
    this.slices.push({ start, end });
    return super.slice(start, end, contentType);
  }
}

describe("FileBackedEpubArchive", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a large EPUB from its ZIP index without reading the large image entry", async () => {
    const largeImage = new Uint8Array(2 * 1024 * 1024);
    largeImage.fill(7);
    const epub = new TrackedBlob([
      toArrayBuffer(createStoredZip([
        {
          name: "META-INF/container.xml",
          data: encode(
            '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
          )
        },
        { name: "OPS/book.opf", data: encode("<package></package>") },
        { name: "OPS/Images/page.jpg", data: largeImage }
      ]))
    ]);
    const stages: FileArchiveStage[] = [];
    const archive = new FileBackedEpubArchive((stage) => stages.push(stage));

    await archive.open(epub);

    expect(archive.getEntryCount()).toBe(3);
    expect(stages).toEqual(["reading-index", "reading-book-structure", "ready"]);
    expect(Math.max(...epub.slices.map(({ start, end }) => end - start))).toBeLessThan(100_000);

    const container = await archive.request("/META-INF/container.xml", "xml");
    expect(container).toBeInstanceOf(Document);
    expect((container as Document).querySelector("rootfile")?.getAttribute("full-path")).toBe(
      "OPS/book.opf"
    );

    const image = await archive.getBlob("/OPS/Images/page.jpg");
    expect(image.size).toBe(largeImage.byteLength);
    expect(image.type).toBe("image/jpeg");
    archive.destroy();
  });

  it("inflates individual entries with the JavaScript fallback when raw streams are unavailable", async () => {
    vi.stubGlobal(
      "DecompressionStream",
      class UnsupportedDecompressionStream {
        constructor() {
          throw new Error("deflate-raw is unavailable");
        }
      }
    );

    const archive = new FileBackedEpubArchive();
    const epub = new Blob([
      toArrayBuffer(
        createDeflatedZip([
          {
            name: "META-INF/container.xml",
            data: encode("<container><rootfiles /></container>")
          },
          { name: "OPS/chapter.xhtml", data: encode("<html><body>fallback</body></html>") }
        ])
      )
    ]);

    await archive.open(epub);
    await expect(archive.getText("/OPS/chapter.xhtml")).resolves.toContain("fallback");
    archive.destroy();
  });

  it("reads archive slices through FileReader when modern Blob readers are missing", async () => {
    const epub = withoutModernBlobReaders(
      new Blob([
        toArrayBuffer(
          createStoredZip([
            {
              name: "META-INF/container.xml",
              data: encode("<container><rootfiles /></container>")
            },
            {
              name: "OPS/chapter.xhtml",
              data: encode("<html><body>legacy Blob</body></html>")
            }
          ])
        )
      ])
    );
    const archive = new FileBackedEpubArchive();

    await archive.open(epub);

    await expect(archive.getText("/OPS/chapter.xhtml")).resolves.toContain("legacy Blob");
    await expect(archive.getBase64("/OPS/chapter.xhtml", "application/xhtml+xml")).resolves.toMatch(
      /^data:application\/xhtml\+xml;base64,/
    );
    archive.destroy();
  });

  it("installs the file-backed unarchive hook before epub.js opens the book", async () => {
    const book = { unarchive: vi.fn(), archive: undefined } as unknown as Book;
    const archive = installFileBackedEpubArchive(book);
    const epub = new Blob([
      toArrayBuffer(createStoredZip([
        {
          name: "META-INF/container.xml",
          data: encode("<container></container>")
        }
      ]))
    ]);

    await (book as unknown as { unarchive: (input: Blob) => Promise<unknown> }).unarchive(epub);

    expect((book as unknown as { archive: unknown }).archive).toBe(archive);
    expect(archive.getEntryCount()).toBe(1);
  });
});

function createDeflatedZip(entries: ZipSource[]): Uint8Array {
  return createZip(
    entries.map((entry) => ({
      ...entry,
      compressedData: pako.deflateRaw(entry.data),
      compressionMethod: 8
    }))
  );
}

function createStoredZip(entries: ZipSource[]): Uint8Array {
  return createZip(
    entries.map((entry) => ({
      ...entry,
      compressedData: entry.data,
      compressionMethod: 0
    }))
  );
}

type PreparedZipSource = ZipSource & {
  compressedData: Uint8Array;
  compressionMethod: number;
};

function createZip(entries: PreparedZipSource[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, entry.compressionMethod, true);
    localView.setUint32(18, entry.compressedData.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, entry.compressedData);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, entry.compressionMethod, true);
    centralView.setUint32(20, entry.compressedData.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + entry.compressedData.length;
  }

  const centralDirectory = concat(centralParts);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralDirectory.length, true);
  eocdView.setUint32(16, localOffset, true);

  return concat([...localParts, centralDirectory, eocd]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function withoutModernBlobReaders(blob: Blob): Blob {
  const nativeSlice = blob.slice.bind(blob);
  Object.defineProperty(blob, "arrayBuffer", {
    configurable: true,
    value: undefined
  });
  Object.defineProperty(blob, "text", {
    configurable: true,
    value: undefined
  });
  Object.defineProperty(blob, "slice", {
    configurable: true,
    value(start?: number, end?: number, contentType?: string) {
      return withoutModernBlobReaders(nativeSlice(start, end, contentType));
    }
  });
  return blob;
}
