// Campaigns, simpler (the owner, 2026-11-25; docs/superpowers/specs/2026-11-25-campaign-simplify-design.md): the
// tabs are Plan, Work, Activity, Report (Progress and Sketch come later); the numbers and the Pulse leave the header
// for one line of chips (All, My tasks, Overdue, Blocked); Plan is the owner's mockup: phase cards with task rows, the
// brief and its links on the left, Task details on the right.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/ccsimple';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4961, APP = `http://127.0.0.1:${PORT}/`, CDP = 9599;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-ccsimple`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-ccsimple`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Simple ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
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
  ok(await A.until(`!!${T('.cc-body')}`), 'the campaign opens');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  // ----- Task 2: the header, tabs and chips -----
  ok(await A.ev(`JSON.stringify([...document.querySelectorAll('#camps .cc-tab')].map((b) => b.dataset.ctab)) === '["plan","work","activity","report"]'`), 'four tabs: Plan, Work, Activity, Report');
  ok(await A.ev(`${T('.cc-body')}.dataset.tab === 'plan'`), 'it opens on Plan');
  ok(await A.ev(`!${T('.cc-kpis')} && !${T('.cc-pulse-btn')}`), 'no row of numbers, no Pulse button');
  ok(await A.ev(`/^[0-9]+% complete/.test(${T('.cc-chips')}?.textContent.trim() || '')`), 'the chips line starts with how complete it is');
  ok(await A.ev(`['all', 'mine', 'overdue', 'blocked'].every((k) => !!document.querySelector('#camps .cc-chip[data-chip=' + k + ']'))`), 'chips: All, My tasks, Overdue, Blocked');
  ok(await A.ev(`${T('.cc-chip[data-chip=all]')}.classList.contains('on')`), 'All is on to start');
  // Old places land on Plan: leave from Work and come back.
  await tabTo('work');
  await A.tap(T('.cc-crumb button'));
  await A.until(`!!document.querySelector('.camp-card')`);
  await A.tap(`document.querySelector('.camp-card')`);
  ok(await A.until(`${T('.cc-body')}?.dataset.tab === 'plan'`), 'opening a campaign again lands on Plan');
  await A.tap(T('[aria-label="Campaign options"]'));
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Edit details'))`), 'editing the campaign is in ⋯');
  await A.ev(`document.body.click(); true`);
  await tabTo('report');
  ok(await A.until(`${T('.cc-body')}.textContent.includes('What to do next')`), 'Report has what to do next (from the Pulse)');
  await tabTo('plan');
  // ----- Task 3: Plan in the owner's mockup -----
  const phaseEl = (i) => `document.querySelectorAll('#camps .cc-phase')[${i}]`;
  const rowOf = (text) => `[...document.querySelectorAll('#camps .cc-row')].find((r) => r.querySelector('.cc-row-name')?.textContent === ${JSON.stringify(text)})`;
  const taskApi = async (text) => (await api('GET', '/state')).tasks.find((x) => x.text === text);
  ok(await A.until(`document.querySelectorAll('#camps .cc-phase').length === 3`), 'one card per phase');
  ok(await A.ev(`JSON.stringify([...document.querySelectorAll('#camps .cc-phase .cc-phase-t')].map((e) => e.textContent)) === '["Call past customers","Book installs","Install"]'`), 'phases in order');
  ok(await A.ev(`(() => { const t = ${phaseEl(0)}.querySelector('.cc-phase-h').textContent; return t.includes('Phase 1') && t.includes('(0/2'); })()`), 'phase 1 says Phase 1 (0/2 tasks done), its subtask not counted');
  ok(await A.ev(`${rowOf('Call the Lee family')}?.querySelector('.cc-row-subs')?.textContent === '0/1' && !${rowOf('Ask about the patio')}`), 'a subtask shows as 0/1 on its task, not as a row');
  ok(await A.ev(`${rowOf('Call the Lee family')}.querySelector('.cc-row-due').classList.contains('late') && ${rowOf('Call the Lee family')}.querySelector('.cc-row-status').textContent === 'Overdue'`), 'a late task: red due, Overdue status');
  ok(await A.ev(`${T('.cc-obrief')}.textContent.includes('Objective') && ${T('.cc-obrief')}.textContent.includes('Book installs') && !!${T('.cc-obrief .cc-where')}`), 'the brief on the left, with where things are');
  ok(await A.ev(`${T('.cc-planner')}.textContent.includes('At a glance')`), 'nothing picked: At a glance');
  await A.tap(`${rowOf('Call the Lee family')}.querySelector('.cc-row-name')`);
  ok(await A.until(`${T('.cc-td .cc-pp-name')}?.value === 'Call the Lee family'`), 'a task opens in Task details');
  ok(await A.ev(`!!${T('.cc-td textarea.cc-td-notes')} && !!${T('.cc-td .cc-td-drop')} && ['Add tool', 'Open full', 'Delete task'].every((x) => [...document.querySelectorAll('#camps .cc-td button')].some((b) => b.textContent.includes(x)))`), 'details: notes, attachments, Add tool, Open full, Delete task');
  await A.ev(`(() => { const n = ${T('.cc-td textarea.cc-td-notes')}; n.focus(); n.value = 'Bring brochure'; n.dispatchEvent(new Event('blur')); return true; })()`);
  let saved1 = false; for (let i = 0; i < 30 && !saved1; i++) { saved1 = (await taskApi('Call the Lee family'))?.description === 'Bring brochure'; if (!saved1) await sleep(150); }
  ok(saved1, 'notes save to the task');
  await A.tap(`${rowOf('Call the Diaz family')}.querySelector('.cc-row-check')`);
  let done1 = false; for (let i = 0; i < 30 && !done1; i++) { done1 = !!(await taskApi('Call the Diaz family'))?.done; if (!done1) await sleep(150); }
  ok(done1, 'ticking a row finishes the task');
  ok(await A.until(`${phaseEl(0)}.querySelector('.cc-phase-h').textContent.includes('(1/2')`), 'and the phase count follows');
  await A.tap(T('.cc-chip[data-chip=mine]'));
  ok(await A.until(`${phaseEl(0)}.querySelectorAll('.cc-row').length === 1 && !!${rowOf('Call the Lee family')}`), 'My tasks: only mine');
  ok(await A.ev(`${phaseEl(1)}.textContent.includes('No matching tasks') && ${phaseEl(1)}.querySelector('.cc-phase-h').textContent.includes('(0/1')`), 'a phase with none still shows, its count the whole phase');
  await A.tap(T('.cc-chip[data-chip=all]'));
  await A.until(`!!${rowOf('Send quotes')}`);
  await A.ev(`(() => { const i = ${phaseEl(2)}.querySelector('input.cc-phase-add'); i.focus(); i.value = 'Measure the yard'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  ok(await A.until(`!!${rowOf('Measure the yard')} && ${phaseEl(2)}.contains(${rowOf('Measure the yard')})`), 'typing a task in a phase adds it there');
  await A.tap(`${phaseEl(1)}.querySelector('.cc-phase-saved')`);
  ok(await A.until(`(() => { const t = document.querySelector('#menu').textContent; return t.includes('Install day') && t.includes('Order samples'); })()`), '+ From saved lists bundles and saved tasks');
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Order samples'))`);
  ok(await A.until(`!!${rowOf('Order samples')} && ${phaseEl(1)}.contains(${rowOf('Order samples')})`), 'picking one puts it in that phase');
  await A.tap(`${rowOf('Measure the yard')}.querySelector('.cc-row-name')`);
  await A.until(`${T('.cc-td .cc-pp-name')}?.value === 'Measure the yard'`);
  await A.tap(T('.cc-td .cc-td-del'));
  ok(await A.until(`${T('.cc-td .cc-td-del')}?.textContent.includes('again')`), 'Delete asks for a second tap');
  await A.tap(T('.cc-td .cc-td-del'));
  ok(await A.until(`!${rowOf('Measure the yard')}`), 'the second tap deletes it');
  // A waiting task can't be ticked (in order: phase 2 waits for phase 1).
  await api('PATCH', '/campaigns/' + camp.id, { inOrder: true });
  await tabTo('work'); await tabTo('plan');
  ok(await A.until(`${rowOf('Send quotes')}?.querySelector('.cc-row-check')?.disabled === true`), 'a task that waits cannot be ticked');
  await api('PATCH', '/campaigns/' + camp.id, { inOrder: false });
  // ----- From the review (2026-11-25) -----
  // The waits-for title names what it waits for (a whole phase, here).
  await api('PATCH', '/campaigns/' + camp.id, { inOrder: true });
  await tabTo('work'); await tabTo('plan');
  ok(await A.until(`(${rowOf('Send quotes')}?.querySelector('.cc-row-check')?.title || '').includes('Call past customers')`), 'a waiting task says what it waits for: ' + await A.ev(`${rowOf('Send quotes')}?.querySelector('.cc-row-check')?.title`));
  await api('PATCH', '/campaigns/' + camp.id, { inOrder: false });
  await tabTo('work'); await tabTo('plan');
  // A subtask's name opens it in the panel; it doesn't tick it.
  await A.tap(`${rowOf('Call the Lee family')}.querySelector('.cc-row-name')`);
  await A.until(`${T('.cc-td .cc-pp-name')}?.value === 'Call the Lee family'`);
  await A.tap(`[...document.querySelectorAll('#camps .cc-td .cc-td-sub-name')].find((b) => b.textContent === 'Ask about the patio')`);
  ok(await A.until(`${T('.cc-td .cc-pp-name')}?.value === 'Ask about the patio'`), 'a subtask’s name opens it in the panel');
  ok(!(await taskApi('Ask about the patio'))?.done, 'and doesn’t tick it');
  await A.tap(T('.cc-td [aria-label="Close the task"]'));
  // My tasks keeps a task whose subtask is mine.
  const sq = await taskApi('Send quotes');
  await api('POST', '/tasks', { goalId: sq.goalId, text: 'Price the brackets', parentId: sq.id, assigneeId: me });
  await tabTo('work'); await tabTo('plan');
  await A.tap(T('.cc-chip[data-chip=mine]'));
  ok(await A.until(`!!${rowOf('Send quotes')}`), 'My tasks keeps a task whose subtask is mine');
  await A.tap(T('.cc-chip[data-chip=all]'));
  // A call list, tracker or checklist opens on Plan from Where things are.
  await api('POST', '/lists', { campaignId: camp.id, kind: 'checklist', name: 'Install checklist', columns: ['Step'], rows: [{ cells: ['Measure'] }, { cells: ['Order brackets'] }] });
  await tabTo('work'); await tabTo('plan');
  await A.tap(`[...document.querySelectorAll('#camps .cc-where button')].find((b) => b.textContent.startsWith('Lists & docs'))`);
  await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Install checklist'))`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Install checklist'))`);
  ok(await A.until(`!!${T('.cc-listopen .clist.open')} && ${T('.cc-listopen')}.textContent.includes('Install checklist')`), 'a checklist opens on Plan, open, as it did on Resources');
  // The whiteboard is still a button away (it becomes the Sketch tab later).
  ok(await A.until(`!!${T('.cc-sketch-btn')}`), 'a Sketch button on Plan');
  await A.tap(T('.cc-sketch-btn'));
  ok(await A.until(`!!${T('.cc-board-empty')} || !!${T('.cc-boardwrap')}`), 'it opens the campaign board');
  await A.tap(T('.cc-sketch-btn'));
  ok(await A.until(`!!${T('.cc-phase')}`), 'and back to the phases');
  // A campaign with no phases.
  await api('POST', '/campaigns', { name: 'Empty one', brief: 'Nothing yet' });
  await A.tap(T('.cc-crumb button'));
  await A.until(`[...document.querySelectorAll('.camp-card')].some((x) => x.textContent.includes('Empty one'))`);
  await A.tap(`[...document.querySelectorAll('.camp-card')].find((x) => x.textContent.includes('Empty one'))`);
  ok(await A.until(`${T('.cc-name')}?.textContent === 'Empty one' && !!${T('.cc-addphase')} && ${T('.cc-planner')}.textContent.includes('At a glance')`), 'no phases: + Add Phase and At a glance');
  await A.tap(T('.cc-crumb button'));
  await A.until(`!!document.querySelector('.camp-card')`);
  await A.tap(`[...document.querySelectorAll('.camp-card')].find((x) => x.textContent.includes('Spring Promo'))`);
  await A.until(`!!${T('.cc-phase')}`);
  // On a phone: the brief first, then the phases; a task's details open and close.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`${T('.cc-obrief')}.getBoundingClientRect().top < ${phaseEl(0)}.getBoundingClientRect().top && document.documentElement.scrollWidth <= innerWidth`), 'on a phone: the brief first, nothing sideways');
  await A.tap(`${rowOf('Call the Lee family')}.querySelector('.cc-row-name')`);
  ok(await A.until(`(() => { const e = ${T('.cc-td')}; if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`), 'on a phone a task shows its details');
  await A.tap(T('.cc-td [aria-label="Close the task"]'));
  ok(await A.until(`!${T('.cc-td')}`), 'and the close button closes them');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
try { chrome.kill(); } catch {}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
