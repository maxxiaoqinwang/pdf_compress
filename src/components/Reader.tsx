import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { Book, Contents, Location, NavItem, Rendition } from "epubjs";
import {
  createBookKey,
  loadBookProgress,
  loadReaderPreferences,
  saveBookProgress,
  saveReaderPreferences,
  type GripMode,
  type ReaderPreferences,
  type ReaderTheme,
  type ReadingMode
} from "../lib/storage";
import {
  getImageScaleStylesheet,
  getLocationPercentage,
  getLocationSpineIndex,
  getPageClickDirection,
  getPageImageFrameHeight,
  getPinchImageScale,
  getProgressPercent,
  getScaledFixedLayoutWidth,
  getScrollImagePageViewHeight,
  getSwipeDirection,
  getToolbarPageControls,
  getTouchDistance,
  isTapGesture,
  type PageClickDirection
} from "../lib/readerInteraction";
import { getRenditionOptions } from "../lib/renditionOptions";
import { primeContinuousScroll } from "../lib/scrollAdvance";

type ReaderProps = {
  file: File;
  onClose: () => void;
};

type LoadStatus = "loading" | "ready" | "error";
type ReaderSheet = "toc" | "settings" | null;
type ReaderSettings = ReaderPreferences & { readingMode: ReadingMode };
type ProgressSnapshot = {
  percent: number;
  label: string;
};

type ReaderDocument = Document & {
  __readerPointerBehaviorInstalled?: boolean;
  __readerImageHeightCleanup?: () => void;
};

const COMPACT_READER_QUERY =
  "(max-width: 760px), (pointer: coarse) and (max-height: 500px)";
const LARGE_BOOK_THRESHOLD = 50 * 1024 * 1024;
const PROGRESS_SAVE_DELAY = 650;

export function Reader({ file, onClose }: ReaderProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const pageTurnLockedRef = useRef(false);
  const statusRef = useRef<LoadStatus>("loading");
  const progressSaveTimerRef = useRef<number | null>(null);
  const activeSheetRef = useRef<ReaderSheet>(null);
  const sheetHistoryActiveRef = useRef(false);
  const readerHistoryActiveRef = useRef(false);
  const locationsReadyRef = useRef(false);
  const bookLayoutRef = useRef<string>("");
  const onCloseRef = useRef(onClose);

  const bookKey = useMemo(() => createBookKey(file), [file]);
  const savedPreferences = useMemo(() => loadReaderPreferences(), []);
  const savedProgress = useMemo(() => loadBookProgress(bookKey), [bookKey]);
  const restoreCfiRef = useRef<string | null>(savedProgress.cfi);
  const latestSettingsRef = useRef<ReaderSettings>({
    ...savedPreferences,
    readingMode: savedProgress.readingMode
  });
  const latestProgressRef = useRef({
    cfi: savedProgress.cfi,
    percentage: savedProgress.percentage,
    readingMode: savedProgress.readingMode
  });
  const uiActionsRef = useRef({
    toggleControls: () => {},
    hideControls: () => {}
  });

  const [book, setBook] = useState<Book | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState(getOpeningMessage(file));
  const [title, setTitle] = useState(file.name);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentCfi, setCurrentCfi] = useState<string | null>(savedProgress.cfi);
  const [fontScale, setFontScale] = useState(savedPreferences.fontScale);
  const [gripMode, setGripMode] = useState<GripMode>(savedPreferences.gripMode);
  const [imageScale, setImageScale] = useState(savedPreferences.imageScale);
  const [lineHeight, setLineHeight] = useState(savedPreferences.lineHeight);
  const [readingMode, setReadingMode] = useState<ReadingMode>(savedProgress.readingMode);
  const [theme, setTheme] = useState<ReaderTheme>(savedPreferences.theme);
  const [activeSheet, setActiveSheet] = useState<ReaderSheet>(null);
  const [progressPercent, setProgressPercent] = useState(savedProgress.percentage ?? 0);
  const [progressLabel, setProgressLabel] = useState(
    savedProgress.percentage === null ? "开始" : `${savedProgress.percentage}%`
  );
  const [isCompactViewport, setIsCompactViewport] = useState(readCompactViewport);
  const [controlsVisible, setControlsVisible] = useState(true);

  const pageControls = getToolbarPageControls(gripMode);

  onCloseRef.current = onClose;
  statusRef.current = status;
  activeSheetRef.current = activeSheet;
  latestSettingsRef.current = {
    fontScale,
    gripMode,
    imageScale,
    lineHeight,
    readingMode,
    theme
  };
  latestProgressRef.current = {
    cfi: currentCfi,
    percentage: progressPercent,
    readingMode
  };
  uiActionsRef.current = {
    toggleControls: () => {
      if (isCompactViewport && activeSheetRef.current === null) {
        setControlsVisible((visible) => !visible);
      }
    },
    hideControls: () => {
      if (isCompactViewport && activeSheetRef.current === null) {
        setControlsVisible(false);
      }
    }
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia?.(COMPACT_READER_QUERY);
    if (!mediaQuery) {
      return undefined;
    }

    const update = () => setIsCompactViewport(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!isCompactViewport) {
      setControlsVisible(true);
      return undefined;
    }

    if (status !== "ready" || activeSheet || !controlsVisible) {
      return undefined;
    }

    const timer = window.setTimeout(() => setControlsVisible(false), 4500);
    return () => window.clearTimeout(timer);
  }, [activeSheet, controlsVisible, isCompactViewport, status]);

  useEffect(() => {
    const marker = `epub-reader-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.history.pushState({ ...window.history.state, __epubReader: marker }, "");
    readerHistoryActiveRef.current = true;

    const handlePopState = () => {
      if (activeSheetRef.current) {
        sheetHistoryActiveRef.current = false;
        activeSheetRef.current = null;
        setActiveSheet(null);
        setControlsVisible(true);
        return;
      }

      readerHistoryActiveRef.current = false;
      onCloseRef.current();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!activeSheet) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => sheetRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeSheet]);

  useEffect(() => {
    const themeColor = theme === "night" ? "#171613" : "#f6f1e8";
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousThemeColor = themeMeta?.content;
    const previousColorScheme = document.documentElement.style.colorScheme;
    const previousBodyTheme = document.body.dataset.readerTheme;

    if (themeMeta) {
      themeMeta.content = themeColor;
    }
    document.documentElement.style.colorScheme = theme === "night" ? "dark" : "light";
    document.body.dataset.readerTheme = theme;

    return () => {
      if (themeMeta && previousThemeColor) {
        themeMeta.content = previousThemeColor;
      }
      document.documentElement.style.colorScheme = previousColorScheme;
      if (previousBodyTheme) {
        document.body.dataset.readerTheme = previousBodyTheme;
      } else {
        delete document.body.dataset.readerTheme;
      }
    };
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    let loadedBook: Book | null = null;

    setStatus("loading");
    setMessage(getOpeningMessage(file));
    setTitle(file.name);
    setToc([]);
    setBook(null);
    setProgressPercent(savedProgress.percentage ?? 0);
    setProgressLabel(savedProgress.percentage === null ? "开始" : `${savedProgress.percentage}%`);
    locationsReadyRef.current = false;
    bookLayoutRef.current = "";

    async function loadBook() {
      try {
        const [buffer, epubModule] = await Promise.all([file.arrayBuffer(), import("epubjs")]);
        if (cancelled) {
          return;
        }

        loadedBook = epubModule.default(buffer, { replacements: "blobUrl" });
        bookRef.current = loadedBook;

        const [metadata, navigation] = await Promise.all([
          loadedBook.loaded.metadata,
          loadedBook.loaded.navigation
        ]);
        if (cancelled) {
          return;
        }

        bookLayoutRef.current = metadata.layout ?? "";
        setBook(loadedBook);
        setTitle(typeof metadata.title === "string" && metadata.title ? metadata.title : file.name);
        setToc(navigation.toc ?? []);
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("无法打开这个文件，请确认它是完整的 EPUB 文件。");
        }
      }
    }

    void loadBook();

    return () => {
      cancelled = true;
      if (progressSaveTimerRef.current !== null) {
        window.clearTimeout(progressSaveTimerRef.current);
        progressSaveTimerRef.current = null;
      }
      renditionRef.current?.destroy();
      renditionRef.current = null;
      loadedBook?.destroy();
      if (bookRef.current === loadedBook) {
        bookRef.current = null;
      }
    };
  }, [bookKey, file, savedProgress.percentage]);

  useEffect(() => {
    if (!book || file.size > LARGE_BOOK_THRESHOLD || bookLayoutRef.current === "pre-paginated") {
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void book.locations
        .generate(1400)
        .then(() => {
          if (cancelled) {
            return;
          }
          locationsReadyRef.current = true;
          refreshCurrentProgress();
        })
        .catch(() => {
          // Chapter-level progress remains available when location generation fails.
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [book, file.size]);

  useEffect(() => {
    const host = mountRef.current;
    if (!book || !host) {
      return undefined;
    }

    let cancelled = false;
    let scrollContainer: HTMLElement | null = null;
    const handleReaderScroll = () => uiActionsRef.current.hideControls();
    const rendition = book.renderTo(host, getRenditionOptions(readingMode));
    renditionRef.current = rendition;
    setStatus("loading");
    setMessage(readingMode === "scroll" ? "正在切换到滚动阅读…" : "正在切换到分页阅读…");

    registerContentEnhancements(
      rendition,
      latestSettingsRef,
      (direction) => void turnPage(direction),
      (nextImageScale) => setImageScale(nextImageScale),
      () => uiActionsRef.current.toggleControls()
    );
    registerThemes(rendition);
    applyReaderStyle(
      rendition,
      theme,
      fontScale,
      lineHeight,
      imageScale,
      readingMode,
      gripMode
    );

    const handleRelocated = (location: Location) => {
      updateProgressFromLocation(location, book);
    };
    rendition.on("relocated", handleRelocated);

    async function displayBook() {
      try {
        try {
          await rendition.display(restoreCfiRef.current ?? undefined);
        } catch {
          restoreCfiRef.current = null;
          await rendition.display();
        }

        if (cancelled) {
          return;
        }

        scrollContainer = getRenditionScrollContainer(rendition);
        if (readingMode === "scroll") {
          scrollContainer?.addEventListener("scroll", handleReaderScroll, {
            passive: true
          });
          void primeContinuousScroll(rendition);
        }

        setStatus("ready");
        setMessage("");
        refreshCurrentProgress();
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("文件已读取，但这一页无法显示。请尝试切换阅读模式。");
        }
      }
    }

    void displayBook();

    return () => {
      cancelled = true;
      scrollContainer?.removeEventListener("scroll", handleReaderScroll);
      rendition.off("relocated", handleRelocated);
      rendition.destroy();
      if (renditionRef.current === rendition) {
        renditionRef.current = null;
      }
      host.replaceChildren();
    };
  }, [book, readingMode]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }

    applyReaderStyle(
      rendition,
      theme,
      fontScale,
      lineHeight,
      imageScale,
      readingMode,
      gripMode
    );
  }, [fontScale, gripMode, imageScale, lineHeight, readingMode, theme]);

  useEffect(() => {
    saveReaderPreferences({ fontScale, gripMode, imageScale, lineHeight, theme });
  }, [fontScale, gripMode, imageScale, lineHeight, theme]);

  useEffect(() => {
    scheduleProgressSave(currentCfi, progressPercent, readingMode);
  }, [currentCfi, progressPercent, readingMode]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        flushProgressSave();
      }
    };

    window.addEventListener("pagehide", flushProgressSave);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushProgressSave);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flushProgressSave();
    };
  }, [bookKey]);

  async function goToChapter(href: string) {
    try {
      await renditionRef.current?.display(href);
      refreshCurrentProgress();
    } catch {
      // Keep the reader usable when an EPUB contains a broken table-of-contents link.
    } finally {
      requestCloseSheet();
    }
  }

  async function turnPage(direction: PageClickDirection) {
    const rendition = renditionRef.current;
    if (!rendition || pageTurnLockedRef.current || statusRef.current !== "ready") {
      return;
    }

    pageTurnLockedRef.current = true;
    try {
      if (direction === "next") {
        await rendition.next();
      } else {
        await rendition.prev();
      }
      refreshCurrentProgress();
    } catch {
      // Some malformed EPUBs expose empty spine items. Ignore the failed turn.
    } finally {
      window.setTimeout(() => {
        pageTurnLockedRef.current = false;
      }, 180);
    }
  }

  function updateProgressFromLocation(location: unknown, currentBook = bookRef.current) {
    if (!currentBook) {
      return;
    }

    const cfi = getLocationCfi(location);
    if (cfi) {
      restoreCfiRef.current = cfi;
      setCurrentCfi(cfi);
    }

    const snapshot = getProgressSnapshot(
      location,
      currentBook,
      locationsReadyRef.current,
      bookLayoutRef.current
    );
    setProgressPercent(snapshot.percent);
    setProgressLabel(snapshot.label);
    scheduleProgressSave(cfi ?? restoreCfiRef.current, snapshot.percent, latestSettingsRef.current.readingMode);
  }

  function refreshCurrentProgress() {
    const rendition = renditionRef.current;
    const currentBook = bookRef.current;
    if (!rendition || !currentBook) {
      return;
    }

    void Promise.resolve(rendition.currentLocation() as unknown)
      .then((location) => updateProgressFromLocation(location, currentBook))
      .catch(() => {});
  }

  function scheduleProgressSave(
    cfi: string | null,
    percentage: number | null,
    mode: ReadingMode
  ) {
    latestProgressRef.current = { cfi, percentage, readingMode: mode };
    if (progressSaveTimerRef.current !== null) {
      window.clearTimeout(progressSaveTimerRef.current);
    }

    progressSaveTimerRef.current = window.setTimeout(() => {
      progressSaveTimerRef.current = null;
      flushProgressSave();
    }, PROGRESS_SAVE_DELAY);
  }

  function flushProgressSave() {
    if (progressSaveTimerRef.current !== null) {
      window.clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }

    const latest = latestProgressRef.current;
    saveBookProgress(bookKey, {
      cfi: latest.cfi,
      percentage: latest.percentage,
      readingMode: latest.readingMode,
      updatedAt: Date.now()
    });
  }

  function openSheet(sheet: Exclude<ReaderSheet, null>) {
    setControlsVisible(true);
    if (!activeSheetRef.current) {
      window.history.pushState({ ...window.history.state, __epubReaderSheet: sheet }, "");
      sheetHistoryActiveRef.current = true;
    }
    activeSheetRef.current = sheet;
    setActiveSheet(sheet);
  }

  function requestCloseSheet() {
    if (sheetHistoryActiveRef.current) {
      window.history.back();
      return;
    }

    activeSheetRef.current = null;
    setActiveSheet(null);
  }

  function requestCloseReader() {
    if (activeSheetRef.current) {
      requestCloseSheet();
      return;
    }

    flushProgressSave();
    if (readerHistoryActiveRef.current) {
      window.history.back();
    } else {
      onCloseRef.current();
    }
  }

  function handleStageClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget || event.target === mountRef.current) {
      uiActionsRef.current.toggleControls();
    }
  }

  const chromeIsVisible = !isCompactViewport || controlsVisible || activeSheet !== null || status !== "ready";

  return (
    <section
      className={`reader-shell ${theme} ${readingMode} ${
        chromeIsVisible ? "controls-visible" : "controls-hidden"
      }`}
      aria-label="EPUB 阅读器"
    >
      <div className="reader-chrome-top" aria-hidden={!chromeIsVisible}>
        <header className="reader-topbar">
          <button className="icon-text-button" type="button" onClick={requestCloseReader}>
            返回
          </button>
          <div className="book-title">
            <span>正在阅读</span>
            <strong>{title}</strong>
          </div>
          <span className="progress-label" aria-live="polite">
            {progressLabel}
          </span>
        </header>
        <div
          className="reader-progress"
          role="progressbar"
          aria-label="阅读进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
          aria-valuetext={progressLabel}
        >
          <div className="reader-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="reader-layout">
        <div className="reader-stage" onClick={handleStageClick}>
          {status !== "ready" ? (
            <div className={`reader-message ${status}`} aria-live="polite">
              {message}
            </div>
          ) : null}
          <div ref={mountRef} className="rendition-root" />
        </div>
      </div>

      <nav className="bottom-toolbar" aria-label="阅读控制" aria-hidden={!chromeIsVisible}>
        <button
          type="button"
          aria-label={getNavigationLabel(pageControls[0].direction, readingMode)}
          onClick={() => void turnPage(pageControls[0].direction)}
        >
          <span aria-hidden="true">{pageControls[0].direction === "prev" ? "‹" : "›"}</span>
          {getNavigationLabel(pageControls[0].direction, readingMode)}
        </button>
        <button type="button" onClick={() => openSheet("toc")}>
          <span aria-hidden="true">☰</span>
          目录
        </button>
        <button type="button" onClick={() => openSheet("settings")}>
          <span aria-hidden="true">Aa</span>
          设置
        </button>
        <button
          type="button"
          aria-label={getNavigationLabel(pageControls[1].direction, readingMode)}
          onClick={() => void turnPage(pageControls[1].direction)}
        >
          <span aria-hidden="true">{pageControls[1].direction === "prev" ? "‹" : "›"}</span>
          {getNavigationLabel(pageControls[1].direction, readingMode)}
        </button>
      </nav>

      {activeSheet ? (
        <div className="sheet-backdrop" onClick={requestCloseSheet}>
          <section
            ref={sheetRef}
            className="reader-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reader-sheet-title"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sheet-header">
              <h2 id="reader-sheet-title">{activeSheet === "toc" ? "目录" : "阅读设置"}</h2>
              <button type="button" onClick={requestCloseSheet}>
                关闭
              </button>
            </header>
            {activeSheet === "toc" ? (
              <TocPanel toc={toc} onSelect={(href) => void goToChapter(href)} />
            ) : (
              <div className="settings-panel">
                <SettingStepper
                  label="字号"
                  value={`${fontScale}%`}
                  canDecrease={fontScale > 80}
                  canIncrease={fontScale < 160}
                  onDecrease={() => setFontScale((value) => Math.max(80, value - 10))}
                  onIncrease={() => setFontScale((value) => Math.min(160, value + 10))}
                />
                <SettingStepper
                  label="行距"
                  value={`${lineHeight}%`}
                  canDecrease={lineHeight > 140}
                  canIncrease={lineHeight < 220}
                  onDecrease={() => setLineHeight((value) => Math.max(140, value - 10))}
                  onIncrease={() => setLineHeight((value) => Math.min(220, value + 10))}
                />
                <SettingStepper
                  label="图片缩放"
                  value={`${imageScale}%`}
                  canDecrease={imageScale > 100}
                  canIncrease={imageScale < 400}
                  onDecrease={() => setImageScale((value) => Math.max(100, value - 25))}
                  onIncrease={() => setImageScale((value) => Math.min(400, value + 25))}
                />

                <SettingGroup label="阅读模式">
                  <div className="segmented-control" aria-label="阅读模式">
                    <button
                      className={readingMode === "scroll" ? "selected" : ""}
                      type="button"
                      aria-pressed={readingMode === "scroll"}
                      onClick={() => setReadingMode("scroll")}
                    >
                      滚动
                    </button>
                    <button
                      className={readingMode === "page" ? "selected" : ""}
                      type="button"
                      aria-pressed={readingMode === "page"}
                      onClick={() => setReadingMode("page")}
                    >
                      分页
                    </button>
                  </div>
                </SettingGroup>

                <SettingGroup label="显示主题">
                  <div className="segmented-control" aria-label="显示主题">
                    <button
                      className={theme === "paper" ? "selected" : ""}
                      type="button"
                      aria-pressed={theme === "paper"}
                      onClick={() => setTheme("paper")}
                    >
                      日间
                    </button>
                    <button
                      className={theme === "night" ? "selected" : ""}
                      type="button"
                      aria-pressed={theme === "night"}
                      onClick={() => setTheme("night")}
                    >
                      夜间
                    </button>
                  </div>
                </SettingGroup>

                <SettingGroup label="持握方式">
                  <div className="segmented-control three" aria-label="持握方式">
                    <button
                      className={gripMode === "right" ? "selected" : ""}
                      type="button"
                      aria-pressed={gripMode === "right"}
                      onClick={() => setGripMode("right")}
                    >
                      右手
                    </button>
                    <button
                      className={gripMode === "left" ? "selected" : ""}
                      type="button"
                      aria-pressed={gripMode === "left"}
                      onClick={() => setGripMode("left")}
                    >
                      左手
                    </button>
                    <button
                      className={gripMode === "both" ? "selected" : ""}
                      type="button"
                      aria-pressed={gripMode === "both"}
                      onClick={() => setGripMode("both")}
                    >
                      双手
                    </button>
                  </div>
                </SettingGroup>
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
};

function TocPanel({ toc, onSelect }: TocPanelProps) {
  return (
    <nav className="toc-panel sheet" aria-label="目录">
      {toc.length > 0 ? <TocList items={toc} onSelect={onSelect} depth={0} /> : <p>这本书没有可用目录。</p>}
    </nav>
  );
}

function TocList({
  items,
  onSelect,
  depth
}: {
  items: NavItem[];
  onSelect: (href: string) => void;
  depth: number;
}) {
  return (
    <ol>
      {items.map((item, index) => (
        <li key={`${item.id ?? index}-${item.href}`}>
          <button
            type="button"
            style={{ "--toc-depth": depth } as CSSProperties}
            onClick={() => onSelect(item.href)}
          >
            {item.label}
          </button>
          {item.subitems?.length ? (
            <TocList items={item.subitems} onSelect={onSelect} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

type SettingStepperProps = {
  label: string;
  value: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
};

function SettingStepper({
  label,
  value,
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease
}: SettingStepperProps) {
  return (
    <div className="setting-stepper">
      <span>{label}</span>
      <div>
        <button type="button" disabled={!canDecrease} aria-label={`减小${label}`} onClick={onDecrease}>
          −
        </button>
        <strong>{value}</strong>
        <button type="button" disabled={!canIncrease} aria-label={`增大${label}`} onClick={onIncrease}>
          +
        </button>
      </div>
    </div>
  );
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="setting-group">
      <span>{label}</span>
      {children}
    </div>
  );
}

function registerContentEnhancements(
  rendition: Rendition,
  settingsRef: { current: ReaderSettings },
  onPageTurn: (direction: PageClickDirection) => void,
  onImageScaleChange: (nextImageScale: number) => void,
  onToggleControls: () => void
) {
  rendition.hooks.content.register((contents: Contents) => {
    applyImageScaleToContent(contents, settingsRef.current);
    installContentPointerBehavior(
      contents,
      settingsRef,
      onPageTurn,
      onImageScaleChange,
      onToggleControls
    );
  });
}

function getProgressSnapshot(
  location: unknown,
  book: Book,
  locationsReady: boolean,
  bookLayout: string
): ProgressSnapshot {
  const cfi = getLocationCfi(location);
  if (locationsReady && cfi) {
    try {
      const percentage = book.locations.percentageFromCfi(cfi);
      if (Number.isFinite(percentage)) {
        const percent = Math.round(Math.min(1, Math.max(0, percentage)) * 100);
        return { percent, label: `${percent}%` };
      }
    } catch {
      // Fall through to epub.js location data or chapter-level progress.
    }
  }

  const explicitPercentage = getLocationPercentage(location);
  if (explicitPercentage !== null) {
    const percent = getProgressPercent(location);
    return { percent, label: `${percent}%` };
  }

  const spineItemCount = getSpineItemCount(book);
  const spineIndex = getLocationSpineIndex(location);
  if (spineItemCount && spineIndex !== null) {
    const percent = getProgressPercent(location, spineItemCount);
    const unit = bookLayout === "pre-paginated" ? "页" : "章";
    return {
      percent,
      label: `第 ${Math.min(spineItemCount, spineIndex + 1)}/${spineItemCount} ${unit}`
    };
  }

  return { percent: 0, label: "开始" };
}

function getLocationCfi(location: unknown): string | null {
  if (!location || typeof location !== "object") {
    return null;
  }

  const candidate = location as { cfi?: unknown; start?: { cfi?: unknown } };
  if (typeof candidate.start?.cfi === "string") {
    return candidate.start.cfi;
  }

  return typeof candidate.cfi === "string" ? candidate.cfi : null;
}

function getSpineItemCount(book: Book | null): number | undefined {
  if (!book) {
    return undefined;
  }

  const items = (book.spine as unknown as { items?: unknown[] }).items;
  return Array.isArray(items) ? items.length : undefined;
}

function getRenditionScrollContainer(rendition: Rendition): HTMLElement | null {
  const manager = (rendition as unknown as { manager?: { container?: unknown } }).manager;
  return manager?.container instanceof HTMLElement ? manager.container : null;
}

function getNavigationLabel(direction: PageClickDirection, readingMode: ReadingMode): string {
  if (readingMode === "page") {
    return direction === "prev" ? "上一页" : "下一页";
  }

  return direction === "prev" ? "上一章" : "下一章";
}

function readCompactViewport(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(COMPACT_READER_QUERY).matches);
}

function getOpeningMessage(file: File): string {
  return file.size > LARGE_BOOK_THRESHOLD
    ? "文件较大，正在本机读取，请稍候…"
    : "正在打开文件…";
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

function applyImageScaleToContent(
  contents: Contents,
  settings: ReaderSettings,
  syncHeight = true
) {
  const isSingleImagePage = markSingleImagePage(contents, settings.imageScale, settings.readingMode);
  void contents
    .addStylesheetCss(
      getImageScaleStylesheet(settings.imageScale),
      "reader-image-scale"
    )
    .catch(() => {
      // A rendition can be destroyed while the stylesheet promise is pending.
    });
  if (syncHeight) {
    syncSingleImageViewHeight(
      contents,
      settings.readingMode,
      isSingleImagePage,
      settings.imageScale
    );
  }
}

function markSingleImagePage(
  contents: Contents,
  imageScale: number,
  readingMode: ReadingMode
): boolean {
  const doc = contents.document;
  const body = doc.body;
  if (!body) {
    return false;
  }

  const images = body.querySelectorAll("img");
  const meaningfulText = body.textContent?.replace(/\s+/g, "") ?? "";
  const isSingleImagePage = images.length === 1 && meaningfulText.length === 0;
  doc.documentElement.classList.toggle("reader-image-page", isSingleImagePage);
  doc.documentElement.classList.toggle("reader-scroll-mode", readingMode === "scroll");
  doc.documentElement.classList.toggle("reader-page-mode", readingMode === "page");

  if (!isSingleImagePage) {
    doc.documentElement.style.removeProperty("--reader-fixed-layout-width");
    return false;
  }

  updateSingleImagePageWidth(contents, images[0], imageScale);
  return true;
}

function updateSingleImagePageWidth(contents: Contents, image: HTMLImageElement, imageScale: number) {
  const viewportContent = contents.document
    .querySelector("meta[name='viewport']")
    ?.getAttribute("content");
  const scaledWidth = getScaledFixedLayoutWidth(viewportContent, image.naturalWidth, imageScale);
  contents.document.documentElement.style.setProperty(
    "--reader-fixed-layout-width",
    scaledWidth ? `${scaledWidth}px` : `${Math.min(400, Math.max(100, Math.round(imageScale)))}%`
  );
}

function syncSingleImageViewHeight(
  contents: Contents,
  readingMode: ReadingMode,
  isSingleImagePage: boolean,
  imageScale: number
) {
  if (!isSingleImagePage) {
    return;
  }

  const doc = contents.document as ReaderDocument;
  doc.__readerImageHeightCleanup?.();

  const frameElement = contents.window.frameElement as HTMLIFrameElement | null;
  const viewElement = frameElement?.closest(".epub-view") as HTMLElement | null;
  const image = doc.querySelector("img");
  if (!frameElement || !viewElement || !image) {
    return;
  }

  const applyHeight = () => {
    updateSingleImagePageWidth(contents, image, imageScale);
    const imageHeight = image.getBoundingClientRect().height;
    const pageHeight =
      viewElement.parentElement?.getBoundingClientRect().height ||
      viewElement.getBoundingClientRect().height;
    const pageFrameHeight = getPageImageFrameHeight(readingMode, true, pageHeight);
    const scrollViewHeight = getScrollImagePageViewHeight(readingMode, true, imageHeight);
    const targetHeight = pageFrameHeight ?? scrollViewHeight;

    if (!targetHeight) {
      return;
    }

    const height = `${targetHeight}px`;
    frameElement.style.setProperty("height", height);
    viewElement.style.setProperty("height", height);
  };

  let animationFrame = contents.window.requestAnimationFrame(applyHeight);
  const scheduleHeight = () => {
    contents.window.cancelAnimationFrame(animationFrame);
    animationFrame = contents.window.requestAnimationFrame(applyHeight);
  };

  image.addEventListener("load", scheduleHeight);
  contents.window.addEventListener("resize", scheduleHeight);

  let resizeObserver: ResizeObserver | null = null;
  const ResizeObserverCtor = (
    contents.window as unknown as { ResizeObserver?: typeof ResizeObserver }
  ).ResizeObserver;
  if (typeof ResizeObserverCtor === "function") {
    const observer = new ResizeObserverCtor(scheduleHeight);
    observer.observe(image);
    resizeObserver = observer;
  }

  if (typeof image.decode === "function") {
    void image.decode().then(scheduleHeight).catch(() => {});
  }

  doc.__readerImageHeightCleanup = () => {
    contents.window.cancelAnimationFrame(animationFrame);
    image.removeEventListener("load", scheduleHeight);
    contents.window.removeEventListener("resize", scheduleHeight);
    resizeObserver?.disconnect();
  };
}

function installContentPointerBehavior(
  contents: Contents,
  settingsRef: { current: ReaderSettings },
  onPageTurn: (direction: PageClickDirection) => void,
  onImageScaleChange: (nextImageScale: number) => void,
  onToggleControls: () => void
) {
  const doc = contents.document as ReaderDocument;
  if (!doc || doc.__readerPointerBehaviorInstalled) {
    return;
  }
  doc.__readerPointerBehaviorInstalled = true;

  let isDragging = false;
  let didDrag = false;
  let lastX = 0;
  let lastY = 0;
  let touchStart: { x: number; y: number; startedOnImage: boolean } | null = null;
  let pinchStart: { distance: number; imageScale: number } | null = null;
  let pinchPreviewScale: number | null = null;
  let pinchAnimationFrame: number | null = null;
  let suppressNextClick = false;
  const touchListenerOptions = { capture: true, passive: false } as const;

  const turnFromClientX = (clientX: number) => {
    const direction = getPageClickDirection({
      readingMode: settingsRef.current.readingMode,
      gripMode: settingsRef.current.gripMode,
      clientX,
      boundsLeft: 0,
      boundsWidth: contents.window.innerWidth || contents.documentElement.clientWidth
    });
    if (!direction) {
      return false;
    }

    onPageTurn(direction);
    return true;
  };

  const schedulePinchPreview = (nextImageScale: number) => {
    pinchPreviewScale = nextImageScale;
    if (pinchAnimationFrame !== null) {
      return;
    }

    pinchAnimationFrame = contents.window.requestAnimationFrame(() => {
      pinchAnimationFrame = null;
      if (pinchPreviewScale === null) {
        return;
      }

      const image = doc.querySelector("img");
      if (image) {
        updateSingleImagePageWidth(contents, image, pinchPreviewScale);
      }
    });
  };

  doc.addEventListener(
    "mousedown",
    (event) => {
      if (!isZoomedSingleImagePage(doc, settingsRef.current) || !isImageEventTarget(event.target)) {
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
      const isSingleImagePage = doc.documentElement.classList.contains("reader-image-page");
      if (
        event.touches.length === 2 &&
        settingsRef.current.readingMode === "page" &&
        isSingleImagePage
      ) {
        pinchStart = {
          distance: getTouchDistance(event.touches[0], event.touches[1]),
          imageScale: settingsRef.current.imageScale
        };
        pinchPreviewScale = settingsRef.current.imageScale;
        touchStart = null;
        suppressNextClick = true;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.touches.length !== 1 || isInteractiveTarget(event.target)) {
        touchStart = null;
        return;
      }

      const touch = event.touches[0];
      touchStart = {
        x: touch.clientX,
        y: touch.clientY,
        startedOnImage: isImageEventTarget(event.target)
      };
    },
    touchListenerOptions
  );

  doc.addEventListener(
    "touchmove",
    (event) => {
      if (pinchStart && event.touches.length === 2 && settingsRef.current.readingMode === "page") {
        const nextImageScale = getPinchImageScale({
          startScale: pinchStart.imageScale,
          startDistance: pinchStart.distance,
          currentDistance: getTouchDistance(event.touches[0], event.touches[1])
        });
        schedulePinchPreview(nextImageScale);
        suppressNextClick = true;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!touchStart || event.touches.length !== 1 || settingsRef.current.readingMode !== "page") {
        return;
      }

      const touch = event.touches[0];
      const horizontalDistance = Math.abs(touch.clientX - touchStart.x);
      const verticalDistance = Math.abs(touch.clientY - touchStart.y);
      if (
        !isZoomedSingleImagePage(doc, settingsRef.current) &&
        horizontalDistance > 12 &&
        horizontalDistance > verticalDistance
      ) {
        event.preventDefault();
      }
    },
    touchListenerOptions
  );

  doc.addEventListener(
    "touchend",
    (event) => {
      if (pinchStart) {
        if (event.touches.length < 2) {
          const committedScale = pinchPreviewScale ?? settingsRef.current.imageScale;
          pinchStart = null;
          pinchPreviewScale = null;
          touchStart = null;
          if (pinchAnimationFrame !== null) {
            contents.window.cancelAnimationFrame(pinchAnimationFrame);
            pinchAnimationFrame = null;
          }
          settingsRef.current = { ...settingsRef.current, imageScale: committedScale };
          applyImageScaleToContent(contents, settingsRef.current);
          onImageScaleChange(committedScale);
          suppressNextClick = true;
          contents.window.setTimeout(() => {
            suppressNextClick = false;
          }, 600);
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const touch = event.changedTouches[0];
      if (!touchStart || !touch) {
        touchStart = null;
        return;
      }

      const gestureStart = touchStart;
      touchStart = null;
      if (hasTextSelection(contents.window)) {
        return;
      }

      if (settingsRef.current.readingMode !== "page") {
        const wasTap = isTapGesture({
          startX: gestureStart.x,
          startY: gestureStart.y,
          endX: touch.clientX,
          endY: touch.clientY
        });
        if (wasTap) {
          onToggleControls();
          suppressNextClick = true;
          suppressClickTemporarily(contents, () => {
            suppressNextClick = false;
          });
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (gestureStart.startedOnImage && isZoomedSingleImagePage(doc, settingsRef.current)) {
        return;
      }

      const swipeDirection = getSwipeDirection({
        startX: gestureStart.x,
        startY: gestureStart.y,
        endX: touch.clientX,
        endY: touch.clientY
      });
      if (swipeDirection) {
        onPageTurn(swipeDirection);
        suppressClickTemporarily(contents, () => {
          suppressNextClick = false;
        });
        suppressNextClick = true;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const wasTap = isTapGesture({
        startX: gestureStart.x,
        startY: gestureStart.y,
        endX: touch.clientX,
        endY: touch.clientY
      });
      if (!wasTap) {
        return;
      }

      const didTurn = turnFromClientX(touch.clientX);
      if (!didTurn) {
        onToggleControls();
      }
      suppressNextClick = true;
      suppressClickTemporarily(contents, () => {
        suppressNextClick = false;
      });
      event.preventDefault();
      event.stopPropagation();
    },
    touchListenerOptions
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

      if (isInteractiveTarget(event.target) || hasTextSelection(contents.window)) {
        return;
      }

      if (
        settingsRef.current.readingMode === "page" &&
        !(isZoomedSingleImagePage(doc, settingsRef.current) && isImageEventTarget(event.target)) &&
        turnFromClientX(event.clientX)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      onToggleControls();
    },
    true
  );
}

function isZoomedSingleImagePage(doc: Document, settings: ReaderSettings): boolean {
  return (
    settings.imageScale > 100 &&
    doc.documentElement.classList.contains("reader-image-page")
  );
}

function suppressClickTemporarily(contents: Contents, onRelease: () => void) {
  contents.window.setTimeout(onRelease, 450);
}

function hasTextSelection(contentWindow: Window): boolean {
  try {
    return Boolean(contentWindow.getSelection()?.toString().trim());
  } catch {
    return false;
  }
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
    asClosestElement(target)?.closest(
      "a, button, input, select, textarea, summary, [role='button'], [contenteditable='true']"
    )
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
      padding: "4.5rem 1.25rem 6rem !important"
    },
    a: {
      color: "#2f5d50"
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
      padding: "4.5rem 1.25rem 6rem !important"
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
  readingMode: ReadingMode,
  gripMode: GripMode
) {
  rendition.themes.select(theme);
  rendition.themes.fontSize(`${fontScale}%`);
  rendition.themes.override("line-height", `${lineHeight}%`);
  applyImageScaleToRenderedContents(rendition, {
    fontScale,
    gripMode,
    imageScale,
    lineHeight,
    readingMode,
    theme
  });
}
