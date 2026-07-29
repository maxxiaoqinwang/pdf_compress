import type { Book, Rendition } from "epubjs";

type ResourceHook = (document: Document, section: LazySection) => Promise<void>;

type HookRegistry = {
  register: (hook: ResourceHook) => void;
  deregister?: (hook: ResourceHook) => void;
};

type LazySection = {
  index?: number;
  href?: string;
  url?: string;
  unload?: () => void;
};

type ArchiveLike = {
  getBlob: (path: string, mimeType?: string) => Promise<Blob> | undefined;
  getText: (path: string, encoding?: string) => Promise<string> | undefined;
};

type LazyBookInternals = {
  archive?: ArchiveLike;
  replacements?: () => Promise<unknown>;
  spine: {
    hooks: {
      content: HookRegistry;
    };
  };
};

type LazyView = {
  section?: unknown;
};

type LazyViewCollection = {
  all?: () => LazyView[];
  remove?: (view: LazyView) => unknown;
  clear?: () => unknown;
};

type LazyRenditionInternals = {
  started?: Promise<unknown>;
  manager?: {
    views?: LazyViewCollection;
  };
  on?: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
};

type CachedResource = {
  objectUrl: string;
  references: number;
};

export type ResolvedArchiveResource = {
  path: string;
  suffix: string;
};

export type LazyEpubResourceController = {
  activateDocument: (document: Document) => void;
  releaseSection: (section: unknown) => void;
  resetRenderedSections: () => void;
  destroy: () => void;
};

const EPUB_RESOURCE_ORIGIN = "https://epub.local";
const EXTERNAL_RESOURCE_PATTERN = /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i;
const CSS_URL_PATTERN = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
const CSS_IMPORT_PATTERN = /@import\s+(["'])(.*?)\1/gi;
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const LAZY_SECTION_ATTRIBUTE = "data-reader-lazy-section";
const LAZY_PATH_ATTRIBUTE = "data-reader-lazy-path";
const LAZY_SUFFIX_ATTRIBUTE = "data-reader-lazy-suffix";
const LAZY_STATE_ATTRIBUTE = "data-reader-lazy-state";
const LAZY_SRCSET_ATTRIBUTE = "data-reader-lazy-srcset";
const LAZY_BASE_ATTRIBUTE = "data-reader-lazy-base";
const LAZY_NEEDS_SIZE_CLASS = "reader-lazy-needs-size";
const MAX_CONCURRENT_IMAGE_LOADS = 2;
const TRANSPARENT_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

/**
 * epub.js normally creates Blob URLs for every manifest asset before the first
 * page can render. Large image books can therefore decompress hundreds of MB
 * at once. This hook resolves only the resources referenced by a rendered
 * section and releases them when that section leaves the view manager.
 */
export function installLazyEpubResourceLoading(book: Book): LazyEpubResourceController {
  const internals = book as unknown as LazyBookInternals;
  // epub.js 0.3.93 still rewrites every CSS file even when replacements is
  // set to "none". This hook must be installed before book.open(), so replace
  // that eager pass with a no-op and let the section hook below do the work.
  internals.replacements = async () => undefined;
  const contentHooks = internals.spine.hooks.content;
  const loader = new LazyResourceLoader(() => internals.archive);
  const contentHook: ResourceHook = async (document, section) => {
    await loader.rewriteDocument(document, section);
  };

  contentHooks.register(contentHook);

  return {
    activateDocument(document) {
      loader.activateDocument(document);
    },
    releaseSection(section) {
      loader.releaseSection(section as LazySection);
    },
    resetRenderedSections() {
      loader.releaseAllSections();
    },
    destroy() {
      contentHooks.deregister?.(contentHook);
      loader.destroy();
    }
  };
}

/**
 * epub.js 0.3.93 does not emit a public removal event for every internal
 * `views.remove()` / `views.clear()` call. Patch that collection only for the
 * lifetime of the rendition so released pages also release their Blob URLs.
 */
export function attachLazyResourceCleanup(
  rendition: Rendition,
  controller: LazyEpubResourceController
): () => void {
  const internals = rendition as unknown as LazyRenditionInternals;
  let disposed = false;
  let patchedViews: LazyViewCollection | null = null;
  let detachPatchedViews = () => {};

  const attach = (): boolean => {
    if (disposed || patchedViews) {
      return Boolean(patchedViews);
    }

    const views = internals.manager?.views;
    if (!views) {
      return false;
    }

    const originalRemove = views.remove;
    const originalClear = views.clear;
    let wrappedRemove: LazyViewCollection["remove"];
    let wrappedClear: LazyViewCollection["clear"];

    if (originalRemove) {
      wrappedRemove = function (this: LazyViewCollection, view: LazyView) {
        const section = view?.section;
        const result = originalRemove.call(this, view);
        if (section) {
          controller.releaseSection(section);
        }
        return result;
      };
      views.remove = wrappedRemove;
    }

    if (originalClear) {
      wrappedClear = function (this: LazyViewCollection) {
        const sections = this.all?.().map((view) => view.section).filter(Boolean) ?? [];
        const result = originalClear.call(this);
        for (const section of sections) {
          controller.releaseSection(section);
        }
        return result;
      };
      views.clear = wrappedClear;
    }

    patchedViews = views;
    detachPatchedViews = () => {
      if (wrappedRemove && views.remove === wrappedRemove) {
        views.remove = originalRemove;
      }
      if (wrappedClear && views.clear === wrappedClear) {
        views.clear = originalClear;
      }
      patchedViews = null;
    };
    return true;
  };

  // `rendition.started` resolves when the manager is constructed, but epub.js
  // creates `manager.views` later while the rendition is attached to the DOM.
  // Listen for that public lifecycle event so the cleanup patch cannot miss the
  // view collection on slower devices or large archives.
  const handleAttached = () => {
    attach();
  };
  internals.on?.("attached", handleAttached);

  if (!attach()) {
    void internals.started?.then(() => {
      queueMicrotask(attach);
    }).catch(() => {});
  }

  return () => {
    disposed = true;
    internals.off?.("attached", handleAttached);
    detachPatchedViews();
  };
}

export function resolveArchiveResource(
  rawValue: string | null | undefined,
  basePath: string | null | undefined
): ResolvedArchiveResource | null {
  const value = rawValue?.trim();
  if (!value || EXTERNAL_RESOURCE_PATTERN.test(value)) {
    return null;
  }

  try {
    const normalizedBase = normalizeArchiveBasePath(basePath);
    const resolved = new URL(value, `${EPUB_RESOURCE_ORIGIN}${normalizedBase}`);
    if (resolved.origin !== EPUB_RESOURCE_ORIGIN) {
      return null;
    }

    return {
      path: resolved.pathname,
      // Fragments can address an element inside an SVG. Query strings are not
      // part of the ZIP entry and can make a Blob URL unresolvable in Safari.
      suffix: resolved.hash
    };
  } catch {
    return null;
  }
}

class LazyResourceLoader {
  private readonly getArchive: () => ArchiveLike | undefined;
  private readonly cache = new Map<string, CachedResource>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly sectionResources = new Map<string, Set<string>>();
  private readonly sections = new Map<string, LazySection>();
  private readonly activeSections = new Set<string>();
  private readonly sectionCleanups = new Map<string, Set<() => void>>();
  private readonly activatedDocuments = new WeakSet<Document>();
  private readonly sectionKeys = new WeakMap<object, string>();
  private nextSectionKey = 0;
  private destroyed = false;

  constructor(getArchive: () => ArchiveLike | undefined) {
    this.getArchive = getArchive;
  }

  async rewriteDocument(document: Document, section: LazySection): Promise<void> {
    if (this.destroyed || !document.documentElement || !this.getArchive()) {
      return;
    }

    const sectionKey = this.getSectionKey(section);
    this.activeSections.add(sectionKey);
    this.sections.set(sectionKey, section);

    const basePath = normalizeArchiveBasePath(section.url ?? section.href);
    document.documentElement.setAttribute(LAZY_SECTION_ATTRIBUTE, sectionKey);
    this.prepareLazyImages(document, basePath);

    const tasks: Promise<void>[] = [];
    this.queueAttributeRewrites(document, sectionKey, basePath, tasks);
    this.queueInlineStyleRewrites(document, sectionKey, basePath, tasks);
    this.queueStylesheetRewrites(document, sectionKey, basePath, tasks);
    await Promise.all(tasks);
  }

  activateDocument(document: Document): void {
    if (this.destroyed || this.activatedDocuments.has(document)) {
      return;
    }

    const sectionKey = document.documentElement?.getAttribute(LAZY_SECTION_ATTRIBUTE);
    if (!sectionKey || !this.activeSections.has(sectionKey)) {
      return;
    }

    this.activatedDocuments.add(document);
    this.installImageProximityLoader(document, sectionKey);
  }

  releaseSection(section: LazySection): void {
    const sectionKey = this.findSectionKey(section);
    if (sectionKey) {
      this.releaseSectionByKey(sectionKey);
    }
  }

  releaseAllSections(): void {
    const keys = new Set([
      ...this.activeSections,
      ...this.sections.keys(),
      ...this.sectionResources.keys(),
      ...this.sectionCleanups.keys()
    ]);
    for (const sectionKey of keys) {
      this.releaseSectionByKey(sectionKey);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.releaseAllSections();
    for (const cached of this.cache.values()) {
      URL.revokeObjectURL(cached.objectUrl);
    }
    this.cache.clear();
    this.pending.clear();
    this.activeSections.clear();
    this.sections.clear();
    this.sectionCleanups.clear();
  }

  private prepareLazyImages(document: Document, basePath: string) {
    const mediaElements = Array.from(
      document.querySelectorAll<Element>(
        "img[src], img[srcset], image[href], image[xlink\\:href]"
      )
    );
    if (mediaElements.length === 0) {
      return;
    }

    const imageDominantDocument = isImageDominantDocument(document);
    if (imageDominantDocument) {
      document.documentElement.classList.add("reader-lazy-image-document");
    }
    installLazyImagePlaceholderStyle(document);

    for (const media of mediaElements) {
      const originalSource = getLazyMediaSource(media);
      const fallbackFromSrcset =
        media.localName.toLowerCase() === "img"
          ? getBestSrcsetCandidate(media.getAttribute("srcset"))
          : null;
      const resolved =
        resolveArchiveResource(originalSource, basePath) ??
        resolveArchiveResource(fallbackFromSrcset, basePath);
      if (!resolved) {
        continue;
      }

      media.setAttribute(LAZY_PATH_ATTRIBUTE, resolved.path);
      media.setAttribute(LAZY_SUFFIX_ATTRIBUTE, resolved.suffix);
      media.setAttribute(LAZY_BASE_ATTRIBUTE, basePath);
      media.setAttribute(LAZY_STATE_ATTRIBUTE, "pending");
      media.classList.add("reader-lazy-image");

      const sizingElement = getLazyMediaSizingElement(media);
      if (imageDominantDocument) {
        sizingElement.classList.add("reader-lazy-page-image");
      }

      if (media.localName.toLowerCase() === "img") {
        const image = media as HTMLImageElement;
        image.setAttribute("loading", "lazy");
        image.setAttribute("decoding", "async");
        preserveImageAspectRatio(image);
        if (!hasImageSizeHint(image)) {
          sizingElement.classList.add(LAZY_NEEDS_SIZE_CLASS);
        }

        const srcset = image.getAttribute("srcset");
        if (srcset) {
          image.setAttribute(LAZY_SRCSET_ATTRIBUTE, srcset);
          image.removeAttribute("srcset");
        }
      }

      setLazyMediaSource(media, TRANSPARENT_IMAGE);
    }

    // A <picture> source can request an image before its fallback <img> enters
    // the viewport. Keep sources inert; the fallback image remains the single
    // controlled source and prevents a browser from decoding multiple variants.
    document
      .querySelectorAll<HTMLSourceElement>("picture source[src], picture source[srcset]")
      .forEach((source) => {
        source.removeAttribute("src");
        source.removeAttribute("srcset");
      });
  }

  private installImageProximityLoader(document: Document, sectionKey: string) {
    const elements = Array.from(
      document.querySelectorAll<Element>(
        `[${LAZY_PATH_ATTRIBUTE}][${LAZY_STATE_ATTRIBUTE}='pending']`
      )
    );
    const archive = this.getArchive();
    if (elements.length === 0 || !archive) {
      return;
    }

    type ImageRecord = {
      element: Element;
      sizingElement: Element;
      path: string;
      suffix: string;
      state: "pending" | "queued" | "loading" | "loaded";
      objectUrl: string | null;
      forceLoad: boolean;
    };

    const records: ImageRecord[] = elements.flatMap((element) => {
      const path = element.getAttribute(LAZY_PATH_ATTRIBUTE);
      return path
        ? [
            {
              element,
              sizingElement: getLazyMediaSizingElement(element),
              path,
              suffix: element.getAttribute(LAZY_SUFFIX_ATTRIBUTE) ?? "",
              state: "pending" as const,
              objectUrl: null,
              forceLoad: false
            }
          ]
        : [];
    });
    if (records.length === 0) {
      return;
    }

    const contentWindow = document.defaultView;
    const schedulerWindow = contentWindow ?? window;
    const frameElement = contentWindow?.frameElement as HTMLElement | null;
    const scrollContainer = findReaderScrollContainer(frameElement);
    const loadQueue: ImageRecord[] = [];
    let disposed = false;
    let animationFrame: number | null = null;
    let activeLoads = 0;

    const scheduleScan = () => {
      if (disposed || animationFrame !== null) {
        return;
      }
      animationFrame = schedulerWindow.requestAnimationFrame(scan);
    };

    const unloadRecord = (record: ImageRecord) => {
      if (record.state !== "loaded" || !record.objectUrl) {
        return;
      }

      setLazyMediaSource(record.element, TRANSPARENT_IMAGE);
      record.element.setAttribute(LAZY_STATE_ATTRIBUTE, "pending");
      URL.revokeObjectURL(record.objectUrl);
      record.objectUrl = null;
      record.state = "pending";
    };

    const finishLoad = (record: ImageRecord) => {
      activeLoads = Math.max(0, activeLoads - 1);
      if (!disposed) {
        pumpQueue();
      }
    };

    const loadRecord = async (record: ImageRecord) => {
      if (disposed || !this.activeSections.has(sectionKey)) {
        finishLoad(record);
        return;
      }

      record.state = "loading";
      record.element.setAttribute(LAZY_STATE_ATTRIBUTE, "loading");
      try {
        const blob = await archive.getBlob(record.path);
        if (!blob) {
          throw new Error(`Missing EPUB image: ${record.path}`);
        }
        if (disposed || !this.activeSections.has(sectionKey)) {
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        if (disposed || !this.activeSections.has(sectionKey)) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        record.objectUrl = objectUrl;
        record.state = "loaded";
        setLazyMediaSource(record.element, `${objectUrl}${record.suffix}`);
        record.element.setAttribute(LAZY_STATE_ATTRIBUTE, "loaded");

        if (record.element.localName.toLowerCase() === "img") {
          const image = record.element as HTMLImageElement;
          const handleDecoded = () => {
            if (image.naturalWidth > 1 && image.naturalHeight > 1) {
              image.style.setProperty(
                "aspect-ratio",
                `${image.naturalWidth} / ${image.naturalHeight}`
              );
              record.sizingElement.classList.remove(LAZY_NEEDS_SIZE_CLASS);
            }
            scheduleScan();
          };
          if (image.complete) {
            handleDecoded();
          } else {
            image.addEventListener("load", handleDecoded, { once: true });
          }
        }
      } catch {
        if (!disposed) {
          record.state = "pending";
          record.element.setAttribute(LAZY_STATE_ATTRIBUTE, "pending");
        }
      } finally {
        finishLoad(record);
      }
    };

    const pumpQueue = () => {
      while (!disposed && activeLoads < MAX_CONCURRENT_IMAGE_LOADS && loadQueue.length > 0) {
        const record = loadQueue.shift();
        if (!record || record.state !== "queued") {
          continue;
        }
        activeLoads += 1;
        void loadRecord(record);
      }
    };

    const enqueueRecord = (record: ImageRecord, forceLoad = false) => {
      if (disposed || record.state !== "pending") {
        return;
      }

      record.forceLoad ||= forceLoad;
      record.state = "queued";
      record.element.setAttribute(LAZY_STATE_ATTRIBUTE, "queued");
      loadQueue.push(record);
      pumpQueue();
    };

    function getRootRect() {
      const fallbackHeight = Math.max(1, contentWindow?.innerHeight ?? window.innerHeight ?? 1);
      const fallbackWidth = Math.max(1, contentWindow?.innerWidth ?? window.innerWidth ?? 1);
      const rect = scrollContainer?.getBoundingClientRect();
      if (rect && rect.height > 0 && rect.width > 0) {
        return rect;
      }

      return {
        top: 0,
        right: fallbackWidth,
        bottom: fallbackHeight,
        left: 0,
        width: fallbackWidth,
        height: fallbackHeight
      };
    }

    function getAbsoluteBounds(record: ImageRecord) {
      const bounds = record.sizingElement.getBoundingClientRect();
      const frameBounds = frameElement?.getBoundingClientRect();
      const estimatedHeight =
        bounds.height > 1
          ? bounds.height
          : Math.max(420, (contentWindow?.innerWidth ?? 390) * 1.35);
      const estimatedWidth =
        bounds.width > 1
          ? bounds.width
          : Math.max(1, contentWindow?.innerWidth ?? 390);
      const top = (frameBounds?.top ?? 0) + bounds.top;
      const left = (frameBounds?.left ?? 0) + bounds.left;
      return {
        top,
        right: left + estimatedWidth,
        bottom: top + estimatedHeight,
        left
      };
    }

    function scan() {
      animationFrame = null;
      if (disposed) {
        return;
      }

      const rootRect = getRootRect();
      const verticalPreload = Math.max(520, rootRect.height * 1.35);
      const horizontalPreload = Math.max(390, rootRect.width * 1.5);
      const verticalRetain = Math.max(1600, rootRect.height * 4);
      const horizontalRetain = Math.max(1200, rootRect.width * 4);
      const loadMinY = rootRect.top - verticalPreload;
      const loadMaxY = rootRect.bottom + verticalPreload;
      const loadMinX = rootRect.left - horizontalPreload;
      const loadMaxX = rootRect.right + horizontalPreload;
      const retainMinY = rootRect.top - verticalRetain;
      const retainMaxY = rootRect.bottom + verticalRetain;
      const retainMinX = rootRect.left - horizontalRetain;
      const retainMaxX = rootRect.right + horizontalRetain;

      for (const record of records) {
        const bounds = getAbsoluteBounds(record);
        const isNear =
          bounds.bottom >= loadMinY &&
          bounds.top <= loadMaxY &&
          bounds.right >= loadMinX &&
          bounds.left <= loadMaxX;
        const isRetained =
          bounds.bottom >= retainMinY &&
          bounds.top <= retainMaxY &&
          bounds.right >= retainMinX &&
          bounds.left <= retainMaxX;

        if (isNear || record.forceLoad) {
          record.forceLoad = false;
          enqueueRecord(record);
        } else if (!isRetained) {
          unloadRecord(record);
        }
      }
    }

    // One immediate image is enough to make the first page visible. Remaining
    // images are queued by geometry, two at a time, independent of spine size.
    enqueueRecord(records[0], true);
    scheduleScan();
    scrollContainer?.addEventListener("scroll", scheduleScan, { passive: true });
    contentWindow?.addEventListener("scroll", scheduleScan, { passive: true });
    contentWindow?.addEventListener("resize", scheduleScan, { passive: true });
    document.addEventListener("load", scheduleScan, true);

    const cleanup = () => {
      disposed = true;
      if (animationFrame !== null) {
        schedulerWindow.cancelAnimationFrame(animationFrame);
      }
      scrollContainer?.removeEventListener("scroll", scheduleScan);
      contentWindow?.removeEventListener("scroll", scheduleScan);
      contentWindow?.removeEventListener("resize", scheduleScan);
      document.removeEventListener("load", scheduleScan, true);
      loadQueue.splice(0);
      for (const record of records) {
        if (record.objectUrl) {
          setLazyMediaSource(record.element, TRANSPARENT_IMAGE);
          URL.revokeObjectURL(record.objectUrl);
          record.objectUrl = null;
        }
      }
    };
    this.addSectionCleanup(sectionKey, cleanup);
  }

  private addSectionCleanup(sectionKey: string, cleanup: () => void) {
    const cleanups = this.sectionCleanups.get(sectionKey) ?? new Set<() => void>();
    cleanups.add(cleanup);
    this.sectionCleanups.set(sectionKey, cleanups);
  }

  private queueAttributeRewrites(
    document: Document,
    sectionKey: string,
    basePath: string,
    tasks: Promise<void>[]
  ) {
    const attributes: Array<[string, string]> = [
      ["use[href]", "href"],
      ["use[xlink\\:href]", "xlink:href"],
      ["source[src]", "src"],
      ["audio[src]", "src"],
      ["video[src]", "src"],
      ["video[poster]", "poster"],
      ["track[src]", "src"],
      ["object[data]", "data"],
      ["embed[src]", "src"],
      ["input[type='image'][src]", "src"]
    ];

    for (const [selector, attribute] of attributes) {
      document.querySelectorAll<Element>(selector).forEach((element) => {
        tasks.push(
          this.rewriteAttribute(
            element,
            attribute,
            getResourceAttribute(element, attribute),
            basePath,
            sectionKey
          )
        );
      });
    }
  }

  private queueSrcsetRewrites(
    document: Document,
    sectionKey: string,
    basePath: string,
    tasks: Promise<void>[]
  ) {
    document.querySelectorAll<Element>("img[srcset], source[srcset]").forEach((element) => {
      const original = element.getAttribute("srcset");
      if (!original || /data:/i.test(original)) {
        return;
      }

      tasks.push(
        this.rewriteSrcset(original, basePath, sectionKey).then((rewritten) => {
          if (rewritten) {
            element.setAttribute("srcset", rewritten);
          }
        })
      );
    });
  }

  private queueInlineStyleRewrites(
    document: Document,
    sectionKey: string,
    basePath: string,
    tasks: Promise<void>[]
  ) {
    document.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
      const original = element.getAttribute("style");
      if (!original || !/url\s*\(/i.test(original)) {
        return;
      }

      tasks.push(
        this.rewriteCssText(original, basePath, sectionKey, new Set()).then((rewritten) => {
          element.setAttribute("style", rewritten);
        })
      );
    });

    document.querySelectorAll<HTMLStyleElement>("style").forEach((styleElement) => {
      const original = styleElement.textContent;
      if (!original || (!/url\s*\(/i.test(original) && !/@import/i.test(original))) {
        return;
      }

      tasks.push(
        this.rewriteCssText(original, basePath, sectionKey, new Set()).then((rewritten) => {
          styleElement.textContent = rewritten;
        })
      );
    });
  }

  private queueStylesheetRewrites(
    document: Document,
    sectionKey: string,
    basePath: string,
    tasks: Promise<void>[]
  ) {
    document.querySelectorAll<HTMLLinkElement>("link[rel~='stylesheet'][href]").forEach((link) => {
      const resolved = resolveArchiveResource(link.getAttribute("href"), basePath);
      if (!resolved) {
        return;
      }

      tasks.push(
        this.acquireCss(resolved.path, sectionKey, new Set()).then((objectUrl) => {
          if (objectUrl) {
            link.setAttribute("href", `${objectUrl}${resolved.suffix}`);
          }
        })
      );
    });
  }

  private async rewriteAttribute(
    element: Element,
    attribute: string,
    original: string | null,
    basePath: string,
    sectionKey: string
  ): Promise<void> {
    const resolved = resolveArchiveResource(original, basePath);
    if (!resolved) {
      return;
    }

    const objectUrl = await this.acquireAsset(resolved.path, sectionKey);
    if (objectUrl) {
      setResourceAttribute(element, attribute, `${objectUrl}${resolved.suffix}`);
    }
  }

  private async rewriteSrcset(
    srcset: string,
    basePath: string,
    sectionKey: string
  ): Promise<string | null> {
    const candidates = srcset
      .split(",")
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    if (candidates.length === 0) {
      return null;
    }

    const rewritten = await Promise.all(
      candidates.map(async (candidate) => {
        const [rawUrl, ...descriptorParts] = candidate.split(/\s+/);
        const resolved = resolveArchiveResource(rawUrl, basePath);
        if (!resolved) {
          return candidate;
        }

        const objectUrl = await this.acquireAsset(resolved.path, sectionKey);
        if (!objectUrl) {
          return candidate;
        }

        const descriptor = descriptorParts.join(" ");
        return `${objectUrl}${resolved.suffix}${descriptor ? ` ${descriptor}` : ""}`;
      })
    );

    return rewritten.join(", ");
  }

  private acquireAsset(path: string, sectionKey: string): Promise<string | null> {
    return this.acquireResource(`asset:${path}`, sectionKey, async () => {
      const blobPromise = this.getArchive()?.getBlob(path);
      if (!blobPromise) {
        return null;
      }

      return URL.createObjectURL(await blobPromise);
    });
  }

  private acquireCss(
    path: string,
    sectionKey: string,
    parentStack: Set<string>
  ): Promise<string | null> {
    if (parentStack.has(path)) {
      return Promise.resolve(null);
    }

    const stack = new Set(parentStack);
    stack.add(path);
    // The generated stylesheet contains section-owned Blob URLs, so keep the
    // stylesheet section-scoped too instead of sharing it across chapters.
    return this.acquireResource(`css:${sectionKey}:${path}`, sectionKey, async () => {
      const textPromise = this.getArchive()?.getText(path);
      if (!textPromise) {
        return null;
      }

      const rewritten = await this.rewriteCssText(await textPromise, path, sectionKey, stack);
      return URL.createObjectURL(new Blob([rewritten], { type: "text/css" }));
    });
  }

  private async rewriteCssText(
    cssText: string,
    basePath: string,
    sectionKey: string,
    stack: Set<string>
  ): Promise<string> {
    const replacements = new Map<string, string>();
    const requested = new Set<string>();
    const requests: Promise<void>[] = [];

    const requestReplacement = (
      rawValue: string,
      resolver: (resource: ResolvedArchiveResource) => Promise<string | null>
    ) => {
      const normalized = rawValue.trim();
      if (!normalized || requested.has(normalized)) {
        return;
      }
      requested.add(normalized);

      const resolved = resolveArchiveResource(normalized, basePath);
      if (!resolved) {
        return;
      }

      requests.push(
        resolver(resolved).then((objectUrl) => {
          if (objectUrl) {
            replacements.set(normalized, `${objectUrl}${resolved.suffix}`);
          }
        })
      );
    };

    for (const match of cssText.matchAll(CSS_URL_PATTERN)) {
      requestReplacement(match[2] ?? "", (resolved) =>
        this.acquireCssOrAsset(resolved.path, sectionKey, stack)
      );
    }

    for (const match of cssText.matchAll(CSS_IMPORT_PATTERN)) {
      requestReplacement(match[2] ?? "", (resolved) =>
        this.acquireCss(resolved.path, sectionKey, stack)
      );
    }

    await Promise.all(requests);
    if (replacements.size === 0) {
      return cssText;
    }

    const replaceUrl = (match: string, quote: string, rawValue: string) => {
      const replacement = replacements.get(rawValue.trim());
      return replacement ? `url(${quote || '"'}${replacement}${quote || '"'})` : match;
    };
    const replaceImport = (match: string, quote: string, rawValue: string) => {
      const replacement = replacements.get(rawValue.trim());
      return replacement ? `@import ${quote}${replacement}${quote}` : match;
    };

    return cssText.replace(CSS_URL_PATTERN, replaceUrl).replace(CSS_IMPORT_PATTERN, replaceImport);
  }

  private acquireCssOrAsset(
    path: string,
    sectionKey: string,
    stack: Set<string>
  ): Promise<string | null> {
    return isCssPath(path)
      ? this.acquireCss(path, sectionKey, stack)
      : this.acquireAsset(path, sectionKey);
  }

  private async acquireResource(
    cacheKey: string,
    sectionKey: string,
    create: () => Promise<string | null>
  ): Promise<string | null> {
    if (this.destroyed || !this.activeSections.has(sectionKey)) {
      return null;
    }

    const existing = this.cache.get(cacheKey);
    if (existing) {
      this.retainResource(cacheKey, sectionKey, existing);
      return existing.objectUrl;
    }

    let pending = this.pending.get(cacheKey);
    if (!pending) {
      pending = create()
        .catch(() => null)
        .then((objectUrl) => {
          this.pending.delete(cacheKey);
          if (!objectUrl) {
            return null;
          }
          if (this.destroyed) {
            URL.revokeObjectURL(objectUrl);
            return null;
          }

          this.cache.set(cacheKey, { objectUrl, references: 0 });
          return objectUrl;
        });
      this.pending.set(cacheKey, pending);
    }

    const objectUrl = await pending;
    if (!objectUrl || this.destroyed || !this.activeSections.has(sectionKey)) {
      this.releaseUnreferencedResourceSoon(cacheKey);
      return null;
    }

    const cached = this.cache.get(cacheKey);
    if (!cached) {
      return null;
    }

    this.retainResource(cacheKey, sectionKey, cached);
    return cached.objectUrl;
  }

  private retainResource(cacheKey: string, sectionKey: string, cached: CachedResource) {
    if (!this.activeSections.has(sectionKey)) {
      this.releaseUnreferencedResourceSoon(cacheKey);
      return;
    }

    const resources = this.sectionResources.get(sectionKey) ?? new Set<string>();
    if (resources.has(cacheKey)) {
      return;
    }

    resources.add(cacheKey);
    this.sectionResources.set(sectionKey, resources);
    cached.references += 1;
  }

  private releaseUnreferencedResourceSoon(cacheKey: string) {
    queueMicrotask(() => {
      const cached = this.cache.get(cacheKey);
      if (!cached || cached.references > 0) {
        return;
      }

      URL.revokeObjectURL(cached.objectUrl);
      this.cache.delete(cacheKey);
    });
  }

  private releaseSectionByKey(sectionKey: string) {
    if (
      !this.activeSections.has(sectionKey) &&
      !this.sections.has(sectionKey) &&
      !this.sectionResources.has(sectionKey) &&
      !this.sectionCleanups.has(sectionKey)
    ) {
      return;
    }

    this.activeSections.delete(sectionKey);
    const cleanups = this.sectionCleanups.get(sectionKey);
    if (cleanups) {
      for (const cleanup of cleanups) {
        cleanup();
      }
    }
    this.sectionCleanups.delete(sectionKey);

    const resources = this.sectionResources.get(sectionKey);
    if (resources) {
      for (const cacheKey of resources) {
        const cached = this.cache.get(cacheKey);
        if (!cached) {
          continue;
        }

        cached.references -= 1;
        if (cached.references <= 0) {
          URL.revokeObjectURL(cached.objectUrl);
          this.cache.delete(cacheKey);
        }
      }
    }

    this.sectionResources.delete(sectionKey);
    const section = this.sections.get(sectionKey);
    this.sections.delete(sectionKey);
    section?.unload?.();
  }

  private getSectionKey(section: LazySection): string {
    if (section && typeof section === "object") {
      const existing = this.sectionKeys.get(section);
      if (existing) {
        return existing;
      }

      const identity = section.index ?? section.href ?? section.url ?? this.nextSectionKey++;
      const key = `section:${identity}`;
      this.sectionKeys.set(section, key);
      return key;
    }

    return `section:${this.nextSectionKey++}`;
  }

  private findSectionKey(section: LazySection): string | null {
    return section && typeof section === "object" ? this.sectionKeys.get(section) ?? null : null;
  }
}

function getResourceAttribute(element: Element, attribute: string): string | null {
  if (attribute === "xlink:href") {
    return element.getAttributeNS(XLINK_NAMESPACE, "href") ?? element.getAttribute(attribute);
  }

  return element.getAttribute(attribute);
}

function setResourceAttribute(element: Element, attribute: string, value: string) {
  if (attribute === "xlink:href") {
    element.setAttributeNS(XLINK_NAMESPACE, attribute, value);
    return;
  }

  element.setAttribute(attribute, value);
}

function isImageDominantDocument(document: Document): boolean {
  const body = document.body;
  const mediaCount = body?.querySelectorAll("img, svg image").length ?? 0;
  if (!body || mediaCount === 0) {
    return false;
  }

  const probe = body.cloneNode(true) as Element;
  probe
    .querySelectorAll("img, picture, source, svg, style, script, noscript")
    .forEach((element) => element.remove());
  const textLength = (probe.textContent?.replace(/\s+/g, "") ?? "").length;
  return textLength <= Math.max(48, mediaCount * 12);
}

function installLazyImagePlaceholderStyle(document: Document) {
  if (document.getElementById("reader-lazy-image-placeholders")) {
    return;
  }

  const head = document.head ?? document.querySelector("head");
  if (!head) {
    return;
  }

  const style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = "reader-lazy-image-placeholders";
  style.textContent = `
    .reader-lazy-image[${LAZY_STATE_ATTRIBUTE}='pending'],
    .reader-lazy-image[${LAZY_STATE_ATTRIBUTE}='queued'],
    .reader-lazy-image[${LAZY_STATE_ATTRIBUTE}='loading'] {
      background: rgba(127, 127, 127, 0.06) !important;
    }
    img.reader-lazy-image.${LAZY_NEEDS_SIZE_CLASS}[${LAZY_STATE_ATTRIBUTE}='pending'],
    img.reader-lazy-image.${LAZY_NEEDS_SIZE_CLASS}[${LAZY_STATE_ATTRIBUTE}='queued'],
    img.reader-lazy-image.${LAZY_NEEDS_SIZE_CLASS}[${LAZY_STATE_ATTRIBUTE}='loading'] {
      display: block !important;
      min-height: clamp(180px, 72vw, 720px) !important;
    }
    html.reader-lazy-image-document .reader-lazy-page-image {
      display: block !important;
      width: 100% !important;
      max-width: none !important;
      height: auto !important;
      object-fit: contain !important;
      margin: 0 !important;
    }
    html.reader-lazy-image-document .reader-lazy-page-image.${LAZY_NEEDS_SIZE_CLASS}[${LAZY_STATE_ATTRIBUTE}='pending'],
    html.reader-lazy-image-document .reader-lazy-page-image.${LAZY_NEEDS_SIZE_CLASS}[${LAZY_STATE_ATTRIBUTE}='queued'],
    html.reader-lazy-image-document .reader-lazy-page-image.${LAZY_NEEDS_SIZE_CLASS}[${LAZY_STATE_ATTRIBUTE}='loading'] {
      min-height: clamp(420px, 135vw, 1200px) !important;
    }
  `;
  head.appendChild(style);
}

function getLazyMediaSource(element: Element): string | null {
  if (element.localName.toLowerCase() === "image") {
    return (
      element.getAttribute("href") ??
      element.getAttributeNS(XLINK_NAMESPACE, "href") ??
      element.getAttribute("xlink:href")
    );
  }

  return element.getAttribute("src");
}

function setLazyMediaSource(element: Element, value: string) {
  if (element.localName.toLowerCase() === "image") {
    element.setAttribute("href", value);
    element.setAttributeNS(XLINK_NAMESPACE, "xlink:href", value);
    return;
  }

  element.setAttribute("src", value);
}

function getBestSrcsetCandidate(srcset: string | null): string | null {
  if (!srcset) {
    return null;
  }

  const candidates = srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
  return candidates.at(-1) ?? null;
}

function getLazyMediaSizingElement(element: Element): Element {
  if (element.localName.toLowerCase() === "image") {
    return element.closest("svg") ?? element;
  }
  return element;
}

function hasImageSizeHint(image: HTMLImageElement): boolean {
  const width = Number(image.getAttribute("width"));
  const height = Number(image.getAttribute("height"));
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return true;
  }

  const style = image.getAttribute("style") ?? "";
  return /aspect-ratio\s*:|(?:^|;)\s*height\s*:/i.test(style);
}

function preserveImageAspectRatio(image: HTMLImageElement) {
  const width = Number(image.getAttribute("width"));
  const height = Number(image.getAttribute("height"));
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    image.style.setProperty("aspect-ratio", `${width} / ${height}`);
  }
}

function findReaderScrollContainer(frameElement: HTMLElement | null): HTMLElement | null {
  if (!frameElement) {
    return null;
  }

  return (
    (frameElement.closest(".epub-container") as HTMLElement | null) ??
    (frameElement.closest(".epub-view")?.parentElement as HTMLElement | null)
  );
}

function normalizeArchiveBasePath(basePath: string | null | undefined): string {
  if (!basePath) {
    return "/";
  }

  try {
    const parsed = new URL(basePath, EPUB_RESOURCE_ORIGIN);
    return parsed.pathname.startsWith("/") ? parsed.pathname : `/${parsed.pathname}`;
  } catch {
    return basePath.startsWith("/") ? basePath : `/${basePath}`;
  }
}

function isCssPath(path: string): boolean {
  return /\.css$/i.test(path);
}
