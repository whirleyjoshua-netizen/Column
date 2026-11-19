// The desktop app's two windows (the owner, 2026-11-12): Column, a slim strip docked to the right edge of the
// screen, and Full size, a normal window like the Claude or Cursor app. The switch is in Settings (and the menu-bar
// menu); Full size opens centred the first time, then where it was left, after a restart too; back to Column, it
// docks again. A full-size window is wide enough for the sidebar; the column gets the drawer. Runs the real app
// with its own settings folder (KLOOMIE_USER_DATA). Needs Electron (here or in the main checkout).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = path.resolve(process.argv[2] || '.');
const DIR = S + '/dk/desktop_mode';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR + '/user', { recursive: true });
const PORT = 4968, CDP = 9529, B = `http://127.0.0.1:${PORT}`;
const DESKTOP = new URL('../desktop', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const electron = [path.join(DESKTOP, 'node_modules/.bin/electron'), '/Users/premiershades/column/desktop/node_modules/.bin/electron'].find((p) => fs.existsSync(p));
if (!electron) {
  console.log('SKIP: Electron isn’t installed');
  process.exit(0);
}
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR + '/data', MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const t = Date.now();
const a = await (await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Desk ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
fs.writeFileSync(DIR + '/user/config.json', JSON.stringify({ serverUrl: B }));
let app;
async function open() {
  app = spawn(electron, [DESKTOP, `--remote-debugging-port=${CDP}`], { env: { ...process.env, KLOOMIE_USER_DATA: DIR + '/user' }, stdio: 'ignore' });
  let page;
  for (let i = 0; i < 100 && !page; i++) { await sleep(300); try { page = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === 'page' && x.url.startsWith(B)); } catch {} }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value;
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
  const close = async () => { ws.close(); app.kill(); await new Promise((r) => app.once('exit', r)); };
  return { ev, until, close };
}
const win = `({ x: screenX, y: screenY, w: outerWidth, h: outerHeight, sw: screen.availWidth, sl: screen.availLeft || 0 })`;
try {
  let P = await open();
  await P.until(`document.readyState === 'complete' && !!window.columnDesktop`, 20000);
  await P.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await P.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#menuBtn')`, 20000), 'the desktop app signs in');
  let w = await P.ev(win);
  ok(w.w >= 330 && w.w <= 360 && Math.abs(w.x + w.w - (w.sl + w.sw)) <= 2, `it starts as a column docked to the right edge (${JSON.stringify(w)})`);
  ok(await P.ev(`!document.body.classList.contains('wide') && getComputedStyle(document.querySelector('#menuBtn')).display !== 'none'`), 'the column has the drawer (☰)');
  // Settings → Window → Full size.
  await P.ev(`document.querySelector('#menuBtn').click(); document.querySelector('#settingsBtn').click(); true`);
  // Settings is a list of pages in a column (2026-11-20); the window switch is under Notifications (this device).
  await P.until(`!!document.querySelector('#settings .setx-item[data-page=notify]')`);
  await P.ev(`document.querySelector('#settings .setx-item[data-page=notify]').click(); true`);
  ok(await P.until(`!!document.querySelector('#settings .desk-mode [data-mode=full]')`), 'Settings has the Window switch: Column or Full size');
  await P.ev(`document.querySelector('#settings .desk-mode [data-mode=full]').click(); true`);
  ok(await P.until(`outerWidth >= 720`, 5000), 'Full size makes it a normal, wide window');
  w = await P.ev(win);
  ok(Math.abs(w.x - (w.sl + (w.sw - w.w) / 2)) <= 4, `centred the first time (${JSON.stringify(w)})`);
  ok(await P.until(`document.body.classList.contains('wide') && document.querySelector('#side').getBoundingClientRect().width >= 220`), 'with the sidebar');
  ok(await P.ev(`document.querySelector('#settings .desk-mode [data-mode=full]').classList.contains('on')`), 'and Settings shows Full size');
  // Moved somewhere, it remembers, after a restart too.
  await P.ev(`window.moveTo(screen.availLeft + 40, screen.availTop + 30); window.resizeTo(1000, 700); true`);
  await sleep(1200);
  const placed = await P.ev(win);
  const saved = JSON.parse(fs.readFileSync(DIR + '/user/config.json', 'utf8'));
  ok(saved.full === true && saved.fullBounds && Math.abs(saved.fullBounds.width - placed.w) <= 2, `the full-size window’s place is saved (${JSON.stringify(saved.fullBounds)})`);
  await P.close();
  P = await open();
  ok(await P.until(`outerWidth >= 720`, 15000), 'after a restart it opens full size again');
  w = await P.ev(win);
  ok(Math.abs(w.x - placed.x) <= 4 && Math.abs(w.w - placed.w) <= 4 && Math.abs(w.h - placed.h) <= 4, `where it was left (${JSON.stringify(w)} vs ${JSON.stringify(placed)})`);
  // Back to Column.
  await P.ev(`columnDesktop.setConfig({ full: false })`);
  ok(await P.until(`outerWidth <= 360`, 5000), 'back to Column, it’s slim again');
  w = await P.ev(win);
  ok(Math.abs(w.x + w.w - (w.sl + w.sw)) <= 2, `and docked to the right edge (${JSON.stringify(w)})`);
  ok(await P.until(`!document.body.classList.contains('wide')`), 'with the drawer');
  ok(JSON.parse(fs.readFileSync(DIR + '/user/config.json', 'utf8')).full === false, 'and that’s saved');
  await P.close();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  try { app?.kill(); } catch {}
  srv.kill();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
