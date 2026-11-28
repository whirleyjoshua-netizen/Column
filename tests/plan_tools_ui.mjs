// Tools right from the plan (the owner, 2026-11-23: "add tool"). Under a task, 🧰 Add tool picks what it's done with
// (an email, a signature, a payment, files, a call list, a meeting: it ticks itself off when that's done) and starts it,
// and keeps its checklist; under a phase, its resources, what it needs, and a tool for each task. Members get it too
// (automations stay with owners and admins). A task's tile shows its tool.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/plantools';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5463, APP = `http://127.0.0.1:${PORT}/`, CDP = 9663;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-plantools`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-plantools`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const code = st.workspace.inviteCode;
  const sam = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'join', workspace: 'Plan ' + t, code, name: 'Sam', email: `s${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' }) })).json();
  const taskNow = async (txt) => (await api('GET', '/state')).tasks.find((x) => x.text === txt);
  const goalNow = async (id) => (await api('GET', '/state')).goals.find((x) => x.id === id);
  const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(150); } return v; };
  A = await tab(APP);
  const open = async (token) => {
    await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
    await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
    await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(token)})); location.reload(); true`).catch(() => {});
    await sleep(500);
    await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
    await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
    await A.until(`!!document.querySelector('.camp-card') || !!${T('.cc-chips')} || !!${T('.cc-edit')}`);
    if (!(await A.ev(`!!${T('.cc-chips')} || !!${T('.cc-edit')}`))) await A.tap(`document.querySelector('.camp-card')`); await A.until(`!!document.querySelector('#camps .cc-edit, #camps .cc-done-edit')`); await A.ev(`document.querySelector('#camps .cc-edit')?.click(); true`); // a campaign opens to be read: Edit (2026-11-27)
    await A.until(`!!${T('.cc-chips')}`);
    await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
    await tabTo('plan');
    await A.until(`!!${T('.cc-planner')}`);
  };
  await open(auth.token);
  const tile = (txt) => `[...document.querySelectorAll('#camps .cc-row')].find((x) => x.querySelector('.cc-row-name').textContent === ${JSON.stringify(txt)})`;

  // A task: what it's done with.
  await A.tap(`${tile('Call the Lee family')}.querySelector('.cc-row-name')`);
  await A.until(`${T('.cc-ppanel .cc-pp-name')}?.value === 'Call the Lee family'`);
  await A.tap(T('.cc-pp-tool'));
  ok(await A.until(`${T('.cc-ptools')}?.dataset.for === 'task' && ${T('.cc-ptools h3')}.textContent.includes('Call the Lee family')`), '🧰 Add tool on a task opens its tools in the panel (no more “coming soon”)');
  ok(await A.ev(`document.querySelectorAll('#camps .cc-ptools .pt-k').length === 7 && ${T('.pt-k[data-kind=none]')}.classList.contains('on')`), 'seven choices (no tool, and the six tools), no tool picked yet');
  await A.tap(T('.pt-k[data-kind=email]'));
  ok((await waitFor(async () => (await taskNow('Call the Lee family'))?.action?.kind === 'email')), 'picking “Send an email” saves it on the task');
  ok(await A.until(`${T('.pt-k[data-kind=email]')}?.classList.contains('on') && ${T('.pt-start')}?.textContent.includes('Send email')`), 'it’s marked, with a Send email button to start it');
  ok(await A.until(`${tile('Call the Lee family')}?.querySelector('.cc-tool-ic')?.textContent === '✉️'`), 'the task’s row shows ✉️');
  await A.tap(T('.pt-start'));
  ok(await A.until(`!document.querySelector('#split').classList.contains('hidden') && /email/i.test(document.querySelector('#split').textContent) && !!${T('.cc-ptools')}`, 4000), 'Send email opens Email beside the plan');
  ok(await A.until(`(() => { const [a, b] = ['.cc-phases', '.cc-ptools'].map((x) => document.querySelector('#camps ' + x).getBoundingClientRect()); return a.width > 240 && b.left >= a.right - 1; })()`), 'with Email open, the plan and its panel sit side by side, not squeezed into three columns (found in the browser check)');
  await A.tap(`document.querySelector('#split .split-close')`);
  ok(await A.until(`document.querySelector('#split').classList.contains('hidden') || !document.querySelector('#split .split-close')`), 'and it closes');
  ok(await A.until(`!!${T('.cc-ptools')}`), 'back on the plan, its tools are still there');
  // Its checklist.
  const type = async (sel, v) => A.ev(`(() => { const i = ${T(sel)}; i.focus(); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  await type('.pt-cl-add', 'Check the address');
  await A.until(`document.querySelectorAll('#camps .pt-cl-item').length === 1`);
  await type('.pt-cl-add', 'Leave a voicemail');
  ok(await A.until(`document.querySelectorAll('#camps .pt-cl-item').length === 2`), 'Enter adds checklist items');
  ok(await A.until(`document.activeElement === ${T(".pt-cl-add")}`, 3000), "and keeps typing in the box");
  await A.tap(`document.querySelectorAll('#camps .pt-cl-item input')[0]`);
  let tk = await waitFor(async () => { const x = await taskNow('Call the Lee family'); return x?.checklist?.[0]?.done && x; });
  ok(tk && tk.checklist.length === 2 && tk.checklist[0].text === 'Check the address' && !tk.checklist[1].done, 'ticking one saves it');
  ok(await A.until(`${T('.pt-cl h4')}.textContent.includes('1 of 2')`), 'the count says 1 of 2');
  await A.tap(`document.querySelectorAll('#camps .pt-cl-x')[1]`);
  ok(await waitFor(async () => (await taskNow('Call the Lee family'))?.checklist?.length === 1), '× removes one');
  // No tool again.
  await A.tap(T('.pt-k[data-kind=none]'));
  ok(await waitFor(async () => (await taskNow('Call the Lee family'))?.action == null) && await A.until(`!${T('.pt-start')} && !${tile('Call the Lee family')}.querySelector('.cc-tool-ic')`), '“No tool” takes it off');

  // Its phase's tools.
  await A.tap(T('.pt-phase'));
  ok(await A.until(`${T('.cc-ptools')}?.dataset.for === 'phase' && ${T('.cc-ptools h3')}.textContent.includes('Call past customers')`), '“Tools for the phase →” opens the phase’s tools');
  ok(await A.ev(`!!${T('.pt-res .res-panel')} && !!${T('.pt-needs')} && document.querySelectorAll('#camps .pt-each .pt-row').length === 2`), 'resources, what it needs, and a tool for each of its 2 tasks');
  await A.pick(`document.querySelector('#camps .pt-row[data-task] select')`, 'calls');
  const first = await A.ev(`document.querySelector('#camps .pt-row[data-task]').dataset.task`);
  ok(await waitFor(async () => (await api('GET', '/state')).tasks.find((x) => x.id === first)?.action?.kind === 'calls'), 'a task’s tool set from the phase’s list');
  ok(await A.until(`document.querySelector('#camps .cc-row[data-task="${first}"] .cc-tool-ic')?.textContent === '📞'`), 'and its row shows 📞');
  // A link for everyone in the phase.
  await A.tap(T('.pt-res .res-add[data-kind=link]'));
  await A.until(`!!${T('.pt-res .res-form')}`);
  await A.ev(`(() => { const [u, n] = document.querySelectorAll('#camps .pt-res .res-form input'); u.value = 'https://example.com/script'; n.value = 'Call script'; [u, n].forEach((i) => i.dispatchEvent(new Event('input', { bubbles: true }))); return true; })()`);
  await A.tap(T('.pt-res .res-form .primary-btn'));
  ok(await waitFor(async () => (await goalNow(ph[0].id))?.resources?.some((r) => r.kind === 'link' && r.title === 'Call script')), 'a link added under Resources is saved on the phase');
  ok(await A.until(`${T('.pt-res')}.textContent.includes('Call script')`), 'and listed there');
  await A.tap(T('.pt-needs-go'));
  ok(await A.until(`!!document.querySelector('.need-rows')`, 4000), '“+ Add what it needs” opens what the phase needs');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  await sleep(300);
  // A task now shows its phase's resource.
  await A.tap(`${tile('Call the Diaz family')}.querySelector('.cc-row-name')`);
  await A.tap(T('.cc-pp-tool'));
  ok(await A.until(`${T('.cc-ptools')}?.dataset.for === 'task' && ${T('.cc-ptools')}.textContent.includes('Call script')`), 'a task’s tools name what its phase has (the call script)');
  // Back closes it.
  await A.tap(T('.pt-back'));
  ok(await A.until(`${T('.cc-ppanel .cc-pp-name')}?.value === 'Call the Diaz family'`), 'back goes to the task');
  // From a phase straight to its tools.
  await A.tap(`document.querySelectorAll('#camps .cc-phase')[1].querySelector('.cc-phase-t')`);
  await A.tap(T('.cc-pp-tool'));
  ok(await A.until(`${T('.cc-ptools')}?.dataset.for === 'phase' && ${T('.cc-ptools h3')}.textContent.includes('Book installs')`), 'a phase’s Add tool opens its tools');
  // Phone: it fits.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth && !!${T('.cc-ptools')}`), 'on a phone the tools fit, nothing sideways');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
  // A member who runs the campaign: Add tool, but no Add automation (since the edit lock, 2026-11-27, only whoever
  // runs a campaign, its maker and admins plan it).
  const samId = (await api('GET', '/state')).workspace.members.find((m) => m.name === 'Sam').id;
  await api('PATCH', '/campaigns/' + camp.id, { assigneeId: samId });
  await open(sam.token);
  await A.tap(`${tile('Send quotes')}.querySelector('.cc-row-name')`);
  await A.until(`${T('.cc-ppanel .cc-pp-name')}?.value === 'Send quotes'`);
  ok(await A.ev(`!!${T('.cc-pp-tool')} && !${T('.cc-pp-auto')}`), 'a member gets Add tool, not Add automation');
  await A.tap(T('.cc-pp-tool'));
  await A.tap(T('.pt-k[data-kind=files]'));
  ok(await waitFor(async () => (await taskNow('Send quotes'))?.action?.kind === 'files'), 'and can give a task a tool');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
srv.kill();
try { chrome.kill(); } catch {}
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
