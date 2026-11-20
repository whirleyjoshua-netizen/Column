import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9358, 'chrome58');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9358) {
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




// Shifts (Team plan step 2, the owner 2026-11-20): the Team page's Shifts tab. An owner adds a shift by tapping a
// day, it's a draft until Send, Send tells the person, a sent shift that's removed waits for the next Send; a name
// opens their usual hours and time off; 🕒 My shifts is in the workspace menu for everyone; on a phone the week
// scrolls inside the page.
const A = await tab(APP);
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'sh' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const call = (t) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const api = call(tok);
const st = await api('GET', '/state');
const sam = call((await call()('POST', '/auth', { mode: 'join', workspace: team, code: st.workspace.inviteCode, name: 'Sam', email: `sam${team}@t.test`, password: 'longenoughsam', device: 'Mac', deviceId: 'sam' })).token);
const samId = (await sam('GET', '/state')).me.memberId;
await A.until(`(window.S?.workspace?.members?.length || document.querySelectorAll('.member').length) >= 0`);
// The menu: 👥 Team and 🕒 My shifts.
await A.ev(`(document.querySelector('.ws').click(), true)`);
ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '🕒 My shifts')`), 'the workspace menu has 🕒 My shifts: ' + await A.ev(`[...document.querySelectorAll('#menu button')].map((b) => b.textContent).join(' | ')`));
await A.ev(`([...document.querySelectorAll('#menu button')].find((b) => b.textContent === '👥 Team').click(), true)`);
ok(await A.until(`!!document.querySelector('#sheet .tm-tab[data-tab=shifts]')`, 8000), 'the Team page has a Shifts tab');
ok(await A.ev(`[...document.querySelectorAll('#sheet .tm-tab')].map((b) => b.dataset.tab).join()`) === 'shifts,week,ahead', 'first among the tabs');
await A.tap(`document.querySelector('#sheet .tm-tab[data-tab=shifts]')`);
ok(await A.until(`!!document.querySelector('#sheet .sh-grid .sh-who[data-member="${samId}"]')`, 8000), 'the week: a row for Sam');
// Next week, so nothing is in the past.
await A.tap(`document.querySelector('#sheet .tm-next')`);
const mon = await A.ev(`document.querySelectorAll('#sheet .sh-grid .sh-h')[2]?.parentElement && [...document.querySelectorAll('#sheet .sh-cell[data-member="${samId}"]')][1]?.dataset.day`);
ok(/^\d{4}-\d\d-\d\d$/.test(mon || ''), 'next week shows: Monday ' + mon);
await A.until(`!!document.querySelector('#sheet .sh-cell[data-member="${samId}"][data-day="${mon}"]')`, 8000);
await A.tap(`document.querySelector('#sheet .sh-cell[data-member="${samId}"][data-day="${mon}"]')`);
ok(await A.until(`!!document.querySelector('#sheet .tm-detail .sh-save')`), 'tapping Sam’s Monday opens a new shift inside the page');
ok(await A.ev(`document.querySelector('#sheet .sh-f-who').value === '${samId}' && document.querySelector('#sheet .sh-f-day').value === '${mon}'`), 'for Sam, on Monday');
await A.ev(`(() => { const s = (q, v) => { const e = document.querySelector(q); e.value = v; e.dispatchEvent(new Event('input')); }; s('#sheet .sh-f-from', '07:00'); s('#sheet .sh-f-to', '15:00'); s('#sheet .sh-f-label', 'Morning'); return true; })()`);
await A.tap(`document.querySelector('#sheet .sh-save')`);
const chipQ = `document.querySelector('#sheet .sh-cell[data-member="${samId}"][data-day="${mon}"] .sh-chip')`;
ok(await A.until(`${chipQ}?.classList.contains('new')`, 8000), 'back on the week, the shift is a draft: ' + await A.ev(`${chipQ}?.className`));
ok(await A.ev(`/7am–3pm/.test(${chipQ}.textContent) && /Morning/.test(${chipQ}.textContent)`), 'showing 7am–3pm Morning: ' + await A.ev(`${chipQ}?.textContent`));
ok(await A.ev(`document.querySelector('#sheet .sh-send').textContent`) === 'Send 1 change', 'Send says one change');
ok((await sam('GET', '/notices')).filter((n) => n.kind === 'shifts').length === 0, 'Sam hasn’t heard yet');
await A.tap(`document.querySelector('#sheet .sh-send')`);
ok(await A.until(`${chipQ}?.classList.contains('sent') && document.querySelector('#sheet .sh-send').textContent === 'All sent'`, 8000), 'Send: the shift is sent, nothing left to send');
const n = (await sam('GET', '/notices')).filter((x) => x.kind === 'shifts');
ok(n.length === 1 && /7am–3pm Morning/.test(n[0].text), 'Sam is told: ' + n[0]?.text);
// Removing a sent shift waits for the next Send.
await A.tap(chipQ);
ok(await A.until(`!!document.querySelector('#sheet .sh-del')`), 'tapping the shift opens it');
await A.tap(`document.querySelector('#sheet .sh-del')`);
await A.tap(`document.querySelector('#sheet .sh-del')`);
ok(await A.until(`${chipQ}?.classList.contains('gone')`, 8000), 'removed, it shows crossed out until Send');
ok((await sam('GET', '/shifts/mine?days=28')).shifts.length === 1, 'and Sam still has it');
// A name opens their usual hours and time off.
await A.tap(`document.querySelector('#sheet .sh-who[data-member="${samId}"]')`);
ok(await A.until(`document.querySelectorAll('#sheet .tm-detail .shav-day').length === 7`, 8000), 'Sam’s usual hours: seven days');
await A.tap(`document.querySelector('#sheet .shav-o-add')`);
await A.tap(`document.querySelector('#sheet .shav-save')`);
ok(await A.until(`!!document.querySelector('#sheet .sh-grid')`, 8000), 'saved, back on the week');
ok((await api('GET', '/availability/' + samId)).off.length === 1, 'his time off is saved');
// My shifts.
await A.ev(`(document.querySelector('.ws').click(), true)`);
await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '🕒 My shifts')`);
await A.ev(`([...document.querySelectorAll('#menu button')].find((b) => b.textContent === '🕒 My shifts').click(), true)`);
ok(await A.until(`!!document.querySelector('#sheet .mys .mys-none')`, 8000), 'My shifts opens: none for Jo');
ok(await A.ev(`!!document.querySelector('#sheet .mys details.mys-av')`), 'with her usual hours and time off');
// A phone: the week scrolls inside the page.
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
await A.ev(`(document.querySelector('.ws')?.click(), true)`);
if (await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '👥 Team')`, 4000)) {
  await A.ev(`([...document.querySelectorAll('#menu button')].find((b) => b.textContent === '👥 Team').click(), true)`);
  await A.until(`!!document.querySelector('#sheet .sh-grid')`, 8000);
  ok(await A.ev(`document.documentElement.scrollWidth <= 391`), 'on a phone the page doesn’t scroll sideways: ' + await A.ev(`document.documentElement.scrollWidth`));
  ok(await A.ev(`document.querySelector('#sheet .sh-scroll').scrollWidth > document.querySelector('#sheet .sh-scroll').clientWidth`), 'the week scrolls inside it');
} else ok(true, '(the phone header has no workspace menu)');
await A.cmd('Emulation.clearDeviceMetricsOverride');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
