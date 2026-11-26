// Builds the sidebar's file tree for an opened folder (main process; Node only).
const fs = require('node:fs/promises');
const path = require('node:path');
const { isSupported } = require('./file-types');

const SKIP_DIRS = new Set(['node_modules']);
const MAX_DEPTH = 8;
const MAX_FILES = 5000;

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Returns { name, path, children, truncated } for `root`: folders first, then files, each sorted
 * naturally. Every file is listed; `supported` says whether the app can open it (the sidebar greys
 * out the rest). Hidden folders, node_modules and hidden files it can't open are left out.
 * `truncated` is set if MAX_FILES was hit.
 */
async function scanFolder(root) {
  const state = { files: 0, truncated: false };

  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return []; // unreadable subfolder: show it empty
    }
    const folders = [];
    const files = [];
    for (const entry of entries) {
      const hidden = entry.name.startsWith('.');
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!hidden && !SKIP_DIRS.has(entry.name)) folders.push({ name: entry.name, path: full });
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const supported = isSupported(entry.name);
        // Hidden files only show when we can open them (.gitignore, .env), not .DS_Store & co.
        if (!hidden || supported) files.push({ name: entry.name, path: full, type: 'file', supported });
      }
    }
    files.sort(byName);
    folders.sort(byName);

    const result = [];
    for (const folder of folders) {
      if (state.truncated) break;
      const children = depth < MAX_DEPTH ? await walk(folder.path, depth + 1) : [];
      result.push({ ...folder, type: 'dir', children });
    }
    for (const file of files) {
      if (state.files >= MAX_FILES) { state.truncated = true; break; }
      state.files += 1;
      result.push(file);
    }
    return result;
  }

  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`${root} is not a folder`);
  const children = await walk(root, 0);
  return { name: path.basename(root) || root, path: root, children, truncated: state.truncated };
}

module.exports = { scanFolder };
