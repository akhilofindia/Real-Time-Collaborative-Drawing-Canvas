const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "..", "client")));

let users = {};          // userId -> { color }
let drawHistory = [];    // array of operations (strokes or clear)
let undoneHistory = [];

// --- Broadcast Helpers ---
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

function broadcastUsers() {
  const online = Object.entries(users).map(([id, u]) => ({
    userId: id,
    color: u.color,
    name: u.name
  }));
  broadcastAll({ type: "online-users", users: online });
}


// --- WebSocket Handlers ---
wss.on("connection", (ws) => {
  console.log("🟢 Client connected");

  // Send existing drawings immediately
  const allStrokes = drawHistory
    .filter((op) => op.type === "stroke")
    .map((op) => op.data);
  ws.send(JSON.stringify({ type: "init", history: allStrokes }));
  sendQueueStatus();
  broadcastUsers();

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      console.error("❌ Invalid JSON");
      return;
    }

    switch (data.type) {
      // --- Register new user ---
      case "register":
        users[data.userId] = { color: data.color, name: data.name || "Anonymous" };
        ws.userId = data.userId;
        broadcastUsers();
        break;


      // --- Real-time drawing ---
      case "draw-segment":
        broadcastExceptSender(ws, data);
        break;

      // --- Stroke commit ---
      case "stroke":
        drawHistory.push({ type: "stroke", data });
        undoneHistory = [];
        broadcastExceptSender(ws, { type: "stroke", stroke: data });
        sendQueueStatus();
        break;

      // --- Undoable Clear ---
      case "clear":
        const prevState = drawHistory
          .filter((op) => op.type === "stroke")
          .map((op) => op.data);
        drawHistory.push({ type: "clear", prevState });
        undoneHistory = [];
        broadcastAll({ type: "clear" });
        sendQueueStatus();
        break;

      // --- Undo ---
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

      // --- Redo ---
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

      // --- Cursor Movement ---
      case "cursor":
        broadcastExceptSender(ws, data);
        break;

      // --- Disconnect ---
      case "disconnect":
        broadcastExceptSender(ws, data);
        break;

      default:
        console.warn("⚠️ Unknown type:", data.type);
    }
  });

  // --- Handle close ---
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