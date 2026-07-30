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
  getEstimatedSingleImageHeight,
  getImageScaleStylesheet,
  getLocationPercentage,
  getLocationSpineIndex,
  getPageClickDirection,
  getPageImageFrameHeight,
  getPinchImageScale,
  getProgressPercent,
  getScrollImagePageViewHeight,
  getSwipeDirection,
  getToolbarPageControls,
  getTouchDistance,
  isTapGesture,
  type PageClickDirection
} from "../lib/readerInteraction";
import { installFileBackedEpubArchive } from "../lib/fileBackedEpubArchive";
import { readBlobAsArrayBuffer } from "../lib/blobReader";
import { applyContentStylesheet } from "../lib/contentStylesheet";
import {
  applyImagePageScale,
  getImagePageDisplayHeight,
  getImagePageInfo,
  getImagePageLoadTarget,
  type ImagePageInfo,
  type ImagePageMedia
} from "../lib/imagePage";
import {
  attachLazyResourceCleanup,
  installLazyEpubResourceLoading,
  type LazyEpubResourceController
} from "../lib/lazyEpubResources";
import { getRenditionOptions } from "../lib/renditionOptions";
import { advanceContinuousScroll, primeContinuousScroll } from "../lib/scrollAdvance";

type ReaderProps = {
  file: File;
  onClose: () => void;
};

type LoadStatus = "loading" | "ready" | "error";
type ReaderSheet = "toc" | "settings" | null;
type ReaderSettings = ReaderPreferences & {
  readingMode: ReadingMode;
  fixedLayout: boolean;
};
type ProgressSnapshot = {
  percent: number;
  label: string;
};

type ReaderDocument = Document & {
  __readerPointerBehaviorInstalled?: boolean;
  __readerImageHeightCleanup?: () => void;
  __readerAppliedImageScale?: number;
  __readerAppliedReadingMode?: ReadingMode;
  __readerImageHeightScale?: number;
  __readerImageHeightMode?: ReadingMode;
  __readerImagePageInfo?: ImagePageInfo;
  __readerAnchorRestoreRevision?: number;
};

const COMPACT_READER_QUERY =
  "(max-width: 760px), (pointer: coarse) and (max-height: 500px)";
const LAZY_RESOURCE_THRESHOLD = 32 * 1024 * 1024;
const PROGRESS_SAVE_DELAY = 650;

export function Reader({ file, onClose }: ReaderProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const lazyResourcesRef = useRef<LazyEpubResourceController | null>(null);
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
    readingMode: savedProgress.readingMode,
    fixedLayout: false
  });
  const latestProgressRef = useRef({
    cfi: savedProgress.cfi,
    percentage: savedProgress.percentage,
    readingMode: savedProgress.readingMode
  });
  const uiActionsRef = useRef({
    toggleControls: () => {},
    showControls: () => {}
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
    theme,
    fixedLayout: Boolean(book && isPrePaginatedBook(book))
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
    showControls: () => {
      if (isCompactViewport) {
        setControlsVisible(true);
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

    // Continuous scroll is the mode where the user most often needs to
    // reopen settings. Keep its chrome visible unless the user explicitly
    // hides it; the floating menu handle below can always restore it.
    if (readingMode === "scroll" || status !== "ready" || activeSheet || !controlsVisible) {
      return undefined;
    }

    const timer = window.setTimeout(() => setControlsVisible(false), 4500);
    return () => window.clearTimeout(timer);
  }, [activeSheet, controlsVisible, isCompactViewport, readingMode, status]);

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
    let lazyResources: LazyEpubResourceController | null = null;

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
        const useLazyResources = file.size >= LAZY_RESOURCE_THRESHOLD;
        // Large books stay backed by the original File. The custom archive
        // reads only the ZIP index and requested entries through Blob.slice(),
        // instead of copying the complete EPUB into a JavaScript ArrayBuffer.
        const [bookInput, epubModule] = await Promise.all([
          useLazyResources ? Promise.resolve(file) : readBlobAsArrayBuffer(file),
          import("epubjs")
        ]);
        if (cancelled) {
          return;
        }

        // Create the Book before opening it so the lazy hook can disable
        // epub.js' eager CSS/asset replacement and observe the first section.
        loadedBook = epubModule.default({
          replacements: useLazyResources ? "none" : "blobUrl"
        });
        registerEarlyImagePageGuard(loadedBook);
        if (useLazyResources) {
          installFileBackedEpubArchive(loadedBook, (stage) => {
            if (cancelled) {
              return;
            }
            if (stage === "reading-index") {
              setMessage("正在读取 EPUB 文件索引…");
            } else if (stage === "reading-book-structure") {
              setMessage("正在读取书籍结构…");
            }
          });
          lazyResources = installLazyEpubResourceLoading(loadedBook);
          lazyResourcesRef.current = lazyResources;
        }
        bookRef.current = loadedBook;

        const opening = loadedBook.open(bookInput as unknown as ArrayBuffer);
        const [metadata, navigation] = await Promise.all([
          loadedBook.loaded.metadata,
          loadedBook.loaded.navigation,
          opening
        ]);
        if (cancelled) {
          return;
        }

        bookLayoutRef.current = metadata.layout ?? "";
        setBook(loadedBook);
        setTitle(typeof metadata.title === "string" && metadata.title ? metadata.title : file.name);
        setToc(navigation.toc ?? []);
      } catch {
        lazyResources?.destroy();
        if (lazyResourcesRef.current === lazyResources) {
          lazyResourcesRef.current = null;
        }
        loadedBook?.destroy();
        if (bookRef.current === loadedBook) {
          bookRef.current = null;
        }
        lazyResources = null;
        loadedBook = null;

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
      const activeRendition = renditionRef.current;
      renditionRef.current = null;
      if (activeRendition) {
        activeRendition.destroy();
        detachRenditionFromBook(loadedBook, activeRendition);
      }
      lazyResources?.destroy();
      if (lazyResourcesRef.current === lazyResources) {
        lazyResourcesRef.current = null;
      }
      loadedBook?.destroy();
      if (bookRef.current === loadedBook) {
        bookRef.current = null;
      }
    };
  }, [bookKey, file, savedProgress.percentage]);

  useEffect(() => {
    if (!book || file.size >= LAZY_RESOURCE_THRESHOLD || isPrePaginatedBook(book)) {
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
    let detachLazyResourceCleanup = () => {};
    const lazyResources = lazyResourcesRef.current;
    const lowMemoryScroll =
      readingMode === "scroll" &&
      (file.size >= LAZY_RESOURCE_THRESHOLD || isPrePaginatedBook(book));
    const rendition = book.renderTo(
      host,
      getRenditionOptions(readingMode, { lowMemoryScroll })
    );

    if (lazyResources) {
      detachLazyResourceCleanup = attachLazyResourceCleanup(rendition, lazyResources);
    }

    renditionRef.current = rendition;
    setStatus("loading");
    setMessage(
      lowMemoryScroll
        ? "正在按需加载大文件，请稍候…"
        : readingMode === "scroll"
          ? "正在切换到滚动阅读…"
          : "正在切换到分页阅读…"
    );

    registerContentEnhancements(
      rendition,
      latestSettingsRef,
      (direction) => void turnPage(direction),
      (nextImageScale) => setImageScale(nextImageScale),
      () => uiActionsRef.current.toggleControls(),
      lazyResources
    );
    registerThemes(rendition);
    applyReaderStyle(
      rendition,
      theme,
      fontScale,
      lineHeight,
      imageScale,
      readingMode,
      gripMode,
      isPrePaginatedBook(book)
    );

    const handleRelocated = (location: Location) => {
      updateProgressFromLocation(location, book);
      window.requestAnimationFrame(() => {
        if (renditionRef.current === rendition) {
          applyImageScaleToRenderedContents(rendition, latestSettingsRef.current);
        }
      });
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

        applyImageScaleToRenderedContents(rendition, latestSettingsRef.current);

        if (readingMode === "scroll" && !lowMemoryScroll) {
          // Small text-heavy books can afford a larger look-ahead window.
          // Memory-sensitive books rely on the continuous manager's bounded
          // offset instead of forcing additional sections into memory here.
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
      rendition.off("relocated", handleRelocated);
      // Keep the cleanup wrapper installed while epub.js clears its iframe
      // views, then release anything left as a defensive fallback.
      if (renditionRef.current === rendition) {
        renditionRef.current = null;
        rendition.destroy();
        detachRenditionFromBook(book, rendition);
      }
      detachLazyResourceCleanup();
      lazyResources?.resetRenderedSections();
      host.replaceChildren();
    };
  }, [book, file.size, readingMode]);

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
      gripMode,
      Boolean(book && isPrePaginatedBook(book))
    );
  }, [book, fontScale, gripMode, imageScale, lineHeight, readingMode, theme]);

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
      if (
        latestSettingsRef.current.readingMode === "scroll" &&
        (await advanceContinuousScroll(rendition, direction))
      ) {
        window.setTimeout(refreshCurrentProgress, 220);
        return;
      }

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
    uiActionsRef.current.showControls();
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

  function selectReadingMode(mode: ReadingMode) {
    uiActionsRef.current.showControls();
    setReadingMode(mode);
  }

  function handleStageClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget || event.target === mountRef.current) {
      uiActionsRef.current.toggleControls();
    }
  }

  const chromeIsVisible =
    !isCompactViewport || controlsVisible || activeSheet !== null || status !== "ready";

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
        <div ref={stageRef} className="reader-stage" onClick={handleStageClick}>
          {status !== "ready" ? (
            <div className={`reader-message ${status}`} aria-live="polite">
              {message}
            </div>
          ) : null}
          <div ref={mountRef} className="rendition-root" />
        </div>
      </div>

      {isCompactViewport && status === "ready" && !chromeIsVisible ? (
        <button
          className="reader-controls-reveal"
          type="button"
          aria-label="显示阅读控制"
          onClick={() => uiActionsRef.current.showControls()}
        >
          <span aria-hidden="true">⌃</span>
          菜单
        </button>
      ) : null}

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
                      onClick={() => selectReadingMode("scroll")}
                    >
                      滚动
                    </button>
                    <button
                      className={readingMode === "page" ? "selected" : ""}
                      type="button"
                      aria-pressed={readingMode === "page"}
                      onClick={() => selectReadingMode("page")}
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
  onToggleControls: () => void,
  lazyResources?: LazyEpubResourceController | null
) {
  rendition.hooks.content.register((contents: Contents) => {
    // Install interaction first. A malformed stylesheet, image, or lazy-load
    // entry must never leave an otherwise visible page without tap or pinch
    // controls.
    try {
      installContentPointerBehavior(
        contents,
        settingsRef,
        onPageTurn,
        onImageScaleChange,
        onToggleControls
      );
    } catch {
      // Keep the EPUB page usable even when a browser exposes an incomplete
      // iframe event implementation.
    }

    try {
      lazyResources?.activateDocument(contents.document);
    } catch {
      // A resource can disappear while a continuous view is being recycled.
    }

    try {
      applyImageScaleToContent(contents, settingsRef.current);
    } catch {
      // Text and navigation remain usable if a particular image page cannot
      // be measured or styled.
    }
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

function detachRenditionFromBook(book: Book | null, rendition: Rendition) {
  const bookWithRendition = book as unknown as { rendition?: Rendition } | null;
  if (bookWithRendition?.rendition === rendition) {
    delete bookWithRendition.rendition;
  }
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

function registerEarlyImagePageGuard(book: Book) {
  book.spine.hooks.content.register((document: Document) => {
    const root = document.documentElement;
    const head = document.querySelector("head");
    if (!root || !document.body || !head || !getImagePageInfo(document).isSingleImagePage) {
      return;
    }

    root.classList.add("reader-image-source");
    if (document.getElementById("reader-initial-image-guard")) {
      return;
    }

    const style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
    style.id = "reader-initial-image-guard";
    style.textContent = `
      html.reader-image-source,
      html.reader-image-source body {
        min-height: 100vh !important;
      }
    `;
    head.appendChild(style);
  });
}

function isPrePaginatedBook(book: Book): boolean {
  const candidate = book as unknown as {
    package?: { metadata?: { layout?: unknown } };
    displayOptions?: { fixedLayout?: unknown };
  };

  return (
    candidate.package?.metadata?.layout === "pre-paginated" ||
    candidate.displayOptions?.fixedLayout === "true"
  );
}

function getOpeningMessage(file: File): string {
  return file.size >= LAZY_RESOURCE_THRESHOLD
    ? "文件较大，正在本机读取，请稍候…"
    : "正在打开文件…";
}

function applyImageScaleToRenderedContents(rendition: Rendition, settings: ReaderSettings) {
  const rendered = getRenderedContents(rendition);
  const active = new Set(getActiveRenderedContents(rendition, rendered));

  // Apply the visual transform to every already-rendered iframe so a
  // preloaded next page never appears at the old scale. Only the active view
  // is allowed to resize its epub-view container; that is the expensive step
  // that previously caused continuous-scroll jumps and white screens.
  for (const contents of rendered) {
    const document = contents.document as ReaderDocument;
    const imagePageInfo = document.__readerImagePageInfo;
    if (!imagePageInfo?.isImageDocument && !document.querySelector("img, svg image")) {
      continue;
    }
    applyImageScaleToContent(contents, settings, active.has(contents));
  }
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

function getRenditionManagerContainer(rendition: Rendition): HTMLElement | null {
  return (
    rendition as unknown as { manager?: { container?: HTMLElement | null } }
  ).manager?.container ?? null;
}

/**
 * Continuous mode can keep several neighboring iframe views alive. Resizing
 * all of them at once makes the scroll offset jump and was the main cause of
 * the apparent white screen after changing image scale. Only update the view
 * that currently occupies the reader viewport; preloaded views receive the
 * latest setting from the content hook or the next relocated event.
 */
function getActiveRenderedContents(
  rendition: Rendition,
  rendered: Contents[] = getRenderedContents(rendition)
): Contents[] {
  if (rendered.length <= 1) {
    return rendered;
  }

  const managerContainer = getRenditionManagerContainer(rendition);
  const viewportBounds = safeElementBounds(managerContainer ?? null);
  if (!viewportBounds || viewportBounds.width <= 0 || viewportBounds.height <= 0) {
    return [rendered[0]];
  }

  let best: Contents | null = null;
  let bestVisibleArea = -1;
  let bestCenterDistance = Number.POSITIVE_INFINITY;
  const viewportCenterY = viewportBounds.top + viewportBounds.height / 2;

  for (const contents of rendered) {
    const frame = contents.window.frameElement as HTMLElement | null;
    const view = frame?.closest?.(".epub-view") as HTMLElement | null;
    const bounds = safeElementBounds(view ?? frame);
    if (!bounds) {
      continue;
    }

    const intersectionWidth = Math.max(
      0,
      Math.min(bounds.right, viewportBounds.right) - Math.max(bounds.left, viewportBounds.left)
    );
    const intersectionHeight = Math.max(
      0,
      Math.min(bounds.bottom, viewportBounds.bottom) - Math.max(bounds.top, viewportBounds.top)
    );
    const visibleArea = intersectionWidth * intersectionHeight;
    const centerDistance = Math.abs(bounds.top + bounds.height / 2 - viewportCenterY);

    if (
      visibleArea > bestVisibleArea ||
      (visibleArea === bestVisibleArea && centerDistance < bestCenterDistance)
    ) {
      best = contents;
      bestVisibleArea = visibleArea;
      bestCenterDistance = centerDistance;
    }
  }

  return [best ?? rendered[0]];
}

type ImageScaleAnchor = {
  innerXRatio: number;
  innerYRatio: number;
  outerContainer: HTMLElement | null;
  outerView: HTMLElement | null;
  outerViewRatio: number | null;
};

function applyImageScaleToContent(
  contents: Contents,
  settings: ReaderSettings,
  syncHeight = true,
  anchorOverride: ImageScaleAnchor | null = null
) {
  const doc = contents.document as ReaderDocument;
  const hadAppliedSetting = doc.__readerAppliedImageScale !== undefined;
  const settingChanged =
    !hadAppliedSetting ||
    doc.__readerAppliedImageScale !== settings.imageScale ||
    doc.__readerAppliedReadingMode !== settings.readingMode;
  const candidateAnchor =
    anchorOverride ??
    (hadAppliedSetting && settingChanged && syncHeight
      ? captureImageScaleAnchor(contents)
      : null);
  const markedPage = markImagePage(
    contents,
    settings.imageScale,
    settings.readingMode,
    settings.fixedLayout
  );
  const needsHeightRefresh =
    syncHeight &&
    (doc.__readerImageHeightScale !== settings.imageScale ||
      doc.__readerImageHeightMode !== settings.readingMode);
  const needsRefresh = settingChanged || markedPage.changed || needsHeightRefresh;

  if (!needsRefresh) {
    return;
  }

  applyContentStylesheet(
    contents,
    getImageScaleStylesheet(settings.imageScale),
    "reader-image-scale"
  );
  doc.__readerAppliedImageScale = settings.imageScale;
  doc.__readerAppliedReadingMode = settings.readingMode;

  if (syncHeight) {
    syncSingleImageViewHeight(
      contents,
      settings.readingMode,
      markedPage.pageInfo,
      settings.imageScale,
      settings.fixedLayout,
      candidateAnchor
    );
  } else if (candidateAnchor) {
    scheduleImageScaleAnchorRestore(contents, candidateAnchor);
  }
}

type MarkedImagePage = {
  pageInfo: ImagePageInfo;
  changed: boolean;
};

function getCachedImagePageInfo(document: ReaderDocument): ImagePageInfo {
  const cached = document.__readerImagePageInfo;
  if (cached) {
    return cached;
  }

  const pageInfo = getImagePageInfo(document);
  document.__readerImagePageInfo = pageInfo;
  return pageInfo;
}

function markImagePage(
  contents: Contents,
  imageScale: number,
  readingMode: ReadingMode,
  fixedLayout: boolean
): MarkedImagePage {
  const doc = contents.document as ReaderDocument;
  const pageInfo = getCachedImagePageInfo(doc);
  const root = doc.documentElement;
  const previousImageDocument = root.classList.contains("reader-image-document");
  const previousImagePage = root.classList.contains("reader-image-page");
  const previousScrollMode = root.classList.contains("reader-scroll-mode");
  const previousPageMode = root.classList.contains("reader-page-mode");

  root.classList.toggle("reader-image-document", pageInfo.isImageDocument);
  root.classList.toggle("reader-image-page", pageInfo.isSingleImagePage);
  root.classList.toggle("reader-scroll-mode", readingMode === "scroll");
  root.classList.toggle("reader-page-mode", readingMode === "page");
  const scaleResult = applyImagePageScale(doc, pageInfo, imageScale, fixedLayout);

  return {
    pageInfo,
    changed:
      scaleResult.changed ||
      previousImageDocument !== pageInfo.isImageDocument ||
      previousImagePage !== pageInfo.isSingleImagePage ||
      previousScrollMode !== (readingMode === "scroll") ||
      previousPageMode !== (readingMode === "page")
  };
}

function syncSingleImageViewHeight(
  contents: Contents,
  readingMode: ReadingMode,
  pageInfo: ImagePageInfo,
  imageScale: number,
  fixedLayout: boolean,
  anchorOverride: ImageScaleAnchor | null
) {
  const doc = contents.document as ReaderDocument;
  doc.__readerImageHeightCleanup?.();
  doc.__readerImageHeightCleanup = undefined;

  if (!pageInfo.isSingleImagePage || !pageInfo.media) {
    doc.__readerImageHeightScale = undefined;
    doc.__readerImageHeightMode = undefined;
    if (anchorOverride) {
      scheduleImageScaleAnchorRestore(contents, anchorOverride);
    }
    return;
  }

  const frameElement = contents.window.frameElement as HTMLIFrameElement | null;
  const viewElement = frameElement?.closest?.(".epub-view") as HTMLElement | null;
  if (!frameElement || !viewElement) {
    if (anchorOverride) {
      scheduleImageScaleAnchorRestore(contents, anchorOverride);
    }
    return;
  }

  const media = pageInfo.media;
  let firstAnchor = anchorOverride;

  const applyHeight = () => {
    // Natural image decode/ResizeObserver updates must never reposition the
    // continuous manager. Only an explicit scale change supplies an anchor.
    const anchor = firstAnchor;
    firstAnchor = null;

    // epub.js can recalculate its fit-to-frame body transform after a resize.
    // Reapply the reader zoom before measuring the visible media rectangle.
    applyImagePageScale(doc, pageInfo, imageScale, fixedLayout);

    const parentBounds = safeElementBounds(viewElement.parentElement);
    const viewBounds = safeElementBounds(viewElement);
    const frameBounds = safeElementBounds(frameElement);
    const pageHeight =
      parentBounds?.height || viewBounds?.height || contents.window.innerHeight || 1;
    const frameWidth =
      frameBounds?.width ||
      parentBounds?.width ||
      viewBounds?.width ||
      contents.window.innerWidth ||
      1;
    const viewportContent = doc
      .querySelector("meta[name='viewport']")
      ?.getAttribute("content");
    const measuredHeight = getImagePageDisplayHeight(media);
    const estimatedHeight = getEstimatedSingleImageHeight({
      viewportContent,
      naturalWidth: media.intrinsicWidth,
      naturalHeight: media.intrinsicHeight,
      attributeWidth: media.intrinsicWidth,
      attributeHeight: media.intrinsicHeight,
      frameWidth,
      imageScale,
      fallbackHeight: pageHeight
    });
    const stableImageHeight =
      measuredHeight > 1 ? measuredHeight : estimatedHeight ?? Math.max(1, pageHeight);
    const targetHeight =
      getPageImageFrameHeight(readingMode, true, pageHeight) ??
      getScrollImagePageViewHeight(readingMode, true, stableImageHeight);

    if (targetHeight && Number.isFinite(targetHeight)) {
      const height = `${Math.max(1, Math.ceil(targetHeight))}px`;
      frameElement.style.setProperty("height", height);
      viewElement.style.setProperty("height", height);
    }

    if (anchor) {
      scheduleImageScaleAnchorRestore(contents, anchor);
    }
  };

  // Set a non-zero height before the continuous manager runs fill(). Image
  // decode and ResizeObserver refine it without loading every neighboring page.
  applyHeight();
  doc.__readerImageHeightScale = imageScale;
  doc.__readerImageHeightMode = readingMode;
  let animationFrame = contents.window.requestAnimationFrame(applyHeight);
  const scheduleHeight = () => {
    contents.window.cancelAnimationFrame(animationFrame);
    animationFrame = contents.window.requestAnimationFrame(applyHeight);
  };

  const loadTarget = getImagePageLoadTarget(media);
  loadTarget.addEventListener("load", scheduleHeight);
  contents.window.addEventListener("resize", scheduleHeight);

  let resizeObserver: ResizeObserver | null = null;
  const ResizeObserverCtor = (
    contents.window as unknown as { ResizeObserver?: typeof ResizeObserver }
  ).ResizeObserver;
  if (typeof ResizeObserverCtor === "function") {
    resizeObserver = new ResizeObserverCtor(scheduleHeight);
    resizeObserver.observe(media.displayElement);
  }

  const decode = (loadTarget as { decode?: () => Promise<unknown> }).decode;
  if (typeof decode === "function") {
    void decode.call(loadTarget).then(scheduleHeight).catch(() => {});
  }

  doc.__readerImageHeightCleanup = () => {
    contents.window.cancelAnimationFrame(animationFrame);
    loadTarget.removeEventListener("load", scheduleHeight);
    contents.window.removeEventListener("resize", scheduleHeight);
    resizeObserver?.disconnect();
  };
}

function previewImageScale(
  contents: Contents,
  imageScale: number,
  fixedLayout: boolean,
  readingMode: ReadingMode
) {
  markImagePage(contents, imageScale, readingMode, fixedLayout);
}

function captureImageScaleAnchor(contents: Contents): ImageScaleAnchor {
  const doc = contents.document;
  const root = doc.documentElement;
  const body = doc.body;
  const viewportWidth = contents.window.innerWidth || root.clientWidth || 1;
  const viewportHeight = contents.window.innerHeight || root.clientHeight || 1;
  const scrollWidth = Math.max(viewportWidth, root.scrollWidth);
  const scrollHeight = Math.max(viewportHeight, root.scrollHeight);
  const scrollLeft = getDocumentScrollLeft(contents.window, root, body);
  const scrollTop = getDocumentScrollTop(contents.window, root, body);
  const frame = contents.window.frameElement as HTMLElement | null;
  const view = frame?.closest?.(".epub-view") as HTMLElement | null;
  const container = view?.closest?.(".epub-container") as HTMLElement | null;
  const viewBounds = safeElementBounds(view);
  const containerBounds = safeElementBounds(container);
  let outerViewRatio: number | null = null;

  if (viewBounds && containerBounds && viewBounds.height > 0) {
    const containerHeight = container?.clientHeight || containerBounds.height;
    const viewportCenter = containerBounds.top + Math.min(containerBounds.height, containerHeight) / 2;
    outerViewRatio = clampRatio((viewportCenter - viewBounds.top) / viewBounds.height);
  }

  return {
    innerXRatio: clampRatio((scrollLeft + viewportWidth / 2) / scrollWidth),
    innerYRatio: clampRatio((scrollTop + viewportHeight / 2) / scrollHeight),
    outerContainer: container,
    outerView: view,
    outerViewRatio
  };
}

function scheduleImageScaleAnchorRestore(contents: Contents, anchor: ImageScaleAnchor) {
  const document = contents.document as ReaderDocument;
  const revision = (document.__readerAnchorRestoreRevision ?? 0) + 1;
  document.__readerAnchorRestoreRevision = revision;
  const restoreIfCurrent = () => {
    if (document.__readerAnchorRestoreRevision === revision) {
      restoreImageScaleAnchor(contents, anchor);
    }
  };

  restoreIfCurrent();
  contents.window.requestAnimationFrame(restoreIfCurrent);
  // epub.js and WebKit can apply one more iframe/view measurement after the
  // first animation frame. Reassert the latest anchor once after layout settles.
  contents.window.setTimeout(restoreIfCurrent, 80);
}

function restoreImageScaleAnchor(contents: Contents, anchor: ImageScaleAnchor) {
  const doc = contents.document;
  const root = doc.documentElement;
  const body = doc.body;
  const viewportWidth = contents.window.innerWidth || root.clientWidth || 1;
  const viewportHeight = contents.window.innerHeight || root.clientHeight || 1;
  const scrollWidth = Math.max(viewportWidth, root.scrollWidth);
  const scrollHeight = Math.max(viewportHeight, root.scrollHeight);
  const left = Math.max(0, anchor.innerXRatio * scrollWidth - viewportWidth / 2);
  const top = Math.max(0, anchor.innerYRatio * scrollHeight - viewportHeight / 2);

  try {
    contents.window.scrollTo({ left, top, behavior: "auto" });
  } catch {
    // Direct element scrolling below is the compatibility fallback.
  }
  root.scrollLeft = left;
  root.scrollTop = top;
  if (body) {
    body.scrollLeft = left;
    body.scrollTop = top;
  }

  if (anchor.outerContainer && anchor.outerView && anchor.outerViewRatio !== null) {
    const containerBounds = safeElementBounds(anchor.outerContainer);
    const viewBounds = safeElementBounds(anchor.outerView);
    if (containerBounds && viewBounds && viewBounds.height > 0) {
      const containerHeight = anchor.outerContainer.clientHeight || containerBounds.height;
      const viewportCenter =
        containerBounds.top + Math.min(containerBounds.height, containerHeight) / 2;
      const anchoredPoint = viewBounds.top + viewBounds.height * anchor.outerViewRatio;
      anchor.outerContainer.scrollTop += anchoredPoint - viewportCenter;
    }
  }
}

function getDocumentScrollLeft(
  contentWindow: Window,
  root: HTMLElement,
  body: HTMLElement | null
): number {
  return contentWindow.scrollX || root.scrollLeft || body?.scrollLeft || 0;
}

function getDocumentScrollTop(
  contentWindow: Window,
  root: HTMLElement,
  body: HTMLElement | null
): number {
  return contentWindow.scrollY || root.scrollTop || body?.scrollTop || 0;
}

function safeElementBounds(element: Element | null): DOMRect | null {
  if (!element) {
    return null;
  }

  try {
    return element.getBoundingClientRect();
  } catch {
    return null;
  }
}

function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
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
  let pinchAnchor: ImageScaleAnchor | null = null;
  let pinchInputSource: "touch" | "gesture" | null = null;
  let pinchPreviewScale: number | null = null;
  let pinchAnimationFrame: number | null = null;
  let safariGestureStartScale: number | null = null;
  let safariGestureAnchor: ImageScaleAnchor | null = null;
  let suppressNextClick = false;
  const touchListenerOptions = { capture: true, passive: false } as const;

  const isImageDocument = () =>
    doc.documentElement.classList.contains("reader-image-document") ||
    getCachedImagePageInfo(doc).isImageDocument;

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

      previewImageScale(
        contents,
        pinchPreviewScale,
        settingsRef.current.fixedLayout,
        settingsRef.current.readingMode
      );
    });
  };

  const commitPinchScale = (nextImageScale: number, anchor: ImageScaleAnchor | null) => {
    if (pinchAnimationFrame !== null) {
      contents.window.cancelAnimationFrame(pinchAnimationFrame);
      pinchAnimationFrame = null;
    }
    pinchPreviewScale = null;
    pinchStart = null;
    pinchAnchor = null;
    pinchInputSource = null;
    safariGestureStartScale = null;
    safariGestureAnchor = null;
    touchStart = null;

    settingsRef.current = { ...settingsRef.current, imageScale: nextImageScale };
    applyImageScaleToContent(contents, settingsRef.current, true, anchor);
    onImageScaleChange(nextImageScale);
    suppressNextClick = true;
    contents.window.setTimeout(() => {
      suppressNextClick = false;
    }, 600);
  };

  const cancelPinchPreview = () => {
    if (pinchAnimationFrame !== null) {
      contents.window.cancelAnimationFrame(pinchAnimationFrame);
      pinchAnimationFrame = null;
    }
    previewImageScale(
      contents,
      settingsRef.current.imageScale,
      settingsRef.current.fixedLayout,
      settingsRef.current.readingMode
    );
    pinchStart = null;
    pinchAnchor = null;
    pinchInputSource = null;
    pinchPreviewScale = null;
    safariGestureStartScale = null;
    safariGestureAnchor = null;
    suppressNextClick = true;
    suppressClickTemporarily(contents, () => {
      suppressNextClick = false;
    });
  };

  doc.addEventListener(
    "mousedown",
    (event) => {
      if (!isZoomedImageDocument(doc, settingsRef.current) || !isImageEventTarget(event.target)) {
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
      if (event.touches.length === 2 && isImageDocument()) {
        pinchStart = {
          distance: getTouchDistance(event.touches[0], event.touches[1]),
          imageScale: settingsRef.current.imageScale
        };
        pinchAnchor = captureImageScaleAnchor(contents);
        pinchInputSource = "touch";
        pinchPreviewScale = settingsRef.current.imageScale;
        safariGestureStartScale = null;
        safariGestureAnchor = null;
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
      if (pinchInputSource === "touch" && pinchStart && event.touches.length === 2) {
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
        !isZoomedImageDocument(doc, settingsRef.current) &&
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
      // Safari can begin with Touch Events and then switch to its native
      // gesture events. Once gesturestart takes over, touchend must not commit
      // the unchanged 100% touch preview before gesturechange is processed.
      if (pinchInputSource === "gesture") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (pinchInputSource === "touch" && pinchStart) {
        if (event.touches.length < 2) {
          commitPinchScale(
            pinchPreviewScale ?? settingsRef.current.imageScale,
            pinchAnchor
          );
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
        }
        return;
      }

      if (
        gestureStart.startedOnImage &&
        isZoomedImageDocument(doc, settingsRef.current) &&
        !isTapGesture({
          startX: gestureStart.x,
          startY: gestureStart.y,
          endX: touch.clientX,
          endY: touch.clientY
        })
      ) {
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
    "touchcancel",
    () => {
      touchStart = null;
      if (pinchInputSource === "touch" && pinchStart) {
        cancelPinchPreview();
      }
    },
    touchListenerOptions
  );

  // iOS Safari and some WKWebView builds start with a two-touch touchstart,
  // then deliver the actual scale changes only through gesturechange. Let the
  // gesture stream take ownership instead of ignoring it because pinchStart is
  // already populated; the old behavior made 100% pages appear unzoomable.
  type SafariGestureEvent = Event & { scale?: number };
  const handleGestureStart = (rawEvent: Event) => {
    const event = rawEvent as SafariGestureEvent;
    if (!isImageDocument()) {
      return;
    }

    if (pinchAnimationFrame !== null) {
      contents.window.cancelAnimationFrame(pinchAnimationFrame);
      pinchAnimationFrame = null;
    }

    safariGestureStartScale = pinchStart?.imageScale ?? settingsRef.current.imageScale;
    safariGestureAnchor = pinchAnchor ?? captureImageScaleAnchor(contents);
    pinchInputSource = "gesture";
    pinchStart = null;
    pinchAnchor = null;
    pinchPreviewScale = safariGestureStartScale;
    touchStart = null;
    suppressNextClick = true;
    event.preventDefault();
    event.stopPropagation();
  };
  const handleGestureChange = (rawEvent: Event) => {
    const event = rawEvent as SafariGestureEvent;
    if (pinchInputSource !== "gesture" || safariGestureStartScale === null) {
      return;
    }
    const scale = typeof event.scale === "number" && Number.isFinite(event.scale) ? event.scale : 1;
    schedulePinchPreview(
      getPinchImageScale({
        startScale: safariGestureStartScale,
        startDistance: 1,
        currentDistance: scale
      })
    );
    event.preventDefault();
    event.stopPropagation();
  };
  const handleGestureEnd = (rawEvent: Event) => {
    const event = rawEvent as SafariGestureEvent;
    if (pinchInputSource !== "gesture" || safariGestureStartScale === null) {
      return;
    }
    const finalScale =
      typeof event.scale === "number" && Number.isFinite(event.scale)
        ? getPinchImageScale({
            startScale: safariGestureStartScale,
            startDistance: 1,
            currentDistance: event.scale
          })
        : pinchPreviewScale ?? settingsRef.current.imageScale;
    commitPinchScale(finalScale, safariGestureAnchor);
    event.preventDefault();
    event.stopPropagation();
  };
  doc.addEventListener("gesturestart", handleGestureStart as EventListener, touchListenerOptions);
  doc.addEventListener("gesturechange", handleGestureChange as EventListener, touchListenerOptions);
  doc.addEventListener("gestureend", handleGestureEnd as EventListener, touchListenerOptions);

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

      if (turnFromClientX(event.clientX)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      onToggleControls();
    },
    true
  );
}

function isZoomedImageDocument(doc: Document, settings: ReaderSettings): boolean {
  return (
    settings.imageScale > 100 &&
    doc.documentElement.classList.contains("reader-image-document")
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

  const nodeName = element.nodeName?.toLowerCase();
  return (
    nodeName === "img" ||
    nodeName === "image" ||
    nodeName === "svg" ||
    Boolean(element.closest("img, picture, svg"))
  );
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
  gripMode: GripMode,
  fixedLayout: boolean
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
    theme,
    fixedLayout
  });
}
