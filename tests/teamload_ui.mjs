// Tasks → Team (the owner, 2026-11-15): everyone's week in numbers, for owners and admins, with Projects off too.
// A row per person (hours booked, open, overdue, due, no date, done, visits, campaigns and a day-by-day bar), team totals
// on top, no task text anywhere; tap someone for their week; the arrows move a week. A member has no Team.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/teamload';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5145, APP = `http://127.0.0.1:${PORT}/`, CDP = 9472;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-tl`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-tl`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Team ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
  const ada = api(auth.token);
  const code = (await ada('GET', '/state')).workspace.inviteCode;
  const benAuth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'join', workspace: 'Team ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' }) })).json();
  const ben = api(benAuth.token);
  const benId = (await ada('GET', '/state')).workspace.members.find((x) => x.name === 'Ben').id;
  const now = new Date();
  const k = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  await ada('POST', '/tasks', { text: 'Late install', assigneeId: benId, due: k(yest) });
  await ada('POST', '/tasks', { text: 'Someday thing', assigneeId: benId });
  await ben('POST', '/tasks', { text: 'Secret salary review' });
  await ben('POST', '/entries', { text: 'Site walk', date: k(now), start: 9 * 60, end: 12 * 60 });
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000), 'Ada is in');
  await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
  ok(await A.until(`[...document.querySelectorAll('#day .day-modes button:not(.hidden)')].some((b) => b.textContent === 'Team')`), 'the owner has Team, with Projects off');
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'Team')`);
  const row = `document.querySelector('#day .wl-row[data-member="${benId}"]')`;
  ok(await A.until(`!!${row}`, 8000), 'a row for Ben');
  const stat = (key) => A.ev(`${row}.querySelector('[data-k="${key}"] b').textContent`);
  ok(await stat('open') === '3', 'Ben: 3 open, his own private one included');
  ok(await stat('overdue') === '1' && await A.ev(`${row}.querySelector('[data-k=overdue]').classList.contains('bad')`), '1 overdue, flagged');
  ok(await stat('no date') === '2', '2 with no date');
  ok(await A.ev(`${row}.querySelector('.wl-load').textContent.includes('3 h booked')`), '3 hours booked');
  ok(await A.ev(`${row}.querySelectorAll('.wl-spark .wl-sd').length === 7`), 'a bar for each day');
  ok(await A.ev(`document.querySelector('#day .wl-sum').textContent.includes('open tasks')`), 'team totals on top');
  ok(await A.ev(`!/Secret salary|Late install|Site walk/.test(document.querySelector('#day').textContent)`), 'no task text anywhere, just counts');
  if (process.env.SHOT) await A.cmd('Page.captureScreenshot', {}).then((r) => FS.writeFileSync(process.env.SHOT, Buffer.from(r.result.data, 'base64')));
  await A.tap(row);
  ok(await A.until(`document.querySelector('#sheet h2')?.textContent.includes('Ben’s week') && document.querySelectorAll('#sheet .wl-wd').length === 7`), 'tapping Ben shows his week, day by day');
  ok(await A.ev(`!/Secret salary|Late install|Site walk/.test(document.querySelector('#sheet').textContent)`), 'still no task text');
  await A.ev(`document.querySelector('#sheet').classList.add('hidden'); true`);
  await A.ev(`document.querySelector('#day [aria-label="Next week"]').click(); true`);
  ok(await A.until(`document.querySelector('#day .day-title').textContent.startsWith('Week of') && ${row}?.querySelector('[data-k=overdue] b').textContent === '1' && ${row}.querySelector('.wl-load').textContent.includes('0 h')`), 'the arrow moves a week (nothing booked next week)');
  // With Projects on, the day's job visits board is still there, under the numbers.
  await ada('PATCH', '/workspace', { tools: { projects: true } });
  await sleep(1200);
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'Team')`);
  ok(await A.until(`!!document.querySelector('#day .wl-vh') && document.querySelector('#day .wl-vh').textContent.startsWith('Job visits') && !!document.querySelector('#day .ts')`, 8000), 'with Projects on, the job visits board sits under the numbers');
  ok(await A.ev(`!!${row}`), 'and the numbers stay');
  // Ben (a member) has no Team.
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(benAuth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 15000), 'Ben is in');
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  ok(await A.until(`!!document.querySelector('#day .day-modes') && document.querySelector('#day .day-modes [data-view=team]').classList.contains('hidden')`), 'a member has no Team');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
