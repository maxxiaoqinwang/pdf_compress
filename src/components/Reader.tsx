import { useEffect, useMemo, useRef, useState } from "react";
import ePub from "epubjs";
import type { Book, Contents, Location, NavItem, Rendition } from "epubjs";
import {
  loadReaderState,
  saveReaderState,
  type ReaderState,
  type ReaderTheme,
  type ReadingMode
} from "../lib/storage";
import {
  getImageScaleStylesheet,
  getPageClickDirection,
  getProgressPercent,
  getScrollImagePageViewHeight,
  getScaledFixedLayoutWidth,
  isTapGesture
} from "../lib/readerInteraction";
import { formatReadingModeLabel } from "../lib/readerLabels";
import { getRenditionOptions } from "../lib/renditionOptions";
import { primeContinuousScroll } from "../lib/scrollAdvance";

type ReaderProps = {
  file: File;
  onClose: () => void;
};

type LoadStatus = "loading" | "ready" | "error";
type ReaderSheet = "toc" | "settings" | null;
type ReaderSettings = Omit<ReaderState, "cfi">;

export function Reader({ file, onClose }: ReaderProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const savedState = useMemo(() => loadReaderState(), []);
  const restoreCfiRef = useRef<string | null>(savedState.cfi);
  const latestSettingsRef = useRef<ReaderSettings>({
    fontScale: savedState.fontScale,
    imageScale: savedState.imageScale,
    lineHeight: savedState.lineHeight,
    readingMode: savedState.readingMode,
    theme: savedState.theme
  });
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState("正在处理文件...");
  const [title, setTitle] = useState(file.name);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentCfi, setCurrentCfi] = useState<string | null>(savedState.cfi);
  const [fontScale, setFontScale] = useState(savedState.fontScale);
  const [imageScale, setImageScale] = useState(savedState.imageScale);
  const [lineHeight, setLineHeight] = useState(savedState.lineHeight);
  const [readingMode, setReadingMode] = useState<ReadingMode>(savedState.readingMode);
  const [theme, setTheme] = useState<ReaderTheme>(savedState.theme);
  const [activeSheet, setActiveSheet] = useState<ReaderSheet>(null);
  const [progressPercent, setProgressPercent] = useState(0);

  latestSettingsRef.current = { fontScale, imageScale, lineHeight, readingMode, theme };

  useEffect(() => {
    let cancelled = false;
    const host = mountRef.current;
    if (!host) {
      return undefined;
    }

    async function openBook(hostElement: HTMLDivElement) {
      setStatus("loading");
      setMessage("正在处理文件...");

      try {
        const buffer = await file.arrayBuffer();
        if (cancelled) {
          return;
        }

        const book = ePub(buffer, { replacements: "blobUrl" });
        const rendition = book.renderTo(hostElement, getRenditionOptions(readingMode));

        bookRef.current = book;
        renditionRef.current = rendition;
        registerContentEnhancements(rendition, latestSettingsRef, () =>
          updateReaderProgress(hostElement, rendition, setProgressPercent, getSpineItemCount(book))
        );
        registerThemes(rendition);
        applyReaderStyle(rendition, theme, fontScale, lineHeight, imageScale, readingMode);

        const [metadata, navigation] = await Promise.all([
          book.loaded.metadata,
          book.loaded.navigation
        ]);

        if (cancelled) {
          return;
        }

        setTitle(typeof metadata.title === "string" && metadata.title ? metadata.title : file.name);
        setToc(navigation.toc ?? []);

        rendition.on("relocated", (location: Location) => {
          const cfi = location.start?.cfi ?? null;
          const latest = latestSettingsRef.current;
          restoreCfiRef.current = cfi;
          setCurrentCfi(cfi);
          setProgressPercent(
            getProgressPercent(location, getSpineItemCount(book)) ||
              getProgressFromRenderedViews(hostElement, getSpineItemCount(book))
          );
          saveReaderState({ cfi, ...latest });
        });

        try {
          await rendition.display(restoreCfiRef.current ?? savedState.cfi ?? undefined);
        } catch {
          await rendition.display();
        }
        updateReaderProgress(hostElement, rendition, setProgressPercent, getSpineItemCount(book));
        if (readingMode === "scroll") {
          void primeContinuousScroll(rendition);
        }

        if (!cancelled) {
          setStatus("ready");
          setMessage("");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Unable to process this file.");
        }
      }
    }

    void openBook(host);

    return () => {
      cancelled = true;
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
  }, [file, readingMode, savedState.cfi]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }

    applyReaderStyle(rendition, theme, fontScale, lineHeight, imageScale, readingMode);
    saveReaderState({ cfi: currentCfi, fontScale, imageScale, lineHeight, readingMode, theme });
  }, [currentCfi, fontScale, imageScale, lineHeight, readingMode, theme]);

  async function goToChapter(href: string) {
    await renditionRef.current?.display(href);
    updateReaderProgress(
      mountRef.current,
      renditionRef.current,
      setProgressPercent,
      getSpineItemCount(bookRef.current)
    );
    setActiveSheet(null);
  }

  function toggleTheme() {
    setTheme((value) => (value === "paper" ? "night" : "paper"));
  }

  function toggleReadingMode() {
    setReadingMode((value) => (value === "scroll" ? "page" : "scroll"));
  }

  async function turnPage(direction: "prev" | "next") {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }

    if (direction === "next") {
      await rendition.next();
    } else {
      await rendition.prev();
    }

    updateReaderProgress(mountRef.current, rendition, setProgressPercent, getSpineItemCount(bookRef.current));
  }

  function handleStageClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || activeSheet || status !== "ready") {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const direction = getPageClickDirection({
      readingMode,
      clientX: event.clientX,
      boundsLeft: bounds.left,
      boundsWidth: bounds.width
    });

    if (!direction) {
      return;
    }

    void turnPage(direction);
  }

  return (
    <section className={`reader-shell ${theme} ${readingMode}`} aria-label="Document preview">
      <header className="reader-topbar">
        <button className="icon-text-button" type="button" onClick={onClose}>
          返回
        </button>
        <div className="book-title">
          <span>正在阅读</span>
          <strong>{title}</strong>
        </div>
      </header>
      <div
        className="reader-progress"
        role="progressbar"
        aria-label="阅读进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
      >
        <div className="reader-progress-fill" style={{ width: `${progressPercent}%` }} />
        <span>{progressPercent}%</span>
      </div>

      <div className="reader-layout">
        <div className="reader-stage" onClick={handleStageClick}>
          {status !== "ready" ? <div className={`reader-message ${status}`}>{message}</div> : null}
          <div ref={mountRef} className="rendition-root" />
        </div>
      </div>

      <nav className="bottom-toolbar" aria-label="阅读控制">
        <button type="button" onClick={() => setActiveSheet("toc")}>
          目录
        </button>
        <button type="button" onClick={() => void turnPage("prev")}>
          上章
        </button>
        <button type="button" onClick={() => setActiveSheet("settings")}>
          Aa
        </button>
        <button type="button" onClick={toggleReadingMode}>
          {formatReadingModeLabel(readingMode)}
        </button>
        <button type="button" onClick={toggleTheme}>
          {theme === "paper" ? "夜间" : "日间"}
        </button>
        <button type="button" onClick={() => void turnPage("next")}>
          下章
        </button>
      </nav>

      {activeSheet ? (
        <div className="sheet-backdrop" onClick={() => setActiveSheet(null)}>
          <section className="reader-sheet" onClick={(event) => event.stopPropagation()}>
            <header className="sheet-header">
              <h2>{activeSheet === "toc" ? "目录" : "阅读设置"}</h2>
              <button type="button" onClick={() => setActiveSheet(null)}>
                关闭
              </button>
            </header>
            {activeSheet === "toc" ? (
              <TocPanel toc={toc} onSelect={(href) => void goToChapter(href)} variant="sheet" />
            ) : (
              <div className="settings-panel">
                <SettingStepper
                  label="字号"
                  value={`${fontScale}%`}
                  onDecrease={() => setFontScale((value) => Math.max(80, value - 10))}
                  onIncrease={() => setFontScale((value) => Math.min(160, value + 10))}
                />
                <SettingStepper
                  label="图片"
                  value={`${imageScale}%`}
                  onDecrease={() => setImageScale((value) => Math.max(100, value - 25))}
                  onIncrease={() => setImageScale((value) => Math.min(250, value + 25))}
                />
                <SettingStepper
                  label="行距"
                  value={`${lineHeight}%`}
                  onDecrease={() => setLineHeight((value) => Math.max(140, value - 10))}
                  onIncrease={() => setLineHeight((value) => Math.min(220, value + 10))}
                />
                <div className="segmented-control" aria-label="阅读模式">
                  <button
                    className={readingMode === "scroll" ? "selected" : ""}
                    type="button"
                    onClick={() => setReadingMode("scroll")}
                  >
                    滚动
                  </button>
                  <button
                    className={readingMode === "page" ? "selected" : ""}
                    type="button"
                    onClick={() => setReadingMode("page")}
                  >
                    分页
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

type TocPanelProps = {
  toc: NavItem[];
  onSelect: (href: string) => void;
  variant: "desktop" | "sheet";
};

function TocPanel({ toc, onSelect, variant }: TocPanelProps) {
  return (
    <nav className={`toc-panel ${variant}`} aria-label="目录">
      {variant === "desktop" ? <h2>目录</h2> : null}
      {toc.length > 0 ? (
        <ol>
          {toc.flatMap((item) => flattenNavItem(item)).map((item) => (
            <li key={`${item.id}-${item.href}`}>
              <button type="button" onClick={() => onSelect(item.href)}>
                {item.label}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>这本书没有可用目录。</p>
      )}
    </nav>
  );
}

function flattenNavItem(item: NavItem): NavItem[] {
  return [item, ...(item.subitems ?? []).flatMap((child) => flattenNavItem(child))];
}

type SettingStepperProps = {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
};

function SettingStepper({ label, value, onDecrease, onIncrease }: SettingStepperProps) {
  return (
    <div className="setting-stepper">
      <span>{label}</span>
      <div>
        <button type="button" onClick={onDecrease}>
          -
        </button>
        <strong>{value}</strong>
        <button type="button" onClick={onIncrease}>
          +
        </button>
      </div>
    </div>
  );
}

function registerContentEnhancements(
  rendition: Rendition,
  settingsRef: { current: ReaderSettings },
  onPageTurn: () => void
) {
  rendition.hooks.content.register((contents: Contents) => {
    applyImageScaleToContent(contents, settingsRef.current);
    installContentPointerBehavior(contents, rendition, settingsRef, onPageTurn);
  });
}

function updateReaderProgress(
  hostElement: HTMLElement | null,
  rendition: Rendition | null,
  setProgressPercent: (value: number) => void,
  spineItemCount?: number
) {
  if (!rendition) {
    return;
  }

  void Promise.resolve(rendition.currentLocation() as unknown).then((location) => {
    setProgressPercent(
      getProgressPercent(location, spineItemCount) ||
        getProgressFromRenderedViews(hostElement, spineItemCount)
    );
  });
}

function getProgressFromRenderedViews(
  hostElement: HTMLElement | null,
  spineItemCount?: number
): number {
  if (!hostElement || !spineItemCount || spineItemCount <= 0) {
    return 0;
  }

  const renderedIndexes = Array.from(hostElement.querySelectorAll<HTMLElement>(".epub-view"))
    .map((view) => Number(view.getAttribute("ref")))
    .filter((index) => Number.isFinite(index));

  if (renderedIndexes.length === 0) {
    return 0;
  }

  const firstVisibleIndex = Math.min(...renderedIndexes);
  return getProgressPercent({ start: { index: firstVisibleIndex } }, spineItemCount);
}

function getSpineItemCount(book: Book | null): number | undefined {
  if (!book) {
    return undefined;
  }

  const spine = (book as unknown as { spine?: { items?: unknown[] } }).spine;
  return Array.isArray(spine?.items) ? spine.items.length : undefined;
}

function applyImageScaleToRenderedContents(rendition: Rendition, settings: ReaderSettings) {
  getRenderedContents(rendition).forEach((contents) => applyImageScaleToContent(contents, settings));
}

function getRenderedContents(rendition: Rendition): Contents[] {
  try {
    const contents = rendition.getContents() as unknown;
    if (Array.isArray(contents)) {
      return contents.filter(Boolean) as Contents[];
    }

    return contents ? [contents as Contents] : [];
  } catch {
    return [];
  }
}

function applyImageScaleToContent(contents: Contents, settings: ReaderSettings) {
  const isSingleImagePage = markSingleImagePage(contents, settings.imageScale);
  contents.addStylesheetCss(getImageScaleStylesheet(settings.imageScale), "reader-image-scale");
  syncSingleImageViewHeight(contents, settings.readingMode, isSingleImagePage);
}

function markSingleImagePage(contents: Contents, imageScale: number): boolean {
  const doc = contents.document;
  const body = doc.body;
  if (!body) {
    return false;
  }

  const images = body.querySelectorAll("img");
  const meaningfulText = body.textContent?.replace(/\s+/g, "") ?? "";
  const isSingleImagePage = images.length === 1 && meaningfulText.length === 0;
  doc.documentElement.classList.toggle("reader-image-page", isSingleImagePage);

  if (!isSingleImagePage) {
    doc.documentElement.style.removeProperty("--reader-fixed-layout-width");
    return false;
  }

  const viewportContent = doc.querySelector("meta[name='viewport']")?.getAttribute("content");
  const scaledWidth = getScaledFixedLayoutWidth(viewportContent, images[0].naturalWidth, imageScale);
  if (scaledWidth) {
    doc.documentElement.style.setProperty("--reader-fixed-layout-width", `${scaledWidth}px`);
  }

  return true;
}

function syncSingleImageViewHeight(
  contents: Contents,
  readingMode: ReadingMode,
  isSingleImagePage: boolean
) {
  const frameElement = contents.window.frameElement as HTMLIFrameElement | null;
  const viewElement = frameElement?.closest(".epub-view") as HTMLElement | null;
  if (!frameElement || !viewElement) {
    return;
  }

  const applyHeight = () => {
    const image = contents.document.querySelector("img");
    const imageHeight = image?.getBoundingClientRect().height ?? 0;
    const viewHeight = getScrollImagePageViewHeight(readingMode, isSingleImagePage, imageHeight);

    if (!viewHeight) {
      frameElement.style.removeProperty("height");
      viewElement.style.removeProperty("height");
      return;
    }

    const height = `${viewHeight}px`;
    frameElement.style.setProperty("height", height);
    viewElement.style.setProperty("height", height);
  };

  applyHeight();
  contents.window.setTimeout(applyHeight, 60);
  contents.window.setTimeout(applyHeight, 250);
}

function installContentPointerBehavior(
  contents: Contents,
  rendition: Rendition,
  settingsRef: { current: ReaderSettings },
  onPageTurn: () => void
) {
  const doc = contents.document as Document & {
    __readerPointerBehaviorInstalled?: boolean;
  };
  if (!doc || doc.__readerPointerBehaviorInstalled) {
    return;
  }
  doc.__readerPointerBehaviorInstalled = true;

  let isDragging = false;
  let didDrag = false;
  let lastX = 0;
  let lastY = 0;
  let touchStart: { x: number; y: number } | null = null;
  let suppressNextClick = false;

  const turnFromClientX = (clientX: number) => {
    const direction = getPageClickDirection({
      readingMode: settingsRef.current.readingMode,
      clientX,
      boundsLeft: 0,
      boundsWidth: contents.window.innerWidth || contents.documentElement.clientWidth
    });
    if (!direction) {
      return false;
    }

    void (direction === "next" ? rendition.next() : rendition.prev()).then(onPageTurn);
    return true;
  };

  doc.addEventListener(
    "mousedown",
    (event) => {
      if (settingsRef.current.imageScale <= 100 || !isImageEventTarget(event.target)) {
        return;
      }

      isDragging = true;
      didDrag = false;
      lastX = event.clientX;
      lastY = event.clientY;
      event.preventDefault();
    },
    true
  );

  doc.addEventListener(
    "mousemove",
    (event) => {
      if (!isDragging) {
        return;
      }

      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) {
        didDrag = true;
      }
      contents.window.scrollBy(-deltaX, -deltaY);
      lastX = event.clientX;
      lastY = event.clientY;
      event.preventDefault();
    },
    true
  );

  const stopDrag = () => {
    isDragging = false;
  };
  doc.addEventListener("mouseup", stopDrag, true);
  doc.addEventListener("mouseleave", stopDrag, true);

  doc.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1 || isInteractiveTarget(event.target)) {
        touchStart = null;
        return;
      }

      const touch = event.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY };
    },
    true
  );

  doc.addEventListener(
    "touchend",
    (event) => {
      const touch = event.changedTouches[0];
      if (!touchStart || !touch || settingsRef.current.readingMode !== "page") {
        touchStart = null;
        return;
      }

      const wasTap = isTapGesture({
        startX: touchStart.x,
        startY: touchStart.y,
        endX: touch.clientX,
        endY: touch.clientY
      });
      touchStart = null;
      if (!wasTap || !turnFromClientX(touch.clientX)) {
        return;
      }

      suppressNextClick = true;
      contents.window.setTimeout(() => {
        suppressNextClick = false;
      }, 450);
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  doc.addEventListener(
    "click",
    (event) => {
      if (suppressNextClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (didDrag) {
        didDrag = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (isInteractiveTarget(event.target) || settingsRef.current.readingMode !== "page") {
        return;
      }

      if (!turnFromClientX(event.clientX)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    },
    true
  );
}

function isImageEventTarget(target: EventTarget | null): boolean {
  const element = asClosestElement(target);
  if (!element) {
    return false;
  }

  return element.nodeName?.toLowerCase() === "img" || Boolean(element.closest("img"));
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return Boolean(
    asClosestElement(target)?.closest("a, button, input, select, textarea, summary, [role='button']")
  );
}

type ClosestElementLike = {
  nodeName?: string;
  closest: (selector: string) => Element | null;
};

function asClosestElement(target: EventTarget | null): ClosestElementLike | null {
  if (!target || typeof target !== "object") {
    return null;
  }

  const candidate = target as Partial<ClosestElementLike>;
  return typeof candidate.closest === "function" ? (candidate as ClosestElementLike) : null;
}

function registerThemes(rendition: Rendition) {
  rendition.themes.register("paper", {
    body: {
      color: "#26231f",
      background: "#fbf7ef",
      "font-family": "Georgia, 'Times New Roman', serif",
      margin: "0 !important",
      padding: "0 1.25rem 5rem !important"
    },
    img: {
      "max-width": "100%",
      height: "auto"
    }
  });

  rendition.themes.register("night", {
    body: {
      color: "#e7e0d5",
      background: "#171613",
      "font-family": "Georgia, 'Times New Roman', serif",
      margin: "0 !important",
      padding: "0 1.25rem 5rem !important"
    },
    a: {
      color: "#d7b56d"
    },
    img: {
      "max-width": "100%",
      height: "auto"
    }
  });
}

function applyReaderStyle(
  rendition: Rendition,
  theme: ReaderTheme,
  fontScale: number,
  lineHeight: number,
  imageScale: number,
  readingMode: ReadingMode
) {
  rendition.themes.select(theme);
  rendition.themes.fontSize(`${fontScale}%`);
  rendition.themes.override("line-height", `${lineHeight}%`);
  applyImageScaleToRenderedContents(rendition, { fontScale, imageScale, lineHeight, readingMode, theme });
}
