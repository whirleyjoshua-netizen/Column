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
const t = Date.now(), ol = `olive${t}@shop.test`, pat = `pat${t}@shop.test`;
const post = async (p, body, tok) => (await fetch(APP + 'api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) })).json();
await post('/auth', { mode: 'create', workspace: 'olive co ' + t, name: 'Olive', email: ol, password: 'olivepass1', device: 'x', deviceId: 'x' });
const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.ev(`localStorage.clear(); location.reload()`); await sleep(800);
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.email.value = '${ol}'; f.password.value = 'olivepass1'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Olive signs in with her email');
await A.ev(`document.querySelector('#settingsBtn').click()`);
await A.ev(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent === 'Team').click()`);
ok(await A.until(`[...document.querySelectorAll('#settings h3')].some((h) => h.textContent === 'Invite by email')`), 'Settings → Team has Invite by email');
await A.ev(`(() => { const i = [...document.querySelectorAll('#settings input')].find((x) => x.placeholder.includes('sam@')); i.value = '${pat}'; })()`);
await A.ev(`[...document.querySelectorAll('#settings .btn')].find((b) => b.textContent === 'Invite').click()`);
ok(await A.until(`(document.querySelector('#settings .inv-made')?.textContent || '').includes('emailed to ${pat}')`), 'the invite is emailed, and its link shown to copy');
ok(await A.until(`document.querySelector('#settings').textContent.includes('Waiting to join') && document.querySelector('#settings').textContent.includes('${pat}')`), 'it’s listed as waiting to join');
await A.ev(`document.querySelector('#settings .inv-made').scrollIntoView()`);
await shot(A, 'inv-settings.png');
await sleep(300);
const link = mails().filter((m) => m.to === pat).at(-1).text.match(/https?:\/\/\S+\/join\/[\w-]+/)[0].replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:4797');
// Pat opens the link in a fresh browser
const B = await tab('about:blank', 9335);
await B.cmd('Emulation.setDeviceMetricsOverride', { width: 420, height: 820, deviceScaleFactor: 2, mobile: true });
await B.cmd('Page.navigate', { url: link });
ok(await B.until(`document.querySelector('#modeHint')?.textContent.includes('Olive invited you to join olive co ${t}')`), 'the link opens Column saying who invited her to which team');
const shown = `[...document.querySelectorAll('#loginForm label')].filter((l) => !l.classList.contains('hidden')).map((l) => l.firstChild.textContent.trim()).join(',')`;
ok(await B.ev(shown) === 'Your name,Email,Password,This device' && await B.ev(`document.querySelector('#modeSeg').classList.contains('hidden')`), 'it asks only for her name, email and password');
ok(await B.ev(`document.querySelector('#loginForm').email.value`) === pat, 'with her email filled in');
await shot(B, 'inv-join.png');
await B.ev(`(() => { const f = document.querySelector('#loginForm'); f.name.value = 'Pat'; f.password.value = 'patpassword'; f.requestSubmit(); })()`);
ok(await B.until(`!document.querySelector('#app').classList.contains('hidden') && document.querySelector('#wsName').textContent === 'olive co ${t}'`), 'she’s in the team');
ok(await B.ev(`location.pathname`) === '/', 'and the address is back to plain Column');
ok(!(await B.ev(`!!document.querySelector('#confirmBar')`)), 'no code to enter: the emailed link confirmed her email');
// Where you're signed in, and changing email
await B.cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
await B.ev(`document.querySelector('#settingsBtn').click()`);
await B.ev(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent === 'Account').click()`);
ok(await B.until(`document.querySelector('#settings').textContent.includes('Where you’re signed in') && document.querySelector('#settings').textContent.includes('(this device)')`), 'Settings → Account lists where she’s signed in');
await B.ev(`[...document.querySelectorAll('#settings .btn')].find((b) => b.textContent === 'Change email').click()`);
await B.ev(`(() => { const s = document.querySelector('#sheet'); s.querySelector('input[type=email]').value = 'pat.n${t}@shop.test'; s.querySelector('input[type=password]').value = 'patpassword'; })()`);
await B.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await B.until(`document.querySelector('#confirmBar')?.textContent.includes('Confirm your new email') && document.querySelector('#confirmBar').textContent.includes('pat.n${t}@shop.test')`), 'changing email asks for the code sent to the new address');
await sleep(300);
const code = mails().filter((m) => m.to === `pat.n${t}@shop.test`).at(-1).text.match(/\b(\d{6})\b/)[1];
ok(await B.ev(`!!document.querySelector('#settings .set-code')`), 'Settings has a box for the code too');
await B.ev(`document.querySelector('#settings .set-code').value = '${code}'`);
await B.tap(`[...document.querySelectorAll('#settings .btn')].find((b) => b.textContent === 'Confirm')`);
ok(await B.until(`!document.querySelector('#confirmBar') && document.querySelector('#settings').textContent.includes('pat.n${t}@shop.test · ✓ confirmed')`), 'the code switches her email');
await B.ev(`document.querySelector('#settings section:nth-of-type(2)')?.scrollIntoView()`);
await shot(B, 'inv-account.png');
// Olive, already signed in, opens an invite to another team
const other = await post('/auth', { mode: 'create', workspace: 'second co ' + t, name: 'Sid', email: `sid${t}@shop.test`, password: 'sidpassword', device: 'x', deviceId: 'y' });
const inv = (await post('/invites', { emails: ol }, other.token)).invites[0];
await A.cmd('Page.navigate', { url: inv.link.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:4797') });
ok(await A.until(`!document.querySelector('#login').classList.contains('hidden') && document.querySelector('#modeHint').textContent.includes('Sid invited you')`), 'someone already signed in sees the invite too');
ok(await A.ev(`!document.querySelector('#loginBack').classList.contains('hidden')`), 'with a way back to their team');
await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.name.value = 'Olive'; f.password.value = 'olivepass1'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && document.querySelector('#wsName').textContent === 'second co ${t}'`, 8000), 'she joins with her account and lands in the new team');
ok(await A.ev(`JSON.parse(localStorage.getItem('column.accounts')).length`) === 2, 'both teams are in her team switcher');
ok(!(await B.ev(`document.querySelector('#settings').textContent.includes('null')`)), 'no stray “null” in Settings');
ok(!A.errors.length && !B.errors.length, 'no page errors' + (A.errors.length + B.errors.length ? ': ' + [...A.errors, ...B.errors].join(' / ') : ''));
A.close(); B.close(); chrome.kill(); chrome2.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
