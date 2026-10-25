// Column desktop shell: a slim window docked to the screen edge, tray/menu-bar icon,
// global hotkey, and native drag-out of files to Finder/Explorer/desktop.
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, shell, clipboard, session, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { iconPng } = require('./icon');

const isMac = process.platform === 'darwin';
const COL_WIDTH = 340;
const HOTKEY = 'CommandOrControl+Shift+Space';
const PREFETCH_LIMIT = 500 * 1024 * 1024;
// Where a fresh install connects, so downloading the app is all it takes. "Change server" still picks another.
const DEFAULT_SERVER = 'https://column.premiershadesolutions.com';

if (!app.requestSingleInstanceLock()) app.quit();
// Meeting recording hears the computer's own sound (the other side of a call). On macOS that's
// ScreenCaptureKit's system audio, which macOS asks permission for once.
if (isMac) app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');

// ---------- config ----------
const CFG_PATH = path.join(app.getPath('userData'), 'config.json');
let cfg = { serverUrl: DEFAULT_SERVER, alwaysOnTop: false, autoSave: false, openAtLogin: false, panes: 1, trayNext: true };
try {
  cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) };
} catch {}
// Older versions saved the hosted server as http://, which it moves to https:// anyway.
if (DEFAULT_SERVER && cfg.serverUrl && cfg.serverUrl !== DEFAULT_SERVER && new URL(DEFAULT_SERVER).host === (URL.canParse(cfg.serverUrl) ? new URL(cfg.serverUrl).host : '')) cfg.serverUrl = DEFAULT_SERVER;
// The microphone only works on secure pages; a Column server on the local network is plain http.
try {
  const u = cfg.serverUrl && new URL(cfg.serverUrl);
  if (u && u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', u.origin);
} catch {}
// The Column server, whether the address was typed as http:// and the server moved us to https:// or not.
function onServer(url) {
  try {
    return !!cfg.serverUrl && new URL(url).host === new URL(cfg.serverUrl).host;
  } catch {
    return false;
  }
}
function saveCfg() {
  fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
  win?.webContents.send('config', cfg);
}

const LOG_PATH = path.join(app.getPath('userData'), 'column.log');
function log(...args) {
  const line = `${new Date().toISOString()} ${args.join(' ')}\n`;
  try { fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true }); fs.appendFileSync(LOG_PATH, line); } catch {}
  process.stdout.write(line);
}
process.on('uncaughtException', (e) => log('crash', e.stack || e));

const CACHE_DIR = path.join(os.tmpdir(), 'column-cache');
const SAVE_DIR = () => path.join(app.getPath('downloads'), 'Column');

// ---------- icons ----------
const appIcon = nativeImage.createFromBuffer(iconPng(512));
const dragIcon = nativeImage.createFromBuffer(iconPng(64), { scaleFactor: 2 });
function trayIcon() {
  if (isMac) {
    const img = nativeImage.createFromBuffer(iconPng(36, { template: true }), { scaleFactor: 2 });
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromBuffer(iconPng(32), { scaleFactor: 2 });
}

// ---------- window ----------
let win = null;
let tray = null;
let quitting = false;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = cfg.panes > 1 ? COL_WIDTH * 2 : COL_WIDTH;
  win = new BrowserWindow({
    width,
    height: workArea.height,
    x: workArea.x + workArea.width - width,
    y: workArea.y,
    minWidth: 260,
    minHeight: 320,
    title: 'Column',
    icon: appIcon,
    backgroundColor: '#111115',
    alwaysOnTop: cfg.alwaysOnTop,
    autoHideMenuBar: true,
    show: false,
    ...(isMac ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 15 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => { log('ready-to-show', JSON.stringify(win.getBounds())); win.show(); win.focus(); });
  win.webContents.on('did-finish-load', () => { log('loaded', win.webContents.getURL()); if (!win.isVisible()) { win.show(); win.focus(); } });
  win.webContents.on('render-process-gone', (_e, d) => log('renderer gone', JSON.stringify(d)));
  win.webContents.on('console-message', (e) => { if (e.level === 'error') log('page error', e.message); });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  // Links open in the real browser, never inside the column. A file popped out of Column (/?view=<id>)
  // gets a window of its own instead, next to the column.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (onServer(url) && new URL(url).searchParams.has('view')) {
      const { workArea } = screen.getPrimaryDisplay();
      const width = Math.min(760, workArea.width - win.getBounds().width);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: Math.max(420, width), height: Math.min(900, workArea.height), x: workArea.x + Math.max(0, win.getBounds().x - workArea.x - Math.max(420, width)), y: workArea.y,
          title: 'Column', icon: appIcon, backgroundColor: '#111115', autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // Links inside a popped-out file open in the real browser too.
  win.webContents.on('did-create-window', (child) => {
    child.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    child.webContents.on('will-navigate', (e, url) => {
      e.preventDefault();
      shell.openExternal(url);
    });
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (cfg.serverUrl && !onServer(url) && !url.startsWith('file:')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && onServer(url)) loadSetup(`Couldn't reach ${cfg.serverUrl} (${desc}). Is the server running?`);
  });
  loadApp();
}

function loadSetup(error) {
  win.loadFile(path.join(__dirname, 'setup.html'), { query: { server: cfg.serverUrl || '', error: error || '' } });
}
function loadApp() {
  if (cfg.serverUrl) win.loadURL(cfg.serverUrl);
  else loadSetup();
}

function toggle() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else {
    win.show();
    win.focus();
  }
}

function setWidth(panes) {
  if (!win) return;
  cfg.panes = panes;
  saveCfg();
  const b = win.getBounds();
  const target = panes > 1 ? Math.max(b.width, COL_WIDTH * 2) : COL_WIDTH;
  if (target === b.width) return;
  const right = b.x + b.width;
  win.setBounds({ x: right - target, y: b.y, width: target, height: b.height }, true);
}

// What's on now / next today, sent by the page: { title, items: [{ label }] }.
let next = null;
function openDay() {
  win?.show();
  win?.focus();
  win?.webContents.send('open-day');
}
function updateTray() {
  if (!tray) return;
  const title = cfg.trayNext && next?.title ? next.title : '';
  if (isMac) tray.setTitle(title ? ' ' + title : '', { fontType: 'monospacedDigit' });
  tray.setToolTip(title ? `Column · ${title}` : 'Column');
  if (!isMac) tray.setContextMenu(trayMenu());
}

function trayMenu() {
  const today = next?.items?.length
    ? [{ label: 'Today', enabled: false }, ...next.items.slice(0, 8).map((i) => ({ label: i.label, click: openDay })), { type: 'separator' }]
    : [];
  return Menu.buildFromTemplate([
    ...today,
    { label: win?.isVisible() ? 'Hide Column' : 'Show Column', click: toggle },
    { label: 'Always on top', type: 'checkbox', checked: cfg.alwaysOnTop, click: (i) => applyCfg({ alwaysOnTop: i.checked }) },
    { label: 'Open Downloads/Column', click: openSaveDir },
    { label: 'Change server…', click: () => { win.show(); loadSetup(); } },
    { type: 'separator' },
    { label: 'Quit Column', click: () => { quitting = true; app.quit(); } },
  ]);
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Column');
  tray.on('click', toggle);
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  updateTray(); // Windows/Linux: sets the right-click menu
}

function applyCfg(patch) {
  cfg = { ...cfg, ...patch };
  if ('alwaysOnTop' in patch) win?.setAlwaysOnTop(!!cfg.alwaysOnTop, 'floating');
  if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!cfg.openAtLogin, openAsHidden: true });
  if ('trayNext' in patch) updateTray();
  saveCfg();
}

async function openSaveDir() {
  await fsp.mkdir(SAVE_DIR(), { recursive: true });
  shell.openPath(SAVE_DIR());
}

// ---------- file cache (makes native drag-out possible) ----------
const safe = (s) => String(s || 'file').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 200) || 'file';
const cachedPath = (info) => path.join(CACHE_DIR, safe(info.id), safe(info.name));
const inflight = new Map();

async function fetchTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

function ensureCached(info) {
  const final = cachedPath(info);
  if (fs.existsSync(final)) return Promise.resolve(final);
  if (inflight.has(info.id)) return inflight.get(info.id);
  const tmp = path.join(CACHE_DIR, safe(info.id), '.partial-' + safe(info.name));
  const job = (async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
    if (info.type === 'folder') {
      for (const f of info.files) {
        const parts = f.relPath.split('/').map(safe);
        await fetchTo(f.url, path.join(tmp, ...parts));
      }
      await fsp.mkdir(tmp, { recursive: true });
    } else {
      await fetchTo(info.url, tmp);
    }
    await fsp.rename(tmp, final);
    return final;
  })().finally(() => inflight.delete(info.id));
  inflight.set(info.id, job);
  return job;
}

async function uniqueDest(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = path.join(dir, i === 1 ? name : `${base} (${i})${ext}`);
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }
}

async function saveItem(info) {
  await fsp.mkdir(SAVE_DIR(), { recursive: true });
  const dest = await uniqueDest(SAVE_DIR(), safe(info.name));
  const src = await ensureCached(info);
  await fsp.cp(src, dest, { recursive: true });
  return dest;
}

// ---------- IPC ----------
ipcMain.handle('get-config', () => cfg);
ipcMain.handle('set-config', (_e, patch) => applyCfg(patch || {}));
ipcMain.on('set-layout', (_e, panes) => setWidth(Number(panes) || 1));
ipcMain.on('prefetch', (_e, info) => {
  if (info && (info.size || 0) <= PREFETCH_LIMIT) ensureCached(info).catch(() => {});
});
ipcMain.on('start-drag', (e, info) => {
  const p = info && cachedPath(info);
  if (p && fs.existsSync(p)) {
    e.sender.startDrag({ file: p, icon: dragIcon });
    e.returnValue = true;
  } else {
    if (info) ensureCached(info).catch(() => {});
    e.returnValue = false;
  }
});
ipcMain.handle('save', (_e, info) => saveItem(info));
ipcMain.on('reveal', (_e, p) => p && shell.showItemInFolder(p));
ipcMain.on('open-folder', openSaveDir);
ipcMain.on('copy-text', (_e, text) => clipboard.writeText(String(text || '')));
ipcMain.on('change-server', () => loadSetup());
ipcMain.on('set-next', (_e, info) => {
  next = info && typeof info === 'object' ? { title: String(info.title || '').slice(0, 60), items: (info.items || []).slice(0, 8).map((i) => ({ label: String(i.label || '').slice(0, 80) })) } : null;
  updateTray();
});
ipcMain.handle('connect', async (_e, raw) => {
  let url = String(raw || '').trim().replace(/\/+$/, '');
  // No http:// or https:// typed: try the secure address first, then plain (a server on the local network).
  const tries = /^https?:\/\//.test(url) ? [url] : ['https://' + url, 'http://' + url];
  let found = null;
  for (const u of tries) {
    const res = await fetch(u + '/api/health', { signal: AbortSignal.timeout(5000) }).catch(() => null);
    // Keep the address the server ended up at, so http:// that moves to https:// is saved as https://.
    if (res && res.ok && (await res.json().catch(() => ({}))).app === 'column') { found = new URL(res.url).origin; break; }
  }
  if (!found) throw new Error(`No Column server found at ${tries[tries.length - 1]}`);
  url = found;
  cfg.serverUrl = url;
  saveCfg();
  win.loadURL(url);
});

// ---------- lifecycle ----------
app.on('second-instance', () => {
  win?.show();
  win?.focus();
});
app.whenReady().then(() => {
  if (isMac) app.dock.setIcon(appIcon);
  // A Column page asking for the screen gets the computer's sound with no picker: it only ever asks
  // to record a meeting, and throws the picture away.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb(s[0] ? { video: s[0], audio: 'loopback' } : {})).catch(() => cb({}));
  });
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  log('starting', `displays=${JSON.stringify(screen.getAllDisplays().map((d) => d.workArea))}`);
  createWindow();
  try { buildTray(); log('tray ok'); } catch (e) { log('tray failed', e.message); }
  log('hotkey', globalShortcut.register(HOTKEY, toggle) ? 'registered' : 'taken by another app');
});
app.on('activate', () => {
  win?.show();
});
app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
