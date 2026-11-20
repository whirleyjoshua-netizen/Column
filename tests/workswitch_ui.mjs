// Switching workspace (the owner, 2026-11-15): Workspace starts with the one you're in (its name ▾). It lists your
// workspaces, + New workspace (your name and email already filled in, your account's password) and Join a workspace
// (name and invite code). After either you're in the new one, and the list switches back.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/workswitch';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5146, APP = `http://127.0.0.1:${PORT}/`, CDP = 9474;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-ws`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-ws`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(80); };
  return { ev, until, tap, mouse, cmd, errors, close: () => ws.close() };
}
let A;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Alpha ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
  // Cy's workspace, which Ada will join with its invite code.
  const cy = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Gamma ' + t, name: 'Cy', email: `cy${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' }) })).json();
  const gammaCode = (await api(cy.token)('GET', '/state')).workspace.inviteCode;
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000), 'Ada is in');
  await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
  const sw = `document.querySelector('#workTabs .ws-switch')`, hs = `document.querySelector('header.bar .ws')`;
  ok(await A.until(`${sw}?.textContent.includes('Alpha ${t}') && document.querySelector('#workTabs').firstElementChild === ${sw}`), 'Workspace starts with the workspace you’re in');
  // Its name opens the workspace profile (2026-11-19); the name in the header switches workspaces.
  await A.tap(sw);
  ok(await A.until(`!!document.querySelector('#sheet .wp .wp-sec') && (!document.body.classList.contains('wide') || !!document.querySelector('#sheet .sheet.page-view .wp-grid'))`), 'the strip’s name opens the workspace profile (at full size, as a page, not a pop-up)');
  ok(await A.ev(`document.body.classList.contains('wide')`), '(the test runs at full size)');
  // Proof, anywhere (step 3): an owner switches proof on quotes & invoices from the profile.
  ok(await A.until(`!!document.querySelector('#sheet .wp-use .wp-onpages') && !document.querySelector('#sheet .wp-use .wp-onpages').checked && document.querySelector('#sheet .wp-use').textContent.includes('{proof}')`), 'the profile has Proof, anywhere: quotes & invoices (off), {proof}, /proof');
  await A.tap(`document.querySelector('#sheet .wp-use .wp-onpages')`);
  ok(await A.until(`document.querySelector('#sheet .wp-use .wp-onpages')?.checked === true`) && (await api(auth.token)('GET', '/profile/settings')).onPages === true, 'an owner turns it on');
  await A.ev(`document.querySelector('#sheet .sheet h2 .icon-btn')?.click(); true`);
  await A.tap(hs);
  ok(await A.until(`[...document.querySelectorAll('#menu .mh')].some((x) => x.textContent === 'Workspaces')`), 'the header’s name lists your workspaces');
  const items = await A.ev(`[...document.querySelectorAll('#menu button')].map((b) => b.textContent).join('|')`);
  ok(items.includes('Alpha ' + t) && items.includes('+ New workspace') && items.includes('Join a workspace'), 'with + New workspace and Join a workspace: ' + items);
  // A new one.
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === '+ New workspace').click(); true`);
  ok(await A.until(`!document.querySelector('#login').classList.contains('hidden') && document.querySelector('#teamField').firstChild.textContent === 'Workspace name'`), 'New workspace asks for its name');
  ok(await A.ev(`(() => { const f = document.querySelector('#loginForm'); return f.name.value === 'Ada' && f.email.value === 'ada${t}@t.test' && document.querySelector('#loginBtn').textContent === 'Create workspace'; })()`), 'your name and email are filled in');
  await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.workspace.value = 'Beta ${t}'; f.password.value = 'longenough1'; document.querySelector('#loginBtn').click(); return true; })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && document.querySelector('#wsName')?.textContent === 'Beta ${t}'`, 20000), 'you’re in the new workspace');
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.until(`!!${sw}`);
  await A.tap(hs);
  const list = await A.ev(`[...document.querySelectorAll('#menu button')].map((b) => b.textContent).join('|')`);
  ok(list.includes('Alpha ' + t) && list.includes('Beta ' + t), 'both are in the list: ' + list);
  // Join Cy's.
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Join a workspace').click(); true`);
  ok(await A.until(`!document.querySelector('#login').classList.contains('hidden') && document.querySelector('#loginBtn').textContent === 'Join workspace' && !document.querySelector('#codeField').classList.contains('hidden')`), 'Join a workspace asks for its name and invite code');
  await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.workspace.value = 'Gamma ${t}'; f.code.value = ${JSON.stringify(gammaCode)}; f.password.value = 'longenough1'; document.querySelector('#loginBtn').click(); return true; })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && document.querySelector('#wsName')?.textContent === 'Gamma ${t}'`, 20000), 'you’re in the workspace you joined');
  // Back to Alpha.
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.until(`!!${sw}`);
  await A.tap(hs);
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Alpha ${t}').click(); true`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && document.querySelector('#wsName')?.textContent === 'Alpha ${t}'`, 20000), 'and switch back to the first');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
