// Kloomie desktop shell: a slim window docked to the screen edge (Column) or a normal window (Full size), tray/menu-bar icon,
// global hotkey, and native drag-out of files to Finder/Explorer/desktop.
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, shell, clipboard, session, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { externalOk, cfgPatch, makeTrust, insideDir } = require('./guard.js');
// Tests run the app with its own settings folder, so a real install's settings are never touched.
if (process.env.KLOOMIE_USER_DATA) app.setPath('userData', process.env.KLOOMIE_USER_DATA);

const isMac = process.platform === 'darwin';
const COL_WIDTH = 340;
const HOTKEY = 'CommandOrControl+Shift+Space';
const PREFETCH_LIMIT = 500 * 1024 * 1024;
// Where a fresh install connects, so downloading the app is all it takes. "Change server" still picks another.
const DEFAULT_SERVER = 'https://app.kloomie.com';

if (!app.requestSingleInstanceLock()) app.quit();
// Meeting recording hears the computer's own sound (the other side of a call). On macOS that's
// ScreenCaptureKit's system audio, which macOS asks permission for once.
if (isMac) app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');

// ---------- config ----------
const CFG_PATH = path.join(app.getPath('userData'), 'config.json');
let cfg = { serverUrl: DEFAULT_SERVER, alwaysOnTop: false, autoSave: false, openAtLogin: false, panes: 1, trayNext: true, full: false, fullBounds: null };
try {
  cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) };
} catch {}
// Older versions saved the hosted server as http://, which it moves to https:// anyway.
if (DEFAULT_SERVER && cfg.serverUrl && cfg.serverUrl !== DEFAULT_SERVER && new URL(DEFAULT_SERVER).host === (URL.canParse(cfg.serverUrl) ? new URL(cfg.serverUrl).host : '')) cfg.serverUrl = DEFAULT_SERVER;
// The microphone only works on secure pages; a Kloomie server on the local network is plain http.
try {
  const u = cfg.serverUrl && new URL(cfg.serverUrl);
  if (u && u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', u.origin);
} catch {}
// The Kloomie server, whether the address was typed as http:// and the server moved us to https:// or not.
function onServer(url) {
  try {
    return !!cfg.serverUrl && new URL(url).host === new URL(cfg.serverUrl).host;
  } catch {
    return false;
  }
}
// H5: only the Kloomie server's pages (and the app's own setup page) may talk to the app, and links leave it only as
// web, email or phone links (desktop/guard.js).
const trust = makeTrust({ onServer, setupFile: path.join(__dirname, 'setup.html') });
function openOut(url) {
  if (externalOk(url)) shell.openExternal(url);
  else log('blocked opening', String(url).slice(0, 80));
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
const SAVE_DIR = () => path.join(app.getPath('downloads'), 'Kloomie');

// ---------- icons ----------
const asset = (f) => path.join(__dirname, f); // made by brand/make-icons.mjs
const appIcon = nativeImage.createFromPath(asset('icon.png'));
const dragIcon = nativeImage.createFromBuffer(fs.readFileSync(asset('drag.png')), { scaleFactor: 2 });
function trayIcon() {
  if (isMac) {
    const img = nativeImage.createFromBuffer(fs.readFileSync(asset('trayTemplate@2x.png')), { scaleFactor: 2 });
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromBuffer(fs.readFileSync(asset('tray.png')), { scaleFactor: 2 });
}

// ---------- window ----------
let win = null;
let tray = null;
let quitting = false;

// Two ways to have the window: Column, a slim strip docked to the right edge of the screen (one or two panes wide),
// or Full size, a normal window like any other app's, where it was last left (or centred, if that screen is gone).
function columnBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = cfg.panes > 1 ? COL_WIDTH * 2 : COL_WIDTH;
  return { x: workArea.x + workArea.width - width, y: workArea.y, width, height: workArea.height };
}
function fullBounds() {
  const b = cfg.fullBounds;
  if (b && [b.x, b.y, b.width, b.height].every(Number.isFinite)) {
    const wa = screen.getDisplayMatching(b).workArea;
    const seen = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x) > 200 && Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y) > 120;
    if (seen) return { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(FULL_MIN.width, Math.round(b.width)), height: Math.max(FULL_MIN.height, Math.round(b.height)) };
  }
  const { workArea: wa } = screen.getPrimaryDisplay();
  const width = Math.min(1320, wa.width - 80), height = Math.min(880, wa.height - 60);
  return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
}
const FULL_MIN = { width: 720, height: 480 };
function setMode(full) {
  if (!win) return;
  if (full) {
    win.setMinimumSize(FULL_MIN.width, FULL_MIN.height);
    win.setBounds(fullBounds(), true);
  } else {
    win.setMinimumSize(260, 320);
    win.setBounds(columnBounds(), true);
  }
  win.show();
  win.focus();
}
let boundsTimer = null;
function keepFullBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => { if (cfg.full && win && !win.isMinimized() && !win.isFullScreen()) { cfg.fullBounds = win.getBounds(); saveCfg(); } }, 400);
}

function createWindow() {
  const b = cfg.full ? fullBounds() : columnBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: cfg.full ? FULL_MIN.width : 260,
    minHeight: cfg.full ? FULL_MIN.height : 320,
    title: 'Kloomie',
    icon: appIcon,
    backgroundColor: '#f6f6f8', // always white, like the app
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
  win.on('resize', keepFullBounds);
  win.on('move', keepFullBounds);
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
  // Links open in the real browser, never inside the column. A file popped out of Kloomie (/?view=<id>)
  // gets a window of its own instead, next to the column.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (onServer(url) && new URL(url).searchParams.has('view')) {
      const { workArea } = screen.getPrimaryDisplay();
      const width = Math.min(760, workArea.width - win.getBounds().width);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: Math.max(420, width), height: Math.min(900, workArea.height), x: workArea.x + Math.max(0, win.getBounds().x - workArea.x - Math.max(420, width)), y: workArea.y,
          title: 'Kloomie', icon: appIcon, backgroundColor: '#f6f6f8', autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    openOut(url);
    return { action: 'deny' };
  });
  // Links inside a popped-out file open in the real browser too.
  win.webContents.on('did-create-window', (child) => {
    child.webContents.setWindowOpenHandler(({ url }) => {
      openOut(url);
      return { action: 'deny' };
    });
    child.webContents.on('will-navigate', (e, url) => {
      e.preventDefault();
      openOut(url);
    });
  });
  // The window stays on the Kloomie server (or the setup page): anything else opens outside, if it's a web link.
  win.webContents.on('will-navigate', (e, url) => {
    if (trust.pageOk(url)) return;
    e.preventDefault();
    openOut(url);
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
  if (cfg.full) return; // a full-size window keeps its size; the panes just share it
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
  tray.setToolTip(title ? `Kloomie · ${title}` : 'Kloomie');
  if (!isMac) tray.setContextMenu(trayMenu());
}

function trayMenu() {
  const today = next?.items?.length
    ? [{ label: 'Today', enabled: false }, ...next.items.slice(0, 8).map((i) => ({ label: i.label, click: openDay })), { type: 'separator' }]
    : [];
  return Menu.buildFromTemplate([
    ...today,
    { label: win?.isVisible() ? 'Hide Kloomie' : 'Show Kloomie', click: toggle },
    { label: 'Column', type: 'radio', checked: !cfg.full, click: () => applyCfg({ full: false }) },
    { label: 'Full size', type: 'radio', checked: !!cfg.full, click: () => applyCfg({ full: true }) },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: cfg.alwaysOnTop, click: (i) => applyCfg({ alwaysOnTop: i.checked }) },
    { label: 'Open Downloads/Kloomie', click: openSaveDir },
    { label: 'Change server…', click: () => { win.show(); loadSetup(); } },
    { type: 'separator' },
    { label: 'Quit Kloomie', click: () => { quitting = true; app.quit(); } },
  ]);
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Kloomie');
  tray.on('click', toggle);
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  updateTray(); // Windows/Linux: sets the right-click menu
}

function applyCfg(patch) {
  cfg = { ...cfg, ...patch };
  if ('alwaysOnTop' in patch) win?.setAlwaysOnTop(!!cfg.alwaysOnTop, 'floating');
  if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!cfg.openAtLogin, openAsHidden: true });
  if ('trayNext' in patch) updateTray();
  if ('full' in patch) { setMode(!!cfg.full); updateTray(); }
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
// Every message is checked: from the main frame of the Kloomie server's page (or the setup page), with files only
// from the Kloomie server, and paths only inside the app's own Downloads folder.
const ok = (fn) => (e, ...a) => (trust.sender(e) ? fn(e, ...a) : (log('ignored a message from', e?.senderFrame?.url || '?'), undefined));
const infoOk = (info) => !!info && typeof info === 'object' && typeof info.id === 'string' && typeof info.name === 'string'
  && (info.type === 'folder' ? Array.isArray(info.files) && info.files.every((f) => f && typeof f.relPath === 'string' && onServer(f.url)) : onServer(info.url));
ipcMain.handle('get-config', ok(() => cfg));
ipcMain.handle('set-config', ok((_e, patch) => applyCfg(cfgPatch(patch))));
ipcMain.on('set-layout', ok((_e, panes) => setWidth(Math.max(1, Math.min(2, Number(panes) || 1)))));
ipcMain.on('prefetch', ok((_e, info) => {
  if (infoOk(info) && (info.size || 0) <= PREFETCH_LIMIT) ensureCached(info).catch(() => {});
}));
ipcMain.on('start-drag', (e, info) => {
  if (!trust.sender(e) || !infoOk(info)) { e.returnValue = false; return; }
  const p = info && cachedPath(info);
  if (p && fs.existsSync(p)) {
    e.sender.startDrag({ file: p, icon: dragIcon });
    e.returnValue = true;
  } else {
    if (info) ensureCached(info).catch(() => {});
    e.returnValue = false;
  }
});
ipcMain.handle('save', ok((_e, info) => { if (!infoOk(info)) throw new Error('That file isn’t from your Kloomie server.'); return saveItem(info); }));
ipcMain.on('reveal', ok((_e, p) => insideDir(p, SAVE_DIR()) && shell.showItemInFolder(p)));
ipcMain.on('open-folder', ok(openSaveDir));
ipcMain.on('copy-text', ok((_e, text) => clipboard.writeText(String(text || '').slice(0, 100_000))));
ipcMain.on('change-server', ok(() => loadSetup()));
ipcMain.on('set-next', ok((_e, info) => {
  next = info && typeof info === 'object' ? { title: String(info.title || '').slice(0, 60), items: (info.items || []).slice(0, 8).map((i) => ({ label: String(i.label || '').slice(0, 80) })) } : null;
  updateTray();
}));
ipcMain.handle('connect', ok(async (_e, raw) => {
  let url = String(raw || '').trim().replace(/\/+$/, '');
  // No http:// or https:// typed: try the secure address first, then plain (a server on the local network).
  const tries = /^https?:\/\//.test(url) ? [url] : ['https://' + url, 'http://' + url];
  let found = null;
  for (const u of tries) {
    const res = await fetch(u + '/api/health', { signal: AbortSignal.timeout(5000) }).catch(() => null);
    // Keep the address the server ended up at, so http:// that moves to https:// is saved as https://.
    if (res && res.ok && (await res.json().catch(() => ({}))).app === 'column') { found = new URL(res.url).origin; break; }
  }
  if (!found) throw new Error(`No Kloomie server found at ${tries[tries.length - 1]}`);
  url = found;
  cfg.serverUrl = url;
  saveCfg();
  win.loadURL(url);
}));

// ---------- lifecycle ----------
app.on('second-instance', () => {
  win?.show();
  win?.focus();
});
app.whenReady().then(() => {
  if (isMac) app.dock.setIcon(appIcon);
  // A Kloomie page asking for the screen gets the computer's sound with no picker: it only ever asks
  // to record a meeting, and throws the picture away.
  // H5: only the Kloomie server's page gets it.
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    if (!onServer(req.securityOrigin || req.frame?.url || '')) { log('refused screen capture for', req.securityOrigin || '?'); return cb({}); }
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
