const test = require('node:test');
const assert = require('node:assert/strict');
const { changedRanges } = require('../src/renderer/text-diff.js');

const marked = (oldText, newText) => changedRanges(oldText, newText).map(([s, e]) => newText.slice(s, e));

test('bold in a paragraph: the two markers', () => {
  assert.deepEqual(marked('a word b', 'a **word** b'), ['**', '**']);
});

test('heading: just the # prefix', () => {
  assert.deepEqual(marked('x\n\nTitle\n\ny', 'x\n\n# Title\n\ny'), ['# ']);
});

test('bold in a table cell: markers only, not the re-padding', () => {
  const before = '| Item   | Qty |\n| ------ | --: |\n| Apples |   3 |\n| Pears  |  12 |';
  const after = '| Item       | Qty |\n| ---------- | --: |\n| **Apples** |   3 |\n| Pears      |  12 |';
  assert.deepEqual(marked(before, after), ['**', '**']);
});

test('an inserted row is one whole line; a blank padded row counts', () => {
  const before = '| a | b |\n| --- | --- |\n| 1 | 2 |';
  const after = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
  assert.deepEqual(marked(before, after), ['| 3 | 4 |']);
  assert.deepEqual(marked(before, '| a | b |\n| --- | --- |\n|   |   |\n| 1 | 2 |'), ['|   |   |']);
});

test('column alignment shows the colon', () => {
  assert.deepEqual(marked('| a |\n| --- |\n| 1 |', '| a |\n| :-: |\n| 1 |'), [':', ':']);
});

test('pure removal: nothing to show', () => {
  assert.deepEqual(changedRanges('a **b** c', 'a b c'), []);
  assert.deepEqual(changedRanges('same', 'same'), []);
});
