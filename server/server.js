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

function broadcastAll(obj) {
  const str = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(str);
}
function broadcastExcept(sender, obj) {
  const str = JSON.stringify(obj);
  for (const c of wss.clients) if (c !== sender && c.readyState === WebSocket.OPEN) c.send(str);
}
function sendQueueStatus() {
  broadcastAll({ type: "queue-status", undo: drawHistory.length, redo: undoneHistory.length });
}
function broadcastUsers() {
  const online = Object.entries(users).map(([id, u]) => ({ userId: id, color: u.color, name: u.name }));
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

wss.on("connection", (ws) => {
  console.log("🟢 client connected");
  // send current strokes
  ws.send(JSON.stringify({ type: "init", history: buildCurrentStrokes() }));
  sendQueueStatus();
  broadcastUsers();

  ws.on("message", (msg) => {
    let d;
    try { d = JSON.parse(msg.toString()); } catch { return; }

    switch (d.type) {
      case "register":
        users[d.userId] = { color: d.color, name: d.name || "Anonymous" };
        ws.userId = d.userId;
        broadcastUsers();
        break;

      // ephemeral
      case "draw-segment":
      case "shape-preview":
      case "cursor":
        broadcastExcept(ws, d);
        break;

      // committed stroke (free / shape / text)
      case "stroke":
        drawHistory.push({ type: "stroke", data: d });
        undoneHistory = [];
        broadcastExcept(ws, { type: "stroke", stroke: d });
        sendQueueStatus();
        break;

      // backwards compat: if client sent shape or text messages directly
      case "shape":
      case "text":
        drawHistory.push({ type: "stroke", data: d });
        undoneHistory = [];
        broadcastExcept(ws, { type: "stroke", stroke: d });
        sendQueueStatus();
        break;

      case "clear": {
        drawHistory.push({ type: "clear", prevState: buildCurrentStrokes() });
        undoneHistory = [];
        broadcastAll({ type: "clear" });
        sendQueueStatus();
        break;
      }

      case "undo":
        if (drawHistory.length > 0) {
          const last = drawHistory.pop();
          undoneHistory.push(last);
          broadcastAll({ type: "update-canvas", history: buildCurrentStrokes() });
          sendQueueStatus();
        }
        break;

      case "redo":
        if (undoneHistory.length > 0) {
          const r = undoneHistory.pop();
          drawHistory.push(r);
          broadcastAll({ type: "update-canvas", history: buildCurrentStrokes() });
          sendQueueStatus();
        }
        break;

      case "disconnect":
        broadcastExcept(ws, d);
        break;

      default:
        console.warn("Unknown type:", d.type);
    }
  });

  ws.on("close", () => {
    if (ws.userId) {
      delete users[ws.userId];
      broadcastUsers();
    }
    console.log("🔴 client disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on ${PORT}`));