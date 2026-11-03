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
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'con${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'Tab A'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'signed in');
await sleep(1500);
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined })).json();
const c = await api('POST', '/campaigns', { name: 'Fleet push', start: '2026-10-01', end: '2026-12-31' });
const g = await api('POST', '/goals', { campaignId: c.id, title: 'Book 5 demos', kind: 'tasks' });
await api('POST', '/tasks', { text: 'Call Desert Auto', goalId: g.id });
await api('POST', '/attempts', { campaignId: c.id, outcome: 'Interested' });
const stack = (await api('GET', '/state')).workspace.stacks.find((x) => x.campaignId === c.id);
const d = await api('POST', '/items', { type: 'text', stackId: stack.id, doc: { title: 'Fleet notes', blocks: [{ id: 'p1', type: 'p', runs: [] }] } });
await sleep(500);
// open it from the Docs tool
await A.tap(`document.querySelector('#toolsBtn')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Docs'))`);
await A.tap(`[...document.querySelectorAll('#tool .doc-row')].find((r) => r.textContent.startsWith('Fleet notes'))`);
ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Fleet notes'`), 'doc opened from the Docs tool');
await A.ev(`(() => { const r = document.querySelector('#docview .dk-p-t'); r.focus(); getSelection().collapse(r, 0); })()`);
// @ mention
await A.type('Ask about '); await A.type('@'); await A.type('Fle');
ok(await A.until(`[...document.querySelectorAll('.dk-slash b')].some((b) => b.textContent === 'Fleet push')`), '"@Fle" finds the campaign');
await A.key('Enter');
ok(await A.until(`document.querySelector('#docview .dk-ref-campaign')?.textContent === 'Fleet push'`), 'the mention is a chip');
await A.type('today');
ok(await A.until(`document.querySelector('.dv-status').textContent === 'Saved'`), 'saved');
let gd = await api('GET', `/items/${d.id}/doc`);
ok(JSON.stringify(gd.blocks[0].runs) === JSON.stringify([{ text: 'Ask about ' }, { text: 'Fleet push', ref: { k: 'campaign', id: c.id } }, { text: ' today' }]), 'server has the mention as a reference: ' + JSON.stringify(gd.blocks[0].runs));
// live campaign summary
await A.key('Enter'); await A.type('/'); await A.type('campaign');
await A.key('Enter');
ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('this doc’s campaign'))`), 'asks which campaign, this doc’s first');
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('this doc’s campaign'))`);
ok(await A.until(`document.querySelector('#docview .dk-lv .dk-live-h b')?.textContent === 'Fleet push'`), 'a live campaign summary appears');
ok(await A.ev(`document.querySelector('#docview .dk-lv .lv-row span')?.textContent`) === 'Book 5 demos', 'it lists the goal');
// live call stats follow the log
await A.type('/'); await A.type('call st'); await A.key('Enter');
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('this doc’s campaign'))`);
ok(await A.until(`[...document.querySelectorAll('#docview .dk-lv')].some((x) => x.querySelector('.lv-big b')?.textContent === '1')`), 'live call stats show 1 logged');
await api('POST', '/attempts', { campaignId: c.id, outcome: 'Booked' });
ok(await A.until(`[...document.querySelectorAll('#docview .dk-lv')].some((x) => x.querySelector('.lv-big b')?.textContent === '2')`, 4000), 'a new call logged elsewhere shows up live');
// /task → a real task in the campaign's goal
await A.type('/'); await A.type('task'); await A.key('Enter');
await A.type('Send fleet pricing');
await A.key('Enter');
ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Book 5 demos')`), 'asks which goal the task goes under');
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Book 5 demos')`);
ok(await A.until(`!!document.querySelector('#docview .dk-tasked .dk-task-chips')`), 'the to-do is now a task, with its options beside it');
await sleep(1200);
let tasks = (await api('GET', '/state')).tasks;
const made = tasks.find((t) => t.text === 'Send fleet pricing');
ok(made && made.goalId === g.id && made.docId === d.id, 'task made under the goal, linked to the doc');
// done elsewhere → ticked here
await api('PATCH', '/tasks/' + made.id, { done: true });
ok(await A.until(`document.querySelector('#docview .dk-tasked')?.classList.contains('dk-done')`, 4000), 'done elsewhere ticks it in the doc');
// renamed elsewhere → the words follow
await api('PATCH', '/tasks/' + made.id, { text: 'Send fleet pricing PDF' });
ok(await A.until(`document.querySelector('#docview .dk-tasked .dk-text')?.textContent === 'Send fleet pricing PDF'`, 4000), 'renamed elsewhere, the to-do follows');
// unticked in the doc → the task opens again; words typed here go to the task
await A.tap(`document.querySelector('#docview .dk-tasked .dk-check')`);
await A.ev(`(() => { const r = document.querySelector('#docview .dk-tasked .dk-text'); r.focus(); const s = getSelection(); s.selectAllChildren(r); s.collapseToEnd(); })()`);
await A.type(' today');
await sleep(2000);
tasks = (await api('GET', '/state')).tasks;
const now = tasks.find((t) => t.id === made.id);
ok(now.done === false && now.text === 'Send fleet pricing PDF today', 'unticking and typing in the doc changes the task: ' + JSON.stringify({ done: now.done, text: now.text }));
// freeze the campaign summary
await A.ev(`document.querySelector('#docview .dk-lv').closest('.dk-row').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
await A.tap(`document.querySelector('#docview .dk-lv').closest('.dk-row').querySelector('.dk-grip')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Freeze the numbers as of today').click()`);
ok(await A.until(`document.querySelector('#docview .dk-lv')?.classList.contains('snap') && document.querySelector('#docview .dk-lv .dk-live-tag').textContent.startsWith('As of')`), 'freezing shows "As of" with the numbers kept');
await sleep(1500);
gd = await api('GET', `/items/${d.id}/doc`);
ok(gd.blocks.find((b) => b.type === 'live' && b.source === 'campaign')?.snap?.data?.name === 'Fleet push', 'the snapshot is saved in the doc');
// another doc links here
await api('POST', '/items', { type: 'text', doc: { title: 'Weekly report', blocks: [{ id: 'w', type: 'p', runs: [{ text: 'See ' }, { text: 'Fleet notes', ref: { k: 'doc', id: d.id } }] }] } });
ok(await A.until(`[...document.querySelectorAll('#docview .dv-link')].some((x) => x.textContent.includes('Weekly report'))`, 4000), '"Linked from" lists the other doc');
// the task row in the campaign links back
await A.tap(`document.querySelector('#docview .dk-ref-campaign')`);
ok(await A.until(`document.querySelector('#docview').classList.contains('hidden')`), 'clicking the mention leaves the doc for the campaign');
ok(await A.until(`[...document.querySelectorAll('.task-row')].some((r) => r.textContent.includes('Send fleet pricing PDF today') && r.textContent.includes('Doc'))`, 4000), 'the task in the campaign shows a Doc chip');
ok(!A.errors.length, 'no page errors' + (A.errors.length ? ': ' + A.errors.join(' / ') : ''));
A.close(); chrome.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
