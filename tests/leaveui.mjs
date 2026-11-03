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
await A.ev(`document.querySelector('[data-open=settings], #settingsBtn, [title=Settings]')?.click()`);
await sleep(500);
await A.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Account')?.click()`);
await sleep(400);
const btns = await A.ev(`[...document.querySelectorAll('#settings button')].map((b) => b.textContent).filter((x) => /Leave|Delete my/.test(x)).join('|')`);
ok(btns === 'Delete my account…', 'alone on a team: no Leave button, just Delete my account (' + btns + ')');
await A.ev(`[...document.querySelectorAll('#settings button')].find((b) => b.textContent === 'Delete my account…').click()`);
await sleep(300);
await A.cmd('Page.captureScreenshot', {}).then((r) => FS.writeFileSync(process.argv[2] + '/dk/leave1.png', Buffer.from(r.result.data, 'base64')));
await A.ev(`(() => { document.querySelector('#sheet input').value = 'nottheone1'; document.querySelector('#sheet .primary-btn').click(); })()`);
await sleep(500);
ok(/isn’t right/.test(await A.ev(`document.querySelector('#sheet .err').textContent`)), 'a wrong password says so');
await A.ev(`(() => { document.querySelector('#sheet input').value = 'secret1pad1'; document.querySelector('#sheet .primary-btn').click(); })()`);
const back = await A.until(`!document.querySelector('#login').classList.contains('hidden')`, 10000);
if (!back) console.log('NOW:', await A.ev(`location.href + ' | login hidden=' + document.querySelector('#login').classList.contains('hidden') + ' | app hidden=' + document.querySelector('#app').classList.contains('hidden') + ' | sheet=' + (document.querySelector('#sheet:not(.hidden)')?.innerText.slice(0,200)) + ' | ls=' + JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => /token|accounts/.test(k)))).slice(0,400) + ' | S.token? ' + document.title`));
ok(back, 'after deleting, it’s back to the sign-in screen');
const r = await fetch(APP + 'api/state', { headers: { authorization: 'Bearer ' + token } });
ok(r.status === 401, 'and the old sign-in no longer works');
console.log(fails ? fails + ' failed' : 'all passed');
chrome.kill(); process.exit(fails ? 1 : 0);
