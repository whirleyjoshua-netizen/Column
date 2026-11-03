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
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined })).json();
const me = (await api('GET', '/state')).me.memberId;
const today = new Date().toLocaleDateString('en-CA');
await api('POST', '/tasks', { text: 'Pay the film supplier', due: today, assigneeId: me });
await api('POST', '/tasks', { text: 'Order business cards' });
const c = await api('POST', '/campaigns', { name: 'Fleet push' });
const g = await api('POST', '/goals', { campaignId: c.id, title: 'Book demos', kind: 'tasks' });
await api('POST', '/tasks', { text: 'Call Desert Auto', goalId: g.id, due: today });
await A.tap(`[...document.querySelectorAll('.day-sub button')].find((b) => b.textContent === 'Tasks')`);
await sleep(500);
await A.cmd('Page.captureScreenshot', {}).then((r) => FS.writeFileSync(process.argv[2] + '/dk/tasks1.png', Buffer.from(r.result.data, 'base64')));
ok(await A.ev(`document.querySelectorAll('#day .seg').length`) === 1, 'only one row of tabs (Schedule | Tasks)');
await A.tap(`document.querySelector('.task-bar .tb-pick')`);
await sleep(200);
await A.cmd('Page.captureScreenshot', {}).then((r) => FS.writeFileSync(process.argv[2] + '/dk/tasks2.png', Buffer.from(r.result.data, 'base64')));
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Campaign steps'))`);
await sleep(600); console.log('STEPS VIEW:', await A.ev(`document.querySelector('#day .day-scroll, #day').innerText.slice(0, 400)`));
ok(await A.until(`document.querySelector('.task-bar .tb-pick')?.textContent.startsWith('Campaign steps') && document.querySelector('#day').innerText.includes('1 open · 1 due')`), 'the left picker switches to campaign steps');
await A.tap(`[...document.querySelectorAll('.task-bar .tb-pick')][1]`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Assigned to me')`);
ok(await A.until(`[...document.querySelectorAll('.task-bar .tb-pick')][1]?.textContent.startsWith('Assigned to me')`), 'the right picker switches to assigned to me');
await A.tap(`document.querySelector('.task-bar .tb-pick')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'My tasks')`);
ok(await A.until(`[...document.querySelectorAll('.task-row')].some((r) => r.textContent.includes('Pay the film supplier')) && ![...document.querySelectorAll('.task-row')].some((r) => r.textContent.includes('Order business cards'))`), 'my tasks, assigned to me: only Jo’s');
ok(!A.errors.length, 'no page errors');
A.close(); chrome.kill(); console.log(fails ? fails + ' failed' : 'all passed'); process.exit(0);
