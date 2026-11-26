const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectLineEnding, normalizeLineEndings, withLineEnding, detectIndent,
} = require('../src/text-format.js');

test('detects the dominant line ending', () => {
  assert.equal(detectLineEnding('a\r\nb\r\nc'), '\r\n');
  assert.equal(detectLineEnding('a\nb\nc'), '\n');
  assert.equal(detectLineEnding('a\r\nb\nc\nd'), '\n');
  assert.equal(detectLineEnding('one line'), '\n');
});

test('round-trips a CRLF file through the editor unchanged', () => {
  const original = 'col1,col2\r\n1,2\r\n';
  const eol = detectLineEnding(original);
  const inEditor = normalizeLineEndings(original);
  assert.equal(inEditor, 'col1,col2\n1,2\n');
  assert.equal(withLineEnding(inEditor, eol), original);
});

test('LF files are written as-is', () => {
  assert.equal(withLineEnding('a\nb\n', '\n'), 'a\nb\n');
});

test('detects tab vs space indentation', () => {
  assert.equal(detectIndent('all:\n\tgo build\n\tgo test\n'), 'tab');
  assert.equal(detectIndent('def f():\n    return 1\n'), 'spaces');
  assert.equal(detectIndent('no indentation'), 'spaces');
  assert.equal(detectIndent('\ta\n  b\n  c'), 'spaces');
});
