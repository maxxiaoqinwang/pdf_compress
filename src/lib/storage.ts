export type ReaderTheme = "paper" | "night";
export type ReadingMode = "scroll" | "page";
export type GripMode = "right" | "left" | "both";

export type ReaderPreferences = {
  fontScale: number;
  gripMode: GripMode;
  imageScale: number;
  lineHeight: number;
  theme: ReaderTheme;
};

export type BookProgress = {
  cfi: string | null;
  percentage: number | null;
  readingMode: ReadingMode;
  updatedAt: number;
};

type LegacyReaderState = ReaderPreferences & {
  cfi?: unknown;
  readingMode?: unknown;
};

const PREFERENCES_KEY = "epub-reader-preferences-v2";
const PROGRESS_KEY_PREFIX = "epub-reader-progress-v2:";
const LEGACY_STATE_KEY = "epub-reader-state";

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontScale: 100,
  gripMode: "right",
  imageScale: 100,
  lineHeight: 175,
  theme: "paper"
};

export const DEFAULT_BOOK_PROGRESS: BookProgress = {
  cfi: null,
  percentage: null,
  readingMode: "page",
  updatedAt: 0
};

export function createBookKey(
  file: Pick<File, "name" | "size" | "lastModified">
): string {
  const baseName = file.name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "book";
  const fingerprint = `${file.name.toLowerCase()}|${file.size}|${file.lastModified}`;

  return `${baseName}-${fnv1a(fingerprint)}`;
}

export const createBookStorageId = createBookKey;

export function loadReaderPreferences(): ReaderPreferences {
  const parsed = readJson<Partial<ReaderPreferences>>(PREFERENCES_KEY);
  if (parsed) {
    return normalizePreferences(parsed);
  }

  const legacy = readJson<Partial<LegacyReaderState>>(LEGACY_STATE_KEY);
  return legacy ? normalizePreferences(legacy) : { ...DEFAULT_READER_PREFERENCES };
}

export function saveReaderPreferences(preferences: ReaderPreferences): void {
  writeJson(PREFERENCES_KEY, normalizePreferences(preferences));
}

export function loadBookProgress(bookId: string): BookProgress {
  const parsed = readJson<Partial<BookProgress>>(`${PROGRESS_KEY_PREFIX}${bookId}`);
  if (!parsed) {
    return { ...DEFAULT_BOOK_PROGRESS };
  }

  return normalizeBookProgress(parsed);
}

export function saveBookProgress(bookId: string, progress: BookProgress): void {
  writeJson(`${PROGRESS_KEY_PREFIX}${bookId}`, normalizeBookProgress(progress));
}

function normalizePreferences(value: Partial<ReaderPreferences>): ReaderPreferences {
  return {
    fontScale: normalizeFontScale(value.fontScale),
    gripMode: normalizeGripMode(value.gripMode),
    imageScale: normalizeImageScale(value.imageScale),
    lineHeight: normalizeLineHeight(value.lineHeight),
    theme: value.theme === "night" ? "night" : "paper"
  };
}

function normalizeBookProgress(value: Partial<BookProgress>): BookProgress {
  return {
    cfi: typeof value.cfi === "string" && value.cfi.length > 0 ? value.cfi : null,
    percentage: normalizePercentage(value.percentage),
    readingMode:
      value.readingMode === "page" || value.readingMode === "scroll"
        ? value.readingMode
        : DEFAULT_BOOK_PROGRESS.readingMode,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) && value.updatedAt > 0
        ? Math.round(value.updatedAt)
        : 0
  };
}

function normalizeFontScale(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_READER_PREFERENCES.fontScale;
  }

  return Math.min(160, Math.max(80, Math.round(value)));
}

function normalizeLineHeight(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_READER_PREFERENCES.lineHeight;
  }

  return Math.min(220, Math.max(140, Math.round(value)));
}

function normalizeImageScale(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_READER_PREFERENCES.imageScale;
  }

  return Math.min(400, Math.max(100, Math.round(value)));
}

function normalizeGripMode(value: unknown): GripMode {
  return value === "left" || value === "both" ? value : DEFAULT_READER_PREFERENCES.gripMode;
}

function normalizePercentage(value: unknown): number | null {
  if (value === null || value === undefined) {
    return DEFAULT_BOOK_PROGRESS.percentage;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BOOK_PROGRESS.percentage;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function readJson<T>(key: string): T | null {
  try {
    const raw = getStorage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    getStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Reading must keep working even when private mode or an embedded browser blocks storage.
  }
}

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}
