import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// Signing in chat: "Sign it" on a PDF in a feed opens it with the Sign tool ready; a tap places your signature and the
// signed copy lands in the feed. A pasted agreement (a long message), a photo linked in #general and a Word file
// become a PDF first; in #general the signed copy is posted as a message. Short messages don't offer to sign.
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chatsignui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4864, APP = `http://127.0.0.1:${PORT}/`;
FS.rmSync(`${S}/dk/chrome-cs`, { recursive: true, force: true });
try { (await import('node:child_process')).execSync('pkill -f remote-debugging-port=9462'); await new Promise((r) => setTimeout(r, 500)); } catch {}
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9462, 'chrome-cs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9462) {
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
const ada = await post({ mode: 'create', workspace: 'Sign ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const as = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const api = as(ada.token);
const crew = (await api('POST', '/channels', { name: 'crew' })).channels.find((x) => x.name === 'crew');
// A PDF in #crew (made from blocks, as Kloomie makes them).
const pdf = await api('POST', '/docs/pdf', { name: 'Work order', blocks: [{ t: 'h1', runs: [{ text: 'Work order' }] }, { t: 'p', runs: [{ text: 'Sign below.' }] }], channelId: crew.id });
const terms = 'I agree to the install at 12 Elm St on Nov 20 for $2,400.\nPayment is due on completion.\nThe crew may park in the driveway.';
await api('POST', '/items', { type: 'message', text: terms });
await api('POST', '/items', { type: 'message', text: 'ok see you at 9' });
let A;
const signIn = async (tok) => { await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000); await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`).catch(() => {}); await sleep(1500); await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 20000); await sleep(600); };
const items = async () => (await api('GET', '/state')).items;
// Sign the open PDF: the Sign tool is already picked, so one tap on the page places it, then save.
const signOpen = async () => {
  ok(await A.until(`document.querySelector('#preview .pdf')?.classList.contains('placing') && !!document.querySelector('#preview .pdf-layer')`, 15000), 'it opens with the Sign tool ready');
  await A.tap(`document.querySelector('#preview .pdf-layer')`);
  ok(await A.until(`!!document.querySelector('#preview .pm-sig')`), 'one tap puts the signature on');
  await A.ev(`[...document.querySelectorAll('#preview .pdf-bar button')].find((b) => b.textContent.startsWith('Done')).click()`);
  ok(await A.until(`document.querySelector('#preview').classList.contains('hidden')`, 15000), 'saving closes it and goes back to the chat');
};
try {
  A = await tab(APP);
  await signIn(ada.token);
  // A signature of Ada's, drawn on a canvas.
  const png = await A.ev(`(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 100; const g = c.getContext('2d'); g.lineWidth = 4; g.beginPath(); g.moveTo(10, 80); g.bezierCurveTo(80, 0, 150, 120, 290, 20); g.stroke(); return c.toDataURL('image/png'); })()`);
  await api('PUT', '/signature', { sig: png });
  await signIn(ada.token);
  await A.click('#tabs [data-tab=tools]'); await A.until(`!!document.querySelector('#menu [data-tool=chat]')`); await A.click('#menu [data-tool=chat]');
  await A.ev(`[...document.querySelectorAll('#chat .ch-row')].find((b) => b.textContent.includes('crew')).click()`);
  ok(await A.until(`[...document.querySelectorAll('#chat .chat-pane .card')].some((c) => c.textContent.includes('Work order.pdf'))`), 'the PDF is in #crew');
  await A.ev(`[...document.querySelectorAll('#chat .chat-pane .card')].find((c) => c.textContent.includes('Work order.pdf')).querySelector('[aria-label="Sign it"]').click()`);
  await signOpen();
  ok(await A.until(`[...document.querySelectorAll('#chat .chat-pane .card')].some((c) => /Work order.*signed/i.test(c.textContent))`, 10000), 'the signed copy is in #crew');
  ok((await items()).some((x) => /signed/i.test(x.name || '') && x.channelId === crew.id), 'next to the original, in the feed');

  // #general: a pasted agreement.
  await A.ev(`[...document.querySelectorAll('#chat .ch-row')].find((b) => b.textContent.includes('general')).click()`);
  ok(await A.until(`[...document.querySelectorAll('#chat .chat-pane .msg')].some((m) => m.textContent.includes('12 Elm St'))`), 'the agreement is in #general');
  ok(await A.ev(`![...document.querySelectorAll('#chat .chat-pane .msg')].find((m) => m.textContent.includes('see you at 9')).querySelector('[aria-label="Sign it"]')`), 'a short message doesn’t offer to sign');
  await A.ev(`[...document.querySelectorAll('#chat .chat-pane .msg')].find((m) => m.textContent.includes('12 Elm St')).querySelector('[aria-label="Sign it"]').click()`);
  await signOpen();
  ok(await A.until(`[...document.querySelectorAll('#chat .chat-pane .msg')].some((m) => m.textContent.includes('✍️ Signed') && /signed/i.test(m.querySelector('.links')?.textContent || ''))`, 10000), 'in #general the signed copy is posted as a message');

  // A photo linked in #general.
  const photo = await A.ev(`(async () => { const c = document.createElement('canvas'); c.width = 800; c.height = 1000; const g = c.getContext('2d'); g.fillStyle = '#eee'; g.fillRect(0, 0, 800, 1000); g.fillStyle = '#000'; g.font = '40px sans-serif'; g.fillText('Permit form', 60, 100); const b = await new Promise((r) => c.toBlob(r, 'image/png')); const tok = JSON.parse(localStorage.getItem('column.token')); const r = await fetch('/api/upload?name=permit.png&type=image/png', { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: b }); return (await r.json()).id; })()`);
  await api('POST', '/items', { type: 'message', text: `Permit to sign [[file:${photo}]]` });
  ok(await A.until(`[...document.querySelectorAll('#chat .chat-pane .msg')].some((m) => m.textContent.includes('Permit to sign') && m.querySelector('[aria-label="Sign it"]'))`), 'a message linking a photo offers to sign it');
  await A.ev(`[...document.querySelectorAll('#chat .chat-pane .msg')].find((m) => m.textContent.includes('Permit to sign')).querySelector('[aria-label="Sign it"]').click()`);
  await signOpen();
  ok((await items()).some((x) => x.name === 'permit.pdf') && (await items()).some((x) => /^permit.*signed.*\.pdf$/i.test(x.name || '')), 'the photo became permit.pdf, and that was signed');

  // A Word file in #crew.
  await A.ev(`(async () => { const doc = await ColumnWord.read(await (await ColumnWord.blank()).arrayBuffer()); const page = document.createElement('div'); page.innerHTML = '<h1>Contract</h1><p>The customer agrees to the work described.</p>'; const b = new Blob([await doc.save(page)]); const tok = JSON.parse(localStorage.getItem('column.token')); await fetch('/api/upload?name=contract.docx&type=' + encodeURIComponent(ColumnWord.DOCX) + '&channelId=${crew.id}', { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: b }); return true; })()`);
  await A.ev(`[...document.querySelectorAll('#chat .ch-row')].find((b) => b.textContent.includes('crew')).click()`);
  ok(await A.until(`[...document.querySelectorAll('#chat .chat-pane .card')].some((c) => c.textContent.includes('contract.docx') && c.querySelector('[aria-label="Sign it"]'))`), 'a Word file in #crew offers to sign it');
  await A.ev(`[...document.querySelectorAll('#chat .chat-pane .card')].find((c) => c.textContent.includes('contract.docx')).querySelector('[aria-label="Sign it"]').click()`);
  await signOpen();
  ok(await A.until(`[...document.querySelectorAll('#chat .chat-pane .card')].some((c) => /contract.*signed.*\.pdf/i.test(c.textContent))`, 10000), 'the Word file became a PDF and was signed, in #crew');
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
