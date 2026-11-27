import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
// A fresh profile each run: the app remembers the Apps tab last picked, and this test picks Integrations.
FS.rmSync(`${S}/dk/chrome62`, { recursive: true, force: true });
const chrome = launch(9362, 'chrome62');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9362) {
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

// The browser's Back (and Android's back gesture) steps back through Kloomie (the owner, 2026-11-20). Before, it left
// the app: Kloomie never added to the browser's history. Now Back closes what's on top (a pop-up, a menu, a viewer,
// Settings, the split, a tool), goes back a level inside a page (an app's page to All apps), then to the page before,
// and at Home with nothing open it leaves as before. One press does one step; nothing is lost while a form is open.
const A = await tab(APP);
const back = async () => { await A.ev(`history.back(); true`); await sleep(350); };
const lit = `[...document.querySelectorAll('#tabs button.on')].map((b) => b.dataset.tab).join()`;
const shown = (sel) => `!!document.querySelector('${sel}') && !document.querySelector('${sel}').classList.contains('hidden')`;
const home = `${shown('#home')} && document.querySelector('#tool').classList.contains('hidden') && document.querySelector('#split').classList.contains('hidden') && document.querySelector('#sheet').classList.contains('hidden') && document.querySelector('#settings').classList.contains('hidden')`;
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'bk' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=agents]')`, 15000), 'Jo signed in');
await A.until(home);
// A tool over the page: Back closes it.
await A.tap(`document.querySelector('#tabs [data-tab=agents]')`);
await A.until(`!document.querySelector('#tool').classList.contains('hidden')`);
await back();
ok(await A.until(home, 2000), 'Agents, then Back: Agents closes, Home again');
ok((await A.ev(lit)) === 'home', 'only Home is lit: ' + (await A.ev(lit)));
// Another page: Back goes to the page before.
await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
await A.until(shown('#day'));
await A.tap(`document.querySelector('#tabs [data-tab=apps]')`);
await A.until(shown('#apps'));
await back();
ok(await A.until(shown('#day'), 2000), 'Workspace, then Apps, then Back: Workspace again');
await back();
ok(await A.until(home, 2000), 'and Back again: Home');
// A level inside a page: an app's page, then Back is All apps, then Back is the page before.
await A.tap(`document.querySelector('#tabs [data-tab=apps]')`);
// It opens on Kloomie apps: a Kloomie app's page, then Back is All Kloomie apps.
await A.until(`!!document.querySelector('#apps .kapp-tile[data-kapp=map] .kapp-name')`);
await A.tap(`document.querySelector('#apps .kapp-tile[data-kapp=map] .kapp-name')`);
ok(await A.until(`!!document.querySelector('#apps .kapp-detail')`), 'Map’s Kloomie app page opens');
await back();
ok(await A.until(`${shown('#apps')} && !document.querySelector('#apps .kapp-detail') && !!document.querySelector('#apps .kapp-tile')`, 2000), 'Back: All Kloomie apps, still on Apps');
await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === 'Integrations').click(); true`);
await A.until(`!!document.querySelector('#apps .app-tile[data-app=quickbooks]')`);
await A.tap(`document.querySelector('#apps .app-tile[data-app=quickbooks]')`);
ok(await A.until(`!!document.querySelector('#apps .app-back')`), 'QuickBooks’s page opens');
await back();
ok(await A.until(`${shown('#apps')} && !document.querySelector('#apps .app-back') && !!document.querySelector('#apps .app-tile')`, 2000), 'Back: All apps, still on Apps');
await back();
ok(await A.until(home, 2000), 'Back: Home');
// Settings over the page.
await A.tap(`document.querySelector('#gearBtn')`);
await A.until(shown('#settings'));
await back();
ok(await A.until(home, 2000), 'Settings, then Back: Settings closes');
// A pop-up closes first, then what's under it: Campaigns, the builder, Back closes the builder, Back is Home.
await A.ev(`document.querySelector('#tabs [data-tab=camps]').click(); true`);
await A.until(shown('#campsWrap'));
await A.until(`[...document.querySelectorAll('#camps button')].some((b) => b.textContent === '+ New')`, 5000);
await A.tap(`[...document.querySelectorAll('#camps button')].find((b) => b.textContent === '+ New')`);
ok(await A.until(`!!document.querySelector('#sheet .sheet.camp-builder')`), 'the campaign builder opens');
await back();
ok(await A.until(`document.querySelector('#sheet').classList.contains('hidden') && ${shown('#campsWrap')}`, 2000), 'Back: the builder closes, Campaigns is still there');
// With something typed in it, Back keeps it and says so.
await A.tap(`[...document.querySelectorAll('#camps button')].find((b) => b.textContent === '+ New')`);
await A.until(`!!document.querySelector('#sheet .sheet.camp-builder')`);
await A.tap(`document.querySelector('#sheet .cb-kind[data-kind=campaign]')`); // + New asks Checklist or Campaign first (2026-11-27)
await A.ev(`(() => { const i = document.querySelector('#sheet .cb-main input:not([type])') || document.querySelector('#sheet .cb-main input[type=text]'); i.focus(); return true; })()`);
await A.type('Spring tune-ups');
await A.ev(`document.activeElement.dispatchEvent(new Event('change', { bubbles: true })); true`);
await back();
ok(await A.ev(`!document.querySelector('#sheet').classList.contains('hidden') && [...document.querySelectorAll('#sheet input')].some((i) => i.value === 'Spring tune-ups')`), 'typed in: Back keeps the builder and what’s in it');
ok(await A.until(`/Save the campaign/.test(document.body.textContent)`, 1500), 'and says to save it or close it');
await A.tap(`document.querySelector('#sheet h2 button[aria-label=Close]')`);
await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
await back();
ok(await A.until(home, 2000), 'closed, then Back: Home');
// Back to Home by the app's own buttons leaves nothing to press twice: the next Back leaves Kloomie.
await A.tap(`document.querySelector('#tabs [data-tab=agents]')`);
await A.until(`!document.querySelector('#tool').classList.contains('hidden')`);
await A.tap(`document.querySelector('#tabs [data-tab=agents]')`);
await A.until(home);
ok(await A.until(`!history.state?.kloomieBack`, 2000), 'closed with its own button: no Back step left over at Home');
await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
await A.until(shown('#day'));
ok(await A.until(`!!history.state?.kloomieBack`, 2000), 'away from Home there is a step to go back');
// On a phone (Android's back gesture is the browser's Back): ☰'s menu page, then Back is Home; a tool from it, then
// Back closes the tool; the Tasks page from the dock, then Back is Home.
await A.tap(`document.querySelector('#tabs [data-tab=home]')`);
await A.until(home);
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
ok(await A.until(`!document.body.classList.contains('wide')`), 'now on a phone');
await A.ev(`document.querySelector('#menuBtn').click(); true`);
ok(await A.until(shown('#menuPage')), '☰ opens the menu page');
await back();
ok(await A.until(`${shown('#home')} && document.querySelector('#menuPage').classList.contains('hidden')`, 2000), 'Back: Home');
await A.ev(`document.querySelector('#menuBtn').click(); true`);
await A.until(shown('#menuPage'));
await A.ev(`document.querySelector('#menuPage [data-go="tab:contacts"]').click(); true`);
ok(await A.until(`!document.querySelector('#tool').classList.contains('hidden')`), 'Contacts opens from the menu page');
await back();
ok(await A.until(home, 2000), 'Back: Contacts closes, Home');
await A.ev(`document.querySelector('#appDock [data-go="tab:day"]').click(); true`);
ok(await A.until(shown('#day')), 'Tasks from the dock');
await back();
ok(await A.until(home, 2000), 'Back: Home');
ok(await A.until(`!history.state?.kloomieBack`, 2000), 'and at Home, the next Back leaves Kloomie');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
