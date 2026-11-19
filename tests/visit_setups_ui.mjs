// Saved visit setups (2026-11-20): booking a visit on a job, “+ Save as a setup” keeps its kind, time, length, crew
// and note for the team; on another job, “Start from a saved setup” fills them in, and it books as saved.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/visit_setups_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5165, CDP = 9494, APP = `http://127.0.0.1:${PORT}/`;
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
  const a = await post({ mode: 'create', workspace: 'VS ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await post({ mode: 'join', workspace: 'VS ' + t, code: st.workspace.inviteCode, name: 'Casey', email: `casey${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const caseyId = (await api('GET', '/state')).workspace.members.find((m) => m.name === 'Casey').id;
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const tr = await api('POST', '/projects', { template: 'trades', trades: ['blinds'] });
  const bl = tr.types.find((x) => x.key === 'trade_blinds');
  const job = await api('POST', `/projects/${tr.id}/records`, { typeId: bl.id, values: { job: 'Smith shades' } });
  const job2 = await api('POST', `/projects/${tr.id}/records`, { typeId: bl.id, values: { job: 'Jones shades' } });
  const open = async (rec) => {
    await A.ev(`location.href = ${JSON.stringify(APP + '?go=rec:')} + ${JSON.stringify(rec.id)}; true`);
    await A.until(`!!document.querySelector('.pj-panel .pj-tab[data-tab=work]')`, 20000);
    await A.ev(`document.querySelector('.pj-panel .pj-tab[data-tab=work]').click(); true`);
    await A.until(`[...document.querySelectorAll('.pj-panel button')].some((b) => b.textContent.startsWith('+ Sc'))`);
    await A.ev(`[...document.querySelectorAll('.pj-panel button')].find((b) => b.textContent.startsWith('+ Sc')).click(); true`);
    return A.until(`!document.querySelector('#sheet').classList.contains('hidden') && !!document.querySelector('#sheet .vs-row')`);
  };

  var A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); true`);
  ok(await open(job), 'a new visit has “+ Save as a setup”');
  // Make it an Install, 8:00–11:00, Casey going, and save that as a setup.
  await A.pick(`document.querySelector('#sheet select')`, 'Install');
  await A.ev(`(() => { const s = document.querySelector('#sheet'); const tm = s.querySelectorAll('input[type=time]'); tm[0].value = '08:00'; tm[1].value = '11:00'; return true; })()`);
  await A.ev(`(() => { const cbs = [...document.querySelectorAll('#sheet .pj-crew input[type=checkbox]')]; cbs.forEach((cb, i) => { cb.checked = i === 1; cb.dispatchEvent(new Event('change')); }); return true; })()`);
  await A.ev(`document.querySelector('#sheet textarea').value = 'Bring the drill kit'; true`);
  await A.ev(`document.querySelector('#sheet .vs-save').click(); true`);
  ok(await A.until(`!!document.querySelector('#sheet .vs-name')`), 'saving asks for a name');
  await A.fill(`document.querySelector('#sheet .vs-name')`, 'Standard install');
  await A.ev(`document.querySelector('#sheet .primary-btn').click(); true`);
  let y = null;
  for (let i = 0; i < 30 && !y; i++) { await sleep(150); y = (await api('GET', '/task-presets')).presets.find((x) => x.kind === 'visit'); }
  ok(y && y.name === 'Standard install' && y.visit === 'Install' && y.start === 480 && y.minutes === 180 && y.memberIds.join() === caseyId && y.note === 'Bring the drill kit', 'saved: Install, 8:00, 3 hours, Casey, the note');
  ok(await A.until(`!!document.querySelector('#sheet .vs-row') && [...document.querySelectorAll('#sheet select:not(.vs-pick)')][0]?.value === 'Install'`), 'and the visit sheet comes back as it was');

  // Another job: start from the setup, book it.
  ok(await open(job2), 'Jones’s new visit');
  ok(await A.until(`!!document.querySelector('#sheet .vs-pick') && [...document.querySelector('#sheet .vs-pick').options].some((o) => o.textContent.startsWith('Standard install'))`), 'offers “Start from a saved setup… Standard install”');
  await A.pick(`document.querySelector('#sheet .vs-pick')`, y.id);
  ok(await A.ev(`(() => { const s = document.querySelector('#sheet'); const tm = s.querySelectorAll('input[type=time]'); const sel = [...s.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Install')); return sel.value === 'Install' && tm[0].value === '08:00' && tm[1].value === '11:00' && s.querySelector('textarea').value === 'Bring the drill kit'; })()`), 'picking it fills in the kind, the time, how long and the note');
  await A.ev(`document.querySelector('#sheet .primary-btn').click(); true`);
  let v = null;
  for (let i = 0; i < 30 && !v; i++) { await sleep(200); v = (await api('GET', `/records/${job2.id}/visits`))?.[0]; }
  ok(v && v.kind === 'Install' && v.start === 480 && v.end === 660 && v.memberIds.join() === caseyId && v.note === 'Bring the drill kit', 'booked: Install 8:00–11:00 for Casey, with the note');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill('SIGKILL');
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
