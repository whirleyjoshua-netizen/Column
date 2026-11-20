// The Campaign Command Center (2026-11-20, the owner's brainstorm): a header with health, dates and owner; KPIs from the
// real work (complete, phases, tasks, blocked, overdue); five tabs (Overview, Plan, Work, Resources, Activity); the brief
// in four parts, edited in place; phases (the steps) as connected cards; Work as one table with filters; a Pulse panel
// with what to do next, each with its button. Every part of the old page is still in one of the tabs.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/ccui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4949, APP = `http://127.0.0.1:${PORT}/`, CDP = 9537;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-ccui`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-ccui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
const kpi = (cls) => A.ev(`${T(`.cc-kpi.${cls} b`)}?.textContent`);
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Cc ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const st = await api('GET', '/state'); const me = st.me.memberId; const today = st.today || new Date().toISOString().slice(0, 10);
  const plus = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const camp = await api('POST', '/campaigns', { name: 'New Client Onboarding', brief: 'Turn new leads into installed customers', start: plus(today, -3), end: plus(today, 60) });
  await api('PATCH', '/campaigns/' + camp.id, { audience: 'New valley homeowners', strategy: 'Fast first call, then an in-home consultation', assigneeId: me });
  const ph = []; for (const n of ['First call & booking', 'Consultation, measure & quote', 'Signed & ordered', 'Install & close']) ph.push(await api('POST', '/goals', { campaignId: camp.id, title: n }));
  await api('POST', '/goals', { campaignId: camp.id, title: 'Consultations booked', kind: 'count', target: 20 });
  const a = await api('POST', '/tasks', { goalId: ph[0].id, text: 'Call new leads and book consultations', assigneeId: me, due: plus(today, 2) });
  await api('PATCH', '/tasks/' + a.id, { priority: 3 });
  await api('POST', '/tasks', { goalId: ph[0].id, text: 'Email consultation confirmation', assigneeId: me, blockedBy: [a.id] });
  await api('POST', '/tasks', { goalId: ph[0].id, text: 'Review the first-call script', assigneeId: me, due: plus(today, -3) });
  const d = await api('POST', '/tasks', { goalId: ph[0].id, text: 'Pull last month’s leads', assigneeId: me }); await api('PATCH', '/tasks/' + d.id, { done: true });
  for (const [i, n] of [[1, 'Measure windows'], [1, 'Send written quote'], [2, 'Collect signature'], [2, 'Order shades'], [3, 'Install'], [3, 'Final walkthrough']]) await api('POST', '/tasks', { goalId: ph[i].id, text: n });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); localStorage.removeItem('column.campTab'); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  await A.until(`!!document.querySelector('.camp-card')`);
  await A.tap(`document.querySelector('.camp-card')`);
  ok(await A.until(`!!${T('.cc-kpis')}`), 'a campaign opens as the Command Center');
  ok(await A.ev(`${T('.cc-name')}.textContent === 'New Client Onboarding' && !!${T('.cc-title-row .health')} && ${T('.cc-owner')}.textContent.includes('You') && ${T('.cc-crumb')}.textContent.startsWith('Campaigns')`), 'header: name, health, owner, breadcrumb');
  ok(await kpi('phases') === '4' && await kpi('tasks') === '10' && await kpi('blocked') === '1' && await kpi('overdue') === '1', `KPIs from the real work: 4 phases, 10 tasks, 1 blocked, 1 overdue (${await kpi('phases')}/${await kpi('tasks')}/${await kpi('blocked')}/${await kpi('overdue')})`);
  ok(await A.ev(`${T('.cc-kpi.overdue')}.classList.contains('bad') && ${T('.cc-kpi.blocked')}.classList.contains('bad')`), 'blocked and overdue are flagged');
  ok(await A.ev(`[...document.querySelectorAll('#camps .cc-tab')].map((b) => b.textContent).join('|')`) === 'Overview|Plan|Work|Resources|Activity', 'five tabs: Overview, Plan, Work, Resources, Activity');
  // The brief, in four parts.
  ok(await A.ev(`[...document.querySelectorAll('#camps .cc-bh')].map((x) => x.textContent).join('|')`) === 'Objective|Audience|Strategy|Success metrics', 'the brief: Objective, Audience, Strategy, Success metrics');
  ok(await A.ev(`${T('.cc-bf[data-field=brief]')}.textContent.includes('installed customers') && ${T('.cc-bf[data-field=audience]')}.textContent === 'New valley homeowners' && ${T('.cc-metrics')}.textContent.includes('Consultations booked') && ${T('.cc-metrics')}.textContent.includes('0 / 20')`), 'filled from the campaign; a target (0 / 20) is a success metric');
  await A.tap(T('.cc-bf[data-field=audience]'));
  await A.until(`document.activeElement?.classList.contains('cc-bf-edit')`);
  await A.ev(`(() => { const ta = document.activeElement; ta.value = 'New valley homeowners and landlords'; ta.blur(); })()`);
  ok(await (async () => { for (let i = 0; i < 30; i++) { if ((await api('GET', '/state')).campaigns.find((x) => x.id === camp.id)?.audience === 'New valley homeowners and landlords') return true; await sleep(100); } return false; })(), 'Audience is edited in place and saved');
  // Phases as connected cards.
  ok(await A.ev(`document.querySelectorAll('#camps .cc-phase').length === 4 && document.querySelectorAll('#camps .cc-arrow').length === 3 && ${T('.cc-phase')}.classList.contains('active') && ${T('.cc-phase small')}.textContent.startsWith('1 / 4 tasks')`), 'four phase cards, joined by arrows; the first is active, 1 / 4 tasks');
  ok(await A.ev(`document.querySelectorAll('#camps .cc-body > .goal').length === 5`), 'each phase (and the target) has its section of tasks below');
  // Work: one table, with filters; a row opens the task.
  await tabTo('work');
  ok(await A.ev(`document.querySelectorAll('#camps .cc-tr:not(.cc-th)').length === 9`), 'Work lists the 9 open tasks');
  await A.ev(`${T('.cc-wf [data-wf=blocked]')}.click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#camps .cc-tr:not(.cc-th) .cc-tt')].map((x) => x.textContent).join() === 'Email consultation confirmation' && ${T('.cc-status.wait')}`), 'Blocked shows the one waiting task, marked Waiting');
  await A.tap(T('.cc-tr:not(.cc-th)'));
  ok(await A.until(`!!document.querySelector('#sheet .task-win')`), 'a row opens the task beside the page');
  // The drawer (part 2): who, due, priority, status; description, checklist, subtasks, dependencies, comments, activity.
  ok(await A.ev(`[...document.querySelectorAll('#sheet .td-row .td-l')].map((x) => x.textContent).join('|') === 'Assignee|Starts|Due|Priority|Status' && [...document.querySelectorAll('#sheet .td-sec-h')].map((x) => x.textContent.split(' ·')[0]).join('|').startsWith('Description|Checklist|Subtasks|Dependencies')`), 'the drawer: Assignee, Starts, Due, Priority, Status, then Description, Checklist, Subtasks, Dependencies…');
  ok(await A.ev(`!!document.querySelector('#sheet .td-badge.wait') && document.querySelector('#sheet .td-status [data-st=doing]').disabled && document.querySelector('#sheet .td-dep')?.textContent.includes('Call new leads')`), 'a waiting task says Waiting, can’t be started, and shows what it waits for');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);
  await A.ev(`${T('.cc-wf [data-wf=open]')}.click(); true`);
  await A.until(`document.querySelectorAll('#camps .cc-tr:not(.cc-th)').length === 9`);
  await A.tap(`[...document.querySelectorAll('#camps .cc-tr:not(.cc-th)')].find((r) => r.textContent.includes('Measure windows'))`);
  await A.until(`!!document.querySelector('#sheet .td-status')`);
  await A.tap(`document.querySelector('#sheet .td-status [data-st=doing]')`);
  ok(await A.until(`document.querySelector('#sheet .td-status .on')?.dataset.st === 'doing'`), 'In progress is one tap');
  const st2 = async () => (await api('GET', '/state')).tasks.find((x) => x.text === 'Measure windows');
  ok((await st2()).status === 'doing', 'and saved');
  await A.ev(`(() => { const d = document.querySelector('#sheet .td-desc'); d.value = 'Bring the laser measure'; d.dispatchEvent(new Event('blur')); })()`);
  await A.until(`document.querySelector('#sheet .td-desc')?.value === 'Bring the laser measure'`);
  for (const item of ['Living room', 'Kitchen']) {
    await A.until(`!!document.querySelector('#sheet .td-cl-add')`);
    await A.ev(`(() => { const i = document.querySelector('#sheet .td-cl-add'); i.value = ${JSON.stringify(item)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await A.until(`[...document.querySelectorAll('#sheet .td-cl-item span')].some((x) => x.textContent === ${JSON.stringify(item)})`);
  }
  await A.tap(`[...document.querySelectorAll('#sheet .td-cl-item')].find((x) => x.textContent.includes('Kitchen')).querySelector('input')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .td-sec-h')].some((x) => x.textContent === 'Checklist · 1/2')`), 'a checklist: add items, tick one (1/2)');
  await A.ev(`(() => { const i = document.querySelector('#sheet .td-sub-add'); i.value = 'Order the laser measure'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .td-sub .td-sub-open')].some((x) => x.textContent === 'Order the laser measure')`), 'a subtask, added in the drawer');
  await A.ev(`(() => { const c = document.querySelector('#sheet .td-cbox'); c.value = 'Customer prefers mornings'; })()`);
  await A.tap(`document.querySelector('#sheet .td-post')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .td-comment p')].some((x) => x.textContent === 'Customer prefers mornings')`), 'a comment, posted in the drawer');
  ok(await A.until(`!document.querySelector('#sheet .td-hist')?.textContent.includes('Loading')`), 'its activity history loads');
  const m = await st2();
  ok(m.description === 'Bring the laser measure' && m.checklist.length === 2 && m.checklist.find((x) => x.text === 'Kitchen').done && m.comments?.length === 1, 'description, checklist and comment are saved');
  await A.tap(`document.querySelector('#sheet .td-dup')`);
  ok(await A.until(`document.querySelector('#sheet .win-title')?.value === 'Measure windows (copy)'`), 'Duplicate makes a copy and opens it');
  ok(await A.until(`(async () => (await (await fetch('/api/state', { headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')) } })).json()).tasks.find((x) => x.text === 'Measure windows (copy)')?.checklist?.every((x) => !x.done))()`), 'with its checklist, unticked');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);
  // Plan, Resources, Activity keep the old page's parts.
  await tabTo('plan');
  ok(await A.ev(`document.querySelectorAll('#camps .cc-body .goal').length === 5 && [...document.querySelectorAll('#camps .cc-card-h b')].some((x) => x.textContent === 'Targets') && !!${T('.cc-team')}`), 'Plan: the phases in order, the targets, and the team and roles');
  await tabTo('resources');
  ok(await A.ev(`[...document.querySelectorAll('#camps button')].some((b) => b.textContent.startsWith('Files')) && [...document.querySelectorAll('#camps button')].some((b) => b.textContent.startsWith('Notes')) && [...document.querySelectorAll('#camps button')].some((b) => b.textContent.startsWith('#'))`), 'Resources: the feed, Files and Notes');
  await tabTo('activity');
  ok(await A.ev(`[...document.querySelectorAll('#camps button')].some((b) => b.textContent === 'Log a call or email') && [...document.querySelectorAll('#camps button')].some((b) => b.textContent.startsWith('Write a report')) && [...document.querySelectorAll('#camps .cc-hist-row')].some((x) => x.textContent.includes('Pull last month’s leads'))`), 'Activity: the log, Write a report, and what was recently done');
  // Pulse.
  ok(await A.ev(`${T('.cc-pulse')}.textContent.includes('Blockers') && [...document.querySelectorAll('#camps .cc-idea p')].some((p) => p.textContent.includes('nobody on them'))`), 'Pulse: blockers, overdue, and what to do next');
  await A.ev(`[...document.querySelectorAll('#camps .cc-idea')].find((x) => x.textContent.includes('nobody on them')).querySelector('button').click(); true`);
  ok(await A.until(`${T('.cc-body')}?.dataset.tab === 'work'`), '“Assign them” takes you to the work');
  // A phone: no pulse, nothing sideways.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  await A.ev(`${T('.cc-tab[data-ctab=overview]')}.click(); true`);
  await sleep(400);
  ok(await A.ev(`!${T('.cc-pulse')} && !!${T('.cc-kpis')} && document.documentElement.scrollWidth <= innerWidth`), 'on a phone: the KPIs, no pulse, nothing spills sideways');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
