// server/rooms.js
const { buildHistory, handleUndoRedo } = require("./drawing-state");

const rooms = new Map(); // roomId -> { users: Map(userId -> ws), history: [], undone: [] }

function broadcastToRoom(roomId, msgObj, except = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msgObj);
  for (const [, client] of room.users.entries()) {
    if (client.readyState === 1 && client !== except) {
      client.send(data);
    }
  }
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

function handleMessage(ws, d) {
  switch (d.type) {
    case "register": {
          // inside your message handler when d.type === "register"
      const roomId = (d.roomId || "default").toString();
      const createFlag = d.create === true || d.create === "true" || d.create === "1" || d.create === 1;

      console.log("🟢 Register request:", roomId, "createFlag:", createFlag);

      if (createFlag) {
        if (!rooms.has(roomId)) {
          rooms.set(roomId, { users: new Map(), history: [], undone: [] });
          console.log(`🆕 Created new room: ${roomId}`);
        } else {
          console.log(`⚠️ Room already exists: ${roomId} — joining.`);
        }
      } else {
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

      ws.send(JSON.stringify({
        type: "room-created-or-joined",
        roomId,
        history: buildHistory(room)
      }));

      broadcastUsers(roomId);
      break;
    }



    case "draw-segment":
    case "shape-preview":
    case "cursor": {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      broadcastToRoom(ws.roomId, d, ws);
      break;
    }

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

    case "clear": {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      room.history.push({ type: "clear", data: null });
      room.undone = [];
      broadcastToRoom(ws.roomId, { type: "clear" });
      break;
    }

    case "undo": {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      handleUndoRedo(room, "undo");
      broadcastToRoom(ws.roomId, { type: "update-canvas", history: buildHistory(room) });
      break;
    }

    case "redo": {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      handleUndoRedo(room, "redo");
      broadcastToRoom(ws.roomId, { type: "update-canvas", history: buildHistory(room) });
      break;
    }

    case "disconnect": {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      room.users.delete(ws.userId);
      broadcastUsers(ws.roomId);
      deleteRoomIfEmpty(ws.roomId);
      break;
    }

    case "ping": {
      // reply with pong, echo sentAt for latency calc
      ws.send(JSON.stringify({ type: "pong", sentAt: d.sentAt }));
      break;
    }

    default:
      console.warn("⚠️ Unknown message type:", d.type);
  }
}

module.exports = { rooms, broadcastToRoom, broadcastUsers, deleteRoomIfEmpty, handleMessage };