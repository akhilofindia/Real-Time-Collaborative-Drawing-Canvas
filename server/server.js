const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "..", "client")));

let drawHistory = [];    // array of stroke objects
let undoneHistory = [];  // stack for redo

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

  // send whole history to new client
  ws.send(JSON.stringify({ type: "init", history: drawHistory }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (err) {
      console.error("Invalid JSON message:", err);
      return;
    }

    switch (data.type) {
      case "stroke": // a full stroke sent on mouseup
        // store stroke (assume points normalized)
        drawHistory.push(data);
        // new stroke invalidates redo stack
        undoneHistory = [];
        // broadcast to other clients (sender already drew locally)
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
          const popped = drawHistory.pop();
          undoneHistory.push(popped);
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
        console.warn("Unknown message type:", data.type);
    }
  });

  ws.on("close", () => console.log("🔴 Client disconnected"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));