import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// Linking into chat, in the browser: the link picker finds jobs, projects and docs; a picked job posts as a chip
// with its status and date that opens the job; Share to chat in a job's menu posts it to a feed; a teammate who
// can't open something sees a plain "can't open" chip without its name.
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chatlinksui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4703, APP = `http://127.0.0.1:${PORT}/`;
FS.rmSync(`${S}/dk/chrome8`, { recursive: true, force: true });
try { (await import('node:child_process')).execSync('pkill -f remote-debugging-port=9340'); await new Promise((r) => setTimeout(r, 500)); } catch {}
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9340, 'chrome8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9340) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${port}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9], z: [90] };
  const key = async (k, modifiers = 0) => { const [code, text] = KEYS[k]; await cmd('Input.dispatchKeyEvent', { type: text && !modifiers ? 'keyDown' : 'rawKeyDown', key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: code, modifiers, ...(text && !modifiers ? { text } : {}) }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, modifiers }); await sleep(40); };
  const type = async (t) => { await cmd('Input.insertText', { text: t }); await sleep(40); };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => {
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(80);
  };
  const click = (sel) => ev(`(() => { const e = typeof ${JSON.stringify(sel)} === 'string' ? document.querySelector(${JSON.stringify(sel)}) : null; e.click(); return true; })()`);
  return { ev, key, type, until, click, tap, cmd, errors, close: () => ws.close() };
}






const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const t = Date.now();
const post = async (body) => (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const ada = await post({ mode: 'create', workspace: 'Premier ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const as = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const api = as(ada.token);
const code = (await api('GET', '/state')).workspace.inviteCode;
const ben = await post({ mode: 'join', workspace: 'Premier ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
await api('PATCH', '/workspace', { tools: { projects: true, docs: true } });
const jobs = await api('POST', '/projects', { template: 'jobs', name: 'Installs' });
const jt = jobs.types.find((x) => x.key === 'jobs');
const job = await api('POST', `/projects/${jobs.id}/records`, { typeId: jt.id, values: { job: 'Henderson shades', install_date: '2026-11-20', value: 2400 } });
const secret = await api('POST', '/projects', { template: 'blank', name: 'Ada private', private: true });
const sRec = await api('POST', `/projects/${secret.id}/records`, { typeId: secret.types[0].id, values: { name: 'Surprise party' } });
await api('POST', '/items', { type: 'text', doc: { title: 'Install checklist', blocks: [] } });
let A;
const signIn = async (tok) => { await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000); await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`).catch(() => {}); await sleep(1500); await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 20000); await sleep(600); };
try {
  A = await tab(APP);
  await signIn(ada.token);
  ok(await A.ev(`!document.querySelector('#app').classList.contains('hidden')`), 'Ada is in');
  await A.click('#tabs [data-tab=tools]'); await A.until(`!!document.querySelector('#menu [data-tool=chat]')`); await A.click('#menu [data-tool=chat]');
  await A.until(`!!document.querySelector('#chat .link-btn')`);
  await A.ev(`document.querySelector('#chat .link-btn').click()`);
  ok(await A.until(`!!document.querySelector('.picker .pk-q')`), 'the link picker opens');
  ok(await A.until(`[...document.querySelectorAll('.picker .mh')].map((x) => x.textContent).includes('Jobs & records')`, 8000), 'it has Jobs & records');
  ok(await A.ev(`[...document.querySelectorAll('.picker .mh')].map((x) => x.textContent).includes('Docs') && [...document.querySelectorAll('.picker .mh')].map((x) => x.textContent).includes('Boards')`), 'and Docs and Boards');
  await A.ev(`(() => { const q = document.querySelector('.picker .pk-q'); q.value = 'henderson'; q.dispatchEvent(new Event('input')); return true; })()`);
  ok(await A.until(`[...document.querySelectorAll('.picker .pk-row')].some((r) => r.textContent.includes('Henderson shades'))`), 'searching finds the job');
  await A.ev(`[...document.querySelectorAll('.picker .pk-row')].find((r) => r.textContent.includes('Henderson shades')).click()`);
  ok(await A.until(`document.querySelector('#chat .tray')?.textContent.includes('Henderson shades')`), 'it waits in the message box');
  await A.ev(`(() => { const ta = document.querySelector('#chat .chat-pane textarea'); ta.value = 'Can someone take this?'; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  ok(await A.until(`[...document.querySelectorAll('#chat .ln-record')].some((c) => c.textContent.includes('Henderson shades') && c.textContent.includes('Nov 20') && c.textContent.includes('$2,400'))`, 8000), 'posted: a chip with the job, its date and value');
  await A.ev(`[...document.querySelectorAll('#chat .ln-record')].find((c) => c.textContent.includes('Henderson shades')).click()`);
  ok(await A.until(`!document.querySelector('#projects').classList.contains('hidden') && document.querySelector('.pj-panel')?.dataset.id === ${JSON.stringify(job.id)}`, 8000), 'clicking it opens the job');
  // Share to chat from the job's menu
  await A.ev(`document.querySelector('.pj-panel [aria-label="Record options"]').click()`);
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Share to chat…').click()`);
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '# general')`), 'Share to chat asks which feed');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === '# general').click()`);
  await sleep(600);
  const msgs = (await api('GET', '/state')).items.filter((i) => i.type === 'message');
  ok(msgs.filter((m) => m.text.includes(`[[record:${job.id}]]`)).length === 2, 'the job is shared in #general');
  // Ben, and a record he can't open
  await api('POST', '/items', { type: 'message', text: `For me: [[record:${sRec.id}]]` });
  await signIn(ben.token);
  await A.click('#tabs [data-tab=tools]'); await A.until(`!!document.querySelector('#menu [data-tool=chat]')`); await A.click('#menu [data-tool=chat]');
  ok(await A.until(`[...document.querySelectorAll('#chat .ln-gone')].some((c) => c.textContent.includes('A record') && c.textContent.includes('can’t open'))`, 8000), 'Ben sees a plain “can’t open” chip for Ada’s private record');
  ok(await A.ev(`!document.querySelector('#chat').textContent.includes('Surprise party')`), 'never its name');
  ok(await A.ev(`[...document.querySelectorAll('#chat .ln-record')].some((c) => c.textContent.includes('Henderson shades'))`), 'and the team’s job opens for him as usual');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'nothing runs off the side on a phone');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').filter((l) => /error|fail/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
