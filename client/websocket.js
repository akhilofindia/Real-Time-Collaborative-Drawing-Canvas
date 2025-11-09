// client/websocket.js
export function setupWebSocket({ userId, username, userColor, roomId, createRoom }) {
  // pick secure ws on https
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${window.location.host}`);

  // Safe send helper
  ws.safeSend = (obj) => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      } else {
        console.warn("⚠️ Tried sending while WS not open:", obj);
      }
    } catch (err) {
      console.error("❌ WebSocket send error:", err);
    }
  };

  ws.addEventListener("open", () => {
    // Normalize createRoom flag
    const create = (createRoom === true) || (createRoom === "1") || (createRoom === 1);

    const registerPayload = {
      type: "register",
      userId,
      name: username,
      color: userColor,
      roomId,
      create
    };

    ws.send(JSON.stringify(registerPayload));
    console.log("📤 Sent register:", registerPayload);
  });

  // Graceful cleanup when user closes or navigates away
  window.addEventListener("beforeunload", () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "disconnect", userId, roomId }));
      }
    } catch (err) {
      console.warn("⚠️ Failed to send disconnect:", err);
    }
  });

  return ws;
}