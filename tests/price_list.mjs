// Finance, step 3 (the owner, 2026-11-20): one price list. Every job's price lines pick from the team's price list
// items (any board) and Inventory's items, in one list. A line keeps the price it was given (history stays right); a
// waiting quote whose source price changed since is flagged. Costs are for owners and admins.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/price_list';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5156, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-time-zone': 'UTC', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Prices ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const cy = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Prices ' + t, code, name: 'Cy', email: `cy${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' })).body.token);
  await ada('PATCH', '/workspace', { tools: { bills: true, projects: true, inventory: true } });
  const bids = (await ada('POST', '/projects', { template: 'bids', name: 'Estimating' })).body;
  const T = Object.fromEntries(bids.types.map((x) => [x.key, x]));
  const F = (k, key) => T[k].fields.find((f) => f.key === key);
  const add = async (k, values) => (await ada('POST', `/projects/${bids.id}/records`, { typeId: T[k].id, values })).body;
  const film = await add('price_list', { item: 'Ceramic film install', unit: 'window', price: 185, cost: 70 });
  const roll = (await ada('POST', '/inventory/items', { name: 'Fabric roll', unit: 'roll', cost: '90', price: '120', sku: 'FR-1' })).body;

  // One list.
  let r = await ada('GET', '/price-list');
  const fi = r.body.items.find((x) => x.id === film.id), ri = r.body.items.find((x) => x.id === 'inv:' + roll.id);
  ok(r.status === 200 && fi && fi.source === 'list' && fi.price === 18500 && fi.cost === 7000, 'the price list has the board’s item, with price and cost');
  ok(ri && ri.source === 'inventory' && ri.price === 12000 && ri.cost === 9000 && ri.unit === 'roll', 'and Inventory’s items, in the same list');
  r = await cy('GET', '/price-list');
  ok(r.status === 200 && r.body.items.some((x) => x.id === 'inv:' + roll.id) && r.body.items.every((x) => x.cost === undefined), 'a member gets the prices, not what things cost the business');

  // A job on another board can price from both.
  const tr = (await ada('POST', '/projects', { template: 'trades', trades: ['blinds'] })).body;
  const bl = tr.types.find((x) => x.key === 'trade_blinds');
  const itemsF = bl.fields.find((f) => f.type === 'items');
  ok(!!itemsF, '(setup) blinds jobs have price lines');
  const job = (await ada('POST', `/projects/${tr.id}/records`, { typeId: bl.id, values: { job: 'Smith shades' } })).body;
  r = await ada('PATCH', '/records/' + job.id, { values: { [itemsF.id]: { rows: [{ desc: 'Fabric roll', qty: 2, price: 120, cost: 90, from: 'inv:' + roll.id }, { desc: 'Ceramic film install', qty: 1, price: 185, from: film.id }, { desc: 'Stranger', qty: 1, price: 5, from: 'inv:nope' }] } } });
  const rows = r.body?.values?.[itemsF.id]?.rows || [];
  ok(rows[0]?.from === 'inv:' + roll.id && rows[1]?.from === film.id && !rows[2]?.from, 'a job’s lines keep where they came from (an Inventory item, another board’s price list), and drop a source that isn’t the team’s');

  // A sent quote whose price list price changes is flagged; the quote keeps its price.
  const cl = await add('clients', { name: 'Desert Auto' });
  const q = await add('quotes', { title: 'Showroom tint', client: cl.id, valid_until: '2099-12-31', items: { rows: [{ desc: 'Ceramic film install', qty: 2, price: 185, from: film.id }] } });
  await ada('POST', `/records/${q.id}/share`, { hours: 0 });
  r = await ada('GET', '/quotes');
  ok(r.body.quotes[0]?.changed?.length === 0, 'sent at today’s price: nothing changed');
  await ada('PATCH', '/records/' + film.id, { values: { [F('price_list', 'price').id]: 200 } });
  r = await ada('GET', '/quotes');
  const ch = r.body.quotes.find((x) => x.recordId === q.id)?.changed || [];
  ok(ch.length === 1 && ch[0].was === 18500 && ch[0].now === 20000, `the price list went to $200: the waiting quote is flagged ($185 → $200) (${JSON.stringify(ch)})`);
  const qNow = (await ada('GET', `/projects/${bids.id}/records`)).body.find((x) => x.id === q.id);
  ok(qNow.values[F('quotes', 'items').id].rows[0].price === 18500, 'and still says $185: what was quoted doesn’t change by itself');

  // Another team's list is its own.
  const other = call((await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Zed', email: `zed${t}@t.test`, password: 'longenough4', device: 'Mac', deviceId: 'd4' })).body.token);
  ok(!(await other('GET', '/price-list')).body.items.some((x) => x.id === film.id || x.id === 'inv:' + roll.id), 'another team sees none of it');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
