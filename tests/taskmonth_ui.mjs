// Tasks' Month view (the owner, 2026-11-15): the month on one page, for full size. Each day shows its entries and
// the tasks due, three at most and then "+2 more"; a day's number opens that day; a task or entry drags to another day
// to move it; arrows move a month and Today comes back; this device remembers Month. A phone has Month too.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/taskmonth';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4876, APP = `http://127.0.0.1:${PORT}/`, CDP = 9470;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-tm`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-tm`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Month ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const now = new Date();
  const day = (n) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  const meet = await api('POST', '/entries', { text: 'Crew meeting', date: day(10), start: 9 * 60, end: 10 * 60 });
  const task = await api('POST', '/tasks', { text: 'Order the blinds', due: day(12) });
  for (let i = 1; i <= 5; i++) await api('POST', '/entries', { text: 'Busy ' + i, date: day(15), start: (7 + i) * 60, end: (7 + i) * 60 + 30 });
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000), 'Ada is in');
  await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
  ok(await A.until(`[...document.querySelectorAll('#day .day-modes button')].map((b) => b.textContent).join(',').startsWith('Month,Week,Day,List')`), 'the switch starts with Month');
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'Month')`);
  const cell = (n) => `document.querySelector('#day .mo-cell[data-date="${day(n)}"]')`;
  ok(await A.until(`document.querySelectorAll('#day .mo-cell').length >= 28 && document.querySelectorAll('#day .mo-cell').length % 7 === 0`), 'Month shows whole weeks');
  const title = await A.ev(`document.querySelector('#day .day-title').textContent`);
  ok(title.includes(now.toLocaleDateString(undefined, { month: 'long' })) && title.includes(String(now.getFullYear())), 'titled with the month and year: ' + title);
  ok(await A.ev(`!!document.querySelector('#day .mo-cell.today')`), 'today is marked');
  ok(await A.until(`${cell(10)}?.textContent.includes('Crew meeting')`), 'an entry sits on its day');
  ok(await A.ev(`${cell(12)}.textContent.includes('Order the blinds')`), 'and a task on the day it’s due');
  ok(await A.ev(`${cell(15)}.querySelectorAll('.mo-chip').length === 3 && ${cell(15)}.querySelector('.mo-more')?.textContent === '+2 more'`), 'a full day shows three and “+2 more”');
  const w = await A.ev(`document.querySelector('#day .mo-cell').getBoundingClientRect().width`);
  ok(w > 120, 'each day gets real room at full size: ' + Math.round(w) + 'px');
  if (process.env.SHOT) await A.cmd('Page.captureScreenshot', {}).then((r) => FS.writeFileSync(process.env.SHOT, Buffer.from(r.result.data, 'base64')));
  // Drag to move.
  const drag = (from, to) => `(() => { const a = ${from}, b = ${to}; const dt = new DataTransfer(); const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); ev(a, 'dragstart'); ev(b, 'dragenter'); ev(b, 'dragover'); ev(b, 'drop'); ev(a, 'dragend'); return true; })()`;
  await A.ev(drag(`[...${cell(12)}.querySelectorAll('.mo-chip')].find((c) => c.textContent.includes('Order the blinds'))`, cell(14)));
  let moved = false;
  for (let i = 0; i < 30 && !moved; i++) { moved = (await api('GET', '/state')).tasks.some((x) => x.id === task.id && x.due === day(14)); await sleep(150); }
  ok(moved, 'dragging a task to another day moves its due date');
  ok(await A.until(`${cell(14)}.textContent.includes('Order the blinds') && !${cell(12)}.textContent.includes('Order the blinds')`), 'and it shows there');
  await A.ev(drag(`[...${cell(10)}.querySelectorAll('.mo-chip')].find((c) => c.textContent.includes('Crew meeting'))`, cell(11)));
  moved = false;
  for (let i = 0; i < 30 && !moved; i++) { moved = (await api('GET', '/state')).entries.some((x) => x.id === meet.id && x.date === day(11) && x.start === 9 * 60); await sleep(150); }
  ok(moved, 'dragging an entry moves it to that day, at the same time');
  // "+2 more" and a day's number open that day.
  await A.tap(`${cell(15)}.querySelector('.mo-more')`);
  ok(await A.until(`!document.querySelector('#day .mo-cell') && document.querySelector('#day .date-pick').value === '${day(15)}'`), '“+2 more” opens that day');
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'Month')`);
  await A.tap(`${cell(11)}.querySelector('.mo-num')`);
  ok(await A.until(`!document.querySelector('#day .mo-cell') && document.querySelector('#day .date-pick').value === '${day(11)}'`), 'a day’s number opens that day');
  // Arrows and Today.
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'Month')`);
  await A.ev(`document.querySelector('#day [aria-label="Next month"]').click(); true`);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString(undefined, { month: 'long' });
  ok(await A.until(`document.querySelector('#day .day-title').textContent.includes(${JSON.stringify(next)})`), 'the arrow moves to next month');
  await A.ev(`document.querySelector('#day .day-head .btn').click(); true`);
  ok(await A.until(`!!document.querySelector('#day .mo-cell.today')`), 'Today comes back to this month');
  // An empty bit of a day adds something on it.
  await A.ev(`${cell(20)}.click(); true`);
  ok(await A.until(`!document.querySelector('#sheet').classList.contains('hidden') && document.querySelector('#sheet input[type=date]')?.value === '${day(20)}'`), 'tapping a day’s empty space adds something on that day');
  await A.ev(`document.querySelector('#sheet').classList.add('hidden'); true`);
  // Remembered.
  await A.ev(`location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 15000), 'reloaded');
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  ok(await A.until(`document.querySelectorAll('#day .mo-cell').length >= 28`), 'this device remembers Month');
  // A phone keeps Month.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  ok(await A.until(`document.querySelectorAll('#day .mo-cell').length >= 28 && document.querySelector('#day .mo-grid').getBoundingClientRect().right <= 391`), 'a phone shows the month too, inside the screen');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
