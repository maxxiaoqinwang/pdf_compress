import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rendition = {
    hooks: { content: { register: vi.fn() } },
    themes: {
      register: vi.fn(),
      select: vi.fn(),
      fontSize: vi.fn(),
      override: vi.fn()
    },
    manager: {
      container: null as HTMLElement | null,
      check: vi.fn(async () => false)
    },
    on: vi.fn(),
    off: vi.fn(),
    display: vi.fn(async () => undefined),
    currentLocation: vi.fn(() => ({ start: { index: 0, cfi: "epubcfi(/6/2)" } })),
    getContents: vi.fn((): unknown[] => []),
    next: vi.fn(async () => undefined),
    prev: vi.fn(async () => undefined),
    destroy: vi.fn()
  };

  const book = {
    loaded: {
      metadata: Promise.resolve({ title: "测试书籍", layout: "" }),
      navigation: Promise.resolve({ toc: [] })
    },
    spine: {
      items: [{}],
      hooks: {
        content: {
          register: vi.fn(),
          deregister: vi.fn()
        }
      }
    },
    package: { metadata: { layout: "" } },
    displayOptions: { fixedLayout: "false" },
    locations: {
      generate: vi.fn(async () => undefined),
      percentageFromCfi: vi.fn(() => 0)
    },
    replacements: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    renderTo: vi.fn((host: HTMLElement) => {
      if (rendition.manager.container) {
        host.appendChild(rendition.manager.container);
      }
      return rendition;
    }),
    destroy: vi.fn()
  };

  return {
    rendition,
    book,
    ePub: vi.fn(() => book)
  };
});

vi.mock("epubjs", () => ({
  default: mocks.ePub
}));

import { Reader } from "./Reader";
import { createBookKey } from "../lib/storage";

const LARGE_FILE_SIZE = 33 * 1024 * 1024;

function createImageContents({ svg = false }: { svg?: boolean } = {}) {
  const imageDocument = document.implementation.createHTMLDocument("comic-page");
  imageDocument.head.innerHTML = '<meta name="viewport" content="width=1088,height=1536" />';
  imageDocument.body.style.width = "1088px";
  imageDocument.body.style.height = "1536px";
  imageDocument.body.style.transform = "scale(0.35)";
  imageDocument.body.innerHTML = svg
    ? `
      <svg viewBox="0 0 1088 1536" xmlns="http://www.w3.org/2000/svg">
        <image href="page-1.jpg" width="1088" height="1536" />
      </svg>
    `
    : '<img src="page-1.jpg" width="1088" height="1536" />';

  return {
    document: imageDocument,
    window,
    documentElement: imageDocument.documentElement,
    // epub.js 0.3.93 returns a synchronous boolean in browsers even though
    // its declaration file says Promise<boolean>. Keep the mock realistic so
    // a direct `.catch()` regression is caught.
    addStylesheetCss: vi.fn(() => true)
  };
}

function createTestFile(name: string, lastModified: number) {
  const file = new File([new Uint8Array(1024)], name, {
    type: "application/epub+zip",
    lastModified
  });
  const arrayBuffer = vi.fn(async () => new ArrayBuffer(1024));
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: arrayBuffer });
  return { file, arrayBuffer };
}

function dispatchTouchEvent(
  target: Element,
  type: "touchstart" | "touchmove" | "touchend",
  touches: Array<{ clientX: number; clientY: number }>,
  changedTouches = touches
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { configurable: true, value: touches });
  Object.defineProperty(event, "changedTouches", {
    configurable: true,
    value: changedTouches
  });
  target.dispatchEvent(event);
}

describe("Reader mobile scroll controls", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.rendition.manager.container = document.createElement("div");
    mocks.book.replacements = vi.fn(async () => undefined);
    mocks.book.package.metadata.layout = "";
    mocks.book.displayOptions.fixedLayout = "false";
    mocks.rendition.getContents.mockReturnValue([]);
    Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: "(max-width: 760px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => true)
      }))
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the toolbar available in scroll mode and exposes an iframe-independent reveal handle", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const { file } = createTestFile("test.epub", 1);

    const { container } = render(<Reader file={file} onClose={() => {}} />);

    await waitFor(() => expect(mocks.rendition.display).toHaveBeenCalled());
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 4500);

    fireEvent.click(container.querySelector(".reader-stage") as HTMLElement);
    const revealButton = await screen.findByRole("button", { name: "显示阅读控制" });
    expect(screen.queryByRole("navigation", { name: "阅读控制" })).not.toBeInTheDocument();

    fireEvent.scroll(mocks.rendition.manager.container as HTMLElement);
    expect(screen.getByRole("button", { name: "显示阅读控制" })).toBeInTheDocument();

    fireEvent.click(revealButton);
    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "阅读控制" })).toHaveAttribute(
        "aria-hidden",
        "false"
      );
    });

    fireEvent.scroll(mocks.rendition.manager.container as HTMLElement);
    expect(screen.getByRole("navigation", { name: "阅读控制" })).toHaveAttribute(
      "aria-hidden",
      "false"
    );
  });

  it("opens a large scroll book without making an extra ArrayBuffer copy", async () => {
    const { file, arrayBuffer } = createTestFile("large.epub", 2);
    Object.defineProperty(file, "size", { configurable: true, value: LARGE_FILE_SIZE });

    render(<Reader file={file} onClose={() => {}} />);
    await waitFor(() => expect(mocks.book.renderTo).toHaveBeenCalled());

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mocks.ePub).toHaveBeenCalledWith({ replacements: "none" });
    expect(mocks.book.open).toHaveBeenCalledWith(file);
    expect(mocks.book.renderTo).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        flow: "scrolled",
        manager: "continuous",
        offset: 240,
        offsetDelta: 0
      })
    );
  });

  it("keeps image zoom available in scroll mode", async () => {
    const { file } = createTestFile("comic-scroll.epub", 4);
    render(<Reader file={file} onClose={() => {}} />);

    await waitFor(() => expect(mocks.rendition.display).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const increaseImageScale = await screen.findByRole("button", {
      name: "增大图片缩放"
    });
    expect(increaseImageScale).toBeEnabled();
    fireEvent.click(increaseImageScale);
    expect(screen.getByText("125%")).toBeInTheDocument();
  });

  it("keeps the reader mounted when image scale is changed with the real synchronous stylesheet API", async () => {
    const { file } = createTestFile("comic-scale.epub", 5);
    const contents = createImageContents();
    mocks.rendition.getContents.mockReturnValue([contents]);

    render(<Reader file={file} onClose={() => {}} />);
    await waitFor(() => expect(mocks.rendition.display).toHaveBeenCalled());

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((value: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    let contentHookError: unknown;
    await act(async () => {
      try {
        contentHook?.(contents);
      } catch (error) {
        contentHookError = error;
      }
      await Promise.resolve();
    });
    expect(contentHookError).toBeUndefined();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "设置" }));
      await Promise.resolve();
    });
    const increaseImageScale = await screen.findByRole("button", { name: "增大图片缩放" });
    await act(async () => {
      fireEvent.click(increaseImageScale);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("125%")).toBeInTheDocument();
      expect(screen.getByLabelText("EPUB 阅读器")).toBeInTheDocument();
      expect(contents.addStylesheetCss).toHaveBeenCalled();
    });
  });

  it("routes page taps inside the EPUB iframe without transparent outer hotzones", async () => {
    const { file } = createTestFile("comic.epub", 3);
    localStorage.setItem(
      `epub-reader-progress-v2:${createBookKey(file)}`,
      JSON.stringify({
        cfi: null,
        percentage: null,
        readingMode: "page",
        updatedAt: Date.now()
      })
    );

    const { container } = render(<Reader file={file} onClose={() => {}} />);
    await waitFor(() => expect(mocks.rendition.display).toHaveBeenCalled());

    const contents = createImageContents();
    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((value: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    act(() => contentHook?.(contents));

    expect(container.querySelector(".reader-hotzone")).not.toBeInTheDocument();
    const image = contents.document.querySelector("img") as HTMLImageElement;

    dispatchTouchEvent(image, "touchstart", [{ clientX: 1000, clientY: 400 }]);
    dispatchTouchEvent(image, "touchend", [], [{ clientX: 1000, clientY: 400 }]);
    await waitFor(() => expect(mocks.rendition.next).toHaveBeenCalledOnce());

    await new Promise((resolve) => window.setTimeout(resolve, 200));
    dispatchTouchEvent(image, "touchstart", [{ clientX: 1, clientY: 400 }]);
    dispatchTouchEvent(image, "touchend", [], [{ clientX: 1, clientY: 400 }]);
    await waitFor(() => expect(mocks.rendition.prev).toHaveBeenCalledOnce());
  });

  it("pinch-zooms a fixed-layout image and keeps the reader visible", async () => {
    const { file } = createTestFile("fixed-layout-comic.epub", 6);
    mocks.book.package.metadata.layout = "pre-paginated";
    mocks.book.displayOptions.fixedLayout = "true";
    const contents = createImageContents();
    mocks.rendition.getContents.mockReturnValue([contents]);

    render(<Reader file={file} onClose={() => {}} />);
    await waitFor(() => expect(mocks.rendition.display).toHaveBeenCalled());
    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((value: ReturnType<typeof createImageContents>) => void)
      | undefined;
    act(() => contentHook?.(contents));

    const image = contents.document.querySelector("img") as HTMLImageElement;
    await act(async () => {
      dispatchTouchEvent(
        image,
        "touchstart",
        [
          { clientX: 100, clientY: 300 },
          { clientX: 200, clientY: 300 }
        ]
      );
      dispatchTouchEvent(
        image,
        "touchmove",
        [
          { clientX: 50, clientY: 300 },
          { clientX: 250, clientY: 300 }
        ]
      );
      dispatchTouchEvent(image, "touchend", [], []);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByLabelText("EPUB 阅读器")).toBeInTheDocument();
      expect(contents.document.body.style.transform).toBe("scale(0.35) scale(2)");
    });
  });

  it("treats SVG-wrapped comic pages as zoomable image pages", async () => {
    const { file } = createTestFile("svg-comic.epub", 7);
    mocks.book.package.metadata.layout = "pre-paginated";
    const contents = createImageContents({ svg: true });

    render(<Reader file={file} onClose={() => {}} />);
    await waitFor(() => expect(mocks.rendition.display).toHaveBeenCalled());
    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((value: ReturnType<typeof createImageContents>) => void)
      | undefined;
    act(() => contentHook?.(contents));

    expect(contents.document.documentElement.classList.contains("reader-image-page")).toBe(true);
    expect(contents.document.documentElement.classList.contains("reader-fixed-layout-page")).toBe(
      true
    );
  });
});
