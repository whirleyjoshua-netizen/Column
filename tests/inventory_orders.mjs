// Supplier orders (2026-11-18, for column-a9's job step needs): an order to a supplier holds its lines until they
// come in; receiving some or all of it puts the stock in, each receive linked to the order, and the order is
// received once every line is. Items say how many are on order. Owners and admins place, receive and cancel orders.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_orders';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5221, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Orders ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Orders ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  const flt = (await rico('POST', '/inventory/items', { name: 'Air filter', cost: '6.00', supplier: 'Ferguson', onHand: 2, reorderAt: 5 })).body;
  const pump = (await rico('POST', '/inventory/items', { name: 'Condensate pump', supplier: 'Ferguson', onHand: 0 })).body;
  const pw = (await rico('POST', '/inventory/items', { name: 'Pressure washer', track: 'units' })).body;
  const inv0 = (await rico('GET', '/inventory')).body;
  const main = inv0.places[0];
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 3', kind: 'truck' })).body;

  ok((await mo('POST', '/inventory/orders', { supplier: 'Ferguson', lines: [{ itemId: flt.id, qty: 10 }] })).status === 403, 'members can’t place orders');
  ok((await rico('POST', '/inventory/orders', { supplier: 'Ferguson', lines: [] })).status === 400, 'an order needs something on it');
  ok((await rico('POST', '/inventory/orders', { lines: [{ itemId: pw.id, qty: 1 }] })).status === 400, 'equipment tracked one by one isn’t ordered this way');
  r = await rico('POST', '/inventory/orders', { supplier: 'Ferguson', note: 'PO 1142', lines: [{ itemId: flt.id, qty: 20, cost: '5.50' }, { itemId: pump.id, qty: 2 }, { itemId: flt.id, qty: 0 }] });
  const o = r.body;
  ok(r.status === 200 && o.status === 'open' && o.lines.length === 2 && o.lines[0].got === 0 && o.number === 1 && o.supplier === 'Ferguson', `placed: order 1 to Ferguson, 2 lines (${JSON.stringify(o).slice(0, 200)})`);
  let inv = (await rico('GET', '/inventory')).body;
  ok(inv.orders?.length === 1 && inv.items.find((x) => x.id === flt.id).onOrder === 20 && inv.items.find((x) => x.id === pump.id).onOrder === 2, 'the order is listed, and each item says how many are on order');
  ok(inv.items.find((x) => x.id === flt.id).onHand === 2, 'placing an order doesn’t change the stock');
  const mv = (await mo('GET', '/inventory')).body;
  ok(mv.orders?.length === 1 && mv.orders[0].lines[0].cost === undefined, 'members see orders, without costs');

  // Part of it comes in.
  ok((await mo('POST', `/inventory/orders/${o.id}/receive`, { lines: [{ itemId: flt.id, qty: 5 }] })).status === 403, 'members can’t receive an order');
  r = await rico('POST', `/inventory/orders/${o.id}/receive`, { placeId: truck.id, lines: [{ itemId: flt.id, qty: 12 }] });
  ok(r.status === 200 && r.body.status === 'open' && r.body.lines[0].got === 12, `12 filters in: still open (${r.body?.status})`);
  let h = (await rico('GET', '/inventory/items/' + flt.id)).body;
  ok(h.item.stock[truck.id] === 12 && h.moves[0].kind === 'receive' && h.moves[0].orderId === o.id && h.item.cost === 550, 'into Truck 3, the receive linked to the order, at the order’s cost');
  ok((await rico('POST', `/inventory/orders/${o.id}/receive`, { lines: [{ itemId: flt.id, qty: 9 }] })).status === 400, 'can’t receive more than is still to come');
  // The rest.
  r = await rico('POST', `/inventory/orders/${o.id}/receive`, { all: true });
  ok(r.status === 200 && r.body.status === 'received' && r.body.receivedAt && r.body.lines.every((l) => l.got === l.qty), 'the rest in: received');
  inv = (await rico('GET', '/inventory')).body;
  ok(inv.items.find((x) => x.id === flt.id).onHand === 22 && inv.items.find((x) => x.id === pump.id).stock[main.id] === 2 && !inv.items.find((x) => x.id === flt.id).onOrder, 'stock in (filters 22, pumps 2 at Main storage), nothing on order');
  ok((await rico('POST', `/inventory/orders/${o.id}/receive`, { all: true })).status === 400, 'a received order can’t be received again');

  // Cancelled.
  const o2 = (await rico('POST', '/inventory/orders', { supplier: 'Johnstone', lines: [{ itemId: pump.id, qty: 3 }] })).body;
  ok(o2.number === 2, 'numbered in order');
  r = await rico('POST', `/inventory/orders/${o2.id}/cancel`, {});
  ok(r.status === 200 && r.body.status === 'cancelled' && !(await rico('GET', '/inventory')).body.items.find((x) => x.id === pump.id).onOrder, 'cancelled: nothing on order');
  ok((await rico('POST', `/inventory/orders/${o2.id}/receive`, { all: true })).status === 400, 'a cancelled order can’t be received');

  // Another team can't see or touch them.
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Else ' + t, name: 'Zed', email: `zed${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const zed = call(r.body.token);
  ok((await zed('POST', `/inventory/orders/${o2.id}/cancel`, {})).status === 404 && !(await zed('GET', '/inventory')).body.orders.length, 'another team’s orders are not found');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
