import { useEffect, useMemo, useRef, useState } from "react";
import ePub from "epubjs";
import type { Book, Location, NavItem, Rendition } from "epubjs";
import {
  loadReaderState,
  saveReaderState,
  type ReaderTheme,
  type ReadingMode
} from "../lib/storage";
import { formatReadingModeLabel } from "../lib/readerLabels";
import { getRenditionOptions } from "../lib/renditionOptions";
import { isNearScrollEnd, primeContinuousScroll } from "../lib/scrollAdvance";

type ReaderProps = {
  file: File;
  onClose: () => void;
};

type LoadStatus = "loading" | "ready" | "error";
type ReaderSheet = "toc" | "settings" | null;

export function Reader({ file, onClose }: ReaderProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const autoAdvanceCleanupRef = useRef<(() => void) | null>(null);
  const savedState = useMemo(() => loadReaderState(), []);
  const restoreCfiRef = useRef<string | null>(savedState.cfi);
  const latestSettingsRef = useRef({
    fontScale: savedState.fontScale,
    lineHeight: savedState.lineHeight,
    readingMode: savedState.readingMode,
    theme: savedState.theme
  });
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState("正在打开 EPUB...");
  const [title, setTitle] = useState(file.name);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentCfi, setCurrentCfi] = useState<string | null>(savedState.cfi);
  const [fontScale, setFontScale] = useState(savedState.fontScale);
  const [lineHeight, setLineHeight] = useState(savedState.lineHeight);
  const [readingMode, setReadingMode] = useState<ReadingMode>(savedState.readingMode);
  const [theme, setTheme] = useState<ReaderTheme>(savedState.theme);
  const [activeSheet, setActiveSheet] = useState<ReaderSheet>(null);

  latestSettingsRef.current = { fontScale, lineHeight, readingMode, theme };

  useEffect(() => {
    let cancelled = false;
    const host = mountRef.current;
    if (!host) {
      return undefined;
    }

    async function openBook(hostElement: HTMLDivElement) {
      setStatus("loading");
      setMessage("正在读取书籍...");

      try {
        const buffer = await file.arrayBuffer();
        if (cancelled) {
          return;
        }

        const book = ePub(buffer, { replacements: "blobUrl" });
        const rendition = book.renderTo(hostElement, getRenditionOptions(readingMode));

        bookRef.current = book;
        renditionRef.current = rendition;
        registerThemes(rendition);
        applyReaderStyle(rendition, theme, fontScale, lineHeight);

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
          saveReaderState({ cfi, ...latest });
        });

        try {
          await rendition.display(restoreCfiRef.current ?? savedState.cfi ?? undefined);
        } catch {
          await rendition.display();
        }

        autoAdvanceCleanupRef.current?.();
        autoAdvanceCleanupRef.current =
          readingMode === "scroll" ? attachScrollAutoAdvance(hostElement, rendition) : null;

        if (!cancelled) {
          setStatus("ready");
          setMessage("");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("这本 EPUB 暂时打不开。可以换一本普通流式 EPUB 试试。");
        }
      }
    }

    void openBook(host);

    return () => {
      cancelled = true;
      autoAdvanceCleanupRef.current?.();
      autoAdvanceCleanupRef.current = null;
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

    applyReaderStyle(rendition, theme, fontScale, lineHeight);
    saveReaderState({ cfi: currentCfi, fontScale, lineHeight, readingMode, theme });
  }, [currentCfi, fontScale, lineHeight, readingMode, theme]);

  async function goToChapter(href: string) {
    await renditionRef.current?.display(href);
    setActiveSheet(null);
  }

  function toggleTheme() {
    setTheme((value) => (value === "paper" ? "night" : "paper"));
  }

  function toggleReadingMode() {
    setReadingMode((value) => (value === "scroll" ? "page" : "scroll"));
  }

  return (
    <section className={`reader-shell ${theme} ${readingMode}`} aria-label="EPUB reader">
      <header className="reader-topbar">
        <button className="icon-text-button" type="button" onClick={onClose}>
          返回
        </button>
        <div className="book-title">
          <span>正在阅读</span>
          <strong>{title}</strong>
        </div>
      </header>

      <div className="reader-layout">
        <TocPanel toc={toc} onSelect={(href) => void goToChapter(href)} variant="desktop" />

        <div className="reader-stage">
          {status !== "ready" ? <div className={`reader-message ${status}`}>{message}</div> : null}
          <div ref={mountRef} className="rendition-root" />
        </div>
      </div>

      <nav className="bottom-toolbar" aria-label="阅读控制">
        <button type="button" onClick={() => setActiveSheet("toc")}>
          目录
        </button>
        <button type="button" onClick={() => void renditionRef.current?.prev()}>
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
        <button type="button" onClick={() => void renditionRef.current?.next()}>
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

function attachScrollAutoAdvance(hostElement: HTMLElement, rendition: Rendition): () => void {
  const scroller = hostElement.querySelector<HTMLElement>(".epub-container");
  if (!scroller) {
    return () => {};
  }
  const scrollElement = scroller;

  let locked = false;
  let touchStartY: number | null = null;

  async function advanceIfNeeded() {
    if (locked || !isNearScrollEnd(scrollElement, 480)) {
      return;
    }

    locked = true;
    try {
      const didPrime = await primeContinuousScroll(rendition);
      if (!didPrime) {
        await rendition.next();
      }
    } catch {
      await rendition.next();
    } finally {
      window.setTimeout(() => {
        locked = false;
      }, 250);
    }
  }

  function handleScroll() {
    void advanceIfNeeded();
  }

  function handleWheel(event: WheelEvent) {
    if (event.deltaY > 0) {
      void advanceIfNeeded();
    }
  }

  function handleTouchStart(event: TouchEvent) {
    touchStartY = event.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(event: TouchEvent) {
    const currentY = event.touches[0]?.clientY ?? null;
    if (touchStartY !== null && currentY !== null && touchStartY - currentY > 12) {
      void advanceIfNeeded();
    }
  }

  scrollElement.addEventListener("scroll", handleScroll, { passive: true });
  scrollElement.addEventListener("wheel", handleWheel, { passive: true });
  scrollElement.addEventListener("touchstart", handleTouchStart, { passive: true });
  scrollElement.addEventListener("touchmove", handleTouchMove, { passive: true });

  return () => {
    scrollElement.removeEventListener("scroll", handleScroll);
    scrollElement.removeEventListener("wheel", handleWheel);
    scrollElement.removeEventListener("touchstart", handleTouchStart);
    scrollElement.removeEventListener("touchmove", handleTouchMove);
  };
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
  lineHeight: number
) {
  rendition.themes.select(theme);
  rendition.themes.fontSize(`${fontScale}%`);
  rendition.themes.override("line-height", `${lineHeight}%`);
}
