import { lazy, Suspense, useState } from "react";
import { FilePicker } from "./components/FilePicker";

const LazyReader = lazy(() =>
  import("./components/Reader").then((module) => ({ default: module.Reader }))
);

export default function App() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <main className={`app-shell ${file ? "reading" : ""}`}>
      {file ? (
        <Suspense fallback={<div className="app-loading">正在打开文件…</div>}>
          <LazyReader
            key={`${file.name}-${file.size}-${file.lastModified}`}
            file={file}
            onClose={() => setFile(null)}
          />
        </Suspense>
      ) : (
        <FilePicker onFileSelected={setFile} />
      )}
    </main>
  );
}
