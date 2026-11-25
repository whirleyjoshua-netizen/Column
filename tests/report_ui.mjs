// Campaign insights and the Report tab (Command Center part 5, 2026-11-20): from the tasks themselves, the pace and a
// forecast finish against the end date, each phase's days against its due day and against earlier runs of its SOP,
// each person's numbers, what's gone quiet (with Nudge, a comment that tells them), a burn-up chart with a hover, and
// Print. The pulse shows the forecast and what's quiet. Past days are made by editing the saved data between runs.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/rptui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4998, APP = `http://127.0.0.1:${PORT}/`, CDP = 9561;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-rptui`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-rptui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const startSrv = () => { const p = spawn('node', ['index.js'], { cwd: SERVER_DIR, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] }); p.log = ''; p.stdout.on('data', (d) => (p.log += d)); p.stderr.on('data', (d) => (p.log += d)); return p; };
let srv = startSrv();
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
const shot = async (name) => { if (!process.env.SHOT) return; const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const DAY = 864e5;
const dk = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const ago = (n) => Date.now() - n * DAY;
const up = async () => { for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) return; } catch {} await sleep(150); } };
try {
  await up();
  const t = Date.now();
  const post = async (p, body, tok) => (await fetch(APP + 'api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) })).json();
  const auth = await post('/auth', { mode: 'create', workspace: 'Rp ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const api = async (m, p, body, tok = auth.token) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
  const code = (await api('GET', '/state')).workspace.inviteCode;
  const sam = await post('/auth', { mode: 'join', workspace: 'Rp ' + t, code, name: 'Sam', email: `s${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samId = (await api('GET', '/state', null, sam.token)).me.memberId;
  // An SOP with two phases, run twice: an earlier run (C) whose Prep took 2 days, and this run (B).
  const a = await api('POST', '/campaigns', { name: 'Install' });
  for (const [title, n] of [['Prep', 3], ['Install', 3]]) { const g = await api('POST', '/goals', { campaignId: a.id, title }); for (let i = 1; i <= n; i++) await api('POST', '/tasks', { goalId: g.id, text: `${title} ${i}` }); }
  const tp = await api('POST', '/templates', { campaignId: a.id, name: 'Install', tz: 'America/Los_Angeles' });
  const C = await api('POST', `/templates/${tp.id}/run`, { date: dk(ago(20)) });
  const B = await api('POST', `/templates/${tp.id}/run`, { date: dk(ago(10)) });
  let st = await api('GET', '/state');
  const tasksOf = (cid, title) => { const g = st.goals.find((x) => x.campaignId === cid && x.title === title); return st.tasks.filter((x) => x.goalId === g.id).sort((p, q) => p.text.localeCompare(q.text)); };
  for (const x of [...tasksOf(C.id, 'Prep'), ...tasksOf(B.id, 'Prep')]) await api('PATCH', '/tasks/' + x.id, { done: true });
  const quietOne = tasksOf(B.id, 'Install')[0];
  await api('PATCH', '/tasks/' + quietOne.id, { assigneeId: samId });
  await sleep(1500);
  // Into the past: stop, move the days in the saved data, start again.
  srv.kill(); await sleep(800);
  const db = JSON.parse(FS.readFileSync(DIR + '/db.json', 'utf8'));
  const set = (id, f) => Object.assign(db.tasks[id], f);
  for (const x of tasksOf(C.id, 'Prep')) set(x.id, { createdAt: ago(20), assignedAt: undefined, openedAt: undefined, updatedAt: ago(19), doneAt: ago(19) });
  for (const x of [...tasksOf(B.id, 'Prep'), ...tasksOf(B.id, 'Install')]) set(x.id, { createdAt: ago(10), openedAt: undefined, assignedAt: undefined, updatedAt: ago(9) });
  tasksOf(B.id, 'Prep').forEach((x, i) => set(x.id, { doneAt: ago([8, 5, 2][i]), updatedAt: ago([8, 5, 2][i]) }));
  set(quietOne.id, { assignedAt: ago(6), updatedAt: ago(6) });
  Object.assign(db.campaigns[B.id], { start: dk(ago(10)), end: dk(Date.now() + 2 * DAY) });
  FS.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  srv = startSrv(); await up();
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  for (let i = 0; i < 20 && !(await A.ev(`!!document.querySelector('.camp-card')`)); i++) { await A.ev(`document.querySelector('[data-tab=camps]')?.click(); true`); await sleep(300); }
  const card = `[...document.querySelectorAll('.camp-card')].find((c) => c.querySelector('b')?.textContent === ${JSON.stringify(B.name)})`;
  await A.until(`!!${card}`, 8000);
  await A.tap(card);
  // The pulse: the forecast, 9 days after the end date, and what's gone quiet.
  // It heads the Report tab since 2026-11-25.
  await A.until(`!!document.querySelector('#camps .cc-tab[data-ctab=report]')`, 8000);
  await A.tap(`document.querySelector('#camps .cc-tab[data-ctab=report]')`);
  const fcDay = dk(Date.now() + 11 * DAY);
  const fcLabel = await A.ev(`new Date(${JSON.stringify(fcDay)} + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })`);
  ok(await A.until(`(document.querySelector('#camps .cc-pulse-fc')?.textContent || '').includes(${JSON.stringify(fcLabel)}) && /9 d late/.test(document.querySelector('#camps .cc-pulse-fc').textContent)`, 8000), 'the pulse forecasts the finish at this pace: ' + await A.ev(`document.querySelector('#camps .cc-pulse-fc')?.textContent`));
  ok(await A.ev(`(document.querySelector('#camps .cc-pulse-quiet')?.textContent || '') === '💤Quiet 3+ days3'`), 'and how many tasks have gone quiet: ' + await A.ev(`document.querySelector('#camps .cc-pulse-quiet')?.textContent`));
  ok(await A.ev(`[...document.querySelectorAll('#camps .cc-idea p')].some((p) => p.textContent.includes('Install 1') && p.textContent.includes('hasn’t moved in 6 days (Sam)'))`), 'What to do next: the quietest task, with Nudge');
  // The Report tab.
  await A.tap(`document.querySelector('#camps .cc-tab[data-ctab=report]')`);
  const R = (q) => `document.querySelector('#camps .cc-body ${q}')`;
  ok(await A.until(`!!${R('.ccr-top')}`), 'Report is a tab');
  ok(await A.ev(`/50%/.test(${R('.ccr-top')}.textContent) && /3 of 6 tasks done/.test(${R('.ccr-top')}.textContent) && ${R('.ccr-top')}.textContent.includes(${JSON.stringify(fcLabel)}) && /9 days after the end date/.test(${R('.ccr-why')}.textContent)`), 'the numbers: 50%, 3 of 6, the forecast and how late: ' + await A.ev(`${R('.ccr-why')}.textContent`));
  const rows = await A.ev(`[...document.querySelectorAll('#camps .ccr-phases tbody tr')].map((r) => [...r.children].map((c) => c.textContent).join('|'))`);
  ok(/^Prep\|3\/3\|.*\|9\|—\|2 d \(1 run\)$/.test(rows[0]) && /^Install\|0\/3\|.*\|Open\|11\|—\|—$/.test(rows[1]), 'phases: Prep took 9 days against the usual 2 (from 1 earlier run); Install is open: ' + JSON.stringify(rows));
  ok(await A.ev(`${R('.ccr-phases tbody tr td.slow')}?.textContent === '9'`), 'slower than usual stands out');
  ok(await A.ev(`[...document.querySelectorAll('#camps .ccr-table tbody tr')].some((r) => /Sam$/.test(r.children[0].textContent.trim()) && r.children[1].textContent === '0' && r.children[2].textContent === '1')`), 'people: Sam, nothing done, one open');
  ok(await A.ev(`document.querySelectorAll('#camps .ccr-stall').length === 3 && /Sam · untouched 6 days/.test(${R(`.ccr-stall[data-task="${quietOne.id}"]`)}.textContent)`), 'gone quiet: 3 tasks, Sam’s untouched 6 days');
  ok(await A.ev(`!!${R('.ccr-chart .ccr-done')} && !!${R('.ccr-chart .ccr-total')} && !!${R('.ccr-chart .ccr-end')} && document.querySelectorAll('#camps .ccr-legend .k').length === 3`), 'a burn-up chart: done, all tasks and the end date, with a legend');
  const [hx, hy] = await A.ev(`(() => { const r = ${R('.ccr-hit')}.getBoundingClientRect(); ${R('.ccr-chart')}.scrollIntoView({ block: 'center' }); const r2 = ${R('.ccr-hit')}.getBoundingClientRect(); return [r2.left + r2.width * 0.5, r2.top + r2.height / 2]; })()`);
  await A.mouse('mouseMoved', hx, hy);
  ok(await A.until(`!${R('.ccr-tip')}.hidden && /done/.test(${R('.ccr-tip')}.textContent) && /tasks/.test(${R('.ccr-tip')}.textContent)`), 'hovering shows a day’s numbers: ' + await A.ev(`${R('.ccr-tip')}.textContent`));
  await shot('report');
  // Nudge: a comment that tells Sam.
  await A.tap(R(`.ccr-stall[data-task="${quietOne.id}"] .ccr-nudge`));
  let n = [];
  for (let i = 0; i < 30 && !n.length; i++) { await sleep(150); n = (await api('GET', '/state')).tasks.find((x) => x.id === quietOne.id).comments || []; }
  ok(n.length === 1 && /Sam, any news on this/.test(n[0].text), 'Nudge leaves Sam a comment: ' + n[0]?.text);
  ok(await A.until(`document.querySelectorAll('#camps .ccr-stall').length === 2`), 'and it isn’t quiet any more');
  // In a narrow place (the split, or beside one) the page keeps its width: the pulse is part of the Report page
  // (2026-11-25), so nothing squeezes it.
  await A.ev(`document.querySelector('#camps').style.flex = '0 0 600px'; true`);
  await sleep(200);
  ok(await A.ev(`getComputedStyle(document.querySelector('#camps .camp-view.cc')).display === 'block' && document.querySelector('#camps .cc-main').getBoundingClientRect().width > 500 && document.querySelector('#camps .cc-pulse')?.getBoundingClientRect().width > 480`), 'at 600px wide the page keeps its width, the pulse inside it');
  await A.ev(`document.querySelector('#camps').style.flex = ''; true`);
  await sleep(200);
  // Print.
  await A.ev(`(() => { window.__opened = null; const real = window.open; window.open = (...a) => { const w = real.apply(window, a); if (w) w.print = () => {}; window.__opened = w; return w; }; return true; })()`);
  await A.tap(R('.ccr-print'));
  await sleep(500);
  const paper = await A.ev(`window.__opened ? window.__opened.document.body.textContent : ''`);
  ok(paper.includes(B.name) && /campaign report/.test(paper) && /Prep/.test(paper) && /Gone quiet/.test(paper) && !/Nudge/.test(paper), 'Print: the report on its own, without the buttons');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill(); srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-12).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
