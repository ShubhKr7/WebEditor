import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import path from "path-browserify";
import process from "process";
window.process = process;

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
        `http://localhost:3001/api/open-file?path=${encodeURIComponent(
          fullPath
        )}`
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
      const res = await fetch("http://localhost:3001/api/save-file", {
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
    const ws = new WebSocket(`ws://localhost:3001/?id=${id}`);

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
    <div className="h-screen w-screen flex flex-col bg-gray-900">
      {/* File Controls */}
      <div className="flex p-2 border-b border-gray-700 items-center space-x-2">
        <p
          className="flex-1 p-1 rounded text-white"
          type="text"
          value={currentFile}
          onChange={(e) => setCurrentFile(e.target.value)}
        />
        <button
          className="px-2 py-1 bg-blue-600 rounded text-white"
          onClick={() => {
            saveFile();
          }}
        >
          Save
        </button>
      </div>
      {/* Monaco Editor */}
      <div ref={editorRef} className="flex-1" />

      {/* Terminal Controls */}
      <div className="flex items-center bg-gray-800 px-2 border-b border-gray-700">
        {terminals.map((t, i) => (
          <button
            key={t.id}
            onClick={() => setActiveTerm(i)}
            className={`px-3 py-1 rounded-t-md text-sm font-medium ${
              activeTerm === i
                ? "bg-gray-900 text-blue-400 border-b-2 border-blue-400"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Term {i + 1}
          </button>
        ))}
        <button
          onClick={createTerminal}
          className="ml-2 px-2 py-1 text-green-400 hover:text-green-300"
        >
          ➕
        </button>
      </div>

      {/* Active Terminal */}
      <div className="h-60 bg-black rounded-b-md overflow-hidden relative">
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
