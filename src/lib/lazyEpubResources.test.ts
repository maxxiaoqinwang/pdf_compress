import type { Book, Rendition } from "epubjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachLazyResourceCleanup,
  installLazyEpubResourceLoading,
  resolveArchiveResource,
  type LazyEpubResourceController
} from "./lazyEpubResources";

describe("resolveArchiveResource", () => {
  it("resolves an EPUB-relative asset and preserves SVG fragments", () => {
    expect(
      resolveArchiveResource("../Images/page 1.jpg?quality=high#crop", "/OPS/Text/chapter.xhtml")
    ).toEqual({
      path: "/OPS/Images/page%201.jpg",
      suffix: "#crop"
    });
  });

  it("supports resources rooted at the EPUB archive root", () => {
    expect(resolveArchiveResource("/fonts/body.woff2", "/OPS/Text/chapter.xhtml")).toEqual({
      path: "/fonts/body.woff2",
      suffix: ""
    });
  });

  it("leaves network, data, blob and same-document references untouched", () => {
    expect(resolveArchiveResource("https://example.com/cover.jpg", "/OPS/chapter.xhtml")).toBeNull();
    expect(resolveArchiveResource("data:image/png;base64,abc", "/OPS/chapter.xhtml")).toBeNull();
    expect(resolveArchiveResource("blob:https://reader.test/id", "/OPS/chapter.xhtml")).toBeNull();
    expect(resolveArchiveResource("#footnote", "/OPS/chapter.xhtml")).toBeNull();
  });
});

describe("installLazyEpubResourceLoading", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  it("disables epub.js' eager replacement pass before the book opens", async () => {
    const eagerReplacements = vi.fn(async () => undefined);
    const book = {
      replacements: eagerReplacements,
      archive: undefined,
      spine: {
        hooks: {
          content: {
            register: vi.fn(),
            deregister: vi.fn()
          }
        }
      }
    } as unknown as Book;

    const controller = installLazyEpubResourceLoading(book);
    await (book as unknown as { replacements: () => Promise<unknown> }).replacements();

    expect(eagerReplacements).not.toHaveBeenCalled();
    controller.destroy();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("creates only the current section image URL and releases it when the view leaves", async () => {
    let contentHook:
      | ((document: Document, section: { url: string; unload: () => void }) => Promise<void>)
      | undefined;
    const unload = vi.fn();
    const getBlob = vi.fn(async () => new Blob(["page"], { type: "image/jpeg" }));
    const createObjectURL = vi.fn(() => "blob:https://reader.test/page-1");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const book = {
      archive: {
        getBlob,
        getText: vi.fn()
      },
      spine: {
        hooks: {
          content: {
            register(hook: typeof contentHook) {
              contentHook = hook;
            },
            deregister: vi.fn()
          }
        }
      }
    } as unknown as Book;

    const controller = installLazyEpubResourceLoading(book);
    const document = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../Images/page.jpg" /></body></html>',
      "application/xhtml+xml"
    );
    const section = { url: "/OPS/Text/page.xhtml", unload };

    expect(contentHook).toBeTypeOf("function");
    await contentHook?.(document, section);

    expect(getBlob).toHaveBeenCalledWith("/OPS/Images/page.jpg");
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "blob:https://reader.test/page-1"
    );

    controller.releaseSection(section);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://reader.test/page-1");
    expect(unload).toHaveBeenCalledOnce();
  });

  it("rewrites only the rendered chapter stylesheet and its referenced assets", async () => {
    let contentHook:
      | ((document: Document, section: { url: string; unload: () => void }) => Promise<void>)
      | undefined;
    const getBlob = vi.fn(async (path: string) =>
      new Blob([path], { type: path.endsWith(".woff2") ? "font/woff2" : "image/jpeg" })
    );
    const getText = vi.fn(async () =>
      '@font-face{src:url("../Fonts/body.woff2")} body{background:url(../Images/paper.jpg)}'
    );
    const createdBlobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return `blob:https://reader.test/resource-${createdBlobs.length}`;
    });
    URL.revokeObjectURL = vi.fn();

    const book = {
      archive: { getBlob, getText },
      spine: {
        hooks: {
          content: {
            register(hook: typeof contentHook) {
              contentHook = hook;
            },
            deregister: vi.fn()
          }
        }
      }
    } as unknown as Book;

    const controller = installLazyEpubResourceLoading(book);
    const document = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../Styles/book.css" /></head><body><p>Text</p></body></html>',
      "application/xhtml+xml"
    );
    const section = { url: "/OPS/Text/chapter.xhtml", unload: vi.fn() };

    await contentHook?.(document, section);

    expect(getText).toHaveBeenCalledWith("/OPS/Styles/book.css");
    expect(getBlob).toHaveBeenCalledWith("/OPS/Fonts/body.woff2");
    expect(getBlob).toHaveBeenCalledWith("/OPS/Images/paper.jpg");
    expect(getBlob).not.toHaveBeenCalledWith("/OPS/Images/unused.jpg");
    expect(document.querySelector("link")?.getAttribute("href")).toMatch(/^blob:/);

    const cssBlob = createdBlobs.find((blob) => blob.type === "text/css");
    expect(cssBlob?.type).toBe("text/css");
    expect(createdBlobs).toHaveLength(3);

    controller.destroy();
  });
});

describe("attachLazyResourceCleanup", () => {
  it("releases sections after epub.js removes or clears their iframe views", () => {
    const first = { section: { index: 0 } };
    const second = { section: { index: 1 } };
    const renderedViews = [first, second];
    const originalRemove = vi.fn((view: typeof first) => {
      renderedViews.splice(renderedViews.indexOf(view), 1);
    });
    const originalClear = vi.fn(() => {
      renderedViews.splice(0);
    });
    const views = {
      all: () => [...renderedViews],
      remove: originalRemove,
      clear: originalClear
    };
    const releaseSection = vi.fn();
    const controller = {
      releaseSection,
      resetRenderedSections: vi.fn(),
      destroy: vi.fn()
    } satisfies LazyEpubResourceController;

    const rendition = { manager: { views } } as unknown as Rendition;
    const detach = attachLazyResourceCleanup(rendition, controller);

    views.remove(first);
    expect(originalRemove).toHaveBeenCalledWith(first);
    expect(releaseSection).toHaveBeenCalledWith(first.section);

    views.clear();
    expect(originalClear).toHaveBeenCalledOnce();
    expect(releaseSection).toHaveBeenCalledWith(second.section);

    detach();
    expect(views.remove).toBe(originalRemove);
    expect(views.clear).toBe(originalClear);
  });

  it("waits for the attached lifecycle when epub.js has not created the view list yet", async () => {
    const section = { index: 0 };
    const view = { section };
    const originalRemove = vi.fn();
    const views = {
      all: () => [view],
      remove: originalRemove,
      clear: vi.fn()
    };
    const listeners = new Map<string, () => void>();
    const releaseSection = vi.fn();
    const controller = {
      releaseSection,
      resetRenderedSections: vi.fn(),
      destroy: vi.fn()
    } satisfies LazyEpubResourceController;
    const renditionInternals: {
      started: Promise<void>;
      manager: { views?: typeof views };
      on: (event: string, listener: () => void) => void;
      off: (event: string, listener: () => void) => void;
    } = {
      started: Promise.resolve(),
      manager: {},
      on(event, listener) {
        listeners.set(event, listener);
      },
      off(event, listener) {
        if (listeners.get(event) === listener) {
          listeners.delete(event);
        }
      }
    };

    const detach = attachLazyResourceCleanup(
      renditionInternals as unknown as Rendition,
      controller
    );
    await Promise.resolve();

    renditionInternals.manager.views = views;
    listeners.get("attached")?.();
    views.remove(view);

    expect(originalRemove).toHaveBeenCalledWith(view);
    expect(releaseSection).toHaveBeenCalledWith(section);

    detach();
    expect(listeners.has("attached")).toBe(false);
    expect(views.remove).toBe(originalRemove);
  });
});
