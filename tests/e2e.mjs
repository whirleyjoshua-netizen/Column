import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${S}/dk/chrome2`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch('http://127.0.0.1:9334/json/new?' + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9] };
  const key = async (k) => { const [code, text] = KEYS[k]; await cmd('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); await sleep(40); };
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
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'e2e${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'Tab A'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'signed in to a new team');
await sleep(1500);
// an old-style note, made the way the composer makes them
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined })).json();
const old = await api('POST', '/items', { type: 'text', text: 'Old note\n- first\n- second' });
await A.click('[data-tab=column]');
ok(await A.until(`[...document.querySelectorAll('.doc-card .doc-card-t')].some((e) => e.textContent === 'Old note')`), 'an old note shows as a doc card with its title');
// new doc from the composer's +
await A.tap(`[...document.querySelectorAll('.composer .add')].find((b) => b.offsetParent)`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'New doc')`);
ok(await A.until(`!!document.querySelector('#docview .dk-title') && document.activeElement === document.querySelector('#docview .dk-title')`), 'New doc opens with the title ready to type');
await A.type('Launch plan'); await A.key('Enter');
await A.type('#'); await A.type(' '); await A.type('Steps'); await A.key('Enter');
await A.type('['); await A.type(']'); await A.type(' '); await A.type('Call 10 shops');
ok(await A.until(`document.querySelector('.dv-status').textContent === 'Saved'`, 4000), 'saves by itself');
const docs = await api('GET', '/state');
const item = (docs.items || []).find((x) => x.type === 'text' && x.title === 'Launch plan');
ok(!!item, 'the doc is on the server');
const body = await api('GET', `/items/${item?.id}/doc`);
ok(body.blocks?.map((b) => b.type).join() === 'h1,todo' && body.blocks[1].runs[0].text === 'Call 10 shops', 'server has the blocks: ' + body.blocks?.map((b) => b.type + ':' + (b.runs?.[0]?.text || '')).join(', '));
// the same doc open in a second tab: changes go both ways
const B = await tab(APP);
ok(await B.until(`!document.querySelector('#app').classList.contains('hidden')`), 'second tab signed in');
await B.click('[data-tab=column]');
await B.until(`[...document.querySelectorAll('.doc-card .doc-card-t')].some((e) => e.textContent === 'Launch plan')`);
await B.ev(`[...document.querySelectorAll('.doc-card')].find((c) => c.querySelector('.doc-card-t').textContent === 'Launch plan').querySelector('.meta').click()`);
ok(await B.until(`document.querySelector('#docview .dk-title')?.textContent === 'Launch plan'`), 'second tab opens the doc');
await A.key('Enter'); await A.type('Book 3 visits');
ok(await B.until(`[...document.querySelectorAll('#docview .dk-text')].some((e) => e.textContent === 'Book 3 visits')`, 5000), 'what tab A types shows up in tab B');
await B.ev(`(() => { const r = document.querySelector('#docview .dk-h1 .dk-text'); r.focus(); const s = getSelection(); s.selectAllChildren(r); s.collapseToEnd(); })()`);
await B.type(' this week');
ok(await A.until(`document.querySelector('#docview .dk-h1 .dk-text')?.textContent === 'Steps this week'`, 5000), 'what tab B types shows up in tab A');
ok(await A.ev(`[...document.querySelectorAll('#docview .dk-text')].at(-1).textContent`) === 'Book 3 visits', 'tab A kept its own line while B’s change came in');
await A.type('!');
ok(await B.until(`[...document.querySelectorAll('#docview .dk-text')].some((e) => e.textContent === 'Book 3 visits!')`, 5000), 'and A’s caret was still in place to keep typing');
// export
await A.tap(`document.querySelector('.dv-bar [aria-label="Doc options"]')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Export as PDF')`);
ok(await A.until(`[...document.querySelectorAll('.card .name')].some((e) => e.textContent === 'Launch plan.pdf')`, 8000), 'Export as PDF puts Launch plan.pdf next to the doc');
await A.tap(`document.querySelector('.dv-bar [aria-label="Doc options"]')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Export as Word (.docx)')`);
ok(await A.until(`[...document.querySelectorAll('.card .name')].some((e) => e.textContent === 'Launch plan.docx')`, 8000), 'Export as Word puts Launch plan.docx next to it');
// close, reload, reopen: it's all there
await A.ev(`document.querySelector('.dv-bar [aria-label="Close doc"]').click()`);
ok(await A.ev(`document.querySelector('#docview').classList.contains('hidden')`), 'the back button closes the doc');
await A.cmd('Page.reload');
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await A.click('[data-tab=column]');
await A.until(`[...document.querySelectorAll('.doc-card .doc-card-t')].some((e) => e.textContent === 'Launch plan')`);
await A.ev(`[...document.querySelectorAll('.doc-card')].find((c) => c.querySelector('.doc-card-t').textContent === 'Launch plan').querySelector('.meta').click()`);
ok(await A.until(`[...document.querySelectorAll('#docview .dk-text')].map((e) => e.textContent).join('|') === 'Steps this week|Call 10 shops|Book 3 visits!'`), 'after a reload the doc has everything: ' + await A.ev(`[...document.querySelectorAll('#docview .dk-text')].map((e) => e.textContent).join('|')`));
await A.ev(`document.querySelector('.dv-bar [aria-label="Close doc"]').click()`);
// the old note opens as a doc, and editing it keeps its lines
await A.ev(`[...document.querySelectorAll('.doc-card')].find((c) => c.querySelector('.doc-card-t').textContent === 'Old note').querySelector('.meta').click()`);
ok(await A.until(`[...document.querySelectorAll('#docview .dk-ul .dk-text')].map((e) => e.textContent).join() === 'first,second'`), 'an old note opens as a doc with its bullets');
// Docs tool
await A.ev(`document.querySelector('.dv-bar [aria-label="Close doc"]').click()`);
await A.tap(`document.querySelector('#toolsBtn')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Docs'))`);
ok(await A.until(`[...document.querySelectorAll('#tool .doc-row .bill-name')].some((e) => e.textContent.startsWith('Launch plan'))`), 'the Docs tool lists the docs');
ok(!A.errors.length && !B.errors.length, 'no page errors' + (A.errors.length + B.errors.length ? ': ' + [...A.errors, ...B.errors].join(' / ') : ''));
A.close(); B.close(); chrome.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
