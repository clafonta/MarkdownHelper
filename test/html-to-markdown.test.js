const test = require('node:test');
const assert = require('node:assert/strict');
const { blocksToMarkdown, patchSource } = require('../src/renderer/html-to-markdown.js');
const { toggleEmphasis } = require('../src/renderer/tools.js');

// A minimal stand-in for DOM nodes: just what html-to-markdown.js reads.
function h(tag, attrs, ...children) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs: attrs || {},
    childNodes: children.map((c) => (typeof c === 'string' ? { nodeType: 3, nodeValue: c } : c)),
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
  };
  if (tag === 'input') node.checked = 'checked' in node.attrs;
  return node;
}
const md = (...nodes) => blocksToMarkdown(nodes);

test('paragraphs keep their soft line breaks and inline formatting', () => {
  assert.equal(md(h('p', null, 'one\ntwo ', h('strong', null, 'bold'), ' and ', h('em', null, 'it'))),
    'one\ntwo **bold** and *it*');
  assert.equal(md(h('p', null, 'a'), '\n', h('p', null, 'b')), 'a\n\nb');
});

test('Chromium bold/italic tags and styles become Markdown', () => {
  assert.equal(md(h('p', null, 'x ', h('b', null, 'y'), h('i', null, 'z'))), 'x **y***z*');
  assert.equal(md(h('p', null, h('span', { style: 'font-weight: 700;' }, 'w'))), '**w**');
  // adjacent pieces of the same style merge
  assert.equal(md(h('p', null, h('b', null, 'a'), h('b', null, 'b'))), '**ab**');
  // nested same style isn't doubled
  assert.equal(md(h('p', null, h('strong', null, 'a ', h('b', null, 'b')))), '**a b**');
});

test('spaces at the edges move outside the markers', () => {
  assert.equal(md(h('p', null, 'say', h('b', null, ' hello '), 'now')), 'say **hello** now');
  assert.equal(md(h('p', null, 'x', h('b', null, ' '), 'y')), 'x y');
});

test('typed Markdown characters are escaped so they show literally', () => {
  assert.equal(md(h('p', null, '2 * 3 = [x] `y` ~z~ <b> & &amp; snake_case _a_')),
    '2 \\* 3 = \\[x\\] \\`y\\` \\~z\\~ \\<b> & &amp;amp; snake_case \\_a\\_');
  assert.equal(md(h('p', null, '# not a heading\n- not a list\n1. no\n> no')),
    '\\# not a heading\n\\- not a list\n1\\. no\n\\> no');
  assert.equal(md(h('p', null, 'a\u00a0b')), 'a b');
});

test('headings, rules, quotes and code blocks', () => {
  assert.equal(md(h('h2', null, 'Title ', h('em', null, 'x'))), '## Title *x*');
  assert.equal(md(h('hr')), '---');
  assert.equal(md(h('blockquote', null, h('p', null, 'a\nb'), h('p', null, 'c'))), '> a\n> b\n>\n> c');
  assert.equal(md(h('pre', null, h('code', { class: 'language-js' }, 'let a;\n```\n'))), '````js\nlet a;\n```\n````');
  assert.equal(md(h('pre', null, h('code', null, 'a', h('br'), 'b'))), '```\na\nb\n```');
});

test('empty blocks disappear; a trailing <br> placeholder is ignored', () => {
  assert.equal(md(h('p', null, h('br'))), '');
  assert.equal(md(h('h1', null, '')), '');
  assert.equal(md(h('p', null, 'a', h('br'), 'b', h('br'))), 'a  \nb');
});

test('inline code, links, images', () => {
  assert.equal(md(h('p', null, h('code', null, 'a`b'))), '``a`b``');
  assert.equal(md(h('p', null, h('a', { href: 'https://x.y/a b' }, 'go *now*'))), '[go \\*now\\*](<https://x.y/a b>)');
  assert.equal(md(h('p', null, h('a', { href: 'https://x.y', title: 'T' }, 'x'))), '[x](https://x.y "T")');
  assert.equal(md(h('p', null, h('a', { href: 'https://x.y' }, 'https://x.y'))), 'https://x.y');
  assert.equal(md(h('p', null, h('a', { href: 'mailto:a@b.c' }, 'a@b.c'))), 'a@b.c');
  assert.equal(md(h('p', null, h('img', { src: 'p.png', alt: 'pic' }))), '![pic](p.png)');
  assert.equal(md(h('p', null, h('kbd', null, 'Cmd'), '+B')), '<kbd>Cmd</kbd>+B');
});

test('lists: bullets, numbering, nesting, task items, loose items', () => {
  const ul = h('ul', null, '\n', h('li', null, 'a'), '\n', h('li', null, 'b\n', h('ul', null, h('li', null, 'c'))), '\n');
  assert.equal(md(ul), '- a\n- b\n  - c');
  assert.equal(blocksToMarkdown([h('ul', null, h('li', null, 'a'), h('li', null, 'b'))], { bullet: '*' }), '* a\n* b');
  assert.equal(md(h('ol', { start: '3' }, h('li', null, 'x'), h('li', null, 'y'))), '3. x\n4. y');
  const tasks = h('ul', null,
    h('li', null, h('input', { type: 'checkbox', disabled: '' }), ' todo'),
    h('li', null, h('input', { type: 'checkbox', checked: '' }), ' done'));
  assert.equal(md(tasks), '- [ ] todo\n- [x] done');
  assert.equal(md(h('ul', null, h('li', null, h('p', null, 'a')), h('li', null, h('p', null, 'b')))), '- a\n\n- b');
  // Enter at the end of a list makes an empty item
  assert.equal(md(h('ul', null, h('li', null, 'a'), h('li', null, h('br')))), '- a\n-');
});

test('tables come out aligned, with escaped pipes and column alignment', () => {
  const table = h('table', null,
    h('thead', null, h('tr', null, h('th', { align: 'left' }, 'Name'), h('th', { align: 'right' }, 'n'))),
    h('tbody', null, h('tr', null, h('td', null, 'a | b'), h('td', null, h('b', null, '1')))));
  assert.equal(md(table), '| Name   |     n |\n| :----- | ----: |\n| a \\| b | **1** |');
});

test('rawOf passes non-editable blocks (diagrams, HTML) through unchanged', () => {
  const diagram = h('div', { class: 'mermaid-diagram' }, h('img', { src: 'data:...' }));
  const out = blocksToMarkdown([h('p', null, 'a'), diagram], { rawOf: (n) => (n === diagram ? '```mermaid\nA-->B\n```' : undefined) });
  assert.equal(out, 'a\n\n```mermaid\nA-->B\n```');
});

test('patchSource keeps the user\'s own Markdown where the edit did not touch it', () => {
  // _em_ written with underscores, edit after it
  assert.equal(patchSource('a _b_ c', 'a *b* c', 'a *b* cd'), 'a _b_ cd');
  // edit before it
  assert.equal(patchSource('a _b_ c', 'a *b* c', 'xa *b* c'), 'xa _b_ c');
  // * bullets
  assert.equal(patchSource('* one\n* two', '- one\n- two', '- one\n- twos'), '* one\n* twos');
  // differences on both sides of the edit: patch just that line
  assert.equal(patchSource('* a\n* b\n* c', '- a\n- b\n- c', '- a\n- bb\n- c'), '* a\n* bb\n* c');
  // identical canonical form: just the new text
  assert.equal(patchSource('a', 'a', 'b'), 'b');
  // nothing changed
  assert.equal(patchSource('__x__', '**x**', '**x**'), '__x__');
  // edit right inside a mismatch: fall back to the canonical Markdown
  assert.equal(patchSource('__x__', '**x**', '**xy**'), '**xy**');
});

// ---------- toggleEmphasis (editor Cmd+B / Cmd+I) ----------

const toggle = (text, style) => {
  // « and » mark the selection
  const start = text.indexOf('«');
  const end = text.indexOf('»') - 1;
  const r = toggleEmphasis(text.replace('«', '').replace('»', ''), start, end, style);
  return `${r.text.slice(0, r.start)}«${r.text.slice(r.start, r.end)}»${r.text.slice(r.end)}`;
};

test('toggleEmphasis wraps and unwraps', () => {
  assert.equal(toggle('a «word» b', 'bold'), 'a **«word»** b');
  assert.equal(toggle('a **«word»** b', 'bold'), 'a «word» b');
  assert.equal(toggle('a «**word**» b', 'bold'), 'a «word» b');
  assert.equal(toggle('a __«word»__ b', 'bold'), 'a «word» b');
  assert.equal(toggle('a «word» b', 'italic'), 'a *«word»* b');
  assert.equal(toggle('a *«word»* b', 'italic'), 'a «word» b');
  assert.equal(toggle('a _«word»_ b', 'italic'), 'a «word» b');
});

test('toggleEmphasis: bold and italic combine', () => {
  assert.equal(toggle('**«w»**', 'italic'), '***«w»***');
  assert.equal(toggle('***«w»***', 'italic'), '**«w»**');
  assert.equal(toggle('***«w»***', 'bold'), '*«w»*');
  assert.equal(toggle('*«w»*', 'bold'), '***«w»***');
});

test('toggleEmphasis keeps spaces and line-start markers outside', () => {
  assert.equal(toggle('«say hi »now', 'bold'), '**«say hi»** now');
  assert.equal(toggle('«- one\n- [ ] two\n\n## three»', 'bold'), '«- **one**\n- [ ] **two**\n\n## **three**»');
  assert.equal(toggle('«- **one**\n- **two**»', 'bold'), '«- one\n- two»');
});

test('toggleEmphasis with no selection inserts a pair', () => {
  const r = toggleEmphasis('ab', 1, 1, 'bold');
  assert.deepEqual(r, { text: 'a****b', start: 3, end: 3 });
});
