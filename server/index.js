// index.js
import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import { createServer } from "http";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

let shellCwd = "D:/WebProjects/WebEditor/server"; // initial cwd for shells
const terminals = {}; // id -> shell process

const app = express();

// Enable CORS for all origins (or specify your frontend origin)
app.use(
  cors({
    origin: "http://localhost:5173", // your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

app.use(express.json()); // for parsing JSON in POST requests
const server = createServer(app);

// Start HTTP + WS server
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});

// ----------------------
// File API for Monaco
// ----------------------

app.get("/api/open-file", (req, res) => {
  const fileName = req.query.path;
  if (!fileName) return res.status(400).send({ error: "Path required" });

  const absPath = path.join(shellCwd, fileName);
  console.log("Opening file:", absPath);

  fs.readFile(absPath, "utf8", (err, data) => {
    if (err) return res.status(500).send({ error: err.message });
    res.send({ content: data });
  });
});

app.post("/api/save-file", (req, res) => {
  const { fileName, content } = req.body;
  if (!fileName || content === undefined)
    return res.status(400).send({ error: "Path and content required" });

  const absPath = path.join(shellCwd, fileName);
  console.log("Saving file:", absPath);

  fs.writeFile(absPath, content, "utf8", (err) => {
    if (err) return res.status(500).send({ error: err.message });
    res.send({ ok: true });
  });
});

// ----------------------
// WebSocket Terminal (Persistent bash -i)
// ----------------------
const wss = new WebSocketServer({ server });

// wss.on("connection", (ws) => {
//   console.log("✅ Client connected to terminal");

//   // Persistent bash process
//   const shell = spawn("bash", ["-i"], {
//     cwd: process.cwd(),
//     env: process.env,
//     stdio: "pipe",
//   });

//   // Pipe stdout/stderr to frontend
//   // shell.stdout.on("data", (data) => ws.send(data.toString()));
//   // Whenever you want to know the current directory of the bash shell
//   shell.stdin.write("pwd\n");

//   shell.stdout.on("data", (data) => {
//     const output = data.toString();
//     console.log("Shell output:", output);
//   });

//   shell.stderr.on("data", (data) => ws.send(data.toString()));

//   // Pipe frontend input to shell stdin
//   ws.on("message", (msg) => {
//     shell.stdin.write(msg.toString().trim() + "\n");
//   });

//   ws.on("close", () => {
//     console.log("❌ Client disconnected");
//     shell.kill();
//   });

//   ws.send("Welcome to persistent bash terminal\r\n$ ");
// });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const termId = url.searchParams.get("id") || `term-${Date.now()}`;
  
  console.log(`✅ Client connected to terminal: ${termId}`);

  const shell = spawn("bash", ["-i"], {
    cwd: shellCwd,
    env: process.env,
    stdio: "pipe",
    detached: true, // 👈 makes the shell its own process group
  });
  terminals[termId] = shell;

  // Pipe shell output
  shell.stdout.on("data", (data) => {
    const output = data.toString();
    ws.send(output);

    // If output looks like a pwd, update clientCwd
    if (output.trim().startsWith("/")) {
      let newCwd = output.trim();
      if (process.platform === "win32") {
        newCwd = newCwd
          .replace(/^\/([a-zA-Z])\//, (_, drive) => drive.toUpperCase() + ":\\")
          .replace(/\//g, "\\");
      }
      shellCwd = newCwd;
      console.log("Updated shellCwd:", shellCwd);
    }
  });

  shell.stderr.on("data", (data) => ws.send(data.toString()));

  ws.on("message", (msg) => {
    const command = msg.toString().trim();

    // ---- Handle directory changes ----
    if (command.startsWith("cd ")) {
      shell.stdin.write(command + "\n");
      shell.stdin.write("pwd\n"); // refresh cwd after cd
    } else {
      // ---- Forward normal commands to interactive shell ----
      shell.stdin.write(command + "\n");
    }
  });

  ws.on("close", () => shell.kill());

   ws.send(`Welcome to terminal "${termId}"\r\n$ `);
});
