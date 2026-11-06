import * as FS from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4787/';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9337', `--user-data-dir=${S}/dk/chrome6`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch('http://127.0.0.1:9337/json/new?' + url, { method: 'PUT' })).json(); } catch {} }
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




// Billing in the app: Settings → Team → Billing during the trial, and the read-only bar after it.
const DIR = S + '/dk/billui';
FS.rmSync(DIR, { recursive: true, force: true });
const env = { ...process.env, PORT: '4787', PUBLIC_URL: 'http://127.0.0.1:4787', DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE: 'price_seat', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_API: 'http://127.0.0.1:1' };
let srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'bill${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1pad1'; f.device.value = 'A'; if (f.email) f.email.value = 'jo' + Date.now() + '@t.test'; f.requestSubmit(); })()`);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await sleep(800);
ok(!(await A.ev(`!!document.querySelector('#billingBar')`)), 'no bar early in the trial');
await A.ev(`document.querySelector('#settingsBtn').click()`);
await sleep(400);
await A.ev(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent.trim() === 'Team').click()`);
ok(await A.until(`document.querySelector('#settings .billing-sec')?.textContent.includes('Free trial · 14 days left')`), 'Settings → Team → Billing shows the trial');
ok(await A.ev(`document.querySelector('#settings .billing-sec').textContent.includes('$15 per person a month · 1 on the team now')`), 'the price and the team size');
ok(await A.ev(`[...document.querySelectorAll('#settings .billing-sec button')].some((b) => b.textContent === 'Subscribe · $15 a month')`), 'and a Subscribe button with the monthly total');
// the trial runs out
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
srv.kill('SIGTERM');
await sleep(1500);
const db = JSON.parse(FS.readFileSync(DIR + '/db.json', 'utf8'));
for (const w of Object.values(db.workspaces)) w.billing.trialEnds = Date.now() - 1000;
FS.writeFileSync(DIR + '/db.json', JSON.stringify(db));
srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
await A.ev(`location.reload()`);
await sleep(2500);
ok(await A.until(`document.querySelector('#billingBar')?.textContent.includes('free trial has ended')`), 'after the trial: a bar saying the team is read-only');
ok(await A.ev(`[...document.querySelectorAll('#billingBar button')].some((b) => b.textContent === 'Subscribe')`), 'with Subscribe for the owner');
const r = await fetch(APP + 'api/tasks', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) });
ok(r.status === 402, 'and changes are refused');
await A.cmd('Page.captureScreenshot', {}).then((x) => FS.writeFileSync(S + '/dk/billing.png', Buffer.from(x.result.data, 'base64')));
ok(!A.errors.length, 'no errors on the page: ' + A.errors.join(' | '));
A.close();
chrome.kill();
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
