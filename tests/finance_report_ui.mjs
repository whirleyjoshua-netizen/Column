// Finance step 4b in the app (2026-11-20): Finance → Reports for owners and admins: money in, out, profit and the
// set-aside for a period; spending with its tax category (changeable); a set-aside percent; a CSV for the accountant.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/finance_report_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5161, CDP = 9486, APP = `http://127.0.0.1:${PORT}/`;
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
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'RepUI ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, bills: true } });
  const now = new Date();
  const day = (n) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  await api('POST', '/money', { kind: 'in', amount: '3000', day: day(2), category: 'Sales', note: 'Smith job', scope: 'business' });
  await api('POST', '/money', { kind: 'out', amount: '400', day: day(3), category: 'Fuel', note: 'Gas', scope: 'business' });
  await api('POST', '/money', { kind: 'out', amount: '250', day: day(4), category: 'Software', note: 'Apps', scope: 'business' });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000);
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.until(`!!document.querySelector('#workTabs [data-tab=tools]')`);
  await A.ev(`document.querySelector('#workTabs [data-tab=tools]').click(); true`);
  await A.until(`!!document.querySelector('#menu [data-tool=bills]')`);
  await A.ev(`document.querySelector('#menu [data-tool=bills]').click(); true`);
  await A.until(`!!document.querySelector('#split .fin-tabs [data-fin=reports]')`);
  await A.ev(`document.querySelector('#split .fin-tabs [data-fin=reports]').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#split .fin-card')].map((c) => c.firstChild.textContent).join('|') === 'Money in|Money out|Profit|Set aside for taxes'`), 'Reports: money in, money out, profit, set aside');
  await A.pick(`document.querySelector('#split .fin-period')`, 'month');
  ok(await A.until(`[...document.querySelectorAll('#split .fin-card')][2]?.textContent.includes('2,350.00')`), 'this month’s profit: $3,000 − $650 = $2,350');
  ok(await A.ev(`document.querySelector('#split .fin-taxline[data-cat="Fuel"]').value === 'Car & truck'`), 'Fuel goes under Car & truck');
  await A.pick(`document.querySelector('#split .fin-taxline[data-cat="Software"]')`, 'Supplies & materials');
  let r = null;
  const [y, mo] = [now.getFullYear(), now.getMonth()];
  const from = `${y}-${String(mo + 1).padStart(2, '0')}-01`, to = new Date(y, mo + 1, 0);
  const toK = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < 30; i++) { await sleep(200); r = await api('GET', `/finance/report?from=${from}&to=${toK}`); if (r.expensesBy?.find((e) => e.name === 'Software')?.taxLine === 'Supplies & materials') break; }
  ok(r.expensesBy.find((e) => e.name === 'Software').taxLine === 'Supplies & materials', 'changing a tax category is kept');
  await A.fill(`document.querySelector('#split .fin-taxpct')`, '20');
  await A.ev(`document.querySelector('#split .fin-taxpct').dispatchEvent(new Event('change', { bubbles: true })); true`);
  ok(await A.until(`[...document.querySelectorAll('#split .fin-card')][3]?.textContent.includes('470.00')`), 'set aside 20%: $470');
  ok(await A.ev(`!!document.querySelector('#split .fin-csv')`), 'and an export for your accountant');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill('SIGKILL');
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
