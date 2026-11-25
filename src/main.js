const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const isMac = process.platform === 'darwin';
const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] },
];

// Per-window document state: { filePath, dirty, closeConfirmed }
const docState = new WeakMap();
let quitting = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
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

async function readDocument(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  app.addRecentDocument(filePath);
  return { filePath, content };
}

ipcMain.handle('file:open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: MARKDOWN_FILTERS,
  });
  if (canceled || !filePaths.length) return null;
  return readDocument(filePaths[0]);
});

ipcMain.handle('file:open-path', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return null;
  return readDocument(filePath);
});

ipcMain.handle('file:save', async (event, { filePath, content, saveAs }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  let target = saveAs ? null : filePath;
  if (!target) {
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
      defaultPath: filePath || 'Untitled.md',
      filters: MARKDOWN_FILTERS,
    });
    if (canceled || !chosen) return null;
    target = chosen;
  }
  await fs.writeFile(target, content, 'utf8');
  app.addRecentDocument(target);
  return { filePath: target };
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
        ...(isMac ? [{ role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }] : []),
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendToFocused('menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendToFocused('menu:save-as') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Files opened from Finder / Dock / "Open Recent".
function openPathInWindow(filePath) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const send = (w) => w.webContents.send('menu:open-path', filePath);
  if (win && !win.webContents.isLoading()) send(win);
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
