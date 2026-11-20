import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9355, 'chrome55');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9355) {
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




// The weeks ahead (job plan Phase 5, 2026-11-18): Tasks → Team shows each person's next four weeks from the real work;
// a week opens into the tasks and visits behind it, with their job, campaign and step; work nobody is on, double
// bookings and what the coming steps need are listed.
const A = await tab(APP);
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'fc' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const st = await api('GET', '/state');
const jo = st.me.memberId;
await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const p = await api('POST', '/projects', { template: 'trades', trades: ['hvac'] });
const tp = p.types[0];
const job = await api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bill Nye · new unit' } });
const ca = await api('POST', '/campaigns', { name: 'Bill Nye install', recordId: job.id });
const g = await api('POST', '/goals', { campaignId: ca.id, title: 'Rough-in', kind: 'tasks', due: day(1) });
await api('POST', '/tasks', { text: 'Mount the bracket', goalId: g.id, assigneeId: jo });
await api('POST', '/tasks', { text: 'Pull the permit', goalId: g.id, due: day(1) });
await api('POST', `/records/${job.id}/visits`, { kind: 'Install', date: day(1), start: 540, end: 1020, memberIds: [jo] });
await api('POST', `/records/${job.id}/visits`, { kind: 'Estimate', date: day(1), start: 960, end: 1080, memberIds: [jo] });
await sleep(600);

await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
await A.ev(`(document.querySelector('#tabs [data-tab=work]').click(), document.querySelector('#workTabs .ws-switch').click(), true)`);
ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '👥 Team')`), 'the owner has 👥 Team in the workspace menu');
await A.ev(`([...document.querySelectorAll('#menu button')].find((b) => b.textContent === '👥 Team').click(), true)`);
await A.until(`!!document.querySelector('#sheet .tm-tab[data-tab=ahead]')`, 8000);
await A.tap(`document.querySelector('#sheet .tm-tab[data-tab=ahead]')`);
ok(await A.until(`!!document.querySelector('#sheet .fc-grid')`, 8000), 'the Team page’s Weeks ahead');
ok(await A.ev(`[...document.querySelectorAll('#sheet .fc-h')].map((x) => x.textContent).slice(1, 3).join() === 'This week,Next week'`), 'by week');
const wk = await A.ev(`(() => { const d = new Date(Date.now() + 864e5); const s = new Date(d); s.setDate(d.getDate() - d.getDay()); const t = new Date(); t.setDate(t.getDate() - t.getDay()); return Math.round((s - t) / 6048e5); })()`);
const cellQ = `[...document.querySelectorAll('#sheet .fc-cell[data-week="${wk}"]')].filter((b) => !b.classList.contains('nobody'))[0]`;
ok(await A.ev(`${cellQ}.classList.contains('over') && /10 h/.test(${cellQ}.textContent) && /1 task/.test(${cellQ}.textContent) && /1 est/.test(${cellQ}.textContent)`), 'Jo’s week: 10 hours booked, overloaded, a task estimated from its step: ' + await A.ev(`${cellQ}?.textContent`));
ok(await A.ev(`[...document.querySelectorAll('#sheet .fc-cell.nobody')][${wk}]?.textContent.startsWith('1')`), 'a row for work nobody is on');
ok(await A.ev(`/Double booked · 1/.test(document.querySelector('#sheet .fc').textContent) && /Install .* overlaps Estimate/.test(document.querySelector('#sheet .fc-conflict').textContent)`), 'the double booking is listed: ' + await A.ev(`document.querySelector('#sheet .fc-conflict')?.textContent`));
ok(await A.ev(`[...document.querySelectorAll('#sheet .fc-risk')].some((r) => /Bill Nye/.test(r.textContent) && /nobody is on/.test(r.textContent))`), 'and the job likely to fall behind, with why');
await A.tap(cellQ);
ok(await A.until(`!!document.querySelector('#sheet .fc-item')`), 'a week opens into the work behind it');
const its = await A.ev(`[...document.querySelectorAll('#sheet .fc-item')].map((x) => x.textContent)`);
ok(its.some((x) => /Estimated/.test(x) && /Mount the bracket/.test(x) && /Bill Nye · new unit/.test(x) && /Rough-in/.test(x) && /step’s date/.test(x)) && its.filter((x) => /visit/.test(x)).length === 2, 'each with its job, campaign and step, and the visits: ' + JSON.stringify(its));
await A.ev(`[...document.querySelectorAll('#sheet .fc-item')].find((x) => /Mount the bracket/.test(x.textContent)).click()`);
ok(await A.until(`!document.querySelector('#sheet .fc-item') && !!document.querySelector('.goal-needs, .camp-goals-h, #camps .goal, #step, .step-sheet, #sheet')`), 'tapping a task opens it');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
