import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// Pinned to a chat, in the browser: pin a stack from the bar, it opens beside the feed; drag a card from it into the
// chat (posted as a link) and a message from the chat into it (kept as a note); a chat message's "keep a copy"
// menu; Ben sees the pin; unpinning closes it; a phone fits.
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chatpinsui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4862, APP = `http://127.0.0.1:${PORT}/`;
FS.rmSync(`${S}/dk/chrome-cp`, { recursive: true, force: true });
try { (await import('node:child_process')).execSync('pkill -f remote-debugging-port=9460'); await new Promise((r) => setTimeout(r, 500)); } catch {}
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9460, 'chrome-cp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9460) {
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
const ada = await post({ mode: 'create', workspace: 'Pins ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const as = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const api = as(ada.token);
const code = (await api('GET', '/state')).workspace.inviteCode;
const ben = await post({ mode: 'join', workspace: 'Pins ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
const stack = (await api('POST', '/stacks', { name: 'Henderson job' })).stacks.find((x) => x.name === 'Henderson job');
const file = await (await fetch(`${APP}api/upload?name=plan.txt&stackId=${stack.id}`, { method: 'PUT', headers: { authorization: 'Bearer ' + ada.token }, body: 'the plan' })).json();
const msg = await api('POST', '/items', { type: 'message', text: 'Gate code is 4412' });
// A drag inside the page, as the browser sends it: dragstart on the thing, dragover and drop where it lands.
const drag = (from, to) => `(() => { const a = ${from}, b = ${to}; const dt = new DataTransfer(); const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); ev(a, 'dragstart'); ev(b, 'dragenter'); ev(b, 'dragover'); ev(b, 'drop'); ev(a, 'dragend'); return true; })()`;
let A;
const signIn = async (tok) => { await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000); await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`).catch(() => {}); await sleep(1500); await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 20000); await sleep(600); };
try {
  A = await tab(APP);
  await signIn(ada.token);
  await A.click('#tabs [data-tab=tools]'); await A.until(`!!document.querySelector('#menu [data-tool=chat]')`); await A.click('#menu [data-tool=chat]');
  ok(await A.until(`document.querySelector('#chat .ch-pins .cp-add')?.textContent.includes('Pin a stack')`), 'an empty chat offers to pin a stack, doc or folder');
  await A.ev(`document.querySelector('#chat .ch-pins .cp-add').click()`);
  ok(await A.until(`[...document.querySelectorAll('#menu .mh')].some((x) => x.textContent === 'Stacks') && [...document.querySelectorAll('#menu .mh')].some((x) => x.textContent === 'Agents')`), 'the pin menu lists stacks and agents');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Henderson job')).click()`);
  ok(await A.until(`document.querySelector('#chat .ch-pins .cp[data-kind=stack] .cp-name')?.textContent === 'Henderson job'`), 'the stack is pinned to #general');
  ok(await A.until(`document.querySelector('#chat .ch-shelf .ch-title')?.textContent.includes('Henderson job') && [...document.querySelectorAll('#chat .ch-shelf .card')].some((c) => c.textContent.includes('plan.txt'))`), 'it opens beside the feed, with its cards');
  // From the stack into the chat: posted as a link to the file.
  await A.ev(drag(`[...document.querySelectorAll('#chat .ch-shelf .card')].find((c) => c.textContent.includes('plan.txt'))`, `document.querySelector('#chat .ch-main .chat-pane .list')`));
  ok(await A.until(`[...document.querySelectorAll('#chat .ch-main .msg .links')].some((l) => l.textContent.includes('plan.txt'))`), 'a card dragged into the chat posts a link to it');
  ok((await api('GET', '/state')).items.filter((x) => x.id === file.id).length === 1, 'the file itself stays in the stack (no copy)');
  // From the chat into the stack: the message is kept as a note there, and stays in the chat.
  await A.ev(drag(`[...document.querySelectorAll('#chat .ch-main .msg')].find((m) => m.textContent.includes('Gate code is 4412')).querySelector('.who')`, `document.querySelector('#chat .ch-shelf .list')`));
  ok(await A.until(`[...document.querySelectorAll('#chat .ch-shelf .card')].some((c) => c.textContent.includes('Gate code is 4412'))`), 'a message dragged into the stack is kept there as a note');
  ok(await A.ev(`[...document.querySelectorAll('#chat .ch-main .msg')].some((m) => m.textContent.includes('Gate code is 4412'))`), 'and it stays in the chat');
  // The copy menu on a chat message.
  await A.ev(`[...document.querySelectorAll('#chat .ch-main .msg')].find((m) => m.textContent.includes('Gate code')).querySelector('[aria-label="Keep a copy in a stack or folder"]').click()`);
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '📌 Henderson job')`), 'a message’s copy menu puts the pinned stack first');
  await A.ev(`document.querySelector('#menu').classList.add('hidden')`);
  // Ben sees the pin.
  await signIn(ben.token);
  await A.click('#tabs [data-tab=tools]'); await A.until(`!!document.querySelector('#menu [data-tool=chat]')`); await A.click('#menu [data-tool=chat]');
  ok(await A.until(`document.querySelector('#chat .ch-pins .cp[data-kind=stack] .cp-name')?.textContent === 'Henderson job'`), 'Ben sees the pinned stack');
  await A.ev(`document.querySelector('#chat .ch-pins .cp[data-kind=stack] .cp-open').click()`);
  ok(await A.until(`!!document.querySelector('#chat .ch-shelf')`), 'and opens it beside the feed');
  await A.ev(`document.querySelector('#chat .ch-shelf .shelf-acts .btn').click()`);
  ok(await A.until(`document.querySelector('#tabs [data-tab=column]')?.classList.contains('on') || !document.querySelector('#column')?.classList.contains('hidden')`), 'Open takes him to the whole stack');
  await A.click('#tabs [data-tab=tools]'); await A.until(`!!document.querySelector('#menu [data-tool=chat]')`); await A.click('#menu [data-tool=chat]');
  await sleep(300);
  await A.ev(`document.querySelector('#chat .ch-pins .cp[data-kind=stack] .cp-open').click()`);
  await A.until(`!!document.querySelector('#chat .ch-shelf')`);
  await A.ev(`document.querySelector('#chat .ch-pins .cp[data-kind=stack] .cp-x').click()`);
  ok(await A.until(`!document.querySelector('#chat .ch-pins .cp') && !document.querySelector('#chat .ch-shelf')`), 'unpinning takes the chip off and closes the stack');
  // A pinned agent: tapping it starts a message to it, in the chat.
  await api('POST', '/channels/general/pins', { kind: 'agent', id: 'chief' });
  ok(await A.until(`!!document.querySelector('#chat .ch-pins .cp[data-kind=agent]')`), 'the Chief of Staff is pinned');
  await A.ev(`document.querySelector('#chat .ch-pins .cp[data-kind=agent] .cp-open').click()`);
  ok(await A.until(`document.querySelector('#chat .ch-main textarea')?.value.startsWith('@Chief of Staff ') && document.activeElement === document.querySelector('#chat .ch-main textarea')`), 'tapping a pinned agent starts a message to it');
  await A.ev(`(() => { const ta = document.querySelector('#chat .ch-main textarea'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#chat .ch-pins .cp[data-kind=agent] .cp-x').click(); return true; })()`);
  await A.until(`!document.querySelector('#chat .ch-pins .cp')`);
  await A.ev(`document.querySelector('#chat .ch-pins .cp-add').click()`);
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Henderson job')).click()`);
  await A.until(`!!document.querySelector('#chat .ch-shelf')`);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'nothing runs off the side on a phone');
  ok(await A.ev(`(() => { const r = document.querySelector('#chat .ch-shelf').getBoundingClientRect(); return r.width >= 370; })()`), 'on a phone the stack covers the feed, like a thread');
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
