import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chatpanelsui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5141, APP = `http://127.0.0.1:${PORT}/`;
FS.rmSync(`${S}/dk/chrome-cp`, { recursive: true, force: true });
try { (await import('node:child_process')).execSync('pkill -f remote-debugging-port=9466'); await new Promise((r) => setTimeout(r, 500)); } catch {}
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9466, 'chrome-cp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9466) {
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
// A doc or folder pinned to a chat opens beside the feed, as a pinned stack does: the doc to read (Open edits it in
// full), the folder to browse (into a subfolder and back). Its files drag into the chat as links, and things from the
// chat drag into the open folder. One side panel at a time: a thread or the stack replaces it.
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const t = Date.now();
const post = async (body) => (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const ada = await post({ mode: 'create', workspace: 'Panels ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const as = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const api = as(ada.token);
const doc = await api('POST', '/items', { type: 'text', doc: { title: 'Site rules', blocks: [{ id: 'b1', type: 'p', runs: [{ text: 'Wear a hard hat on site.' }] }] } });
const dir = await api('POST', '/dirs', { name: 'Permits' });
const sub = await api('POST', '/dirs', { name: '2026', parentId: dir.id });
await (await fetch(`${APP}api/upload?name=permit.txt&dirId=${dir.id}`, { method: 'PUT', headers: { authorization: 'Bearer ' + ada.token }, body: 'permit' })).json();
await (await fetch(`${APP}api/upload?name=inspection.txt&dirId=${sub.id}`, { method: 'PUT', headers: { authorization: 'Bearer ' + ada.token }, body: 'inspection' })).json();
await api('POST', '/channels/general/pins', { kind: 'doc', id: doc.id });
await api('POST', '/channels/general/pins', { kind: 'dir', id: dir.id });
await api('POST', '/items', { type: 'message', text: 'Gate code is 4412' });
const drag = (from, to) => `(() => { const a = ${from}, b = ${to}; const dt = new DataTransfer(); const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); ev(a, 'dragstart'); ev(b, 'dragenter'); ev(b, 'dragover'); ev(b, 'drop'); ev(a, 'dragend'); return true; })()`;
let A;
const signIn = async (tok) => { await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000); await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`).catch(() => {}); await sleep(1500); await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 20000); await sleep(600); };
const panel = `document.querySelector('#chat .ch-panel')`;
const visible = (sel) => `(() => { const e = ${sel}; return !!e && e.offsetParent !== null && !e.closest('.hidden'); })()`;
try {
  A = await tab(APP);
  await signIn(ada.token);
  await A.click('#tabs [data-tab=tools]'); await A.until(`!!document.querySelector('#menu [data-tool=chat]')`); await A.click('#menu [data-tool=chat]');
  ok(await A.until(`!!document.querySelector('#chat .ch-pins .cp[data-kind=doc]') && !!document.querySelector('#chat .ch-pins .cp[data-kind=dir]')`), 'the doc and folder are pinned to #general');

  // The doc, beside the feed.
  await A.ev(`document.querySelector('#chat .ch-pins .cp[data-kind=doc] .cp-open').click()`);
  ok(await A.until(`${panel}?.textContent.includes('Wear a hard hat on site.')`, 8000), 'the pinned doc opens beside the feed')
  ok(await A.ev(`${visible(`document.querySelector('#chat .ch-main')`)} && !document.querySelector('#docview:not(.hidden)')`), 'the chat stays in view; the doc isn’t opened full size');
  ok(await A.ev(`!${panel}.querySelector('[contenteditable=true]')`), 'it’s there to read, not edit');
  ok(await A.ev(`document.querySelector('#chat .ch-pins .cp[data-kind=doc]').classList.contains('on')`), 'its pin shows it’s open');
  await A.ev(`[...${panel}.querySelectorAll('button')].find((b) => b.textContent === 'Open').click()`);
  ok(await A.until(`!!document.querySelector('#docview:not(.hidden)') && document.querySelector('#docview').textContent.includes('Wear a hard hat')`, 8000), 'Open opens the doc in full, to edit');
  ok(await A.ev(`!${panel}`), 'and closes the panel');
  await A.ev(`closeDoc?.(); true`).catch(() => {});
  await A.ev(`document.querySelector('#docview')?.classList.add('hidden'); true`);
  await A.click('#tabs [data-tab=tools]'); await A.until(`!!document.querySelector('#menu [data-tool=chat]')`); await A.click('#menu [data-tool=chat]');

  // The folder: browse it.
  await A.ev(`document.querySelector('#chat .ch-pins .cp[data-kind=dir] .cp-open').click()`);
  ok(await A.until(`${panel}?.textContent.includes('permit.txt') && ${panel}.textContent.includes('2026')`), 'the pinned folder opens beside the feed, with its files and folders');
  await A.ev(`[...${panel}.querySelectorAll('.sd-row')].find((r) => r.textContent.includes('2026')).click()`);
  ok(await A.until(`${panel}?.textContent.includes('inspection.txt') && !${panel}.textContent.includes('permit.txt')`), 'into a subfolder');
  await A.ev(`${panel}.querySelector('.sd-up').click()`);
  ok(await A.until(`${panel}?.textContent.includes('permit.txt')`), 'and back up');
  // Folder → chat: a link. Chat → folder: a copy.
  await A.ev(drag(`[...${panel}.querySelectorAll('.sd-row')].find((r) => r.textContent.includes('permit.txt'))`, `document.querySelector('#chat .ch-main .chat-pane .list')`));
  ok(await A.until(`[...document.querySelectorAll('#chat .ch-main .msg .links')].some((l) => l.textContent.includes('permit.txt'))`), 'a file dragged from the folder into the chat posts a link');
  await A.ev(drag(`[...document.querySelectorAll('#chat .ch-main .msg')].find((m) => m.textContent.includes('Gate code is 4412')).querySelector('.who')`, `${panel}`));
  ok(await A.until(`(async () => (await (await fetch('/api/state', { headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')) } })).json()).items.some((x) => x.dirId === ${JSON.stringify(dir.id)} && /Gate code/.test(x.text || '')))()`, 8000), 'a message dragged into the folder is kept there');
  ok(await A.until(`[...${panel}.querySelectorAll('.sd-row')].some((r) => r.textContent.includes('Gate code'))`), 'and shows in the panel');

  // One panel at a time.
  await A.ev(`document.querySelector('#chat .ch-pins .cp[data-kind=doc] .cp-open').click()`);
  ok(await A.until(`${panel}?.textContent.includes('Wear a hard hat') && document.querySelectorAll('#chat .ch-thread').length === 1`), 'opening the doc replaces the folder');
  await A.ev(`document.querySelector('#chat .ch-pins .cp[data-kind=doc] .cp-open').click()`);
  ok(await A.until(`!${panel}`), 'tapping its pin again closes it');
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
