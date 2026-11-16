// Inventory, step 4 (server): a stock-take at one place sets each counted item there and logs only what changed;
// a spreadsheet adds new items, updates known ones (by SKU, then by name) and counts "on hand" in at a place (made if
// it's new). Owners and admins only.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_counts';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4992, B = `http://127.0.0.1:${PORT}`;
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Count ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Count ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  const a = (await rico('POST', '/inventory/items', { name: 'Air filter', sku: 'FLT-1', onHand: 10 })).body;
  const b = (await rico('POST', '/inventory/items', { name: 'Copper fitting', onHand: 30 })).body;
  const pw = (await rico('POST', '/inventory/items', { name: 'Pressure washer', track: 'units', onHand: 1 })).body;
  const main = (await rico('GET', '/inventory')).body.places[0];

  // A stock-take.
  ok((await mo('POST', '/inventory/count', { placeId: main.id, counts: [] })).status === 403, 'members can’t do a stock-take');
  ok((await rico('POST', '/inventory/count', { counts: [] })).status === 400, 'it needs the place counted');
  r = await rico('POST', '/inventory/count', { placeId: main.id, counts: [{ itemId: a.id, qty: 8 }, { itemId: b.id, qty: 30 }, { itemId: pw.id, qty: 5 }] });
  ok(r.status === 200 && r.body.changed === 1 && r.body.same === 1, 'a stock-take: 1 changed (filters 10 → 8), 1 the same; equipment isn’t counted this way');
  const ah = (await rico('GET', '/inventory/items/' + a.id)).body;
  ok(ah.item.onHand === 8 && ah.moves[0].kind === 'count' && ah.moves[0].counted === 8 && ah.moves[0].qty === -2 && ah.moves[0].note === 'Stock-take', 'the filters show 8, with the count (−2) in their history');
  ok((await rico('GET', '/inventory/items/' + b.id)).body.moves.length === 1, 'nothing logged for what didn’t change');

  // A spreadsheet.
  ok((await mo('POST', '/inventory/import', { rows: [{ name: 'X' }] })).status === 403, 'members can’t import');
  r = await rico('POST', '/inventory/import', { rows: [
    { name: 'Air filter 16x25', sku: 'flt-1', cost: '6.75', reorderAt: '5', supplier: 'Ferguson', onHand: '12' },
    { name: 'copper fitting', category: 'Plumbing', onHand: '20', place: 'Truck 3' },
    { name: 'Thermostat', sku: 'TS-9', unit: 'each', price: '89', reorderAt: '2', onHand: '4' },
    { name: '', sku: 'nothing' },
    { name: 'Bad cost', cost: 'abc' },
  ] });
  ok(r.status === 200 && r.body.added === 1 && r.body.updated === 2 && r.body.skipped === 2 && r.body.counted === 3, `imported: 1 new, 2 updated, 3 counted in, 2 skipped (${JSON.stringify(r.body)})`);
  const inv = (await rico('GET', '/inventory')).body;
  const fa = inv.items.find((x) => x.id === a.id);
  ok(fa.name === 'Air filter 16x25' && fa.cost === 675 && fa.reorderAt === 5 && fa.supplier === 'Ferguson' && fa.stock[main.id] === 12, 'matched by SKU (any case): renamed, its cost, reorder point and supplier set, counted to 12 at Main storage');
  const truck = inv.places.find((p) => p.name === 'Truck 3');
  const fb = inv.items.find((x) => x.id === b.id);
  ok(truck?.kind === 'truck' && fb.category === 'Plumbing' && fb.stock[truck.id] === 20 && fb.stock[main.id] === 30, 'matched by name: Truck 3 made, 20 counted in there (the 30 at Main storage left as they are)');
  const th = inv.items.find((x) => x.name === 'Thermostat');
  ok(th && th.sku === 'TS-9' && th.price === 8900 && th.onHand === 4 && th.reorderAt === 2, 'a new item from the sheet, with its stock');
  r = await rico('POST', '/inventory/import', { rows: [{ name: 'Thermostat', onHand: '4' }] });
  ok(r.body.updated === 1 && r.body.counted === 0, 'importing the same numbers again changes nothing');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
