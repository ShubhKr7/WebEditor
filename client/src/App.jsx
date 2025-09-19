import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import path from "path-browserify";
import process from "process";
window.process = process;
const backendUrl = import.meta.env.VITE_BACKEND_URL;
const socketUrl = import.meta.env.VITE_SOCKET_URL;

export default function App() {
  const editorRef = useRef(null);
  const monacoInstance = useRef(null);

  const [currentFile, setCurrentFile] = useState("/d/WebProjects/WebEditor/"); // default file path
  const [currentDir, setCurrentDir] = useState("");
  const [terminals, setTerminals] = useState([]);
  const [activeTerm, setActiveTerm] = useState(0);

  // --------------------------
  // Setup Monaco Editor
  // --------------------------
  useEffect(() => {
    if (editorRef.current && !monacoInstance.current) {
      monacoInstance.current = monaco.editor.create(editorRef.current, {
        value: "",
        language: "javascript",
        theme: "vs-dark",
        automaticLayout: true,
      });
    }
  }, [currentFile]);

  // --------------------------
  // Fetch file content
  // --------------------------
  async function fetchFile(fileName) {
    if (!fileName) return;
    try {
      const fullPath = fileName;
      const res = await fetch(
        `${backendUrl}/api/open-file?path=${encodeURIComponent(fullPath)}`
      );
      const data = await res.json();
      if (data.content !== undefined) {
        monacoInstance.current.setValue(data.content);
        setCurrentFile(fileName); // update current file name
      }
    } catch (err) {
      console.error("Failed to load file:", err);
    }
  }

  //Create a terminal on mount
  useEffect(() => {
    if (terminals.length === 0) {
      createTerminal(); // make the first terminal on mount
    }
  }, []);

  // --------------------------
  // Setup Xterm.js Terminal
  // --------------------------
  useEffect(() => {
    // --- Attach input handling to all terminals in `terminals` ---
    terminals.forEach((t) => {
      if (!t.inputAttached) {
        let inputBuffer = "";

        t.term.onData((data) => {
          const code = data.charCodeAt(0);
          console.log("Key code:", code, "Data:", data);

          if (code === 13) {
            t.term.write("\r\n");
            const trimmed = inputBuffer.trim();

            console.log("User input:", trimmed);

            if (trimmed.startsWith("cd ")) {
              const targetDir = trimmed.slice(3).trim();
              const newDir = path.resolve(currentDir, targetDir);
              setCurrentDir(newDir);
              if (t.ws && t.ws.readyState === WebSocket.OPEN) {
                t.ws.send(`cd ${targetDir}`);
              }
              t.term.writeln(`Changed directory to: ${newDir}\r\n$ `);
            } else if (trimmed.startsWith("open ")) {
              const fileName = trimmed.slice(5).trim();
              fetchFile(fileName);
              t.term.writeln(`Opening file: ${fileName}\r\n$ `);
            } else {
              if (t.ws && t.ws.readyState === WebSocket.OPEN) {
                t.ws.send(inputBuffer);
              }
            }

            inputBuffer = "";
          } else if (code === 127) {
            if (inputBuffer.length > 0) {
              inputBuffer = inputBuffer.slice(0, -1);
              t.term.write("\b \b");
            }
          } else {
            inputBuffer += data;
            t.term.write(data);
          }
        });

        t.inputAttached = true;
      }
    });
  }, [terminals, currentDir]);
  // re-run if currentDir changes (optional)

  // --------------------------
  // Save file from Monaco
  // --------------------------
  async function saveFile() {
    if (!currentFile) return;
    try {
      const res = await fetch(`${backendUrl}/api/save-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: currentFile,
          content: monacoInstance.current.getValue(),
        }),
      });
      if (!res.ok) alert("Failed to save file");
      else alert("File saved!");
    } catch (err) {
      console.error("Failed to save file:", err);
    }
  }

  function createTerminal() {
    const id = `term-${Date.now()}`;
    const ws = new WebSocket(`${socketUrl}/?id=${id}`);

    const term = new Terminal({
      rows: 15,
      cursorBlink: true,
      theme: { background: "#1e1e1e" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    ws.onopen = () => term.writeln(`✅ Connected to terminal ${id}\r\n$ `);
    ws.onmessage = (e) => term.write(e.data);
    ws.onclose = () => term.writeln("\r\n❌ Disconnected");

    // Only add to terminals list; input handling will be done in shared effect
    setTerminals((prev) => [...prev, { id, ws, term, fitAddon }]);
    setActiveTerm(terminals.length); // activate new terminal
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#ece9d8] text-black font-sans">
      {/* File Controls */}
      <div className="flex p-2 border-b border-gray-400 items-center space-x-2 bg-[#245edc] shadow-md">
        <input
          className="flex-1 px-2 py-1 rounded-sm border border-gray-400 text-sm bg-white text-black focus:outline-none focus:ring-1 focus:ring-[#316ac5]"
          type="text"
          value={currentFile}
          onChange={(e) => setCurrentFile(e.target.value)}
          readOnly
        />
        <button
          className="px-3 py-1 bg-[#245edc] text-white font-semibold border border-[#123c8b] rounded-sm shadow hover:bg-[#316ac5] active:translate-y-[1px]"
          onClick={() => {
            saveFile();
          }}
        >
          💾 Save
        </button>
      </div>

      {/* Monaco Editor */}
      <div
        ref={editorRef}
        className="flex-1 border-b border-gray-400 bg-white"
      />

      {/* Terminal Controls */}
      <div className="flex items-center bg-[#ece9d8] px-2 border-b border-gray-400">
        {terminals.map((t, i) => (
          <button
            key={t.id}
            onClick={() => setActiveTerm(i)}
            className={`px-3 py-1 text-xs font-medium border border-gray-400 rounded-t-sm ${
              activeTerm === i
                ? "bg-white text-black border-b-0"
                : "bg-[#d4d0c8] text-gray-700 hover:bg-[#e5e1da]"
            }`}
          >
            🖥 Term {i + 1}
          </button>
        ))}
        <button
          onClick={createTerminal}
          className="ml-2 px-2 py-1 text-green-700 font-bold hover:text-green-900"
        >
          ➕
        </button>
      </div>

      {/* Active Terminal */}
      <div className="h-60 bg-black text-green-400 font-mono rounded-b-sm overflow-hidden relative border-t border-gray-400">
        {terminals.map((t, i) => (
          <div
            key={t.id}
            ref={(ref) => {
              if (ref && !t.term._initialized && ref) {
                t.term.open(ref);
                t.fitAddon.fit();
                t.term._initialized = true; // prevent reopening
              }
            }}
            className={`absolute inset-0 ${
              activeTerm === i ? "block" : "hidden"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
