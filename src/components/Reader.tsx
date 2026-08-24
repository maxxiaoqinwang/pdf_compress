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
  getCenteredScaledContentOffset,
  getEstimatedSingleImageHeight,
  getImageScaleStylesheet,
  getLocationPercentage,
  getLocationSpineIndex,
  getPageClickDirection,
  getPageImageFrameHeight,
  getPageSwipeAvailability,
  getPinchImageScale,
  getProgressPercent,
  getScaledFixedLayoutWidth,
  getScrollImagePageViewHeight,
  getStableSingleImageHeight,
  getToolbarPageControls,
  getVerticalPageSwipeDirection,
  getTouchDistance,
  isTapGesture,
  type PageClickDirection,
  type PageSwipeAvailability
} from "../lib/readerInteraction";
import { installFileBackedEpubArchive } from "../lib/fileBackedEpubArchive";
import { readBlobAsArrayBuffer } from "../lib/blobReader";
import { applyContentStylesheet } from "../lib/contentStylesheet";
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
type ReaderSettings = ReaderPreferences & { readingMode: ReadingMode };
type PagePosition = {
  current: number;
  total: number;
} | null;
type ProgressSnapshot = {
  percent: number;
  label: string;
  pagePosition: PagePosition;
};

type ReaderDocument = Document & {
  __readerPointerBehaviorInstalled?: boolean;
  __readerImageHeightCleanup?: () => void;
};

const COMPACT_READER_QUERY =
  "(max-width: 760px), (pointer: coarse) and (max-height: 500px)";
const LAZY_RESOURCE_THRESHOLD = 32 * 1024 * 1024;
const PROGRESS_SAVE_DELAY = 650;
const DEFAULT_PAGE_HOTZONE_WIDTH = "30%";
const TALL_IMAGE_PAGE_HOTZONE_WIDTH = "15%";
const STAGE_SCROLL_TOLERANCE = 4;

export function Reader({ file, onClose }: ReaderProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const lazyResourcesRef = useRef<LazyEpubResourceController | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const pageTurnLockedRef = useRef(false);
  const pageHotzoneWidthRef = useRef(DEFAULT_PAGE_HOTZONE_WIDTH);
  const lastHotzoneTouchRef = useRef(0);
  const hotzonePinchStartRef = useRef<{
    distance: number;
    imageScale: number;
  } | null>(null);
  const hotzoneTouchStartRef = useRef<{
    side: "left" | "right";
    x: number;
    y: number;
    lastY: number;
    viewportHeight: number;
    didScroll: boolean;
  } | null>(null);
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
  const [pagePosition, setPagePosition] = useState<PagePosition>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(readCompactViewport);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [imageDocumentActive, setImageDocumentActive] = useState(false);
  const [pageHotzoneWidth, setPageHotzoneWidth] = useState(DEFAULT_PAGE_HOTZONE_WIDTH);
  const [hotzonePinchActive, setHotzonePinchActive] = useState(false);

  const pageControls = getToolbarPageControls(gripMode);

  function setMeasuredPageHotzoneWidth(width: string) {
    if (pageHotzoneWidthRef.current === width) {
      return;
    }

    pageHotzoneWidthRef.current = width;
    setPageHotzoneWidth(width);
  }

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
    if (status !== "ready" || readingMode !== "page" || !imageDocumentActive || imageScale > 100) {
      setMeasuredPageHotzoneWidth(DEFAULT_PAGE_HOTZONE_WIDTH);
      return undefined;
    }

    const updateHotzoneWidth = () => {
      const stage = stageRef.current;
      const isTallImagePage = Boolean(
        stage && stage.scrollHeight > stage.clientHeight + STAGE_SCROLL_TOLERANCE
      );
      setMeasuredPageHotzoneWidth(
        isTallImagePage ? TALL_IMAGE_PAGE_HOTZONE_WIDTH : DEFAULT_PAGE_HOTZONE_WIDTH
      );
    };

    updateHotzoneWidth();
    const animationFrame = window.requestAnimationFrame(updateHotzoneWidth);
    const timer = window.setTimeout(updateHotzoneWidth, 0);
    const stage = stageRef.current;
    const ResizeObserverCtor = (
      window as unknown as { ResizeObserver?: typeof ResizeObserver }
    ).ResizeObserver;
    const observer =
      stage && typeof ResizeObserverCtor === "function"
        ? new ResizeObserverCtor(updateHotzoneWidth)
        : null;
    if (observer && stage) {
      observer.observe(stage);
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [status, readingMode, imageDocumentActive, imageScale]);

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
    setPagePosition(null);
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
    setImageDocumentActive(false);
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
      (isImageDocument) => setImageDocumentActive(isImageDocument),
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
      gripMode
    );

    const handleRelocated = (location: Location) => {
      stageRef.current?.scrollTo({ top: 0, left: 0 });
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
      setImageDocumentActive(false);
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
    setPagePosition(snapshot.pagePosition);
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

  function turnFromHotzone(side: "left" | "right") {
    const stage = stageRef.current;
    if (!stage || imageScale > 100) {
      return;
    }

    const bounds = stage.getBoundingClientRect();
    const direction = getPageClickDirection({
      readingMode: "page",
      gripMode,
      clientX: side === "left" ? bounds.left + 1 : bounds.right - 1,
      boundsLeft: bounds.left,
      boundsWidth: bounds.width
    });
    if (direction) {
      void turnPage(direction);
    }
  }

  function beginHotzonePinch(event: React.TouchEvent<HTMLButtonElement>) {
    if (event.touches.length !== 2) {
      return false;
    }

    hotzoneTouchStartRef.current = null;
    hotzonePinchStartRef.current = {
      distance: getTouchDistance(event.touches[0], event.touches[1]),
      imageScale
    };
    setHotzonePinchActive(true);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function updateHotzonePinch(event: React.TouchEvent<HTMLButtonElement>) {
    const start = hotzonePinchStartRef.current;
    if (!start || event.touches.length !== 2) {
      return false;
    }

    const nextImageScale = getPinchImageScale({
      startScale: start.imageScale,
      startDistance: start.distance,
      currentDistance: getTouchDistance(event.touches[0], event.touches[1])
    });
    setImageScale(nextImageScale);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function finishHotzonePinch(event: React.TouchEvent<HTMLButtonElement>) {
    if (!hotzonePinchStartRef.current) {
      return false;
    }

    if (event.touches.length < 2) {
      hotzonePinchStartRef.current = null;
      setHotzonePinchActive(false);
      lastHotzoneTouchRef.current = Date.now();
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handleHotzoneTouchStart(
    side: "left" | "right",
    event: React.TouchEvent<HTMLButtonElement>
  ) {
    if (beginHotzonePinch(event)) {
      return;
    }

    if (event.touches.length !== 1) {
      hotzoneTouchStartRef.current = null;
      return;
    }

    const touch = event.touches[0];
    hotzoneTouchStartRef.current = {
      side,
      x: touch.clientX,
      y: touch.clientY,
      lastY: touch.clientY,
      viewportHeight: stageRef.current?.clientHeight ?? window.innerHeight,
      didScroll: false
    };
  }

  function handleHotzoneTouchMove(
    side: "left" | "right",
    event: React.TouchEvent<HTMLButtonElement>
  ) {
    const start = hotzoneTouchStartRef.current;
    const touch = event.touches[0];
    const stage = stageRef.current;
    if (updateHotzonePinch(event)) {
      return;
    }

    if (!start || !touch || start.side !== side || event.touches.length !== 1 || !stage) {
      return;
    }

    const maxScrollTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
    if (maxScrollTop <= 4) {
      return;
    }

    const totalX = touch.clientX - start.x;
    const totalY = touch.clientY - start.y;
    if (Math.abs(totalY) <= 3 || Math.abs(totalY) <= Math.abs(totalX)) {
      return;
    }

    const nextScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, stage.scrollTop + start.lastY - touch.clientY)
    );
    if (nextScrollTop !== stage.scrollTop) {
      stage.scrollTop = nextScrollTop;
      start.didScroll = true;
      event.preventDefault();
      event.stopPropagation();
    }
    start.lastY = touch.clientY;
  }

  function handleHotzoneTouchEnd(
    side: "left" | "right",
    event: React.TouchEvent<HTMLButtonElement>
  ) {
    const start = hotzoneTouchStartRef.current;
    const touch = event.changedTouches[0];
    if (finishHotzonePinch(event)) {
      return;
    }

    hotzoneTouchStartRef.current = null;
    if (!start || !touch || start.side !== side) {
      return;
    }

    if (start.didScroll) {
      event.preventDefault();
      event.stopPropagation();
      lastHotzoneTouchRef.current = Date.now();
      return;
    }

    const wasTap = isTapGesture({
      startX: start.x,
      startY: start.y,
      endX: touch.clientX,
      endY: touch.clientY
    });
    const stageSwipeAvailability = getStagePageSwipeAvailability(stageRef.current);
    const swipeDirection = getVerticalPageSwipeDirection({
      readingMode: "page",
      startX: start.x,
      startY: start.y,
      endX: touch.clientX,
      endY: touch.clientY,
      viewportHeight: start.viewportHeight,
      allowPrev: stageSwipeAvailability.prev,
      allowNext: stageSwipeAvailability.next
    });
    if (!wasTap && !swipeDirection) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    lastHotzoneTouchRef.current = Date.now();
    if (swipeDirection) {
      void turnPage(swipeDirection);
    } else {
      turnFromHotzone(side);
    }
  }

  function handleHotzoneClick(
    side: "left" | "right",
    event: React.MouseEvent<HTMLButtonElement>
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() - lastHotzoneTouchRef.current < 500) {
      return;
    }
    turnFromHotzone(side);
  }

  function handleHotzoneTouchCancel(event: React.TouchEvent<HTMLButtonElement>) {
    if (finishHotzonePinch(event)) {
      return;
    }

    hotzoneTouchStartRef.current = null;
  }

  const chromeIsVisible =
    !isCompactViewport || controlsVisible || activeSheet !== null || status !== "ready";

  return (
    <section
      className={`reader-shell ${theme} ${readingMode} ${
        chromeIsVisible ? "controls-visible" : "controls-hidden"
      } ${imageDocumentActive ? "image-document-active" : ""}`}
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
        {status === "ready" &&
        readingMode === "page" &&
        imageDocumentActive &&
        (imageScale <= 100 || hotzonePinchActive) ? (
          <div
            className="reader-hotzones"
            aria-label="分页点击区域"
            style={{ "--reader-hotzone-width": pageHotzoneWidth } as CSSProperties}
          >
            <button
              className="reader-hotzone left"
              type="button"
              tabIndex={-1}
              aria-label={gripMode === "left" ? "下一页" : "上一页"}
              onTouchStart={(event) => handleHotzoneTouchStart("left", event)}
              onTouchMove={(event) => handleHotzoneTouchMove("left", event)}
              onTouchEnd={(event) => handleHotzoneTouchEnd("left", event)}
              onTouchCancel={handleHotzoneTouchCancel}
              onClick={(event) => handleHotzoneClick("left", event)}
            />
            <button
              className="reader-hotzone right"
              type="button"
              tabIndex={-1}
              aria-label={gripMode === "left" ? "上一页" : "下一页"}
              onTouchStart={(event) => handleHotzoneTouchStart("right", event)}
              onTouchMove={(event) => handleHotzoneTouchMove("right", event)}
              onTouchEnd={(event) => handleHotzoneTouchEnd("right", event)}
              onTouchCancel={handleHotzoneTouchCancel}
              onClick={(event) => handleHotzoneClick("right", event)}
            />
          </div>
        ) : null}
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
              <TocPanel
                toc={toc}
                pagePosition={pagePosition}
                progressLabel={progressLabel}
                onSelect={(href) => void goToChapter(href)}
              />
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
  pagePosition: PagePosition;
  progressLabel: string;
  onSelect: (href: string) => void;
};

function TocPanel({ toc, pagePosition, progressLabel, onSelect }: TocPanelProps) {
  const positionLabel = pagePosition ? `${pagePosition.current} / ${pagePosition.total}` : progressLabel;

  return (
    <nav className="toc-panel sheet" aria-label="目录">
      <div className="toc-progress-card" aria-label="阅读位置">
        <span>当前页</span>
        <strong>{positionLabel}</strong>
      </div>
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
  onImageDocumentChange: (isImageDocument: boolean) => void,
  lazyResources?: LazyEpubResourceController | null
) {
  rendition.hooks.content.register((contents: Contents) => {
    lazyResources?.activateDocument(contents.document);
    applyImageScaleToContent(contents, settingsRef.current);
    onImageDocumentChange(
      contents.document.documentElement.classList.contains("reader-image-document")
    );
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
  const pagePosition = getPagePosition(location, book);

  if (locationsReady && cfi) {
    try {
      const percentage = book.locations.percentageFromCfi(cfi);
      if (Number.isFinite(percentage)) {
        const percent = Math.round(Math.min(1, Math.max(0, percentage)) * 100);
        return { percent, label: `${percent}%`, pagePosition };
      }
    } catch {
      // Fall through to epub.js location data or chapter-level progress.
    }
  }

  const explicitPercentage = getLocationPercentage(location);
  if (explicitPercentage !== null) {
    const percent = getProgressPercent(location);
    return { percent, label: `${percent}%`, pagePosition };
  }

  const spineItemCount = getSpineItemCount(book);
  const spineIndex = getLocationSpineIndex(location);
  if (spineItemCount && spineIndex !== null) {
    const percent = getProgressPercent(location, spineItemCount);
    const unit = bookLayout === "pre-paginated" ? "页" : "章";
    return {
      percent,
      label: `第 ${Math.min(spineItemCount, spineIndex + 1)}/${spineItemCount} ${unit}`,
      pagePosition
    };
  }

  return { percent: 0, label: "开始", pagePosition };
}

function getPagePosition(location: unknown, book: Book | null): PagePosition {
  const total = getSpineItemCount(book);
  const spineIndex = getLocationSpineIndex(location);
  if (!total || spineIndex === null) {
    return null;
  }

  return {
    current: Math.min(total, Math.max(1, spineIndex + 1)),
    total
  };
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
    const body = document.querySelector("body");
    const head = document.querySelector("head");
    if (!root || !body || !head) {
      return;
    }

    const mediaElements = body.querySelectorAll("img, svg");
    const textProbe = body.cloneNode(true) as Element;
    textProbe.querySelectorAll("img, svg").forEach((element) => element.remove());
    const meaningfulText = textProbe.textContent?.replace(/\s+/g, "") ?? "";
    if (mediaElements.length !== 1 || meaningfulText.length > 0) {
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
  const effectiveImageScale = settings.imageScale;
  const isSingleImagePage = markSingleImagePage(
    contents,
    effectiveImageScale,
    settings.readingMode
  );
  applyContentStylesheet(
    contents,
    getImageScaleStylesheet(effectiveImageScale),
    "reader-image-scale"
  );
  if (syncHeight) {
    syncSingleImageViewHeight(
      contents,
      settings.readingMode,
      isSingleImagePage,
      effectiveImageScale
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
  const svgImages = body.querySelectorAll("svg image");
  const mediaCount = images.length + svgImages.length;
  const textProbe = body.cloneNode(true) as Element;
  textProbe
    .querySelectorAll("img, picture, source, svg, style, script, noscript")
    .forEach((element) => element.remove());
  const meaningfulText = textProbe.textContent?.replace(/\s+/g, "") ?? "";
  const isImageDocument =
    mediaCount > 0 && meaningfulText.length <= Math.max(48, mediaCount * 12);
  const isSingleImagePage = mediaCount === 1 && isImageDocument && images.length === 1;
  doc.documentElement.classList.toggle("reader-image-document", isImageDocument);
  doc.documentElement.classList.toggle("reader-image-page", isSingleImagePage);
  doc.documentElement.classList.toggle("reader-scroll-mode", readingMode === "scroll");
  doc.documentElement.classList.toggle("reader-page-mode", readingMode === "page");

  if (!isSingleImagePage) {
    doc.documentElement.style.removeProperty("--reader-fixed-layout-width");
    clearSingleImageViewLayout(contents);
    return false;
  }

  updateSingleImagePageWidth(contents, images[0], imageScale);
  return true;
}

function updateSingleImagePageWidth(contents: Contents, image: HTMLImageElement, imageScale: number) {
  const viewportContent = contents.document
    .querySelector("meta[name='viewport']")
    ?.getAttribute("content");
  const scaledWidth = getScaledFixedLayoutWidth(
    viewportContent,
    image.naturalWidth > 1 ? image.naturalWidth : null,
    imageScale
  );
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

  applySingleImageViewLayout(frameElement, viewElement);

  const applyHeight = () => {
    applySingleImageViewLayout(frameElement, viewElement);
    updateSingleImagePageWidth(contents, image, imageScale);
    const imageHeight = image.getBoundingClientRect().height;
    const parentBounds = viewElement.parentElement?.getBoundingClientRect();
    const viewBounds = viewElement.getBoundingClientRect();
    const frameBounds = frameElement.getBoundingClientRect();
    const pageHeight = parentBounds?.height || viewBounds.height || contents.window.innerHeight;
    const frameWidth =
      frameBounds.width || parentBounds?.width || viewBounds.width || contents.window.innerWidth;
    const viewportContent = doc
      .querySelector("meta[name='viewport']")
      ?.getAttribute("content");
    const estimatedImageHeight = getEstimatedSingleImageHeight({
      viewportContent,
      naturalWidth: image.naturalWidth > 1 ? image.naturalWidth : null,
      naturalHeight: image.naturalHeight > 1 ? image.naturalHeight : null,
      attributeWidth: Number(image.getAttribute("width")),
      attributeHeight: Number(image.getAttribute("height")),
      frameWidth,
      imageScale,
      fallbackHeight: pageHeight
    });
    const stableImageHeight = getStableSingleImageHeight({
      measuredHeight: imageHeight,
      estimatedHeight: estimatedImageHeight,
      fallbackHeight: pageHeight
    });
    const pageFrameHeight = getPageImageFrameHeight(
      readingMode,
      true,
      pageHeight,
      stableImageHeight
    );
    const scrollViewHeight = getScrollImagePageViewHeight(
      readingMode,
      true,
      stableImageHeight
    );
    const targetHeight = pageFrameHeight ?? scrollViewHeight;

    if (!targetHeight) {
      return;
    }

    const height = `${targetHeight}px`;
    frameElement.style.setProperty("height", height);
    viewElement.style.setProperty("height", height);
    centerSingleImageDocument(contents, image);
  };

  // Set a non-zero placeholder synchronously, before epub.js continuous fill()
  // measures the view. The next frame and image load refine it with real data.
  applyHeight();
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

function applySingleImageViewLayout(frameElement: HTMLIFrameElement, viewElement: HTMLElement) {
  frameElement.dataset.readerImageFrame = "true";
  viewElement.dataset.readerImageView = "true";
  frameElement.style.setProperty("display", "block");
  frameElement.style.setProperty("width", "100%");
  frameElement.style.setProperty("max-width", "100%");
  frameElement.style.setProperty("margin-left", "auto");
  frameElement.style.setProperty("margin-right", "auto");
  frameElement.style.setProperty("background-color", "#000");
  viewElement.style.setProperty("width", "100%");
  viewElement.style.setProperty("max-width", "100%");
  viewElement.style.setProperty("margin-left", "auto");
  viewElement.style.setProperty("margin-right", "auto");
  viewElement.style.setProperty("background-color", "#000");
}

function clearSingleImageViewLayout(contents: Contents) {
  const frameElement = contents.window.frameElement as HTMLIFrameElement | null;
  const viewElement = frameElement?.closest(".epub-view") as HTMLElement | null;
  frameElement?.removeAttribute("data-reader-image-frame");
  viewElement?.removeAttribute("data-reader-image-view");
  frameElement?.style.removeProperty("display");
  frameElement?.style.removeProperty("width");
  frameElement?.style.removeProperty("max-width");
  frameElement?.style.removeProperty("margin-left");
  frameElement?.style.removeProperty("margin-right");
  frameElement?.style.removeProperty("background-color");
  contents.document.body?.style.removeProperty("margin-left");
  contents.document.body?.style.removeProperty("margin-right");
  viewElement?.style.removeProperty("width");
  viewElement?.style.removeProperty("max-width");
  viewElement?.style.removeProperty("margin-left");
  viewElement?.style.removeProperty("margin-right");
  viewElement?.style.removeProperty("background-color");
}

function centerSingleImageDocument(contents: Contents, image: HTMLImageElement) {
  const body = contents.document.body;
  if (!body) {
    return;
  }

  const frameElement = contents.window.frameElement as HTMLIFrameElement | null;
  const frameBounds = frameElement?.getBoundingClientRect();
  const viewportWidth =
    readFiniteLayoutValue(contents.window.innerWidth) ||
    readFiniteLayoutValue(contents.document.documentElement?.clientWidth) ||
    readFiniteLayoutValue(frameBounds?.width);
  const imageBounds = image.getBoundingClientRect();
  const offset = getCenteredScaledContentOffset({
    viewportWidth,
    visualWidth: imageBounds.width
  });
  const marginLeft = `${Math.round(offset * 1000) / 1000}px`;
  body.style.setProperty("margin-left", marginLeft, "important");
  body.style.setProperty("margin-right", "0px", "important");
}

function previewImageScale(contents: Contents, imageScale: number) {
  const root = contents.document.documentElement;
  const image = contents.document.querySelector("img");
  if (root.classList.contains("reader-image-page") && image) {
    updateSingleImagePageWidth(contents, image, imageScale);
    return;
  }

  root.style.setProperty(
    "--reader-fixed-layout-width",
    `${Math.min(400, Math.max(100, Math.round(imageScale)))}%`
  );
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
  let touchStart: {
    x: number;
    y: number;
    viewportHeight: number;
    allowPrev: boolean;
    allowNext: boolean;
  } | null = null;
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

      previewImageScale(contents, pinchPreviewScale);
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
      const isImageDocument =
        doc.documentElement.classList.contains("reader-image-document") ||
        Boolean(doc.querySelector("img, svg image"));
      if (event.touches.length === 2 && isImageDocument) {
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
      const swipeAvailability =
        settingsRef.current.readingMode === "page"
          ? getContentPageSwipeAvailability(contents)
          : { prev: false, next: false, scrollable: false };
      touchStart = {
        x: touch.clientX,
        y: touch.clientY,
        viewportHeight: getContentViewportHeight(contents),
        allowPrev: swipeAvailability.prev,
        allowNext: swipeAvailability.next
      };
    },
    touchListenerOptions
  );

  doc.addEventListener(
    "touchmove",
    (event) => {
      if (pinchStart && event.touches.length === 2) {
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
      const deltaX = touch.clientX - touchStart.x;
      const deltaY = touch.clientY - touchStart.y;
      const horizontalDistance = Math.abs(deltaX);
      const verticalDistance = Math.abs(deltaY);
      const directionAllowed =
        (deltaY < 0 && touchStart.allowNext) || (deltaY > 0 && touchStart.allowPrev);

      // Capture only a clearly vertical page gesture that was eligible when
      // the finger first touched the page. A tall or zoomed image keeps native
      // panning until the user releases at an edge and starts a fresh swipe.
      if (
        directionAllowed &&
        verticalDistance > 12 &&
        verticalDistance > horizontalDistance * 1.2
      ) {
        event.preventDefault();
        event.stopPropagation();
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

      const swipeDirection = getVerticalPageSwipeDirection({
        startX: gestureStart.x,
        startY: gestureStart.y,
        endX: touch.clientX,
        endY: touch.clientY,
        viewportHeight: gestureStart.viewportHeight,
        allowPrev: gestureStart.allowPrev,
        allowNext: gestureStart.allowNext
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

function getContentPageSwipeAvailability(contents: Contents): PageSwipeAvailability {
  const doc = contents.document;
  const root = doc.documentElement;
  const isImageDocument =
    root.classList.contains("reader-image-document") || Boolean(doc.querySelector("img, svg image"));
  if (!isImageDocument) {
    return { prev: true, next: true, scrollable: false };
  }

  const viewportHeight = getContentViewportHeight(contents);
  const bounds = getVisualImageBounds(doc);
  if (!bounds) {
    return { prev: true, next: true, scrollable: false };
  }

  return getPageSwipeAvailability({
    contentTop: bounds.top,
    contentBottom: bounds.bottom,
    viewportHeight
  });
}

function getStagePageSwipeAvailability(stage: HTMLElement | null): PageSwipeAvailability {
  if (!stage || stage.scrollHeight <= stage.clientHeight + 4) {
    return { prev: true, next: true, scrollable: false };
  }

  return getPageSwipeAvailability({
    contentTop: -stage.scrollTop,
    contentBottom: stage.scrollHeight - stage.scrollTop,
    viewportHeight: stage.clientHeight
  });
}

function getVisualImageBounds(doc: Document): { top: number; bottom: number } | null {
  const candidates = Array.from(doc.querySelectorAll("img, svg"));
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const element of candidates) {
    const bounds = element.getBoundingClientRect();
    if (
      Number.isFinite(bounds.top) &&
      Number.isFinite(bounds.bottom) &&
      bounds.bottom > bounds.top
    ) {
      top = Math.min(top, bounds.top);
      bottom = Math.max(bottom, bounds.bottom);
    }
  }

  return Number.isFinite(top) && Number.isFinite(bottom) && bottom > top
    ? { top, bottom }
    : null;
}

function getContentViewportHeight(contents: Contents): number {
  const windowHeight = readFiniteLayoutValue(contents.window.innerHeight);
  if (windowHeight > 0) {
    return windowHeight;
  }

  const rootHeight = readFiniteLayoutValue(contents.document.documentElement?.clientHeight);
  if (rootHeight > 0) {
    return rootHeight;
  }

  return readFiniteLayoutValue(contents.document.body?.clientHeight);
}

function readFiniteLayoutValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
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
