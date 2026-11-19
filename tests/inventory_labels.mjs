// Inventory round 2, step 1 (the owner, 2026-11-19: "items should be able to generate printable qr codes for each
// individual item. and location should be able to generate qr code"): every item and every place can have a QR
// label, the same tag each time, opening /a/<tag> like equipment labels. Scanning one says what it is: a unit, an
// item or a place. Anyone on the team can print them; another team's labels are not found.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_labels';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5232, B = `http://127.0.0.1:${PORT}`;
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Labels ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Labels ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  const flt = (await rico('POST', '/inventory/items', { name: 'Air filter', sku: 'FLT-1', onHand: 10 })).body;
  const fit = (await rico('POST', '/inventory/items', { name: 'Copper fitting', onHand: 30 })).body;
  const pw = (await rico('POST', '/inventory/items', { name: 'Pressure washer', track: 'units', onHand: 1 })).body;
  const main = (await rico('GET', '/inventory')).body.places[0];
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 3', kind: 'truck' })).body;

  r = await mo('GET', `/inventory/labels?items=${flt.id},${fit.id}&places=${main.id},${truck.id}`);
  ok(r.status === 200 && r.body.labels?.length === 4, `anyone on the team gets labels: 2 items and 2 places (${r.status} ${r.body?.labels?.length})`);
  const L = r.body.labels || [];
  const lf = L.find((l) => l.kind === 'item' && l.id === flt.id), lt = L.find((l) => l.kind === 'place' && l.id === truck.id);
  ok(lf && /^[A-Za-z0-9]{10}$/.test(lf.tag) && lf.url === `${B}/a/${lf.tag}` && lf.qr?.startsWith('data:image/svg+xml;base64,') && lf.name === 'Air filter' && lf.number === 'FLT-1', 'an item’s label: its tag, its address, its QR code, its name and SKU');
  ok(lt && lt.name === 'Truck 3' && /truck/i.test(lt.number || ''), 'a place’s label: its name and what kind of place');
  ok(new Set(L.map((l) => l.tag)).size === 4, 'every label is different');
  r = await rico('GET', `/inventory/labels?items=${flt.id}&places=${truck.id}`);
  ok(r.body.labels.find((l) => l.id === flt.id).tag === lf.tag && r.body.labels.find((l) => l.id === truck.id).tag === lt.tag, 'printing again gives the same labels (stickers already on the shelf keep working)');
  r = await rico('GET', `/inventory/labels?items=${pw.id}`);
  ok(r.status === 200 && r.body.labels.length === 1 && r.body.labels[0].kind === 'item', 'an item tracked one by one can have a label for its shelf too (each unit keeps its own)');
  ok((await rico('GET', '/inventory/labels')).status === 400, 'it needs something to label');
  const inv = (await rico('GET', '/inventory')).body;
  ok(inv.items.find((x) => x.id === flt.id).tag === lf.tag && inv.places.find((p) => p.id === truck.id).tag === lt.tag, 'the item and place carry their tag');

  // Scanning.
  r = await mo('POST', '/inventory/scan/' + lf.tag);
  ok(r.status === 200 && r.body.kind === 'item' && r.body.itemId === flt.id, 'scanning an item’s label: that item');
  r = await mo('POST', '/inventory/scan/' + lt.tag);
  ok(r.status === 200 && r.body.kind === 'place' && r.body.placeId === truck.id, 'scanning a place’s label: that place');
  const ul = (await rico('GET', `/inventory/items/${pw.id}/labels`)).body.labels[0];
  r = await mo('POST', '/inventory/scan/' + ul.tag);
  ok(r.status === 200 && r.body.kind === 'unit' && r.body.unitId === ul.id && r.body.itemId === pw.id, 'a unit’s label still opens that unit');
  const res = await fetch(`${B}/a/${lf.tag}`, { redirect: 'manual' });
  ok(res.status === 302 && res.headers.get('location') === `/?go=asset:${lf.tag}`, 'the label’s address opens Kloomie on it');

  // Another team.
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Else ' + t, name: 'Zed', email: `zed${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const zed = call(r.body.token);
  ok((await zed('POST', '/inventory/scan/' + lf.tag)).status === 404 && (await zed('POST', '/inventory/scan/' + lt.tag)).status === 404, 'another team’s labels are not found');
  r = await zed('GET', `/inventory/labels?items=${flt.id}&places=${truck.id}`);
  ok(r.status === 200 && r.body.labels.length === 0 || r.status === 404, 'and another team can’t print them');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
