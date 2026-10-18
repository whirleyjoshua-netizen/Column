// Exposes a small, safe desktop API to the Column page as window.columnDesktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('columnDesktop', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  onConfig: (fn) => ipcRenderer.on('config', (_e, cfg) => fn(cfg)),
  setLayout: (panes) => ipcRenderer.send('set-layout', panes),
  prefetch: (info) => ipcRenderer.send('prefetch', info),
  startDrag: (info) => ipcRenderer.sendSync('start-drag', info),
  save: (info) => ipcRenderer.invoke('save', info),
  reveal: (p) => ipcRenderer.send('reveal', p),
  openFolder: () => ipcRenderer.send('open-folder'),
  copyText: (text) => ipcRenderer.send('copy-text', text),
  changeServer: () => ipcRenderer.send('change-server'),
  connect: (url) => ipcRenderer.invoke('connect', url),
  setNext: (info) => ipcRenderer.send('set-next', info),
  onOpenDay: (fn) => ipcRenderer.on('open-day', () => fn()),
});
