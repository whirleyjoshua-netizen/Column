import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9336, 'chrome4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9336) {
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
const team = 'pin' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
await api('PATCH', '/workspace', { tools: { projects: true, docs: true } });
const camp = await api('POST', '/campaigns', { name: 'Spring blinds push', start: '2026-11-01' });
const proj = await api('POST', '/projects', { template: 'crm', name: 'Installs' });
const rec = await api('POST', `/projects/${proj.id}/records`, { typeId: proj.types[0].id, values: { [proj.types[0].primary]: 'Smith kitchen shades' } });
let wsx = await api('POST', '/channels', { name: 'crew' });
const chan = wsx.channels.find((c) => c.name === 'crew');
await api('POST', '/stacks', { name: 'Photos' });
await sleep(1200);
// Your pins are a 📌 drop-down next to Tools, at the right of Workspace's strip (the owner, 2026-11-16).
const pins = async () => { const r = await A.ev(`(document.querySelector('#workTabs .pins-btn').click(), [...document.querySelectorAll('#menu .pin-item')].map((x) => x.textContent + (x.closest('button').classList.contains('on') ? '*' : '')))`); await A.ev(`document.querySelector('#menu').classList.add('hidden'); true`); return r; };
const pinHas = (t) => `(document.querySelector('#workTabs .pins-btn').click(), [...document.querySelectorAll('#menu .pin-item')].some((x) => x.textContent.includes(${JSON.stringify(t)})))`;
const pickPin = (t) => A.ev(`(document.querySelector('#workTabs .pins-btn').click(), [...document.querySelectorAll('#menu .pin-item')].find((x) => x.textContent.includes(${JSON.stringify(t)})).click(), true)`);
const menuPick = (re) => A.ev(`(() => { const b = [...document.querySelectorAll('#menu button')].find((x) => ${re}.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);

ok((await api('GET', '/state')).me.pins.length === 0 && (await pins()).length === 0, 'nothing pinned to start, and no divider');

// Pin a campaign from its ⋯ menu
await A.click('#tabs [data-tab=camps]');
await A.ev(`openCampaign && 0`).catch(() => {});
await A.until(`!!document.querySelector('#camps')`);
await A.ev(`document.querySelector('#tabs [data-tab=camps]').click()`);
await sleep(300);
ok(await A.until(`[...document.querySelectorAll('#camps *')].some((e) => e.textContent === 'Spring blinds push')`), 'the campaign is listed');
await A.ev(`[...document.querySelectorAll('#camps *')].find((e) => e.children.length === 0 && e.textContent === 'Spring blinds push').click()`);
ok(await A.until(`!!document.querySelector('[aria-label="Campaign options"]')`), 'campaign opens');
await A.click('[aria-label="Campaign options"]');
ok(await menuPick('/Pin to Workspace/'), 'its menu has 📌 Pin to Workspace');
ok(await A.until(pinHas('Spring blinds push')), 'the campaign is in your pins, the drop-down in Workspace’s top bar');
ok(await A.ev(`!document.querySelector('#tabs [data-pin]')`), 'and not in the sidebar');
ok(await A.ev(`(() => { const p = document.querySelector('#workTabs .pins-btn').getBoundingClientRect(), t = document.querySelector('#workTabs [data-tab=tools]').getBoundingClientRect(); return !document.querySelector('#workTabs .tabs-sep, #workTabs .tab-pin') && p.right <= t.left + 1 && t.left - p.right < 12; })()`), 'no divider and no row of pins: the 📌 drop-down sits right next to Tools');
await sleep(400);
ok(JSON.stringify((await api('GET', '/state')).me.pins) === JSON.stringify([{ go: 'camp:' + camp.id, label: 'Spring blinds push' }]), 'saved on the server');
ok((await pins()).some((x) => x.endsWith('*')), 'lit while that campaign is open');

// Pin a job from the record panel
await A.ev(`openRecord && 0`).catch(() => {});
await A.click('#tabs [data-tab=projects]'); // Projects is in Workspace (2026-11-14)
await A.until(`!document.querySelector('#projects').classList.contains('hidden')`);
await sleep(300);
await A.ev(`[...document.querySelectorAll('#projects *')].find((e) => e.children.length === 0 && e.textContent === 'Installs')?.click()`);
ok(await A.until(`[...document.querySelectorAll('#projects *')].some((e) => e.children.length === 0 && e.textContent === 'Smith kitchen shades')`, 6000), 'the project shows the job');
await A.ev(`[...document.querySelectorAll('#projects *')].find((e) => e.children.length === 0 && e.textContent === 'Smith kitchen shades').click()`);
ok(await A.until(`!!document.querySelector('.pj-panel [aria-label="Record options"]')`), 'the job opens');
await A.click('.pj-panel [aria-label="Record options"]');
ok(await menuPick('/Pin to Workspace/'), 'the job’s menu has Pin to Workspace');
ok(await A.until(pinHas('Smith kitchen shades')), 'the job is pinned');

// Pin a feed from the chat side
await A.click('#tabs [data-tab=tools]'); await A.until(`!!document.querySelector('#menu [data-tool=chat]')`); await A.click('#menu [data-tool=chat]');
ok(await A.until(`!!document.querySelector('#split #chat:not(.hidden)')`), 'Chat opens in the split (from Tools, 2026-11-20)');
await A.ev(`[...document.querySelectorAll('.ch-row')].find((r) => r.textContent.includes('crew')).querySelector('.ch-more').click()`);
ok(await menuPick('/Pin to Workspace/'), 'a feed’s menu has Pin to Workspace');
ok(await (async () => { for (let i = 0; i < 40; i++) { if ((await pins()).length === 3) return true; await sleep(100); } return false; })(), 'three pins now: ' + (await pins()).join(', '));

// Open each from the bar
await A.click('#tabs [data-tab=home]');
await pickPin('Smith');
ok(await A.until(`!document.querySelector('#projects').classList.contains('hidden') && !!document.querySelector('.pj-panel[data-id="${rec.id}"]')`, 6000), 'the job pin opens the job: ' + await A.ev(`[document.querySelector('#projects').className, document.querySelector('.pj-panel')?.textContent.slice(0, 80), document.querySelector('#projects').textContent.slice(0, 200)].join(' // ')`));
ok((await pins()).some((x) => x.includes('Smith') && x.endsWith('*')) && (await A.ev(`document.querySelector('#workTabs .pins-btn').classList.contains('on')`)), 'and is marked in the drop-down, which lights up');
await pickPin('crew');
ok(await A.until(`!document.querySelector('#chat').classList.contains('hidden') && document.querySelector('#projects').classList.contains('hidden') && document.querySelector('.ch-head')?.textContent.includes('crew')`), 'the feed pin opens that feed, closing Jobs');
await pickPin('Spring');
ok(await A.until(`!document.querySelector('#campsWrap').classList.contains('hidden') && !!document.querySelector('[aria-label="Campaign options"]')`), 'the campaign pin opens the campaign');

// Live name changes, and gone things leave the bar
await api('PATCH', '/campaigns/' + camp.id, { name: 'Fall blinds push' });
ok(await A.until(pinHas('Fall blinds push')), 'renaming the campaign renames its pin');

// The tabs sheet: pin a stack and the project, reorder, unpin
await A.ev(`(document.querySelector('#workTabs .pins-btn').click(), [...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Change your pins…').click(), true)`);
ok(await A.until(`document.querySelectorAll('#sheet .bar-row[data-pin]').length === 3`), 'the Your tabs sheet lists the pins');
await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === '+ Pin something').click()`);
ok(await menuPick('/Photos/'), 'Pin something offers the stack');
await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === '+ Pin something').click()`);
ok(await A.ev(`![...document.querySelectorAll('#menu button')].some((b) => b.textContent.startsWith('🎯'))`), 'and not what’s already pinned: ' + await A.ev(`[...document.querySelectorAll('#menu button')].map((b) => b.textContent).join('|')`));
ok(await menuPick('/Installs/'), 'and the project');
await A.ev(`document.querySelector('#sheet .bar-row[data-pin^="chan:"] [aria-label^="Unpin"]').click()`);
await A.ev(`document.querySelector('#sheet .bar-row[data-pin^="stack:"] [aria-label$="left"]').click()`);
await A.ev(`[...document.querySelectorAll('#sheet .btns button')].pop().click()`);
await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
await sleep(400);
let saved = (await api('GET', '/state')).me.pins.map((x) => x.go.split(':')[0]).join();
ok(saved === 'camp,stack,rec,proj', 'saved in the new order, feed unpinned: ' + saved);
ok((await pins()).map((x) => x.replace('*', '')).join('|').includes('Photos'), 'the stack is on the bar');
await pickPin('Photos');
ok(await A.until(`!document.querySelector('#panes').classList.contains('hidden') && document.querySelector('#panes .chip.on')?.textContent === 'Photos'`), 'the stack pin opens the stack');

// Right-click a pin: unpin
await A.ev(`(document.querySelector('#workTabs .pins-btn').click(), [...document.querySelectorAll('#menu .pin-item')].find((x) => x.textContent.includes('Installs')).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })), true)`);
ok(await menuPick('/^Unpin$/'), 'right-click a pin to unpin it');
ok(!(await pins()).some((x) => x.includes('Installs')), 'gone from your pins');

// Deleting a pinned campaign takes it off the bar
await api('DELETE', '/campaigns/' + camp.id);
await sleep(800);
ok(!(await pins()).some((x) => x.includes('blinds push')), 'a deleted campaign leaves your pins');

// Survives a reload; phone width scrolls rather than squashing
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 760, deviceScaleFactor: 2, mobile: true });
await A.ev(`location.reload()`).catch(() => {});
await sleep(1500);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await sleep(600);
ok((await pins()).length === 2, 'pins come back after a reload: ' + (await pins()).join(', '));
ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'the page does not scroll sideways on a phone');
ok(await A.ev(`[...document.querySelectorAll('#topTabs .tab-pin')].length === 2 && [...document.querySelectorAll('#topTabs .tab-pin')].every((b) => b.getBoundingClientRect().width > 60)`), 'pins keep their names on a phone (the bar scrolls instead)');

// The server keeps only sensible pins
const r = await api('PUT', '/account/pins', { pins: [{ go: 'camp:abc', label: 'x'.repeat(200) }, { go: 'camp:abc', label: 'again' }, { go: 'javascript:alert(1)', label: 'bad' }, { go: 'rec:../../x', label: 'bad' }, ...Array.from({ length: 20 }, (_, i) => ({ go: 'stack:s' + i, label: 'S' + i }))] });
ok(r.pins.length === 12 && r.pins[0].label.length === 60 && !r.pins.some((x) => /javascript|\.\./.test(x.go)), 'unknown kinds, repeats and junk are dropped, labels trimmed, at most 12');
ok((await api('PUT', '/account/pins', { pins: 'nope' })).error, 'a non-list is refused');

ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
A.close();
chrome.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
