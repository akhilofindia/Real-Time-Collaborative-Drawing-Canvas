// server/drawing-state.js
// Simple op-log based drawing state. In-memory only.
const { v4: uuidv4 } = require('uuid');


class DrawingState {
constructor() {
this.opLog = []; // array of ops (ordered)
this.tombstones = new Set(); // opIds that are undone
this.sequence = 0;
}


appendOp(op) {
const serverOp = Object.assign({}, op);
serverOp.serverSeq = ++this.sequence;
serverOp.opId = op.opId || uuidv4();
serverOp.ts = Date.now();


if (serverOp.type === 'undo') {
// mark target as tombstoned by appending undo op
this.opLog.push(serverOp);
this.tombstones.add(serverOp.targetOpId || serverOp.target);
} else if (serverOp.type === 'redo') {
this.opLog.push(serverOp);
if (serverOp.targetOpId) this.tombstones.delete(serverOp.targetOpId);
} else {
// drawing op
serverOp.type = serverOp.type || 'draw';
this.opLog.push(serverOp);
}


return serverOp;
}


getOpLog() {
return this.opLog;
}
}


module.exports = DrawingState;