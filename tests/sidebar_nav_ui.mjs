import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9361, 'chrome61');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9361) {
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




// The sidebar from Agents (live check 2026-11-20): Agents opens over the page, and Home or Apps & Integrations in the
// sidebar left it there, on top, with two items lit; only Workspace took you away. Every other place in the sidebar now
// takes you there, and Agents again (or Workspace) still works as before.
const A = await tab(APP);
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'sn' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=agents]')`, 15000), 'Jo signed in, Agents in the sidebar');
const agentsUp = `!document.querySelector('#tool').classList.contains('hidden') && !!document.querySelector('#tool .ag-team, #tool .ag-ask, #tool textarea')`;
const lit = `[...document.querySelectorAll('#tabs button.on')].map((b) => b.dataset.tab).join()`;
for (const to of ['home', 'apps']) {
  await A.tap(`document.querySelector('#tabs [data-tab=agents]')`);
  ok(await A.until(agentsUp), `Agents opens (before ${to})`);
  await A.tap(`document.querySelector('#tabs [data-tab=${to}]')`);
  ok(await A.until(`document.querySelector('#tool').classList.contains('hidden')`, 2000), `${to} from Agents: Agents closes`);
  ok(await A.ev(`!document.querySelector('#${to}').classList.contains('hidden')`), `${to} is the page`);
  ok((await A.ev(lit)) === to, `only ${to} is lit: ` + (await A.ev(lit)));
}
// Unchanged: Workspace from Agents, and Agents twice.
await A.tap(`document.querySelector('#tabs [data-tab=agents]')`);
await A.until(agentsUp);
await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
ok(await A.until(`document.querySelector('#tool').classList.contains('hidden') || !document.querySelector('#tool .ag-team, #tool .ag-ask')`, 2000), 'Workspace from Agents still works');
await A.tap(`document.querySelector('#tabs [data-tab=agents]')`);
await A.until(agentsUp);
await A.tap(`document.querySelector('#tabs [data-tab=agents]')`);
ok(await A.until(`document.querySelector('#tool').classList.contains('hidden')`, 2000), 'Agents again closes it, as before');
// Home's Today → Open Day opens today's Day, even when Tasks was last on Week (it opened Week).
await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
await A.until(`!!document.querySelector('#day:not(.hidden)')`);
await A.ev(`(() => { const b = [...document.querySelectorAll('#day button')].find((x) => x.textContent.trim() === 'Week'); b && b.click(); return !!b; })()`);
await A.tap(`document.querySelector('#tabs [data-tab=home]')`);
await A.until(`!document.querySelector('#home').classList.contains('hidden')`);
await A.tap(`[...document.querySelectorAll('#home button')].find((x) => x.textContent.trim() === 'Open Day')`);
ok(await A.until(`[...document.querySelectorAll('#day button.on')].some((x) => x.textContent.trim() === 'Day')`, 3000), 'Open Day lands on Day, not Week: ' + (await A.ev(`[...document.querySelectorAll('#day button.on')].map((x) => x.textContent.trim()).join()`)));
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
