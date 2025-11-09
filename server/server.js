// server/server.js
const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

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

// --- ROOM STORE ---
const rooms = new Map(); // roomId -> { users: Map(userId -> ws), history: [], undone: [] }

// --- HELPERS ---
function broadcastToRoom(roomId, msgObj, except = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msgObj);
  for (const [, client] of room.users.entries()) {
    if (client.readyState === WebSocket.OPEN && client !== except) {
      client.send(data);
    }
  }
}

function buildHistory(room) {
  return room.history
    .filter((op) => op.type !== "clear")
    .map((op) => op.data);
}

function broadcastUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const users = Array.from(room.users.entries()).map(([id, ws]) => ({
    userId: id,
    name: ws.name,
    color: ws.color,
  }));
  broadcastToRoom(roomId, { type: "online-users", users });
}

function deleteRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.users.size === 0) {
    rooms.delete(roomId);
    console.log(`🧹 Deleted empty room: ${roomId}`);
  }
}

// --- MAIN HANDLER ---
wss.on("connection", (ws) => {
  console.log("🟢 Client connected");

  ws.on("message", (msg) => {
    let d;
    try {
      d = JSON.parse(msg.toString());
    } catch {
      console.warn("❌ Invalid JSON message");
      return;
    }

    switch (d.type) {
      // --- Register new user into a room ---
      case "register": {
        const { roomId = "default", create = false } = d;

        // If creating: create only when the room DOES NOT already exist.
        // IMPORTANT: do NOT reset an existing room on create requests.
        if (create) {
          if (rooms.has(roomId)) {
            console.log(`⚠️ Create requested but room already exists: ${roomId} — will join existing room instead.`);
            // (optional) could notify the client, but not necessary — they'll get init below
          } else {
            rooms.set(roomId, { users: new Map(), history: [], undone: [] });
            console.log(`🆕 Created new room: ${roomId}`);
          }
        } else {
          // Joining (not creating) must only succeed if room exists
          if (!rooms.has(roomId)) {
            console.log(`❌ Tried joining non-existent room: ${roomId}`);
            ws.send(JSON.stringify({ type: "no-room", roomId }));
            return;
          }
        }

        const room = rooms.get(roomId);
        if (!room) return;

        ws.userId = d.userId;
        ws.name = d.name || "Anonymous";
        ws.color = d.color || "#000000";
        ws.roomId = roomId;

        room.users.set(ws.userId, ws);
        console.log(`👤 ${ws.name} joined room ${roomId}`);

        // Send existing canvas state
        ws.send(JSON.stringify({ type: "init", history: buildHistory(room) }));
        broadcastUsers(roomId);
        break;
      }

      // --- Drawing / Preview / Cursor ---
      case "draw-segment":
      case "shape-preview":
      case "cursor": {
        const room = rooms.get(ws.roomId);
        if (!room) return;
        broadcastToRoom(ws.roomId, d, ws);
        break;
      }

      // --- Stroke / Shape / Text ---
      case "stroke":
      case "shape":
      case "text": {
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const kind = d.kind || d.type;
        room.history.push({ type: kind, data: d });
        room.undone = [];
        broadcastToRoom(ws.roomId, { type: "stroke", stroke: d }, ws);
        break;
      }

      // --- Clear ---
      case "clear": {
        const room = rooms.get(ws.roomId);
        if (!room) return;
        room.history.push({ type: "clear", data: null });
        room.undone = [];
        broadcastToRoom(ws.roomId, { type: "clear" });
        break;
      }

      // --- Undo ---
      case "undo": {
        const room = rooms.get(ws.roomId);
        if (!room) return;
        if (room.history.length > 0) {
          const last = room.history.pop();
          room.undone.push(last);
          broadcastToRoom(ws.roomId, {
            type: "update-canvas",
            history: buildHistory(room),
          });
        }
        break;
      }

      // --- Redo ---
      case "redo": {
        const room = rooms.get(ws.roomId);
        if (!room) return;
        if (room.undone.length > 0) {
          const redo = room.undone.pop();
          room.history.push(redo);
          broadcastToRoom(ws.roomId, {
            type: "update-canvas",
            history: buildHistory(room),
          });
        }
        break;
      }

      // --- Disconnect manually ---
      case "disconnect": {
        const room = rooms.get(ws.roomId);
        if (!room) return;
        room.users.delete(ws.userId);
        broadcastUsers(ws.roomId);
        deleteRoomIfEmpty(ws.roomId);
        break;
      }

      // --- Ping/Pong ---
      case "ping":
        ws.send(JSON.stringify({ type: "pong", sentAt: d.sentAt }));
        break;

      default:
        console.warn("⚠️ Unknown message type:", d.type);
    }
  });

  // --- Client closed connection ---
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

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`)
);