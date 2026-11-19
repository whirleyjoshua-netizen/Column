// Finance step 4 in the app (2026-11-20): a job shows its estimate (price lines' costs) apart from actual cost, says
// so when nothing actual is in yet, and the rates sheet sets the team rate, each person's rate, and overhead.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/costing_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5159, CDP = 9484, APP = `http://127.0.0.1:${PORT}/`;
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
  const post = async (b) => (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
  const a = await post({ mode: 'create', workspace: 'CostUI ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await post({ mode: 'join', workspace: 'CostUI ' + t, code: st.workspace.inviteCode, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const benId = (await api('GET', '/state')).workspace.members.find((m) => m.name === 'Ben').id;
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true } });
  const tr = await api('POST', '/projects', { template: 'trades', trades: ['blinds'] });
  const bl = tr.types.find((x) => x.key === 'trade_blinds');
  const itemsF = bl.fields.find((f) => f.type === 'items');
  const job = await api('POST', `/projects/${tr.id}/records`, { typeId: bl.id, values: { job: 'Smith shades' } });
  await api('PATCH', '/records/' + job.id, { values: { [itemsF.id]: { rows: [{ desc: 'Shades', qty: 4, price: 250, cost: 100 }] } } });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.href = ${JSON.stringify(APP + '?go=rec:')} + ${JSON.stringify(job.id)}; true`);
  ok(await A.until(`!!document.querySelector('.pj-panel .pj-cost-est')`, 20000), 'the job shows its estimated cost from the price lines');
  ok(await A.ev(`document.querySelector('.pj-panel .pj-cost-est').textContent.includes('400.00') && document.querySelector('.pj-panel .pj-cost-est').textContent.includes('60%')`), 'with the estimated margin: $400 · 60%');
  ok(await A.ev(`[...document.querySelectorAll('.pj-panel .pj-cost-row')].some((r) => r.textContent.startsWith('Margin') && r.textContent.includes('No actual costs yet'))`), 'and says there are no actual costs yet, instead of a made-up margin');
  await A.tap(`document.querySelector('.pj-panel .pj-rates')`);
  ok(await A.until(`!!document.querySelector('#sheet .lr-team') && document.querySelectorAll('#sheet .lr-person').length === 2`), 'the rates sheet has the team rate and one for each person');
  await A.fill(`document.querySelector('#sheet .lr-team')`, '40');
  await A.fill(`document.querySelector('#sheet .lr-person[data-member="${benId}"]')`, '25');
  await A.fill(`document.querySelector('#sheet .lr-oh')`, '12');
  await A.tap(`document.querySelector('#sheet .primary-btn')`);
  let c = null;
  for (let i = 0; i < 40 && !(c?.rates?.people?.[benId]); i++) { await sleep(200); c = await api('GET', `/records/${job.id}/costing`); }
  ok(c?.rates?.team === 4000 && c.rates.people[benId] === 2500 && c.overheadPct === 12, 'saved: team $40, Ben $25, overhead 12%');
  ok(await A.until(`!!document.querySelector('.pj-panel .pj-cost-oh') && document.querySelector('.pj-panel .pj-cost-oh').textContent.includes('12%')`), 'and the job shows its overhead line');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill('SIGKILL');
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
