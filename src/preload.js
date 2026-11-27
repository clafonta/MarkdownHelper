const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('markdownHelper', {
  platform: process.platform,
  setTheme: (mode) => ipcRenderer.send('theme:set', mode),

  // File I/O (handled by the main process)
  openFile: () => ipcRenderer.invoke('file:open'),
  openPath: (filePath) => ipcRenderer.invoke('file:open-path', filePath),
  // eol: the file's line ending ('\n' or '\r\n') as returned by openFile/openPath.
  saveFile: (filePath, content, { saveAs = false, defaultDir = null, eol = '\n' } = {}) =>
    ipcRenderer.invoke('file:save', { filePath, content, saveAs, defaultDir, eol }),
  // Folders: each returns { name, path, children: [{ name, path, type: 'dir'|'file', children? }] }
  openFolder: () => ipcRenderer.invoke('folder:open'),
  listFolder: (folderPath) => ipcRenderer.invoke('folder:list', folderPath),
  closeFolder: () => ipcRenderer.send('folder:close'),
  isFolder: (p) => ipcRenderer.invoke('path:is-folder', p),
  confirmUnsaved: (fileName) => ipcRenderer.invoke('dialog:confirm-unsaved', fileName),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  copyRich: (html, text) => ipcRenderer.invoke('clipboard:write-rich', { html, text }),
  // Native Format menu at (x, y) in the window; resolves when it closes. Picks arrive as 'format'.
  showFormatMenu: (options) => ipcRenderer.invoke('format-menu:show', options),
  // Right-click menu of the editable preview at (x, y); picks arrive as 'preview-format'.
  // state: { editable, bold, italic, strike, code, block: 'p'|'h1'|'h2'|'h3'|'ul'|'ol'|'blockquote'|'pre' }
  showPreviewMenu: (options) => ipcRenderer.invoke('preview-menu:show', options),
  // Folder sidebar right-click menu; picks arrive as 'folder-action' ({ action, path, type }).
  showFolderMenu: (options) => ipcRenderer.invoke('folder-menu:show', options),
  // Sidebar file operations; all stay inside the open folder (checked in main).
  createEntry: (dir, name, kind) => ipcRenderer.invoke('entry:create', { dir, name, kind }), // → new path
  renameEntry: (target, name) => ipcRenderer.invoke('entry:rename', { target, name }), // → new path
  duplicateEntry: (target) => ipcRenderer.invoke('entry:duplicate', target), // → new path
  trashEntry: (target) => ipcRenderer.invoke('entry:trash', target), // asks first; → moved?
  revealEntry: (target) => ipcRenderer.invoke('entry:reveal', target),
  copyEntryPath: (target, relative) => ipcRenderer.invoke('entry:copy-path', { target, relative }),

  // Recovering unsaved text (see main.js): a copy of the text while it has unsaved changes.
  saveRecovery: (id, filePath, content) => ipcRenderer.invoke('recovery:save', { id, filePath, content }),
  deleteRecovery: (id) => ipcRenderer.invoke('recovery:delete', id),
  listRecovery: () => ipcRenderer.invoke('recovery:list'), // → [{ id, filePath, name, updatedAt, preview }]
  readRecovery: (id) => ipcRenderer.invoke('recovery:read', id), // → { filePath, content }

  // Document state / window lifecycle
  reportState: (filePath, dirty) => ipcRenderer.send('doc:state', { filePath, dirty }),
  respondToClose: (proceed) => ipcRenderer.send('app:close-response', proceed),

  // Menu commands: 'new' | 'open' | 'open-folder' | 'save' | 'save-as' | 'copy-formatted' |
  // 'undo' | 'redo' |
  // 'request-close', plus 'open-path' / 'open-folder-path' with a path argument and 'format' with
  // a FORMAT_COMMANDS key from renderer.js ('clean-up', 'uppercase', 'convert-table', …).
  onCommand: (handler) => {
    const map = {
      'menu:new': 'new',
      'menu:open': 'open',
      'menu:open-folder': 'open-folder',
      'menu:save': 'save',
      'menu:save-as': 'save-as',
      'menu:copy-formatted': 'copy-formatted',
      'menu:undo': 'undo',
      'menu:redo': 'redo',
      'app:request-close': 'request-close',
    };
    for (const [channel, command] of Object.entries(map)) {
      ipcRenderer.on(channel, () => handler(command));
    }
    ipcRenderer.on('menu:open-path', (_e, filePath) => handler('open-path', filePath));
    ipcRenderer.on('menu:open-folder-path', (_e, folderPath) => handler('open-folder-path', folderPath));
    ipcRenderer.on('menu:format', (_e, command) => handler('format', command));
    ipcRenderer.on('menu:preview-format', (_e, command) => handler('preview-format', command));
    ipcRenderer.on('menu:folder-action', (_e, pick) => handler('folder-action', pick));
    ipcRenderer.on('menu:find', (_e, action) => handler('find', action)); // open | replace | next | previous
  },
});
