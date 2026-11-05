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
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(80);
  };
  const click = (sel) => ev(`(() => { const e = typeof ${JSON.stringify(sel)} === 'string' ? document.querySelector(${JSON.stringify(sel)}) : null; e.click(); return true; })()`);
  return { ev, key, type, until, click, tap, cmd, errors, chooser, close: () => ws.close() };
}



const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'cn${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'A'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'signed in');
// This suite uses tools a new team starts without: switch them all on.
await A.ev(`fetch('/api/workspace', { method: 'PATCH', headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')), 'content-type': 'application/json' }, body: JSON.stringify({ tools: { sidekick: true, docs: true, contacts: true, email: true, folders: true, signs: true, bills: true, meetings: true, map: true, vault: true, projects: true } }) }).then((r) => r.ok)`);
await A.until(`document.querySelector('#toolsBtn') && true`, 500);
await sleep(1200);
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined })).json();
const p = await api('POST', '/projects', { template: 'crm', name: 'Sales' });
const T = Object.fromEntries(p.types.map((t) => [t.key, t]));
const F = (t, k) => T[t].fields.find((f) => f.key === k);
const ch = (t, k, label) => F(t, k).choices.find((c) => c.label === label).id;
const add = (t, values) => api('POST', `/projects/${p.id}/records`, { typeId: T[t].id, values });
const ben = await add('contacts', { name: 'Ben Ortiz', phone: '702-555-0102', stage: ch('contacts', 'stage', 'Qualified') });
await add('contacts', { name: 'Ana Ruiz', phone: '702-555-0103', stage: ch('contacts', 'stage', 'Qualified') });
const month = new Date().toISOString().slice(0, 7);
await add('deals', { name: 'Fleet tint', value: 12500, stage: ch('deals', 'stage', 'Proposal'), close_date: month + '-28', contact: ben.id });
await add('deals', { name: 'Showroom', value: 6200, stage: ch('deals', 'stage', 'Won'), close_date: month + '-03' });
await sleep(400);
const openTools = async (label) => { await A.tap(`document.querySelector('#toolsBtn')`); await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)}))`); };
await openTools('Projects');
await A.tap(`[...document.querySelectorAll('#projects .pj-card')].find((x) => x.textContent.includes('Sales'))`);
await A.tap(`[...document.querySelectorAll('#projects .pj-open')].find((b) => b.textContent === 'Ben Ortiz')`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-tl')].some((x) => x.textContent.includes('Jo added this'))`), 'Ben’s panel has a timeline starting with who added him');
// log a call with a follow-up
await A.tap(`[...document.querySelectorAll('#projects .pj-act-btns .btn')].find((b) => b.textContent.includes('Log a call'))`);
await A.tap(`[...document.querySelectorAll('#sheet .pj-outs .btn')].find((b) => b.textContent === 'Interested')`);
ok(await A.ev(`!!document.querySelector('#sheet input[type=date]').value`), '“Interested” suggests a follow-up date');
await A.ev(`document.querySelector('#sheet textarea').value = 'Wants pricing for 14 vans'`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
const okCall = await A.until(`[...document.querySelectorAll('#projects .pj-tl')].some((x) => x.textContent.includes('Jo called · Interested') && x.textContent.includes('Wants pricing for 14 vans'))`);
if (!okCall) console.log('TIMELINE:', await A.ev(`[...document.querySelectorAll('#projects .pj-tl')].map((x) => x.textContent).join(' | ')`));
ok(okCall, 'the call shows on his timeline');
ok(await A.until(`[...document.querySelectorAll('#projects .pj-task')].some((x) => x.textContent.includes('Follow up with Ben Ortiz (interested)'))`), 'its follow-up is listed under Tasks');
ok(await A.until(`[...document.querySelectorAll('#projects .pj-frow')].some((r) => r.textContent.includes('Last contacted') && r.textContent.includes('Today'))`), 'Last contacted is today');
// change the stage: logged
await A.tap(`[...document.querySelectorAll('#projects .pj-panel .pj-frow')].find((r) => r.querySelector('.pj-flabel').textContent.endsWith('Stage')).querySelector('.pj-cell')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Customer')`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-tl')].some((x) => x.textContent.includes('changed Stage: Qualified → Customer'))`), 'a stage change shows on the timeline');
// a campaign list from the project, a call logged from it
const c = await api('POST', '/campaigns', { name: 'Call qualified' });
await api('PATCH', `/records/${ben.id}`, { values: { [F('contacts', 'stage').id]: ch('contacts', 'stage', 'Qualified') } });
await A.tap(`document.querySelector('#projects [aria-label="Close Projects"]')`);
await A.tap(`document.querySelector('[data-tab=camps]')`);
await A.tap(`[...document.querySelectorAll('.camp-card')].find((b) => b.textContent.includes('Call qualified'))`);
await A.until(`[...document.querySelectorAll('#camps button')].some((b) => b.textContent.startsWith('Files'))`);
await A.tap(`[...document.querySelectorAll('#camps button')].find((b) => b.textContent.startsWith('Files'))`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === '+ Call list from a project…')`);
ok(await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('Call list from a project')`), 'a campaign can make a call list from a project');
await A.ev(`(() => { const s = [...document.querySelectorAll('#sheet select')][2]; s.value = s.options[1].value; s.dispatchEvent(new Event('change')); })()`);
await A.ev(`[...document.querySelectorAll('#sheet .pj-outs label')].find((l) => l.textContent === 'Qualified').querySelector('input').click()`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`[...document.querySelectorAll('#toasts *')].some((t) => t.textContent.includes('Contacts · Qualified: 2 contacts to call'))`), 'the list has the 2 qualified contacts');
await sleep(500);
const st = await api('GET', '/state');
const l = st.lists.find((x) => x.campaignId === c.id);
await api('POST', '/attempts', { campaignId: c.id, listId: l.id, rowId: l.rows.find((r) => r.cells[0] === 'Ben Ortiz').id, contact: 'Ben Ortiz', outcome: 'Booked', note: 'Measure Tuesday' });
// the task row links back to Ben
await A.tap(`document.querySelector('[data-tab=day]')`);
await sleep(300);
// a doc mentioning Ben, and a live pipeline
const d = await api('POST', '/items', { type: 'text', doc: { title: 'Weekly', blocks: [{ id: 'a', type: 'p', runs: [] }] } });
await sleep(300);
await openTools('Docs');
await A.tap(`[...document.querySelectorAll('#tool .doc-row')].find((r) => r.textContent.startsWith('Weekly'))`);
await A.until(`!!document.querySelector('#docview .dk-p-t')`);
await A.ev(`(() => { const r = document.querySelector('#docview .dk-p-t'); r.focus(); getSelection().collapse(r, 0); })()`);
await sleep(600);
await A.type('Call '); await A.type('@'); await A.type('Ben');
ok(await A.until(`[...document.querySelectorAll('.dk-slash b')].some((b) => b.textContent === 'Ben Ortiz') && [...document.querySelectorAll('.dk-slash small')].some((s) => s.textContent === 'Contact · Sales')`), '“@Ben” finds the contact in Projects');
await A.key('Enter');
ok(await A.until(`document.querySelector('#docview .dk-ref-record')?.textContent === 'Ben Ortiz'`), 'the mention is a chip');
await A.key('Enter');
await A.type('/'); await A.type('pipeline'); await A.key('Enter');
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Deals'))`);
ok(await A.until(`[...document.querySelectorAll('#docview .dk-lv .lv-row')].some((x) => x.textContent.includes('Proposal') && x.textContent.includes('$12,500'))`), 'a live Pipeline block shows deals by stage with totals');
await A.until(`document.querySelector('.dv-status').textContent === 'Saved'`, 4000);
await A.tap(`document.querySelector('#docview .dk-ref-record')`);
ok(await A.until(`!document.querySelector('#projects').classList.contains('hidden') && document.querySelector('#projects .pj-panel .pj-title')?.value === 'Ben Ortiz'`), 'clicking the chip opens Ben in Projects');
ok(await A.until(`[...document.querySelectorAll('#projects .pj-tl')].some((x) => x.textContent.includes('Jo called · Booked') && x.textContent.includes('Call qualified'))`), 'his timeline has the call logged from the campaign');
ok(await A.until(`[...document.querySelectorAll('#projects .pj-tasks .pj-link')].some((x) => x.textContent.includes('Weekly'))`), 'and lists the doc that mentions him');
// Finance pipeline
await A.tap(`document.querySelector('#projects [aria-label="Close"]')`);
await A.tap(`document.querySelector('#projects .pj-top [aria-label="All projects"]')`);
await A.tap(`document.querySelector('#projects [aria-label="Close Projects"]')`);
await openTools('Finance');
ok(await A.until(`[...document.querySelectorAll('#tool .pj-fc')].some((x) => x.textContent.includes('Sales · Deals') && x.textContent.includes('$6,200 won') && x.textContent.includes('$12,500'))`), 'Finance shows the pipeline: $12,500 open closing this month, $6,200 won');
ok(!A.errors.length, 'no page errors' + (A.errors.length ? ': ' + A.errors.join(' / ') : ''));
A.close(); chrome.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
