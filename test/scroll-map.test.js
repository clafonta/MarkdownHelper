const test = require('node:test');
const assert = require('node:assert/strict');
const { marked } = require('marked');
const { tokenStartLines, createScrollMap, interpolate } = require('../src/renderer/scroll-map.js');

test('token raw text covers the source exactly, so line numbers are exact', () => {
  const src = '# Title\n\nPara one\nwraps\n\n- a\n- b\n\n```js\ncode\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> quote\n';
  const tokens = marked.lexer(src);
  assert.equal(tokens.map((t) => t.raw).join(''), src);
  const starts = tokenStartLines(tokens);
  const byType = Object.fromEntries(tokens.map((t, i) => [t.type, starts[i]]).filter(([t]) => t !== 'space'));
  assert.deepEqual(byType, { heading: 0, paragraph: 2, list: 5, code: 8, table: 12, blockquote: 16 });
});

test('createScrollMap is bounded and drops non-monotonic anchors', () => {
  // [200, 250] goes backwards in the preview; [900, 50] is past the editor's max scroll.
  const map = createScrollMap([[300, 600], [100, 300], [200, 250], [900, 50]], 500, 1000);
  assert.deepEqual(map, [[0, 0], [100, 300], [300, 600], [500, 1000]]);
  for (let i = 1; i < map.length; i += 1) {
    assert.ok(map[i][0] > map[i - 1][0] && map[i][1] > map[i - 1][1]);
  }
});

test('createScrollMap with nothing to scroll on one side', () => {
  assert.deepEqual(createScrollMap([[10, 10]], 0, 500), [[0, 0]]);
});

test('interpolate maps both directions and clamps at the ends', () => {
  const map = [[0, 0], [100, 300], [300, 600], [500, 1000]];
  assert.equal(interpolate(map, 50, 0), 150);
  assert.equal(interpolate(map, 200, 0), 450);
  assert.equal(interpolate(map, 450, 1), 200);
  assert.equal(interpolate(map, -5, 0), 0);
  assert.equal(interpolate(map, 9999, 0), 1000);
  assert.equal(interpolate([[0, 0]], 42, 0), 0);
});
