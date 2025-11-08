// --- WebSocket setup ---
const ws = new WebSocket(`ws://${window.location.host}`);
ws.onopen = () => console.log('✅ Connected to WebSocket server');

// --- Canvas setup ---
const canvas = document.getElementById('cvs');
const ctx = canvas.getContext('2d');

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

// --- Local user state ---
const userId = 'user-' + Math.random().toString(36).substring(2, 8);
const userColor = '#' + Math.floor(Math.random() * 16777215).toString(16);
let drawing = false;
let last = null;
let color = '#000000';
let width = 3;
let eraser = false;

// --- UI controls ---
const colorInput = document.getElementById('color');
const widthInput = document.getElementById('width');
const eraserBtn = document.getElementById('eraser');

colorInput.addEventListener('input', (e) => {
  color = e.target.value;
  eraser = false;
  eraserBtn.classList.remove('active');
});

widthInput.addEventListener('input', (e) => (width = +e.target.value));

eraserBtn.addEventListener('click', () => {
  eraser = !eraser;
  eraserBtn.classList.toggle('active', eraser);
});

// --- Track others' cursors ---
const cursors = {}; // userId -> {x, y, color}
const overlay = document.createElement('div');
overlay.id = 'cursor-overlay';
overlay.style.position = 'fixed';
overlay.style.top = '0';
overlay.style.left = '0';
overlay.style.width = '100%';
overlay.style.height = '100%';
overlay.style.pointerEvents = 'none';
document.body.appendChild(overlay);

// --- Drawing functions ---
function drawLine(x1, y1, x2, y2, color, width, eraser) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  if (eraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
  }
  ctx.stroke();
  ctx.closePath();
}

// --- Drawing listeners ---
canvas.addEventListener('mousedown', (e) => {
  drawing = true;
  const rect = canvas.getBoundingClientRect();
  last = { x: e.clientX - rect.left, y: e.clientY - rect.top };
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Send cursor position in **absolute screen coordinates**
  const absX = e.clientX;
  const absY = e.clientY;

  ws.send(
    JSON.stringify({
      type: 'cursor',
      userId,
      x: absX,
      y: absY,
      color: userColor,
    })
  );

  if (!drawing) return;

  drawLine(last.x, last.y, x, y, color, width, eraser);

  ws.send(
    JSON.stringify({
      type: 'draw',
      from: last,
      to: { x, y },
      color,
      width,
      eraser,
    })
  );

  last = { x, y };
});

canvas.addEventListener('mouseup', () => (drawing = false));
canvas.addEventListener('mouseleave', () => (drawing = false));

// --- Message handling ---
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'draw') {
    const { from, to, color, width, eraser } = data;
    drawLine(from.x, from.y, to.x, to.y, color, width, eraser);
  }

  if (data.type === 'cursor') {
    cursors[data.userId] = {
      x: data.x,
      y: data.y,
      color: data.color,
    };
    renderCursors();
  }
};

// --- Render cursors overlay ---
function renderCursors() {
  overlay.innerHTML = '';
  Object.entries(cursors).forEach(([id, c]) => {
    if (id === userId) return; // don't show our own cursor

    const dot = document.createElement('div');
    dot.style.position = 'absolute';
    dot.style.left = `${c.x}px`; // screen-space coords
    dot.style.top = `${c.y}px`;
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.background = c.color;
    dot.style.borderRadius = '50%';
    dot.style.boxShadow = '0 0 3px rgba(0,0,0,0.3)';
    dot.style.transform = 'translate(-50%, -50%)';
    overlay.appendChild(dot);
  });
}
