import { useRef, useState } from "react";
import { getSelectedFileAction } from "../lib/fileValidation";

type FilePickerProps = {
  onFileSelected: (file: File) => void;
  onPdfSelected?: (file: File) => void;
};

export function FilePicker({ onFileSelected, onPdfSelected = downloadOriginalPdf }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    const result = getSelectedFileAction(file);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    if (!file) {
      setError("Select a file first.");
      return;
    }

    setError(null);
    if (result.action === "download") {
      onPdfSelected(file);
      event.target.value = "";
      return;
    }

    onFileSelected(file);
  }

  return (
    <section className="file-picker" aria-labelledby="reader-start-title">
      <p className="eyebrow">Private local tool</p>
      <h1 id="reader-start-title">PDF Compress</h1>
      <p className="intro-copy">
        Select a file from this device and process it locally in the browser. Nothing is uploaded
        to a server.
      </p>

      <div className="picker-actions">
        <button className="primary-action" type="button" onClick={() => inputRef.current?.click()}>
          Select file
        </button>
        <input
          ref={inputRef}
          className="hidden-input"
          type="file"
          onChange={handleFileChange}
        />
      </div>

      {error ? <p className="error-message">{error}</p> : null}
    </section>
  );
}

function downloadOriginalPdf(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
