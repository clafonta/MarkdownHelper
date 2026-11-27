const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistory } = require('../src/renderer/undo-history.js');

function setup() {
  let clock = 0;
  const history = createHistory({ groupMs: 1000, now: () => clock });
  history.reset('a', [1, 1]);
  return { history, tick: (ms) => { clock += ms; } };
}

test('undo and redo walk the snapshots', () => {
  const { history } = setup();
  history.record('ab', [2, 2]);
  history.record('abc', [3, 3]);
  assert.deepEqual(history.undo(), { text: 'ab', selection: [2, 2] });
  assert.deepEqual(history.undo(), { text: 'a', selection: [1, 1] });
  assert.equal(history.undo(), null);
  assert.equal(history.redo().text, 'ab');
  assert.equal(history.redo().text, 'abc');
  assert.equal(history.redo(), null);
});

test('typing in the same group within the time limit is one step', () => {
  const { history, tick } = setup();
  history.record('ab', [2, 2], 'type');
  tick(300);
  history.record('abc', [3, 3], 'type');
  tick(1500); // a pause starts a new step
  history.record('abcd', [4, 4], 'type');
  history.record('abcde', [5, 5], 'delete'); // a different kind of edit too
  assert.equal(history.undo().text, 'abcd');
  assert.equal(history.undo().text, 'abc');
  assert.equal(history.undo().text, 'a');
});

test('breakGroup, undo and a new change after undo', () => {
  const { history } = setup();
  history.record('ab', [2, 2], 'type');
  history.breakGroup();
  history.record('abc', [3, 3], 'type');
  assert.equal(history.undo().text, 'ab');
  history.record('abX', [3, 3], 'type'); // after an undo: new step, redo is gone
  assert.equal(history.redo(), null);
  assert.equal(history.undo().text, 'ab');
  assert.equal(history.undo().text, 'a');
});

test('recording the same text only updates the selection', () => {
  const { history } = setup();
  history.record('a', [0, 1]);
  assert.equal(history.undo(), null);
  assert.deepEqual(history.current.selection, [0, 1]);
});
