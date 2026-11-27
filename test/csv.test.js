const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDelimited, editDelimited, formatField } = require('../src/renderer/data-preview.js');
const { delimitedToMarkdown, markdownTableToCsv } = require('../src/renderer/tools.js');

test('parseDelimited reports each row\'s range and fields as written', () => {
  const text = 'a,"b,c"\r\n\n1,"say ""hi"""\n';
  const rows = parseDelimited(text, ',');
  assert.deepEqual(rows.map((r) => [text.slice(r.start, r.end), r.raws]), [
    ['a,"b,c"', ['a', '"b,c"']],
    ['1,"say ""hi"""', ['1', '"say ""hi"""']],
  ]);
});

test('formatField quotes only what needs it', () => {
  assert.equal(formatField('plain', ','), 'plain');
  assert.equal(formatField('a,b', ','), '"a,b"');
  assert.equal(formatField('say "hi"', ','), '"say ""hi"""');
  assert.equal(formatField('two\nlines', ','), '"two\nlines"');
  assert.equal(formatField('a\tb\nc', '\t'), 'a b c'); // TSV has no quoting
});

test('editDelimited: set a cell, keeping the other fields exactly as written', () => {
  const text = 'name,note\n"Ann","x, y"\nBob,z\n';
  assert.equal(editDelimited(text, ',', { type: 'set', row: 2, col: 1, value: 'a "b"' }), 'name,note\n"Ann","x, y"\nBob,"a ""b"""\n');
  assert.equal(editDelimited(text, ',', { type: 'set', row: 0, col: 2, value: 'new' }), 'name,note,new\n"Ann","x, y"\nBob,z\n');
  assert.equal(editDelimited('', ',', { type: 'set', row: 0, col: 0, value: 'first' }), 'first\n');
});

test('editDelimited: rows and columns', () => {
  const text = 'a,b\n1,2\n3,4\n';
  assert.equal(editDelimited(text, ',', { type: 'insert-row', at: 2 }), 'a,b\n1,2\n,\n3,4\n');
  assert.equal(editDelimited(text, ',', { type: 'delete-row', row: 1 }), 'a,b\n3,4\n');
  assert.equal(editDelimited(text, ',', { type: 'insert-col', at: 1 }), 'a,,b\n1,,2\n3,,4\n');
  assert.equal(editDelimited(text, ',', { type: 'delete-col', col: 0 }), 'b\n2\n4\n');
  assert.equal(editDelimited('a\tb\n1\t2\n', '\t', { type: 'insert-col', at: 2 }), 'a\tb\t\n1\t2\t\n');
});

test('CSV → Markdown table', () => {
  assert.equal(delimitedToMarkdown('Name,Note\nAnn,"a | b"\nBob,"two\nlines"\n', ','),
    '| Name | Note         |\n| ---- | ------------ |\n| Ann  | a \\| b       |\n| Bob  | two<br>lines |');
  assert.equal(delimitedToMarkdown('a\tb\n1\n', '\t'), '| a   | b   |\n| --- | --- |\n| 1   |     |');
  assert.equal(delimitedToMarkdown('', ','), '');
});

test('Markdown table → CSV (plain text, quoted where needed)', () => {
  const md = 'Intro\n\n| Name | Note |\n| --- | --- |\n| **Ann** | [site](https://x.y), *hi* |\n| Bob | a \\| b<br>c |\n';
  assert.equal(markdownTableToCsv(md, md.indexOf('Bob')), 'Name,Note\nAnn,"site, hi"\nBob,"a | b\nc"\n');
  assert.equal(markdownTableToCsv(md, 0), null);
});
