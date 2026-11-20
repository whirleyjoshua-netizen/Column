import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9359, 'chrome59');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9359) {
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




// The hours calculator (Team plan step 3): the Team page's Hours tab. For a week, what each person has to work (sent
// shifts, else usual hours, else an assumed 8-hour weekday; none on time off) against what's booked; days booked past
// someone's hours are listed; tapping someone shows their days.
const A = await tab(APP);
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'hr' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const call = (t) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const api = call(tok);
const st = await api('GET', '/state');
const sam = call((await call()('POST', '/auth', { mode: 'join', workspace: team, code: st.workspace.inviteCode, name: 'Sam', email: `sam${team}@t.test`, password: 'longenoughsam', device: 'Mac', deviceId: 'sam' })).token);
const samId = (await sam('GET', '/state')).me.memberId;
const today = await A.ev(`todayKey ? todayKey() : new Date().toISOString().slice(0, 10)`).catch(() => new Date().toISOString().slice(0, 10));
const plus = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const next = plus(today, 7 - new Date(today + 'T12:00:00Z').getUTCDay()), wed = plus(next, 3);
// Sam works Monday to Friday 8–4 and is off next Wednesday, but has 3 hours booked that day.
await sam('PUT', '/availability/me', { week: [[], [[480, 960]], [[480, 960]], [[480, 960]], [[480, 960]], [[480, 960]], []], off: [{ from: wed, to: wed, note: 'Dentist' }] });
await sam('POST', '/entries', { text: 'Site walk', date: wed, start: 540, end: 720 });
await A.ev(`(document.querySelector('#tabs [data-tab=work]').click(), document.querySelector('#workTabs .ws-switch').click(), true)`);
await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '👥 Team')`);
await A.ev(`([...document.querySelectorAll('#menu button')].find((b) => b.textContent === '👥 Team').click(), true)`);
ok(await A.until(`!!document.querySelector('#sheet .tm-tab[data-tab=hours]')`, 8000), 'the Team page has an Hours tab');
await A.tap(`document.querySelector('#sheet .tm-tab[data-tab=hours]')`);
await A.until(`!!document.querySelector('#sheet .hr-rows')`, 8000);
await A.tap(`document.querySelector('#sheet .tm-next')`);
const rowQ = `document.querySelector('#sheet .hr-row[data-member="${samId}"]')`;
ok(await A.until(`/of 32 h/.test(${rowQ}?.textContent || '')`, 8000), 'next week: Sam has 32 hours (40 usual, a day off): ' + await A.ev(`${rowQ}?.textContent`));
ok(await A.ev(`/3 h booked/.test(${rowQ}.textContent) || /3 h of 32 h/.test(${rowQ}.textContent)`), 'with 3 booked');
ok(await A.ev(`/usual hours/.test(${rowQ}.textContent)`), 'from his usual hours');
ok(await A.ev(`/40 h/.test([...document.querySelectorAll('#sheet .hr-row')].find((r) => r.dataset.member !== '${samId}')?.textContent || '')`), 'Jo, with nothing set, gets an assumed 40');
ok(await A.until(`!!document.querySelector('#sheet .hr-srow[data-member="${samId}"][data-day="${wed}"]')`), 'Wednesday is listed: booked on his time off');
await A.tap(rowQ);
ok(await A.until(`document.querySelectorAll('#sheet .tm-detail .hr-day').length === 7`), 'tapping Sam shows his seven days');
ok(await A.ev(`document.querySelector('#sheet .hr-day[data-day="${wed}"]').classList.contains('over') && /Off/.test(document.querySelector('#sheet .hr-day[data-day="${wed}"]').textContent)`), 'Wednesday: off, and over');
await A.tap(`document.querySelector('#sheet .tm-back')`);
ok(await A.until(`!!document.querySelector('#sheet .hr-rows')`), 'and back');
// Weeks ahead says where its hours come from.
await A.tap(`document.querySelector('#sheet .tm-tab[data-tab=ahead]')`);
ok(await A.until(`/past someone’s hours/.test(document.querySelector('#sheet .fc')?.textContent || '')`, 8000), 'Weeks ahead uses the same hours');
// A phone.
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(300);
await A.tap(`document.querySelector('#sheet .tm-tab[data-tab=hours]')`);
await A.until(`!!document.querySelector('#sheet .hr-rows')`, 8000);
ok(await A.ev(`document.documentElement.scrollWidth <= 391`), 'fits a phone: ' + await A.ev(`document.documentElement.scrollWidth`));
await A.cmd('Emulation.clearDeviceMetricsOverride');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
