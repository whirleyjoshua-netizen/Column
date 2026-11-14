// Dropbox listed inside Kloomie, in a browser, against a stand-in Dropbox: + → From Dropbox opens a sheet (no popup)
// that asks to connect; connecting in the window that opens fills the sheet in by itself; folders open, search works,
// ticked files are added to the stack and the sheet closes.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/dropboxui';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4767, APP = `http://127.0.0.1:${PORT}/`, F_PORT = 4768, CDP = 9467;
const F = `http://127.0.0.1:${F_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

const PDF = Buffer.from('%PDF-1.4 the price list');
const FILES = {
  '': [{ '.tag': 'folder', id: 'id:f1', name: 'Jobs', path_display: '/Jobs' }, { '.tag': 'file', id: 'id:a1', name: 'Price list.pdf', path_display: '/Price list.pdf', size: PDF.length, is_downloadable: true }],
  '/Jobs': [{ '.tag': 'file', id: 'id:b2', name: 'Smith windows.pdf', path_display: '/Jobs/Smith windows.pdf', size: PDF.length, is_downloadable: true }],
};
const all = Object.values(FILES).flat();
const files = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, F);
  // Dropbox's sign-in page, stood in for: it says yes straight away.
  if (u.pathname === '/oauth2/authorize') { res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=good&state=${u.searchParams.get('state')}` }); return res.end(); }
  if (u.pathname === '/oauth2/token') return json(200, { access_token: 'acc', refresh_token: 'ref', expires_in: 14400 });
  const b = body ? JSON.parse(body) : null;
  if (u.pathname === '/2/users/get_current_account') return json(200, { email: 'jo@dropbox.test', name: { display_name: 'Jo' } });
  if (u.pathname === '/2/files/list_folder') return json(200, { entries: FILES[b.path] || [], has_more: false });
  if (u.pathname === '/2/files/search_v2') return json(200, { matches: all.filter((x) => x.name.toLowerCase().includes(b.query.toLowerCase())).map((x) => ({ metadata: { metadata: x } })) });
  if (u.pathname === '/2/files/get_metadata') return json(200, all.find((x) => x.id === b.path));
  if (u.pathname === '/2/files/download') { res.writeHead(200); return res.end(PDF); }
  json(404, {});
});
await new Promise((r) => files.listen(F_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '',
  DROPBOX_APP_KEY: 'testappkey', DROPBOX_APP_SECRET: 'sek', DROPBOX_API: F, DROPBOX_CONTENT: F, DROPBOX_AUTH: F, GOOGLE_PICKER_API_KEY: '', ONEDRIVE_CLIENT_ID: '' }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Page.navigate', { url });
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  return { ev, until, errors, cmd, close: () => ws.close() };
}
try {
  const A = await tab(APP);
  await A.until(`!!document.querySelector('#loginLinks a')`);
  const team = 'dx' + Date.now();
  await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo is in');
  const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
  await A.ev(`(document.querySelector('#toolsBtn').click(), [...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Stacks')))?.click()`);
  ok(await A.until(`!!document.querySelector('.composer .add')`), 'Stacks has its + button');
  await A.ev(`[...document.querySelectorAll('.composer .add')].find((b) => b.offsetParent).click()`);
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'From Dropbox…')`), 'the + menu offers From Dropbox…');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'From Dropbox…').click()`);
  ok(await A.until(`!!document.querySelector('.sheet .dbx') && [...document.querySelectorAll('.sheet button')].some((b) => b.textContent === 'Connect Dropbox')`), 'a sheet opens inside Kloomie, asking to connect Dropbox');
  await A.ev(`[...document.querySelectorAll('.sheet button')].find((b) => b.textContent === 'Connect Dropbox').click()`);
  ok(await A.until(`document.querySelectorAll('.sheet .dbx-row').length === 2`, 12000), 'after saying yes in the Dropbox window, the sheet fills in by itself');
  ok(await A.ev(`document.querySelector('.sheet .dbx-row').textContent.includes('Jobs') && document.querySelector('.sheet .dbx-foot').textContent.includes('jo@dropbox.test')`), 'folders first, and it shows whose Dropbox');
  await A.ev(`document.querySelector('.sheet .dbx-folder').click()`);
  ok(await A.until(`[...document.querySelectorAll('.sheet .dbx-row')].some((r) => r.textContent.includes('Smith windows.pdf')) && document.querySelector('.dbx-crumbs').textContent.includes('Jobs')`), 'opening a folder shows its files, with the path to go back');
  await A.ev(`[...document.querySelectorAll('.sheet .dbx-row')].find((r) => r.textContent.includes('Smith windows.pdf')).querySelector('input').click()`);
  ok(await A.ev(`document.querySelector('.dbx-count').textContent === '1 picked'`), 'ticking a file counts it');
  await A.ev(`(() => { const s = document.querySelector('.sheet input[type=search]'); s.value = 'price'; s.dispatchEvent(new Event('input')); })()`);
  ok(await A.until(`document.querySelectorAll('.sheet .dbx-row').length === 1 && document.querySelector('.sheet .dbx-row').textContent.includes('Price list.pdf')`), 'search finds a file in another folder');
  await A.ev(`document.querySelector('.sheet .dbx-row input').click()`);
  ok(await A.ev(`document.querySelector('.dbx-count').textContent === '2 picked'`), 'and ticking it keeps the first one too');
  const shot = await A.cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(DIR + '/sheet.png', Buffer.from(shot.result.data, 'base64'));
  await A.ev(`[...document.querySelectorAll('.sheet .btns button')].find((b) => b.textContent === 'Add').click()`);
  ok(await A.until(`document.querySelector('#sheet').classList.contains('hidden')`), 'Add closes the sheet');
  let names = [];
  for (let i = 0; i < 60 && names.length < 2; i++) {
    const s2 = await (await fetch(APP + 'api/state', { headers: { authorization: 'Bearer ' + tok } })).json();
    names = s2.items.filter((x) => x.from === 'Dropbox' && x.size === PDF.length).map((x) => x.name);
    if (names.length < 2) await sleep(150);
  }
  ok(names.includes('Smith windows.pdf') && names.includes('Price list.pdf'), 'both files land in the stack, every byte');
  ok(await A.until(`document.body.textContent.includes('Smith windows.pdf')`), 'and show up on the page');
  ok(!A.errors.length, 'no errors on the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
  A.close();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  chrome.kill();
  srv.kill();
  files.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
