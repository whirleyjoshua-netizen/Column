// H5: what the desktop app lets a page do. The window only ever shows the Kloomie server (or the local setup page),
// but everything the page asks for is still checked here, in case something else ends up in it.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Links leave the app only as web pages, email or phone links: never file:, custom app schemes or scripts.
const OPEN_OK = new Set(['http:', 'https:', 'mailto:', 'tel:']);
function externalOk(url) {
  try {
    return OPEN_OK.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// The settings a page may change. Which server the app talks to is changed only by connecting (setup page).
const CFG_KEYS = new Set(['alwaysOnTop', 'autoSave', 'openAtLogin', 'trayNext', 'full']);
function cfgPatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const k of CFG_KEYS) if (k in patch) out[k] = !!patch[k];
  return out;
}

// A page is trusted when it's the Kloomie server's, or the app's own setup page.
function makeTrust({ onServer, setupFile }) {
  const setupUrl = pathToFileURL(setupFile).href;
  const isSetup = (url) => typeof url === 'string' && url.split(/[?#]/)[0] === setupUrl;
  const pageOk = (url) => onServer(url) || isSetup(url);
  // An IPC message counts only from the main frame of a trusted page.
  const sender = (e) => {
    const f = e?.senderFrame;
    return !!f && !f.parent && pageOk(f.url);
  };
  return { isSetup, pageOk, sender };
}

// A path the page gives back (to show in Finder/Explorer) must be one the app saved itself.
function insideDir(p, dir) {
  if (typeof p !== 'string' || !p) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = { externalOk, cfgPatch, makeTrust, insideDir };
