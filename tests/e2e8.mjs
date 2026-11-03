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
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'ai${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'A'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'signed in');
await sleep(1200);
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined })).json();
await api('PUT', '/ai/keys/anthropic', { key: 'sk-test-1234567890' });
const crm = await api('POST', '/projects', { template: 'crm', name: 'Sales' });
const C = Object.fromEntries(crm.types.map((t) => [t.key, t]));
const ben = await api('POST', `/projects/${crm.id}/records`, { typeId: C.contacts.id, values: { name: 'Ben Ortiz', stage: C.contacts.fields.find((f) => f.key === 'stage').choices[2].id } });
const bq = await api('POST', '/projects', { template: 'bids', name: 'Estimating' });
const P = Object.fromEntries(bq.types.map((t) => [t.key, t]));
await api('POST', `/projects/${bq.id}/records`, { typeId: P.price_list.id, values: { item: 'Ceramic film install', unit: 'window', price: 185, cost: 70 } });
const cl = await api('POST', `/projects/${bq.id}/records`, { typeId: P.clients.id, values: { name: 'Desert Auto', address: '12 Main St, Las Vegas' } });
await api('POST', `/projects/${bq.id}/records`, { typeId: P.bids.id, values: { job: 'Library glazing', scope: 'Tint the office windows' } });
await sleep(400);
const openProjects = async () => { await A.tap(`document.querySelector('#toolsBtn')`); await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Projects')`); };
await openProjects();
await A.tap(`[...document.querySelectorAll('#projects .pj-card')].find((x) => x.textContent.includes('Sales'))`);
await A.tap(`[...document.querySelectorAll('#projects .pj-open')].find((b) => b.textContent === 'Ben Ortiz')`);
await A.tap(`[...document.querySelectorAll('#projects .pj-act-btns .btn')].find((b) => b.textContent === '✦ Next step')`);
ok(await A.until(`document.querySelector('#projects .pj-ai-read')?.textContent.includes('14 vans')`), 'Next step: Sidekick says where Ben stands');
ok(await A.ev(`document.querySelectorAll('#projects .pj-ai-step').length`) === 3, 'with three suggested steps');
await A.tap(`[...document.querySelectorAll('#projects .pj-ai-step .btn')].find((b) => b.textContent === 'Add task')`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-ai-step')].some((x) => x.textContent.includes('✓ Task added')) && [...document.querySelectorAll('#projects .pj-task')].some((x) => x.textContent.includes('Send Ben fleet pricing'))`), 'Add task makes the task, on Ben');
await A.tap(`[...document.querySelectorAll('#projects .pj-ai-step .btn')].find((b) => b.textContent === 'Set Stage to Customer')`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-frow')].some((r) => r.textContent.includes('Stage') && r.textContent.includes('Customer'))`), 'Set Stage moves him to Customer');
await A.tap(`[...document.querySelectorAll('#projects .pj-ai-step .btn')].find((b) => b.textContent === 'Log as sent')`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-tl')].some((x) => x.textContent.includes('Jo emailed') && x.textContent.includes('Fleet pricing'))`), 'Log as sent puts the email on his timeline');
// estimate
await A.tap(`document.querySelector('#projects .pj-top [aria-label="All projects"]')`);
await A.tap(`[...document.querySelectorAll('#projects .pj-card')].find((x) => x.textContent.includes('Estimating'))`);
await A.tap(`[...document.querySelectorAll('#projects .pj-types button')].find((b) => b.textContent.includes('Bids'))`);
await A.tap(`[...document.querySelectorAll('#projects .pj-card-r')].find((c) => c.textContent.includes('Library glazing')).querySelector('b')`);
await A.tap(`[...document.querySelectorAll('#projects .pj-items .pj-newrow')].find((b) => b.textContent === '✦ Draft estimate')`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`document.querySelector('#projects .pj-est .pj-ai-h b')?.textContent === '✦ Draft estimate · $2,305.00'`, 8000), 'the drafted estimate shows: 12 × $185 (price list) + $85 = $2,305');
ok(await A.ev(`document.querySelector('#projects .pj-est').textContent.includes('Are the skylights included?')`), 'with what to check');
await A.tap(`[...document.querySelectorAll('#projects .pj-est .btn')].find((b) => b.textContent === 'Use these lines')`);
ok(await A.until(`document.querySelectorAll('#projects .pj-it tbody tr').length === 2 && !document.querySelector('#projects .pj-est') && document.querySelector('#projects .pj-it-margin b')?.textContent.startsWith('Margin $1,405.00')`), 'Use these lines puts them in, with the margin');
await A.tap(`[...document.querySelectorAll('#projects .pj-qbar .btn')].find((b) => b.textContent === 'Make a quote from this bid')`);
await A.until(`document.querySelector('#projects .pj-panel .pj-title')?.value === 'Library glazing'`);
// client on the quote, then make a job
const field = (name) => `[...document.querySelectorAll('#projects .pj-panel .pj-frow')].find((r) => r.querySelector('.pj-flabel').textContent.endsWith(${JSON.stringify(name)})).querySelector('.pj-cell')`;
await A.tap(field('Client')); await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Desert Auto')`);
await sleep(400);
await A.tap(`[...document.querySelectorAll('#projects .pj-qbar .btn')].find((b) => b.textContent.includes('Make a job from this quote'))`);
ok(await A.until(`document.querySelector('#projects .pj-panel .pj-title')?.value === 'Library glazing' && [...document.querySelectorAll('#projects .pj-panel .pj-frow')].some((r) => r.textContent.includes('Value') && r.textContent.includes('$2,305')) && [...document.querySelectorAll('#projects .pj-panel .pj-frow')].some((r) => r.textContent.includes('Address') && r.textContent.includes('12 Main St'))`), 'a job made from the quote: its value, the client’s address');
ok(await A.ev(`[...document.querySelectorAll('#projects .pj-panel .pj-frow')].some((r) => r.textContent.includes('Status') && r.textContent.includes('Scheduled'))`), 'starting Scheduled');
// ready-made list and templates
await A.tap(`document.querySelector('#projects .pj-panel [aria-label="Close"]')`);
await A.tap(`document.querySelector('#projects .pj-top [aria-label="All projects"]')`);
await A.tap(`[...document.querySelectorAll('#projects .pj-card')].find((x) => x.textContent.includes('Sales'))`);
await A.tap(`document.querySelector('#projects [aria-label="Project options"]')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Add a list…').click()`);
await sleep(200);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('🏷️ Price list')).click()`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-types button')].some((b) => b.textContent.includes('Price list'))`), 'a ready-made Price list added to the CRM');
await A.tap(`document.querySelector('#projects [aria-label="Project options"]')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Save as a template…').click()`);
await A.ev(`document.querySelector('#sheet input').value = 'Sales + pricing'`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
await sleep(400);
await A.tap(`document.querySelector('#projects .pj-top [aria-label="All projects"]')`);
await A.tap(`[...document.querySelectorAll('#projects .btn')].find((b) => b.textContent === '+ New project')`);
ok(await A.until(`[...document.querySelectorAll('#sheet .pj-tpl')].some((b) => b.textContent.includes('Sales + pricing') && b.textContent.includes('Your template'))`), 'the saved template is offered for new projects');
ok(await A.ev(`[...document.querySelectorAll('#sheet .pj-tpl')].some((b) => b.textContent.includes('Jobs & Installs'))`), 'and so is Jobs & Installs');
await sleep(400);
await A.tap(`[...document.querySelectorAll('#sheet .pj-tpl')].find((b) => b.textContent.includes('Sales + pricing'))`);
await A.until(`document.querySelector('#sheet .pj-tpl.on')?.textContent.includes('Sales + pricing')`);
await A.ev(`document.querySelector('#sheet input').value = 'Second office'`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
const okNew = await A.until(`document.querySelector('#projects .pj-name')?.textContent === 'Second office' && [...document.querySelectorAll('#projects .pj-types button')].map((b) => b.textContent.replace(/\\d+$/, '').trim()).join('|') === '👤 Contacts|💰 Deals|🏢 Companies|🏷️ Price list'`);
if (!okNew) console.log('NOW:', await A.ev(`(document.querySelector('#projects .pj-name')?.textContent || 'no name') + ' :: ' + [...document.querySelectorAll('#projects .pj-types button')].map((b) => b.textContent).join('|') + ' :: sheet ' + document.querySelector('#sheet .err')?.textContent`));
ok(okNew, 'a new project from it has the same four lists, empty');
ok(!A.errors.length, 'no page errors' + (A.errors.length ? ': ' + A.errors.join(' / ') : ''));
A.close(); chrome.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
