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

let shellCwd = "D:/WebProjects/WebEditor/server"; // initial cwd for shells
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
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});

//----------------------
//Test GET API
//----------------------
app.get('/' , (req,res) => {
  res.status(200).send({msg: 'Backend server up'});
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

wss.on("connection", (ws, req) => {
    const origin = req.headers.origin;
    if (origin !== process.env.FRONTEND_URL) {
      console.log("❌ Blocked:", origin);
    ws.close();
    return;
  }

  console.log("✅ Allowed:", origin);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const termId = url.searchParams.get("id") || `term-${Date.now()}`;
  
  console.log(`✅ Client connected to terminal: ${termId}`);

  // const shell = spawn("sh", ["-i"], {
  //   cwd: shellCwd,
  //   env: process.env,
  //   stdio: "pipe",
  //   detached: true, // 👈 makes the shell its own process group
  // });

  const shell = spawn("node", ["-e", command], { shell: true });

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
