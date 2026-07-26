export type ReaderTheme = "paper" | "night";

export type ReaderState = {
  cfi: string | null;
  fontScale: number;
  theme: ReaderTheme;
};

const STORAGE_KEY = "epub-reader-state";

export const DEFAULT_READER_STATE: ReaderState = {
  cfi: null,
  fontScale: 100,
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
