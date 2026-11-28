const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clampScale, fitScale, clampPan, fitView, zoomAt, panBy, MIN_SCALE, MAX_SCALE,
} = require('../src/renderer/zoom-view.js');

const viewport = { width: 1000, height: 600 };

test('fitScale fits the limiting side, minus padding', () => {
  assert.equal(fitScale({ width: 1808, height: 200 }, viewport, 48), 0.5); // width limits
  assert.equal(fitScale({ width: 200, height: 1008 }, viewport, 48), 0.5); // height limits
});

test('fitScale does not blow small diagrams up beyond 2×', () => {
  assert.equal(fitScale({ width: 50, height: 50 }, viewport), 2);
});

test('clampScale keeps the scale within limits', () => {
  assert.equal(clampScale(0.001), MIN_SCALE);
  assert.equal(clampScale(100), MAX_SCALE);
  assert.equal(clampScale(1.5), 1.5);
});

test('fitView centers the content', () => {
  const content = { width: 400, height: 100 };
  const view = fitView(content, viewport, 0);
  assert.equal(view.scale, 2);
  assert.deepEqual(view, { scale: 2, x: 100, y: 200 });
});

test('clampPan centers along an axis where the content is smaller than the viewport', () => {
  const view = clampPan({ scale: 1, x: -300, y: 999 }, { width: 2000, height: 200 }, viewport);
  assert.equal(view.y, 200); // centered vertically
  assert.equal(view.x, -300); // free horizontally, within bounds
});

test('clampPan leaves no empty space at the edges of a large picture', () => {
  const content = { width: 2000, height: 2000 };
  assert.deepEqual(clampPan({ scale: 1, x: 50, y: 50 }, content, viewport), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(clampPan({ scale: 1, x: -5000, y: -5000 }, content, viewport), { scale: 1, x: -1000, y: -1400 });
});

test('zoomAt keeps the point under the cursor in place', () => {
  const content = { width: 2000, height: 2000 };
  const view = { scale: 1, x: -500, y: -500 };
  const point = { x: 300, y: 200 };
  const before = { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
  const next = zoomAt(view, 2, point, content, viewport);
  assert.equal(next.scale, 2);
  assert.deepEqual({ x: (point.x - next.x) / next.scale, y: (point.y - next.y) / next.scale }, before);
});

test('zoomAt clamps the scale', () => {
  const next = zoomAt({ scale: 1, x: 0, y: 0 }, 50, { x: 0, y: 0 }, { width: 100, height: 100 }, viewport);
  assert.equal(next.scale, MAX_SCALE);
});

test('panBy moves within the limits', () => {
  const content = { width: 2000, height: 2000 };
  assert.deepEqual(panBy({ scale: 1, x: -100, y: -100 }, -50, 30, content, viewport), { scale: 1, x: -150, y: -70 });
  assert.deepEqual(panBy({ scale: 1, x: -100, y: -100 }, 500, 500, content, viewport), { scale: 1, x: 0, y: 0 });
});
