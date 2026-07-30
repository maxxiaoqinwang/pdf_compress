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

function createImageContents() {
  const imageDocument = document.implementation.createHTMLDocument("comic-page");
  imageDocument.body.innerHTML = `
    <img src="page-1.jpg" width="1200" height="1800" />
    <img src="page-2.jpg" width="1200" height="1800" />
  `;

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

type TouchPoint = { clientX: number; clientY: number };

function dispatchTouchEvent(
  target: Element,
  type: "touchstart" | "touchmove" | "touchend",
  touches: TouchPoint[],
  changedTouches: TouchPoint[] = touches
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { configurable: true, value: touches },
    changedTouches: { configurable: true, value: changedTouches }
  });
  target.dispatchEvent(event);
}

describe("Reader mobile scroll controls", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.rendition.manager.container = document.createElement("div");
    mocks.book.replacements = vi.fn(async () => undefined);
    mocks.rendition.getContents.mockReturnValue([]);
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

  it("uses full-surface vertical swipes and removes left/right page tap zones", async () => {
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
    await waitFor(() =>
      expect(container.querySelector(".progress-label")?.textContent).toMatch(/^第 /)
    );

    const contents = createImageContents();
    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((value: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(contents);
      await Promise.resolve();
    });

    expect(container.querySelector(".reader-hotzones")).not.toBeInTheDocument();
    expect(container.querySelector(".reader-hotzone")).not.toBeInTheDocument();

    const image = contents.document.querySelector("img") as HTMLImageElement;

    // A tap at the old right-edge location now only toggles controls.
    act(() => {
      dispatchTouchEvent(image, "touchstart", [{ clientX: 389, clientY: 400 }]);
      dispatchTouchEvent(image, "touchend", [], [{ clientX: 389, clientY: 400 }]);
    });
    expect(mocks.rendition.next).not.toHaveBeenCalled();
    expect(mocks.rendition.prev).not.toHaveBeenCalled();

    // An upward swipe works even when it starts at the old right hotzone. The
    // stale touchend coordinate emulates WebKit; the last touchmove wins.
    act(() => {
      dispatchTouchEvent(image, "touchstart", [{ clientX: 380, clientY: 620 }]);
      dispatchTouchEvent(image, "touchmove", [{ clientX: 378, clientY: 470 }]);
      dispatchTouchEvent(image, "touchend", [], [{ clientX: 380, clientY: 620 }]);
    });
    await waitFor(() => expect(mocks.rendition.next).toHaveBeenCalledOnce());

    await new Promise((resolve) => window.setTimeout(resolve, 220));

    // A downward swipe works from the old left hotzone and goes back.
    act(() => {
      dispatchTouchEvent(image, "touchstart", [{ clientX: 10, clientY: 250 }]);
      dispatchTouchEvent(image, "touchmove", [{ clientX: 12, clientY: 410 }]);
      dispatchTouchEvent(image, "touchend", [], [{ clientX: 12, clientY: 410 }]);
    });
    await waitFor(() => expect(mocks.rendition.prev).toHaveBeenCalledOnce());
  });
});
