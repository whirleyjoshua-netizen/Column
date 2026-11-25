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
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
try { chrome.kill(); } catch {}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
