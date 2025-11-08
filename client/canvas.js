// --- WebSocket setup ---
const ws = new WebSocket(`ws://${window.location.host}`);
ws.onopen = () => console.log("✅ Connected to WebSocket server");

// --- Canvas setup ---
const canvas = document.getElementById("cvs");
const ctx = canvas.getContext("2d");

// Maintain consistent aspect ratio
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
const userId = "user-" + Math.random().toString(36).substring(2, 8);
const userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
let drawing = false;
let last = null;
let color = "#000000";
let width = 3;
let eraser = false;

// --- UI controls ---
const colorInput = document.getElementById("color");
const widthInput = document.getElementById("width");
const eraserBtn = document.getElementById("eraser");
const clearBtn = document.getElementById("clear");

colorInput.addEventListener("input", (e) => {
  color = e.target.value;
  eraser = false;
  eraserBtn.classList.remove("active");
});
widthInput.addEventListener("input", (e) => (width = +e.target.value));
eraserBtn.addEventListener("click", () => {
  eraser = !eraser;
  eraserBtn.classList.toggle("active", eraser);
});
clearBtn.addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ws.send(JSON.stringify({ type: "clear" }));
});

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

// --- Draw helper ---
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

// --- Mouse events ---
canvas.addEventListener("mousedown", (e) => {
  drawing = true;
  const rect = canvas.getBoundingClientRect();
  last = {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const normX = (e.clientX - rect.left) / rect.width;
  const normY = (e.clientY - rect.top) / rect.height;

  ws.send(
    JSON.stringify({
      type: "cursor",
      userId,
      x: normX,
      y: normY,
      color: userColor,
    })
  );

  if (!drawing) return;

  drawLine(
    last.x * canvas.width,
    last.y * canvas.height,
    normX * canvas.width,
    normY * canvas.height,
    color,
    width,
    eraser
  );

  ws.send(
    JSON.stringify({
      type: "draw",
      from: last,
      to: { x: normX, y: normY },
      color,
      width,
      eraser,
    })
  );

  last = { x: normX, y: normY };
});

canvas.addEventListener("mouseup", () => (drawing = false));
canvas.addEventListener("mouseleave", () => (drawing = false));

// --- Disconnect cleanup ---
window.addEventListener("beforeunload", () => {
  ws.send(JSON.stringify({ type: "disconnect", userId }));
});

// --- WebSocket message handling ---
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "draw": {
      const fromX = data.from.x * canvas.width;
      const fromY = data.from.y * canvas.height;
      const toX = data.to.x * canvas.width;
      const toY = data.to.y * canvas.height;
      drawLine(fromX, fromY, toX, toY, data.color, data.width, data.eraser);
      break;
    }

    case "cursor": {
      const rect = canvas.getBoundingClientRect();
      cursors[data.userId] = {
        // convert normalized coords to screen-space coords
        x: rect.left + data.x * rect.width,
        y: rect.top + data.y * rect.height,
        color: data.color,
      };
      renderCursors();
      break;
    }

    case "disconnect": {
      delete cursors[data.userId];
      renderCursors();
      break;
    }

    case "init": {
      (data.history || []).forEach((stroke) => {
        const fX = stroke.from.x * canvas.width;
        const fY = stroke.from.y * canvas.height;
        const tX = stroke.to.x * canvas.width;
        const tY = stroke.to.y * canvas.height;
        drawLine(fX, fY, tX, tY, stroke.color, stroke.width, stroke.eraser);
      });
      break;
    }

    case "clear": {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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

// --- Keep overlay aligned on resize ---
window.addEventListener("resize", () => renderCursors());