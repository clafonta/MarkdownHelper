/**
 * The document's undo/redo history, shared by the editor and the editable preview.
 *
 * Chromium keeps one native undo stack per page, but edits in the preview are written into the
 * textarea programmatically, and replaying native textarea steps after that corrupts the text.
 * So the app keeps its own history of source snapshots instead; Edit → Undo / Redo use it.
 *
 * record(text, selection, group): call after every change. Consecutive changes with the same
 * non-null group (e.g. 'editor-type') within `groupMs` become one undo step, like typing a word.
 * Pure (no DOM), unit-tested in Node.
 */
(function (root) {
  function createHistory({ limit = 300, groupMs = 1000, now = () => Date.now() } = {}) {
    let undoStack = [];
    let redoStack = [];
    let current = { text: '', selection: [0, 0] };
    let lastGroup = null;
    let lastTime = 0;

    return {
      reset(text, selection = [0, 0]) {
        undoStack = [];
        redoStack = [];
        current = { text, selection };
        lastGroup = null;
      },
      record(text, selection, group = null) {
        if (text === current.text) {
          current = { text, selection };
          return;
        }
        const t = now();
        const merge = group !== null && group === lastGroup && t - lastTime < groupMs;
        if (!merge) {
          undoStack.push(current);
          if (undoStack.length > limit) undoStack.shift();
        }
        redoStack = [];
        current = { text, selection };
        lastGroup = group;
        lastTime = t;
      },
      /** Ends the current typing group (the cursor moved, a tool ran …). */
      breakGroup() { lastGroup = null; },
      /** The state to go back to, or null. */
      undo() {
        if (!undoStack.length) return null;
        redoStack.push(current);
        current = undoStack.pop();
        lastGroup = null;
        return current;
      },
      redo() {
        if (!redoStack.length) return null;
        undoStack.push(current);
        current = redoStack.pop();
        lastGroup = null;
        return current;
      },
      get current() { return current; },
    };
  }

  const api = { createHistory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UndoHistory = api;
})(typeof window !== 'undefined' ? window : globalThis);
