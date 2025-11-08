const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "..", "client")));

let drawHistory = [];
let undoneHistory = [];

function broadcastAll(message) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function broadcastExceptSender(sender, message) {
  for (const client of wss.clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) client.send(message);
  }
}

wss.on("connection", (ws) => {
  console.log("🟢 Client connected");

  // Send existing canvas
  ws.send(JSON.stringify({ type: "init", history: drawHistory }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (err) {
      console.error("❌ Invalid JSON:", err);
      return;
    }

    switch (data.type) {
      // 🔥 Real-time segment (not stored)
      case "draw-segment":
        broadcastExceptSender(ws, JSON.stringify(data));
        break;

      // ✅ Full stroke for undo/redo
      case "stroke":
        drawHistory.push(data);
        undoneHistory = [];
        broadcastExceptSender(ws, JSON.stringify({ type: "stroke", stroke: data }));
        break;

      case "cursor":
        broadcastExceptSender(ws, JSON.stringify(data));
        break;

      case "clear":
        drawHistory = [];
        undoneHistory = [];
        broadcastAll(JSON.stringify({ type: "clear" }));
        break;

      case "undo":
        if (drawHistory.length > 0) {
          const undone = drawHistory.pop();
          undoneHistory.push(undone);
          broadcastAll(JSON.stringify({ type: "update-canvas", history: drawHistory }));
        }
        break;

      case "redo":
        if (undoneHistory.length > 0) {
          const restored = undoneHistory.pop();
          drawHistory.push(restored);
          broadcastAll(JSON.stringify({ type: "update-canvas", history: drawHistory }));
        }
        break;

      case "disconnect":
        broadcastExceptSender(ws, JSON.stringify(data));
        break;

      default:
        console.warn("⚠️ Unknown message:", data.type);
    }
  });

  ws.on("close", () => console.log("🔴 Client disconnected"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));