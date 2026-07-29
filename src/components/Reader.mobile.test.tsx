import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    getContents: vi.fn(() => []),
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

const LARGE_FILE_SIZE = 33 * 1024 * 1024;

function createTestFile(name: string, lastModified: number) {
  const file = new File([new Uint8Array(1024)], name, {
    type: "application/epub+zip",
    lastModified
  });
  const arrayBuffer = vi.fn(async () => new ArrayBuffer(1024));
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: arrayBuffer });
  return { file, arrayBuffer };
}

describe("Reader mobile scroll controls", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.rendition.manager.container = document.createElement("div");
    mocks.book.replacements = vi.fn(async () => undefined);
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
});
