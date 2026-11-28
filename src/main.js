const {
  app, BrowserWindow, ClipboardItem, Menu, clipboard, dialog, ipcMain, nativeTheme, shell,
} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { scanFolder } = require('./folder-scan');
const { DIALOG_FILTERS, extensionOf, isSupported } = require('./file-types');
const { detectLineEnding, normalizeLineEndings, withLineEnding } = require('./text-format');

const isMac = process.platform === 'darwin';
const MIN_WIDTH = 720;
const MIN_WIDTH_WITH_SIDEBAR = 960; // file sidebar + both panes at their minimum widths
const MIN_HEIGHT = 480;

// Per-window document state: { filePath, dirty, closeConfirmed }
const docState = new WeakMap();
// Windows whose page has finished loading. webContents.isLoading() isn't usable for this: it's
// also true while any sub-frame (the HTML preview iframe) loads, after did-finish-load has fired.
const loadedWindows = new WeakSet();
let quitting = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Markdown Helper',
    // Let our own global header act as the title bar (traffic lights inset on macOS).
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  docState.set(win, { filePath: null, dirty: false, closeConfirmed: false });
  win.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) loadedWindows.delete(win);
  });
  win.webContents.on('did-finish-load', () => loadedWindows.add(win));

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links clicked in the preview open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // Unsaved changes: let the renderer run its save/discard/cancel flow first.
  win.on('close', (event) => {
    const state = docState.get(win);
    if (!state.dirty || state.closeConfirmed) return;
    event.preventDefault();
    win.webContents.send('app:request-close');
  });

  return win;
}

// ---------- File operations (all disk access lives in the main process) ----------

const MAX_FILE_BYTES = 20 * 1024 * 1024; // the editor is a plain textarea; huge logs make it crawl

// Returns { filePath, content, eol }: content always uses \n (as the textarea does); `eol` is the
// file's own line ending, handed back on save so a Windows (CRLF) file stays CRLF.
async function readDocument(filePath) {
  if (!isSupported(filePath)) {
    const ext = extensionOf(filePath);
    throw new Error(ext ? `Markdown Helper can't open .${ext} files.` : "Markdown Helper can't open this type of file.");
  }
  const { size } = await fs.stat(filePath);
  if (size > MAX_FILE_BYTES) {
    throw new Error(`${path.basename(filePath)} is ${(size / 1048576).toFixed(0)} MB; Markdown Helper opens files up to 20 MB.`);
  }
  const raw = await fs.readFile(filePath, 'utf8');
  app.addRecentDocument(filePath);
  return { filePath, content: normalizeLineEndings(raw), eol: detectLineEnding(raw) };
}

ipcMain.handle('file:open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: DIALOG_FILTERS,
  });
  if (canceled || !filePaths.length) return null;
  return readDocument(filePaths[0]);
});

ipcMain.handle('file:open-path', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return null;
  return readDocument(filePath);
});

ipcMain.handle('file:save', async (event, { filePath, content, saveAs, defaultDir, eol }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  let target = saveAs ? null : filePath;
  if (!target) {
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
      // New documents default to the folder shown in the sidebar, if any.
      defaultPath: filePath
        || (typeof defaultDir === 'string' && defaultDir ? path.join(defaultDir, 'Untitled.md') : 'Untitled.md'),
      filters: DIALOG_FILTERS,
    });
    if (canceled || !chosen) return null;
    target = chosen;
  }
  await fs.writeFile(target, withLineEnding(content, eol), 'utf8');
  app.addRecentDocument(target);
  return { filePath: target };
});

// ---------- Folders (sidebar) ----------

// Room for the sidebar next to both panes; grow the window if it's currently narrower.
function setSidebarLayout(win, visible) {
  const minWidth = visible ? MIN_WIDTH_WITH_SIDEBAR : MIN_WIDTH;
  win.setMinimumSize(minWidth, MIN_HEIGHT);
  const [width, height] = win.getSize();
  if (width < minWidth) win.setSize(minWidth, height);
}

// The folder each window's sidebar shows: sidebar file operations must stay inside it.
const folderRoots = new WeakMap();

async function listFolder(win, folderPath) {
  const tree = await scanFolder(folderPath);
  setSidebarLayout(win, true);
  app.addRecentDocument(folderPath);
  folderRoots.set(win, tree.path);
  return tree;
}

ipcMain.handle('folder:open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return null;
  return listFolder(win, filePaths[0]);
});

ipcMain.handle('folder:list', async (event, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath) return null;
  return listFolder(BrowserWindow.fromWebContents(event.sender), folderPath);
});

ipcMain.handle('path:is-folder', async (_event, p) => {
  if (typeof p !== 'string' || !p) return false;
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
});

ipcMain.on('folder:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) setSidebarLayout(win, false);
  if (win) folderRoots.delete(win);
});

// ---------- Sidebar file operations (right-click menu in the folder sidebar) ----------

/** `p` resolved, if it's inside (or, with allowRoot, is) the sender window's open folder. */
function inOpenFolder(event, p, { allowRoot = false } = {}) {
  const root = folderRoots.get(BrowserWindow.fromWebContents(event.sender));
  if (!root || typeof p !== 'string' || !p) throw new Error('No folder is open.');
  const resolved = path.resolve(p);
  const rel = path.relative(root, resolved);
  if (rel === '' ? !allowRoot : (rel.startsWith('..') || path.isAbsolute(rel))) {
    throw new Error('That is outside the open folder.');
  }
  return resolved;
}

/** A single file or folder name: not empty, no slashes, not . or .. */
function checkName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/:]/.test(trimmed)) {
    throw new Error('Please enter a name without slashes or colons.');
  }
  return trimmed;
}

const exists = (p) => fs.access(p).then(() => true, () => false);

// New file or folder `name` inside `dir`. Returns the new path. Never overwrites.
ipcMain.handle('entry:create', async (event, { dir, name, kind }) => {
  const parent = inOpenFolder(event, dir, { allowRoot: true });
  const target = path.join(parent, checkName(name));
  if (await exists(target)) throw new Error(`“${path.basename(target)}” already exists.`);
  if (kind === 'folder') await fs.mkdir(target);
  else await fs.writeFile(target, '', { flag: 'wx' });
  return target;
});

// Renames in place. Returns the new path.
ipcMain.handle('entry:rename', async (event, { target, name }) => {
  const from = inOpenFolder(event, target);
  const to = path.join(path.dirname(from), checkName(name));
  if (to === from) return from;
  // (A change of case only is fine on a case-insensitive disk.)
  if (to.toLowerCase() !== from.toLowerCase() && await exists(to)) {
    throw new Error(`“${path.basename(to)}” already exists.`);
  }
  await fs.rename(from, to);
  return to;
});

// "name copy.ext", "name copy 2.ext", … next to the original. Returns the new path.
ipcMain.handle('entry:duplicate', async (event, target) => {
  const from = inOpenFolder(event, target);
  const isDir = (await fs.stat(from)).isDirectory();
  const ext = isDir ? '' : path.extname(from);
  const stem = path.basename(from, ext);
  for (let n = 1; n < 1000; n += 1) {
    const to = path.join(path.dirname(from), `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`);
    if (!(await exists(to))) {
      await fs.cp(from, to, { recursive: isDir, errorOnExist: true, force: false });
      return to;
    }
  }
  throw new Error('Too many copies already.');
});

// Asks first. Resolves true if it was moved to the Trash.
ipcMain.handle('entry:trash', async (event, target) => {
  const p = inOpenFolder(event, target);
  const isDir = (await fs.stat(p)).isDirectory();
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'warning',
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `Move “${path.basename(p)}” to the Trash?`,
    detail: isDir ? 'The folder and everything in it will be moved to the Trash.' : 'You can put it back from the Trash in Finder.',
  });
  if (response !== 0) return false;
  await shell.trashItem(p);
  return true;
});

ipcMain.handle('entry:reveal', (event, target) => {
  shell.showItemInFolder(inOpenFolder(event, target, { allowRoot: true }));
});

// relative: the path from the open folder (e.g. docs/intro.md) instead of the full path.
ipcMain.handle('entry:copy-path', async (event, { target, relative }) => {
  const p = inOpenFolder(event, target, { allowRoot: true });
  const root = folderRoots.get(BrowserWindow.fromWebContents(event.sender));
  await clipboard.writeText(relative ? (path.relative(root, p) || '.') : p); // (async in Electron 45)
});

// Returns 'save' | 'discard' | 'cancel'.
ipcMain.handle('dialog:confirm-unsaved', async (event, fileName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save the changes you made to “${fileName}”?`,
    detail: "Your changes will be lost if you don't save them.",
  });
  return ['save', 'discard', 'cancel'][response];
});

// ---------- Recovering unsaved text ----------
// While a document has unsaved changes, the renderer keeps a copy of its text here (one JSON
// file per open document, keyed by a random id). Saving deletes it; "Don't Save", opening
// another file without saving, or a crash leave it, and the next launch offers it back.
// Copies older than RECOVERY_DAYS are deleted.
const RECOVERY_DAYS = 7;
const RECOVERY_ID = /^[A-Za-z0-9-]{8,64}$/;
const recoveryDir = () => path.join(app.getPath('userData'), 'Recovery');
const recoveryFile = (id) => {
  if (typeof id !== 'string' || !RECOVERY_ID.test(id)) throw new Error('Bad recovery id.');
  return path.join(recoveryDir(), `${id}.json`);
};
let recoveryOffered = false; // offered once per app launch, to the first window that asks

ipcMain.handle('recovery:save', async (_event, { id, filePath, content }) => {
  const file = recoveryFile(id);
  if (typeof content !== 'string') return;
  await fs.mkdir(recoveryDir(), { recursive: true });
  const tmp = `${file}.${process.hrtime.bigint()}.tmp`; // write, then rename: never half a file
  await fs.writeFile(tmp, JSON.stringify({
    id, filePath: typeof filePath === 'string' ? filePath : null, content, updatedAt: Date.now(),
  }), 'utf8');
  await fs.rename(tmp, file);
});

ipcMain.handle('recovery:delete', async (_event, id) => {
  await fs.rm(recoveryFile(id), { force: true });
});

// [{ id, filePath, name, updatedAt, preview }], newest first; [] after the first call.
ipcMain.handle('recovery:list', async () => {
  if (recoveryOffered) return [];
  recoveryOffered = true;
  let names = [];
  try { names = await fs.readdir(recoveryDir()); } catch { return []; }
  const entries = [];
  const oldest = Date.now() - RECOVERY_DAYS * 24 * 60 * 60 * 1000;
  for (const name of names) {
    const file = path.join(recoveryDir(), name);
    if (name.endsWith('.tmp')) { await fs.rm(file, { force: true }); continue; } // an interrupted write
    if (!name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!(data.updatedAt > oldest) || typeof data.content !== 'string' || !RECOVERY_ID.test(data.id)) {
        await fs.rm(file, { force: true });
        continue;
      }
      entries.push({
        id: data.id,
        filePath: data.filePath,
        name: data.filePath ? path.basename(data.filePath) : 'Untitled',
        updatedAt: data.updatedAt,
        preview: data.content.trim().split('\n')[0].slice(0, 80),
      });
    } catch {
      await fs.rm(file, { force: true }); // unreadable: nothing to recover
    }
  }
  return entries.sort((x, y) => y.updatedAt - x.updatedAt);
});

ipcMain.handle('recovery:read', async (_event, id) => {
  const data = JSON.parse(await fs.readFile(recoveryFile(id), 'utf8'));
  return { filePath: data.filePath, content: data.content };
});

// Renderer reports which file is open and whether it has unsaved edits.
ipcMain.on('doc:state', (event, { filePath, dirty }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  Object.assign(docState.get(win), { filePath, dirty });
  const name = filePath ? path.basename(filePath) : 'Untitled';
  win.setTitle(`${name} — Markdown Helper`);
  if (isMac) {
    win.setDocumentEdited(dirty);
    win.setRepresentedFilename(filePath || '');
  }
});

ipcMain.on('app:close-response', (event, proceed) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (!proceed) {
    quitting = false; // user cancelled, so abort a pending Cmd+Q as well
    return;
  }
  docState.get(win).closeConfirmed = true;
  win.close();
  if (quitting) app.quit();
});

// ---------- Formatting menus ----------
// Two menus share their items:
//  - Markdown pane: the Edit button and right-click (formatMenuTemplate) → 'format' commands,
//    applied to the Markdown text (FORMAT_COMMANDS in renderer.js);
//  - preview: right-click (previewMenuTemplate) → 'preview-format' commands, applied to the
//    preview (applyPreviewFormat).
// Each formatting item shows the Markdown it writes (sublabel), so the menus double as a cheat
// sheet; checkmarks show the formatting at the cursor. Accelerators are display-only: the panes
// handle those keys themselves.

// checked: true/false for a format that can be on or off, undefined for a plain action.
function menuItem(send, enabled, label, syntax, command, checked, accelerator) {
  return {
    label,
    ...(syntax ? { sublabel: syntax } : {}),
    ...(checked === undefined ? {} : { type: 'checkbox', checked: !!checked }),
    enabled,
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
    click: () => send(command),
  };
}
const menuHeading = (label) => ({ label, enabled: false });
const SEPARATOR = { type: 'separator' };
const CLIPBOARD = [SEPARATOR, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }];

/**
 * Text styles; then the paragraph types (not in a table: a cell can't hold them); then a Table
 * submenu, so the top level stays short: in a table, its rows / columns / alignment, elsewhere
 * Insert Table.
 */
function formattingItems(item, state) {
  const { block, table } = state;
  const text = [
    menuHeading('Text'),
    item('Bold', '**text**', 'bold', state.bold, 'CmdOrCtrl+B'),
    item('Italic', '*text*', 'italic', state.italic, 'CmdOrCtrl+I'),
    item('Strikethrough', '~~text~~', 'strike', state.strike, 'CmdOrCtrl+Shift+X'),
    item('Inline Code', '`text`', 'code', state.code, 'CmdOrCtrl+E'),
  ];
  const paragraph = [
    menuHeading('Paragraph'),
    item('Normal Text', 'just text', 'p', block === 'p'),
    item('Heading 1', '# Heading', 'h1', block === 'h1'),
    item('Heading 2', '## Heading', 'h2', block === 'h2'),
    item('Heading 3', '### Heading', 'h3', block === 'h3'),
    item('Bulleted List', '- item', 'ul', block === 'ul'),
    item('Numbered List', '1. item', 'ol', block === 'ol'),
    item('Quote', '> text', 'blockquote', block === 'blockquote'),
    item('Code Block', '``` code ```', 'pre', block === 'pre'),
  ];
  const tableItems = table
    ? [
      item('Insert Row Above', '| … | … |', 'table-row-above'),
      item('Insert Row Below', '| … | … |', 'table-row-below'),
      item('Insert Column Left', 'a cell in every row', 'table-col-left'),
      item('Insert Column Right', 'a cell in every row', 'table-col-right'),
      SEPARATOR,
      item('Align Left', '| :--- |', 'table-align-left', table.align === 'left'),
      item('Align Center', '| :---: |', 'table-align-center', table.align === 'center'),
      item('Align Right', '| ---: |', 'table-align-right', table.align === 'right'),
      SEPARATOR,
      item('Delete Row', table.header ? 'the next row becomes the header' : '', 'table-delete-row'),
      item('Delete Column', '', 'table-delete-col'),
      item('Delete Table', '', 'table-delete'),
      SEPARATOR,
      item('Copy Table as CSV', 'for Excel, Numbers, Sheets', 'table-copy-csv'),
      item('Save Table as CSV…', '', 'table-save-csv'),
    ]
    : [item('Insert Table', '| a | b |', 'table-insert')];
  const tableMenu = { label: 'Table', submenu: tableItems, enabled: tableItems[0].enabled };
  return [...text, SEPARATOR, ...(table ? [] : [...paragraph, SEPARATOR]), tableMenu];
}

/**
 * The Markdown pane's menu (Edit button, right-click): formatting (Markdown & text files only),
 * then the text tools. state: { markdownTools, bold, italic, strike, code, block, table }.
 */
function formatMenuTemplate(send, state, { context = false } = {}) {
  const { markdownTools } = state;
  const markdownOnly = markdownTools ? {} : { enabled: false };
  const item = (...args) => menuItem(send, true, ...args);
  return [
    ...(markdownTools ? [...formattingItems(item, state), SEPARATOR] : []),
    ...(state.dataTable ? [...convertItems(item), SEPARATOR] : []),
    menuHeading('Clean Up'),
    { label: 'Clean Up Pasted Text', click: () => send('clean-up'), ...markdownOnly },
    { label: 'Remove New Lines', click: () => send('remove-newlines'), ...markdownOnly },
    { label: 'Format Tables', click: () => send('format-tables'), ...markdownOnly },
    { label: 'Convert to Table', click: () => send('convert-table'), ...markdownOnly },
    SEPARATOR,
    menuHeading('Change Case'),
    { label: 'UPPERCASE', click: () => send('uppercase') },
    { label: 'lowercase', click: () => send('lowercase') },
    { label: 'Title Case', click: () => send('title-case') },
    { label: 'Sentence case', click: () => send('sentence-case') },
    ...(context ? CLIPBOARD : []),
  ];
}

/** Pops a menu up at (x, y) in the sender's window; resolves when it closes. */
function showMenu(event, template, x, y) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const menu = Menu.buildFromTemplate(template);
  return new Promise((resolve) => {
    menu.popup({ window: win, x: Math.round(x) || 0, y: Math.round(y) || 0, callback: () => resolve(null) });
  });
}

// Resolves once the menu closes (picked or dismissed), so the Edit button can reset its state.
// context: opened by right-click (adds Cut / Copy / Paste).
ipcMain.handle('format-menu:show', (event, { x, y, context, ...state } = {}) => {
  const send = (command) => event.sender.send('menu:format', command);
  const template = formatMenuTemplate(send, { ...state, markdownTools: state.markdownTools !== false }, { context: !!context });
  return showMenu(event, template, x, y);
});

/** A CSV / TSV document as Markdown. */
function convertItems(item) {
  return [
    menuHeading('Convert'),
    item('Copy as Markdown Table', '| a | b |', 'copy-markdown'),
    item('Save as Markdown…', '', 'save-markdown'),
  ];
}

function previewMenuTemplate(send, state) {
  const item = (...args) => menuItem(send, state.editable !== false, ...args);
  if (state.dataTable) {
    // A CSV / TSV table: its rows and columns (no text styles or alignment in a CSV).
    return [
      menuHeading('Table'),
      item('Insert Row Above', '', 'table-row-above'),
      item('Insert Row Below', '', 'table-row-below'),
      item('Insert Column Left', '', 'table-col-left'),
      item('Insert Column Right', '', 'table-col-right'),
      SEPARATOR,
      item('Delete Row', state.header ? 'the next row becomes the header' : '', 'table-delete-row'),
      item('Delete Column', '', 'table-delete-col'),
      SEPARATOR,
      ...convertItems(item),
      ...CLIPBOARD,
    ];
  }
  return [...formattingItems(item, state), ...CLIPBOARD];
}

ipcMain.handle('preview-menu:show', (event, { x, y, state } = {}) => {
  const send = (command) => event.sender.send('menu:preview-format', command);
  return showMenu(event, previewMenuTemplate(send, state || {}), x, y);
});

/**
 * Folder sidebar right-click menu. target: { path, type: 'file' | 'dir', root, supported }
 * (root: the open folder itself, from a right-click on empty space). Picks come back to the
 * renderer as 'folder-action' commands ({ action, path, type }); it asks for names inline.
 */
function folderMenuTemplate(send, target) {
  const act = (label, action, extra = {}) => ({ label, click: () => send(action), ...extra });
  const fileOrFolder = target.type === 'dir' ? 'Folder' : 'File';
  const locate = [
    act('Reveal in Finder', 'reveal'),
    act('Copy Path', 'copy-path'),
    ...(target.root ? [] : [act('Copy Relative Path', 'copy-relative-path')]),
  ];
  const create = [act('New File…', 'new-file'), act('New Folder…', 'new-folder')];
  if (target.root) {
    return [...create, SEPARATOR, ...locate, SEPARATOR, act('Refresh', 'refresh'), act('Close Folder', 'close-folder')];
  }
  return [
    ...(target.type === 'file' ? [act('Open', 'open', { enabled: !!target.supported }), SEPARATOR] : []),
    ...create,
    SEPARATOR,
    act('Rename…', 'rename'),
    act(`Duplicate ${fileOrFolder}`, 'duplicate'),
    act('Move to Trash', 'trash'),
    SEPARATOR,
    ...locate,
  ];
}

ipcMain.handle('folder-menu:show', (event, { x, y, target } = {}) => {
  if (!target || typeof target.path !== 'string') return null;
  const send = (action) => event.sender.send('menu:folder-action', { action, path: target.path, type: target.type });
  return showMenu(event, folderMenuTemplate(send, target), x, y);
});

// Plain text only (e.g. a table converted to CSV or Markdown).
ipcMain.handle('clipboard:write-text', async (_event, text) => {
  if (typeof text !== 'string') return false;
  await clipboard.writeText(text); // (async in Electron 45)
  return true;
});

// "Save as Markdown…" / "Save Table as CSV…": writes `content` to a file the user picks.
// Resolves to the path, or null if cancelled.
ipcMain.handle('file:export', async (event, { content, defaultName, defaultDir, kind }) => {
  if (typeof content !== 'string') return null;
  const filters = kind === 'csv'
    ? [{ name: 'CSV', extensions: ['csv'] }]
    : [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
  const name = typeof defaultName === 'string' && defaultName ? path.basename(defaultName) : 'Untitled';
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    defaultPath: typeof defaultDir === 'string' && defaultDir ? path.join(defaultDir, name) : name,
    filters,
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, content, 'utf8');
  app.addRecentDocument(filePath);
  return filePath;
});

// Rich copy: HTML for mail/docs apps, plain text for everything else.
// Electron 45+ clipboard API: async, takes W3C-style ClipboardItems keyed by MIME type.
ipcMain.handle('clipboard:write-rich', async (_event, { html, text }) => {
  if (typeof html !== 'string' || typeof text !== 'string') return false;
  try {
    await clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
    return true;
  } catch (err) {
    console.error('Copy failed:', err);
    return false;
  }
});

// Keep native chrome (scrollbars, dialogs, window background) in sync with the app theme.
ipcMain.on('theme:set', (_event, mode) => {
  nativeTheme.themeSource = mode === 'dark' ? 'dark' : 'light';
});

// ---------- Menu ----------

function sendView(mode) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:view', mode);
}

function sendFind(action) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:find', action);
}

function sendIfOpen(channel) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send(channel);
}

function sendToFocused(channel) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send(channel);
    return;
  }
  // No window open (macOS): open one, then run the command once it has loaded.
  const created = createWindow();
  if (channel !== 'menu:new') {
    created.webContents.once('did-finish-load', () => created.webContents.send(channel));
  }
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => sendToFocused('menu:new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendToFocused('menu:open') },
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendToFocused('menu:open-folder'),
        },
        ...(isMac ? [{ role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }] : []),
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendToFocused('menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendToFocused('menu:save-as') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // The renderer keeps its own history (undo-history.js) shared by the editor and the
        // editable preview; Chromium's native undo can't follow edits made in the preview.
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendIfOpen('menu:undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => sendIfOpen('menu:redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        {
          label: 'Copy Formatted',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => sendToFocused('menu:copy-formatted'),
        },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          // Find & Replace in the Markdown text (renderer.js, "Find & Replace").
          label: 'Find',
          submenu: [
            { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => sendFind('open') },
            { label: 'Find and Replace…', accelerator: 'Alt+CmdOrCtrl+F', click: () => sendFind('replace') },
            { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => sendFind('next') },
            { label: 'Find Previous', accelerator: 'Shift+CmdOrCtrl+G', click: () => sendFind('previous') },
          ],
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        // Which panes show (renderer.js "View mode"; also the buttons in the header).
        { label: 'Markdown Only', accelerator: 'CmdOrCtrl+1', click: () => sendView('editor') },
        { label: 'Markdown and Preview', accelerator: 'CmdOrCtrl+2', click: () => sendView('split') },
        { label: 'Preview Only', accelerator: 'CmdOrCtrl+3', click: () => sendView('preview') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Files and folders opened from Finder / Dock / "Open Recent" / `mdh` (`open -a`).
// A folder is shown in the file sidebar; a file is opened in the editor.
async function openPathInWindow(filePath) {
  let isFolder = false;
  try { isFolder = (await fs.stat(filePath)).isDirectory(); } catch { /* let the renderer report it */ }
  const channel = isFolder ? 'menu:open-folder-path' : 'menu:open-path';
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const send = (w) => w.webContents.send(channel, filePath);
  if (win && loadedWindows.has(win)) send(win);
  else {
    const target = win || createWindow();
    target.webContents.once('did-finish-load', () => send(target));
  }
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) openPathInWindow(filePath);
  else app.whenReady().then(() => openPathInWindow(filePath));
});

app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  // Packaged builds get their icon from the bundle; in `npm start` replace Electron's default.
  if (isMac && !app.isPackaged) app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
