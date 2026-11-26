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

  // Document state / window lifecycle
  reportState: (filePath, dirty) => ipcRenderer.send('doc:state', { filePath, dirty }),
  respondToClose: (proceed) => ipcRenderer.send('app:close-response', proceed),

  // Menu commands: 'new' | 'open' | 'open-folder' | 'save' | 'save-as' | 'copy-formatted' |
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
      'app:request-close': 'request-close',
    };
    for (const [channel, command] of Object.entries(map)) {
      ipcRenderer.on(channel, () => handler(command));
    }
    ipcRenderer.on('menu:open-path', (_e, filePath) => handler('open-path', filePath));
    ipcRenderer.on('menu:open-folder-path', (_e, folderPath) => handler('open-folder-path', folderPath));
    ipcRenderer.on('menu:format', (_e, command) => handler('format', command));
  },
});
