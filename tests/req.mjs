import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9334, 'chrome2');
const chrome2 = launch(9335, 'chrome3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9334) {
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



const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'req' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'Jo laptop'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
await sleep(1200);
const tokA = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const JA = api(tokA);
const code0 = (await JA('GET', '/state')).workspace.inviteCode;
const B = await tab(APP, 9335);
await B.until(`!!document.querySelector('#loginLinks a')`);
await sleep(1000);
import http from 'node:http';
// A stack for the job, opened in Jo's column
await JA('POST', '/stacks', { name: 'Smith job' });
const stk = (await JA('GET', '/state')).workspace.stacks.find((s) => s.name === 'Smith job');
await A.tap(`document.querySelector('[data-tab=column]')`);
await A.until(`[...document.querySelectorAll('.pane .chip')].some((c) => c.textContent === 'Smith job')`);
await A.tap(`[...document.querySelectorAll('.pane .chip')].find((c) => c.textContent === 'Smith job')`);
await A.tap(`[...document.querySelectorAll('.composer .add')].find((b) => b.offsetParent)`);
ok(await A.ev(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Request files'))`), 'the stack’s + has Request files from someone…');
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Request files'))`);
ok(await A.until(`document.querySelector('#sheet h2')?.textContent.includes('Request files · Smith job')`), 'the request sheet opens for that stack');
await A.ev(`document.querySelector('#sheet textarea').value = 'A photo of each window, and your floor plan please.'`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`(document.querySelector('#sheet .req-link code')?.textContent || '').includes('/r/')`), 'Make link shows the link to copy');
const link = await A.ev(`document.querySelector('#sheet .req-link code').textContent`);
ok(await A.ev(`document.querySelector('#sheet .day-hint').textContent.includes('copied')`), 'and says it was copied');
await A.ev(`document.querySelector('#sheet .icon-btn').click()`);
// Jo starts typing a note, which should survive files arriving
await A.ev(`(() => { const ta = [...document.querySelectorAll('.composer textarea')].find((t) => t.offsetParent); ta.value = 'half typed'; })()`);
// The customer's page
const C = await tab(link, 9335);
ok(await C.until(`document.querySelector('h1')?.textContent.startsWith('Send files to')`), 'the customer’s page opens with no sign-in');
ok(await C.ev(`document.querySelector('.msg').textContent === 'A photo of each window, and your floor plan please.' && document.querySelector('.from').textContent.includes('Jo asked')`), 'it shows who asked and the note');
await C.ev(`(() => { const n = document.querySelector('input[type=text]'); n.value = 'Dana Smith'; const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(3000)], 'kitchen window.jpg', { type: 'image/jpeg' })); dt.items.add(new File(['%PDF-1.4 plan'], 'floor plan.pdf', { type: 'application/pdf' })); dt.items.add(new File(['x'], 'notes.zip', { type: 'application/zip' })); const d = document.querySelector('.drop'); d.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
ok(await C.until(`document.querySelectorAll('li.done').length === 3`, 8000), 'all three files show Sent ✓');
const st2 = await JA('GET', '/state');
const got = st2.items.filter((x) => x.viaLink);
ok(got.length === 3 && got.every((x) => x.stackId === stk.id && x.pinned && x.by === 'Dana Smith (link)'), 'they land in the stack, pinned, from Dana Smith (link)');
ok(st2.workspace.stacks.find((s) => s.id === stk.id).request.count === 3, 'the link counts them');
ok(await A.until(`[...document.querySelectorAll('#toast, .toast')].some((t) => t.textContent.includes('Dana Smith sent 3 files to Smith job'))`, 5000), 'Jo gets one notice: Dana Smith sent 3 files to Smith job');
ok(await A.ev(`[...document.querySelectorAll('.composer textarea')].find((t) => t.offsetParent).value === 'half typed'`), 'Jo’s half-typed note is still there');
// Filters
await JA('POST', '/items', { type: 'text', text: 'Measure notes for Smith', stackId: stk.id });
ok(await A.until(`[...document.querySelectorAll('.pane .pf-chip')].map((c) => c.textContent).join('|') === 'All|Photos1|Docs2|Files1'`), 'the stack shows filter chips for what it has: All · Photos 1 · Docs 2 · Files 1');
const visible = `[...document.querySelectorAll('.pane .list .card')].filter((c) => c.offsetParent).length`;
await A.tap(`[...document.querySelectorAll('.pane .pf-chip')].find((c) => c.textContent.startsWith('Photos'))`);
ok(await A.until(`${visible} === 1`), 'Photos shows only the photo');
await A.tap(`[...document.querySelectorAll('.pane .pf-chip')].find((c) => c.textContent.startsWith('Docs'))`);
ok(await A.until(`${visible} === 2`), 'Docs shows the plan and the note');
await A.tap(`[...document.querySelectorAll('.pane .pf-chip')].find((c) => c.textContent === 'All')`);
await A.ev(`(() => { const q = document.querySelector('.pane .pf-q'); q.value = 'floor'; q.dispatchEvent(new Event('input')); })()`);
ok(await A.until(`${visible} === 1`), 'search “floor” finds the plan');
await A.ev(`(() => { const q = document.querySelector('.pane .pf-q'); q.value = 'zzz'; q.dispatchEvent(new Event('input')); })()`);
ok(await A.until(`document.querySelector('.pane .empty')?.textContent.includes('Nothing matches')`), 'no match says Nothing matches');
await A.ev(`(() => { const q = document.querySelector('.pane .pf-q'); q.value = ''; q.dispatchEvent(new Event('input')); })()`);
// Limits
const token = link.split('/r/')[1];
const big = await new Promise((r) => { const q = http.request({ host: '127.0.0.1', port: 4797, method: 'PUT', path: `/api/public/request/${token}/file?name=x`, headers: { 'content-length': String(600 * 1024 * 1024) } }, (res) => r(res.statusCode)); q.on('error', () => r(0)); q.flushHeaders(); });
ok(big === 413, 'a file over 500 MB is turned away');
// Settings shows the link is on; turn it off
await A.tap(`#settingsBtn`).catch(() => {});
await A.ev(`document.querySelector('#settingsBtn')?.click()`);
ok(await A.until(`[...document.querySelectorAll('#settings .stack-row .btn')].some((b) => b.textContent.includes('Link on'))`), 'Settings shows the stack’s link is on');
await A.ev(`[...document.querySelectorAll('#settings .stack-row .btn')].find((b) => b.textContent.includes('Link on')).click()`);
await A.until(`!!document.querySelector('#sheet .req-off button')`);
ok(await A.ev(`document.querySelector('#sheet .day-hint').textContent.startsWith('3 files received')`), 'the sheet says 3 files received');
await A.ev(`document.querySelector('#sheet .req-off button').click()`);
await A.ev(`document.querySelector('#sheet .req-off button').click()`);
await sleep(600);
const after = await (await fetch(`http://127.0.0.1:4797/api/public/request/${token}`)).json();
ok(after.error?.includes('isn’t taking files'), 'once turned off, the link stops working');
const put = await fetch(`http://127.0.0.1:4797/api/public/request/${token}/file?name=y`, { method: 'PUT', body: 'x' });
ok(put.status === 404, 'and won’t take files');
await C.ev(`location.reload()`); await sleep(800);
ok(await C.until(`document.querySelector('.gone')?.textContent.includes('isn’t taking files')`), 'the customer’s page says so');
ok(!A.errors.length && !C.errors.length, 'no page errors' + (A.errors.length + C.errors.length ? ': ' + [...A.errors, ...C.errors].join(' / ') : ''));
A.close(); C.close(); chrome.kill(); chrome2.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
