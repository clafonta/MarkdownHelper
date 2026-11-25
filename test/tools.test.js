const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTables, removeNewlines } = require('../src/renderer/tools.js');

const GOOD = [
  '| Shortcut | Action |',
  '| -------- | ------ |',
  '| Cmd + Z  | Undo   |',
  '| Tab      | Indent |',
].join('\n');

test('splits rows that were merged onto one line (two lines)', () => {
  const bad = '| Shortcut | Action | | -------- | ------ |\n| Cmd + Z  | Undo   | | Tab      | Indent |';
  assert.equal(formatTables(bad), GOOD);
});

test('splits a whole table merged onto a single line', () => {
  const bad = '| Shortcut | Action | | -------- | ------ | | Cmd + Z  | Undo   | | Tab      | Indent |';
  assert.equal(formatTables(bad), GOOD);
});

test('aligns a valid but ragged table', () => {
  const ragged = '|Shortcut|Action|\n|-|-|\n|Cmd + Z|Undo|\n| Tab | Indent |';
  assert.equal(formatTables(ragged), GOOD);
});

test('is idempotent on a well-formatted table', () => {
  assert.equal(formatTables(GOOD), GOOD);
});

test('works without leading/trailing pipes and pads short rows', () => {
  const input = 'a | b | c\n--- | --- | ---\n1 | 2';
  assert.equal(formatTables(input), '| a   | b   | c   |\n| --- | --- | --- |\n| 1   | 2   |     |');
});

test('keeps legitimately empty cells', () => {
  const input = '| a | b |\n| --- | --- |\n|  | x |';
  assert.equal(formatTables(input), '| a   | b   |\n| --- | --- |\n|     | x   |');
});

test('preserves column alignment markers', () => {
  const input = '| Left | Center | Right |\n|:--|:-:|--:|\n| a | b | c |';
  assert.equal(formatTables(input), [
    '| Left | Center | Right |',
    '| :--- | :----: | ----: |',
    '| a    |   b    |     c |',
  ].join('\n'));
});

test('keeps escaped pipes inside cells', () => {
  const input = '| Expr | Meaning |\n| --- | --- |\n| a \\| b | or |';
  assert.equal(formatTables(input), '| Expr   | Meaning |\n| ------ | ------- |\n| a \\| b | or      |');
});

test('leaves surrounding text, code fences and non-tables untouched', () => {
  const input = [
    '# Title',
    'Some text with a | pipe.',
    '',
    '```',
    '|a|b|',
    '|-|-|',
    '```',
    '',
    '|x|y|',
    '|-|-|',
    '|1|2|',
    '',
    'After.',
  ].join('\n');
  const expected = input.replace('|x|y|\n|-|-|\n|1|2|', '| x   | y   |\n| --- | --- |\n| 1   | 2   |');
  assert.equal(formatTables(input), expected);
});

test('only reformats from the header row when a paragraph line precedes the table', () => {
  const input = 'intro | text\n| a | b |\n| --- | --- |\n| 1 | 2 |';
  assert.equal(formatTables(input), 'intro | text\n| a   | b   |\n| --- | --- |\n| 1   | 2   |');
});

test('formats multiple tables and keeps trailing newline', () => {
  const input = '|a|b|\n|-|-|\n\ntext\n\n|c|\n|-|\n';
  assert.equal(formatTables(input), '| a   | b   |\n| --- | --- |\n\ntext\n\n| c   |\n| --- |\n');
});

test('removeNewlines still joins paragraph lines', () => {
  assert.equal(removeNewlines('a\nb\n\nc\nd\n'), 'a b\n\nc d\n');
});

test('removeNewlines leaves tables, lists, code and headings alone', () => {
  const input = [
    '# Heading',
    'wrapped paragraph',
    'continues here',
    '',
    '- item one',
    '- item two',
    '  continued item',
    '1. first',
    '2. second',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```js',
    'const a = 1;',
    'const b = 2;',
    '```',
    '',
    '    indented code',
    '    more code',
    '',
    'last',
    'para',
    '',
  ].join('\n');
  const expected = input
    .replace('wrapped paragraph\ncontinues here', 'wrapped paragraph continues here')
    .replace('last\npara', 'last para');
  assert.equal(removeNewlines(input), expected);
});

test('removeNewlines joins blockquote paragraphs under one marker', () => {
  const input = '> Tip: select some text\n> to only join lines.\n\n> - a\n> - b';
  assert.equal(removeNewlines(input), '> Tip: select some text to only join lines.\n\n> - a\n> - b');
});

test('removeNewlines does not break a table directly after a paragraph', () => {
  const input = 'Intro line\nwraps\n| a | b |\n| --- | --- |\n| 1 | 2 |';
  assert.equal(removeNewlines(input), 'Intro line wraps\n| a | b |\n| --- | --- |\n| 1 | 2 |');
});

test('removeNewlines leaves the welcome document structure intact', () => {
  const doc = '## Features\n\n- Live preview\n- Dark mode\n\n```js\nconsole.log(1);\n```\n\n| Shortcut | Action |\n| -------- | ------ |\n| Cmd + Z  | Undo   |\n';
  assert.equal(removeNewlines(doc), doc);
});
