// server/drawing-state.js
function buildHistory(room) {
  return room.history
    .filter((op) => op.type !== "clear")
    .map((op) => op.data);
}

function handleUndoRedo(room, type) {
  if (type === "undo" && room.history.length > 0) {
    const last = room.history.pop();
    room.undone.push(last);
  } else if (type === "redo" && room.undone.length > 0) {
    const redo = room.undone.pop();
    room.history.push(redo);
  }
}

module.exports = { buildHistory, handleUndoRedo };