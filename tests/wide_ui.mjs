// Full size in a desktop browser (2026-11-16, the owner: pages still sit in a column in the middle): tools, Settings
// and Home use the width at 900px and wider: Agents' specialists side by side, Settings' sections in columns, Docs,
// Folders, Contacts and Automations across the page; a phone keeps its single column.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/wide';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4863, APP = `http://127.0.0.1:${PORT}/`, CDP = 9492;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-wide`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-wide`, '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const mouse = async (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0, clickCount: 1 });
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(80); };
  return { ev, until, tap, mouse, cmd, errors, close: () => ws.close() };
}
let A;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Wide ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  await api('PATCH', '/workspace', { tools: { projects: true, agents: true } });
  for (const n of ['Pat Lee', 'Robin Diaz', 'Alex Kim']) await api('POST', '/contacts', { name: n, email: n.split(' ')[0].toLowerCase() + '@ex.test' });
  for (const ti of ['Handbook', 'Call script', 'Install checklist']) await api('POST', '/items', { type: 'text', doc: { title: ti, blocks: [{ id: 'a', type: 'p', runs: [{ text: 'About ' + ti }] }] } });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=agents]')`, 15000), 'Ada is in, at 1440px');
  // How much of the page beside the sidebar a thing spans.
  const span = (sel) => A.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const m = document.querySelector('#main').getBoundingClientRect(); if (!e) return 0; const r = e.getBoundingClientRect(); return Math.round(r.width / m.width * 100); })()`);
  const cols = (sel) => A.ev(`new Set([...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => Math.round(e.getBoundingClientRect().top))).size && [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e, i, all) => Math.round(e.getBoundingClientRect().top) === Math.round(all[0].getBoundingClientRect().top)).length`);
  await A.ev(`document.querySelector('#tabs [data-tab=home]').click(); true`);
  await A.until(`!!document.querySelector('#home .home-grid')`);
  let w = await span('#home .home-grid'); ok(w >= 90, `Home spans the page (${w}%)`);
  await A.ev(`document.querySelector('#tabs [data-tab=agents]').click(); true`);
  await A.until(`document.querySelectorAll('#tool .ag-card').length === 4`, 8000);
  w = await span('#tool .ag-cards'); ok(w >= 90, `Agents spans the page (${w}%)`);
  let c = await cols('#tool .ag-card'); ok(c >= 2, `and the specialists sit side by side (${c} in the first row)`);
  await A.ev(`document.querySelector('#tabs [data-tab=contacts]').click(); true`);
  await A.until(`!!document.querySelector('#tool .ct-table')`);
  // With the Groups list beside the table (2026-11-19), the two together span the page.
  w = await span('#tool .ct-layout'); ok(w >= 90, `Contacts (groups and table) spans the page (${w}%)`);
  await A.ev(`document.querySelector('#tabs [data-tab=docs]').click(); true`);
  await A.until(`document.querySelectorAll('#tool .doc-row').length >= 3`);
  w = await span('#tool .docs-list'); ok(w >= 90, `Docs spans the page (${w}%)`);
  c = await cols('#tool .doc-row'); ok(c >= 2, `with docs side by side (${c} in the first row)`);
  await A.ev(`document.querySelector('#tool .df-switch [data-df=folders]').click(); true`);
  await A.until(`!!document.querySelector('#tool .dir-crumbs')`);
  w = await span('#tool .dir-body'); ok(w >= 90, `Folders spans the page (${w}%)`);
  await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`);
  await A.until(`document.querySelectorAll('#tool .auto-recipe').length >= 3`);
  w = await span('#tool .auto-recipes'); ok(w >= 90, `Automations spans the page (${w}%)`);
  c = await cols('#tool .auto-recipe'); ok(c >= 4, `with its recipes four or more across (${c})`);
  await A.ev(`document.querySelector('#settingsBtn').click(); true`);
  await A.until(`!document.querySelector('#settings').classList.contains('hidden') && document.querySelectorAll('#settings > section').length >= 2`);
  w = await A.ev(`(() => { const ss = [...document.querySelectorAll('#settings > section')]; const m = document.querySelector('#main').getBoundingClientRect(); return Math.round((Math.max(...ss.map((e) => e.getBoundingClientRect().right)) - Math.min(...ss.map((e) => e.getBoundingClientRect().left))) / m.width * 100); })()`); ok(w >= 90, `Settings’ sections span the page (${w}%)`);
  c = await cols('#settings > section'); ok(c >= 2, `with its sections in columns (${c} in the first row)`);
  ok(await A.ev(`[...document.querySelectorAll('#settings p')].every((p) => p.getBoundingClientRect().width <= 920)`), 'long text stays a readable width');
  // A phone: one column, as before.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  c = await cols('#settings > section'); ok(c === 1, 'a phone keeps one column');
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'nothing spills sideways on a phone');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
