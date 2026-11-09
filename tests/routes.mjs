// Routes: a person's job visits for a day, in order on the road, with the driving, what's too tight to make, and a
// better order that keeps promised times; nothing without a maps key; only admins see other people's routes.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/routes';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4773, B = `http://127.0.0.1:${PORT}`, M_PORT = 4771;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// A stand-in for Mapbox: every place is on one straight road, x km from the shop; driving takes 2 minutes a km.
const KM = { 'shop': 0, 'a st': 10, 'b st': 20, 'c st': 30 };
const lngOf = (q) => { const k = Object.keys(KM).find((x) => q.toLowerCase().includes(x)); return k == null ? null : KM[k] / 100; };
const at = (s) => s.split(';').map((p) => Number(p.split(',')[0]) * 100);
let calls = { geo: 0, matrix: 0, dir: 0 };
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.searchParams.get('access_token') !== 'tok') { res.writeHead(401); return res.end('{"message":"bad token"}'); }
  if (u.pathname === '/search/geocode/v6/forward') {
    calls.geo++;
    const x = lngOf(u.searchParams.get('q'));
    return res.end(JSON.stringify({ features: x == null ? [] : [{ geometry: { coordinates: [x, 33.4] } }] }));
  }
  if (u.pathname.startsWith('/directions-matrix/v1/mapbox/driving/')) {
    calls.matrix++;
    const xs = at(decodeURIComponent(u.pathname.split('/').pop()));
    return res.end(JSON.stringify({ durations: xs.map((a) => xs.map((b) => Math.abs(a - b) * 120)), distances: xs.map((a) => xs.map((b) => Math.abs(a - b) * 1000)) }));
  }
  if (u.pathname.startsWith('/directions/v5/mapbox/driving/')) {
    calls.dir++;
    const xs = at(decodeURIComponent(u.pathname.split('/').pop()));
    return res.end(JSON.stringify({ routes: [{ geometry: { coordinates: xs.map((x) => [x / 100, 33.4]) }, legs: xs.slice(1).map((x, i) => ({ duration: Math.abs(x - xs[i]) * 120, distance: Math.abs(x - xs[i]) * 1000 })) }] }));
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => fake.listen(M_PORT, '127.0.0.1', r));
let srv;
const start = async (env) => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', MAPBOX_API: `http://127.0.0.1:${M_PORT}`, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const day = new Date(Date.now() + 2 * 864e5).toLocaleDateString('en-CA');
try {
  await start({ MAPBOX_TOKEN: '' });
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'R ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'R ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  const ids = (await jo('GET', '/state')).body.workspace.members;
  const samId = ids.find((x) => x.name === 'Sam').id;
  r = await jo('GET', '/route?date=' + day);
  ok(r.status === 200 && r.body.configured === false, 'without a maps key, routes say they aren’t set up');

  await srv.kill(); await srv.exited;
  await start({ MAPBOX_TOKEN: 'tok' });
  // Three jobs along the road, and where the day starts.
  ok((await sam('PATCH', '/workspace', { base: '1 Shop Way' })).status === 403, 'only admins say where routes start');
  r = await jo('PATCH', '/workspace', { base: '1 Shop Way' });
  ok(r.body.settings.base === '1 Shop Way', 'where routes start: the shop');
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const job = async (name, address) => (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: name, address } })).body;
  const ja = await job('Job A', '10 A St'), jb = await job('Job B', '20 B St'), jc = await job('Job C', '30 C St'), jx = await job('Job X', 'nowhere');
  const visit = (j, start, flex, who = [samId]) => jo('POST', `/records/${j.id}/visits`, { kind: 'Service', date: day, start, end: start + 60, memberIds: who, flex });
  const vc = (await visit(jc, 540, false)).body; // 9:00, promised
  const va = (await visit(ja, 660, true)).body; // 11:00, any time
  const vb = (await visit(jb, 780, true)).body; // 1:00, any time
  await visit(jx, 900, false);
  ok(va.flex === true && vc.flex === false, 'a visit can be at a promised time or any time that day');

  r = await jo('GET', `/route?date=${day}&member=${samId}`);
  const rt = r.body;
  ok(r.status === 200 && rt.configured && rt.stops.map((x) => x.id).join() === [vc.id, va.id, vb.id].join(), 'Sam’s stops in the day’s order: ' + rt.stops?.map((x) => x.label).join(' → '));
  ok(rt.base?.address === '1 Shop Way' && rt.legs.length === 4 && rt.drive === 60 + 40 + 20 + 40 && rt.meters === 80000, `the driving: from the shop and back, ${rt.drive} minutes, ${rt.meters / 1000} km`);
  ok(rt.missing.length === 1 && /Couldn’t find/.test(rt.missing[0].why), 'a job whose address can’t be found is listed, not dropped silently');
  ok(rt.line.length >= 2 && rt.stops[0].lat === 33.4, 'the road to draw, and each stop’s place');
  ok(rt.better && rt.better.order.join() === [vc.id, vb.id, va.id].join() && rt.better.saves === 20, `a better order keeps the 9:00 promise and fits the rest in: saves ${rt.better?.saves} min`);
  const times = Object.fromEntries((rt.better?.times || []).map((x) => [x.id, x.start]));
  ok(times[vc.id] === 540 && times[vb.id] === 630 && times[va.id] === 720, 'with times for the visits that moved, on the quarter hour');
  ok((await sam('GET', `/route?date=${day}&member=${ids.find((x) => x.name === 'Jo').id}`)).status === 403, 'others see only their own route');
  ok((await sam('GET', '/route?date=' + day)).body.stops.length === 3, 'and Sam sees his');

  // Asked again: from memory, nothing looked up again.
  const before = { ...calls };
  await jo('GET', `/route?date=${day}&member=${samId}`);
  ok(calls.geo === before.geo && calls.dir === before.dir, 'looking again doesn’t look everything up again');

  // Two promised visits too close together.
  const tight = new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA');
  await jo('POST', `/records/${ja.id}/visits`, { kind: 'Service', date: tight, start: 540, end: 600, memberIds: [samId] });
  await jo('POST', `/records/${jc.id}/visits`, { kind: 'Service', date: tight, start: 615, end: 675, memberIds: [samId] });
  r = await jo('GET', `/route?date=${tight}&member=${samId}`);
  ok(r.body.tight.length === 1 && r.body.tight[0].drive === 40 && r.body.tight[0].gap === 15, 'a visit too tight to reach in time is flagged (40 min drive, 15 min gap)');
  ok(!r.body.better, 'nothing to move while keeping promised times');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv?.kill();
fake.close();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
