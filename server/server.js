const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "..", "client")));

let drawHistory = [];    // array of operations (strokes or clear)
let undoneHistory = [];

function broadcastAll(msgObj) {
  const str = JSON.stringify(msgObj);
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(str);
  }
}

function broadcastExceptSender(sender, msgObj) {
  const str = JSON.stringify(msgObj);
  for (const c of wss.clients) {
    if (c !== sender && c.readyState === WebSocket.OPEN) c.send(str);
  }
}

function sendQueueStatus() {
  broadcastAll({
    type: "queue-status",
    undo: drawHistory.length,
    redo: undoneHistory.length,
  });
}

wss.on("connection", (ws) => {
  console.log("🟢 Client connected");

  // Extract strokes from history for init
  const allStrokes = drawHistory
    .filter((op) => op.type === "stroke")
    .map((op) => op.data);
  ws.send(JSON.stringify({ type: "init", history: allStrokes }));
  sendQueueStatus();

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      console.error("❌ Invalid JSON");
      return;
    }

    switch (data.type) {
      // ✅ Real-time preview (not stored)
      case "draw-segment":
        broadcastExceptSender(ws, data);
        break;

      // ✅ Final stroke
      case "stroke":
        drawHistory.push({ type: "stroke", data });
        undoneHistory = [];
        broadcastExceptSender(ws, { type: "stroke", stroke: data });
        sendQueueStatus();
        break;

      // ✅ Undoable Clear
      case "clear":
        const prevState = drawHistory.filter((op) => op.type === "stroke").map((op) => op.data);
        drawHistory.push({ type: "clear", prevState });
        undoneHistory = [];
        broadcastAll({ type: "clear" });
        sendQueueStatus();
        break;

      // ✅ Undo
      case "undo":
        if (drawHistory.length > 0) {
          const last = drawHistory.pop();
          undoneHistory.push(last);

          let strokes = [];
          for (const op of drawHistory) {
            if (op.type === "stroke") strokes.push(op.data);
            else if (op.type === "clear") strokes = [];
          }

          broadcastAll({ type: "update-canvas", history: strokes });
          sendQueueStatus();
        }
        break;

      // ✅ Redo
      case "redo":
        if (undoneHistory.length > 0) {
          const redone = undoneHistory.pop();
          drawHistory.push(redone);

          let strokes = [];
          for (const op of drawHistory) {
            if (op.type === "stroke") strokes.push(op.data);
            else if (op.type === "clear") strokes = [];
          }

          broadcastAll({ type: "update-canvas", history: strokes });
          sendQueueStatus();
        }
        break;

      case "cursor":
        broadcastExceptSender(ws, data);
        break;

      case "disconnect":
        broadcastExceptSender(ws, data);
        break;

      default:
        console.warn("⚠️ Unknown type:", data.type);
    }
  });

  ws.on("close", () => console.log("🔴 Client disconnected"));
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);