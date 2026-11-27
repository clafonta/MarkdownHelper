const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toggleInline, inlineStylesAt, blockTypeAt, setBlockType, tableAt, tableEdit,
} = require('../src/renderer/tools.js');

// « and » mark the selection (or one « for a cursor) in inputs and outputs.
function run(fn, marked, ...args) {
  const start = marked.indexOf('«');
  const plain = marked.replace('«', '').replace('»', '');
  const end = marked.includes('»') ? marked.indexOf('»') - 1 : start;
  const r = fn(plain, start, end, ...args);
  return r.start === r.end
    ? `${r.text.slice(0, r.start)}«${r.text.slice(r.start)}`
    : `${r.text.slice(0, r.start)}«${r.text.slice(r.start, r.end)}»${r.text.slice(r.end)}`;
}

test('toggleInline: strikethrough and inline code wrap and unwrap', () => {
  assert.equal(run(toggleInline, 'a «b» c', 'strike'), 'a ~~«b»~~ c');
  assert.equal(run(toggleInline, 'a ~~«b»~~ c', 'strike'), 'a «b» c');
  assert.equal(run(toggleInline, 'a «b» c', 'code'), 'a `«b»` c');
  assert.equal(run(toggleInline, 'a `«b»` c', 'code'), 'a «b» c');
  assert.equal(run(toggleInline, '«- one\n- two»', 'code'), '«- `one`\n- `two`»');
});

test('inlineStylesAt finds the styles around the cursor or selection', () => {
  const text = 'a **bold** and *it* and ~~gone~~ and `x()` end';
  const at = (word) => inlineStylesAt(text, text.indexOf(word), text.indexOf(word) + word.length);
  assert.deepEqual(at('bold'), { bold: true, italic: false, strike: false, code: false });
  assert.deepEqual(at('it'), { bold: false, italic: true, strike: false, code: false });
  assert.deepEqual(at('gone'), { bold: false, italic: false, strike: true, code: false });
  assert.deepEqual(at('x()'), { bold: false, italic: false, strike: false, code: true });
  assert.deepEqual(at('end'), { bold: false, italic: false, strike: false, code: false });
  assert.equal(inlineStylesAt('snake_case_name', 6, 10).italic, false);
});

test('blockTypeAt', () => {
  const doc = '# H\n\n### H3\n\npara\n\n- a\n1. b\n\n> q\n\n```\ncode\n```\n\n| a | b |\n| - | - |';
  const at = (s) => blockTypeAt(doc, doc.indexOf(s));
  assert.equal(at('# H'), 'h1');
  assert.equal(at('### H3'), 'h3');
  assert.equal(at('para'), 'p');
  assert.equal(at('- a'), 'ul');
  assert.equal(at('1. b'), 'ol');
  assert.equal(at('> q'), 'blockquote');
  assert.equal(at('code'), 'pre');
  assert.equal(at('| a'), 'table');
});

test('setBlockType: headings, lists, quotes, code blocks, and back', () => {
  assert.equal(run(setBlockType, 'x\n\nTi«tle\n\ny', 'h2'), 'x\n\n## Title«\n\ny');
  assert.equal(run(setBlockType, '## Ti«tle', 'h2'), 'Title«'); // same type again = off
  assert.equal(run(setBlockType, '## Ti«tle', 'h1'), '# Title«');
  // no selection: the whole wrapped paragraph
  assert.equal(run(setBlockType, 'one\ntw«o\n\nnext', 'h1'), '# one two«\n\nnext');
  assert.equal(run(setBlockType, '«one\ntwo»', 'ul'), '«- one\n- two»');
  assert.equal(run(setBlockType, '«- one\n- two»', 'ol'), '«1. one\n2. two»');
  assert.equal(run(setBlockType, '«1. one\n2. two»', 'ol'), '«one\ntwo»');
  assert.equal(run(setBlockType, '«one\n\ntwo»', 'blockquote'), '«> one\n>\n> two»');
  assert.equal(run(setBlockType, '«> one\n> two»', 'p'), '«one\ntwo»');
  assert.equal(run(setBlockType, 'a\n\nle«t x = 1;\n\nb', 'pre'), 'a\n\n```\nlet x = 1;\n```«\n\nb');
  // in a code block: the whole fence; Code Block again = plain text
  assert.equal(run(setBlockType, '```js\nle«t x;\nf();\n```', 'pre'), 'let x;\nf();«');
  assert.equal(run(setBlockType, '```\nle«t x;\n```', 'ul'), '- let x;«');
});

const TABLE = '| Item   | Qty |\n| ------ | --: |\n| Apples |   3 |\n| Pears  |  12 |';

test('tableAt: row, column, alignment', () => {
  const t = tableAt(`x\n\n${TABLE}`, `x\n\n${TABLE}`.indexOf('12'));
  assert.equal(t.row, 2);
  assert.equal(t.column, 1);
  assert.equal(t.align, 'right');
  assert.equal(t.header, false);
  assert.equal(tableAt(TABLE, 2).header, true);
  assert.equal(tableAt('no table', 0), null);
});

test('tableEdit: rows', () => {
  const at = (word) => TABLE.indexOf(word);
  const edit = (word, cmd) => {
    const r = tableEdit(TABLE, at(word), cmd);
    return `${r.text.slice(0, r.start)}«${r.text.slice(r.start)}`;
  };
  assert.equal(edit('Apples', 'table-row-below'),
    '| Item   | Qty |\n| ------ | --: |\n| Apples |   3 |\n| «       |     |\n| Pears  |  12 |');
  assert.equal(edit('Apples', 'table-row-above'),
    '| Item   | Qty |\n| ------ | --: |\n| «       |     |\n| Apples |   3 |\n| Pears  |  12 |');
  // above the header: a new empty header, the old one becomes a row
  assert.equal(edit('Item', 'table-row-above'),
    '| «       |     |\n| ------ | --: |\n| Item   | Qty |\n| Apples |   3 |\n| Pears  |  12 |');
  assert.equal(edit('Apples', 'table-delete-row'), // the column gets narrower again
    '| Item  | Qty |\n| ----- | --: |\n| Pears« |  12 |');
  // deleting the header: the next row becomes the header
  assert.equal(edit('Item', 'table-delete-row'),
    '| Apples« |   3 |\n| ------ | --: |\n| Pears  |  12 |');
});

test('tableEdit: columns, alignment, delete table', () => {
  const r1 = tableEdit(TABLE, TABLE.indexOf('Apples'), 'table-col-right');
  assert.equal(r1.text, '| Item   |     | Qty |\n| ------ | --- | --: |\n| Apples |     |   3 |\n| Pears  |     |  12 |');
  assert.equal(`${r1.text.slice(0, r1.start)}«${r1.text.slice(r1.start)}`.split('\n')[2], '| Apples | «    |   3 |'); // cursor in the new cell
  const r2 = tableEdit(TABLE, TABLE.indexOf('3'), 'table-delete-col');
  assert.equal(r2.text, '| Item   |\n| ------ |\n| Apples |\n| Pears  |');
  const r3 = tableEdit(TABLE, TABLE.indexOf('Apples'), 'table-align-center');
  assert.equal(r3.text.split('\n')[1], '| :----: | --: |');
  const r4 = tableEdit(TABLE, TABLE.indexOf('3'), 'table-align-right'); // again = none
  assert.equal(r4.text.split('\n')[1], '| ------ | --- |');
  const doc = `Before\n\n${TABLE}\n\nAfter\n`;
  const r5 = tableEdit(doc, doc.indexOf('Pears'), 'table-delete');
  assert.equal(r5.text, 'Before\n\nAfter\n');
  assert.equal(tableEdit('plain', 0, 'table-delete'), null);
});
