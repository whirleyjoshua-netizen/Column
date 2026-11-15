import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chataskui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4870, APP = `http://127.0.0.1:${PORT}/`;
FS.rmSync(`${S}/dk/chrome-ca`, { recursive: true, force: true });
try { (await import('node:child_process')).execSync('pkill -f remote-debugging-port=9464'); await new Promise((r) => setTimeout(r, 500)); } catch {}
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9464, 'chrome-ca');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9464) {
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
// Asking a teammate to sign, in chat: "Ask someone in this feed to sign" on a PDF opens it to place their boxes, then
// "Who signs it?" lists the people in the feed. The request is posted in the feed @mentioning them; for the signer the
// link says who asked and opens their signing page; for Cy, who isn't in the feed, there's no Ask at all in #general's
// view of a private file.
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const t = Date.now();
const post = async (body) => (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const ada = await post({ mode: 'create', workspace: 'Ask ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const as = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const api = as(ada.token);
const code = (await api('GET', '/state')).workspace.inviteCode;
const ben = await post({ mode: 'join', workspace: 'Ask ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
await post({ mode: 'join', workspace: 'Ask ' + t, code, name: 'Cy', email: `cy${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
const benId = (await api('GET', '/state')).workspace.members.find((x) => x.name === 'Ben').id;
const crew = (await api('POST', '/channels', { name: 'crew', memberIds: [benId] })).channels.find((x) => x.name === 'crew');
await api('POST', '/docs/pdf', { name: 'Work order', blocks: [{ t: 'h1', runs: [{ text: 'Work order' }] }, { t: 'p', runs: [{ text: 'Sign below.' }] }], channelId: crew.id });
let A;
const signIn = async (tok) => { await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000); await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`).catch(() => {}); await sleep(1500); await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 20000); await sleep(600); };
const openCrew = async () => { await A.click('#tabs [data-tab=chat]'); await A.ev(`[...document.querySelectorAll('#chat .ch-row')].find((b) => b.textContent.includes('crew')).click()`); };
const card = `[...document.querySelectorAll('#chat .chat-pane .card')].find((c) => c.textContent.includes('Work order.pdf'))`;
try {
  A = await tab(APP);
  await signIn(ada.token);
  await openCrew();
  ok(await A.until(`!!${card}?.querySelector('[aria-label="Ask someone in this feed to sign"]')`), 'a PDF in #crew offers to ask someone to sign');
  await A.ev(`${card}.querySelector('[aria-label="Ask someone in this feed to sign"]').click()`);
  ok(await A.until(`!!document.querySelector('#preview .pdf-layer') && document.querySelector('#preview .pdf-bar').textContent.includes('Their boxes')`, 15000), 'it opens to place their boxes');
  await A.ev(`[...document.querySelectorAll('#preview .pdf-bar button')].find((b) => b.textContent === 'Signature').click()`);
  await A.tap(`document.querySelector('#preview .pdf-layer')`);
  ok(await A.until(`!![...document.querySelectorAll('#preview .pdf-bar button')].find((b) => b.textContent.startsWith('Next') && !b.disabled)`), 'one tap places a signature box for them');
  await A.ev(`[...document.querySelectorAll('#preview .pdf-bar button')].find((b) => b.textContent.startsWith('Next')).click()`);
  ok(await A.until(`document.querySelector('.sheet h2')?.textContent.includes('Who signs it?')`), 'Next asks who signs it');
  const names = await A.ev(`[...document.querySelectorAll('.sheet .ask-pick')].map((b) => b.textContent).join(',')`);
  ok(names === 'Ben', 'only the people in #crew are offered (Ben, not Cy): ' + names);
  await A.ev(`document.querySelector('.sheet .ask-pick').click(); document.querySelector('.sheet textarea').value = 'Before Monday please'; [...document.querySelectorAll('.sheet button')].find((b) => b.textContent === 'Ask them').click()`);
  ok(await A.until(`document.querySelector('#preview').classList.contains('hidden')`, 10000), 'asking closes the PDF');
  ok(await A.until(`[...document.querySelectorAll('#chat .chat-pane .msg')].some((m) => m.textContent.includes('@Ben') && m.textContent.includes('Before Monday') && m.querySelector('.ln-sign'))`, 10000), 'the request is in #crew, @mentioning Ben, with a link');

  await signIn(ben.token);
  await openCrew();
  ok(await A.until(`[...document.querySelectorAll('#chat .chat-pane .ln-sign')].some((l) => l.textContent.includes('Ada asked you to sign'))`, 10000), 'Ben sees “Ada asked you to sign”');
  await A.ev(`window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; document.querySelector('#chat .chat-pane .ln-sign').click(); true`);
  ok(await A.until(`(window.__opened || []).some((u) => /\\/sign\\/[\\w-]{20,}$/.test(u))`), 'one click opens his signing page');
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
