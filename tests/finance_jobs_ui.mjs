// Finance step 1 in the app (2026-11-20): from a job, “+ Add an expense” opens money out already on that job, as
// business money; it can be split with another job; the job's costs show its share, and Finance lists it once.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/finance_jobs_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5153, CDP = 9478, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
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
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    await until(`(() => { const e = ${expr}; if (!e) return false; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (top === e || e.contains(top)); })()`, 6000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, pick, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'FinJobs ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true } });
  const p = await api('POST', '/projects', { template: 'trades', trades: ['blinds'] });
  const job = await api('POST', `/projects/${p.id}/records`, { typeId: p.types[0].id, values: { job: 'Smith shades' } });
  const job2 = await api('POST', `/projects/${p.id}/records`, { typeId: p.types[0].id, values: { job: 'Jones shades' } });

  const A = await tab(APP);
  // The job window is in tabs (2026-11-19): pjT(k, sub) opens tab k (and a Finance sub-tab) first, inside a check.
  const pjT = (k, sub) => `(document.querySelector('.pj-panel .pj-tab[data-tab=${k}]:not(.on)')?.click() ?? true) && ${sub ? `(document.querySelector('.pj-panel .pj-subtab[data-fin=${sub}]:not(.on)')?.click() ?? true) && ` : ''}`;
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.href = ${JSON.stringify(APP + '?go=rec:')} + ${JSON.stringify(job.id)}; true`);
  await A.until(`!!document.querySelector('.pj-panel .pj-tab[data-tab=finance]')`, 20000);
  await A.ev(`document.querySelector('.pj-panel .pj-tab[data-tab=finance]').click(); true`);
  await A.until(`!!document.querySelector('.pj-panel .pj-subtab[data-fin=cost]')`);
  await A.ev(`document.querySelector('.pj-panel .pj-subtab[data-fin=cost]').click(); true`);
  ok(await A.until(`${pjT('finance', 'cost')}!!document.querySelector('.pj-panel .pj-add-exp')`, 20000), 'the job’s costs (Finance → Cost) have “+ Add an expense”');
  ok(await A.ev(`[...document.querySelectorAll('.pj-panel .pj-cost-row')].some((r) => r.textContent.startsWith('Expenses'))`), 'and an Expenses line');
  await A.tap(`document.querySelector('.pj-panel .pj-add-exp')`);
  ok(await A.until(`!!document.querySelector('#sheet .mj-job') && document.querySelector('#sheet .mj-job').value === ${JSON.stringify(job.id)}`), 'the expense sheet opens already on this job');
  ok(await A.ev(`[...document.querySelectorAll('#sheet select')].some((s) => s.value === 'business')`), 'as business money');
  await A.fill(`[...document.querySelectorAll('#sheet input')].find((i) => i.placeholder === '0.00')`, '90');
  await A.fill(`[...document.querySelectorAll('#sheet input')].find((i) => i.placeholder === 'Where, what for')`, 'Freight from Acme');
  // Split it with the other job.
  await A.tap(`document.querySelector('#sheet .mj-add')`);
  await A.until(`document.querySelectorAll('#sheet .mj-job').length === 2`);
  await A.pick(`document.querySelectorAll('#sheet .mj-job')[1]`, job2.id);
  await A.fill(`document.querySelectorAll('#sheet .mj-share')[0]`, '60');
  await A.tap(`document.querySelector('#sheet .primary-btn')`);
  let x = null;
  for (let i = 0; i < 40 && !x; i++) { x = (await api('GET', '/state')).money.find((y) => y.note === 'Freight from Acme'); await sleep(150); }
  ok(x && x.scope === 'business' && x.jobs?.length === 2 && x.jobs[0].amount === 6000 && x.jobs[1].amount === 3000, 'saved: one $90 entry, $60 on Smith and $30 on Jones');
  ok(await A.until(`[...document.querySelectorAll('.pj-panel .pj-cost-row')].some((r) => r.textContent.startsWith('Expenses') && r.textContent.includes('60.00'))`, 8000), 'the job’s Expenses shows its $60 share');
  ok(await A.until(`[...document.querySelectorAll('.pj-panel .pj-cost-ent')].some((r) => r.textContent.includes('Freight from Acme') && r.textContent.includes('2 jobs'))`), 'listed, saying it’s split across 2 jobs');

  // In Finance it's one entry, saying it's split.
  await A.ev(`document.querySelector('.pj-panel [aria-label=Close]')?.click(); true`);
  await A.ev(`document.querySelector('#workTabs [data-tab=tools]').click(); true`);
  await A.until(`!!document.querySelector('#menu [data-tool=bills]')`);
  await A.ev(`document.querySelector('#menu [data-tool=bills]').click(); true`);
  await A.until(`!!document.querySelector('#split .seg')`);
  await A.ev(`[...document.querySelectorAll('#split .seg button')].find((b) => b.textContent === 'In & out')?.click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#split .bill-name')].filter((r) => r.textContent.includes('Freight from Acme')).length === 1 && [...document.querySelectorAll('#split .bill-name')].some((r) => r.textContent.includes('split across 2 jobs'))`), 'Finance lists it once, split across 2 jobs');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill('SIGKILL');
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
