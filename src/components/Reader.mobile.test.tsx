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

function createImageContents({ frameElement }: { frameElement?: HTMLIFrameElement } = {}) {
  const imageDocument = document.implementation.createHTMLDocument("comic-page");
  imageDocument.body.innerHTML = `
    <img src="page-1.jpg" width="1200" height="1800" />
    <img src="page-2.jpg" width="1200" height="1800" />
  `;
  const contentWindow = frameElement ? (Object.create(window) as Window) : window;
  if (frameElement) {
    Object.defineProperty(contentWindow, "frameElement", {
      configurable: true,
      value: frameElement
    });
  }

  return {
    document: imageDocument,
    window: contentWindow,
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

function createWheelEvent(deltaY: number) {
  const event = new Event("wheel", { bubbles: true, cancelable: true }) as WheelEvent;
  Object.defineProperties(event, {
    deltaX: { configurable: true, value: 0 },
    deltaY: { configurable: true, value: deltaY },
    deltaMode: { configurable: true, value: 0 }
  });
  return event;
}

describe("Reader mobile scroll controls", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.rendition.manager.container = document.createElement("div");
    mocks.book.replacements = vi.fn(async () => undefined);
    mocks.book.spine.items = [{}];
    mocks.rendition.getContents.mockReturnValue([]);
    mocks.rendition.currentLocation.mockReturnValue({
      start: { index: 0, cfi: "epubcfi(/6/2)" }
    });
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

  it("opens a large new book in page mode without making an extra ArrayBuffer copy", async () => {
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
        flow: "paginated",
        manager: "default"
      })
    );
  });

  it("shows the current page position at the top of the table of contents", async () => {
    const { file } = createTestFile("comic-progress.epub", 9);
    mocks.book.spine.items = Array.from({ length: 10 }, () => ({}));
    mocks.rendition.currentLocation.mockReturnValue({
      start: { index: 1, cfi: "epubcfi(/6/4)" }
    });

    render(<Reader file={file} onClose={() => {}} />);
    await waitFor(() => expect(mocks.rendition.display).toHaveBeenCalled());
    await waitFor(() => expect(mocks.rendition.currentLocation).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "目录" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("当前页")).toBeInTheDocument();
    expect(screen.getByText("2 / 10")).toBeInTheDocument();
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

  it("allows image scale to shrink below fit size from settings", async () => {
    const { file } = createTestFile("comic-shrink.epub", 16);
    render(<Reader file={file} onClose={() => {}} />);

    await waitFor(() => expect(mocks.rendition.display).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const decreaseImageScale = await screen.findByRole("button", {
      name: "减小图片缩放"
    });
    expect(decreaseImageScale).toBeEnabled();
    fireEvent.click(decreaseImageScale);
    expect(screen.getByText("75%")).toBeInTheDocument();
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

  it("restores reliable left and right page tap zones in paginated mode", async () => {
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

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(createImageContents());
      await Promise.resolve();
    });

    const stage = container.querySelector(".reader-stage") as HTMLElement;
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        right: 390,
        bottom: 844,
        left: 0,
        width: 390,
        height: 844,
        toJSON: () => ({})
      })
    });

    const leftZone = container.querySelector(".reader-hotzone.left") as HTMLButtonElement;
    const rightZone = container.querySelector(".reader-hotzone.right") as HTMLButtonElement;
    expect(leftZone).toBeInTheDocument();
    expect(rightZone).toBeInTheDocument();

    fireEvent.touchStart(rightZone, {
      touches: [{ clientX: 389, clientY: 400 }]
    });
    fireEvent.touchEnd(rightZone, {
      changedTouches: [{ clientX: 389, clientY: 400 }]
    });
    await waitFor(() => expect(mocks.rendition.next).toHaveBeenCalledOnce());

    await new Promise((resolve) => window.setTimeout(resolve, 200));
    fireEvent.touchStart(leftZone, {
      touches: [{ clientX: 1, clientY: 400 }]
    });
    fireEvent.touchEnd(leftZone, {
      changedTouches: [{ clientX: 1, clientY: 400 }]
    });
    await waitFor(() => expect(mocks.rendition.prev).toHaveBeenCalledOnce());
  });

  it("keeps page edge taps active after changing the hand mode", async () => {
    const { file } = createTestFile("comic-grip.epub", 6);
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

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(createImageContents());
      await Promise.resolve();
    });

    const stage = container.querySelector(".reader-stage") as HTMLElement;
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        right: 390,
        bottom: 844,
        left: 0,
        width: 390,
        height: 844,
        toJSON: () => ({})
      })
    });

    const rightZoneBeforeChange = container.querySelector(
      ".reader-hotzone.right"
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(rightZoneBeforeChange);
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.rendition.next).toHaveBeenCalledOnce());

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "设置" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "左手" }));
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "阅读设置" })).not.toBeInTheDocument()
    );

    const leftZoneAfterChange = container.querySelector(
      ".reader-hotzone.left"
    ) as HTMLButtonElement;
    const rightZoneAfterChange = container.querySelector(
      ".reader-hotzone.right"
    ) as HTMLButtonElement;
    expect(leftZoneAfterChange).toHaveAccessibleName("下一页");
    expect(rightZoneAfterChange).toHaveAccessibleName("上一页");

    await act(async () => {
      fireEvent.click(leftZoneAfterChange);
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.rendition.next).toHaveBeenCalledTimes(2));

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    });
    await act(async () => {
      fireEvent.click(rightZoneAfterChange);
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.rendition.prev).toHaveBeenCalledOnce());
  });

  it("keeps page tap zones outside the scrollable stage for tall image pages", async () => {
    const { file } = createTestFile("comic-tall.epub", 7);
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

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(createImageContents());
      await Promise.resolve();
    });

    const layout = container.querySelector(".reader-layout") as HTMLElement;
    const stage = container.querySelector(".reader-stage") as HTMLElement;
    const hotzones = container.querySelector(".reader-hotzones") as HTMLElement;

    expect(layout).toContainElement(hotzones);
    expect(stage).not.toContainElement(hotzones);
  });

  it("narrows page tap zones to 15 percent for tall image pages", async () => {
    const { file } = createTestFile("comic-tall-hotzones.epub", 10);
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

    const stage = container.querySelector(".reader-stage") as HTMLElement;
    Object.defineProperties(stage, {
      clientHeight: { configurable: true, value: 844 },
      scrollHeight: { configurable: true, value: 2200 }
    });

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(createImageContents());
      await Promise.resolve();
    });

    const hotzones = container.querySelector(".reader-hotzones") as HTMLElement;
    await waitFor(() => {
      expect(hotzones).toHaveStyle({ "--reader-hotzone-width": "15%" });
    });
  });

  it("keeps pinch zoom working when a gesture starts inside a page tap zone", async () => {
    const { file } = createTestFile("comic-hotzone-pinch.epub", 11);
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

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(createImageContents());
      await Promise.resolve();
    });

    const rightZone = container.querySelector(".reader-hotzone.right") as HTMLButtonElement;
    expect(rightZone).toBeInTheDocument();

    await act(async () => {
      fireEvent.touchStart(rightZone, {
        touches: [
          { clientX: 300, clientY: 420 },
          { clientX: 340, clientY: 420 }
        ]
      });
      fireEvent.touchMove(rightZone, {
        touches: [
          { clientX: 260, clientY: 420 },
          { clientX: 340, clientY: 420 }
        ]
      });
      fireEvent.touchEnd(rightZone, {
        touches: [],
        changedTouches: [
          { clientX: 260, clientY: 420 },
          { clientX: 340, clientY: 420 }
        ]
      });
      await Promise.resolve();
    });

    expect(mocks.rendition.next).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "设置" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("200%")).toBeInTheDocument();
  });

  it("allows another pinch after the first edge pinch zooms an image", async () => {
    const { file } = createTestFile("comic-repeat-pinch.epub", 12);
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

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(createImageContents());
      await Promise.resolve();
    });

    const rightZone = container.querySelector(".reader-hotzone.right") as HTMLButtonElement;
    await act(async () => {
      fireEvent.touchStart(rightZone, {
        touches: [
          { clientX: 300, clientY: 420 },
          { clientX: 340, clientY: 420 }
        ]
      });
      fireEvent.touchMove(rightZone, {
        touches: [
          { clientX: 260, clientY: 420 },
          { clientX: 340, clientY: 420 }
        ]
      });
      fireEvent.touchEnd(rightZone, {
        touches: [],
        changedTouches: [{ clientX: 260, clientY: 420 }]
      });
      await Promise.resolve();
    });

    const zoomLayer = await waitFor(() => {
      const layer = container.querySelector(".reader-zoom-gesture-layer") as HTMLElement | null;
      expect(layer).toBeInTheDocument();
      return layer as HTMLElement;
    });

    await act(async () => {
      fireEvent.touchStart(zoomLayer, {
        touches: [
          { clientX: 140, clientY: 420 },
          { clientX: 220, clientY: 420 }
        ]
      });
      fireEvent.touchMove(zoomLayer, {
        touches: [
          { clientX: 100, clientY: 420 },
          { clientX: 220, clientY: 420 }
        ]
      });
      fireEvent.touchEnd(zoomLayer, {
        touches: [],
        changedTouches: [{ clientX: 100, clientY: 420 }]
      });
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "设置" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("300%")).toBeInTheDocument();
  });

  it("pans a zoomed image when dragging after an edge pinch", async () => {
    const { file } = createTestFile("comic-zoom-pan.epub", 13);
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
    mocks.rendition.getContents.mockReturnValue([contents]);
    const iframeScrollTarget =
      contents.document.scrollingElement ?? contents.document.documentElement;

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(contents);
      await Promise.resolve();
    });

    const stage = container.querySelector(".reader-stage") as HTMLElement;
    Object.defineProperties(stage, {
      clientHeight: { configurable: true, value: 844 },
      scrollHeight: { configurable: true, value: 1600 }
    });
    stage.scrollTop = 0;

    const rightZone = container.querySelector(".reader-hotzone.right") as HTMLButtonElement;
    await act(async () => {
      fireEvent.touchStart(rightZone, {
        touches: [
          { clientX: 300, clientY: 420 },
          { clientX: 340, clientY: 420 }
        ]
      });
      fireEvent.touchMove(rightZone, {
        touches: [
          { clientX: 260, clientY: 420 },
          { clientX: 340, clientY: 420 }
        ]
      });
      fireEvent.touchEnd(rightZone, {
        touches: [],
        changedTouches: [{ clientX: 260, clientY: 420 }]
      });
      await Promise.resolve();
    });

    const zoomLayer = await waitFor(() => {
      const layer = container.querySelector(".reader-zoom-gesture-layer") as HTMLElement | null;
      expect(layer).toBeInTheDocument();
      return layer as HTMLElement;
    });

    await act(async () => {
      fireEvent.touchStart(zoomLayer, {
        touches: [{ clientX: 220, clientY: 520 }]
      });
      fireEvent.touchMove(zoomLayer, {
        touches: [{ clientX: 160, clientY: 420 }]
      });
      fireEvent.touchEnd(zoomLayer, {
        touches: [],
        changedTouches: [{ clientX: 160, clientY: 420 }]
      });
      await Promise.resolve();
    });

    expect(stage.scrollTop).toBe(100);
    expect(iframeScrollTarget.scrollLeft).toBe(60);
    expect(mocks.rendition.next).not.toHaveBeenCalled();
  });

  it("turns from a zoomed image edge tap and keeps the zoom on the next page", async () => {
    const { file } = createTestFile("comic-zoom-edge-turn.epub", 14);
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

    const stage = container.querySelector(".reader-stage") as HTMLElement;
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        right: 390,
        bottom: 844,
        left: 0,
        width: 390,
        height: 844,
        toJSON: () => ({})
      })
    });

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(createImageContents());
      await Promise.resolve();
    });

    const rightZone = container.querySelector(".reader-hotzone.right") as HTMLButtonElement;
    await act(async () => {
      fireEvent.touchStart(rightZone, {
        touches: [
          { clientX: 300, clientY: 420 },
          { clientX: 340, clientY: 420 }
        ]
      });
      fireEvent.touchMove(rightZone, {
        touches: [
          { clientX: 260, clientY: 420 },
          { clientX: 340, clientY: 420 }
        ]
      });
      fireEvent.touchEnd(rightZone, {
        touches: [],
        changedTouches: [{ clientX: 260, clientY: 420 }]
      });
      await Promise.resolve();
    });

    const zoomLayer = await waitFor(() => {
      const layer = container.querySelector(".reader-zoom-gesture-layer") as HTMLElement | null;
      expect(layer).toBeInTheDocument();
      return layer as HTMLElement;
    });

    await act(async () => {
      fireEvent.touchStart(zoomLayer, {
        touches: [{ clientX: 370, clientY: 420 }]
      });
      fireEvent.touchEnd(zoomLayer, {
        touches: [],
        changedTouches: [{ clientX: 370, clientY: 420 }]
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(mocks.rendition.next).toHaveBeenCalledOnce());

    const nextPageContents = createImageContents();
    await act(async () => {
      contentHook?.(nextPageContents);
      await Promise.resolve();
    });

    expect(nextPageContents.addStylesheetCss).toHaveBeenCalledWith(
      expect.stringContaining("200%"),
      "reader-image-scale"
    );
  });

  it("uses desktop immersive chrome for image pages without changing mobile controls", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: false,
      media: "(max-width: 760px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    } as MediaQueryList);
    const { file } = createTestFile("comic-desktop-immersive.epub", 15);
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

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(createImageContents());
      await Promise.resolve();
    });

    const toolbar = container.querySelector(".bottom-toolbar") as HTMLElement;
    await waitFor(() => {
      expect(screen.getByLabelText("EPUB 阅读器")).toHaveClass("desktop-immersive");
      expect(toolbar).toHaveAttribute("aria-hidden", "true");
    });
    const revealButton = screen.getByRole("button", { name: "显示阅读控制" });
    expect(revealButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(revealButton);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(toolbar).toHaveAttribute("aria-hidden", "false");
      expect(screen.queryByRole("button", { name: "显示阅读控制" })).not.toBeInTheDocument();
    });
  });

  it("scrolls tall paginated image pages with a mouse wheel over hotzones and the iframe", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: false,
      media: "(max-width: 760px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    } as MediaQueryList);
    const { file } = createTestFile("comic-wheel-tall.epub", 17);
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

    const stage = container.querySelector(".reader-stage") as HTMLElement;
    Object.defineProperties(stage, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1600 }
    });
    const iframe = document.createElement("iframe");
    stage.appendChild(iframe);
    const contents = createImageContents({ frameElement: iframe });

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(contents);
      await Promise.resolve();
    });

    const rightZone = container.querySelector(".reader-hotzone.right") as HTMLButtonElement;
    fireEvent.wheel(rightZone, { deltaY: 120, deltaMode: 0 });
    expect(stage.scrollTop).toBe(120);

    stage.scrollTop = 0;
    const iframeWheel = createWheelEvent(180);
    contents.document.dispatchEvent(iframeWheel);
    expect(stage.scrollTop).toBe(180);
    expect(iframeWheel.defaultPrevented).toBe(true);
  });

  it("scrolls a tall image page when dragging inside a page tap zone", async () => {
    const { file } = createTestFile("comic-hotzone-scroll.epub", 8);
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

    const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
      | ((contents: ReturnType<typeof createImageContents>) => void)
      | undefined;
    expect(contentHook).toBeTypeOf("function");
    await act(async () => {
      contentHook?.(createImageContents());
      await Promise.resolve();
    });

    const stage = container.querySelector(".reader-stage") as HTMLElement;
    Object.defineProperties(stage, {
      clientHeight: { configurable: true, value: 844 },
      scrollHeight: { configurable: true, value: 2200 }
    });
    stage.scrollTop = 0;

    const rightZone = container.querySelector(".reader-hotzone.right") as HTMLButtonElement;
    await act(async () => {
      fireEvent.touchStart(rightZone, {
        touches: [{ clientX: 300, clientY: 520 }]
      });
      fireEvent.touchMove(rightZone, {
        touches: [{ clientX: 300, clientY: 420 }]
      });
      fireEvent.touchEnd(rightZone, {
        changedTouches: [{ clientX: 300, clientY: 420 }]
      });
      await Promise.resolve();
    });

    expect(stage.scrollTop).toBe(100);
    expect(mocks.rendition.next).not.toHaveBeenCalled();
  });
});
