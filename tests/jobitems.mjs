// Job Flows Phase 2 (docs/jobflows/PHASE2.md §1.1, §2.1, §4): the business's Items. Owners and admins only on every
// route; import from a board's price list is a one-time snapshot (twice adds once, a changed source isn't re-copied,
// rows with no name are counted); price.changed fires only when a price changes, with the waiting quotes that use the
// item; /api/price-list lists Items first for owners and admins and none for members; no Jobs read gives a member an
// item's price; kept across a restart; another team sees nothing.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobitems';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5251, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test' };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return true; } catch {} await sleep(150); }
  return false;
};
const stop = async () => { srv.kill(); await new Promise((r) => srv.once('exit', r)); };
if (!(await start())) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Items ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  let rico = call(ricoTok);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Items ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samTok = r.body.token;
  let sam = call(samTok);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r.body.token);
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true } });

  // 1. Making, changing, archiving. Owners and admins only.
  r = await rico('POST', '/job-items', { name: 'Can clean', description: 'Per can, inside and out', unit: 'each', price: 2500, cost: 400 });
  ok(r.status === 200 && r.body?.item?.id && r.body.item.price === 2500 && r.body.item.cost === 400 && r.body.item.taxable === true && r.body.item.archived === false, 'an owner adds an item (price and cost in cents, taxable by default): ' + r.status + ' ' + (r.body?.error || ''));
  const can = r.body?.item;
  r = await rico('POST', '/job-items', { name: 'Trip fee', unit: 'each', price: 1500, taxable: false });
  const trip = r.body?.item;
  ok(trip?.taxable === false && trip?.cost === null, 'an item can be untaxed, and cost is optional (null)');
  for (const [body, why] of [[{ price: 100 }, 'no name'], [{ name: 'x'.repeat(121), price: 1 }, 'a name over 120'], [{ name: 'Neg', price: -1 }, 'a negative price'], [{ name: 'Big', price: 2e10 }, 'a price over the limit'], [{ name: 'Frac', price: 10.5 }, 'a price that isn’t whole cents'], [{ name: 'U', unit: 'u'.repeat(21), price: 1 }, 'a unit over 20']]) {
    ok((await rico('POST', '/job-items', body)).status === 400, 'refused: ' + why);
  }
  r = await rico('POST', '/job-items', { name: 'Inv link', price: 1, invItemId: 'not-ours' });
  ok(r.status === 400, 'an Inventory link must be an item of this team');
  for (const [m, p, body] of [['GET', '/job-items'], ['POST', '/job-items', { name: 'Sneaky', price: 1 }], ['PATCH', '/job-items/' + can?.id, { price: 1 }], ['POST', `/job-items/${can?.id}/archive`], ['POST', `/job-items/${can?.id}/restore`], ['POST', '/job-items/import', { projectId: 'x' }]]) {
    r = await sam(m, p, body);
    ok(r.status === 403, `a member gets 403 on ${m} ${p.replace(can?.id, ':id')}: ${r.status}`);
  }
  ok((await olga('GET', '/job-items')).body?.items?.length === 0 && (await olga('PATCH', '/job-items/' + can?.id, { price: 1 })).status === 404, 'another team sees none of them and can’t change one (404)');
  r = await rico('PATCH', '/job-items/' + can?.id, { description: 'Inside, outside and the lid' });
  ok(r.status === 200 && r.body?.item?.description === 'Inside, outside and the lid' && r.body.item.price === 2500, 'PATCH changes only what it names');
  ok((await rico('PATCH', '/job-items/' + can?.id, { price: -5 })).status === 400 && ((await rico('GET', '/job-items')).body?.items || []).find((x) => x.id === can?.id)?.price === 2500, 'a bad PATCH changes nothing');
  r = await rico('POST', `/job-items/${trip?.id}/archive`);
  ok(r.status === 200 && r.body?.item?.archived === true, 'archive');
  ok(((await rico('GET', '/job-items')).body?.items || []).some((x) => x.id === trip?.id && x.archived), 'archived items are still listed for admins (marked)');
  ok((await rico('DELETE', '/job-items/' + trip?.id)).status >= 400, 'there is no hard delete');
  r = await rico('POST', `/job-items/${trip?.id}/restore`);
  ok(r.body?.item?.archived === false, 'restore');

  // 2. /api/price-list: Items first for owners and admins (with cost), none for members.
  const board = (await rico('POST', '/projects', { template: 'bids', name: 'Estimating' })).body;
  const plT = board.types.find((x) => x.key === 'price_list');
  const plF = (k) => plT.fields.find((f) => f.key === k)?.key;
  await rico('POST', `/projects/${board.id}/records`, { typeId: plT.id, values: { [plF('item') || 'item']: 'Window film', [plF('price')]: 12, [plF('cost')]: 3, [plF('unit')]: 'sq ft' } });
  const pl = (await rico('GET', '/price-list')).body?.items || [];
  ok(pl[0]?.id === 'item:' + can?.id && pl[0]?.source === 'items' && pl[0]?.board === 'Items' && pl[0]?.cost === 400, 'the owner’s price list starts with the business Items, as item:<id>, with cost: ' + JSON.stringify(pl[0]));
  ok(pl.some((x) => x.source === 'list' && x.name === 'Window film'), 'and the board price list is still there after them');
  const spl = (await sam('GET', '/price-list')).body?.items || [];
  ok(!spl.some((x) => x.source === 'items' || String(x.id).startsWith('item:')), 'a member’s price list has no Items');

  // 3. Import from a board's price list: a one-time snapshot.
  const pl2 = (await rico('POST', `/projects/${board.id}/records`, { typeId: plT.id, values: { [plF('price')]: 5 } })).body; // no name
  const mk = await rico('POST', `/projects/${board.id}/records`, { typeId: plT.id, values: { [plF('item') || 'item']: 'Bad price', [plF('price')]: null } });
  r = await rico('POST', '/job-items/import', { projectId: board.id });
  ok(r.status === 200 && r.body?.added === 2 && r.body?.noName === 1, 'import copies the named rows and counts the one with no name: ' + JSON.stringify(r.body));
  let items = ((await rico('GET', '/job-items')).body?.items || []);
  const film = items.find((x) => x.name === 'Window film');
  ok(film?.price === 1200 && film?.cost === 300 && film?.unit === 'sq ft' && film?.taxable === true && !!film?.fromRecordId, 'the copy keeps name, price, cost and unit, taxable by default, and remembers where it came from');
  ok(items.find((x) => x.name === 'Bad price')?.price === 0, 'a missing price imports as $0');
  const filmRec = (await rico('GET', `/projects/${board.id}/records`)).body.find((x) => x.values[plT.primary] === 'Window film' || Object.values(x.values).includes('Window film'));
  await rico('PATCH', '/records/' + filmRec?.id, { values: { [plF('price')]: 99 } });
  r = await rico('POST', '/job-items/import', { projectId: board.id });
  items = ((await rico('GET', '/job-items')).body?.items || []);
  ok(r.body?.added === 0 && items.filter((x) => x.name === 'Window film').length === 1 && items.find((x) => x.name === 'Window film').price === 1200, 'importing again adds nothing, and a source changed since isn’t re-copied (a snapshot, not a sync): ' + JSON.stringify(r.body));
  const priv = (await rico('POST', '/projects', { template: 'bids', name: 'Hidden', private: true })).body;
  const st2 = (await rico('GET', '/state')).body;
  const samId = st2.workspace.members.find((m) => m.name === 'Sam Reed').id;
  await rico('PATCH', '/members/' + samId, { role: 'admin' });
  r = await sam('POST', '/job-items/import', { projectId: priv.id });
  ok(r.status === 404, 'an admin can’t import from a board they can’t see (404): ' + r.status);
  ok((await sam('GET', '/job-items')).status === 200, 'an admin reads Items');
  await rico('PATCH', '/members/' + samId, { role: 'member' });
  ok((await olga('POST', '/job-items/import', { projectId: board.id })).status === 404, 'another team can’t import our board');

  // 4. price.changed: only on a real price change, with how many waiting quotes use the item.
  const ch = (await rico('POST', '/channels', { name: 'prices', memberIds: [] })).body.channels.find((x) => x.name === 'prices');
  await rico('POST', '/automations', { name: 'Price watch', trigger: { kind: 'price.changed' }, actions: [{ kind: 'post', text: 'PRICE {item}: {was} → {now} ({quotes})', channelId: ch.id }] });
  const posts = async () => (await rico('GET', '/state')).body.items.filter((i) => i.channelId === ch.id && i.type === 'message').map((i) => i.text);
  // A waiting quote with a line from the item (a Bids & Quotes quote, sent, not answered). The records API takes
  // dollars and keeps cents.
  const qT = board.types.find((x) => x.key === 'quotes');
  const q = (await rico('POST', `/projects/${board.id}/records`, { typeId: qT.id, values: { title: 'Cans', valid_until: '2099-12-31', items: { rows: [{ desc: 'Can clean', qty: 3, price: 25, from: 'item:' + can?.id }] } } })).body;
  await rico('POST', `/records/${q.id}/share`, { hours: 0 });
  for (const body of [{ description: 'New words' }, { unit: 'can' }, { cost: 500 }, { taxable: false }, { name: 'Can clean' }]) await rico('PATCH', '/job-items/' + can?.id, body);
  await rico('POST', `/job-items/${can?.id}/archive`);
  await rico('POST', `/job-items/${can?.id}/restore`);
  await rico('PATCH', '/job-items/' + can?.id, { price: 2500 }); // the same price
  await sleep(800);
  ok((await posts()).length === 0, 'description, unit, cost, taxable, name, archive and the same price fire nothing: ' + JSON.stringify(await posts()));
  await rico('PATCH', '/job-items/' + can?.id, { price: 2800 });
  ok(await until(async () => (await posts()).some((s) => s === 'PRICE Can clean: $25.00 → $28.00 (1)')), 'a price change fires price.changed with the one waiting quote: ' + JSON.stringify(await posts()));
  const fq = (await rico('GET', '/quotes')).body?.quotes?.find((x) => x.recordId === q.id);
  ok(fq?.changed?.length === 1 && fq.changed[0].was === 2500 && fq.changed[0].now === 2800, 'Finance → Quotes flags the waiting quote whose item price changed (priceNow reads item:<id>)');

  // 5. No Jobs read gives a member an item's price.
  const jl = (await sam('GET', '/jobs')).body;
  ok(!JSON.stringify(jl).includes('"price"') && !JSON.stringify(jl).includes('2800'), 'the member’s Jobs list carries no item price');

  // 6. Kept across a restart.
  await stop();
  ok(await start(), 'the server starts again');
  rico = call(ricoTok); sam = call(samTok);
  items = (await rico('GET', '/job-items')).body?.items || [];
  ok(items.find((x) => x.id === can?.id)?.price === 2800 && items.length === 4, 'Items are kept across a restart: ' + items.length);
  void pl2; void mk;
} catch (e) {
  console.log('FAIL threw: ' + (e.stack || e.message));
  fails++;
} finally {
  srv.kill();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
