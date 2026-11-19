// price.changed (the owner's Finance plan, 2026-11-20: "item pricing updated → flag affected estimates"): when an
// Inventory item's price, or a price list item's price, changes, automations hear it once, with the item, the old and
// new price, and how many waiting quotes use it. A rename, a cost change or a supplier order coming in doesn't.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/price_changed';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5164, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'PC ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  await ada('PATCH', '/workspace', { tools: { bills: true, projects: true, inventory: true } });
  const ch = (await ada('POST', '/channels', { name: 'prices', memberIds: [] })).body.channels.find((x) => x.name === 'prices');
  const auto = await ada('POST', '/automations', { name: 'Price watch', trigger: { kind: 'price.changed' }, actions: [{ kind: 'post', text: '{item}: {was} → {now} ({quotes} waiting quotes)', channelId: ch.id }] });
  ok(auto.status === 200, 'an automation can start on “A price on the price list changes”');
  const posts = async () => (await ada('GET', '/state')).body.items.filter((i) => i.channelId === ch.id && i.type === 'message').map((i) => i.text);
  const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); } return null; };

  r0; // Test it, before anything happens.
  const test = await ada('POST', '/automations/test', { name: 'x', trigger: { kind: 'price.changed' }, actions: [{ kind: 'post', text: '{item}: {was} → {now}', channelId: ch.id }] });
  ok(test.status === 200 && /Sample item: \$100\.00 → \$110\.00/.test(test.body.steps?.[0]?.said || ''), `Test it uses a made-up price change (${test.body?.steps?.[0]?.said})`);

  // Inventory.
  const roll = (await ada('POST', '/inventory/items', { name: 'Fabric roll', unit: 'roll', cost: '90', price: '120' })).body;
  await ada('PATCH', '/inventory/items/' + roll.id, { name: 'Fabric roll (white)' });
  await ada('PATCH', '/inventory/items/' + roll.id, { cost: '95' });
  await sleep(700);
  ok((await posts()).length === 0, 'a rename or a cost change doesn’t set it off');
  await ada('PATCH', '/inventory/items/' + roll.id, { price: '135' });
  ok(await until(async () => (await posts()).includes('Fabric roll (white): $120.00 → $135.00 (0 waiting quotes)')), 'an Inventory price change does, once, with the old and new price');

  // A price list item on a board, used by a waiting quote.
  const bids = (await ada('POST', '/projects', { template: 'bids', name: 'Estimating' })).body;
  const T = Object.fromEntries(bids.types.map((x) => [x.key, x]));
  const F = (k, key) => T[k].fields.find((f) => f.key === key);
  const add = async (k, values) => (await ada('POST', `/projects/${bids.id}/records`, { typeId: T[k].id, values })).body;
  const film = await add('price_list', { item: 'Ceramic film install', unit: 'window', price: 185 });
  const cl = await add('clients', { name: 'Desert Auto' });
  const q = await add('quotes', { title: 'Showroom tint', client: cl.id, valid_until: '2099-12-31', items: { rows: [{ desc: 'Ceramic film install', qty: 2, price: 185, from: film.id }] } });
  await ada('POST', `/records/${q.id}/share`, { hours: 0 });
  const n0 = (await posts()).length;
  await ada('PATCH', '/records/' + film.id, { values: { [F('price_list', 'unit').id]: 'pane' } });
  await sleep(700);
  ok((await posts()).length === n0, 'changing a price list item’s unit doesn’t');
  await ada('PATCH', '/records/' + film.id, { values: { [F('price_list', 'price').id]: 200 } });
  ok(await until(async () => (await posts()).includes('Ceramic film install: $185.00 → $200.00 (1 waiting quotes)')), 'its price changing does, counting the waiting quote that uses it');

  // A spreadsheet that changes prices: one event per item it changed.
  const n1 = (await posts()).length;
  await ada('POST', '/inventory/import', { rows: [{ name: 'Fabric roll (white)', price: '140' }, { name: 'Brand new thing', price: '5' }] });
  ok(await until(async () => (await posts()).length === n1 + 1 && (await posts()).includes('Fabric roll (white): $135.00 → $140.00 (0 waiting quotes)')), 'an import that changes a price sets it off for that item (a new item isn’t a change)');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
