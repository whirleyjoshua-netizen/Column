import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9354, 'chrome54');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9354) {
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




// The job board (job plan Phase 5, 2026-11-18): Campaigns → Overview lists the jobs held up, with why; a line opens
// the campaign, All jobs shows the rest, and a failed automation is listed for an owner.
const A = await tab(APP);
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'board' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const st = await api('GET', '/state');
await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });
const p = await api('POST', '/projects', { template: 'trades', trades: ['hvac'] });
const tp = p.types[0];
const wire = await api('POST', '/inventory/items', { name: 'Copper line set', unit: 'ft' });
const jobA = await api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bill Nye · new unit' } });
const ca = await api('POST', '/campaigns', { name: 'Bill Nye install', recordId: jobA.id });
const g = await api('POST', '/goals', { campaignId: ca.id, title: 'Install', kind: 'tasks' });
const t1 = await api('POST', '/tasks', { text: 'Set the unit', goalId: g.id });
await api('PATCH', `/goals/${g.id}`, { needs: [{ kind: 'stock', itemId: wire.id, qty: 25 }] });
await api('PATCH', `/tasks/${t1.id}`, { done: true });
const jobB = await api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Ann Lee · repair' } });
const cb = await api('POST', '/campaigns', { name: 'Ann Lee repair', recordId: jobB.id });
const gb = await api('POST', '/goals', { campaignId: cb.id, title: 'Fix it', kind: 'tasks' });
await api('POST', '/tasks', { text: 'Swap the motor', goalId: gb.id });
await sleep(800);

await A.ev(`document.querySelector('#tabs [data-tab=camps]').click()`);
ok(await A.until(`[...document.querySelectorAll('#camps button')].some((b) => /^Overview/.test(b.textContent))`), 'Campaigns has its Overview button');
await A.ev(`[...document.querySelectorAll('#camps button')].find((b) => /^Overview/.test(b.textContent)).click()`);
const rows = `[...document.querySelectorAll('.job-board .job-row')].map((r) => r.querySelector('.lead-name b').textContent)`;
ok(await A.until(`${rows}.join() === 'Bill Nye · new unit'`), 'the Overview lists the job that’s held up, only: ' + JSON.stringify(await A.ev(rows)));
ok(await A.ev(`/1 of 2 held up/.test(document.querySelector('.job-board-h').textContent)`), 'saying how many: ' + await A.ev(`document.querySelector('.job-board-h')?.textContent`));
const why = await A.ev(`document.querySelector('.job-row .job-block')?.textContent || ''`);
ok(/Install/.test(why) && /0 of 25 ft Copper line set/.test(why), 'with why: ' + why);
ok(await A.ev(`document.querySelector('.job-row .lead-prog small').textContent === '0/1'`), 'and how far it is');
await A.ev(`[...document.querySelectorAll('.job-board-h button')].find((b) => b.textContent === 'All jobs').click()`);
ok(await A.until(`${rows}.length === 2`), 'All jobs shows the rest: ' + JSON.stringify(await A.ev(rows)));
await A.ev(`document.querySelector('.job-row .job-block').click()`);
ok(await A.until(`[...document.querySelectorAll('#camps *')].some((e) => e.classList?.contains('goal-needs'))`), 'a line opens its campaign, at the step');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
