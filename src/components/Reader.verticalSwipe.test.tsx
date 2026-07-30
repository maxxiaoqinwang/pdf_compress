import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      metadata: Promise.resolve({ title: "测试漫画", layout: "pre-paginated" }),
      navigation: Promise.resolve({ toc: [] })
    },
    spine: {
      items: [{}, {}],
      hooks: {
        content: {
          register: vi.fn(),
          deregister: vi.fn()
        }
      }
    },
    package: { metadata: { layout: "pre-paginated" } },
    displayOptions: { fixedLayout: "true" },
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

function createTestFile() {
  return new File([new Uint8Array(1024)], "vertical-swipe.epub", {
    type: "application/epub+zip",
    lastModified: 7
  });
}

function savePageMode(file: File, imageScale = 100) {
  localStorage.setItem(
    `epub-reader-progress-v2:${createBookKey(file)}`,
    JSON.stringify({
      cfi: null,
      percentage: null,
      readingMode: "page",
      updatedAt: Date.now()
    })
  );
  localStorage.setItem(
    "epub-reader-preferences-v2",
    JSON.stringify({
      fontScale: 100,
      gripMode: "right",
      imageScale,
      lineHeight: 175,
      theme: "paper"
    })
  );
}

function createImageContents() {
  const imageDocument = document.implementation.createHTMLDocument("comic-page");
  imageDocument.body.innerHTML = '<img src="page-1.jpg" width="1088" height="1536" />';

  return {
    document: imageDocument,
    window,
    documentElement: imageDocument.documentElement,
    addStylesheetCss: vi.fn(() => true)
  };
}

function setVisualImageBounds(
  image: HTMLImageElement,
  { top, bottom, width = 390 }: { top: number; bottom: number; width?: number }
) {
  const height = bottom - top;
  Object.defineProperty(image, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: top,
      top,
      right: width,
      bottom,
      left: 0,
      width,
      height,
      toJSON: () => ({ top, bottom, width, height })
    })
  });
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

async function renderPageReader(imageScale = 100) {
  const file = createTestFile();
  savePageMode(file, imageScale);
  const contents = createImageContents();
  mocks.rendition.getContents.mockReturnValue([contents]);

  const view = render(<Reader file={file} onClose={() => {}} />);
  await waitFor(() => expect(mocks.rendition.display).toHaveBeenCalled());
  const contentHook = mocks.rendition.hooks.content.register.mock.calls.at(-1)?.[0] as
    | ((value: ReturnType<typeof createImageContents>) => void)
    | undefined;
  expect(contentHook).toBeTypeOf("function");
  act(() => contentHook?.(contents));

  return { ...view, contents, image: contents.document.querySelector("img") as HTMLImageElement };
}

function swipe(image: HTMLImageElement, start: TouchPoint, end: TouchPoint) {
  act(() => {
    dispatchTouchEvent(image, "touchstart", [start], [start]);
    dispatchTouchEvent(
      image,
      "touchmove",
      [{ clientX: (start.clientX + end.clientX) / 2, clientY: (start.clientY + end.clientY) / 2 }]
    );
    dispatchTouchEvent(image, "touchend", [], [end]);
  });
}

describe("Reader vertical page swipes", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.rendition.manager.container = document.createElement("div");
    mocks.rendition.getContents.mockReturnValue([]);
    mocks.book.package.metadata.layout = "pre-paginated";
    mocks.book.displayOptions.fixedLayout = "true";
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
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

  it("turns next on an upward swipe and previous on a downward swipe", async () => {
    const { image } = await renderPageReader();
    setVisualImageBounds(image, { top: 0, bottom: 551 });

    swipe(image, { clientX: 195, clientY: 650 }, { clientX: 198, clientY: 500 });
    await waitFor(() => expect(mocks.rendition.next).toHaveBeenCalledOnce());

    await new Promise((resolve) => window.setTimeout(resolve, 220));
    swipe(image, { clientX: 195, clientY: 250 }, { clientX: 192, clientY: 410 });
    await waitFor(() => expect(mocks.rendition.prev).toHaveBeenCalledOnce());
  });

  it("keeps a zoomed image pannable until a fresh swipe starts at its bottom edge", async () => {
    const { image } = await renderPageReader(200);

    setVisualImageBounds(image, { top: -130, bottom: 971, width: 780 });
    swipe(image, { clientX: 195, clientY: 650 }, { clientX: 195, clientY: 490 });
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(mocks.rendition.next).not.toHaveBeenCalled();

    setVisualImageBounds(image, { top: -257, bottom: 844, width: 780 });
    swipe(image, { clientX: 195, clientY: 650 }, { clientX: 195, clientY: 490 });
    await waitFor(() => expect(mocks.rendition.next).toHaveBeenCalledOnce());
  });

  it("uses a fresh downward swipe at the top edge for the previous page", async () => {
    const { image } = await renderPageReader(200);
    setVisualImageBounds(image, { top: 0, bottom: 1101, width: 780 });

    swipe(image, { clientX: 195, clientY: 250 }, { clientX: 195, clientY: 410 });
    await waitFor(() => expect(mocks.rendition.prev).toHaveBeenCalledOnce());
  });

  it("does not treat a horizontal gesture or a two-finger pinch as a page swipe", async () => {
    const { image } = await renderPageReader();
    setVisualImageBounds(image, { top: 0, bottom: 551 });

    swipe(image, { clientX: 80, clientY: 500 }, { clientX: 250, clientY: 440 });
    act(() => {
      dispatchTouchEvent(
        image,
        "touchstart",
        [
          { clientX: 140, clientY: 420 },
          { clientX: 250, clientY: 420 }
        ],
        []
      );
      dispatchTouchEvent(
        image,
        "touchmove",
        [
          { clientX: 100, clientY: 420 },
          { clientX: 290, clientY: 420 }
        ],
        []
      );
      dispatchTouchEvent(image, "touchend", [], [{ clientX: 100, clientY: 420 }]);
    });
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(mocks.rendition.next).not.toHaveBeenCalled();
    expect(mocks.rendition.prev).not.toHaveBeenCalled();
  });
});
