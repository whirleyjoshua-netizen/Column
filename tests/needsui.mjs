import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9353, 'chrome53');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9353) {
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





// What a step needs, in the campaign (job plan Phase 4, 2026-11-18): chips under the step, ✓ once got; the ⋯ menu's
// "What it needs…" sheet adds and removes them; a chip's menu books the visit or ticks one off by hand.
const A = await tab(APP);
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'need' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const st = await api('GET', '/state');
await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });
const p = await api('POST', '/projects', { template: 'trades', trades: ['hvac'] });
const tp = p.types[0];
const job = await api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bill Nye · new unit' } });
const truck = await api('POST', '/inventory/places', { name: 'Truck 1' });
const wire = await api('POST', '/inventory/items', { name: 'Copper line set', unit: 'ft' });
await api('POST', '/inventory/moves', { kind: 'receive', itemId: wire.id, qty: 100, to: truck.id });
const camp = await api('POST', '/campaigns', { name: 'Bill Nye install', recordId: job.id });
const g = await api('POST', '/goals', { campaignId: camp.id, title: 'Install', kind: 'tasks' });
await api('POST', '/tasks', { text: 'Set the unit', goalId: g.id });
await api('PATCH', `/goals/${g.id}`, { needs: [{ kind: 'stock', itemId: wire.id, qty: 25 }] });
await sleep(1000);
const menuPick = (re) => A.ev(`(() => { const b = [...document.querySelectorAll('#menu button')].find((x) => ${re}.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);

await A.ev(`document.querySelector('#tabs [data-tab=camps]').click()`);
ok(await A.until(`[...document.querySelectorAll('#camps *')].some((e) => e.textContent === 'Bill Nye install')`), 'the campaign is listed');
await A.ev(`[...document.querySelectorAll('#camps *')].find((e) => e.children.length === 0 && e.textContent === 'Bill Nye install').click()`);
const chips = `[...document.querySelectorAll('.goal-needs .need-chip')].map((b) => b.textContent + (b.classList.contains('met') ? '*' : ''))`;
ok(await A.until(`${chips}.join() === '📦 0 of 25 ft Copper line set'`), 'the step shows what it needs, with how much is used so far: ' + JSON.stringify(await A.ev(chips)));

// The sheet: add a visit and a field.
await A.ev(`document.querySelector('.goal [aria-label="Goal options"]').click()`);
ok(await menuPick('/What it needs \\(1\\)/'), 'the step’s menu has What it needs (1)…');
ok(await A.until(`!!document.querySelector('#sheet .need-add-row')`), 'the sheet opens');
await A.ev(`(() => { const k = document.querySelector('#sheet .need-kind'); k.value = 'visit'; k.dispatchEvent(new Event('change')); document.querySelector('#sheet .need-visit').value = 'Estimate'; document.querySelector('#sheet .need-add').click(); k.value = 'field'; k.dispatchEvent(new Event('change')); document.querySelector('#sheet .need-field').value = 'Customer sign-off'; document.querySelector('#sheet .need-add').click(); return true; })()`);
ok(await A.ev(`document.querySelectorAll('#sheet .need-row').length`) === 3, 'adding two more lists three');
ok(await A.ev(`document.querySelector('#sheet .need-item').hidden && !document.querySelector('#sheet .need-field').hidden`), 'only the boxes for that kind show');
await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === 'Save').click()`);
ok(await A.until(`${chips}.length === 3`), 'saved: three chips ' + JSON.stringify(await A.ev(chips)));
let got = await api('GET', '/state');
ok(got.goals.find((x) => x.id === g.id).needs.map((n) => n.kind).join() === 'stock,visit,field', 'and the server has them');

// Ordering it from the chip places an order for the step, and the chip says it's on order.
await A.ev(`document.querySelector('.goal-needs .need-chip').click()`);
ok(await menuPick('/Order it for this step/'), 'the materials chip offers Order it for this step…');
ok(await A.until(`document.querySelector('#sheet .inv-p-qty')?.value === '25'`), 'the order sheet opens with what’s still needed: ' + await A.ev(`document.querySelector('#sheet .inv-p-qty')?.value`));
await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => /Place the order/.test(b.textContent)).click()`);
ok(await A.until(`${chips}[0] === '📦 0 of 25 ft Copper line set · 25 on order'`, 8000), 'placed: the chip says it’s on order: ' + JSON.stringify(await A.ev(chips)));
const ords = (await api('GET', '/inventory')).orders;
ok(ords.length === 1 && ords[0].goalId === g.id, 'the order is the step’s: ' + JSON.stringify(ords.map((o) => o.goalId)));
// Using stock from the chip counts for the step.
await A.ev(`document.querySelector('.goal-needs .need-chip').click()`);
ok(await menuPick('/Use stock for it/'), 'the materials chip offers Use stock for it…');
ok(await A.until(`!!document.querySelector('#sheet .inv-m-qty')`), 'the stock sheet opens for that item');
await A.ev(`(() => { document.querySelector('#sheet .inv-m-qty').value = '25'; [...document.querySelectorAll('#sheet button')].find((b) => /^(Save|Use)/.test(b.textContent)).click(); return true; })()`);
ok(await A.until(`${chips}[0] === '✓ 25 of 25 ft Copper line set*'`, 8000), 'used: the chip is ticked: ' + JSON.stringify(await A.ev(chips)));

// Ticking by hand from a chip.
await A.ev(`document.querySelectorAll('.goal-needs .need-chip')[2].click()`);
ok(await menuPick('/Tick it off by hand/'), 'an owner can tick one off by hand from its chip');
ok(await A.until(`${chips}[2].endsWith('*')`), 'and it shows ticked');
await A.ev(`document.querySelectorAll('.goal-needs .need-chip')[1].click()`);
ok(await menuPick('/Book the estimate visit/'), 'the visit chip offers to book it');
ok(await A.until(`!!document.querySelector('#sheet input[type=date]')`), 'the visit sheet opens');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
