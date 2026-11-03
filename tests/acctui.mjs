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



const OUTBOX = S + '/dk/data/outbox';
const mails = () => FS.readdirSync(OUTBOX).sort().map((f) => JSON.parse(FS.readFileSync(OUTBOX + '/' + f, 'utf8')));
const shot = async (T, f) => { const r = await T.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(S + '/dk/' + f, Buffer.from(r.result.data, 'base64')); };
const t = Date.now(), em = `kim${t}@shop.test`;
const A = await tab(APP);
await A.until(`!!document.querySelector('#loginForm')`);
await A.ev(`localStorage.clear(); location.reload()`);
await sleep(800);
await A.until(`!!document.querySelector('#loginForm')`);
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 420, height: 820, deviceScaleFactor: 2, mobile: true });
await sleep(700);
const shown = `[...document.querySelectorAll('#loginForm label')].filter((l) => !l.classList.contains('hidden')).map((l) => l.firstChild.textContent.trim()).join(',')`;
ok(await A.until(`${shown} === 'Email,Password,This device'`), 'sign in asks for email and password');
ok(await A.until(`document.querySelector('#loginLinks').textContent.includes('Forgot password?') && document.querySelector('#loginLinks').textContent.includes('team name instead')`), 'with Forgot password and the team-name way');
await shot(A, 'acct-signin.png');
// Create a team with an email
await A.ev(`document.querySelector('[data-mode=create]').click()`);
ok(await A.ev(`${shown}`) === 'Team name,Your name,Email,Password,This device', 'creating a team asks for team, name, email and password');
await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.workspace.value = 'kim co ${t}'; f.name.value = 'Kim'; f.email.value = '${em}'; f.password.value = 'kimpassword'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Kim’s team opens');
ok(await A.until(`document.querySelector('#confirmBar')?.textContent.includes('${em}')`), 'a bar asks her to confirm her email');
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(300);
await shot(A, 'acct-bar.png');
await sleep(300);
const code = mails().filter((m) => m.to === em).at(-1).text.match(/\b(\d{6})\b/)[1];
await A.ev(`document.querySelector('#confirmBar .cb-code').value = '${code}'`);
await A.tap(`[...document.querySelectorAll('#confirmBar .btn')].find((b) => b.textContent === 'Confirm')`);
ok(await A.until(`!document.querySelector('#confirmBar') && [...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('Email confirmed'))`), 'entering the code confirms it and the bar goes');
// Settings shows it
await A.ev(`document.querySelector('#settingsBtn').click()`);
await A.ev(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent === 'Account').click()`);
ok(await A.until(`document.querySelector('#settings').textContent.includes('${em} · ✓ confirmed')`), 'Settings → Account shows the email, confirmed');
// Sign out, then forgot password
await A.ev(`[...document.querySelectorAll('#settings .btn')].find((b) => b.textContent === 'Sign out').click()`);
ok(await A.until(`!document.querySelector('#login').classList.contains('hidden')`), 'signed out');
await A.until(`document.querySelector('#loginLinks').textContent.includes('Forgot')`);
await A.tap(`[...document.querySelectorAll('#loginLinks a')].find((a) => a.textContent === 'Forgot password?')`);
ok(await A.ev(`${shown}`) === 'Email', 'Forgot password asks only for the email');
await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.email.value = '${em}'; f.requestSubmit(); })()`);
ok(await A.until(`document.querySelector('#modeHint').textContent.includes('we’ve sent a link')`), 'it says a link was sent (if there’s an account)');
await sleep(400);
const link = mails().filter((m) => m.to === em).at(-1).text.match(/https?:\/\/\S+\/reset\/[\w-]+/)[0].replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:4797');
const R = await tab(link, 9335);
ok(await R.until(`document.querySelector('h1')?.textContent === 'Choose a new password'`), 'the email’s link opens the new-password page');
await R.ev(`(() => { const p = document.querySelectorAll('input[type=password]'); p[0].value = 'kimnewpass1'; p[1].value = 'kimnewpass2'; document.querySelector('form').requestSubmit(); })()`);
ok(await R.until(`document.querySelector('.err').textContent.includes('don’t match')`), 'two different passwords are caught');
await R.ev(`(() => { const p = document.querySelectorAll('input[type=password]'); p[1].value = 'kimnewpass1'; document.querySelector('form').requestSubmit(); })()`);
ok(await R.until(`document.querySelector('h1')?.textContent === 'Password changed'`), 'the new password is saved');
await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.email.value = '${em}'; f.password.value = 'kimnewpass1'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'she signs in with her email and new password');
// An old-style login is asked for an email
await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'old co ' + t, name: 'Lou', password: 'loupass', device: 'Mac', deviceId: 'x' }) });
await A.ev(`localStorage.clear(); location.reload()`);
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.tap(`[...document.querySelectorAll('#loginLinks a')].find((a) => a.textContent.includes('team name'))`);
ok(await A.ev(`${shown}`) === 'Team name,Your name,Password,This device', 'the team-name way asks for team, name and password');
await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.workspace.value = 'old co ${t}'; f.name.value = 'Lou'; f.password.value = 'loupass'; f.requestSubmit(); })()`);
ok(await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('Add your email')`, 6000), 'an old login is asked to add an email');
await A.ev(`(() => { const s = document.querySelector('#sheet'); s.querySelector('input[type=email]').value = 'lou${t}@shop.test'; s.querySelector('input[type=password]').value = 'loupass'; })()`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`document.querySelector('#confirmBar')?.textContent.includes('lou${t}@shop.test')`), 'after adding it, the confirm bar appears');
ok(!A.errors.length && !R.errors.length, 'no page errors' + (A.errors.length + R.errors.length ? ': ' + [...A.errors, ...R.errors].join(' / ') : ''));
A.close(); R.close(); chrome.kill(); chrome2.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
