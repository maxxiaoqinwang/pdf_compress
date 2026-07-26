import { useRef, useState } from "react";
import { validateEpubFile } from "../lib/fileValidation";

type FilePickerProps = {
  onFileSelected: (file: File) => void;
};

export function FilePicker({ onFileSelected }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    const result = validateEpubFile(file);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    if (!file) {
      setError("Choose an EPUB file first.");
      return;
    }

    setError(null);
    onFileSelected(file);
  }

  return (
    <section className="file-picker" aria-labelledby="reader-start-title">
      <p className="eyebrow">Private browser reader</p>
      <h1 id="reader-start-title">Choose a book. Keep it local.</h1>
      <p className="intro-copy">
        Open an EPUB from this device and read it in the browser. The book is not uploaded or
        stored in a server library.
      </p>

      <div className="picker-actions">
        <button className="primary-action" type="button" onClick={() => inputRef.current?.click()}>
          Select EPUB
        </button>
        <input
          ref={inputRef}
          className="hidden-input"
          type="file"
          accept=".epub,.tks,application/epub+zip,application/zip"
          onChange={handleFileChange}
        />
      </div>

      {error ? <p className="error-message">{error}</p> : null}
    </section>
  );
}
