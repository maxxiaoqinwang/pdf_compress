import { useState } from "react";
import { FilePicker } from "./components/FilePicker";
import { Reader } from "./components/Reader";
import { WechatNotice } from "./components/WechatNotice";

export default function App() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <main className="app-shell">
      <WechatNotice />
      {file ? <Reader file={file} onClose={() => setFile(null)} /> : <FilePicker onFileSelected={setFile} />}
    </main>
  );
}
