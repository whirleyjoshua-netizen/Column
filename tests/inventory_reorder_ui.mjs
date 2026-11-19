// Inventory, step 4 in a real browser (headless Chrome): the Reorder tab groups what's low by supplier with how many
// to order and the order written out (copy, email, or a task); Received is one tap; a stock-take of a place; a
// spreadsheet in (new and updated items, stock counted in) and out (on hand at each place). Fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_reorder_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4993, CDP = 9551, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 80 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    await until(`(() => { const e = ${expr}; if (!e) return false; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (top === e || e.contains(top)); })()`, 6000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Order ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  await api('POST', '/inventory/items', { name: '16x25 air filter', sku: 'FLT-1625', cost: '6.50', reorderAt: 10, reorderQty: 40, supplier: 'Ferguson', onHand: 6 });
  await api('POST', '/inventory/items', { name: 'Condensate pump', cost: '45', reorderAt: 2, supplier: 'Ferguson', onHand: 1 });
  await api('POST', '/inventory/items', { name: 'Zip ties', reorderAt: 1, onHand: 0 });
  await api('POST', '/inventory/items', { name: 'Thermostat', reorderAt: 2, supplier: 'Johnstone', onHand: 9 });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`!!document.querySelector('#tabs [data-tab=tools]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  await A.tap(`document.querySelector('#menu [data-tool=inventory]')`);
  ok(await A.until(`document.querySelector('#split .inv-views [data-view=reorder]')?.textContent === 'Reorder (3)'`), 'the Reorder tab says 3 are low');
  await A.tap(`document.querySelector('#split .inv-views [data-view=reorder]')`);
  ok(await A.until(`[...document.querySelectorAll('#split .inv-order')].map((g) => g.dataset.supplier).join() === 'Ferguson,No supplier'`), 'grouped by supplier: Ferguson, then the ones with no supplier (not Johnstone: nothing of theirs is low)');
  const fer = `document.querySelector('#split .inv-order[data-supplier=Ferguson]')`;
  ok(await A.ev(`/Order 40/.test(${fer}.textContent) && /Order 3/.test(${fer}.textContent) && /About \\$395/.test(${fer}.textContent)`), 'how many to order (the filters’ reorder amount, 40; the pumps 3), about $395');
  ok(await A.ev(`decodeURIComponent(${fer}.querySelector('.inv-order-email').href).includes('- 40 each 16x25 air filter (FLT-1625)')`), '“Email it” writes the order out');
  await A.tap(`${fer}.querySelector('.inv-order-task')`);
  let tasks = [];
  for (let i = 0; i < 40; i++) { tasks = (await api('GET', '/state')).tasks; if (tasks.some((x) => x.text.startsWith('Order from Ferguson'))) break; await sleep(150); }
  ok(tasks.some((x) => x.text === 'Order from Ferguson: 40 16x25 air filter, 3 Condensate pump'), '“Make it a task” makes the order a task');
  await A.tap(`${fer}.querySelector('.inv-order-line .inv-order-got')`);
  await A.until(`!!document.querySelector('#sheet .inv-m-qty')`);
  await A.fill(`document.querySelector('#sheet .inv-m-qty')`, '40');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Receive')`);
  ok(await A.until(`document.querySelector('#split .inv-views [data-view=reorder]')?.textContent === 'Reorder (2)' && !/16x25 air filter/.test(document.querySelector('#split').textContent)`), 'Received 40: the filters leave the list (2 left)');

  // A stock-take.
  await A.tap(`document.querySelector('#split .inv-more')`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Count a place…')`);
  ok(await A.until(`document.querySelectorAll('#sheet .inv-count-row').length === 4`), 'Count a place lists every counted item');
  await A.fill(`[...document.querySelectorAll('#sheet .inv-count-row')].find((r) => r.textContent.includes('Thermostat')).querySelector('input')`, '7');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Save the count')`);
  let inv;
  for (let i = 0; i < 40; i++) { inv = await api('GET', '/inventory'); if (inv.items.find((x) => x.name === 'Thermostat').onHand === 7) break; await sleep(150); }
  ok(inv.items.find((x) => x.name === 'Thermostat').onHand === 7, 'saved: the thermostats are 7 now');

  // A spreadsheet in.
  await A.tap(`document.querySelector('#split .inv-more')`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Import a spreadsheet…')`);
  ok(await A.until(`!!document.querySelector('body > input[type=file]')`), 'Import picks a file');
  await A.ev(`(() => { const i = [...document.querySelectorAll('body > input[type=file]')].at(-1); const dt = new DataTransfer(); dt.items.add(new File(['Item,Part number,Vendor,Qty,Location,Reorder point\\nCapacitor 45/5,CAP-455,Johnstone,12,Truck 2,4\\nZip ties,,,100,,\\n'], 'stock.csv', { type: 'text/csv' })); i.files = dt.files; i.dispatchEvent(new Event('change')); return true; })()`);
  for (let i = 0; i < 40; i++) { inv = await api('GET', '/inventory'); if (inv.items.some((x) => x.name === 'Capacitor 45/5')) break; await sleep(150); }
  const cap = inv.items.find((x) => x.name === 'Capacitor 45/5');
  const t2 = inv.places.find((p) => p.name === 'Truck 2');
  ok(cap && cap.sku === 'CAP-455' && cap.supplier === 'Johnstone' && cap.reorderAt === 4 && t2 && cap.stock[t2.id] === 12, 'its headings understood (Item, Part number, Vendor, Qty, Location): a new capacitor, 12 on Truck 2 (made)');
  ok(inv.items.find((x) => x.name === 'Zip ties').onHand === 100, 'and the zip ties counted to 100');
  ok(await A.until(`document.querySelector('#split .inv-views [data-view=reorder]')?.textContent === 'Reorder (1)'`), 'the reorder list keeps up (only the pump now)');

  // A spreadsheet out.
  await A.ev(`window.__csv = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then((t) => (window.__csv = t)); return orig(b); }; true`);
  await A.tap(`document.querySelector('#split .inv-more')`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Export a spreadsheet')`);
  ok(await A.until(`!!window.__csv && window.__csv.includes('Name,SKU,Category,Unit,On hand,Main storage,Truck 2,Reorder at,Reorder qty,Supplier,Cost,Price,Value') && window.__csv.includes('Capacitor 45/5,CAP-455,,each,12,0,12,4,,Johnstone')`), 'Export: a spreadsheet with what’s on hand at each place (and costs, for an owner)');

  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.tap(`document.querySelector('#split .inv-views [data-view=reorder]')`);
  ok(await A.until(`document.documentElement.scrollWidth <= 392 && !!document.querySelector('.inv-order')`, 4000), 'the reorder list fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
