import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9335, 'chrome3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9335) {
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
const team = 'tb' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
await api('PATCH', '/workspace', { tools: { bills: true, projects: true, docs: true, sidekick: true } });
await sleep(1200);
const tabs = () => A.ev(`[...document.querySelectorAll('#tabs button[data-tab]')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : ''))`);
const names = async () => (await tabs()).map((t) => t.replace('*', '')).join(',');

ok(await names() === 'Home,Day,Stacks,Chat,Campaigns', 'starts with the usual tabs: ' + await names());
ok(await A.ev(`!!document.querySelector('#tabs .tabs-edit')`), 'a pencil to change them');
ok((await api('GET', '/state')).me.bar === null, 'nothing saved yet');
ok((await api('GET', '/state')).workspace.stacks.length === 0, 'a new team has no stacks yet');
await A.click('#tabs [data-tab=column]');
ok(await A.until(`[...document.querySelectorAll('#panes .chip')].map((c) => c.textContent).join('|') === 'Everything|Files'`), 'Stacks shows Everything and Files before any stack is made');
await A.ev(`[...document.querySelectorAll('#panes .chip')].find((c) => c.textContent === 'Files').click()`);
ok(await A.until(`document.querySelector('#panes .chip.on')?.textContent === 'Files'`), 'and Files can be picked');
await A.ev(`[...document.querySelectorAll('#panes .chip')].find((c) => c.textContent === 'Everything').click()`);
await A.click('#tabs [data-tab=home]');

// Change: drop Chat and Campaigns, add Finance and Jobs, move Jobs before Finance
await A.click('#tabs .tabs-edit');
ok(await A.until(`document.querySelector('#sheet:not(.hidden) h2')?.textContent.includes('Your tabs')`), 'the Your tabs sheet opens');
ok(await A.ev(`document.querySelectorAll('#sheet .bar-row.fixed input:disabled').length === 2`), 'Home and Day are fixed');
const tick = (k) => A.ev(`(() => { const b = document.querySelector('#sheet .bar-row[data-key=${k}] input'); b.click(); return true; })()`);
await tick('chat'); await tick('camps'); await tick('bills'); await tick('projects');
await A.ev(`document.querySelector('#sheet .bar-row[data-key=projects] [aria-label^="Move Jobs left"]').click()`);
await A.ev(`[...document.querySelectorAll('#sheet .btns button')].pop().click()`);
await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
ok(await names() === 'Home,Day,Stacks,Jobs,Finance', 'bar is now ' + await names());
ok(JSON.stringify((await api('GET', '/state')).me.bar) === '["column","projects","bills"]', 'saved on the server, so other devices get it');

// A tool tab opens its drawer and lights up; again closes it
await A.click('#tabs [data-tab=bills]');
ok(await A.until(`!document.querySelector('#tool').classList.contains('hidden') && document.querySelector('#tool h2').textContent.includes('Finance')`), 'Finance tab opens Finance');
ok((await tabs()).includes('Finance*'), 'Finance tab is lit while open');
await A.click('#tabs [data-tab=bills]');
ok(await A.until(`document.querySelector('#tool').classList.contains('hidden')`), 'tapping it again closes it');
await A.click('#tabs [data-tab=projects]');
ok(await A.until(`!document.querySelector('#projects').classList.contains('hidden')`), 'Jobs tab opens Jobs');
ok((await tabs()).includes('Jobs*'), 'Jobs tab is lit');
await A.click('#tabs [data-tab=day]');
ok(await A.until(`document.querySelector('#projects').classList.contains('hidden') && !document.querySelector('#day').classList.contains('hidden')`), 'Day closes Jobs and shows the day');

// Views left off the bar are in Tools
await A.click('#toolsBtn');
await sleep(200);
ok(await A.ev(`[...document.querySelectorAll('.menu button, #menu button')].some((b) => b.textContent.startsWith('Chat'))`), 'Chat is in Tools when it is off the bar');
ok(await A.ev(`document.querySelector('#menu').firstElementChild?.textContent.includes('Sidekick')`), 'Sidekick is the first thing in Tools, above the views');
ok(await A.ev(`![...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Change your tabs'))`), 'and Tools no longer has Change your tabs (the pencil and Settings do that)');
await A.ev(`[...document.querySelectorAll('.menu button, #menu button')].find((b) => b.textContent.startsWith('Chat')).click()`);
ok(await A.until(`!document.querySelector('#chat').classList.contains('hidden')`), 'and opens from there');

// Team switches win
await api('PATCH', '/workspace', { tools: { bills: false } });
ok(await A.until(`!document.querySelector('#tabs [data-tab=bills]')`), 'Finance leaves the bar when the team switches it off');
await api('PATCH', '/workspace', { tools: { bills: true } });
ok(await A.until(`!!document.querySelector('#tabs [data-tab=bills]')`), 'and comes back when it is on again');

// Survives a reload
await A.ev(`location.reload()`).catch(() => {});
await sleep(1500);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await sleep(600);
ok(await names() === 'Home,Day,Stacks,Jobs,Finance', 'same tabs after a reload');

// Settings shows it too
await A.click('#settingsBtn');
ok(await A.until(`[...document.querySelectorAll('#settings h3')].some((x) => x.textContent === 'Your tabs')`), 'Settings → General has Your tabs');

// Phone width: nothing squashed, the bar scrolls instead
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 760, deviceScaleFactor: 2, mobile: true });
await A.ev(`document.querySelector('#settings').classList.add('hidden')`);
await api('PUT', '/account/bar', { bar: ['column', 'chat', 'camps', 'projects', 'bills', 'docs'] });
await A.ev(`location.reload()`).catch(() => {});
await sleep(1500);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await sleep(600);
ok(await A.ev(`[...document.querySelectorAll('#tabs button')].every((b) => b.scrollWidth <= b.clientWidth + 1)`), 'no tab label is cut off on a phone');
ok(await A.ev(`document.querySelector('#tabs').scrollWidth > document.querySelector('#tabs').clientWidth`), 'the bar scrolls sideways when there are many');
ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'the page itself does not scroll sideways');
ok(await A.ev(`document.querySelector('#home').scrollWidth <= document.querySelector('#home').clientWidth + 1`), 'Home fits the phone (Get started rows included)');

// Back to the usual
await A.click('#tabs .tabs-edit');
await A.until(`!document.querySelector('#sheet').classList.contains('hidden')`);
await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === 'Back to the usual').click()`);
await A.ev(`[...document.querySelectorAll('#sheet .btns button')].pop().click()`);
await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
ok(await names() === 'Home,Day,Stacks,Chat,Campaigns' && (await api('GET', '/state')).me.bar === null, 'Back to the usual resets it');

// Junk is ignored
const r = await api('PUT', '/account/bar', { bar: ['chat', 'nope', 'chat', 'home'] });
ok(JSON.stringify(r.bar) === '["chat"]', 'unknown and repeated tabs are dropped');

ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
A.close();
chrome.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
