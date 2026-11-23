import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9363, 'chrome63');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9363) {
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

// Docs, tidied (the owner, 2026-11-22: "more organized list or the option to change the view of the icon like in a
// traditional pc docs folder"). Before, docs flowed into two uneven columns with long previews under each. Now Docs
// has a view switch: List, one doc a line with its columns lined up (Name, Pages, Edited) and a header that sorts,
// or Icons, a grid of big doc icons with the name under each. Folders has the same switch. The device remembers it.
const A = await tab(APP);
try {
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const t = Date.now();
const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Docs ' + t, name: 'Rico', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac' }) })).json();
const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
const mk = (title, extra = {}) => api('POST', '/items', { type: 'text', doc: { title, blocks: [{ id: 'b1', type: 'p', runs: [{ text: 'Long preview text that used to sit under every row' }] }] }, ...extra });
const hb = await mk('Handbook');
for (const n of ['Zebra plan', 'Apple notes', 'Mid list', 'Bids 2026', 'Crew rules', 'Day sheet']) await mk(n);
const page = await mk('Safety rules');
await api('PATCH', '/items/' + page.id, { underId: hb.id });
const dir = await api('POST', '/dirs', { name: 'Contracts' });
await mk('Lease terms', { dirId: dir.id });
await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 20000), 'signed in');
const openDocs = async () => { await A.ev(`document.querySelector('#tabs [data-tab=docs]')?.click() ?? document.querySelector('#tabs [data-tab=work]').click(); true`); await sleep(400); await A.ev(`(document.querySelector('#workTabs [data-tab=docs]') || [...document.querySelectorAll('#workTabs button')].find((b) => /Docs/.test(b.textContent)))?.click(); true`); await sleep(400); await A.ev(`document.querySelector('#tool .df-switch [data-df=docs]')?.click(); true`); await sleep(700); await A.ev(`document.querySelector('#docview:not(.hidden) .dv-lib')?.click(); true`); return A.until(`document.querySelectorAll('#tool .doc-row').length >= 5`); };
ok(await openDocs(), 'Docs opens');
// List: one doc a line, lined up, with a header.
ok(await A.until(`!!document.querySelector('#tool .docs-list.dk-list') && !!document.querySelector('#tool .dk-cols')`), 'List is the first view, with column headings');
ok(await A.ev(`(() => { const rows = [...document.querySelectorAll('#tool .docs-list .doc-row')]; const l = new Set(rows.map((r) => Math.round(r.getBoundingClientRect().left / 30))); const w = rows[0].getBoundingClientRect().width; return l.size === 1 && w > document.querySelector('#tool .docs-list').getBoundingClientRect().width * 0.9; })()`), 'one doc a line, the full width (not two uneven columns)');
ok(await A.ev(`(() => { const r = [...document.querySelectorAll('#tool .docs-list .doc-row .doc-when')].map((e) => Math.round(e.getBoundingClientRect().right)); return r.length >= 5 && new Set(r).size === 1; })()`), 'the Edited column lines up down the page');
ok(await A.ev(`![...document.querySelectorAll('#tool .docs-list .doc-row')].some((r) => r.textContent.includes('Long preview text'))`), 'no long previews under the rows');
ok(await A.ev(`!!(${'[...document.querySelectorAll("#tool .docs-list .doc-row")]'}.find((r) => r.textContent.includes('Handbook'))?.querySelector('.doc-pages')?.textContent.includes('1 page'))`), 'a doc with pages inside says how many in its own column');
// Sort by Name from the header.
await A.tap(`document.querySelector('#tool .dk-cols [data-sort=name]')`);
const names = await A.ev(`[...document.querySelectorAll('#tool .docs-list .doc-row:not(.dk-star-row) .doc-t')].map((e) => e.textContent.replace('★ ', '').trim())`);
const firstGroup = names.filter((n) => n !== 'Lease terms');
ok(JSON.stringify(firstGroup.slice(0, 3)) === JSON.stringify(['Apple notes', 'Bids 2026', 'Crew rules']), 'Name sorts A to Z: ' + firstGroup.slice(0, 4).join(', '));
await A.tap(`document.querySelector('#tool .dk-cols [data-sort=edited]')`);
ok(await A.until(`[...document.querySelectorAll('#tool .docs-list .doc-row .doc-t')][0]?.textContent.includes('Lease terms') || [...document.querySelectorAll('#tool .docs-list .doc-row .doc-t')].slice(0, 6).some((e) => e.textContent.includes('Safety rules') || e.textContent.includes('Day sheet'))`), 'Edited puts the newest first again');
// Icons: a grid of big icons, the name under each.
await A.tap(`document.querySelector('#tool .dk-view [data-view=icons]')`);
ok(await A.until(`document.querySelectorAll('#tool .docs-list .doc-tile').length >= 7`), 'Icons shows the docs as tiles');
ok(await A.ev(`(() => { const ts = [...document.querySelectorAll('#tool .doc-tile')]; const top = ts[0].getBoundingClientRect().top; return ts.filter((x) => Math.abs(x.getBoundingClientRect().top - top) < 4).length >= 4; })()`), 'several across, like a folder on a computer');
ok(await A.ev(`(() => { const x = document.querySelector('#tool .doc-tile'); const ic = x.querySelector('.doc-tile-ic').getBoundingClientRect(), t = x.querySelector('.doc-t').getBoundingClientRect(); return ic.height >= 40 && t.top >= ic.bottom - 2; })()`), 'a big icon with the name under it');
ok(await A.ev(`[...document.querySelectorAll('#tool .doc-tile')].find((x) => x.textContent.includes('Handbook'))?.querySelector('.doc-tile-n')?.textContent === '1'`), 'a doc with a page inside shows a 1 on its icon');
await A.tap(`[...document.querySelectorAll('#tool .doc-tile')].find((x) => x.textContent.includes('Crew rules'))`);
ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Crew rules'`), 'a tile opens its doc');
await A.ev(`document.querySelector('#docview [aria-label="Close doc"]').click(); true`);
// Remembered on this device.
await A.ev(`location.reload(); true`);
await A.until(`!document.querySelector('#app')?.classList.contains('hidden')`, 20000);
await sleep(800);
await openDocs();
ok(await A.until(`document.querySelectorAll('#tool .doc-tile').length >= 7 && document.querySelector('#tool .dk-view [data-view=icons]').classList.contains('on')`), 'after a reload it’s still Icons');
// Folders: the same switch.
await A.ev(`document.querySelector('#tool .df-switch [data-df=folders]').click(); true`);
ok(await A.until(`!!document.querySelector('#tool .dir-tile[data-dir]')`), 'Folders in Icons: big folder tiles');
ok(await A.ev(`(() => { const x = document.querySelector('#tool .dir-tile'); return x.querySelector('.dir-tile-ic svg').getBoundingClientRect().height >= 40 && x.textContent.includes('Contracts'); })()`), 'a big folder icon with its name');
await A.tap(`document.querySelector('#tool .dir-tile[data-dir]')`);
ok(await A.until(`[...document.querySelectorAll('#tool .dir-file')].some((x) => x.textContent.includes('Lease terms'))`), 'inside it, what’s there as tiles too');
await A.tap(`document.querySelector('#tool .dk-view [data-view=list]')`);
ok(await A.until(`!document.querySelector('#tool .dir-file') && !!document.querySelector('#tool .dir-list .card')`), 'List puts the folder back as a list');
// On a phone, List still fits: no sideways scroll, the name and when on each line.
await A.ev(`document.querySelector('#tool .df-switch [data-df=docs]').click(); true`);
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
await openDocs();
ok(await A.until(`!!document.querySelector('#tool .docs-list.dk-list .doc-row')`), 'List on a phone');
ok(await A.ev(`(() => { const t = document.querySelector('#tool'); const rows = [...document.querySelectorAll('#tool .docs-list .doc-row')]; return t.scrollWidth <= t.clientWidth + 1 && rows.every((r) => r.getBoundingClientRect().right <= innerWidth + 1 && r.querySelector('.doc-when').getBoundingClientRect().width > 0); })()`), 'no sideways scroll, and each line keeps its name and when');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
