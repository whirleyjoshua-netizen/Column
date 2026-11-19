// Supplier orders in a real browser: Place the order from the Reorder tab (the amounts filled in), it waits under
// On order and the item says so, part of it is received into a truck, then the rest; cancelling one. Fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_orders_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5222, CDP = 9565, APP = `http://127.0.0.1:${PORT}/`;
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
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'PO ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const flt = await api('POST', '/inventory/items', { name: '16x25 air filter', cost: '6.50', reorderAt: 10, reorderQty: 40, supplier: 'Ferguson', onHand: 6 });
  await api('POST', '/inventory/items', { name: 'Condensate pump', cost: '45', reorderAt: 2, supplier: 'Ferguson', onHand: 1 });
  await api('POST', '/inventory/items', { name: 'Zip ties', reorderAt: 1, onHand: 0 });
  const truck = await api('POST', '/inventory/places', { name: 'Truck 3', kind: 'truck' });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`!!document.querySelector('#tabs [data-tab=tools]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  await A.tap(`document.querySelector('#menu [data-tool=inventory]')`);
  await A.tap(`document.querySelector('#split .inv-views [data-view=reorder]')`);
  const fer = `document.querySelector('#split .inv-order[data-supplier=Ferguson]')`;
  await A.tap(`${fer}.querySelector('.inv-order-place')`);
  ok(await A.until(`document.querySelectorAll('#sheet .inv-p-qty').length === 2`), 'Place the order lists Ferguson’s two low items');
  ok(await A.ev(`[...document.querySelectorAll('#sheet .inv-p-qty')].map((i) => i.value).join() === '40,3'`), 'with the amounts filled in (40 filters, 3 pumps)');
  await A.fill(`document.querySelector('#sheet .inv-p-note')`, 'PO 1142');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Place the order')`);
  ok(await A.until(`!!document.querySelector('#split .inv-po') && /Order 1 · Ferguson/.test(document.querySelector('#split .inv-po').textContent) && /PO 1142/.test(document.querySelector('#split .inv-po').textContent)`), 'it waits under On order: Order 1 · Ferguson, PO 1142');
  ok(await A.until(`/40 on order/.test(${fer}?.textContent || '') && /On order/.test(${fer}.querySelector('[data-item="${flt.id}"] .inv-order-qty').textContent) && !${fer}.querySelector('.inv-order-place')`), 'the low list says they’re on order, and doesn’t offer to order them again');

  // Part of it comes in, into the truck.
  await A.tap(`document.querySelector('#split .inv-po .inv-po-receive')`);
  await A.until(`!!document.querySelector('#sheet .inv-r-qty')`);
  await A.ev(`(() => { const s = document.querySelector('#sheet .inv-r-place'); s.value = ${JSON.stringify(truck.id)}; s.dispatchEvent(new Event('change')); return true; })()`);
  await A.fill(`document.querySelector('#sheet .inv-count-row[data-item="${flt.id}"] input')`, '25');
  await A.fill(`[...document.querySelectorAll('#sheet .inv-r-qty')][1]`, '0');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Receive')`);
  ok(await A.until(`/25 of 40 in/.test(document.querySelector('#split .inv-po')?.textContent || '') && /15 to come/.test(document.querySelector('#split .inv-po').textContent)`), 'part in: 25 of 40 filters, 15 still to come');
  let inv = await api('GET', '/inventory');
  ok(inv.items.find((x) => x.id === flt.id).stock[truck.id] === 25, '25 filters are on Truck 3');

  // At phone width it still fits.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= 391 && [...document.querySelectorAll('#split .inv-po button')].every((b) => b.getBoundingClientRect().right <= 391)`), 'fits a phone');
  await A.cmd('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  // The rest.
  await A.tap(`document.querySelector('#split .inv-po .inv-po-receive')`);
  await A.until(`document.querySelectorAll('#sheet .inv-r-qty').length === 2`);
  ok(await A.ev(`[...document.querySelectorAll('#sheet .inv-r-qty')].map((i) => i.value).join() === '15,3'`), 'the rest filled in: 15 filters, 3 pumps');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Receive')`);
  ok(await A.until(`!document.querySelector('#split .inv-po')`), 'all in: it leaves On order');
  inv = await api('GET', '/inventory');
  ok(inv.orders[0].status === 'received' && inv.items.find((x) => x.id === flt.id).onHand === 46, 'received; 46 filters now');

  // Cancelling one.
  const o2 = await api('POST', '/inventory/orders', { supplier: 'Johnstone', lines: [{ itemId: flt.id, qty: 5 }] });
  await A.until(`!!document.querySelector('#split .inv-po[data-order="${o2.id}"]')`);
  await A.tap(`document.querySelector('#split .inv-po[data-order="${o2.id}"] .inv-po-cancel')`);
  ok(await A.until(`!document.querySelector('#split .inv-po')`), 'cancelled: gone from On order');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
chrome.kill('SIGKILL');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
