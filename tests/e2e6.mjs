import * as FS from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
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
  const chooser = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.method === 'Page.fileChooserOpened') chooser.push(m.params); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9] };
  const key = async (k) => { const [code, text] = KEYS[k]; await cmd('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); await sleep(40); };
  const type = async (t) => { await cmd('Input.insertText', { text: t }); await sleep(40); };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => {
    // Wait for what's tapped to be there (a menu or panel can take a moment to draw on a busy machine).
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(80);
  };
  const click = (sel) => ev(`(() => { const e = typeof ${JSON.stringify(sel)} === 'string' ? document.querySelector(${JSON.stringify(sel)}) : null; e.click(); return true; })()`);
  return { ev, key, type, until, click, tap, cmd, errors, chooser, close: () => ws.close() };
}


const vOf = async (u) => (await (await fetch(u)).text()).match(/name="v" value="([^"]+)"/)?.[1] || ''; // the accept form's fingerprint, as a browser sends it
const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'qt${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'A'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'signed in');
// This suite uses tools a new team starts without: switch them all on.
await A.ev(`fetch('/api/workspace', { method: 'PATCH', headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')), 'content-type': 'application/json' }, body: JSON.stringify({ tools: { sidekick: true, docs: true, contacts: true, email: true, folders: true, signs: true, bills: true, meetings: true, map: true, vault: true, projects: true } }) }).then((r) => r.ok)`);
// The tools just switched on: reload so the app starts with them (no guessing how long the live update takes).
await A.ev(`location.reload()`);
await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 15000);
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined })).json();
await A.until(`!!document.querySelector('#tabs [data-tab=projects]')`, 10000); await A.ev(`document.querySelector('#tabs [data-tab=projects]').click()`);
await A.tap(`[...document.querySelectorAll('#projects .btn')].find((b) => b.textContent === 'Use a template')`);
// Jobs for a trade business (picked first), named, the kinds of work beside it with "We bid on jobs too" (full size, 2026-11-19).
await A.until(`!!document.querySelector('#projects .pjn-row')`);
await A.tap(`[...document.querySelectorAll('#projects .pjn-row')].find((b) => b.textContent.includes('Jobs for a trade business'))`);
await A.until(`document.querySelector('#projects .pjn-detail h3')?.textContent === 'Jobs for a trade business' && !!document.querySelector('#projects .pjn .pj-trade')`);
await A.ev(`(() => { const n = document.querySelector('#projects .pjn-name'); n.value = 'Estimating'; n.dispatchEvent(new Event('input')); })()`);
await A.tap(`document.querySelector('#projects .pj-bids input')`);
await A.until(`!!document.querySelector('#projects .pjn .pj-trade')`);
await A.tap(`[...document.querySelectorAll('#projects .pj-trade')].find((b) => b.textContent.includes('Windows and doors'))`);
await A.tap(`document.querySelector('#projects .pjn-create')`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-types button')].map((b) => b.textContent.replace(/\\d+$/, '').trim()).join('|').endsWith('|🧾 Quotes|📐 Bids|🏢 Clients|🏷️ Price list') && document.querySelector('#projects .pj-name')?.textContent === 'Estimating'`), 'a trades project that bids: its jobs, then Quotes, Bids, Clients, Price list');
await A.tap(`[...document.querySelectorAll('#projects .pj-types button')].find((b) => b.textContent.includes('Quotes'))`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-col-h b')].map((b) => b.textContent).join(',') === 'Draft,Sent,Viewed,Accepted,Declined,Expired'`), 'quotes open as a board by status');
const tabTo = (name) => A.tap(`[...document.querySelectorAll('#projects .pj-types button')].find((b) => b.textContent.includes(${JSON.stringify(name)}))`);
const field = (name) => `[...document.querySelectorAll('#projects .pj-panel .pj-frow')].find((r) => r.querySelector('.pj-flabel').textContent.endsWith(${JSON.stringify(name)})).querySelector('.pj-cell')`;
const setField = async (name, text) => { await A.tap(field(name)); await A.until(`document.activeElement?.classList.contains('pj-input')`); await A.type(text); await A.key('Enter'); await sleep(250); };
const newRec = async (label, name) => { await A.tap(`[...document.querySelectorAll('#projects .pj-bar .btn')].find((b) => b.textContent.startsWith(${JSON.stringify(label)}))`); await A.until(`document.activeElement === document.querySelector('#projects .pj-panel .pj-title')`); await A.type(name); await A.key('Enter'); await sleep(250); };
// price list item
await tabTo('Price list');
await newRec('+ New item', 'Ceramic film install');
await setField('Price', '185'); await setField('Our cost', '70');
await A.tap(field('Unit')); await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'window')`);
// client
await tabTo('Clients');
await newRec('+ New client', 'Desert Auto');
await setField('Email', 'maria@desertauto.com'); await setField('Contact person', 'Maria Lopez');
// quote
await tabTo('Quotes');
await A.tap(`[...document.querySelectorAll('#projects .pj-col')].find((c) => c.querySelector('.pj-col-h b').textContent === 'Draft').querySelector('.pj-newrow')`);
await A.until(`document.activeElement === document.querySelector('#projects .pj-panel .pj-title')`);
await A.type('Showroom tint'); await A.key('Enter'); await sleep(250);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-panel .pj-frow')].some((r) => r.textContent.includes('Number') && r.textContent.includes('Q-1001'))`), 'the quote is numbered Q-1001');
await A.tap(field('Client')); await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Desert Auto')`);
await sleep(300);
await A.tap(`[...document.querySelectorAll('#projects .pj-items .pj-newrow')].find((b) => b.textContent === '+ From the price list')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Ceramic film install'))`);
ok(await A.until(`document.querySelector('#projects .pj-it .desc')?.value === 'Ceramic film install' && document.querySelector('#projects .pj-it .price').value === '185' && document.querySelector('#projects .pj-it .cost').value === '70'`), 'a price-list item fills in its price and our cost');
await A.ev(`(() => { const i = document.querySelector('#projects .pj-it .qty'); i.focus(); i.select(); })()`);
await A.type('12');
ok(await A.until(`document.querySelector('#projects .pj-it-amt')?.textContent === '$2,220.00'`), 'changing the quantity updates the line: 12 × $185 = $2,220');
await A.tap(`[...document.querySelectorAll('#projects .pj-items .pj-newrow')].find((b) => b.textContent === '+ Add a line')`);
await A.until(`document.activeElement?.classList.contains('desc')`);
await A.type('Permit fee');
await A.ev(`(() => { const i = [...document.querySelectorAll('#projects .pj-it .price')].at(-1); i.focus(); })()`);
await A.type('75');
await A.ev(`[...document.querySelectorAll('#projects .pj-it .pj-it-x')].filter((b) => b.textContent !== '×').at(-1).click()`);
await A.ev(`(() => { const s = document.querySelector('#projects .pj-it-sel'); s.value = 'percent'; s.dispatchEvent(new Event('change')); })()`);
await A.ev(`(() => { const ins = [...document.querySelectorAll('#projects .pj-it-sums .pj-it-in')]; ins[0].focus(); })()`);
await A.type('10');
await A.ev(`(() => { const ins = [...document.querySelectorAll('#projects .pj-it-sums .pj-it-in')]; ins[1].focus(); })()`);
await A.type('8.375');
// 2220 + 75 = 2295 ; −10% = 229.50 ; taxable 2220 × 0.9 × 8.375% = 167.33 ; total 2232.83
ok(await A.until(`document.querySelector('#projects .pj-it-total b')?.textContent === '$2,232.83'`), 'subtotal, 10% off, tax on the taxed line: $2,232.83');
ok(await A.ev(`document.querySelector('#projects .pj-it-margin')?.textContent.includes('Our cost $840.00')`), 'our cost and margin show for us');
await sleep(1200);
const st = await api('GET', '/state');
const proj = st.projects.find((p) => p.name === 'Estimating');
const QT = proj.types.find((t) => t.key === 'quotes');
let recs = await api('GET', `/projects/${proj.id}/records`);
const q = recs.find((r) => r.typeId === QT.id);
const QF = (k) => QT.fields.find((f) => f.key === k);
ok(q.values[QF('items').id].rows.length === 2 && q.values[QF('items').id].taxRate === 8.375 && q.values[QF('items').id].discount.value === 10 && q.values[QF('items').id].rows[1].taxable === false, 'the server has the lines, the 10% discount, the tax rate and the untaxed permit');
// send
await A.tap(`[...document.querySelectorAll('#projects .pj-qbar .btn')].find((b) => b.textContent.includes('Send to customer'))`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-qbar .btn')].some((b) => b.textContent.includes('Copy customer link'))`), 'Send to customer makes the link');
ok(await A.until(`[...document.querySelectorAll('#projects .pj-col')].find((c) => c.querySelector('.pj-col-h b').textContent === 'Sent')?.textContent.includes('Showroom tint')`), 'the card moves to Sent');
recs = await api('GET', `/projects/${proj.id}/records`);
const link = APP + 'q/' + recs.find((r) => r.id === q.id).share.token;
const page = await (await fetch(link)).text();
ok(page.includes('Q-1001 · Showroom tint') && page.includes('Desert Auto') && page.includes('Maria Lopez') && page.includes('$2,232.83') && !page.includes('$70.00') && !page.includes('$840'), 'the customer page has the quote and client, not our costs');
ok(await A.until(`[...document.querySelectorAll('#projects .pj-col')].find((c) => c.querySelector('.pj-col-h b').textContent === 'Viewed')?.textContent.includes('Showroom tint')`), 'when the customer opens it, it moves to Viewed');
await fetch(link + '/accept', { method: 'POST', body: new URLSearchParams({ name: 'Maria Lopez', v: await vOf(link) }), redirect: 'manual' });
ok(await A.until(`[...document.querySelectorAll('#toasts *')].some((t) => t.textContent.includes('Maria Lopez accepted Q-1001 · Showroom tint ($2,232.83)'))`), 'the team is told Maria accepted, with the total');
ok(await A.until(`[...document.querySelectorAll('#projects .pj-col')].find((c) => c.querySelector('.pj-col-h b').textContent === 'Accepted')?.querySelector('.pj-col-sum')?.textContent === '$2,232.83'`), 'it moves to Accepted, and the column totals it');
// PDF
await A.tap(`[...document.querySelectorAll('#projects .pj-qbar .btn')].find((b) => b.textContent === 'Download PDF')`);
await sleep(1500);
const pdf = (await api('GET', '/state')).items.find((x) => x.name === 'Q-1001 · Showroom tint.pdf');
ok(!!pdf && pdf.size > 1000, 'Download PDF makes the quote as a PDF');
// a bid → a quote
await tabTo('Bids');
await A.tap(`[...document.querySelectorAll('#projects .pj-col')].find((c) => c.querySelector('.pj-col-h b').textContent === 'Estimating').querySelector('.pj-newrow')`);
await A.until(`document.activeElement === document.querySelector('#projects .pj-panel .pj-title')`);
await A.type('Henderson Library glazing'); await A.key('Enter'); await sleep(250);
await A.tap(field('Client')); await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Desert Auto')`);
await sleep(300);
await A.tap(`[...document.querySelectorAll('#projects .pj-items .pj-newrow')].find((b) => b.textContent === '+ Add a line')`);
await A.until(`document.activeElement?.classList.contains('desc')`);
await A.type('Film, 3,200 sq ft');
await A.ev(`(() => { const i = document.querySelector('#projects .pj-it .qty'); i.focus(); i.select(); })()`); await A.type('3200');
await A.ev(`document.querySelector('#projects .pj-it .price').focus()`); await A.type('9.5');
await A.ev(`document.querySelector('#projects .pj-it .cost').focus()`); await A.type('4.1');
ok(await A.until(`document.querySelector('#projects .pj-it-margin b')?.textContent === 'Margin $17,280.00 · 56.8%'`), 'the bid’s estimate shows the margin: $17,280 (56.8%)');
await sleep(1000);
await A.tap(`[...document.querySelectorAll('#projects .pj-qbar .btn')].find((b) => b.textContent === 'Make a quote from this bid')`);
ok(await A.until(`document.querySelector('#projects .pj-panel .pj-title')?.value === 'Henderson Library glazing' && [...document.querySelectorAll('#projects .pj-panel .pj-frow')].some((r) => r.textContent.includes('Q-1002'))`), 'Make a quote from this bid opens Q-1002 named after the job');
ok(await A.until(`document.querySelector('#projects .pj-it-total b')?.textContent === '$30,400.00' && [...document.querySelectorAll('#projects .pj-panel .pj-link')].some((b) => b.textContent === 'Henderson Library glazing') && [...document.querySelectorAll('#projects .pj-panel .pj-link')].some((b) => b.textContent === 'Desert Auto')`), 'with the estimate’s lines, the client and a link back to the bid');
ok(await A.ev(`document.querySelector('#workTabs [data-tab=projects]')?.classList.contains('on')`), 'Projects is lit in Workspace’s tabs');
await A.ev(`document.body.focus()`);
await A.key('Escape');
ok(await A.until(`!document.querySelector('#projects .pj-panel')`), 'Esc closes the record');
await A.key('Escape');
ok(await A.until(`!!document.querySelector('#projects .pj-head')`), 'Esc again goes back to all projects');
await A.tap(`document.querySelector('#projects [aria-label="Close Boards"]')`);
ok(await A.until(`document.querySelector('#projects').classList.contains('hidden')`), 'the close button closes Projects');
ok(!A.errors.length, 'no page errors' + (A.errors.length ? ': ' + A.errors.join(' / ') : ''));
A.close(); chrome.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
