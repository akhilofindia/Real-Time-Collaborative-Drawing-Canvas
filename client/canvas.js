// client/canvas.js
// Single-canvas, stable, with live cursor, shape-preview and unified strokes.
// Assumes HTML has buttons with ids: brush, eraser, rect, circle, text, clear, undo, redo
// and inputs: color, width

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
  window.addEventListener("resize", () => { resizeCanvasToFit(); redrawAll(); renderCursors(); });

  // ---- state ----
  const userId = "user-" + Math.random().toString(36).slice(2, 8);
  const userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);

  let currentTool = "brush"; // 'brush'|'eraser'|'rect'|'circle'|'text'
  let color = "#000000";
  let strokeWidth = 3;
  let drawing = false;
  let startPoint = null;
  let pointsBuffer = [];
  let localHistory = []; // array of unified stroke objects
  // unified stroke object examples:
  // freehand: { type:'stroke', kind:'free', userId, color, width, eraser, points: [...] }
  // shape:    { type:'stroke', kind:'shape', userId, shapeType:'rect'|'circle', from:{x,y}, to:{x,y}, color, width }
  // text:     { type:'stroke', kind:'text', userId, text, x, y, color, size }

  // ---- UI elements (create brush button if missing) ----
  const colorInput = document.getElementById("color");
  const widthInput = document.getElementById("width");
  let brushBtn = document.getElementById("brush");
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
  setTool("brush"); // default

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

  // ---- cursors + user panel ----
  const cursors = {};
  const overlay = document.createElement("div");
  Object.assign(overlay.style, { position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 999 });
  document.body.appendChild(overlay);

  const userPanel = document.createElement("div");
  Object.assign(userPanel.style, { position: "fixed", right: "20px", top: "20px", background: "rgba(255,255,255,0.95)", padding: "8px 10px", borderRadius: "8px", zIndex: 1000, fontFamily: "sans-serif" });
  document.body.appendChild(userPanel);

  function renderUserPanel(users) {
    userPanel.innerHTML = `<strong>👥 Online (${users.length})</strong><br/>`;
    users.forEach(u => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.marginTop = "6px";
      row.innerHTML = `<span style="width:12px;height:12px;border-radius:50%;display:inline-block;background:${u.color};margin-right:8px"></span>${u.userId===userId?`<strong>${u.name} (You)</strong>`:u.name}`;
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
    } else if (st.kind === "shape") {
      drawShapeOnCtx(ctx, st);
    } else if (st.kind === "text") {
      drawTextOnCtx(ctx, st);
    }
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
    // send cursor every move
    try { ws.send(JSON.stringify({ type: "cursor", userId, x: pos.x, y: pos.y, color: userColor, name: username })); } catch {}

    if (!drawing) return;

    if (currentTool === "brush" || currentTool === "eraser") {
      const last = pointsBuffer[pointsBuffer.length - 1];
      drawLineOnCtx(ctx, last.x * canvas.width, last.y * canvas.height, pos.x * canvas.width, pos.y * canvas.height, color, strokeWidth, currentTool === "eraser");
      // broadcast segment for live remote rendering
      try { ws.send(JSON.stringify({ type: "draw-segment", from: last, to: pos, color, width: strokeWidth, eraser: currentTool === "eraser" })); } catch {}
      pointsBuffer.push(pos);
    } else if (currentTool === "rect" || currentTool === "circle") {
      // redraw base then draw preview on top, then broadcast shape-preview to others
      redrawAll();
      const preview = { kind: "shape", shapeType: currentTool, from: startPoint, to: pos, color, width: strokeWidth };
      drawShapeOnCtx(ctx, preview);
      try { ws.send(JSON.stringify({ type: "shape-preview", shape: preview })); } catch {}
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
      try { ws.send(JSON.stringify(freeStroke)); } catch {}
    } else if (currentTool === "rect" || currentTool === "circle") {
      const shapeStroke = { type: "stroke", kind: "shape", userId, shapeType: currentTool, from: startPoint, to: pos, color, width: strokeWidth };
      localHistory.push(shapeStroke);
      redrawAll();
      try { ws.send(JSON.stringify(shapeStroke)); } catch {}
    } else if (currentTool === "text") {
      const txt = prompt("Enter text:");
      if (txt) {
        const textObj = { type: "stroke", kind: "text", userId, text: txt, x: pos.x, y: pos.y, color, size: strokeWidth * 5 };
        localHistory.push(textObj);
        renderStrokeObject(textObj);
        try { ws.send(JSON.stringify(textObj)); } catch {}
      }
    }
  }

  // attach events
  // ---- MOUSE EVENTS ----
  canvas.addEventListener("mousedown", pointerDown);
  document.addEventListener("mousemove", pointerMove);
  document.addEventListener("mouseup", pointerUp);
  canvas.addEventListener("mouseleave", (e) => {
    // finalize shape if user drags outside
    if (drawing) pointerUp(e);
  });

  // ---- TOUCH EVENTS ----
  canvas.addEventListener("touchstart", (e) => { pointerDown(e); }, { passive: false });
  document.addEventListener("touchmove", (e) => { pointerMove(e); }, { passive: false });
  document.addEventListener("touchend", (e) => { pointerUp(e); }, { passive: false });
  document.addEventListener("touchcancel", (e) => { pointerUp(e); }, { passive: false });


  // ---- WebSocket ----
  const ws = new WebSocket(`ws://${window.location.host}`);
  ws.onopen = () => {
    try { ws.send(JSON.stringify({ type: "register", userId, color: userColor, name: username })); } catch {}
  };

  ws.onmessage = (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }
    switch (data.type) {
      case "draw-segment":
        drawLineOnCtx(ctx, data.from.x * canvas.width, data.from.y * canvas.height, data.to.x * canvas.width, data.to.y * canvas.height, data.color, data.width, data.eraser);
        break;

      case "shape-preview":
        // show preview from other user, but do NOT store
        redrawAll();
        if (data.shape) drawShapeOnCtx(ctx, data.shape);
        break;

      case "stroke":
        // server sends { type:'stroke', stroke: <obj> } OR stroke object directly
        const incoming = data.stroke || data;
        // normalize: if kind missing, infer
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
        // convert normalized coords to page coords for overlay positioning
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

      case "disconnect":
        delete cursors[data.userId];
        renderCursors();
        break;
    }
  };

  // notify server on close
  window.addEventListener("beforeunload", () => { try { ws.send(JSON.stringify({ type: "disconnect", userId })); } catch {} });
})();