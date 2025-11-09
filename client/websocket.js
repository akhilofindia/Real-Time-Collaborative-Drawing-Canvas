// client/websocket.js
export function setupWebSocket({ userId, username, userColor, roomId, createRoom }) {
  const ws = new WebSocket(`ws://${window.location.host}`);

  ws.safeSend = (obj) => {
    try { ws.send(JSON.stringify(obj)); } catch (err) { /* ignore */ }
  };

  ws.addEventListener("open", () => {
    ws.safeSend({
      type: "register",
      userId,
      name: username,
      color: userColor,
      roomId,
      create: createRoom
    });
  });

  return ws;
}