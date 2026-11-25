// Work orders (Command Center part 5, 2026-11-20): 📋 Make it a work order in a task's drawer gives it a number, its
// steps and instructions, materials (picked from Inventory, ticked off as used, which takes them out of stock) and
// the customer's signature on a pad. Done is refused until the steps are ticked and the customer has signed. The
// number shows on the task's card and row, and Print makes a paper work order.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/woui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4996, APP = `http://127.0.0.1:${PORT}/`, CDP = 9559;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-woui`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-woui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: SERVER_DIR, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const mouse = async (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0, clickCount: 1 });
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(80); };
  return { ev, until, tap, mouse, cmd, pick, errors, close: () => ws.close() };
}
let A;
const shot = async (name) => { if (!process.env.SHOT) return; const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Wo ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const shop = await api('POST', '/inventory/places', { name: 'Shop' });
  const item = await api('POST', '/inventory/items', { name: 'Blind bracket', unit: 'ea' });
  await api('POST', '/inventory/moves', { kind: 'receive', itemId: item.id, qty: 20, to: shop.id });
  const camp = await api('POST', '/campaigns', { name: 'Garcia install' });
  const g = await api('POST', '/goals', { campaignId: camp.id, title: 'Install' });
  const task = await api('POST', '/tasks', { goalId: g.id, text: 'Install the blinds', description: 'Level, then hang.', checklist: [{ text: 'Brackets up' }] });
  const get = async () => (await api('GET', '/state')).tasks.find((x) => x.id === task.id);
  const wait = async (f) => { let x; for (let i = 0; i < 40; i++) { x = await get(); if (f(x)) return x; await sleep(150); } return x; };
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  for (let i = 0; i < 20 && !(await A.ev(`!!document.querySelector('.camp-card')`)); i++) { await A.ev(`document.querySelector('[data-tab=camps]')?.click(); true`); await sleep(300); }
  await A.tap(`document.querySelector('.camp-card')`);
  await A.until(`!!document.querySelector('#camps .cc-tab[data-ctab=work]')`);
  await A.tap(`document.querySelector('#camps .cc-tab[data-ctab=work]')`);
  await A.until(`!!document.querySelector('#camps .cc-wview-sel')`);
  await A.pick(`document.querySelector('#camps .cc-wview-sel')`, 'list');
  await A.until(`!!document.querySelector('#camps .cc-tr[data-task="${task.id}"]')`);
  await A.tap(`document.querySelector('#camps .cc-tr[data-task="${task.id}"]')`);
  ok(await A.until(`!!document.querySelector('#sheet .td-mkwo')`), 'the task’s drawer has 📋 Make it a work order');
  await A.tap(`document.querySelector('#sheet .td-mkwo')`);
  const D = (q) => `document.querySelector('#sheet ${q}')`;
  ok(await A.until(`/^WO-\\d+$/.test(${D('.wo-no')}?.textContent || '')`), 'it’s a work order, with a number: ' + await A.ev(`${D('.wo-no')}?.textContent`));
  ok(await A.ev(`[...document.querySelectorAll('#sheet .td-sec-h')].map((x) => x.textContent.split(' ·')[0]).join('|').includes('Instructions|Steps')`), 'its description reads as Instructions, its checklist as Steps');
  // A material from Inventory.
  await A.ev(`${D('.wo-add-n')}.focus(); true`);
  await A.cmd('Input.insertText', { text: 'Blind bracket' });
  await A.ev(`(() => { const q = ${D('.wo-add-q')}; q.value = '6'; return true; })()`);
  await sleep(300);
  await A.tap(`[...document.querySelectorAll('#sheet .wo-add button')].find((b) => b.textContent === 'Add')`);
  let x = await wait((y) => y.wo?.materials?.length === 1);
  ok(x.wo.materials[0].itemId === item.id && x.wo.materials[0].qty === 6, 'a material picked from Inventory, 6 of them');
  // Sign required: turn it on (a task with no job starts without).
  if (!x.wo.sign) { await A.tap(`${D('.wo-sign-opt input')}`); x = await wait((y) => y.wo.sign); }
  ok(x.wo.sign === true && await A.until(`!!${D('.wo-sign canvas')}`), 'Needs the customer’s signature: a pad to sign on');
  // Done is refused.
  await A.tap(`document.querySelector('#sheet .td-status [data-st=done]')`);
  await sleep(600);
  ok(!(await get()).done && /step/i.test(await A.ev(`[...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' ')`)), 'Done is refused with a step open: ' + await A.ev(`[...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' ')`));
  // Use the material: it comes out of stock.
  await A.tap(`${D('.wo-m input[type=checkbox]')}`);
  x = await wait((y) => y.wo.materials[0].used);
  const inv = await api('GET', '/inventory');
  ok(x.wo.materials[0].used && inv.items.find((y) => y.id === item.id).onHand === 14, 'ticking it as used takes 6 out of stock: ' + inv.items.find((y) => y.id === item.id).onHand);
  // Tick the step, then the customer signs.
  await A.tap(`${D('.td-cl-item input')}`);
  await wait((y) => y.checklist.every((c) => c.done));
  await A.until(`!!${D('.wo-sign canvas')}`);
  const [cx, cy, cw] = await A.ev(`(() => { const r = ${D('.wo-sign canvas')}.getBoundingClientRect(); ${D('.wo-sign canvas')}.scrollIntoView({ block: 'center' }); const r2 = ${D('.wo-sign canvas')}.getBoundingClientRect(); return [r2.left + 20, r2.top + r2.height / 2, r2.width]; })()`);
  await A.mouse('mouseMoved', cx, cy); await A.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i++) { await A.mouse('mouseMoved', cx + (cw - 60) * i / 12, cy + Math.sin(i) * 20); await sleep(15); }
  await A.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + cw - 60, y: cy, button: 'left', buttons: 0, clickCount: 1 });
  await A.ev(`(() => { const n = ${D('.wo-signer')}; n.value = 'Ana Garcia'; return true; })()`);
  await A.tap(D('.wo-sign-save'));
  x = await wait((y) => y.wo.signed);
  ok(x.wo.signed?.name === 'Ana Garcia' && x.wo.signed.img.startsWith('data:image/png;base64,'), 'the customer signs on the pad, with her name');
  ok(await A.until(`/Signed by Ana Garcia/.test(${D('.wo-signed')}?.textContent || '') && /Ready to finish/.test(${D('.wo-sum')}.textContent)`), 'the drawer shows the signature, and Ready to finish');
  await shot('wo-drawer');
  await A.tap(`document.querySelector('#sheet .td-status [data-st=done]')`);
  ok((await wait((y) => y.done)).done, 'now Done finishes it');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  await A.tap(`document.querySelector('#camps .cc-chip[data-chip=all]')`);
  ok(await A.until(`/WO-\\d+/.test(document.querySelector('#camps .cc-tr[data-task="${task.id}"] .wo-chip')?.textContent || '')`), 'its number shows on its row');
  // Print opens a paper work order.
  await A.ev(`(() => { window.__opened = null; const real = window.open; window.open = (...a) => { const w = real.apply(window, a); window.__opened = w; return w; }; return true; })()`);
  await A.tap(`document.querySelector('#camps .cc-tr[data-task="${task.id}"]')`);
  await A.until(`!!${D('.wo-print')}`);
  await A.ev(`(() => { window.print = () => {}; return true; })()`);
  await A.tap(D('.wo-print'));
  await sleep(500);
  const paper = await A.ev(`window.__opened ? window.__opened.document.body.textContent : ''`);
  ok(/Work order/.test(paper) && /WO-\d+/.test(paper) && /Install the blinds/.test(paper) && /Blind bracket/.test(paper) && /Ana Garcia/.test(paper) && /Level, then hang/.test(paper), 'Print: the number, the task, instructions, materials and the signature');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill(); srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-12).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
