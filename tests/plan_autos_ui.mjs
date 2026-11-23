// Automations right from the plan (the owner, 2026-11-23: "with per task automation"). Under a phase or a task,
// ⚡ Add automation opens them in the panel: what runs there (on/off), ready-made ones in a tap, a small When → Then
// builder, and a copy of one you have. Dragging one from Autos onto a phase or a task copies it there, and a saved task
// dragged onto a phase goes into that phase (not the one picked before). A tile shows how many run on it.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/planautos';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5461, APP = `http://127.0.0.1:${PORT}/`, CDP = 9661;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-planautos`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-planautos`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(80); };
  return { ev, until, tap, mouse, cmd, pick, errors, close: () => ws.close() };
}
let A;
const T = (sel) => `document.querySelector('#camps ${sel}')`;
const tabTo = async (k) => { await A.ev(`${T(`.cc-tab[data-ctab=${k}]`)}.click(); true`); await A.until(`${T('.cc-body')}?.dataset.tab === '${k}'`); };

const vis = (sel) => `(() => { const e = document.querySelector('#camps ${sel}') || document.querySelector('${sel}'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Plan ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const st = await api('GET', '/state'); const me = st.me.memberId; const today = st.today || new Date().toISOString().slice(0, 10);
  const plus = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const camp = await api('POST', '/campaigns', { name: 'Spring Promo', brief: 'Book installs', start: plus(today, -3), end: plus(today, 60) });
  await api('PATCH', '/campaigns/' + camp.id, { assigneeId: me });
  const ph = []; for (const n of ['Call past customers', 'Book installs', 'Install']) ph.push(await api('POST', '/goals', { campaignId: camp.id, title: n }));
  const a = await api('POST', '/tasks', { goalId: ph[0].id, text: 'Call the Lee family', assigneeId: me, due: plus(today, -3) });
  await api('POST', '/tasks', { goalId: ph[0].id, text: 'Call the Diaz family' });
  await api('POST', '/tasks', { goalId: ph[0].id, text: 'Ask about the patio', parentId: a.id });
  await api('POST', '/tasks', { goalId: ph[1].id, text: 'Send quotes' });
  const saved = await api('POST', '/task-presets', { kind: 'task', text: 'Order samples', name: 'Order samples' });
  const s2 = await api('POST', '/task-presets', { kind: 'task', text: 'Confirm the date', name: 'Confirm the date' });
  await api('POST', '/task-presets', { kind: 'bundle', name: 'Install day', steps: [{ presetId: saved.id }, { presetId: s2.id, after: 1 }] });
  const au = await api('POST', '/automations', { name: 'Tell me when a call is done', trigger: { kind: 'task.done', campaignId: camp.id }, actions: [{ kind: 'notify', text: 'Done', to: [me] }] });
  const autosNow = async () => api('GET', '/automations');
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  await A.until(`!!document.querySelector('.camp-card')`);
  await A.tap(`document.querySelector('.camp-card')`);
  await A.until(`!!${T('.cc-kpis')}`);
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  await tabTo('plan');
  await A.until(`!!${T('.cc-planner')}`);
  const tile = (txt) => `[...document.querySelectorAll('#camps .cc-ptree .cc-ttile')].find((x) => x.querySelector('.cc-tt-t').textContent === ${JSON.stringify(txt)})`;
  const say = (v) => A.ev(`(() => { const i = ${T('.cc-pauto .pa-say')}; i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

  // A task: ⚡ Add automation opens its automations in the panel.
  await A.tap(tile('Call the Lee family'));
  await A.until(`${T('.cc-ppanel .cc-pp-name')}?.value === 'Call the Lee family'`);
  await A.tap(T('.cc-pp-auto'));
  ok(await A.until(`${T('.cc-pauto')}?.dataset.for === 'task' && ${T('.cc-pauto h3')}.textContent.includes('Call the Lee family')`), '⚡ Add automation on a task opens that task’s automations in the panel');
  ok(await A.ev(`${T('.cc-pauto .pa-here')}.textContent.includes('Nothing runs')`), 'nothing runs for it yet');
  // Ready-made, in a tap.
  await A.tap(T('.cc-pauto .pa-recipe[data-recipe=t-owners]'));
  let list = [];
  for (let i = 0; i < 30 && !list.some((x) => x.trigger.taskId === a.id); i++) { await sleep(150); list = await autosNow(); }
  const own = list.find((x) => x.trigger.taskId === a.id);
  ok(own && own.trigger.kind === 'task.done' && own.trigger.step === 'Call past customers' && own.trigger.task === 'Call the Lee family' && own.on, 'a ready-made one is on for that task alone: ' + JSON.stringify(own?.trigger));
  ok(await A.until(`${T('.cc-pauto .pa-here .pa-row')} && !${T('.cc-pauto .pa-recipe[data-recipe=t-owners]')}`), 'it’s listed under Running here, and gone from Ready-made');
  ok(await A.until(`${tile('Call the Lee family')}?.querySelector('.cc-auto-n')?.textContent === '⚡1' && !${tile('Call the Diaz family')}.querySelector('.cc-auto-n')`), 'its tile shows ⚡1 (the other task’s doesn’t)');
  // Build one here: when it opens, tell me, after 2 days, only if it isn't done.
  await A.pick(T('.cc-pauto .pa-when'), 'task.opened');
  await A.pick(T('.cc-pauto .pa-then'), 'm:' + me);
  await A.pick(T('.cc-pauto .pa-wait'), '2');
  ok(await A.ev(`${T('.cc-pauto .pa-say')}.value === 'Your turn: {task} ({step})' && !${T('.cc-pauto .pa-only')}.hidden`), 'it fills in what it says, and says it only goes if it isn’t done by then');
  await say('Still not called: {task}');
  await A.tap(T('.cc-pauto .pa-save'));
  for (let i = 0; i < 30 && list.filter((x) => x.trigger.taskId === a.id).length < 2; i++) { await sleep(150); list = await autosNow(); }
  const built = list.find((x) => x.trigger.taskId === a.id && x.trigger.kind === 'task.opened');
  ok(built && built.actions[0].kind === 'wait' && built.actions[0].amount === 2 && built.actions[1].kind === 'if' && built.actions[1].then[0].to[0] === me && built.actions[1].then[0].text === 'Still not called: {task}', 'Build one here makes it: wait 2 days, then if not done, tell that person: ' + JSON.stringify(built?.actions));
  ok(await A.until(`${tile('Call the Lee family')}?.querySelector('.cc-auto-n')?.textContent === '⚡2'`), 'the tile now shows ⚡2');
  // The switch turns one off.
  await A.tap(`${T(`.cc-pauto .pa-row[data-auto="${own.id}"] .toggle`)}`);
  for (let i = 0; i < 30; i++) { list = await autosNow(); if (list.find((x) => x.id === own.id)?.on === false) break; await sleep(150); }
  ok(list.find((x) => x.id === own.id)?.on === false, 'its switch turns it off');
  // Back to the task.
  await A.tap(T('.cc-pauto .pa-back'));
  ok(await A.until(`${T('.cc-ppanel .cc-pp-name')}?.value === 'Call the Lee family' && !${T('.cc-pauto')}`), 'back goes to the task');

  // A phase: its own automations, and a copy of one you have.
  await A.tap(`document.querySelectorAll('#camps .cc-ptile.phase')[1]`);
  await A.until(`${T('.cc-ppanel h3')}?.textContent.startsWith('Add task')`);
  await A.tap(T('.cc-pp-auto'));
  ok(await A.until(`${T('.cc-pauto')}?.dataset.for === 'phase' && ${T('.cc-pauto h3')}.textContent.includes('Book installs')`), 'on a phase it opens the phase’s automations');
  await A.pick(T('.cc-pauto .pa-when'), 'step.done');
  ok(await A.ev(`${T('.cc-pauto .pa-then option[value=doers]')}.disabled && ${T('.cc-pauto .pa-then')}.value !== 'doers'`), '“the phase is finished” can’t go to “whoever it’s for”');
  await A.pick(T('.cc-pauto .pa-copy'), au.id);
  await A.tap(T('.cc-pauto .pa-copy-go'));
  for (let i = 0; i < 30 && !list.some((x) => x.trigger.step === 'Book installs'); i++) { await sleep(150); list = await autosNow(); }
  const copy = list.find((x) => x.trigger.step === 'Book installs');
  ok(copy && copy.id !== au.id && !copy.trigger.task && copy.trigger.campaignId === camp.id && list.find((x) => x.id === au.id)?.trigger.step == null, 'Copy here makes a copy for the phase; the one you had is left as it was');
  ok(await A.until(`document.querySelectorAll('#camps .cc-ptile.phase')[1].querySelector('.cc-auto-n')?.textContent.includes('⚡1')`), 'the phase tile shows ⚡1');
  ok(await A.ev(`!${T('.cc-pauto .pa-here')}.textContent.includes('Call the Lee')`), 'a task’s automations aren’t listed as the phase’s');

  // Drag from Autos onto a task.
  const drag = async (fromExpr, toExpr) => A.ev(`(() => { const f = ${fromExpr}, t = ${toExpr}; const dt = new DataTransfer(); f.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); return true; })()`);
  const lib = (txt) => `[...document.querySelectorAll('#camps .cc-plib .cc-lib-item')].find((b) => b.textContent.includes(${JSON.stringify(txt)}))`;
  await drag(lib('Tell me when a call is done'), tile('Send quotes'));
  const sq = st.tasks?.find?.((x) => x.text === 'Send quotes');
  for (let i = 0; i < 30 && !list.some((x) => x.trigger.task === 'Send quotes'); i++) { await sleep(150); list = await autosNow(); }
  const dropped = list.find((x) => x.trigger.task === 'Send quotes');
  ok(dropped && dropped.trigger.step === 'Book installs' && dropped.trigger.taskId, 'an automation dragged from Autos onto a task is copied for that task');
  // A saved task dragged onto a phase goes into that phase, not the one picked.
  await drag(lib('Order samples'), `document.querySelectorAll('#camps .cc-pt-phase')[2]`);
  const kids = (i) => `[...document.querySelectorAll('#camps .cc-ptree .cc-pt-phase')[${i}].querySelectorAll(':scope > .cc-pt-kids > .cc-pt-node > .cc-ttile')].map((x) => x.querySelector('.cc-tt-t').textContent)`;
  ok(await A.until(`${kids(2)}.includes('Order samples') && !${kids(1)}.includes('Order samples')`, 5000), 'a saved task dragged onto a phase goes into that phase: ' + JSON.stringify(await A.ev(kids(2))));

  // The full builder shows the task.
  await A.tap(tile('Call the Lee family'));
  await A.tap(T('.cc-pp-auto'));
  await A.until(`!!${T('.cc-pauto .pa-row')}`);
  await A.tap(T(`.cc-pauto .pa-row[data-auto="${built.id}"] .pa-open`));
  ok(await A.until(`document.querySelector('.auto-task-name')?.value === 'Call the Lee family'`, 4000), 'opened in the full builder, it shows its task');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
srv.kill();
try { chrome.kill(); } catch {}
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
