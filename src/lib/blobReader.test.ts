import { afterEach, describe, expect, it, vi } from "vitest";
import { readBlobAsArrayBuffer, readBlobAsText } from "./blobReader";

describe("blobReader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses FileReader when Blob.arrayBuffer() and Blob.text() are unavailable", async () => {
    const blob = withoutModernBlobReaders(new Blob(["兼容 jsdom 和旧 WebView"]));
    const arrayBufferSpy = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    const textSpy = vi.spyOn(FileReader.prototype, "readAsText");

    const bytes = new Uint8Array(await readBlobAsArrayBuffer(blob));
    const text = await readBlobAsText(blob);

    expect(new TextDecoder().decode(bytes)).toBe("兼容 jsdom 和旧 WebView");
    expect(text).toBe("兼容 jsdom 和旧 WebView");
    expect(arrayBufferSpy).toHaveBeenCalled();
    expect(textSpy).toHaveBeenCalled();
  });

  it("falls back to FileReader when a present modern Blob API rejects", async () => {
    const blob = new Blob(["fallback"]);
    Object.defineProperty(blob, "arrayBuffer", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("broken arrayBuffer"))
    });
    Object.defineProperty(blob, "text", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("broken text"))
    });

    const bytes = new Uint8Array(await readBlobAsArrayBuffer(blob));
    await expect(readBlobAsText(blob)).resolves.toBe("fallback");
    expect(new TextDecoder().decode(bytes)).toBe("fallback");
  });
});

function withoutModernBlobReaders(blob: Blob): Blob {
  Object.defineProperty(blob, "arrayBuffer", {
    configurable: true,
    value: undefined
  });
  Object.defineProperty(blob, "text", {
    configurable: true,
    value: undefined
  });
  return blob;
}
