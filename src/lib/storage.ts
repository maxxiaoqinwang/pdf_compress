export type ReaderTheme = "paper" | "night";
export type ReadingMode = "scroll" | "page";
export type GripMode = "right" | "left" | "both";

export type ReaderState = {
  cfi: string | null;
  fontScale: number;
  gripMode: GripMode;
  imageScale: number;
  lineHeight: number;
  readingMode: ReadingMode;
  theme: ReaderTheme;
};

const STORAGE_KEY = "epub-reader-state";

export const DEFAULT_READER_STATE: ReaderState = {
  cfi: null,
  fontScale: 100,
  gripMode: "right",
  imageScale: 100,
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
      gripMode: normalizeGripMode(parsed.gripMode),
      imageScale: normalizeImageScale(parsed.imageScale),
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
      gripMode: normalizeGripMode(state.gripMode),
      imageScale: normalizeImageScale(state.imageScale),
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

function normalizeImageScale(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_READER_STATE.imageScale;
  }

  return Math.min(250, Math.max(100, Math.round(value)));
}

function normalizeGripMode(value: unknown): GripMode {
  return value === "left" || value === "both" ? value : DEFAULT_READER_STATE.gripMode;
}
