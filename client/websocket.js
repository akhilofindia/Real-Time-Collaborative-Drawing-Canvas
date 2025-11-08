// client/websocket.js
const socket = io();


function joinRoom(roomId, userName) {
socket.emit('join', { roomId, userName });
}


function sendStroke(op) {
socket.emit('stroke', op);
}


function sendCursor(c) {
socket.emit('cursor', c);
}


function sendUndo(payload) {
socket.emit('undo', payload);
}


function sendRedo(payload) {
socket.emit('redo', payload);
}


// expose
window.collabSocket = {
socket,
joinRoom,
sendStroke,
sendCursor,
sendUndo,
sendRedo
};