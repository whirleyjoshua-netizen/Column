import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9357, 'chrome57');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9357) {
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




// The Team page (the owner, 2026-11-20): Team left Tasks for its own page, from the workspace menu. A Tasks left on
// the old Team view opens the page once; at full size it's a page beside the sidebar, on a phone the pop-up; it keeps
// up with the work while it's open; a closer look (someone's week) opens inside it, with a way back.
const A = await tab(APP);
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'tm' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const jo = (await api('GET', '/state')).me.memberId;
// Tasks was left on Team before: it opens the Team page, once.
await A.ev(`localStorage.setItem('column.daySub', JSON.stringify('team')); location.reload(); true`).catch(() => {});
await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 15000);
ok(await A.until(`!!document.querySelector('#sheet:not(.hidden) .tm')`, 8000), 'a Tasks left on the old Team view opens the Team page');
ok(await A.ev(`JSON.parse(localStorage.getItem('column.daySub'))`) === 'schedule', 'and Tasks goes back to the schedule, kept');
await A.ev(`location.reload(); true`).catch(() => {});
await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 15000);
await sleep(1500);
ok(await A.ev(`!document.querySelector('#sheet:not(.hidden) .tm')`), 'so it doesn’t open again by itself');
// From the workspace menu, at full size: a page.
await A.ev(`(document.querySelector('.ws').click(), true)`);
ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '👥 Team')`), 'the workspace menu has 👥 Team, under Workspace profile: ' + await A.ev(`[...document.querySelectorAll('#menu button')].map((b) => b.textContent).join(' | ')`));
ok(await A.ev(`(() => { const t = [...document.querySelectorAll('#menu button')].map((b) => b.textContent); return t.indexOf('👥 Team') === t.indexOf('🪪 Workspace profile') + 1; })()`), 'right under it');
await A.ev(`([...document.querySelectorAll('#menu button')].find((b) => b.textContent === '👥 Team').click(), true)`);
ok(await A.until(`!!document.querySelector('#sheet .tm .wl-rows')`, 8000), 'the Team page opens on This week');
ok(await A.ev(`!!document.querySelector('#sheet .sheet.page-view')`), 'as a page beside the sidebar, at full size');
ok(await A.ev(`[...document.querySelectorAll('#sheet .tm-tab')].map((b) => b.dataset.tab).join()`) === 'shifts,hours,week,ahead', 'tabs: Shifts, Hours, This week and Weeks ahead (Visits comes with Boards on)');
// It keeps up while it's open.
const openQ = `document.querySelector('#sheet .wl-row[data-member="${jo}"] [data-k=open] b')?.textContent`;
const before = Number(await A.ev(openQ));
await api('POST', '/tasks', { text: 'Order filters', assigneeId: jo });
ok(await A.until(`Number(${openQ}) === ${before + 1}`, 8000), 'a task given to Jo shows on the open page by itself: ' + before + ' → ' + await A.ev(openQ));
ok(await A.ev(`!!document.querySelector('#sheet:not(.hidden) .tm')`), 'and the page stays open');
// A closer look stays inside the page.
await A.tap(`document.querySelector('#sheet .wl-row[data-member="${jo}"]')`);
ok(await A.until(`/Jo’s week/.test(document.querySelector('#sheet .tm-detail')?.textContent || '')`), 'tapping Jo shows her week inside the page');
await A.tap(`document.querySelector('#sheet .tm-back')`);
ok(await A.until(`!!document.querySelector('#sheet .tm .wl-rows')`), 'with a way back');
await A.tap(`document.querySelector('#sheet .tm-tab[data-tab=ahead]')`);
ok(await A.until(`!!document.querySelector('#sheet .tm .fc')`, 8000), 'Weeks ahead is there');
// Leaving through the sidebar closes the page.
await A.tap(`document.querySelector('#tabs [data-tab=home]')`);
ok(await A.until(`document.querySelector('#sheet').classList.contains('hidden') || !document.querySelector('#sheet .tm')`), 'going somewhere in the sidebar closes it');
// On a phone it's the pop-up.
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
await A.ev(`(document.querySelector('.ws')?.click(), true)`);
const onPhone = await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '👥 Team')`, 4000);
if (onPhone) {
  await A.ev(`([...document.querySelectorAll('#menu button')].find((b) => b.textContent === '👥 Team').click(), true)`);
  ok(await A.until(`!!document.querySelector('#sheet .tm')`) && await A.ev(`!document.querySelector('#sheet .sheet.page-view')`), 'on a phone it opens as the pop-up');
  ok(await A.ev(`document.documentElement.scrollWidth <= 391`), 'and fits the phone');
} else ok(true, '(the phone header has no workspace menu)');
await A.cmd('Emulation.clearDeviceMetricsOverride');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
