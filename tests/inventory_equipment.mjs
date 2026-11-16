// Inventory, step 2: equipment tracked one by one. Each unit has a serial, a QR label, a status and where it is;
// it's checked out (to someone, a job) and brought back, moved, scanned where it is, reported for repair and fixed;
// owners and admins mark it lost or retired. Its combo is sealed: shown on request, every look logged, never in the
// log itself. The item's count at each place comes from its units. "Move into Inventory" brings an Equipment & assets
// project over, labels and combos included, so the stickers on the gear keep working.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_equipment';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4986, B = `http://127.0.0.1:${PORT}`;
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Gear ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Gear ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Zed', email: `zed${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const zed = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  const moId = st.workspace.members.find((m) => m.name === 'Mo Lane').id;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });

  // An item tracked one by one, with 3 to start.
  r = await rico('POST', '/inventory/items', { name: 'Pressure washer', track: 'units', cost: '400', onHand: 3 });
  const pw = r.body;
  ok(r.status === 200 && pw.track === 'units' && pw.onHand === 3 && pw.units.available === 3 && pw.value === 120000, 'an item tracked one by one: 3 pressure washers, all available, worth $1,200');
  let it = (await rico('GET', '/inventory/items/' + pw.id)).body;
  const [u1, u2, u3] = it.units;
  ok(it.units.length === 3 && it.units.every((u) => /^[A-Za-z0-9]{10}$/.test(u.tag) && u.url.endsWith('/a/' + u.tag) && u.status === 'available') && u1.name === 'Pressure washer 1', 'each has its own label and is available');
  const main = (await rico('GET', '/inventory')).body.places[0];
  ok(pw.stock[main.id] === 3, 'its count at Main storage comes from its units');
  ok((await rico('POST', '/inventory/moves', { kind: 'receive', itemId: pw.id, qty: 1, to: main.id })).status === 400, 'counted moves aren’t for one-by-one items');
  ok((await mo('POST', `/inventory/items/${pw.id}/units`, { name: 'x' })).status === 403, 'members can’t add equipment');
  r = await rico('POST', `/inventory/items/${pw.id}/units`, { name: 'PW-4', serial: 'SN-4004', combo: '4-1-7-1' });
  const u4 = r.body;
  ok(r.status === 200 && u4.serial === 'SN-4004' && u4.hasCombo === true && !JSON.stringify(u4).includes('4-1-7-1'), 'adding one with a serial and a combo (the combo never comes back with it)');

  // Out and back.
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: p.types[0].id, values: { job: 'Deck wash' } })).body;
  r = await mo('POST', `/inventory/units/${u1.id}/act`, { act: 'checkout', jobId: job.id });
  ok(r.status === 200 && r.body.unit.status === 'out' && r.body.unit.memberId === moId && r.body.unit.jobId === job.id && r.body.unit.placeId === null, 'Mo checks one out, for the deck wash job');
  ok((await mo('POST', `/inventory/units/${u1.id}/act`, { act: 'checkout' })).status === 400, 'it can’t go out twice');
  it = (await rico('GET', '/inventory/items/' + pw.id)).body;
  ok(it.item.onHand === 3 && it.item.units.out === 1 && it.item.stock[main.id] === 3, '3 available (one is out), 4 in all');
  r = await mo('POST', `/inventory/units/${u1.id}/act`, { act: 'here', lat: 36.1699, lng: -115.1398, address: '10 Oak St, Las Vegas' });
  ok(r.status === 200 && r.body.unit.location.address === '10 Oak St, Las Vegas', 'scanned on site: where it is now');
  r = await mo('POST', `/inventory/units/${u1.id}/act`, { act: 'repair', note: 'Pump leaking' });
  ok(r.status === 200 && r.body.unit.status === 'repair', 'a problem reported: in repair');
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 2', kind: 'truck' })).body;
  r = await mo('POST', `/inventory/units/${u1.id}/act`, { act: 'return', placeId: truck.id });
  ok(r.status === 200 && r.body.unit.status === 'available' && r.body.unit.placeId === truck.id && r.body.unit.jobId === null, 'brought back to Truck 2');
  await mo('POST', `/inventory/units/${u1.id}/act`, { act: 'repair' });
  r = await mo('POST', `/inventory/units/${u1.id}/act`, { act: 'fixed' });
  ok(r.body.unit.status === 'available', 'fixed: available again');
  r = await mo('POST', `/inventory/units/${u2.id}/act`, { act: 'move', placeId: truck.id });
  ok(r.body.unit.placeId === truck.id, 'moved to the truck');
  ok((await mo('POST', `/inventory/units/${u3.id}/act`, { act: 'lost' })).status === 403, 'members can’t mark it lost');
  await rico('POST', `/inventory/units/${u3.id}/act`, { act: 'lost', note: 'Left at a site' });
  it = (await rico('GET', '/inventory/items/' + pw.id)).body;
  ok(it.item.onHand === 3 && it.item.units.lost === 1 && it.item.value === 120000 && it.item.stock[truck.id] === 2 && it.item.stock[main.id] === 1, 'lost: not counted or valued; 2 on the truck, 1 at Main storage');
  const hist = (await rico('GET', '/inventory/units/' + u1.id)).body.moves.map((y) => y.kind).join();
  ok(hist === 'fixed,repair,return,repair,here,checkout,add', `the unit’s history (${hist})`);

  // The combo: shown on request, logged, never in the log.
  r = await mo('POST', `/inventory/units/${u4.id}/reveal`);
  ok(r.status === 200 && r.body.value === '4-1-7-1', 'anyone on the team can see the combo when they ask');
  const u4h = (await mo('GET', '/inventory/units/' + u4.id)).body;
  ok(u4h.moves[0].kind === 'reveal' && u4h.moves[0].by === 'Mo Lane' && !JSON.stringify(u4h).includes('4-1-7-1'), 'and the look is logged (who and when), without the combo');

  // Labels and scans.
  const labels = (await rico('GET', `/inventory/items/${pw.id}/labels`)).body.labels;
  ok(labels.length === 3 && labels.every((l) => l.qr.startsWith('data:image/svg+xml;base64,') && l.url.endsWith('/a/' + l.tag)), 'labels to print: a QR code for each one still in use');
  r = await mo('POST', `/inventory/scan/${u2.tag}`);
  ok(r.status === 200 && r.body.unitId === u2.id, 'a scan opens the unit');
  ok((await rico('GET', '/inventory/units/' + u2.id)).body.unit.seenBy === 'Mo Lane', 'and marks it seen, by whom');
  ok((await zed('POST', `/inventory/scan/${u2.tag}`)).status === 404 && (await mo('POST', '/inventory/scan/AAAAAAAAAA')).status === 404, 'another team’s scan, or a made-up label: not found');
  ok((await rico('DELETE', '/inventory/items/' + pw.id)).status === 400, 'an item with equipment still in use can’t be deleted');

  // Move into Inventory: an Equipment & assets project.
  const ap = (await rico('POST', '/projects', { template: 'assets' })).body;
  const at = ap.types[0];
  const fk = (k) => at.fields.find((f) => f.key === k);
  const ch = (k, l) => fk(k).choices.find((c) => c.label === l).id;
  const tower = (await rico('POST', `/projects/${ap.id}/records`, { typeId: at.id, values: { name: 'Tower 7', [fk('kind').id]: ch('kind', 'Camera tower'), [fk('status').id]: ch('status', 'Deployed'), [fk('serial').id]: 'CT-0007', [fk('job').id]: job.id, [fk('holder').id]: moId, [fk('location').id]: { address: 'Henderson yard', lat: 36.03, lng: -114.98 }, [fk('combo').id]: '9-9-2' } })).body;
  await rico('POST', `/projects/${ap.id}/records`, { typeId: at.id, values: { name: 'Tower 8', [fk('kind').id]: ch('kind', 'Camera tower'), [fk('status').id]: ch('status', 'At the yard') } });
  await rico('POST', `/projects/${ap.id}/records`, { typeId: at.id, values: { name: 'Gen 1', [fk('kind').id]: ch('kind', 'Generator'), [fk('status').id]: ch('status', 'In repair') } });
  const oldTag = (await rico('POST', `/records/${tower.id}/tag`)).body.tag;
  ok(/^[A-Za-z0-9]{10}$/.test(oldTag), '(setup) Tower 7 has a label from before');
  ok((await mo('POST', `/inventory/import-project/${ap.id}`)).status === 403, 'members can’t bring a project in');
  r = await rico('POST', `/inventory/import-project/${ap.id}`);
  ok(r.status === 200 && r.body.made === 3 && r.body.items === 2, `Move into Inventory: 3 units, 2 items (camera towers, generators) (${JSON.stringify(r.body)})`);
  const inv = (await rico('GET', '/inventory')).body;
  const towers = inv.items.find((x) => x.name === 'Camera tower');
  ok(towers?.track === 'units' && towers.units.out === 1 && towers.units.available === 1 && inv.items.find((x) => x.name === 'Generator').units.repair === 1, 'statuses came over: one tower out, one available, the generator in repair');
  const tu = (await rico('GET', '/inventory/items/' + towers.id)).body.units.find((u) => u.name === 'Tower 7');
  ok(tu.serial === 'CT-0007' && tu.jobId === job.id && tu.memberId === moId && tu.location.address === 'Henderson yard' && tu.hasCombo && tu.tag === oldTag, 'Tower 7 kept its serial, job, who has it, where it was, its combo and its label');
  ok((await mo('POST', `/inventory/scan/${oldTag}`)).body.unitId === tu.id, 'the sticker already on it now opens it in Inventory');
  ok((await mo('POST', `/inventory/units/${tu.id}/reveal`)).body.value === '9-9-2', 'its combo still opens (sealed the same way)');
  ok((await rico('POST', `/inventory/import-project/${ap.id}`)).body.skipped === 3, 'bringing it in again skips what’s already here');
  ok((await zed('POST', `/inventory/import-project/${ap.id}`)).status === 404, 'another team can’t bring it in');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
