// client/main.js
import { setupWebSocket } from "./websocket.js";
import { initCanvas } from "./canvas.js";

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room") || "default";
  const createRoom = params.get("create") === "1";

  // username stored per tab
  let username = sessionStorage.getItem("username");
  if (!username) {
    username = (prompt("Enter your name:") || "Anonymous").trim() || "Anonymous";
    sessionStorage.setItem("username", username);
  }

  const userId = "user-" + Math.random().toString(36).slice(2, 8);
  const userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);

  const ws = setupWebSocket({ userId, username, userColor, roomId, createRoom });

  // init canvas once ws connection is established (so register completes)
  ws.addEventListener("open", () => {
    initCanvas({ ws, userId, username, userColor, roomId });
  });
});