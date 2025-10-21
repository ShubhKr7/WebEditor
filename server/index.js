// index.js
import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import { createServer } from "http";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

let shellCwd = process.env.SHELL_CWD || process.cwd();
// ensure folder exists on the host
if (!fs.existsSync(shellCwd)) {
  console.warn("shellCwd missing, falling back to process.cwd()");
  shellCwd = process.cwd();
}

const terminals = {}; // id -> shell process

const app = express();

// Enable CORS for all origins (or specify your frontend origin)
app.use(
  cors({
    origin: process.env.FRONTEND_URL, // your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

app.use(express.json()); // for parsing JSON in POST requests
const server = createServer(app);

// Start HTTP + WS server
const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running at http://0.0.0.0:${PORT}`);
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

  // === replace previous shell selection + spawn with this ===
  let shellCommand = null;
  let shellArgs = ["-i"];

  // pick OS-appropriate shell & args
  if (process.platform === "win32") {
    // prefer PowerShell, fallback to cmd
    if (
      fs.existsSync(
        process.env.COMSPEC ||
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
      )
    ) {
      shellCommand = process.env.COMSPEC || "powershell.exe";
      // if using cmd.exe, /K keeps it interactive; for powershell use -NoExit -Command -
      if (shellCommand.toLowerCase().includes("cmd.exe")) shellArgs = ["/K"];
      else shellArgs = ["-NoExit", "-Command", "-"];
    } else {
      shellCommand = "cmd.exe";
      shellArgs = ["/K"];
    }
  } else {
    // unix-like
    if (fs.existsSync("/bin/bash")) shellCommand = "/bin/bash";
    else if (fs.existsSync("/usr/bin/bash")) shellCommand = "/usr/bin/bash";
    else if (fs.existsSync("/bin/sh")) shellCommand = "/bin/sh";
    else if (process.env.SHELL) shellCommand = process.env.SHELL;
  }

  if (!shellCommand) {
    console.error("No shell found on the host. Closing ws.");
    try {
      ws.send("Server error: no shell available");
    } catch {}
    ws.close();
    return;
  }

  let shell;
  try {
    shell = spawn(shellCommand, shellArgs, {
      cwd: shellCwd,
      env: process.env,
      stdio: "pipe",
      // do not use detached on Windows; keep default
      detached: process.platform === "win32" ? false : true,
    });
  } catch (err) {
    console.error("spawn failed:", err);
    try {
      ws.send("Server error: unable to start shell\r\n");
    } catch {}
    ws.close();
    return;
  }

  // prevent uncaught spawn errors from crashing the process
  shell.on("error", (err) => {
    console.error("Shell process error:", err);
    try {
      ws.send("Server error: shell failed to start\r\n");
    } catch {}
    try {
      ws.close();
    } catch {}
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
