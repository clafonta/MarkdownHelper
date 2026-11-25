const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('markdownHelper', {
  platform: process.platform,
  setTheme: (mode) => ipcRenderer.send('theme:set', mode),

  // File I/O (handled by the main process)
  openFile: () => ipcRenderer.invoke('file:open'),
  openPath: (filePath) => ipcRenderer.invoke('file:open-path', filePath),
  saveFile: (filePath, content, saveAs = false) =>
    ipcRenderer.invoke('file:save', { filePath, content, saveAs }),
  confirmUnsaved: (fileName) => ipcRenderer.invoke('dialog:confirm-unsaved', fileName),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  copyRich: (html, text) => ipcRenderer.invoke('clipboard:write-rich', { html, text }),

  // Document state / window lifecycle
  reportState: (filePath, dirty) => ipcRenderer.send('doc:state', { filePath, dirty }),
  respondToClose: (proceed) => ipcRenderer.send('app:close-response', proceed),

  // Menu commands: 'new' | 'open' | 'save' | 'save-as' | 'copy-formatted' | 'request-close'
  onCommand: (handler) => {
    const map = {
      'menu:new': 'new',
      'menu:open': 'open',
      'menu:save': 'save',
      'menu:save-as': 'save-as',
      'menu:copy-formatted': 'copy-formatted',
      'app:request-close': 'request-close',
    };
    for (const [channel, command] of Object.entries(map)) {
      ipcRenderer.on(channel, () => handler(command));
    }
    ipcRenderer.on('menu:open-path', (_e, filePath) => handler('open-path', filePath));
  },
});
