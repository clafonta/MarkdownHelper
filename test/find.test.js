const test = require('node:test');
const assert = require('node:assert/strict');
const { findMatches, matchAfter, replaceMatches } = require('../src/renderer/find.js');

const texts = (text, matches) => matches.map(([s, e]) => text.slice(s, e));

test('finds plain text, ignoring case unless asked', () => {
  const text = 'Cat cat CAT concat';
  assert.deepEqual(texts(text, findMatches(text, 'cat')), ['Cat', 'cat', 'CAT', 'cat']);
  assert.deepEqual(findMatches(text, 'cat', { matchCase: true }), [[4, 7], [15, 18]]);
  assert.deepEqual(findMatches(text, ''), []);
});

test('special characters are literal, not a pattern', () => {
  const text = 'a.b a*b (x) [y] $1 a+b';
  assert.deepEqual(texts(text, findMatches(text, 'a.b')), ['a.b']);
  assert.deepEqual(texts(text, findMatches(text, '(x)')), ['(x)']);
  assert.deepEqual(texts(text, findMatches(text, '$1')), ['$1']);
  assert.deepEqual(texts(text, findMatches(text, 'a+b')), ['a+b']);
});

test('whole words', () => {
  const text = 'cat concat cat_x cat. Cat café-cat';
  assert.deepEqual(findMatches(text, 'cat', { wholeWord: true }).map(([s]) => s), [0, 17, 22, 31]);
  assert.deepEqual(texts('café cafés', findMatches('café cafés', 'café', { wholeWord: true })), ['café']);
});

test('matchAfter: next / previous from a position, wrapping around', () => {
  const m = [[0, 3], [10, 13], [20, 23]];
  assert.equal(matchAfter(m, 0), 0);
  assert.equal(matchAfter(m, 4), 1);
  assert.equal(matchAfter(m, 21), 0); // past the last: wraps to the first
  assert.equal(matchAfter(m, 15, true), 1);
  assert.equal(matchAfter(m, 2, true), 2); // before the first: wraps to the last
  assert.equal(matchAfter([], 5), -1);
});

test('replaceMatches', () => {
  const text = 'one two one';
  assert.equal(replaceMatches(text, findMatches(text, 'one'), '1'), '1 two 1');
  assert.equal(replaceMatches(text, findMatches(text, 'one'), '$&'), '$& two $&'); // literal
  assert.equal(replaceMatches(text, [], 'x'), text);
});
