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

// --- Local user info ---
const userId = "user-" + Math.random().toString(36).slice(2, 9);
const userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
let drawing = false;
let pointsBuffer = [];
let lastNorm = null;
let color = "#000000";
let strokeWidth = 3;
let eraser = false;

// --- UI controls ---
const colorInput = document.getElementById("color");
const widthInput = document.getElementById("width");
const eraserBtn = document.getElementById("eraser");
const clearBtn = document.getElementById("clear");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");

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

// --- Cursor overlay ---
const cursors = {};
const overlay = document.createElement("div");
overlay.style.position = "fixed";
overlay.style.top = "0";
overlay.style.left = "0";
overlay.style.width = "100vw";
overlay.style.height = "100vh";
overlay.style.pointerEvents = "none";
document.body.appendChild(overlay);

// --- Drawing helpers ---
function drawLine(x1, y1, x2, y2, color, width, eraserFlag) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = eraserFlag ? "destination-out" : "source-over";
  ctx.strokeStyle = eraserFlag ? "rgba(0,0,0,1)" : color;
  ctx.stroke();
  ctx.closePath();
}

function drawStroke(stroke) {
  const pts = stroke.points;
  if (!pts || pts.length < 2) return;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    drawLine(
      a.x * canvas.width,
      a.y * canvas.height,
      b.x * canvas.width,
      b.y * canvas.height,
      stroke.color,
      stroke.width,
      stroke.eraser
    );
  }
}

function redrawFromHistory(history = []) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of history) drawStroke(stroke);
}

// --- Mouse Events (stream + full stroke) ---
canvas.addEventListener("mousedown", (e) => {
  drawing = true;
  pointsBuffer = [];
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  pointsBuffer.push({ x: nx, y: ny });
  lastNorm = { x: nx, y: ny };
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;

  ws.send(JSON.stringify({ type: "cursor", userId, x: nx, y: ny, color: userColor }));

  if (!drawing) return;

  // Draw locally
  drawLine(lastNorm.x * canvas.width, lastNorm.y * canvas.height, nx * canvas.width, ny * canvas.height, color, strokeWidth, eraser);

  // 🔥 Real-time streaming
  ws.send(JSON.stringify({
    type: "draw-segment",
    from: lastNorm,
    to: { x: nx, y: ny },
    color,
    width: strokeWidth,
    eraser,
  }));

  // Save to buffer
  pointsBuffer.push({ x: nx, y: ny });
  lastNorm = { x: nx, y: ny };
});

function endStrokeAndSend() {
  if (!drawing) return;
  drawing = false;

  if (pointsBuffer.length < 2) return;

  const stroke = {
    type: "stroke",
    id: "s-" + Math.random().toString(36).slice(2, 9),
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

canvas.addEventListener("mouseup", endStrokeAndSend);
canvas.addEventListener("mouseleave", endStrokeAndSend);

// --- WebSocket message handling ---
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "draw-segment": {
      // real-time drawing from others
      const from = data.from, to = data.to;
      drawLine(from.x * canvas.width, from.y * canvas.height, to.x * canvas.width, to.y * canvas.height, data.color, data.width, data.eraser);
      break;
    }

    case "stroke": {
      // final stroke broadcast from others
      drawStroke(data.stroke);
      break;
    }

    case "cursor": {
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + data.x * rect.width;
      const cy = rect.top + data.y * rect.height;
      cursors[data.userId] = { x: cx, y: cy, color: data.color };
      renderCursors();
      break;
    }

    case "init":
    case "update-canvas": {
      redrawFromHistory(data.history || []);
      break;
    }

    case "clear": {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      break;
    }

    default:
      console.warn("⚠️ Unknown message:", data.type);
  }
};

// --- Render cursors ---
function renderCursors() {
  overlay.innerHTML = "";
  for (const [id, c] of Object.entries(cursors)) {
    if (id === userId) continue;
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
  }
}

window.addEventListener("resize", renderCursors);
window.addEventListener("beforeunload", () => {
  try { ws.send(JSON.stringify({ type: "disconnect", userId })); } catch {}
});