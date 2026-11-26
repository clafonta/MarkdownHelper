const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDelimited, prettyJson, checkJson, parseJsonTree,
} = require('../src/renderer/data-preview.js');

const cells = (rows) => rows.map((r) => r.cells);

test('parses simple CSV with source lines', () => {
  const rows = parseDelimited('name,qty\napple,3\npear,10\n', ',');
  assert.deepEqual(cells(rows), [['name', 'qty'], ['apple', '3'], ['pear', '10']]);
  assert.deepEqual(rows.map((r) => r.line), [0, 1, 2]);
});

test('handles quoted fields: commas, escaped quotes, line breaks, empty quoted field', () => {
  const rows = parseDelimited('a,b,c\n"x, y","say ""hi""","line1\nline2"\n"",2,\nlast,row,here', ',');
  assert.deepEqual(cells(rows), [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'line1\nline2'],
    ['', '2', ''],
    ['last', 'row', 'here'],
  ]);
  assert.deepEqual(rows.map((r) => r.line), [0, 1, 3, 4]); // the quoted line break moves later rows down
});

test('skips blank lines and keeps ragged rows as-is', () => {
  assert.deepEqual(cells(parseDelimited('a,b\n\n1\n1,2,3\n', ',')), [['a', 'b'], ['1'], ['1', '2', '3']]);
});

test('TSV splits on tabs and treats quotes literally', () => {
  assert.deepEqual(cells(parseDelimited('a\tb\n"x\ty"\tz', '\t')), [['a', 'b'], ['"x', 'y"', 'z']]);
});

test('prettyJson re-indents but keeps literals exactly as written', () => {
  const src = '{"big":12345678901234567890,"f":1.0,"s":"a,{b}:\\"c\\"","e":[],"o":{},"l":[1,[2]]}';
  assert.equal(prettyJson(src), [
    '{',
    '  "big": 12345678901234567890,',
    '  "f": 1.0,',
    '  "s": "a,{b}:\\"c\\"",',
    '  "e": [],',
    '  "o": {},',
    '  "l": [',
    '    1,',
    '    [',
    '      2',
    '    ]',
    '  ]',
    '}',
  ].join('\n'));
});

test('checkJson: valid, empty, and errors with 1-based line/column', () => {
  assert.deepEqual(checkJson('[1, 2]'), { ok: true, pretty: '[\n  1,\n  2\n]' });
  assert.deepEqual(checkJson('  \n'), { ok: true, pretty: '' });

  const trailing = checkJson('{\n  "a": 1,\n}');
  assert.equal(trailing.ok, false);
  assert.deepEqual([trailing.line, trailing.column], [3, 1]);
  assert.doesNotMatch(trailing.message, /position/);

  // V8 gives no position for these; the locator finds it.
  const literal = checkJson('{"a":\n  tru}');
  assert.deepEqual([literal.line, literal.column], [2, 6]);
  assert.doesNotMatch(literal.message, /is not valid JSON/);

  // Longer input: V8 quotes a ...snippet... of it.
  const snippet = checkJson('{\n  "name": "mdh",\n  "tags": ["md", "json",],\n  "x": 1\n}\n');
  assert.equal(snippet.message, "Unexpected token ']'");
  assert.deepEqual([snippet.line, snippet.column], [3, 25]);

  const unterminated = checkJson('[1, 2');
  assert.deepEqual([unterminated.line, unterminated.column], [1, 6]);
});

test('parseJsonTree keeps literals as written and records source lines', () => {
  const src = '{\n  "big": 12345678901234567890,\n  "esc": "a\\"b",\n  "list": [\n    1.0,\n    true,\n    null\n  ],\n  "empty": {}\n}';
  const tree = parseJsonTree(src);
  assert.equal(tree.type, 'object');
  assert.deepEqual([tree.line, tree.endLine], [0, 9]);
  assert.deepEqual(tree.entries.map((e) => e.key), ['"big"', '"esc"', '"list"', '"empty"']);
  assert.deepEqual(tree.entries[0].value, { type: 'number', raw: '12345678901234567890', line: 1 });
  assert.deepEqual(tree.entries[1].value, { type: 'string', raw: '"a\\"b"', line: 2 });
  const list = tree.entries[2].value;
  assert.deepEqual([list.type, list.line, list.endLine], ['array', 3, 7]);
  assert.deepEqual(list.items.map((n) => [n.type, n.raw, n.line]), [['number', '1.0', 4], ['boolean', 'true', 5], ['null', 'null', 6]]);
  assert.deepEqual(tree.entries[3].value, { type: 'object', line: 8, endLine: 8, entries: [] });
});

test('parseJsonTree handles minified JSON and a bare value', () => {
  const tree = parseJsonTree('[{"a":[]},"x",-2e3]');
  assert.equal(tree.items.length, 3);
  assert.equal(tree.items[0].entries[0].value.type, 'array');
  assert.equal(tree.items[2].raw, '-2e3');
  assert.deepEqual(parseJsonTree('  42 '), { type: 'number', raw: '42', line: 0 });
});
