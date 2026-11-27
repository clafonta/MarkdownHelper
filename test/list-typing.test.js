const test = require('node:test');
const assert = require('node:assert/strict');
const { continueList, indentLines } = require('../src/renderer/tools.js');

// « marks the cursor (or «…» a selection) in inputs and outputs; null = a plain newline / tab.
function run(fn, marked, ...args) {
  const start = marked.indexOf('«');
  const plain = marked.replace('«', '').replace('»', '');
  const end = marked.includes('»') ? marked.indexOf('»') - 1 : start;
  const r = fn(plain, start, end, ...args);
  if (!r) return null;
  return r.start === r.end
    ? `${r.text.slice(0, r.start)}«${r.text.slice(r.start)}`
    : `${r.text.slice(0, r.start)}«${r.text.slice(r.start, r.end)}»${r.text.slice(r.end)}`;
}
const enter = (marked) => run(continueList, marked);

test('Enter continues bullets with the same marker', () => {
  assert.equal(enter('- apple«'), '- apple\n- «');
  assert.equal(enter('* apple«'), '* apple\n* «');
  assert.equal(enter('+ apple«'), '+ apple\n+ «');
  assert.equal(enter('  - nested«'), '  - nested\n  - «');
});

test('Enter counts numbered items up and keeps the delimiter', () => {
  assert.equal(enter('1. one«'), '1. one\n2. «');
  assert.equal(enter('9) nine«'), '9) nine\n10) «');
});

test('Enter on a task item starts an unticked one', () => {
  assert.equal(enter('- [x] done«'), '- [x] done\n- [ ] «');
  assert.equal(enter('- [ ] todo«'), '- [ ] todo\n- [ ] «');
});

test('Enter in the middle of an item takes the rest along', () => {
  assert.equal(enter('- buy «milk'), '- buy\n- «milk');
  assert.equal(enter('- «milk'), '- \n- «milk'); // cursor right after the marker: an empty item above
  assert.equal(enter('1. ab«cd\n2. x'), '1. ab\n2. «cd\n3. x');
});

test('Enter on an empty item ends the list', () => {
  assert.equal(enter('- a\n- «'), '- a\n«');
  assert.equal(enter('- a\n-   «'), '- a\n«');
  assert.equal(enter('1. a\n2. «\n\nnext'), '1. a\n«\n\nnext');
  assert.equal(enter('- [ ] «'), '«');
  assert.equal(enter('  - «'), '«');
});

test('Enter continues quotes; an empty quote line ends the quote', () => {
  assert.equal(enter('> said«'), '> said\n> «');
  assert.equal(enter('> - item«'), '> - item\n> - «');
  assert.equal(enter('> - «'), '> «');
  assert.equal(enter('> a\n> «'), '> a\n«');
});

test('Enter is a plain newline elsewhere', () => {
  assert.equal(enter('plain text«'), null);
  assert.equal(enter('# Heading«'), null);
  assert.equal(enter('«- item'), null); // cursor before the marker
  assert.equal(enter('-« item'), null); // cursor inside the marker
  assert.equal(enter('```\n- not a list«\n```'), null);
  assert.equal(enter('-not a list«'), null);
});

test('Enter with a selection replaces it', () => {
  assert.equal(enter('- a«bc»d'), '- a\n- «d');
});

const tab = (marked, unit = '  ') => run(indentLines, marked, unit, false);
const shiftTab = (marked, unit = '  ') => run(indentLines, marked, unit, true);

test('Tab nests a list item under the text of the item above', () => {
  assert.equal(tab('- a\n- b«'), '- a\n  - b«');
  assert.equal(tab('- a\n- «b'), '- a\n  - «b'); // cursor anywhere on the item
  assert.equal(tab('1. a\n2. b«'), '1. a\n   1. b«'); // under "1. ": three spaces, a new sub-list
  assert.equal(tab('- [ ] a\n- [ ] b«'), '- [ ] a\n  - [ ] b«');
  assert.equal(tab('- a\n- b«', '\t'), '- a\n\t- b«');
  assert.equal(tab('- only«'), '  - only«'); // nothing above: one unit
});

test('Shift+Tab brings a nested item up to its parent level', () => {
  assert.equal(shiftTab('- a\n  - b«'), '- a\n- b«');
  assert.equal(shiftTab('1. a\n   1. b«'), '1. a\n2. b«');
  assert.equal(shiftTab('- a\n  - b\n    - c«'), '- a\n  - b\n  - c«');
  assert.equal(shiftTab('- top«'), '- top«'); // already at the top
});

test('Tab / Shift+Tab with several lines selected', () => {
  assert.equal(tab('«one\ntwo»'), '«  one\n  two»');
  assert.equal(shiftTab('«  one\n  two»'), '«one\ntwo»');
  assert.equal(shiftTab('«    one\n two»'), '«  one\ntwo»');
  assert.equal(tab('«one\n\ntwo»'), '«  one\n\n  two»'); // blank lines stay empty
  assert.equal(tab('- a\n«- b\n- c»'), '- a\n«  - b\n  - c»');
});

test('a plain Tab on an ordinary line is left to the caller; Shift+Tab outdents it', () => {
  assert.equal(tab('some« text'), null);
  assert.equal(shiftTab('    some« text'), '  some« text');
  assert.equal(shiftTab('\tsome« text', '\t'), 'some« text');
  assert.equal(shiftTab('no« indent'), 'no« indent');
});

test('Enter in a numbered list renumbers the items below', () => {
  assert.equal(enter('1. a\n2. b«\n3. c'), '1. a\n2. b\n3. «\n4. c');
  assert.equal(enter('8. a\n9. b«\n10. c'), '8. a\n9. b\n10. «\n11. c'); // numbers get wider
  assert.equal(enter('5. five\n6. six«'), '5. five\n6. six\n7. «'); // the start number is kept
  // nested lines and the other levels are left alone
  assert.equal(enter('1. a«\n   - x\n2. b\n\n3. c'), '1. a\n2. «\n   - x\n3. b\n\n4. c');
  assert.equal(enter('1. a\n   1. x«\n   2. y\n2. b'), '1. a\n   1. x\n   2. «\n   3. y\n2. b');
});

test('Tab / Shift+Tab renumber both levels', () => {
  assert.equal(tab('1. a\n2. b\n3. «c\n4. d'), '1. a\n2. b\n   1. «c\n3. d'); // a new sub-list starts at 1
  assert.equal(tab('1. a\n2. b\n   1. c\n3. «d'), '1. a\n2. b\n   1. c\n   2. «d'); // joins it as 2
  assert.equal(shiftTab('1. a\n   1. «b\n   2. c\n2. d'), '1. a\n2. «b\n   1. c\n3. d');
  assert.equal(shiftTab('1. a\n   1. b\n   2. «c\n2. d'), '1. a\n   1. b\n2. «c\n3. d');
});
