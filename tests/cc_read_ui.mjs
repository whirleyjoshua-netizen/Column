// A campaign opens to be read (the owner, 2026-11-27: "there is no dedicated read only view. I dont want every view
// to be editable … just be able to click and view, separate from edit"). It shows the brief, progress and every phase
// with its tasks, read only; you tick your own tasks and nothing else. A task opens as a card to read. Edit (the
// planner, as before) is a button away, and Done goes back. Another campaign opens to be read again.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/ccread';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5490, APP = `http://127.0.0.1:${PORT}/`, CDP = 9760;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-ccread`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-ccread`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: SERVER_DIR, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result?.result?.value; };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const mouse = async (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0, clickCount: 1 });
  const at = (expr) => ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  return { ev, until, mouse, at, cmd, errors, close: () => ws.close() };
}
let A;
const T = (sel) => `document.querySelector('#camps ${sel}')`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Read ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'pw-123456' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const st = await api('GET', '/state'); const me = st.me.memberId;
  const camp = await api('POST', '/campaigns', { name: 'Spring Promo', brief: 'Book 20 installs before May', audience: 'Past customers in town' });
  const ph1 = await api('POST', '/goals', { campaignId: camp.id, title: 'Call past customers' });
  const ph2 = await api('POST', '/goals', { campaignId: camp.id, title: 'Book installs' });
  const mine = await api('POST', '/tasks', { goalId: ph1.id, text: 'Call the Lee family', assigneeId: me });
  const theirs = await api('POST', '/tasks', { goalId: ph1.id, text: 'Call the Diaz family', description: 'Ask about the patio' });
  await api('POST', '/tasks', { goalId: ph2.id, text: 'Send quotes' });
  const other = await api('POST', '/campaigns', { name: 'Fall Tune-ups' });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  await A.until(`[...document.querySelectorAll('.camp-card')].some((x) => x.textContent.includes('Spring Promo'))`);
  await A.ev(`[...document.querySelectorAll('.camp-card')].find((x) => x.textContent.includes('Spring Promo')).click(); true`);

  // ---- it opens to be read ----
  ok(await A.until(`!!${T('.cc-read')}`), 'a campaign opens to be read');
  ok(!(await A.ev(`!!${T('.cc-planner')}`)), 'not the planner');
  ok(JSON.stringify(await A.ev(`[...document.querySelectorAll('#camps .cc-tab')].map((x) => x.textContent)`)) === JSON.stringify(['Overview', 'Work', 'Progress']), 'its tabs: Overview, Work, Progress');
  ok(await A.ev(`!!${T('.cc-edit')}`), 'an Edit button');
  ok(!(await A.ev(`!!${T('.cc-add')}`)) && !(await A.ev(`!!${T('.cc-testbtn')}`)), 'no add or test buttons while reading');
  ok(await A.ev(`${T('.cc-read')}.textContent.includes('Book 20 installs before May') && ${T('.cc-read')}.textContent.includes('Past customers in town')`), 'the brief shows');
  await A.ev(`${T('.cc-read-brief')}.click(); [...document.querySelectorAll('#camps .cc-read-brief *')].forEach((x) => x.click?.()); true`);
  ok(!(await A.ev(`!!document.querySelector('#camps .cc-read textarea, #camps .cc-read input:not([type=checkbox])')`)), 'nothing in it turns into a box to type in');
  const phases = await A.ev(`[...document.querySelectorAll('#camps .cc-rphase .cc-rphase-h b')].map((x) => x.textContent)`);
  ok(JSON.stringify(phases) === JSON.stringify(['Call past customers', 'Book installs']), 'every phase shows: ' + JSON.stringify(phases));
  const row = (id) => `document.querySelector('#camps .cc-rrow[data-task="${id}"]')`;
  ok(await A.ev(`!!${row(mine.id)} && !!${row(theirs.id)}`), 'with its tasks');
  ok(await A.ev(`!${row(mine.id)}.querySelector('.check').disabled`), 'my task can be ticked');
  ok(await A.ev(`${row(theirs.id)}.querySelector('.check').disabled`), 'someone else’s can’t');

  // ---- ticking my own ----
  await A.ev(`${row(mine.id)}.querySelector('.check').click(); true`);
  let done = false;
  for (let i = 0; i < 30 && !done; i++) { await sleep(150); done = (await api('GET', '/state')).tasks.find((x) => x.id === mine.id)?.done; }
  ok(done, 'ticking it finishes it');
  ok(await A.until(`${row(mine.id)}?.classList.contains('done')`), 'and it shows done, still reading');
  ok(await A.ev(`!!${T('.cc-read')}`), 'still the read view');

  // ---- a task opens as a card to read ----
  await A.ev(`${row(theirs.id)}.querySelector('.cc-rrow-name').click(); true`);
  ok(await A.until(`!!document.querySelector('#sheet:not(.hidden) .task-read[data-task="${theirs.id}"]')`), 'a task opens as a card to read');
  ok(await A.ev(`document.querySelector('#sheet .task-read').textContent.includes('Ask about the patio')`), 'with its details');
  ok(!(await A.ev(`!!document.querySelector('#sheet .task-read .win-title, #sheet .task-read .td-desc, #sheet .task-read .td-del, #sheet .task-read input[type=date]')`)), 'nothing to change on it');
  ok(await A.ev(`document.querySelector('#sheet .task-read .check')?.disabled === true`), 'not mine: no tick');
  ok(await A.ev(`!!document.querySelector('#sheet .task-read .tr-edit')`), 'and Edit task');
  await A.ev(`document.querySelector('#sheet .task-read .tr-edit').click(); true`);
  ok(await A.until(`!!document.querySelector('#sheet:not(.hidden) .task-win .win-title')`), 'Edit task opens it to change');
  ok(await A.until(`!!${T('.cc-planner')}`), 'and the campaign goes to Edit');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);

  // ---- Done goes back to reading ----
  ok(await A.ev(`!!${T('.cc-done-edit')}`), 'Edit has a Done button');
  await A.ev(`${T('.cc-done-edit')}.click(); true`);
  ok(await A.until(`!!${T('.cc-read')} && !${T('.cc-planner')}`), 'Done goes back to reading');
  await A.ev(`${T('.cc-edit')}.click(); true`);
  ok(await A.until(`!!${T('.cc-planner')}`), 'Edit opens the planner');

  // ---- Work while reading: cards don't move ----
  await A.ev(`${T('.cc-done-edit')}.click(); true`);
  await A.until(`!!${T('.cc-read')}`);
  await A.ev(`${T('.cc-tab[data-ctab=work]')}.click(); true`);
  await A.until(`${T('.cc-body')}?.dataset.tab === 'work'`);
  await A.ev(`(() => { const s = ${T('.cc-wview-sel')}; s.value = 'board'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  ok(await A.until(`!!${T(`.ccb-card[data-task="${theirs.id}"]`)}`), 'Work shows the board');
  const [x0, y0] = await A.at(T(`.ccb-card[data-task="${theirs.id}"]`));
  const [x1, y1] = await A.at(T('.ccb-col[data-col=done] .ccb-list'));
  await A.mouse('mousePressed', x0, y0);
  for (let i = 1; i <= 8; i++) await A.mouse('mouseMoved', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
  await A.mouse('mouseReleased', x1, y1);
  await sleep(600);
  ok(!(await api('GET', '/state')).tasks.find((x) => x.id === theirs.id)?.done, 'dragging a card doesn’t change it while reading');
  ok(!(await A.ev(`${T('.cc-work')}.textContent.includes('Drag a card')`)), 'and it doesn’t say to drag');
  await A.ev(`(() => { const s = ${T('.cc-wview-sel')}; s.value = 'list'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);

  // ---- another campaign opens to be read, even after Edit ----
  await A.ev(`${T('.cc-tab[data-ctab=view]')}.click(); ${T('.cc-edit')}.click(); true`);
  await A.until(`!!${T('.cc-planner')}`);
  await A.ev(`document.querySelector('#camps .cc-back').click(); true`);
  await A.until(`[...document.querySelectorAll('.camp-card')].some((x) => x.textContent.includes('Fall Tune-ups'))`);
  await A.ev(`[...document.querySelectorAll('.camp-card')].find((x) => x.textContent.includes('Fall Tune-ups')).click(); true`);
  ok(await A.until(`!!${T('.cc-read')} && ${T('.cc-name')}.textContent === 'Fall Tune-ups'`), 'another campaign opens to be read');
  ok(await A.ev(`${T('.cc-read')}.textContent.includes('No phases yet')`), 'an empty one says so');
  void other;
  ok(!A.errors.length, 'no page errors: ' + A.errors.join(' | '));
} catch (e) {
  ok(false, 'threw: ' + e.message);
} finally {
  A?.close(); chrome.kill(); srv.kill();
  if (fails) console.log(srv.log.slice(-2000));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
