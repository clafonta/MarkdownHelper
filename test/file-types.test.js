const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileInfo, fileKind, isSupported, extensionOf, EXTENSIONS, NAMES } = require('../src/file-types.js');

test('maps extensions to their preview kind, case-insensitively', () => {
  assert.equal(fileKind('/a/notes.md'), 'markdown');
  assert.equal(fileKind('/a/README.MARKDOWN'), 'markdown');
  assert.equal(fileKind('/a/todo.TXT'), 'text');
  assert.equal(fileKind('/a/index.html'), 'html');
  assert.equal(fileKind('C:\\site\\old.HTM'), 'html');
  assert.equal(fileKind('/a/data.csv'), 'csv');
  assert.equal(fileKind('/a/data.tsv'), 'tsv');
  assert.equal(fileKind('/a/package.json'), 'json');
  assert.equal(fileKind('/a/logo.svg'), 'svg');
  assert.equal(fileKind('/a/flow.mmd'), 'mermaid');
  assert.equal(fileKind('/a/flow.MERMAID'), 'mermaid');
  for (const p of ['/a/site.css', '/a/app.js', '/a/x.tsx', '/a/run.py', '/a/conf.yml', '/a/app.log']) {
    assert.equal(fileKind(p), 'code', p);
  }
});

test('labels and tab handling', () => {
  assert.deepEqual(fileInfo('/a/app.mjs'), { kind: 'code', label: 'JavaScript', tabs: false });
  assert.equal(fileInfo('/a/main.go').tabs, true);
  assert.equal(fileInfo('/a/data.tsv').tabs, true);
  assert.equal(fileInfo('/a/data.csv').tabs, false);
});

test('recognizes extensionless files by name (exact case)', () => {
  assert.deepEqual(fileInfo('/a/Makefile'), { kind: 'code', label: 'Makefile', tabs: true });
  assert.equal(fileKind('/a/Dockerfile'), 'code');
  assert.equal(fileKind('/a/.gitignore'), 'code');
  assert.equal(fileKind('/a/.env'), 'code');
  assert.equal(fileKind('/a/LICENSE'), 'text');
  assert.equal(fileKind('/a/license'), null);
});

test('an untitled document is Markdown', () => {
  assert.equal(fileKind(null), 'markdown');
  assert.equal(isSupported(null), false); // ...but there is no file to open
});

test('everything else is unsupported', () => {
  for (const p of ['/a/logo.png', '/a/doc.pdf', '/a/notes', '/a/.md', '/a/notes.md.bak', '/a/.bashrc', '/a/.DS_Store']) {
    assert.equal(fileKind(p), null, p);
    assert.equal(isSupported(p), false, p);
  }
});

test('extensionOf ignores dots in folder names and leading dots', () => {
  assert.equal(extensionOf('/my.folder/file'), '');
  assert.equal(extensionOf('/x/.bashrc'), '');
  assert.equal(extensionOf('/x/a.b.Md'), 'md');
});

test('scripts/mdh accepts exactly the same extensions and names', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'mdh'), 'utf8');
  const list = (name) => script.match(new RegExp(`^${name}="([^"]*)"`, 'm'))[1].split(/\s+/).sort();
  assert.deepEqual(list('EXTENSIONS'), [...EXTENSIONS].sort());
  assert.deepEqual(list('NAMES'), [...NAMES].sort());
});
