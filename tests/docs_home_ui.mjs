import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9364, 'chrome64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9364) {
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


// Folders & Docs lands on a doc (the owner, 2026-11-22: "when first clicking on the files it brings us to a page that
// i feel like is an extra page ... this page is where we should land"). On a computer the tab opens the doc view
// itself (the Pages tree with Starred and Recent beside the doc): the last doc this person had open, or the newest.
// The list of every doc is still one tap away (All docs, or Back). A phone has no Pages tree, so it keeps the list.
const A = await tab(APP);
try {
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const t = Date.now();
const acct = async (w) => (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: w + ' ' + t, name: 'Rico', email: `rico${w}${t}@t.test`, password: 'longenough1', device: 'Mac' }) })).json();
const a = await acct('Home');
const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
const mk = (title) => api('POST', '/items', { type: 'text', doc: { title, blocks: [{ id: 'b1', type: 'p', runs: [{ text: 'Some words' }] }] } });
const made = {};
for (const n of ['Crew rules', 'Bids 2026']) { made[n] = await mk(n); await sleep(20); }
await mk('Day sheet'); // the newest
await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
const signIn = async (token) => { await A.ev(`localStorage.clear(); localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(token))}); location.reload(); true`); return A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 20000); };
ok(await signIn(a.token), 'signed in');
const goHome = async () => { await A.ev(`document.querySelector('#docview [aria-label="Close doc"]')?.click(); document.querySelector('#tabs [data-tab=home]')?.click(); true`); await sleep(400); };
const tapDocsTab = async () => { await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`); await sleep(400); await A.ev(`(document.querySelector('#workTabs [data-tab=docs]') || [...document.querySelectorAll('#workTabs button')].find((b) => /Docs/.test(b.textContent))).click(); true`); await sleep(600); };
const shown = `(() => { const v = document.querySelector('#docview'); return v && !v.classList.contains('hidden') ? v.querySelector('.dk-title')?.textContent : null; })()`;
// First time: the newest doc, with the Pages tree beside it.
await tapDocsTab();
ok(await A.until(`${shown} === 'Day sheet'`), 'the tab opens straight into a doc (the newest): ' + await A.ev(shown));
ok(await A.ev(`(() => { const t = document.querySelector('#docview .dv-tree'); return !!t && t.getBoundingClientRect().width > 100 && t.textContent.includes('Recent') && t.textContent.includes('Crew rules'); })()`), 'the Pages tree is beside it, with the other docs under Recent');
// Another doc from the tree; next time the tab comes back to that one.
await A.tap(`[...document.querySelectorAll('#docview .dvt-row')].find((b) => b.textContent.includes('Crew rules'))`);
ok(await A.until(`${shown} === 'Crew rules'`), 'a doc in the tree opens');
await goHome();
ok(await A.ev(`!document.querySelector('#docview') || document.querySelector('#docview').classList.contains('hidden')`), 'leaving closes the doc');
await tapDocsTab();
ok(await A.until(`${shown} === 'Crew rules'`), 'the tab comes back to the last doc open: ' + await A.ev(shown));
// The list of every doc is still there: All docs, and it doesn't bounce back into a doc.
await A.ev(`document.querySelector('#docview .dv-lib').click(); true`);
ok(await A.until(`${shown} === null && document.querySelectorAll('#tool .doc-row').length >= 3`), 'All docs shows the list of every doc');
await sleep(500);
ok(await A.ev(`${shown} === null`), 'and stays on the list');
// Back from a doc goes to the list too.
await A.tap(`[...document.querySelectorAll('#tool .doc-row')].find((r) => r.textContent.includes('Bids 2026'))`);
ok(await A.until(`${shown} === 'Bids 2026'`), 'a doc opens from the list');
await A.ev(`document.querySelector('#docview [aria-label="Close doc"]').click(); true`);
ok(await A.until(`${shown} === null && document.querySelectorAll('#tool .doc-row').length >= 3`), 'Back from a doc is the list');
// A doc that's gone (trashed): the tab falls back to the newest.
const bids = made['Bids 2026'];
await goHome();
ok(!!bids?.id, 'made Bids 2026'); await api('DELETE', '/items/' + bids.id); await sleep(600);
await tapDocsTab();
ok(await A.until(`${shown} === 'Day sheet' || ${shown} === 'Crew rules'`), 'a last doc that was deleted: another doc opens instead: ' + await A.ev(shown));
// A team with no docs: the list, with how to start one.
const b = await acct('Empty');
ok(await signIn(b.token), 'signed in to a team with no docs');
await tapDocsTab();
ok(await A.until(`${shown} === null && !!document.querySelector('#tool .docs-list')`), 'no docs: the list, with + New doc');
// A phone: no Pages tree there, so the tab keeps the list.
ok(await signIn(a.token), 'back in the first team');
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(600);
await goHome();
await tapDocsTab();
ok(await A.until(`document.querySelectorAll('#tool .doc-row').length >= 1`) && await A.ev(`${shown} === null`), 'on a phone the tab opens the list');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
