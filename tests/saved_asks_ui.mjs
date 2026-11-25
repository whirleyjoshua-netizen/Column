// Saved asks for the AI team (2026-11-20): in Your team, “☆ Save this ask” keeps what you typed as a chip to send in
// one tap; an automation’s Ask your team step can start from it.
import { autoUI } from './autobuild.mjs';
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/saved_asks_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5166, CDP = 9496, APP = `http://127.0.0.1:${PORT}/`;
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
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Asks ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=agents]')`, 15000);
  await A.ev(`document.querySelector('#tabs [data-tab=agents]').click(); true`);
  ok(await A.until(`!!document.querySelector('.ag-box .ask-save')`, 10000), 'Your team’s ask box has “☆ Save this ask”');
  await A.fill(`document.querySelector('.ag-box .ag-ask')`, 'Sum up this week’s sales and what to chase next');
  await A.ev(`document.querySelector('.ag-box .ask-save').click(); true`);
  ok(await A.until(`!!document.querySelector('#sheet .ask-name') && document.querySelector('#sheet .ask-said').textContent.startsWith('Sum up this week')`), 'saving shows the ask and asks for a name');
  await A.fill(`document.querySelector('#sheet .ask-name')`, 'Weekly sales summary');
  await A.ev(`document.querySelector('#sheet .primary-btn').click(); true`);
  let y = null;
  for (let i = 0; i < 30 && !y; i++) { await sleep(150); y = (await api('GET', '/task-presets')).presets.find((x) => x.kind === 'ask'); }
  ok(y && y.name === 'Weekly sales summary' && y.agent === 'team' && y.ask.startsWith('Sum up this week'), 'saved for the whole team');
  ok(await A.until(`[...document.querySelectorAll('.ag-box .ask-chip')].some((c) => c.textContent.includes('Weekly sales summary'))`), 'and it’s a chip under the box, to send in one tap');
  ok(await A.ev(`document.querySelector('.ag-box .ask-chip').disabled`), '(no AI key here, so the chip waits for one, like the box)');

  // The automation builder starts an "Ask your team" step from it.
  await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`);
  await A.until(`[...document.querySelectorAll('#tool button')].some((b) => b.textContent === '+ New automation')`, 8000);
  await A.ev(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ New automation').click(); true`);
  const B = autoUI(A);
  await B.step(B.act(0), 'agent');
  await B.adv();
  ok(await A.until(`!!document.querySelector('#sheet .auto-ask-from')`), 'the Ask your team step offers “Start from a saved ask” (under Advanced settings)');
  await A.pick(`document.querySelector('#sheet .auto-ask-from')`, y.id);
  await B.set();
  ok(await A.until(`document.querySelector('#sheet .auto-agent-ask')?.value.startsWith('Sum up this week')`), 'picking it fills in what to ask');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill('SIGKILL');
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
