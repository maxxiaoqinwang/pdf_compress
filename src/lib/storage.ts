export type ReaderTheme = "paper" | "night";
export type ReadingMode = "scroll" | "page";

export type ReaderState = {
  cfi: string | null;
  fontScale: number;
  lineHeight: number;
  readingMode: ReadingMode;
  theme: ReaderTheme;
};

const STORAGE_KEY = "epub-reader-state";

export const DEFAULT_READER_STATE: ReaderState = {
  cfi: null,
  fontScale: 100,
  lineHeight: 175,
  readingMode: "scroll",
  theme: "paper"
};

export function loadReaderState(): ReaderState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_READER_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReaderState>;
    return {
      cfi: typeof parsed.cfi === "string" ? parsed.cfi : null,
      fontScale: normalizeFontScale(parsed.fontScale),
      lineHeight: normalizeLineHeight(parsed.lineHeight),
      readingMode: parsed.readingMode === "page" ? "page" : "scroll",
      theme: parsed.theme === "night" ? "night" : "paper"
    };
  } catch {
    return DEFAULT_READER_STATE;
  }
}

export function saveReaderState(state: ReaderState): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      cfi: state.cfi,
      fontScale: normalizeFontScale(state.fontScale),
      lineHeight: normalizeLineHeight(state.lineHeight),
      readingMode: state.readingMode === "page" ? "page" : "scroll",
      theme: state.theme
    })
  );
}

function normalizeFontScale(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_READER_STATE.fontScale;
  }

  return Math.min(160, Math.max(80, Math.round(value)));
}

function normalizeLineHeight(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_READER_STATE.lineHeight;
  }

  return Math.min(220, Math.max(140, Math.round(value)));
}
