# 🎨 Real-Time Collaborative Drawing Canvas

A multi-user collaborative drawing app where multiple people can draw simultaneously on a shared canvas — with real-time updates, cursors, latency display, and global undo/redo.

## 🚀 Live Demo

**Deployed on Render:**  
👉 [https://collaborative-canvas.onrender.com](https://collaborative-canvas.onrender.com)

Create a new room:  
`https://collaborative-canvas.onrender.com/board.html?room=HELLO1&create=1`

Join the same room (from another tab or user):  
`https://collaborative-canvas.onrender.com/board.html?room=HELLO1`

## ⚙️ Setup Instructions

1. Clone the repository  
   ```bash
   git clone https://github.com/<your-username>/collaborative-canvas.git
   cd collaborative-canvas
   ```

2. Install dependencies  
   ```bash
   npm install
   ```

3. Run the server  
   ```bash
   npm start
   ```

4. Open your browser  
   Visit → [http://localhost:3000](http://localhost:3000)

## 🧩 Features

| Feature | Description |
|----------|--------------|
| 🖌 Brush & Eraser | Draw freely or erase existing strokes |
| 🎨 Colors & Widths | Choose stroke color and thickness |
| 🧑‍🤝‍🧑 Multi-user | See everyone drawing in real-time |
| 💬 Cursors | Live cursor name + color per user |
| ⏪ Undo / Redo | Works globally for all users |
| 📋 Room System | Each room is isolated by unique code |
| ⚡ Performance Panel | FPS + latency displayed bottom-right |
| 👥 User List | Live list of room participants |
| 📱 Touch Support | Works on mobile (finger = brush) |

## 🧮 How to Test (Multiple Users)

1. Open `http://localhost:3000` (or your Render link)
2. Create a new room  
   → Example: `/board.html?room=TEST1&create=1`
3. Copy the URL and open it in another browser/tab
4. Draw on one — you’ll see updates appear instantly in all tabs.

## ⚙️ Architecture Summary

- Frontend: Vanilla JavaScript + HTML5 Canvas  
- Backend: Node.js + Native WebSockets (`ws` package)  
- Server manages connected users, global history, undo/redo  
- Client handles drawing events and rendering

See full details → [`ARCHITECTURE.md`](ARCHITECTURE.md)

## ⚠️ Known Limitations

- No persistent storage (canvas resets on restart)
- Last-writer-wins conflict resolution
- Global undo/redo (not per-user)
- No authentication
- No compression of strokes

## 🕒 Time Spent

**~2.5 days total**
- Day 1 → Planning & Designing
- Day 2 & 3 → Code Implementation + deployment

## 👨‍💻 Author

**Akhil Raj**