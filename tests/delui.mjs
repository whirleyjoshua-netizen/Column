import * as FS from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${S}/dk/chrome2`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch('http://127.0.0.1:9334/json/new?' + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  const chooser = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.method === 'Page.fileChooserOpened') chooser.push(m.params); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9] };
  const key = async (k) => { const [code, text] = KEYS[k]; await cmd('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); await sleep(40); };
  const type = async (t) => { await cmd('Input.insertText', { text: t }); await sleep(40); };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => {
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(80);
  };
  const click = (sel) => ev(`(() => { const e = typeof ${JSON.stringify(sel)} === 'string' ? document.querySelector(${JSON.stringify(sel)}) : null; e.click(); return true; })()`);
  return { ev, key, type, until, click, tap, cmd, errors, chooser, close: () => ws.close() };
}





const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'tv${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'A'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await sleep(1000);
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const team = await A.ev(`JSON.parse(localStorage.getItem('column.workspace') || 'null')?.name || document.querySelector('.ws-name, #wsName')?.textContent`);
const st0 = await (await fetch(APP + 'api/state', { headers: { authorization: 'Bearer ' + token } })).json();
const name = st0.workspace.name;
await A.ev(`document.querySelector('[data-open=settings], #settingsBtn, [title=Settings]')?.click()`);
await sleep(500);
await A.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Team')?.click()`);
await sleep(400);
ok(await A.ev(`[...document.querySelectorAll('h3')].some((x) => x.textContent === 'Delete team')`), 'Settings → Team has Delete team for the owner');
await A.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete team…').click()`);
await sleep(300);
await A.ev(`(() => { const i = document.querySelectorAll('#sheet input'); i[0].value = 'wrong'; i[1].value = 'secret1pad1'; document.querySelector('#sheet .primary-btn').click(); })()`);
await sleep(500);
ok(/Type the team’s name/.test(await A.ev(`document.querySelector('#sheet .err').textContent`)), 'a wrong name shows why it didn’t work');
await A.cmd('Page.captureScreenshot', {}).then((r) => FS.writeFileSync(process.argv[2] + '/dk/del1.png', Buffer.from(r.result.data, 'base64')));
await A.ev(`(() => { const i = document.querySelectorAll('#sheet input'); i[0].value = ${JSON.stringify(name)}; document.querySelector('#sheet .primary-btn').click(); })()`);
ok(await A.until(`!!document.querySelector('#deleteLock') && document.querySelector('#app').classList.contains('hidden')`, 10000), 'after deleting, the owner sees only the lock screen');
await sleep(800);
await A.cmd('Page.captureScreenshot', {}).then((r) => FS.writeFileSync(process.argv[2] + '/dk/del2.png', Buffer.from(r.result.data, 'base64')));
ok(/erased for good on/.test(await A.ev(`document.querySelector('#deleteLock').innerText`)), 'it says when it will be erased');
const toasts = await A.ev(`document.querySelector('#toast')?.textContent || ''`);
ok(!/being deleted/.test(toasts), 'no error messages pile up behind it');
await A.ev(`[...document.querySelectorAll('#deleteLock button')].find((b) => b.textContent.startsWith('Cancel deletion')).click()`);
ok(await A.until(`!document.querySelector('#deleteLock') && !document.querySelector('#app').classList.contains('hidden')`, 10000), 'cancelling brings the team back');
const st = await (await fetch(APP + 'api/state', { headers: { authorization: 'Bearer ' + token } })).json();
ok(!st.workspace.deleteAt, 'and it’s no longer set to be deleted');
console.log(fails ? fails + ' failed' : 'all passed');
chrome.kill(); process.exit(fails ? 1 : 0);
