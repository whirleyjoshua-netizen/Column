// The campaign planner (the owner, 2026-11-22, simplified 2026-11-25 to the owner's mockup): three columns: the brief
// and where things are, the phases as cards with their tasks as rows, and the panel (a task to change in place, Add
// task for a phase, or At a glance). + From saved on a phase puts saved tasks, bundles and automations into it.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/ccplan';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4951, APP = `http://127.0.0.1:${PORT}/`, CDP = 9589;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-ccplan`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-ccplan`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  await A.until(`!!document.querySelector('.camp-card')`);
  await A.tap(`document.querySelector('.camp-card')`);
  ok(await A.until(`!!${T('.cc-chips')}`), 'the campaign opens');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  // No Pulse beside the page (it heads Report since 2026-11-25): the page has the whole width.
  ok(!(await A.ev(vis('.cc-pulse'))), 'no Pulse down the side');
  ok(await A.ev(`(() => { const m = document.querySelector('#camps .cc-main').getBoundingClientRect(); return m.width > document.querySelector('#camps').getBoundingClientRect().width * 0.9; })()`), 'the page has the whole width');
  // Plan: three columns (2026-11-25: the brief, the phases as cards, the panel).
  await tabTo('plan');
  ok(await A.until(`!!${T('.cc-planner')}`), 'Plan is the planner');
  ok(await A.ev(`(() => { const [l, m, r] = ['.cc-obrief', '.cc-phases', '.cc-ppanel'].map((s) => document.querySelector('#camps ' + s).getBoundingClientRect()); return l.right <= m.left + 1 && m.right <= r.left + 1 && l.width > 150 && r.width > 240; })()`), 'three columns: the brief, the phases, the panel');
  const rows = (i) => `[...document.querySelectorAll('#camps .cc-phase')[${i}].querySelectorAll('.cc-row .cc-row-name')].map((x) => x.textContent)`;
  ok(JSON.stringify(await A.ev(rows(0))) === JSON.stringify(['Call the Lee family', 'Call the Diaz family']), 'a phase’s tasks are its rows: ' + JSON.stringify(await A.ev(rows(0))));
  ok(await A.ev(`(() => { const r = document.querySelector('#camps .cc-row').getBoundingClientRect(); return r.height <= 56; })()`), 'rows are one line');
  // A task in the panel.
  await A.tap(`[...document.querySelectorAll('#camps .cc-row')].find((x) => x.textContent.includes('Call the Diaz family')).querySelector('.cc-row-name')`);
  ok(await A.until(`${T('.cc-ppanel .cc-pp-name')}?.value === 'Call the Diaz family' && ${T('.cc-row.on')}?.textContent.includes('Diaz')`), 'a task opens in the panel, its row marked');
  await A.pick(T('.cc-ppanel .cc-pp-due'), plus(today, 5));
  ok(await A.until(`(async () => (await (await fetch('/api/state', { headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')) } })).json()).tasks.find((x) => x.text === 'Call the Diaz family')?.due === ${JSON.stringify(plus(today, 5))})()`, 5000), 'its due day changes in place');
  await A.tap(`[...document.querySelectorAll('#camps .cc-ppanel .cc-pp-status button')].find((b) => b.textContent === 'Done')`);
  ok(await A.until(`(async () => (await (await fetch('/api/state', { headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')) } })).json()).tasks.find((x) => x.text === 'Call the Diaz family')?.done === true)()`, 5000), 'and its status');
  ok(await A.ev(`['Add tool', 'Add automation'].every((x) => [...document.querySelectorAll('#camps .cc-ppanel .cc-pp-foot button')].some((b) => b.textContent.includes(x)))`), 'Add tool and Add automation under it');
  await A.tap(`[...document.querySelectorAll('#camps .cc-ppanel .cc-pp-foot button')].find((b) => b.textContent.includes('Add tool'))`);
  ok(await A.until(`!!${T('.cc-ptools')}`, 2000), 'Add tool opens the task’s tools (tests/plan_tools_ui.mjs has the rest)');
  await A.tap(T('.cc-ptools .pt-back'));
  // A phase: Add task.
  await A.tap(`document.querySelectorAll('#camps .cc-phase')[1].querySelector('.cc-phase-t')`);
  ok(await A.until(`${T('.cc-ppanel h3')}?.textContent.startsWith('Add task') && ${T('.cc-phase.on')}?.textContent.includes('Book installs') && document.activeElement?.classList.contains('cc-pp-name')`), 'a phase opens Add task for it, ready to type');
  await A.cmd('Input.insertText', { text: 'Measure the windows' });
  await A.tap(T('.cc-ppanel .cc-pp-add'));
  ok(await A.until(`${rows(1)}.includes('Measure the windows')`, 5000), 'Add puts the task in that phase');
  await A.tap(T('.cc-ppanel [aria-label="Back to at a glance"]'));
  ok(await A.until(`${T('.cc-ppanel')}?.textContent.includes('At a glance')`), '× goes back to At a glance');
  // + From saved: a bundle drops its tasks into that phase; an automation is copied onto it.
  await A.tap(`document.querySelectorAll('#camps .cc-phase')[2].querySelector('.cc-phase-saved')`);
  await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Install day'))`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Install day'))`);
  ok(await A.until(`${rows(2)}.includes('Order samples') && ${rows(2)}.includes('Confirm the date')`, 5000), 'a saved bundle drops its tasks into the phase: ' + JSON.stringify(await A.ev(rows(2))));
  await A.tap(`document.querySelectorAll('#camps .cc-phase')[2].querySelector('.cc-phase-saved')`);
  await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Tell me when a call is done'))`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Tell me when a call is done'))`);
  ok(await A.until(`(async () => (await (await fetch('/api/automations', { headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')) } })).json()).some((x) => x.trigger?.step === 'Install'))()`, 5000), 'an automation from saved is copied onto the phase');
  // At a glance and the brief.
  ok(await A.ev(`[...document.querySelectorAll('#camps .cc-obrief h4')].map((x) => x.textContent).join('|') === 'Objective|Audience|Strategy|Success metrics|Where things are' && !!${T('.cc-obrief .cc-bf[data-field=brief]')}`), 'the brief down the left, then where things are');
  ok(await A.ev(`${T('.cc-oidle h3')}?.textContent === 'At a glance' && ${T('.cc-oidle')}.textContent.includes('Team and roles')`), 'At a glance on the right until something is picked');
  // A phone: nothing sideways; the plan stacks, the brief first.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  await tabTo('plan');
  await sleep(300);
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth && !!${T('.cc-phase .cc-row')} && getComputedStyle(${T('.cc-obrief')}).order === '-1'`), 'on a phone the plan fits, nothing sideways, the brief first');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
