# 🧠 Architecture Overview – Real-Time Collaborative Drawing Canvas

This document explains the architecture, data flow, message protocol, and design decisions for the real-time collaborative drawing application.

## 🧭 High-Level Design

The app consists of a client (browser) and a Node.js WebSocket server.

```
Browser (Canvas UI) <—— WebSocket JSON Messages ——> Node.js Server (rooms.js)
```

## ⚙️ Data Flow Diagram

User A → Server → User B (and others) for all drawing events, using WebSocket broadcast.

## 🧩 WebSocket Protocol

| Type | Direction | Payload | Description |
|------|------------|----------|--------------|
| register | client → server | {userId,name,color,roomId,create} | Registers a user |
| draw-segment | both | {from,to,color,width,eraser} | Line segment data |
| shape-preview | both | {shape:{from,to,type}} | Preview shape |
| stroke | both | {points,color,...} | Committed drawing |
| cursor | both | {x,y,color,name} | Live cursor positions |
| clear | both | - | Clears canvas |
| undo / redo | client → server | - | Global undo/redo |
| update-canvas | server → clients | {history:[...]} | Updated full canvas |
| ping / pong | both | {sentAt} | Latency tracking |
| no-room | server → client | {roomId} | Invalid room alert |

## 🧮 Undo/Redo Strategy

Each room stores:
- `history[]`: All strokes
- `undone[]`: Stack for redo

Undo pops from history → undone  
Redo pops from undone → history  
Server rebroadcasts full history each time.

## ⚡ Performance Design

- Segment-based drawing for smooth real-time rendering  
- Local buffering (draw locally, sync remotely)  
- FPS and latency display via requestAnimationFrame  
- Room-level isolation to reduce cross-traffic

## 🧩 Conflict Resolution

- Simple “last-writer-wins” model  
- No pixel locking or CRDTs (can be future work)

## 📚 File Responsibilities

| File | Purpose |
|------|----------|
| client/canvas.js | Canvas rendering, tools, drawing logic |
| client/websocket.js | WebSocket connection & registration |
| client/main.js | Initializes user and room |
| server/server.js | Express + WebSocket setup |
| server/rooms.js | Room and broadcast logic |
| server/drawing-state.js | Undo/Redo and history management |

## 🧱 Future Improvements

- Persistent sessions (DB)  
- Replay system  
- Optimistic client-side rendering  
- CRDT-based merge logic