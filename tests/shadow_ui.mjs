// Two functions that were each declared twice in client/app.js, where the second silently replaced the first (found
// by tests/dupnames.mjs): a chat folder's "Folder options" opened the save-to-folder menu for files instead of the
// folder's own (new feed in folder, rename, delete), and starting a checklist run with Enter started a GPS run on the
// Map instead. In a real browser (headless Chrome): both do what they say again.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/shadow_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4878, CDP = 9499, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const key = async (k, code) => { await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, text: k === 'Enter' ? '\r' : undefined }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); await sleep(80); };
  return { ev, until, tap, key, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Shadow ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  await api('POST', '/chat-folders', { name: 'Crews' });
  const c = await api('POST', '/campaigns', { name: 'Onboarding' });
  const l = await api('POST', '/lists', { campaignId: c.id, kind: 'checklist', name: 'Install checklist', columns: ['Step'], rows: [{ cells: ['Measure'] }, { cells: ['Order brackets'] }] });
  ok(l.kind === 'checklist', '(setup) a checklist in a campaign');

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');

  // A chat folder's options are the folder's.
  await A.tap(`[...document.querySelectorAll('#tabs button[data-tab=chat]')].find((e) => e.offsetParent)`);
  ok(await A.until(`!!document.querySelector('.ch-more[aria-label="Folder options"]')`, 10000), 'the Crews folder is in Chat with its options button');
  await A.tap(`document.querySelector('.ch-more[aria-label="Folder options"]')`);
  const menu = await A.ev(`[...document.querySelectorAll('#menu button, #menu .mh')].map((b) => b.textContent).join(' | ')`);
  ok(/New feed in folder/.test(menu) && /Rename folder/.test(menu) && !/Save to folder/.test(menu), `Folder options are the folder’s own (${menu})`);
  await A.key('Escape', 27);

  // Enter in "Start a run…" starts a checklist run, not a Map run.
  await A.ev(`location.href = '/?go=camp:${c.id}'; true`);
  await A.until(`document.readyState === 'complete' && !!document.querySelector('#settingsBtn')`, 20000);
  await A.tap(`[...document.querySelectorAll('.clist-name')].find((b) => b.textContent === 'Install checklist')`);
  await A.tap(`document.querySelector('input[aria-label="Start a run"]')`);
  await A.cmd('Input.insertText', { text: 'Smith house' });
  await A.key('Enter', 13);
  const shown = await A.until(`[...document.querySelectorAll('.run-name')].some((r) => r.textContent === 'Smith house')`);
  if (!shown) console.log(await A.ev(`JSON.stringify({ body: document.querySelector('.clist-body')?.textContent.slice(0, 300), lists: document.querySelectorAll('.clist').length, open: document.querySelectorAll('.clist.open').length })`));
  ok(shown, 'Enter starts a run of the checklist, named as typed, and shows it');
  const runs = (await api('GET', '/state')).lists?.find((x) => x.id === l.id)?.runs || [];
  ok(runs.some((r) => r.name === 'Smith house'), 'on the server too');
  ok(!(await A.ev(`Object.keys(localStorage).some((k) => /mapRun/.test(k) && localStorage.getItem(k) && localStorage.getItem(k) !== 'null')`)) && !(await A.ev(`!!document.querySelector('.ml-btns, .map-run')`)), 'and no Map run was started');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
