// Inventory, step 1: items, places, stock at each place, and the ledger. Owners and admins add items and places,
// receive, adjust and count stock, and see costs, prices and value; everyone records what they move, use on a job or
// bring back, and sees what's where. Stock never goes below zero by a move; adjustments say why; a count sets it and
// logs the difference. Low stock shows. An item with history is archived, not lost. Switched off, it's off.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4983, B = `http://127.0.0.1:${PORT}`;
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Stock ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Stock ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  ok(st.workspace.tools.inventory === true, 'Inventory is on for a team');

  // Items and places (owners and admins).
  ok((await mo('POST', '/inventory/items', { name: 'Filter' })).status === 403, 'members can’t add items');
  ok((await rico('POST', '/inventory/items', { name: '' })).status === 400, 'an item needs a name');
  r = await rico('POST', '/inventory/items', { name: '16x25 air filter', sku: 'FLT-1625', category: 'Filters', unit: 'each', cost: '6.50', price: '18', reorderAt: 10, reorderQty: 40, supplier: 'Ferguson', onHand: 24 });
  const filter = r.body;
  ok(r.status === 200 && filter.onHand === 24 && filter.cost === 650 && filter.price === 1800 && filter.value === 15600, `an item with starting stock: 24 on hand, worth $156 (${filter.value})`);
  let inv = (await rico('GET', '/inventory')).body;
  const main = inv.places[0];
  ok(inv.places.length === 1 && main.name === 'Main storage' && filter.stock[main.id] === 24, 'its starting stock went to the team’s first place, Main storage');
  ok((await rico('POST', '/inventory/items', { name: 'Other', sku: 'flt-1625' })).status === 400, 'two items can’t share a SKU');
  ok((await mo('POST', '/inventory/places', { name: 'Truck 2' })).status === 403, 'members can’t add places');
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 2', kind: 'truck' })).body;
  const wire = (await rico('POST', '/inventory/items', { name: 'Thermostat wire', unit: 'ft', cost: '0.40', reorderAt: 50 })).body;

  // What a member sees: no costs.
  inv = (await mo('GET', '/inventory')).body;
  const mf = inv.items.find((x) => x.id === filter.id);
  ok(mf.onHand === 24 && mf.cost === undefined && mf.price === undefined && mf.value === undefined && inv.value === null && inv.canManage === false, 'members see what’s where, but not costs, prices or value');

  // Moves.
  ok((await mo('POST', '/inventory/moves', { kind: 'receive', itemId: filter.id, qty: 5, to: main.id })).status === 403, 'members can’t receive stock');
  r = await rico('POST', '/inventory/moves', { kind: 'receive', itemId: wire.id, qty: 250, to: truck.id, cost: '0.42' });
  ok(r.status === 200 && r.body.qty === 250 && r.body.by === 'Rico Vega', 'receiving 250 ft of wire on Truck 2');
  r = await mo('POST', '/inventory/moves', { kind: 'move', itemId: filter.id, qty: 6, from: main.id, to: truck.id });
  ok(r.status === 200, 'a member moves 6 filters to Truck 2');
  r = await mo('POST', '/inventory/moves', { kind: 'move', itemId: filter.id, qty: 50, from: main.id, to: truck.id });
  ok(r.status === 400 && /Only 18 each at Main storage/.test(r.body.error), `moving more than is there is refused (${r.body.error})`);
  ok((await mo('POST', '/inventory/moves', { kind: 'move', itemId: filter.id, qty: 1, from: main.id, to: main.id })).status === 400, 'moving to the same place is refused');

  // Used on a job (one Mo can see), and for a task.
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: p.types[0].id, values: { job: 'AC tune-up' } })).body;
  const task = (await rico('POST', '/tasks', { text: 'Swap the filters at Oak St' })).body;
  r = await mo('POST', '/inventory/moves', { kind: 'use', itemId: filter.id, qty: 2, from: truck.id, jobId: job.id, taskId: task.id, note: 'Oak St' });
  ok(r.status === 200 && r.body.qty === -2 && r.body.jobId === job.id && r.body.taskId === task.id, 'Mo uses 2 filters from the truck on the job, for the task');
  ok((await mo('POST', '/inventory/moves', { kind: 'use', itemId: filter.id, qty: 1, from: truck.id, jobId: 'nope' })).status === 404, 'a job that isn’t there is refused');
  r = await mo('POST', '/inventory/moves', { kind: 'return', itemId: filter.id, qty: 1, to: truck.id, jobId: job.id });
  ok(r.status === 200 && r.body.qty === 1, 'one comes back from the job');

  // Adjust and count (owners and admins).
  ok((await rico('POST', '/inventory/moves', { kind: 'adjust', itemId: filter.id, qty: -1, from: main.id })).status === 400, 'an adjustment has to say why');
  r = await rico('POST', '/inventory/moves', { kind: 'adjust', itemId: filter.id, qty: -1, from: main.id, note: 'Damaged' });
  ok(r.status === 200 && r.body.qty === -1, 'one damaged, adjusted out');
  r = await rico('POST', '/inventory/moves', { kind: 'count', itemId: filter.id, qty: 15, from: main.id });
  ok(r.status === 200 && r.body.counted === 15 && r.body.qty === -2, 'a count of 15 at Main storage sets it, and logs the difference (−2)');
  const f2 = (await rico('GET', '/inventory/items/' + filter.id)).body;
  ok(f2.item.stock[main.id] === 15 && f2.item.stock[truck.id] === 5 && f2.item.onHand === 20, `on hand: 15 at Main storage, 5 on Truck 2 (${JSON.stringify(f2.item.stock)})`);
  ok(f2.moves.map((y) => y.kind).join() === 'count,adjust,return,use,move,receive', `its history, newest first (${f2.moves.map((y) => y.kind).join()})`);
  ok((await mo('GET', '/inventory/items/' + filter.id)).body.moves.every((y) => y.cost === undefined), 'members don’t see costs in the history either');

  // Low stock.
  await mo('POST', '/inventory/moves', { kind: 'use', itemId: filter.id, qty: 11, from: main.id, jobId: job.id });
  inv = (await rico('GET', '/inventory')).body;
  ok(inv.low.includes(filter.id) && inv.items.find((x) => x.id === filter.id).low === true && !inv.low.includes(wire.id), 'at or under its reorder point (9 left, reorder at 10), it’s low');
  const jobMoves = (await rico('GET', '/inventory/moves?job=' + job.id)).body;
  ok(jobMoves.length === 3 && jobMoves.every((y) => y.jobId === job.id), 'what went to the job is listed for it');

  // Deleting.
  ok((await rico('DELETE', '/inventory/items/' + filter.id)).status === 400, 'an item with stock can’t be deleted');
  await rico('POST', '/inventory/moves', { kind: 'count', itemId: filter.id, qty: 0, from: main.id });
  await rico('POST', '/inventory/moves', { kind: 'count', itemId: filter.id, qty: 0, from: truck.id });
  ok((await rico('DELETE', '/inventory/items/' + filter.id)).status === 200 && !(await rico('GET', '/inventory')).body.items.some((x) => x.id === filter.id), 'counted to 0, it can be deleted');
  ok((await rico('GET', '/inventory/moves?item=' + filter.id)).body.length > 0, 'and its history stays');
  ok((await rico('DELETE', '/inventory/places/' + truck.id)).status === 400, 'a place with stock can’t be deleted');

  // Switched off.
  await rico('PATCH', '/workspace', { tools: { ...(await rico('GET', '/state')).body.workspace.tools, inventory: false } });
  ok((await rico('GET', '/inventory')).status === 403, 'switched off, Inventory is off');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
