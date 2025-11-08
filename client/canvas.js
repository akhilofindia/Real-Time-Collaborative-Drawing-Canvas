// --- WebSocket setup ---
const ws = new WebSocket(`ws://${window.location.host}`);
ws.onopen = () => console.log("✅ Connected to WebSocket server");

// --- Canvas setup ---
const canvas = document.getElementById("cvs");
const ctx = canvas.getContext("2d");

// Maintain aspect ratio and fixed canvas size per session
const LOGICAL_WIDTH = 1000;
const LOGICAL_HEIGHT = 700;

function setupCanvas() {
  const ratio = LOGICAL_WIDTH / LOGICAL_HEIGHT;
  let width = Math.floor(window.innerWidth * 0.9);
  let height = Math.floor(width / ratio);
  if (height > Math.floor(window.innerHeight * 0.8)) {
    height = Math.floor(window.innerHeight * 0.8);
    width = Math.floor(height * ratio);
  }
  canvas.width = width;
  canvas.height = height;
}
setupCanvas();

// --- Local user info ---
const userId = "user-" + Math.random().toString(36).slice(2, 9);
const userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);

// --- UI controls ---
const colorInput = document.getElementById("color");
const widthInput = document.getElementById("width");
const eraserBtn = document.getElementById("eraser");
const clearBtn = document.getElementById("clear");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");

let drawing = false;
let pointsBuffer = []; // buffer points for current stroke (normalized)
let lastNorm = null;
let color = "#000000";
let strokeWidth = 3;
let eraser = false;

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

// Undo / Redo buttons send commands to server
undoBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "undo" })));
redoBtn.addEventListener("click", () => ws.send(JSON.stringify({ type: "redo" })));

// --- Cursor overlay (canvas-relative mapping on render) ---
const cursors = {};
const overlay = document.createElement("div");
overlay.style.position = "fixed";
overlay.style.top = "0";
overlay.style.left = "0";
overlay.style.width = "100vw";
overlay.style.height = "100vh";
overlay.style.pointerEvents = "none";
document.body.appendChild(overlay);

// --- Draw helper ---
function drawLine(x1, y1, x2, y2, color, w, eraserFlag) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = eraserFlag ? "destination-out" : "source-over";
  ctx.strokeStyle = eraserFlag ? "rgba(0,0,0,1)" : color;
  ctx.stroke();
  ctx.closePath();
}

// --- Draw a whole stroke object (array of normalized points) ---
function drawStroke(stroke) {
  const pts = stroke.points; // array of {x:normalized, y:normalized}
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

// --- Redraw full history ---
function redrawFromHistory(history = []) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of history) drawStroke(stroke);
}

// --- Mouse events: buffer points, draw locally, send stroke on mouseup ---
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

  // Send cursor with normalized coords
  ws.send(JSON.stringify({ type: "cursor", userId, x: nx, y: ny, color: userColor }));

  if (!drawing) return;

  // only push if moved enough to reduce point spam (simple threshold)
  const dx = nx - lastNorm.x;
  const dy = ny - lastNorm.y;
  if (Math.hypot(dx, dy) < 0.001) return;

  pointsBuffer.push({ x: nx, y: ny });

  // draw locally immediately (scaled to canvas)
  drawLine(lastNorm.x * canvas.width, lastNorm.y * canvas.height, nx * canvas.width, ny * canvas.height, color, strokeWidth, eraser);

  lastNorm = { x: nx, y: ny };
});

function endStrokeAndSend() {
  if (!drawing) return;
  drawing = false;
  if (pointsBuffer.length < 2) {
    pointsBuffer = [];
    return;
  }

  // Build stroke object
  const stroke = {
    type: "stroke",
    id: "s-" + Math.random().toString(36).slice(2, 9), // op id
    userId,
    color,
    width: strokeWidth,
    eraser,
    points: pointsBuffer, // normalized points
    timestamp: Date.now(),
  };

  // send whole stroke to server
  ws.send(JSON.stringify(stroke));
  // server will broadcast to others; we already drew locally
  pointsBuffer = [];
  lastNorm = null;
}

canvas.addEventListener("mouseup", endStrokeAndSend);
canvas.addEventListener("mouseleave", endStrokeAndSend);

// --- Handle incoming messages ---
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "stroke": {
      // a new stroke from another user
      if (data.stroke) {
        drawStroke(data.stroke);
      } else {
        // backward compat: some servers might send stroke inline
        drawStroke(data);
      }
      break;
    }

    case "cursor": {
      // store normalized coords; convert to canvas pixels for rendering
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + data.x * rect.width;
      const cy = rect.top + data.y * rect.height;
      cursors[data.userId] = { x: cx, y: cy, color: data.color };
      renderCursors();
      break;
    }

    case "clear": {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      break;
    }

    case "init":
    case "update-canvas": {
      // server sends full history array as `history`
      const history = data.history || [];
      redrawFromHistory(history);
      break;
    }

    case "disconnect": {
      delete cursors[data.userId];
      renderCursors();
      break;
    }

    default:
      console.warn("Unknown message type:", data.type);
  }
};

// --- Render cursors (screen-space) ---
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

// Keep cursors aligned on resize
window.addEventListener("resize", () => renderCursors());

// --- on unload, inform others ---
window.addEventListener("beforeunload", () => {
  try { ws.send(JSON.stringify({ type: "disconnect", userId })); } catch {}
});