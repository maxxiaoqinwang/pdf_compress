import { useEffect, useMemo, useRef, useState } from "react";
import ePub from "epubjs";
import type { Book, Location, NavItem, Rendition } from "epubjs";
import { loadReaderState, saveReaderState, type ReaderTheme } from "../lib/storage";

type ReaderProps = {
  file: File;
  onClose: () => void;
};

type LoadStatus = "loading" | "ready" | "error";

export function Reader({ file, onClose }: ReaderProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const savedState = useMemo(() => loadReaderState(), []);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState("Opening book...");
  const [title, setTitle] = useState(file.name);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentCfi, setCurrentCfi] = useState<string | null>(savedState.cfi);
  const [fontScale, setFontScale] = useState(savedState.fontScale);
  const [theme, setTheme] = useState<ReaderTheme>(savedState.theme);

  useEffect(() => {
    let cancelled = false;
    const host = mountRef.current;
    if (!host) {
      return undefined;
    }

    async function openBook(hostElement: HTMLDivElement) {
      setStatus("loading");
      setMessage("Reading EPUB package...");

      try {
        const buffer = await file.arrayBuffer();
        if (cancelled) {
          return;
        }

        const book = ePub(buffer, { replacements: "blobUrl" });
        const rendition = book.renderTo(hostElement, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "none"
        });

        bookRef.current = book;
        renditionRef.current = rendition;
        registerThemes(rendition);
        applyReaderStyle(rendition, theme, fontScale);

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
          setCurrentCfi(cfi);
          saveReaderState({ cfi, fontScale, theme });
        });

        try {
          await rendition.display(savedState.cfi ?? undefined);
        } catch {
          await rendition.display();
        }

        if (!cancelled) {
          setStatus("ready");
          setMessage("");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("This EPUB could not be opened. Try another reflowable EPUB file.");
        }
      }
    }

    void openBook(host);

    return () => {
      cancelled = true;
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
  }, [file, savedState.cfi]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }

    applyReaderStyle(rendition, theme, fontScale);
    saveReaderState({ cfi: currentCfi, fontScale, theme });
  }, [currentCfi, fontScale, theme]);

  async function goToChapter(href: string) {
    await renditionRef.current?.display(href);
  }

  return (
    <section className={`reader-shell ${theme}`} aria-label="EPUB reader">
      <header className="reader-toolbar">
        <button className="ghost-button" type="button" onClick={onClose}>
          Library
        </button>
        <div className="book-title">
          <span>Now reading</span>
          <strong>{title}</strong>
        </div>
        <div className="reader-controls" aria-label="Reader controls">
          <button type="button" onClick={() => void renditionRef.current?.prev()}>
            Prev
          </button>
          <button type="button" onClick={() => void renditionRef.current?.next()}>
            Next
          </button>
          <button
            type="button"
            onClick={() => setFontScale((value) => Math.max(80, value - 10))}
          >
            A-
          </button>
          <button
            type="button"
            onClick={() => setFontScale((value) => Math.min(160, value + 10))}
          >
            A+
          </button>
          <button
            type="button"
            onClick={() => setTheme((value) => (value === "paper" ? "night" : "paper"))}
          >
            {theme === "paper" ? "Night" : "Paper"}
          </button>
        </div>
      </header>

      <div className="reader-layout">
        <nav className="toc-panel" aria-label="Table of contents">
          <h2>Contents</h2>
          {toc.length > 0 ? (
            <ol>
              {toc.map((item) => (
                <li key={`${item.id}-${item.href}`}>
                  <button type="button" onClick={() => void goToChapter(item.href)}>
                    {item.label}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p>No table of contents found.</p>
          )}
        </nav>

        <div className="reader-stage">
          {status !== "ready" ? <div className={`reader-message ${status}`}>{message}</div> : null}
          <div ref={mountRef} className="rendition-root" />
        </div>
      </div>
    </section>
  );
}

function registerThemes(rendition: Rendition) {
  rendition.themes.register("paper", {
    body: {
      color: "#26231f",
      background: "#fbf7ef",
      "font-family": "Georgia, 'Times New Roman', serif",
      "line-height": "1.75"
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
      "line-height": "1.75"
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

function applyReaderStyle(rendition: Rendition, theme: ReaderTheme, fontScale: number) {
  rendition.themes.select(theme);
  rendition.themes.fontSize(`${fontScale}%`);
}
