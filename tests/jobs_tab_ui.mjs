// Phase 5 in the app (docs/jobflows/PHASE5.md): Jobs → Overview counts open Jobs filtered; Clients (the owner sees
// what's owed, a member doesn't); Schedule by day and week, a job dragged onto a person and day opens the visit sheet;
// Move my jobs here moves a board's jobs; the tabs members get; a member with a job open who loses it (an "own" team,
// the visit given to someone else) sees its window close and the job leave the Jobs list.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobs_tab_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5267, CDP = 9604, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 80 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed'); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  return { ev, until, tap, pick, cmd, errors };
}
const TOOL = (sel) => `document.querySelector('#tool ${sel}')`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const api = (tok) => async (m, p, body) => { const r = await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => null); };
  const a = await api()('POST', '/auth', { mode: 'create', workspace: 'JT ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = api(a.token);
  let st = await rico('GET', '/state');
  const b = await api()('POST', '/auth', { mode: 'join', workspace: 'JT ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const c2 = await api()('POST', '/auth', { mode: 'join', workspace: 'JT ' + t, code: st.workspace.inviteCode, name: 'Mia Cruz', email: `mia${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  st = await rico('GET', '/state');
  const samId = st.workspace.members.find((m) => m.name === 'Sam Reed').id, miaId = st.workspace.members.find((m) => m.name === 'Mia Cruz').id;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true } });
  const tz = st.workspace.tz || 'UTC';
  const dayOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const today = dayOf(Date.now());
  const p = await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] });
  const tp = p.types[0];
  const stage = (label) => tp.fields.find((f) => f.key === 'status').choices.find((c) => c.label === label).id;
  const dana = await rico('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test' });
  const danaId = dana.id ?? dana.contact?.id;
  const flow = await rico('POST', '/job-flows', { name: 'Cleaning', list: { projectId: p.id, typeId: tp.id }, steps: [{ kind: 'client', name: 'Client', stage: 'New' }, { kind: 'book', name: 'Book', stage: 'Scheduled' }, { kind: 'work', name: 'Clean', stage: 'Done' }, { kind: 'invoice', name: 'Invoice', stage: 'Invoiced' }, { kind: 'payment', name: 'Payment', stage: 'Paid' }] });
  await rico('POST', `/job-flows/${flow.id}/publish`);
  const jBook = (await rico('POST', '/jobs', { flowId: flow.id, values: { job: 'Ruiz clean', customer: danaId, price: { rows: [{ desc: 'Clean', qty: 1, price: '80' }] } } })).job;
  const jToday = (await rico('POST', '/jobs', { flowId: flow.id, values: { job: 'Today clean', customer: danaId } })).job;
  await rico('POST', `/records/${jToday.id}/visits`, { kind: 'Cleaning', date: today, start: 540, end: 600, memberIds: [samId] });
  const inv = await rico('POST', `/records/${jBook.id}/invoices`, {});
  await rico('POST', `/invoices/${(inv.invoice || inv).id}/send`);
  const plain1 = await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Old job one', status: stage('Scheduled') } });
  const plain2 = await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Old job two', status: stage('New') } });

  // The owner's Jobs tab.
  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  await A.until(`!!document.querySelector('#workTabs [data-tab=jobs]')`, 15000);
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  ok(await A.until(`!!document.querySelector('#tool .jb-pipe')`), 'Jobs opens on Overview, with the pipeline');
  ok(await A.ev(`['overview', 'clients', 'schedule', 'jobs', 'quotes', 'invoices', 'items', 'flows'].join() === [...document.querySelectorAll('#tool [data-jb]')].map((x) => x.dataset.jb).join()`), 'an owner’s sub-tabs: Overview, Clients, Schedule, Jobs, Quotes, Invoices, Items, Job Flows');
  const tileN = (k) => `document.querySelector('#tool [data-pipe=${k}] .jb-tile-n')?.textContent`;
  ok(await A.until(`${tileN('book')} === '1' && ${tileN('today')} === '1'`), 'To book 1, Booked today 1');
  await A.tap(TOOL('[data-pipe=book]'));
  ok(await A.until(`!!document.querySelector('#tool .jb-pipe-chip') && document.querySelectorAll('#tool .jb-row[data-job]').length === 1 && !!document.querySelector('#tool .jb-row[data-job="${jBook.id}"]')`), 'a count opens Jobs showing only those jobs, with a chip');
  await A.tap(TOOL('.jb-pipe-chip'));
  ok(await A.until(`document.querySelectorAll('#tool .jb-row[data-job]').length >= 4`), 'clearing the chip shows every job');

  // Clients.
  await A.tap(TOOL('[data-jb=clients]'));
  ok(await A.until(`/owed/.test(document.querySelector('#tool .jb-row[data-client="${danaId}"]')?.textContent || '')`), 'Clients: Dana, with what she owes');

  // Schedule: the day, then the week, then a job dragged onto Sam and a day.
  await A.tap(TOOL('[data-jb=schedule]'));
  ok(await A.until(`!!document.querySelector('#tool .ts .ts-visit') && /Today clean/.test(document.querySelector('#tool .ts').textContent)`), 'Schedule, by day: Sam’s lane has today’s visit');
  await A.tap(TOOL('[data-sched=week]'));
  ok(await A.until(`!!document.querySelector('#tool .jw') && /Today clean/.test(document.querySelector('#tool .jw-row[data-person="${samId}"]')?.textContent || '')`), 'by week: Sam’s row has the visit on its day');
  ok(await A.until(`[...document.querySelectorAll('#tool .ts-wait')].some((x) => /Ruiz clean/.test(x.textContent))`), 'the week has Jobs to schedule (the job at its Book step)');
  const later = dayOf(Date.now() + 864e5 * 2);
  const dropped = await A.ev(`(() => {
    const chip = [...document.querySelectorAll('#tool .ts-wait')].find((x) => /Ruiz clean/.test(x.textContent));
    const cell = document.querySelector('#tool .jw-row[data-person="${samId}"] .jw-cell[data-day="${later}"]') || document.querySelector('#tool .jw-row[data-person="${samId}"] .jw-cell:last-child');
    if (!chip || !cell) return false;
    const dt = new DataTransfer();
    chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    cell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    cell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return cell.dataset.day;
  })()`);
  ok(!!dropped && await A.until(`!!document.querySelector('.sheet input[type=date]') && [...document.querySelectorAll('.sheet input[type=date]')].some((x) => x.value === ${JSON.stringify(dropped)})`), 'dragging it onto Sam and a day opens the visit sheet on that day: ' + dropped);
  for (const type of ['keyDown', 'keyUp']) await A.cmd('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  ok(await A.until(`!document.querySelector('.sheet input[type=date]')`, 5000), '(the visit sheet closes, nothing booked)');

  // Move my jobs here.
  await A.tap(TOOL('[data-jb=overview]'));
  ok(await A.until(`!!document.querySelector('#tool .jb-move-row[data-move="${tp.id}"]')`), 'Overview offers Move my jobs here for the board');
  await A.pick(`document.querySelector('#tool .jb-move-row[data-move="${tp.id}"] select')`, 'flow:' + flow.id);
  await A.tap(TOOL(`.jb-move-row[data-move="${tp.id}"] [data-act=move-jobs]`));
  const runOf = async (id) => (await rico('GET', `/jobs/${id}/run`))?.run;
  let moved = false;
  for (let i = 0; i < 50 && !moved; i++) { moved = !!(await runOf(plain1.id)) && !!(await runOf(plain2.id)); if (!moved) await sleep(200); }
  ok(moved && (await runOf(plain1.id))?.current?.name === 'Book' && (await runOf(plain2.id))?.current?.name === 'Client', 'both old jobs move onto the flow, each at the step for its stage');
  ok(await A.until(`!document.querySelector('#tool .jb-move-row[data-move="${tp.id}"]')`), 'and the board leaves Move my jobs here');

  // A member's tabs, and losing a job they have open.
  await rico('PATCH', '/workspace', { visibility: 'own' });
  const B = await tab(APP);
  await B.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await B.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(b.token))}); location.reload(); true`);
  await B.until(`!!document.querySelector('#workTabs [data-tab=jobs]')`, 15000);
  await B.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  ok(await B.until(`['overview', 'schedule', 'jobs'].join() === [...document.querySelectorAll('#tool [data-jb]')].map((x) => x.dataset.jb).join()`), 'a member’s sub-tabs (Contacts off): Overview, Schedule, Jobs');
  await B.tap(TOOL('[data-jb=jobs]'));
  ok(await B.until(`!!document.querySelector('#tool .jb-row[data-job="${jToday.id}"]') && !document.querySelector('#tool .jb-row[data-job="${jBook.id}"]')`), 'Sam’s Jobs list: the job he’s on a visit for, not the other');
  await B.tap(TOOL(`.jb-row[data-job="${jToday.id}"] .jb-main`));
  ok(await B.until(`!!document.querySelector('#projects .jb-card')`, 10000), 'Sam opens it');
  const vid = (await rico('GET', `/records/${jToday.id}/visits`))?.[0]?.id;
  await rico('PATCH', `/visits/${vid}`, { memberIds: [miaId] });
  ok(await B.until(`!document.querySelector('#projects .jb-card')`, 10000), 'the visit given to Mia: the job’s window closes for Sam');
  await B.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  await B.tap(TOOL('[data-jb=jobs]'));
  ok(await B.until(`!document.querySelector('#tool .jb-row[data-job="${jToday.id}"]')`, 8000), 'and it’s gone from his Jobs list');
  ok(!A.errors.length && !B.errors.length, 'no errors on either page: ' + [...A.errors, ...B.errors].join(' | ').slice(0, 300));
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e));
}
srv.kill(); chrome.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
