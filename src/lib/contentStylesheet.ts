import type { Contents } from "epubjs";

/**
 * Apply CSS to an epub.js content document without assuming whether the API is
 * synchronous or asynchronous.
 *
 * epub.js 0.3.93 declares addStylesheetCss() as Promise<boolean>, but its
 * browser implementation returns a boolean. Calling `.catch()` directly on
 * that value aborts the content hook and prevents gesture listeners from being
 * installed.
 */
export function applyContentStylesheet(contents: Contents, cssText: string, key: string): void {
  try {
    const result = contents.addStylesheetCss(cssText, key) as unknown;
    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(() => {
        // A rendition can be destroyed while an async implementation is pending.
      });
    }
  } catch {
    // The iframe may disappear while React applies a setting. Keep the reader
    // mounted and let the next rendered content receive the current style.
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
