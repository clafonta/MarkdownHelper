const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanFolder } = require('../src/folder-scan.js');

function makeTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdh-scan-'));
  for (const rel of spec) {
    const full = path.join(root, rel);
    if (rel.endsWith('/')) fs.mkdirSync(full, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
  }
  return root;
}

// Compact view of the tree: "dir/" with children nested; unsupported files shown as "(name)".
const shape = (nodes) => nodes.map((n) => {
  if (n.type === 'dir') return { [`${n.name}/`]: shape(n.children) };
  return n.supported ? n.name : `(${n.name})`;
});

test('lists every file, flags the unsupported ones; folders first, natural sort', async () => {
  const root = makeTree([
    'b.md', 'a.TXT', 'notes10.md', 'notes2.md', 'image.png', 'script.js', 'page.html', 'site.css', 'doc.pdf',
    'docs/guide.md', 'docs/pic.jpg', 'images/logo.png',
  ]);
  const tree = await scanFolder(root);
  assert.equal(tree.name, path.basename(root));
  assert.equal(tree.truncated, false);
  assert.deepEqual(shape(tree.children), [
    { 'docs/': ['guide.md', '(pic.jpg)'] },
    { 'images/': ['(logo.png)'] },
    'a.TXT', 'b.md', '(doc.pdf)', '(image.png)', 'notes2.md', 'notes10.md', 'page.html', 'script.js', 'site.css',
  ]);
});

test('skips hidden folders, node_modules and hidden files it cannot open; keeps empty folders', async () => {
  const root = makeTree([
    '.git/HEAD', '.DS_Store', '.bashrc', '.gitignore', '.env', 'node_modules/pkg/README.md',
    'empty/', 'deep/er/note.txt', 'keep.md',
  ]);
  const tree = await scanFolder(root);
  assert.deepEqual(shape(tree.children), [
    { 'deep/': [{ 'er/': ['note.txt'] }] },
    { 'empty/': [] },
    '.env', '.gitignore', 'keep.md',
  ]);
});

test('returns absolute paths', async () => {
  const root = makeTree(['sub/x.md']);
  const tree = await scanFolder(root);
  assert.equal(tree.children[0].children[0].path, path.join(root, 'sub', 'x.md'));
});

test('rejects a path that is not a folder', async () => {
  const root = makeTree(['file.md']);
  await assert.rejects(scanFolder(path.join(root, 'file.md')), /not a folder/);
});
