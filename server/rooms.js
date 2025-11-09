export class RoomCanvas {
  constructor({ roomId, username }) {
    this.roomId = roomId;
    this.username = username;
    this.userId = "user-" + Math.random().toString(36).slice(2, 8);
    this.userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
    this.localHistory = [];
    this.drawing = false;
    this.currentTool = "brush";
    this.pointsBuffer = [];
    this.ws = null;
    this.cursors = {};

    this.setupCanvas();
    this.setupToolbar();
    this.setupWebSocket();
  }

  setupCanvas() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "drawing-canvas";
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    const ratio = 1000 / 700;
    const fitCanvas = () => {
      let w = window.innerWidth * 0.9;
      let h = w / ratio;
      if (h > window.innerHeight * 0.8) {
        h = window.innerHeight * 0.8;
        w = h * ratio;
      }
      this.canvas.width = w;
      this.canvas.height = h;
      this.redrawAll();
    };
    fitCanvas();
    window.addEventListener("resize", fitCanvas);
  }

  setupToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.innerHTML = `
      <span class="room-display">🟢 Room: ${this.roomId}</span>
      <button id="brush">Brush</button>
      <button id="rect">Rect</button>
      <button id="circle">Circle</button>
      <button id="eraser">Eraser</button>
      <button id="clear">Clear</button>
      <button id="undo">Undo</button>
      <button id="redo">Redo</button>
    `;
    document.body.appendChild(toolbar);

    toolbar.querySelector("#brush").onclick = () => this.currentTool = "brush";
    toolbar.querySelector("#rect").onclick = () => this.currentTool = "rect";
    toolbar.querySelector("#circle").onclick = () => this.currentTool = "circle";
    toolbar.querySelector("#eraser").onclick = () => this.currentTool = "eraser";
    toolbar.querySelector("#clear").onclick = () => this.clearCanvas();
    toolbar.querySelector("#undo").onclick = () => this.ws.send(JSON.stringify({ type: "undo" }));
    toolbar.querySelector("#redo").onclick = () => this.ws.send(JSON.stringify({ type: "redo" }));

    this.canvas.addEventListener("mousedown", e => this.startDraw(e));
    this.canvas.addEventListener("mousemove", e => this.moveDraw(e));
    this.canvas.addEventListener("mouseup", e => this.endDraw(e));
  }

  setupWebSocket() {
    this.ws = new WebSocket(`ws://${window.location.host}`);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: "register",
        userId: this.userId,
        color: this.userColor,
        name: this.username,
        roomId: this.roomId
      }));
    };

    this.ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      switch (d.type) {
        case "init":
          this.localHistory = d.history || [];
          this.redrawAll();
          break;
        case "stroke":
          this.localHistory.push(d.stroke);
          this.renderStroke(d.stroke);
          break;
        case "update-canvas":
          this.localHistory = d.history || [];
          this.redrawAll();
          break;
        case "clear":
          this.localHistory = [];
          this.redrawAll();
          break;
      }
    };
  }

  getNormPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  }

  startDraw(e) {
    this.drawing = true;
    this.pointsBuffer = [this.getNormPos(e)];
  }

  moveDraw(e) {
    if (!this.drawing) return;
    const pos = this.getNormPos(e);
    const last = this.pointsBuffer[this.pointsBuffer.length - 1];
    const ctx = this.ctx;

    if (this.currentTool === "brush" || this.currentTool === "eraser") {
      ctx.beginPath();
      ctx.moveTo(last.x * this.canvas.width, last.y * this.canvas.height);
      ctx.lineTo(pos.x * this.canvas.width, pos.y * this.canvas.height);
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.currentTool === "eraser" ? "white" : this.userColor;
      ctx.stroke();
      this.pointsBuffer.push(pos);
    }
  }

  endDraw() {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.pointsBuffer.length < 2) return;

    const stroke = {
      type: "stroke",
      kind: "free",
      userId: this.userId,
      color: this.userColor,
      width: 3,
      points: this.pointsBuffer
    };
    this.localHistory.push(stroke);
    this.ws.send(JSON.stringify(stroke));
  }

  redrawAll() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.localHistory) this.renderStroke(s);
  }

  renderStroke(stroke) {
    const ctx = this.ctx;
    if (stroke.kind === "free") {
      for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i - 1], b = stroke.points[i];
        ctx.beginPath();
        ctx.moveTo(a.x * this.canvas.width, a.y * this.canvas.height);
        ctx.lineTo(b.x * this.canvas.width, b.y * this.canvas.height);
        ctx.lineWidth = stroke.width;
        ctx.strokeStyle = stroke.color;
        ctx.stroke();
      }
    }
  }

  clearCanvas() {
    this.ws.send(JSON.stringify({ type: "clear" }));
  }
}