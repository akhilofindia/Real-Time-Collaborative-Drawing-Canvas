// client/canvas.js
// Drop-in replacement. Expects existing DOM:
// - <canvas id="cvs"></canvas>
// - Toolbar elements with ids: brush, eraser, rect, circle, text, clear, undo, redo
// - Inputs: color (type=color), width (type=range)
// - An element with id="roomCodeDisplay" to show room code (optional)

(() => {
  // --- username per-tab ---
  let username = sessionStorage.getItem("username");
  if (!username) {
    username = (prompt("Enter your name:") || "Anonymous").trim() || "Anonymous";
    sessionStorage.setItem("username", username);
  }

// parse create flag from URL (optional)
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room") || "default";
const createRoom = params.get("create") === "1"; // true only when creation requested

  // DOM
  const canvas = document.getElementById("cvs");
  if (!canvas) throw new Error("No canvas element with id 'cvs' found.");
  const ctx = canvas.getContext("2d");

  const roomDisplay = document.getElementById("roomCodeDisplay");
  if (roomDisplay) roomDisplay.textContent = `🟢 Room: ${roomId}`;

  // toolbar elements
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

  // state
  const userId = "user-" + Math.random().toString(36).slice(2, 8);
  const userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);

  let currentTool = "brush"; // brush | eraser | rect | circle | text
  let color = colorInput ? colorInput.value : "#000000";
  let strokeWidth = widthInput ? +widthInput.value : 3;
  let drawing = false;
  let startPoint = null; // normalized
  let pointsBuffer = []; // for freehand
  let localHistory = []; // committed strokes: objects
  let previewShape = null; // currently previewed shape from others
  const cursors = {}; // other users cursor data

  // overlay for cursors (use existing DOM layout; absolute over page)
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: 9999,
  });
  document.body.appendChild(overlay);

    // --- user panel (room-aware) ---
  const userPanel = document.createElement("div");
  Object.assign(userPanel.style, {
    position: "fixed",
    right: "20px",
    top: "20px",
    background: "rgba(255,255,255,0.95)",
    padding: "10px 14px",
    borderRadius: "12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    fontFamily: "sans-serif",
    fontSize: "14px",
    zIndex: 1200,
    minWidth: "160px",
    maxWidth: "240px",
  });
  document.body.appendChild(userPanel);

  function renderUserPanel(users) {
    if (!Array.isArray(users)) return;
    userPanel.innerHTML = `<strong>👥 Room Members (${users.length})</strong><br>`;
    users.forEach((u) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.marginTop = "4px";
      row.innerHTML = `
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;
                     background:${u.color};margin-right:8px;"></span>
        ${u.userId === userId ? `<strong>${u.name} (You)</strong>` : u.name}
      `;
      userPanel.appendChild(row);
    });
  }


  // resize logic (maintain aspect ratio and fit)
  const LOGICAL_W = 1000, LOGICAL_H = 700;
  function resizeCanvas() {
    const ratio = LOGICAL_W / LOGICAL_H;
    let w = Math.floor(window.innerWidth * 0.9);
    let h = Math.floor(w / ratio);
    if (h > Math.floor(window.innerHeight * 0.8)) {
      h = Math.floor(window.innerHeight * 0.8);
      w = Math.floor(h * ratio);
    }
    // Save image, resize, restore (avoids wipe)
    const saved = ctx.getImageData(0, 0, canvas.width || 1, canvas.height || 1);
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    try { ctx.putImageData(saved, 0, 0); } catch (e) { /* ignore */ }
    renderAll();
    renderCursors();
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // helpers: normalize positions
  function getRect() { return canvas.getBoundingClientRect(); }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function getNormPosFromEvent(e) {
    const r = getRect();
    let cx, cy;
    if (e.touches && e.touches.length) {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY;
    } else {
      cx = e.clientX; cy = e.clientY;
    }
    return {
      x: clamp01((cx - r.left) / r.width),
      y: clamp01((cy - r.top) / r.height),
    };
  }

  // drawing primitives
  function drawLineRaw(x1, y1, x2, y2, col, w, eraser) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.strokeStyle = eraser ? "rgba(0,0,0,1)" : col;
    ctx.stroke();
    ctx.closePath();
  }

  function drawStrokeObj(st) {
    if (!st) return;
    if (st.kind === "free") {
      const pts = st.points;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        drawLineRaw(a.x * canvas.width, a.y * canvas.height, b.x * canvas.width, b.y * canvas.height, st.color, st.width, st.eraser);
      }
    } else if (st.kind === "shape") {
      const sx = st.from.x * canvas.width, sy = st.from.y * canvas.height;
      const ex = st.to.x * canvas.width, ey = st.to.y * canvas.height;
      ctx.beginPath();
      ctx.lineWidth = st.width;
      ctx.strokeStyle = st.color;
      if (st.shapeType === "rect") ctx.rect(sx, sy, ex - sx, ey - sy);
      else {
        const r = Math.hypot(ex - sx, ey - sy);
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.closePath();
    } else if (st.kind === "text") {
      ctx.font = `${st.size || 20}px Arial`;
      ctx.fillStyle = st.color;
      ctx.fillText(st.text, st.x * canvas.width, st.y * canvas.height);
    }
  }

  function renderAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of localHistory) drawStrokeObj(s);
    if (previewShape) drawStrokeObj(previewShape);
  }

  // cursor rendering
  function renderCursors() {
    overlay.innerHTML = "";
    const r = getRect();
    Object.entries(cursors).forEach(([id, c]) => {
      if (id === userId) return;
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "absolute",
        left: `${c.pageX}px`,
        top: `${c.pageY}px`,
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
      });
      const dot = document.createElement("div");
      Object.assign(dot.style, {
        width: "10px",
        height: "10px",
        borderRadius: "50%",
        background: c.color,
        boxShadow: "0 0 2px rgba(0,0,0,0.3)"
      });
      const name = document.createElement("div");
      name.textContent = c.name || "User";
      name.style.fontSize = "12px";
      name.style.color = c.color;
      name.style.textShadow = "0 0 2px #fff";
      box.appendChild(dot);
      box.appendChild(name);
      overlay.appendChild(box);
    });
  }

  // toolbar wiring
  function setTool(tool) {
    currentTool = tool;
    [brushBtn, eraserBtn, rectBtn, circleBtn, textBtn].forEach(b => {
      if (!b) return;
      b.classList.toggle("active", b.id === tool);
    });
    // ensure color restored when turning off eraser
    if (currentTool !== "eraser") { /* nothing */ }
  }

  if (colorInput) colorInput.addEventListener("input", e => color = e.target.value);
  if (widthInput) widthInput.addEventListener("input", e => strokeWidth = +e.target.value);

  if (brushBtn) brushBtn.addEventListener("click", () => setTool("brush"));
  if (eraserBtn) eraserBtn.addEventListener("click", () => setTool(currentTool === "eraser" ? "brush" : "eraser"));
  if (rectBtn) rectBtn.addEventListener("click", () => setTool("rect"));
  if (circleBtn) circleBtn.addEventListener("click", () => setTool("circle"));
  if (textBtn) textBtn.addEventListener("click", () => setTool("text"));

  // --- WebSocket setup ---
  const ws = new WebSocket(`ws://${window.location.host}`);
  const safeSend = (o) => { try { ws.send(JSON.stringify(o)); } catch (e) { /* ignore */ } };

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({
      type: "register",
      userId,
      color: userColor,
      name: username,
      roomId,
      create: createRoom
    }));
  });

  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    // ⚠️ Handle "no-room" message right away
    if (msg.type === "no-room") {
        alert("Room does not exist: " + msg.roomId + "\nCreate it first or check the code.");
        // Optional redirect back to lobby (index.html)
        window.location.href = "/";
        return; // stop further processing
      }
    switch (msg.type) {
      case "draw-segment":
        // immediate segment from other user
        drawLineRaw(msg.from.x * canvas.width, msg.from.y * canvas.height, msg.to.x * canvas.width, msg.to.y * canvas.height, msg.color, msg.width, msg.eraser);
        break;

      case "shape-preview":
        // show preview from other user without storing
        previewShape = msg.shape || null;
        renderAll();
        break;

      case "stroke": {
        const incoming = msg.stroke || msg;
        if (!incoming.kind) {
          if (incoming.points) incoming.kind = "free";
          else if (incoming.shapeType) incoming.kind = "shape";
          else if (incoming.text) incoming.kind = "text";
        }
        localHistory.push(incoming);
        renderAll();
        break;
      }

      case "init":
      case "update-canvas":
        // msg.history = array of stroke objects (normalized)
        localHistory = (msg.history || []).map(s => {
          if (!s.kind) {
            if (s.points) s.kind = "free";
            else if (s.shapeType) s.kind = "shape";
            else if (s.text) s.kind = "text";
          }
          return s;
        });
        previewShape = null;
        renderAll();
        break;

      case "clear":
        localHistory = [];
        previewShape = null;
        renderAll();
        break;

      case "queue-status":
        if (undoBtn) undoBtn.disabled = msg.undo === 0;
        if (redoBtn) redoBtn.disabled = msg.redo === 0;
        break;

      case "cursor":
        // convert normalized coords to page coords for overlay placement
        const r = getRect();
        cursors[msg.userId] = {
          pageX: r.left + msg.x * r.width,
          pageY: r.top + msg.y * r.height,
          color: msg.color,
          name: msg.name
        };
        renderCursors();
        break;

      case "online-users":
        // Optional: update a user panel if you have one
        // ignore here
        renderUserPanel(msg.users || []);
        break;

      case "pong":
        // ignore ping here if not used
        break;

      case "disconnect":
        delete cursors[msg.userId];
        renderCursors();
        break;
    }
  });

  // pointer logic (unified mouse + touch). Use document move/up to avoid lost strokes.
  function startPointer(e) {
    e.preventDefault();
    drawing = true;
    pointsBuffer = [];
    startPoint = getNormPosFromEvent(e);
    pointsBuffer.push(startPoint);
  }

  function movePointer(e) {
    const pos = getNormPosFromEvent(e);

    // broadcast cursor normalized
    safeSend({ type: "cursor", userId, x: pos.x, y: pos.y, color: userColor, name: username, roomId });

    if (!drawing) return;

    if (currentTool === "brush" || currentTool === "eraser") {
      const last = pointsBuffer[pointsBuffer.length - 1];
      drawLineRaw(last.x * canvas.width, last.y * canvas.height, pos.x * canvas.width, pos.y * canvas.height, color, strokeWidth, currentTool === "eraser");
      // send segment for live remote rendering
      safeSend({ type: "draw-segment", from: last, to: pos, color, width: strokeWidth, eraser: currentTool === "eraser", roomId });
      pointsBuffer.push(pos);
    } else if (currentTool === "rect" || currentTool === "circle") {
      // create preview locally and send shape-preview to others
      previewShape = {
        type: "stroke",
        kind: "shape",
        shapeType: currentTool,
        from: startPoint,
        to: pos,
        color,
        width: strokeWidth
      };
      renderAll();
      safeSend({ type: "shape-preview", shape: previewShape, roomId });
    }
  }

  function endPointer(e) {
    const pos = getNormPosFromEvent(e);
    if (!drawing) return;
    drawing = false;

    if (currentTool === "brush" || currentTool === "eraser") {
      if (pointsBuffer.length >= 2) {
        const freeStroke = {
          type: "stroke",
          kind: "free",
          userId,
          color,
          width: strokeWidth,
          eraser: currentTool === "eraser",
          points: pointsBuffer.slice()
        };
        localHistory.push(freeStroke);
        safeSend(Object.assign({}, freeStroke, { roomId }));
      }
      pointsBuffer = [];
    } else if (currentTool === "rect" || currentTool === "circle") {
      const shapeStroke = {
        type: "stroke",
        kind: "shape",
        userId,
        shapeType: currentTool,
        from: startPoint,
        to: pos,
        color,
        width: strokeWidth
      };
      localHistory.push(shapeStroke);
      previewShape = null;
      renderAll();
      safeSend(Object.assign({}, shapeStroke, { roomId }));
    } else if (currentTool === "text") {
      const txt = prompt("Enter text:");
      if (txt) {
        const textObj = {
          type: "stroke",
          kind: "text",
          userId,
          text: txt,
          x: pos.x,
          y: pos.y,
          color,
          size: strokeWidth * 5
        };
        localHistory.push(textObj);
        renderAll();
        safeSend(Object.assign({}, textObj, { roomId }));
      }
    }
  }

  // attach listeners
  canvas.addEventListener("mousedown", startPointer);
  document.addEventListener("mousemove", movePointer);
  document.addEventListener("mouseup", endPointer);
  canvas.addEventListener("touchstart", (e) => { startPointer(e); }, { passive: false });
  document.addEventListener("touchmove", (e) => { movePointer(e); }, { passive: false });
  document.addEventListener("touchend", (e) => { endPointer(e); }, { passive: false });
  canvas.addEventListener("mouseleave", (e) => { if (drawing) endPointer(e); });
  document.addEventListener("touchcancel", (e) => { if (drawing) endPointer(e); });

  // clear / undo / redo wiring
  if (clearBtn) clearBtn.addEventListener("click", () => safeSend({ type: "clear", roomId }));
  if (undoBtn) undoBtn.addEventListener("click", () => safeSend({ type: "undo", roomId }));
  if (redoBtn) redoBtn.addEventListener("click", () => safeSend({ type: "redo", roomId }));

  // cleanup on page close
  window.addEventListener("beforeunload", () => {
    try { safeSend({ type: "disconnect", userId, roomId }); } catch {}
  });

  // expose some small API for debugging on window
  window.__scribble = {
    userId, userColor, roomId, getHistory: () => localHistory.slice()
  };

  // initial render
  renderAll();
  renderCursors();
})();