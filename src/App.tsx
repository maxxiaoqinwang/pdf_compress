import { useState } from "react";
import { FilePicker } from "./components/FilePicker";
import { Reader } from "./components/Reader";

export default function App() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <main className="app-shell">
      {file ? <Reader file={file} onClose={() => setFile(null)} /> : <FilePicker onFileSelected={setFile} />}
    </main>
  );
}
