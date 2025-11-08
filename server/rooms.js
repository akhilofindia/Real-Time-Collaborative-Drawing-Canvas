const DrawingState = require('./drawing-state');


class Rooms {
constructor() {
this.rooms = new Map();
}


_ensure(roomId) {
if (!this.rooms.has(roomId)) {
this.rooms.set(roomId, { users: [], state: new DrawingState(), opLog: [] });
}
return this.rooms.get(roomId);
}


addUser(roomId, user) {
const r = this._ensure(roomId);
r.users = r.users.filter(u => u.id !== user.id);
r.users.push(user);
}


removeUserFromAll(userId) {
for (const [id, r] of this.rooms) {
r.users = r.users.filter(u => u.id !== userId);
}
}


getRoom(roomId) {
return this._ensure(roomId);
}


appendOp(roomId, op) {
const r = this._ensure(roomId);
const serverOp = r.state.appendOp(op);
r.opLog = r.state.getOpLog();
return serverOp;
}


getAllUsers() {
const users = [];
for (const r of this.rooms.values()) {
users.push(...r.users);
}
return users;
}
}


module.exports = Rooms;