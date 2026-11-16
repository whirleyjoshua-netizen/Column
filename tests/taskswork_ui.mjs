// Tasks in Workspace (the owner, 2026-11-15): Day isn't a main tab any more. It's Tasks, the first of Workspace's tabs,
// and opening Workspace lands on it. One switch picks the view: Week, Day, List (the task list) and, for owners and
// admins, Team. A phone has no Week, but still has Month, Day and List.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/taskswork';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4874, APP = `http://127.0.0.1:${PORT}/`, CDP = 9468;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-tw`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-tw`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Tasks ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  await api('POST', '/tasks', { text: 'Order the blinds' });
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000), 'Ada is in');
  const main = await A.ev(`[...document.querySelectorAll('#tabs > button[data-tab]:not(.tab-sub)')].map((b) => b.dataset.tab).join(',')`);
  ok(!main.split(',').includes('day'), 'Day isn’t a main tab any more: ' + main);
  await A.tap(`document.querySelector('#tabs [data-tab=chat]')`);
  await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
  ok(await A.until(`!document.querySelector('#day').classList.contains('hidden')`), 'opening Workspace lands on Tasks');
  ok(await A.until(`(() => { const b = document.querySelector('#workTabs button[data-tab]'); return b?.dataset.tab === 'day' && b.textContent === 'Tasks' && b.classList.contains('on'); })()`), 'Tasks is Workspace’s first tab, and it’s marked');
  const modes = await A.ev(`[...document.querySelectorAll('#day .day-modes button:not(.hidden)')].map((b) => b.textContent).join(',')`);
  ok(modes === 'Month,Week,Day,List,Team', 'one switch for the view: ' + modes);
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'List')`);
  ok(await A.until(`document.querySelector('#day').textContent.includes('Order the blinds') && !document.querySelector('#day .wk-col')`), 'List shows the tasks');
  ok(await A.ev(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'List').classList.contains('on')`), 'and is marked');
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'Week')`);
  ok(await A.until(`document.querySelectorAll('#day .wk-col').length === 7`), 'Week shows seven days');
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'Day')`);
  ok(await A.until(`!document.querySelector('#day .wk-col') && !!document.querySelector('#day .timeline')`), 'Day shows one day');
  // Another Workspace tab, then back to Workspace from Chat: Tasks again.
  await A.tap(`[...document.querySelectorAll('#workTabs button')].find((b) => b.dataset.tab === 'camps')`);
  ok(await A.until(`document.querySelector('#day').classList.contains('hidden')`), 'Campaigns opens from Workspace');
  await A.tap(`document.querySelector('#tabs [data-tab=chat]')`);
  await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
  ok(await A.until(`!document.querySelector('#day').classList.contains('hidden')`), 'Workspace opens on Tasks every time');
  // A phone: no Week, the rest stay.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const phone = await A.ev(`[...document.querySelectorAll('#day .day-modes button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent).join(',')`);
  ok(phone === 'Month,Day,List,Team', 'a phone has Month, Day, List and Team: ' + phone);
  ok(await A.ev(`!!document.querySelector('#tabs .tab-sub[data-tab=day]') && document.querySelector('#tabs .tab-sub[data-tab=day]').textContent === 'Tasks'`), 'in the drawer, Tasks sits under Workspace');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
