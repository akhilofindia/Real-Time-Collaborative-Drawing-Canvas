// server/server.js
const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const { rooms, broadcastToRoom, broadcastUsers, deleteRoomIfEmpty, handleMessage } = require("./rooms");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, "..", "client")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "index.html"));
});

// Simple room existence API for join-page pre-check
app.get("/room-exists/:id", (req, res) => {
  const id = req.params.id;
  const exists = rooms.has(id);
  res.json({ exists });
});

wss.on("connection", (ws) => {
  console.log("🟢 Client connected");

  ws.on("message", (msg) => {
    let d;
    try { d = JSON.parse(msg.toString()); } catch {
      console.warn("❌ Invalid JSON message");
      return;
    }
    handleMessage(ws, d);
  });

  ws.on("close", () => {
    if (ws.roomId && rooms.has(ws.roomId)) {
      const room = rooms.get(ws.roomId);
      if (room && ws.userId) room.users.delete(ws.userId);
      broadcastUsers(ws.roomId);
      deleteRoomIfEmpty(ws.roomId);
    }
    console.log("🔴 Client disconnected");
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running at http://0.0.0.0:${PORT}`));