const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '..', 'client')));

function broadcastExceptSender(sender, message) {
  for (const client of wss.clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  console.log('🟢 New WebSocket connection');

  ws.on('message', (msg) => {
    const data = msg.toString();
    try {
      const parsed = JSON.parse(data);

      if (parsed.type === 'draw' || parsed.type === 'cursor') {
        broadcastExceptSender(ws, JSON.stringify(parsed));
      }
    } catch (err) {
      console.error('Invalid message:', data);
    }
  });

  ws.on('close', () => {
    console.log('🔴 Client disconnected');
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
