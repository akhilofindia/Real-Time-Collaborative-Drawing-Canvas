// --- WebSocket setup ---
const ws = new WebSocket(`ws://${window.location.host}`);
ws.onopen = () => console.log("✅ Connected to WebSocket server");

// --- Canvas setup ---
const canvas = document.getElementById("cvs");
const ctx = canvas.getContext("2d");

const LOGICAL_WIDTH = 1000;
const LOGICAL_HEIGHT = 700;

function setupCanvas() {
  const ratio = LOGICAL_WIDTH / LOGICAL_HEIGHT;
  let width = window.innerWidth * 0.9;
  let height = width / ratio;
  if (height > window.innerHeight * 0.8) {
    height = window.innerHeight * 0.8;
    width = height * ratio;
  }
  canvas.width = width;
  canvas.height = height;
}
setupCanvas();

// --- Local state ---
const userId = "user-" + Math.random().toString(36).slice(2, 8);
const userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
let drawing = false, lastNorm = null;
let color = "#000000", strokeWidth = 3, eraser = false;
let pointsBuffer = [];

// --- UI controls ---
const colorInput = document.getElementById("color");
const widthInput = document.getElementById("width");
const eraserBtn = document.getElementById("eraser");
const clearBtn = document.getElementById("clear");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");

function setButtonsState(undo, redo) {
  undoBtn.disabled = undo === 0;
  redoBtn.disabled = redo === 0;
}

colorInput.addEventListener("input", (e) => {
  color = e.target.value;
  eraser = false;
  eraserBtn.classList.remove("active");
});
widthInput.addEventListener("input", (e) => (strokeWidth = +e.target.value));
eraserBtn.addEventListener("click", () => {
  eraser = !eraser;
  eraserBtn.classList.toggle("active", eraser);
});
clearBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "clear" })));
undoBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "undo" })));
redoBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "redo" })));

// --- Cursor overlay (for other users) ---
const cursors = {};
const overlay = document.createElement("div");
overlay.id = "cursor-overlay";
overlay.style.position = "fixed";
overlay.style.top = "0";
overlay.style.left = "0";
overlay.style.width = "100vw";
overlay.style.height = "100vh";
overlay.style.pointerEvents = "none";
document.body.appendChild(overlay);

// --- Drawing helpers ---
function drawLine(x1, y1, x2, y2, color, width, eraser) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
  ctx.strokeStyle = eraser ? "rgba(0,0,0,1)" : color;
  ctx.stroke();
  ctx.closePath();
}

function drawStroke(stroke) {
  const pts = stroke.points;
  if (!pts || pts.length < 2) return;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    drawLine(a.x * canvas.width, a.y * canvas.height, b.x * canvas.width, b.y * canvas.height, stroke.color, stroke.width, stroke.eraser);
  }
}

function redrawFromHistory(history = []) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of history) drawStroke(s);
}

// --- Unified pointer logic (works for mouse + touch) ---
function getNormPos(e) {
  const rect = canvas.getBoundingClientRect();
  let x, y;

  if (e.touches && e.touches.length > 0) {
    x = e.touches[0].clientX - rect.left;
    y = e.touches[0].clientY - rect.top;
  } else {
    x = e.clientX - rect.left;
    y = e.clientY - rect.top;
  }

  return { x: x / rect.width, y: y / rect.height };
}

function startDraw(e) {
  e.preventDefault();
  drawing = true;
  pointsBuffer = [];

  const { x, y } = getNormPos(e);
  pointsBuffer.push({ x, y });
  lastNorm = { x, y };
}

function moveDraw(e) {
  const { x, y } = getNormPos(e);

  // Send cursor position for others
  ws.send(JSON.stringify({
    type: "cursor",
    userId,
    x,
    y,
    color: userColor
  }));

  if (!drawing) return;

  drawLine(lastNorm.x * canvas.width, lastNorm.y * canvas.height, x * canvas.width, y * canvas.height, color, strokeWidth, eraser);
  ws.send(JSON.stringify({ type: "draw-segment", from: lastNorm, to: { x, y }, color, width: strokeWidth, eraser }));
  pointsBuffer.push({ x, y });
  lastNorm = { x, y };
}

function endDraw() {
  if (!drawing) return;
  drawing = false;
  if (pointsBuffer.length < 2) return;

  const stroke = {
    type: "stroke",
    userId,
    color,
    width: strokeWidth,
    eraser,
    points: pointsBuffer,
    timestamp: Date.now(),
  };

  ws.send(JSON.stringify(stroke));
  pointsBuffer = [];
  lastNorm = null;
}

// --- Attach mouse events ---
canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", moveDraw);
canvas.addEventListener("mouseup", endDraw);
canvas.addEventListener("mouseleave", endDraw);

// --- Attach touch events (for phones/tablets) ---
canvas.addEventListener("touchstart", startDraw, { passive: false });
canvas.addEventListener("touchmove", moveDraw, { passive: false });
canvas.addEventListener("touchend", endDraw);
canvas.addEventListener("touchcancel", endDraw);

// --- WebSocket message handling ---
ws.onmessage = (e) => {
  const d = JSON.parse(e.data);
  switch (d.type) {
    case "draw-segment":
      drawLine(d.from.x * canvas.width, d.from.y * canvas.height, d.to.x * canvas.width, d.to.y * canvas.height, d.color, d.width, d.eraser);
      break;

    case "stroke":
      drawStroke(d.stroke);
      break;

    case "init":
    case "update-canvas":
      redrawFromHistory(d.history);
      break;

    case "clear":
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      break;

    case "queue-status":
      setButtonsState(d.undo, d.redo);
      break;

    case "cursor": {
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + d.x * rect.width;
      const cy = rect.top + d.y * rect.height;
      cursors[d.userId] = { x: cx, y: cy, color: d.color };
      renderCursors();
      break;
    }

    case "disconnect": {
      delete cursors[d.userId];
      renderCursors();
      break;
    }
  }
};

// --- Render cursors ---
function renderCursors() {
  overlay.innerHTML = "";
  Object.entries(cursors).forEach(([id, c]) => {
    if (id === userId) return;
    const dot = document.createElement("div");
    dot.style.position = "absolute";
    dot.style.left = `${c.x}px`;
    dot.style.top = `${c.y}px`;
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.background = c.color;
    dot.style.borderRadius = "50%";
    dot.style.boxShadow = "0 0 3px rgba(0,0,0,0.3)";
    dot.style.transform = "translate(-50%, -50%)";
    overlay.appendChild(dot);
  });
}

window.addEventListener("resize", renderCursors);
window.addEventListener("beforeunload", () => {
  try { ws.send(JSON.stringify({ type: "disconnect", userId })); } catch {}
});