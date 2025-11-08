const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "..", "client")));

let drawHistory = []; // store all draw events

function broadcastAll(message) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function broadcastExceptSender(sender, message) {
  for (const client of wss.clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

wss.on("connection", (ws) => {
  console.log("🟢 Client connected");

  // Send existing drawings
  if (drawHistory.length > 0) {
    ws.send(JSON.stringify({ type: "init", history: drawHistory }));
  }

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      switch (data.type) {
        case "draw":
          drawHistory.push(data);
          broadcastExceptSender(ws, JSON.stringify(data));
          break;

        case "cursor":
          broadcastExceptSender(ws, JSON.stringify(data));
          break;

        case "disconnect":
          broadcastExceptSender(ws, JSON.stringify(data));
          break;

        case "clear":
          drawHistory = [];
          broadcastAll(JSON.stringify({ type: "clear" }));
          break;

        case "clear-history":
          drawHistory = [];
          break;

        default:
          console.warn("⚠️ Unknown message type:", data.type);
      }
    } catch (err) {
      console.error("❌ Invalid message:", err.message);
    }
  });

  ws.on("close", () => console.log("🔴 Client disconnected"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});