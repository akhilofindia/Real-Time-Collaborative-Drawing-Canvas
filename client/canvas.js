// client/canvas.js
// Collaborative whiteboard with brush, eraser, shapes, text, undo/redo, live cursors, usernames, and performance metrics (FPS + Ping).

// --- username per-tab ---
let username = sessionStorage.getItem("username");
if (!username) {
  username = (prompt("Enter your name:") || "Anonymous").trim() || "Anonymous";
  sessionStorage.setItem("username", username);
}

(function () {
  // ---- DOM + canvas ----
  const canvas = document.getElementById("cvs");
  if (!canvas) throw new Error("No canvas element with id 'cvs' found.");
  const ctx = canvas.getContext("2d");

  function resizeCanvasToFit() {
    const LOGICAL_WIDTH = 1000, LOGICAL_HEIGHT = 700;
    const ratio = LOGICAL_WIDTH / LOGICAL_HEIGHT;
    let w = Math.floor(window.innerWidth * 0.9);
    let h = Math.floor(w / ratio);
    if (h > Math.floor(window.innerHeight * 0.8)) {
      h = Math.floor(window.innerHeight * 0.8);
      w = Math.floor(h * ratio);
    }
    canvas.width = w;
    canvas.height = h;
  }
  resizeCanvasToFit();
  window.addEventListener("resize", () => {
    resizeCanvasToFit();
    redrawAll();
    renderCursors();
  });

  // ---- state ----
  const userId = "user-" + Math.random().toString(36).slice(2, 8);
  const userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);

  let currentTool = "brush";
  let color = "#000000";
  let strokeWidth = 3;
  let drawing = false;
  let startPoint = null;
  let pointsBuffer = [];
  let localHistory = [];

  // ---- UI elements ----
  const colorInput = document.getElementById("color");
  const widthInput = document.getElementById("width");
  const brushBtn = document.getElementById("brush");
  const eraserBtn = document.getElementById("eraser");
  const rectBtn = document.getElementById("rect");
  const circleBtn = document.getElementById("circle");
  const textBtn = document.getElementById("text");
  const clearBtn = document.getElementById("clear");
  const undoBtn = document.getElementById("undo");
  const redoBtn = document.getElementById("redo");

  const toolButtons = [brushBtn, eraserBtn, rectBtn, circleBtn, textBtn].filter(Boolean);

  function setTool(tool) {
    currentTool = tool;
    toolButtons.forEach(b => b && b.classList.toggle("active", b.id === tool));
  }
  setTool("brush");

  if (colorInput) colorInput.addEventListener("input", e => { color = e.target.value; if (currentTool === "eraser") setTool("brush"); });
  if (widthInput) widthInput.addEventListener("input", e => { strokeWidth = +e.target.value; });

  if (brushBtn) brushBtn.addEventListener("click", () => setTool("brush"));
  if (eraserBtn) eraserBtn.addEventListener("click", () => setTool(currentTool === "eraser" ? "brush" : "eraser"));
  if (rectBtn) rectBtn.addEventListener("click", () => setTool("rect"));
  if (circleBtn) circleBtn.addEventListener("click", () => setTool("circle"));
  if (textBtn) textBtn.addEventListener("click", () => setTool("text"));
  if (clearBtn) clearBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "clear" })));
  if (undoBtn) undoBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "undo" })));
  if (redoBtn) redoBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "redo" })));

  function setButtonsState(undoCount, redoCount) {
    if (undoBtn) undoBtn.disabled = undoCount === 0;
    if (redoBtn) redoBtn.disabled = redoCount === 0;
  }

  // ---- overlay + user panels ----
  const cursors = {};
  const overlay = document.createElement("div");
  Object.assign(overlay.style, { position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 999 });
  document.body.appendChild(overlay);

  const userPanel = document.createElement("div");
  Object.assign(userPanel.style, { position: "fixed", right: "20px", top: "20px", background: "rgba(255,255,255,0.95)", padding: "8px 10px", borderRadius: "8px", zIndex: 1000, fontFamily: "sans-serif" });
  document.body.appendChild(userPanel);

  // --- PERFORMANCE PANEL ---
  const perfPanel = document.createElement("div");
  Object.assign(perfPanel.style, {
    position: "fixed",
    left: "20px",
    top: "20px",
    background: "rgba(0,0,0,0.7)",
    color: "lime",
    fontFamily: "monospace",
    fontSize: "13px",
    padding: "6px 8px",
    borderRadius: "8px",
    zIndex: 1000,
    minWidth: "90px",
  });
  perfPanel.innerHTML = "FPS: --<br>Ping: -- ms";
  document.body.appendChild(perfPanel);

  function renderUserPanel(users) {
    userPanel.innerHTML = `<strong>👥 Online (${users.length})</strong><br/>`;
    users.forEach(u => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.marginTop = "6px";
      row.innerHTML = `<span style="width:12px;height:12px;border-radius:50%;display:inline-block;background:${u.color};margin-right:8px"></span>${u.userId === userId ? `<strong>${u.name} (You)</strong>` : u.name}`;
      userPanel.appendChild(row);
    });
  }

  function renderCursors() {
    overlay.innerHTML = "";
    Object.entries(cursors).forEach(([id, c]) => {
      if (id === userId) return;
      const box = document.createElement("div");
      box.style.position = "absolute";
      box.style.left = `${c.x}px`;
      box.style.top = `${c.y}px`;
      box.style.transform = "translate(-50%, -50%)";
      box.style.pointerEvents = "none";
      box.style.display = "flex";
      box.style.flexDirection = "column";
      box.style.alignItems = "center";

      const dot = document.createElement("div");
      dot.style.width = "10px";
      dot.style.height = "10px";
      dot.style.borderRadius = "50%";
      dot.style.background = c.color;
      dot.style.boxShadow = "0 0 3px rgba(0,0,0,0.3)";
      box.appendChild(dot);

      const name = document.createElement("div");
      name.textContent = c.name || "User";
      name.style.fontSize = "12px";
      name.style.color = c.color;
      name.style.textShadow = "0 0 2px #fff";
      box.appendChild(name);

      overlay.appendChild(box);
    });
  }

  // ---- drawing primitives ----
  function drawLineOnCtx(context, x1, y1, x2, y2, col, w, isEraser) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.lineWidth = w;
    context.lineCap = "round";
    context.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    context.strokeStyle = isEraser ? "rgba(0,0,0,1)" : col;
    context.stroke();
  }

  function drawShapeOnCtx(context, shape) {
    const { shapeType, from, to, color: shColor, width } = shape;
    const sx = from.x * canvas.width, sy = from.y * canvas.height;
    const ex = to.x * canvas.width, ey = to.y * canvas.height;
    context.beginPath();
    context.lineWidth = width;
    context.strokeStyle = shColor;
    if (shapeType === "rect") context.rect(sx, sy, ex - sx, ey - sy);
    else {
      const r = Math.hypot(ex - sx, ey - sy);
      context.arc(sx, sy, r, 0, Math.PI * 2);
    }
    context.stroke();
  }

  function drawTextOnCtx(context, t) {
    context.font = `${t.size || 20}px Arial`;
    context.fillStyle = t.color;
    context.fillText(t.text, t.x * canvas.width, t.y * canvas.height);
  }

  function renderStrokeObject(st) {
    if (!st) return;
    if (st.kind === "free") {
      for (let i = 1; i < st.points.length; i++) {
        const a = st.points[i - 1], b = st.points[i];
        drawLineOnCtx(ctx, a.x * canvas.width, a.y * canvas.height, b.x * canvas.width, b.y * canvas.height, st.color, st.width, st.eraser);
      }
    } else if (st.kind === "shape") drawShapeOnCtx(ctx, st);
    else if (st.kind === "text") drawTextOnCtx(ctx, st);
  }

  function redrawAll(history = localHistory) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of history) renderStrokeObject(s);
  }

  // ---- input helpers ----
  function getNormPos(e) {
    const r = canvas.getBoundingClientRect();
    let cx, cy;
    if (e.touches && e.touches.length) {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY;
    } else {
      cx = e.clientX; cy = e.clientY;
    }
    return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height };
  }

  function pointerDown(e) {
    e.preventDefault();
    drawing = true;
    startPoint = getNormPos(e);
    pointsBuffer = [startPoint];
  }

  function pointerMove(e) {
    const pos = getNormPos(e);
    safeSend({ type: "cursor", userId, x: pos.x, y: pos.y, color: userColor, name: username });

    if (!drawing) return;

    if (currentTool === "brush" || currentTool === "eraser") {
      const last = pointsBuffer[pointsBuffer.length - 1];
      drawLineOnCtx(ctx, last.x * canvas.width, last.y * canvas.height, pos.x * canvas.width, pos.y * canvas.height, color, strokeWidth, currentTool === "eraser");
      safeSend({ type: "draw-segment", from: last, to: pos, color, width: strokeWidth, eraser: currentTool === "eraser" });
      pointsBuffer.push(pos);
    } else if (currentTool === "rect" || currentTool === "circle") {
      redrawAll();
      const preview = { kind: "shape", shapeType: currentTool, from: startPoint, to: pos, color, width: strokeWidth };
      drawShapeOnCtx(ctx, preview);
      safeSend({ type: "shape-preview", shape: preview });
    }
  }

  function pointerUp(e) {
    const pos = getNormPos(e);
    if (!drawing) return;
    drawing = false;

    if (currentTool === "brush" || currentTool === "eraser") {
      if (pointsBuffer.length < 2) return;
      const freeStroke = { type: "stroke", kind: "free", userId, color, width: strokeWidth, eraser: currentTool === "eraser", points: pointsBuffer.slice() };
      localHistory.push(freeStroke);
      safeSend(freeStroke);
    } else if (currentTool === "rect" || currentTool === "circle") {
      const shapeStroke = { type: "stroke", kind: "shape", userId, shapeType: currentTool, from: startPoint, to: pos, color, width: strokeWidth };
      localHistory.push(shapeStroke);
      redrawAll();
      safeSend(shapeStroke);
    } else if (currentTool === "text") {
      const txt = prompt("Enter text:");
      if (txt) {
        const textObj = { type: "stroke", kind: "text", userId, text: txt, x: pos.x, y: pos.y, color, size: strokeWidth * 5 };
        localHistory.push(textObj);
        renderStrokeObject(textObj);
        safeSend(textObj);
      }
    }
  }

  // ---- EVENTS ----
  canvas.addEventListener("mousedown", pointerDown);
  document.addEventListener("mousemove", pointerMove);
  document.addEventListener("mouseup", pointerUp);
  canvas.addEventListener("mouseleave", e => { if (drawing) pointerUp(e); });

  canvas.addEventListener("touchstart", e => pointerDown(e), { passive: false });
  document.addEventListener("touchmove", e => pointerMove(e), { passive: false });
  document.addEventListener("touchend", e => pointerUp(e), { passive: false });
  document.addEventListener("touchcancel", e => pointerUp(e), { passive: false });

  // ---- WebSocket ----
  const ws = new WebSocket(`ws://${window.location.host}`);
  const safeSend = obj => { try { ws.send(JSON.stringify(obj)); } catch {} };

  ws.onopen = () => safeSend({ type: "register", userId, color: userColor, name: username });

  ws.onmessage = ev => {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }
    switch (data.type) {
      case "draw-segment":
        drawLineOnCtx(ctx, data.from.x * canvas.width, data.from.y * canvas.height, data.to.x * canvas.width, data.to.y * canvas.height, data.color, data.width, data.eraser);
        break;
      case "shape-preview":
        redrawAll();
        if (data.shape) drawShapeOnCtx(ctx, data.shape);
        break;
      case "stroke":
        const incoming = data.stroke || data;
        if (!incoming.kind) {
          if (incoming.points) incoming.kind = "free";
          else if (incoming.shapeType) incoming.kind = "shape";
          else if (incoming.text) incoming.kind = "text";
        }
        localHistory.push(incoming);
        renderStrokeObject(incoming);
        break;
      case "init":
      case "update-canvas":
        localHistory = (data.history || []).map(s => {
          if (!s.kind) {
            if (s.points) s.kind = "free";
            else if (s.shapeType) s.kind = "shape";
            else if (s.text) s.kind = "text";
          }
          return s;
        });
        redrawAll();
        break;
      case "clear":
        localHistory = [];
        redrawAll();
        break;
      case "queue-status":
        setButtonsState(data.undo, data.redo);
        break;
      case "cursor":
        const rect = canvas.getBoundingClientRect();
        cursors[data.userId] = {
          x: rect.left + data.x * rect.width,
          y: rect.top + data.y * rect.height,
          color: data.color,
          name: data.name
        };
        renderCursors();
        break;
      case "online-users":
        renderUserPanel(data.users || []);
        break;
      case "pong":
        latency = performance.now() - (data.sentAt || 0);
        updatePerfPanel();
        break;
      case "disconnect":
        delete cursors[data.userId];
        renderCursors();
        break;
        
    }
  };

  // ---- PERFORMANCE (FPS + PING) ----
  let lastFrameTime = performance.now();
  let frameCount = 0;
  let fps = 0;
  let latency = 0;
  let lastPing = 0;

  function updateFPS() {
    const now = performance.now();
    frameCount++;
    if (now - lastFrameTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      lastFrameTime = now;
      updatePerfPanel();
    }
    requestAnimationFrame(updateFPS);
  }

  function sendPing() {
    lastPing = performance.now();
    safeSend({ type: "ping", sentAt: lastPing });
  }

  function updatePerfPanel() {
    let color = "lime";
    if (latency > 200) color = "yellow";
    if (latency > 400) color = "red";
    perfPanel.style.color = color;
    perfPanel.innerHTML = `FPS: ${fps}<br>Ping: ${latency.toFixed(1)} ms`;
  }

  setInterval(sendPing, 3000);
  requestAnimationFrame(updateFPS);

  // ---- CLEANUP ----
  window.addEventListener("beforeunload", () => safeSend({ type: "disconnect", userId }));
})();