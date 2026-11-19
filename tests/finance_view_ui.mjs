// Finance step 2 in the app (2026-11-20): for owners and admins, Finance has Invoices (owed, overdue, paid this
// month; every invoice, opening it) and Quotes (waiting, accepted, win rate; a quote opens its record).
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/finance_view_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5155, CDP = 9480, APP = `http://127.0.0.1:${PORT}/`;
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
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'FinView ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true } });
  const p = await api('POST', '/projects', { template: 'bids', name: 'Estimating' });
  const T = Object.fromEntries(p.types.map((x) => [x.key, x]));
  const add = (k, values) => api('POST', `/projects/${p.id}/records`, { typeId: T[k].id, values });
  const cl = await add('clients', { name: 'Desert Auto', email: 'maria@x.test' });
  const q = await add('quotes', { title: 'Showroom tint', client: cl.id, valid_until: '2099-12-31', items: { rows: [{ desc: 'Film', qty: 2, price: 100 }] } });
  await api('POST', `/records/${q.id}/share`, { hours: 0 });
  const tr = await api('POST', '/projects', { template: 'trades', trades: ['blinds'] });
  const job = await api('POST', `/projects/${tr.id}/records`, { typeId: tr.types[0].id, values: { job: 'Smith shades', value: 1500 } });
  const inv = await api('POST', `/records/${job.id}/invoices`);
  await api('POST', `/invoices/${inv.id}/send`, {}).catch(() => {});

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000);
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.until(`!!document.querySelector('#workTabs [data-tab=tools]')`);
  await A.ev(`document.querySelector('#workTabs [data-tab=tools]').click(); true`);
  await A.until(`!!document.querySelector('#menu [data-tool=bills]')`);
  await A.ev(`document.querySelector('#menu [data-tool=bills]').click(); true`);
  ok(await A.until(`!!document.querySelector('#split .fin-tabs [data-fin=invoices]') && !!document.querySelector('#split .fin-tabs [data-fin=quotes]')`), 'Finance has Invoices and Quotes tabs for an owner');
  await A.ev(`document.querySelector('#split .fin-tabs [data-fin=invoices]').click(); true`);
  ok(await A.until(`document.querySelectorAll('#split .fin-card').length === 3 && [...document.querySelectorAll('#split .fin-card')][0].textContent.startsWith('Owed to you')`), 'Invoices: owed, overdue, paid this month');
  await A.ev(`[...document.querySelectorAll('#split .fin-inv-f button')].find((b) => b.textContent === 'All').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#split .fin-inv')].some((r) => r.textContent.includes(${JSON.stringify(inv.number)}))`), 'the job’s invoice is listed');
  await A.ev(`document.querySelector('#split .fin-inv').click(); true`);
  ok(await A.until(`!document.querySelector('#sheet').classList.contains('hidden') && document.querySelector('#sheet').textContent.includes(${JSON.stringify(inv.number)})`), 'and opens');
  await A.ev(`document.querySelector('#sheet').classList.add('hidden'); true`);
  await A.ev(`document.querySelector('#split .fin-tabs [data-fin=quotes]').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#split .fin-q')].some((r) => r.textContent.includes('Showroom tint') && r.textContent.includes('Waiting') && r.textContent.includes('200.00'))`), 'Quotes lists the sent quote, waiting, $200');
  ok(await A.ev(`[...document.querySelectorAll('#split .fin-card')].some((c) => c.textContent.startsWith('Win rate'))`), 'with the win rate');
  await A.ev(`document.querySelector('#split .fin-q').click(); true`);
  ok(await A.until(`!!document.querySelector('.pj-panel')`, 8000), 'a quote opens its record');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill('SIGKILL');
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
