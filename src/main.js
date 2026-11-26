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

async function listFolder(win, folderPath) {
  const tree = await scanFolder(folderPath);
  setSidebarLayout(win, true);
  app.addRecentDocument(folderPath);
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

// ---------- Help! menu (the editor's text-tools button) ----------

function formatMenuTemplate(send, { markdownTools }) {
  const markdownOnly = markdownTools ? {} : { enabled: false };
  return [
    { label: 'Clean Up Pasted Text', click: () => send('clean-up'), ...markdownOnly },
    { label: 'Remove New Lines', click: () => send('remove-newlines'), ...markdownOnly },
    { label: 'Format Tables', click: () => send('format-tables'), ...markdownOnly },
    { label: 'Convert to Table', click: () => send('convert-table'), ...markdownOnly },
    { type: 'separator' },
    { label: 'UPPERCASE', click: () => send('uppercase') },
    { label: 'lowercase', click: () => send('lowercase') },
    { label: 'Title Case', click: () => send('title-case') },
    { label: 'Sentence case', click: () => send('sentence-case') },
  ];
}

// Resolves once the menu closes (picked or dismissed), so the button can reset its state.
ipcMain.handle('format-menu:show', (event, { x, y, markdownTools } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const send = (command) => event.sender.send('menu:format', command);
  const menu = Menu.buildFromTemplate(formatMenuTemplate(send, { markdownTools: markdownTools !== false }));
  return new Promise((resolve) => {
    menu.popup({ window: win, x: Math.round(x) || 0, y: Math.round(y) || 0, callback: () => resolve(null) });
  });
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
        { role: 'undo' },
        { role: 'redo' },
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
      ],
    },
    { role: 'viewMenu' },
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
