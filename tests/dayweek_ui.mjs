// Full size (2026-11-14): Day has a Week view: seven days side by side on one timeline. Day | Week switch (this
// device remembers), arrows move a week, today is marked with the now line, a day's name opens that day, tapping an
// empty slot adds at that day and time, dragging a block moves it, and the week view never shows in a narrow window.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/dayweek';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4861, APP = `http://127.0.0.1:${PORT}/`, CDP = 9490;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-week`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-week`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Week ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=day]')`, 15000), 'Ada is in');
  const today = await A.ev(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);
  const sunday = await A.ev(`(() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);
  const plus = (k, n) => { const d = new Date(k + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const wed = plus(sunday, 3);
  await api('POST', '/entries', { text: 'Crew meeting', date: wed, start: 9 * 60, end: 10 * 60 });
  await api('POST', '/entries', { text: 'Today block', date: today, start: 14 * 60, end: 15 * 60 });
  await A.ev(`document.querySelector('#tabs [data-tab=day]').click(); true`);
  ok(await A.until(`!!document.querySelector('#day .day-modes [data-view=week]')`), 'full size: Week in the view switch');
  await A.tap(`document.querySelector('#day .day-modes [data-view=week]')`);
  ok(await A.until(`document.querySelectorAll('#day .wk-col').length === 7`), 'Week shows seven days');
  const heads = await A.ev(`[...document.querySelectorAll('#day .wk-dh')].map((x) => x.dataset.date)`);
  ok(heads[0] === sunday && heads[6] === plus(sunday, 6), `Sunday to Saturday of this week (${heads[0]}…${heads[6]})`);
  ok(await A.until(`[...document.querySelectorAll('#day .wk-col[data-date="${wed}"] .block')].some((b) => b.textContent.includes('Crew meeting'))`), 'a block sits in its day’s column');
  ok(await A.ev(`!!document.querySelector('#day .wk-col[data-date="${today}"] .now') && document.querySelector('#day .wk-dh[data-date="${today}"]').classList.contains('today')`), 'today is marked, with the now line');
  const w = await A.ev(`(() => { const c = document.querySelectorAll('#day .wk-col'); return [c[0].getBoundingClientRect().width, document.querySelector('#day').getBoundingClientRect().width]; })()`);
  ok(w[0] > 100, `each day gets real room (${Math.round(w[0])}px of ${Math.round(w[1])})`);
  // Remembered.
  await A.ev(`location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 15000), 'reloaded');
  await A.ev(`document.querySelector('#tabs [data-tab=day]').click(); true`);
  ok(await A.until(`document.querySelectorAll('#day .wk-col').length === 7`), 'this device remembers Week');
  // Arrows move a week.
  await A.tap(`document.querySelector('#day [aria-label="Next week"]')`);
  ok(await A.until(`document.querySelector('#day .wk-dh')?.dataset.date === '${plus(sunday, 7)}'`), 'the arrow moves to next week');
  await A.tap(`document.querySelector('#day .day-head .btn')`);
  ok(await A.until(`document.querySelector('#day .wk-dh')?.dataset.date === '${sunday}'`), 'Today comes back to this week');
  // Tap an empty slot: add at that day and time.
  await A.ev(`(() => { const c = document.querySelector('#day .wk-col[data-date="${wed}"]'); c.scrollIntoView({ block: 'nearest' }); return true; })()`);
  const at = await A.ev(`(() => { const c = document.querySelector('#day .wk-col[data-date="${wed}"]'); const r = c.getBoundingClientRect(); const h0 = c._h0; const y = r.top + (13 - h0) * 56 + 5; document.querySelector('#day .day-scroll').scrollTop += y - 400; const r2 = c.getBoundingClientRect(); return [r2.left + r2.width / 2, r2.top + (13 - h0) * 56 + 5]; })()`);
  for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await A.cmd('Input.dispatchMouseEvent', { type: ty, x: at[0], y: at[1], button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 });
  ok(await A.until(`!document.querySelector('#sheet').classList.contains('hidden')`), 'tapping an empty slot opens a new entry');
  ok(await A.ev(`(() => { const d = document.querySelector('#sheet input[type=date]'); const t = document.querySelector('#sheet input[type=time]'); return d?.value === '${wed}' && t?.value === '13:00'; })()`), 'for that day, at that time');
  await A.ev(`document.querySelector('#sheet .sheet-x, #sheet [aria-label=Close]')?.click(); document.querySelector('#sheet').classList.add('hidden'); true`);
  // Drag the block down an hour.
  const b = await A.ev(`(() => { const e = [...document.querySelectorAll('#day .wk-col[data-date="${wed}"] .block')].find((x) => x.textContent.includes('Crew meeting')); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 12]; })()`);
  await A.mouse('mouseMoved', b[0], b[1]); await A.mouse('mousePressed', b[0], b[1]);
  for (let i = 1; i <= 8; i++) { await A.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b[0], y: b[1] + i * 7, button: 'left', buttons: 1 }); await sleep(20); }
  await A.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b[0], y: b[1] + 56, button: 'left', buttons: 0, clickCount: 1 });
  let moved = false;
  for (let i = 0; i < 30 && !moved; i++) { moved = (await api('GET', '/state')).entries.some((e) => e.text === 'Crew meeting' && e.start === 10 * 60 && e.date === wed); await sleep(150); }
  ok(moved, 'dragging a block down an hour moves it to 10:00');
  // A day's name opens that day.
  await A.tap(`document.querySelector('#day .wk-dh[data-date="${wed}"]')`);
  ok(await A.until(`!document.querySelector('#day .wk-col') && document.querySelector('#day .date-pick').value === '${wed}'`), 'a day’s name opens that day');
  // Narrow: never the week.
  await A.tap(`document.querySelector('#day .day-modes [data-view=week]')`);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  ok(await A.until(`!document.querySelector('#day .wk-col') && !!document.querySelector('#day .timeline')`), 'a phone shows one day, even with Week picked');
  ok(await A.ev(`getComputedStyle(document.querySelector('#day .day-modes [data-view=week]')).display === 'none'`), 'and no Week in the switch');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
