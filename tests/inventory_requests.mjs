// Asking for stock (the owner, 2026-11-20: "all users to request inventory, that goes to admin or where admin wants
// maybe an inventory admin channel"): anyone on the team asks for items (in Inventory or not), for a job and a day
// if they like. The people an admin picks (owners and admins by default) hear it, and it can post in a feed the
// admin picks. An admin approves, declines, hands it out (the stock comes off the shelf, logged) or orders it; the
// one who asked hears each. Members see only their own requests; only owners and admins decide.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_requests';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5243, B = `http://127.0.0.1:${PORT}`;
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Req ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => { const x = await call()('POST', '/auth', { mode: 'join', workspace: 'Req ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n }); return call(x.body.token); };
  const mo = await join('Mo Lane', 2), al = await join('Al Kim', 3), cy = await join('Cy Park', 4);
  st = (await rico('GET', '/state')).body;
  const id = (name) => st.workspace.members.find((m) => m.name === name).id;
  await rico('PATCH', `/members/${id('Al Kim')}`, { role: 'admin' });
  const flt = (await rico('POST', '/inventory/items', { name: 'Air filter', unit: 'each', onHand: 20 })).body;
  const main = (await rico('GET', '/inventory')).body.places[0];
  const truck = (await rico('POST', '/inventory/places', { name: 'Mo’s truck', kind: 'truck', memberId: id('Mo Lane') })).body;
  const bells = async (who) => (await who('GET', '/state')).body.notices || [];

  // Asking.
  ok((await mo('POST', '/inventory/requests', { lines: [] })).status === 400, 'a request needs something on it');
  r = await mo('POST', '/inventory/requests', { lines: [{ itemId: flt.id, qty: 6 }, { name: 'Ladder hooks', qty: 4 }], note: 'For the Smith job', needBy: '2026-12-01' });
  const q = r.body;
  ok(r.status === 200 && q.number === 1 && q.status === 'open' && q.by === 'Mo Lane' && q.lines.length === 2 && q.lines[0].name === 'Air filter' && q.lines[1].name === 'Ladder hooks' && !q.lines[1].itemId, `a member asks: 6 filters and something not in Inventory (${JSON.stringify(q).slice(0, 220)})`);
  await sleep(200);
  ok((await bells(rico)).some((n) => /Mo Lane/.test(n.title) && /Air filter/.test(n.text)) && (await bells(al)).some((n) => /Mo Lane/.test(n.title)), 'owners and admins hear it (Rico, and Al the admin)');
  ok(!(await bells(cy)).some((n) => /Mo Lane/.test(n.title)), 'other members don’t');
  ok((await cy('GET', '/inventory')).body.requests.length === 0 && (await mo('GET', '/inventory')).body.requests.length === 1 && (await rico('GET', '/inventory')).body.requests.length === 1, 'members see only their own requests; admins see all');

  // Where they go: the admin picks.
  ok((await mo('PATCH', '/inventory/settings', { requestTo: [id('Mo Lane')] })).status === 403, 'only owners and admins choose where requests go');
  const feed = (await rico('POST', '/channels', { name: 'inventory', memberIds: [id('Al Kim')] })).body.channels.find((c) => c.name === 'inventory');
  r = await rico('PATCH', '/inventory/settings', { requestTo: [id('Al Kim')], requestFeed: feed.id });
  ok(r.status === 200 && r.body.requestTo.join() === id('Al Kim') && r.body.requestFeed === feed.id, 'requests go to Al, and to the #inventory feed');
  ok((await rico('PATCH', '/inventory/settings', { requestFeed: 'nope' })).status === 400, 'a feed that isn’t the team’s is refused');
  r = await cy('POST', '/inventory/requests', { lines: [{ itemId: flt.id, qty: 2 }] });
  const q2 = r.body;
  await sleep(200);
  ok((await bells(al)).some((n) => /Cy Park/.test(n.title)) && !(await bells(rico)).some((n) => /Cy Park/.test(n.title)), 'now only Al hears (Rico doesn’t)');
  const items = (await rico('GET', '/state')).body.items;
  ok(items.some((it) => it.type === 'message' && it.channelId === feed.id && /Cy Park/.test(it.text) && /2 each Air filter/.test(it.text)), 'and it’s posted in #inventory');

  // Deciding.
  ok((await mo('POST', `/inventory/requests/${q.id}/decide`, { status: 'approved' })).status === 403, 'members can’t approve requests');
  r = await al('POST', `/inventory/requests/${q2.id}/decide`, { status: 'declined', note: 'Use the ones on your truck' });
  ok(r.status === 200 && r.body.status === 'declined' && r.body.decidedBy === 'Al Kim' && r.body.decision === 'Use the ones on your truck', 'Al declines Cy’s, saying why');
  await sleep(200);
  ok((await bells(cy)).some((n) => /declined/i.test(n.title) && /Use the ones on your truck/.test(n.text)), 'Cy hears it, with why');
  ok((await al('POST', `/inventory/requests/${q2.id}/decide`, { status: 'approved' })).status === 400, 'a decided request can’t be decided again');
  r = await rico('POST', `/inventory/requests/${q.id}/decide`, { status: 'approved' });
  ok(r.status === 200 && r.body.status === 'approved', 'Rico approves Mo’s');
  // Handing it out: onto Mo's truck. Only what's in Inventory moves; the rest is noted.
  r = await rico('POST', `/inventory/requests/${q.id}/fulfill`, { placeId: main.id, to: truck.id });
  ok(r.status === 200 && r.body.status === 'handed' && r.body.moves.length === 1, `handed out (${JSON.stringify(r.body).slice(0, 160)})`);
  const inv = (await rico('GET', '/inventory')).body;
  const f2 = inv.items.find((x) => x.id === flt.id);
  ok(f2.stock[main.id] === 14 && f2.stock[truck.id] === 6, '6 filters moved from Main storage onto Mo’s truck');
  const hist = (await rico('GET', '/inventory/items/' + flt.id)).body.moves;
  ok(/Request 1/.test(hist[0].note) && /Mo Lane/.test(hist[0].note), 'the move says which request and for whom');
  await sleep(200);
ok((await bells(mo)).some((n) => /approved/i.test(n.title)) && (await bells(mo)).some((n) => /Your stock is on Mo’s truck/.test(n.title)), 'Mo hears it’s approved, then that it’s handed out');
  ok((await rico('POST', `/inventory/requests/${q.id}/fulfill`, { placeId: main.id })).status === 400, 'it can’t be handed out twice');
  // Cancelling your own.
  const q3 = (await mo('POST', '/inventory/requests', { lines: [{ name: 'Caulk', qty: 1 }] })).body;
  ok((await cy('POST', `/inventory/requests/${q3.id}/cancel`, {})).status === 404, 'someone else’s request isn’t theirs to cancel (not found)');
  r = await mo('POST', `/inventory/requests/${q3.id}/cancel`, {});
  ok(r.status === 200 && r.body.status === 'cancelled', 'Mo cancels his own');

  // Another team can't see or touch them.
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Else ' + t, name: 'Zed', email: `zed${t}@t.test`, password: 'longenough9', device: 'Mac', deviceId: 'd9' });
  const zed = call(r.body.token);
  ok((await zed('POST', `/inventory/requests/${q.id}/decide`, { status: 'approved' })).status === 404 && !(await zed('GET', '/inventory')).body.requests.length, 'another team’s requests are not found');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
