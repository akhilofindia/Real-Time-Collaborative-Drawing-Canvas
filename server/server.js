// server/server.js
const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "..", "client")));

let users = {};
let drawHistory = []; // entries: { type: 'stroke' | 'clear', data or prevState }
let undoneHistory = [];

// --- Helper functions ---
function broadcastAll(obj) {
  const str = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(str);
  }
}

function broadcastExcept(sender, obj) {
  const str = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c !== sender && c.readyState === WebSocket.OPEN) c.send(str);
  }
}

function sendQueueStatus() {
  broadcastAll({ type: "queue-status", undo: drawHistory.length, redo: undoneHistory.length });
}

function broadcastUsers() {
  const online = Object.entries(users).map(([id, u]) => ({
    userId: id,
    color: u.color,
    name: u.name,
  }));
  broadcastAll({ type: "online-users", users: online });
}

function buildCurrentStrokes() {
  const strokes = [];
  for (const op of drawHistory) {
    if (op.type === "stroke") strokes.push(op.data);
    else if (op.type === "clear") strokes.length = 0;
  }
  return strokes;
}

// --- WebSocket connection handling ---
wss.on("connection", (ws) => {
  console.log("🟢 Client connected");

  // Send current canvas state
  ws.send(JSON.stringify({ type: "init", history: buildCurrentStrokes() }));
  sendQueueStatus();
  broadcastUsers();

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      console.error("❌ Invalid JSON message");
      return;
    }

    switch (data.type) {
      // --- Register a new user ---
      case "register":
        users[data.userId] = { color: data.color, name: data.name || "Anonymous" };
        ws.userId = data.userId;
        broadcastUsers();
        break;

      // --- Ephemeral events (not stored) ---
      case "draw-segment":
      case "shape-preview":
      case "cursor":
        broadcastExcept(ws, data);
        break;

      // --- Committed strokes (free, shape, or text) ---
      case "stroke":
      case "shape":
      case "text":
        drawHistory.push({ type: "stroke", data });
        undoneHistory = [];
        broadcastExcept(ws, { type: "stroke", stroke: data });
        sendQueueStatus();
        break;

      // --- Clear Canvas (undoable) ---
      case "clear":
        drawHistory.push({ type: "clear", prevState: buildCurrentStrokes() });
        undoneHistory = [];
        broadcastAll({ type: "clear" });
        sendQueueStatus();
        break;

      // --- Undo ---
      case "undo":
        if (drawHistory.length > 0) {
          const last = drawHistory.pop();
          undoneHistory.push(last);
          broadcastAll({ type: "update-canvas", history: buildCurrentStrokes() });
          sendQueueStatus();
        }
        break;

      // --- Redo ---
      case "redo":
        if (undoneHistory.length > 0) {
          const redone = undoneHistory.pop();
          drawHistory.push(redone);
          broadcastAll({ type: "update-canvas", history: buildCurrentStrokes() });
          sendQueueStatus();
        }
        break;

      // --- Ping-Pong latency check ---
      case "ping":
        ws.send(JSON.stringify({ type: "pong", sentAt: data.sentAt }));
        break;

      // --- Disconnect notice ---
      case "disconnect":
        broadcastExcept(ws, data);
        break;

      default:
        console.warn("⚠️ Unknown message type:", data.type);
    }
  });

  // --- Handle disconnection ---
  ws.on("close", () => {
    if (ws.userId) {
      delete users[ws.userId];
      broadcastUsers();
    }
    console.log("🔴 Client disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
});