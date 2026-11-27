// Campaign Progress (stage 3, 2026-11-25; docs/superpowers/specs/2026-11-25-campaign-simplify-design.md): Activity and
// Report in one tab: how it's going, the numbers, what to do next, the report, the log and what was recently done.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/ccprog';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4991, APP = `http://127.0.0.1:${PORT}/`, CDP = 9629;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-ccprog`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-ccprog`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Prog ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const st = await api('GET', '/state'); const me = st.me.memberId; const today = st.today || new Date().toISOString().slice(0, 10);
  const plus = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const camp = await api('POST', '/campaigns', { name: 'Spring Promo', brief: 'Book installs', start: plus(today, -10), end: plus(today, 40) });
  await api('PATCH', '/campaigns/' + camp.id, { assigneeId: me, inOrder: true });
  const ph = []; for (const n of ['Call past customers', 'Book installs']) ph.push(await api('POST', '/goals', { campaignId: camp.id, title: n }));
  await api('POST', '/tasks', { goalId: ph[0].id, text: 'Call the Lee family', assigneeId: me, due: plus(today, -3) });
  const pf = await api('POST', '/tasks', { goalId: ph[0].id, text: 'Print flyers', assigneeId: me }); await api('PATCH', '/tasks/' + pf.id, { done: true });
  await api('POST', '/tasks', { goalId: ph[1].id, text: 'Send quotes' });
  await api('POST', '/attempts', { campaignId: camp.id, outcome: 'Interested' });
  const quiet = await api('POST', '/campaigns', { name: 'Quiet one', brief: 'Nothing yet' });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  const openCamp = async (name) => { await A.until(`[...document.querySelectorAll('.camp-card')].some((x) => x.textContent.includes(${JSON.stringify(name)}))`); await A.tap(`[...document.querySelectorAll('.camp-card')].find((x) => x.textContent.includes(${JSON.stringify(name)}))`); await A.until(`${T('.cc-name')}?.textContent === ${JSON.stringify(name)}`); await A.until(`!!document.querySelector('#camps .cc-edit, #camps .cc-done-edit')`); await A.ev(`document.querySelector('#camps .cc-edit')?.click(); true`); };
  await openCamp('Spring Promo');
  ok(await A.until(`!!${T('.cc-body')}`), 'the campaign opens');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  // ----- Progress: Activity and Report in one tab, the Pulse at its top -----
  ok(await A.ev(`[...document.querySelectorAll('#camps .cc-tab')].map((b) => b.dataset.ctab).join() === 'plan,work,progress,sketch'`), 'Plan, Work, Progress (and Sketch on a wide screen)');
  await tabTo('progress');
  const before = (a, b) => `!!${T(a)} && !!${T(b)} && !!(${T(a)}.compareDocumentPosition(${T(b)}) & Node.DOCUMENT_POSITION_FOLLOWING)`;
  ok(await A.until(`${before('.ccr-bar', '.ccp-health')} && ${before('.ccp-health', '.ccr-top')} && ${before('.ccr-top', '.cc-pulse-ai')} && ${before('.cc-pulse-ai', '.ccp-report')} && ${before('.ccp-report', '.ccp-log')}`), 'in order: the bar, how it’s going, the numbers, what to do next, the report, the log');
  ok(await A.ev(`/On track|At risk|Off track/.test(${T('.ccp-health')}.textContent) && ${T('.ccp-health')}.textContent.includes('Next milestone')`), 'how it’s going: health and the next milestone');
  ok(await A.ev(`!document.querySelector('#camps .cc-pulse-row')`), 'no second list of blockers, overdue, forecast and quiet (the numbers show them)');
  const stat = (label) => `[...document.querySelectorAll('#camps .ccr-top .ccr-stat')].find((s) => s.querySelector('small')?.textContent === ${JSON.stringify(label)})`;
  ok(await A.ev(`${stat('Blocked')}?.querySelector('b').textContent === '1' && ${stat('Blocked')}.classList.contains('bad')`), 'the numbers have Blocked (1, flagged)');
  ok(await A.ev(`${T('.ccp-log .cc-hist')}?.textContent.includes('Print flyers')`), 'Recently done lists what was finished');
  await A.tap(`[...document.querySelectorAll('#camps .ccp-log button')].find((b) => b.textContent === 'Log a call or email')`);
  ok(await A.until(`[...document.querySelectorAll('#camps .ccp-log button')].find((b) => b.textContent === 'Log a call or email')?.classList.contains('on')`), 'Log a call or email opens the log');
  await A.tap(`[...document.querySelectorAll('#camps .ccp-log button')].find((b) => b.textContent === 'Log a call or email')`);
  ok(await A.ev(`${T('.ccp-report')}.textContent.includes('Calls and emails logged')`), 'the report keeps calls and emails logged');
  ok(await A.ev(`[...document.querySelectorAll('#camps .cc-body button')].filter((b) => b.textContent.startsWith('Write a report')).length === 1`), 'one Write a report on the page, not two');
  // Print: only the report (no buttons, no log, no ideas).
  await A.ev(`(() => { window.__printed = null; window.open = () => { const doc = document.implementation.createHTMLDocument('p'); window.__printed = doc; return { document: doc, print() {} }; }; return true; })()`);
  await A.tap(T('.ccr-print'));
  ok(await A.until(`!!window.__printed?.querySelector('.ccr-top')`), 'Print makes a copy of the report');
  ok(await A.ev(`(() => { const d = window.__printed; return !d.querySelector('button') && !d.querySelector('textarea') && !d.querySelector('.cc-pulse-ai') && !d.querySelector('.ccp-log'); })()`), 'with no buttons, no log, no ideas');
  ok(await A.ev(`!/Team/.test(window.__printed.body.textContent)`), 'and no empty Team label (faces don’t print)');
  // An idea goes where it says: overdue → Work with the Overdue chip.
  await A.tap(`[...document.querySelectorAll('#camps .cc-pulse-ai .cc-idea')].find((x) => x.textContent.includes('overdue')).querySelector('button')`);
  ok(await A.until(`${T('.cc-body')}?.dataset.tab === 'work' && ${T('.cc-chip[data-chip=overdue]')}.classList.contains('on')`), '“See them” goes to Work with Overdue on');
  await A.tap(T('.cc-chip[data-chip=all]'));
  // Logging started from Plan (a form from Lists & docs) opens the log on Progress, where it is.
  await api('POST', '/lists', { campaignId: camp.id, kind: 'form', name: 'Intake form', columns: ['Name', 'Notes'], rows: [{ cells: ['Ana', ''] }] });
  await tabTo('progress'); await tabTo('plan');
  await A.tap(`[...document.querySelectorAll('#camps .cc-where button')].find((b) => b.textContent.startsWith('Lists & docs'))`);
  await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Intake form'))`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Intake form'))`);
  ok(await A.until(`${T('.cc-body')}?.dataset.tab === 'progress' && [...document.querySelectorAll('#camps .ccp-log button')].find((b) => b.textContent === 'Log a call or email')?.classList.contains('on')`), 'logging started from Plan opens the log on Progress');
  await A.tap(`[...document.querySelectorAll('#camps .ccp-log button')].find((b) => b.textContent === 'Log a call or email')`);
  // The tab sticks within a campaign.
  await tabTo('progress');
  await tabTo('plan'); await tabTo('progress');
  ok(await A.ev(`${T('.cc-body')}.dataset.tab === 'progress'`), 'Progress is a tab like the others');
  // A finished campaign says so.
  await api('PATCH', '/campaigns/' + camp.id, { status: 'done' });
  await tabTo('plan'); await tabTo('progress');
  ok(await A.until(`${T('.ccp-health')}?.textContent.includes('Finished')`), 'a finished campaign says Finished');
  // A campaign with no tasks.
  await A.tap(T('.cc-crumb button'));
  await openCamp('Quiet one');
  await tabTo('progress');
  ok(await A.until(`!!${T('.ccp-health')} && !!${T('.ccp-log')} && !!${T('.ccr-top')}`), 'with no tasks: how it’s going, the numbers, the log');
  void quiet;
  // A phone.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth && !!${T('.ccr-top')}`), 'on a phone the numbers wrap, nothing sideways');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
try { chrome.kill(); } catch {}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
