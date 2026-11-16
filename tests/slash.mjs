import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9334, 'chrome2');
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



const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'vq' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'Jo laptop'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
// This suite uses tools a new team starts without: switch them all on.
await A.ev(`fetch('/api/workspace', { method: 'PATCH', headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')), 'content-type': 'application/json' }, body: JSON.stringify({ tools: { sidekick: true, docs: true, contacts: true, email: true, folders: true, signs: true, bills: true, meetings: true, map: true, vault: true, projects: true } }) }).then((r) => r.ok)`);
await A.until(`document.querySelector('#settingsBtn') && true`, 500);
await sleep(1200);
const tokA = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const JA = api(tokA);
const reload = async () => { await A.ev(`location.reload()`).catch(() => {}); await sleep(1500); await A.until(`!document.querySelector('#app').classList.contains('hidden')`); await sleep(800); };
await JA('PATCH', '/workspace', { tools: { vault: true, bills: true, contacts: true, meetings: true, map: true } });
await reload();
const posted = async (needle) => (await JA('GET', '/state')).items.some((x) => JSON.stringify(x).includes(needle));
const box = `[...document.querySelectorAll('.composer textarea')].find((x) => x.offsetParent)`;
const typeIn = async (t) => { await A.ev(`(() => { const ta = ${box}; ta.focus(); ta.value = ''; return true; })()`); await A.type(t); };
const shut = () => A.ev(`(() => { document.querySelector('#sheet').classList.add('hidden'); document.querySelector('#sheet').innerHTML = ''; return 1; })()`);
const sheetVals = () => A.ev(`[...document.querySelectorAll('#sheet input, #sheet textarea')].map((i) => i.value)`);
const sheetTitle = () => A.ev(`document.querySelector('#sheet:not(.hidden) h2')?.textContent || ''`);

await A.tap(`(document.querySelector('#tabs [data-tab=tools]').click(), document.querySelector('#tool [data-tool=column]'))`);
// The list
await typeIn('/');
ok(await A.until(`(() => { const t = document.querySelector('.slash-pop')?.textContent || ''; return ['/task', '/doc', '/vault', '/spent', '/budget', '/contact'].every((c) => t.includes(c)); })()`), '“/” lists the commands');
await A.type('sp');
ok(await A.until(`[...document.querySelectorAll('.slash-pop .pk-row')].length === 1 && document.querySelector('.slash-pop').textContent.includes('/spent')`), '“/sp” narrows it to /spent');
await A.key('Enter');
ok(await A.ev(`${box}.value === '/spent '`), 'Enter picks it: “/spent ” in the box');
await A.type('45 gas');
await A.key('Enter');
ok(await A.until(`document.querySelector('#sheet:not(.hidden) h2')?.textContent.includes('Add money out')`), '/spent 45 gas opens Money out');
ok((await sheetVals()).includes('45') && (await sheetVals()).includes('gas'), 'with $45 and “gas” filled in: ' + JSON.stringify(await sheetVals()));
ok(!(await posted('45 gas')) && (await A.ev(`${box}.value === ''`)), 'nothing posted, box cleared');
await shut();

const run = async (text, title, expect, label) => {
  await typeIn(text);
  await A.ev(`document.querySelector('.slash-pop')?.remove()`);
  await A.key('Enter');
  const got = await A.until(`(document.querySelector('#sheet:not(.hidden) h2')?.textContent || '').includes(${JSON.stringify(title)})`);
  const vals = await sheetVals();
  ok(got && expect.every((v) => vals.includes(v)) && !(await posted(text)), label + (got ? '' : ' (sheet: ' + (await sheetTitle()) + ')') + ' ' + JSON.stringify(vals.slice(0, 4)));
  await shut();
};
await run('/budget Gas 400', 'Set a budget', ['Gas', '400'], '/budget Gas 400 → budget for Gas, $400');
await run('/bill Electric 140', 'bill', ['Electric', '140'], '/bill Electric 140 → bill');
await run('/income 1,200 Smith job', 'Add money in', ['1200', 'Smith job'], '/income 1,200 Smith job → money in');
await run('/contact Pat Lee', 'New contact', ['Pat Lee'], '/contact Pat Lee → new contact');
await run('/campaign Spring push', '', ['Spring push'], '/campaign Spring push → campaign form');
await run('/task call Bob back', '', ['call Bob back'], '/task call Bob back → Day form');
// /doc makes the doc right here
await typeIn('/doc Smith quote');
await A.ev(`document.querySelector('.slash-pop')?.remove()`);
await A.key('Enter');
ok(await A.until(`true`) && await (async () => { for (let i = 0; i < 30; i++) { const st = await JA('GET', '/state'); if (st.items.some((x) => x.type === 'text' && x.title === 'Smith quote')) return true; await sleep(200); } return false; })(), '/doc Smith quote makes a doc called “Smith quote”');
await A.key('Escape'); await sleep(300);
await A.ev(`(document.querySelector('#tabs [data-tab=tools]').click(), document.querySelector('#tool [data-tool=column]')).click()`); await sleep(500);
// Not a command: posts as typed
await typeIn('/usr/bin is the folder');
await A.key('Enter');
ok(await A.until(`true`) && await (async () => { for (let i = 0; i < 20; i++) { if (await posted('/usr/bin is the folder')) return true; await sleep(200); } return false; })(), 'an unknown /word posts as a normal note');
// Escape closes the list
await typeIn('/');
await A.until(`!!document.querySelector('.slash-pop')`);
await A.key('Escape');
ok(await A.ev(`!document.querySelector('.slash-pop')`), 'Escape closes the list');
// In chat too
await A.tap(`document.querySelector('[data-tab=chat]')`);
await A.until(`!!(${box})`);
await run('/spent 12 coffee', 'Add money out', ['12', 'coffee'], 'works in chat: /spent 12 coffee');
// A tool that's off says so, and nothing is posted
await JA('PATCH', '/workspace', { tools: { bills: false } });
await reload();
await A.tap(`document.querySelector('[data-tab=chat]')`);
await A.until(`!!(${box})`);
await typeIn('/');
ok(await A.until(`!!document.querySelector('.slash-pop')`) && !(await A.ev(`document.querySelector('.slash-pop').textContent.includes('/spent')`)), 'Finance off: /spent isn’t listed');
await A.ev(`document.querySelector('.slash-pop')?.remove()`);
await typeIn('/spent 9 lunch');
await A.ev(`(() => { window.__t = []; new MutationObserver(() => window.__t.push(document.querySelector('#toasts').textContent)).observe(document.querySelector('#toasts'), { childList: true }); return 1; })()`);
await A.key('Enter');
await sleep(400);
ok((await A.ev(`window.__t.join(' ')`)).includes('Finance is switched off') && !(await posted('9 lunch')), 'typed anyway: “Finance is switched off”, nothing posted');
ok(!A.errors.length, 'no page errors' + (A.errors.length ? ': ' + A.errors.join(' / ') : ''));
A.close(); chrome.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
