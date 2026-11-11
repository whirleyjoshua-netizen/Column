// Audit (docs/audit/FINDINGS.md), batch 10: G15 repeated charges in one bank statement are all kept; B11 a private
// campaign's stack, a locked doc and someone else's folder upload are protected; B10 a device id is never proof that
// something is yours; B7 "members see only theirs" holds for live updates about handed-off tasks; F11 a record can't
// be linked to a doc the person can't see; E19 webhook deliveries go out at most 4 at a time per team.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_batch10';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4937, RECV = 4938, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', ALLOW_LOCAL_WEBHOOKS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const stop = async () => { const p = new Promise((r) => srv.on('exit', r)); srv.kill(); await p; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// E19: a receiver that's slow to answer, counting how many deliveries are open at once.
let open = 0, most = 0, got = 0;
const recv = http.createServer(async (req, res) => { for await (const c of req) void c; open++; most = Math.max(most, open); await sleep(300); open--; got++; res.end('ok'); });
await new Promise((r) => recv.listen(RECV, '127.0.0.1', r));
const t = Date.now();
try {
  await start();
  const team = 'B10 ' + t;
  let r = await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'jo-dev' });
  const joTok = r.body.token, wsId = r.body.workspace.id, code = r.body.workspace.inviteCode;
  const jo = call(joTok);
  r = await call()('POST', '/auth', { mode: 'join', workspace: team, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'sam-dev' });
  const sam = call(r.body.token);
  const ids = (await jo('GET', '/state')).body.workspace.members;
  const samId = ids.find((x) => x.name === 'Sam').id, joId = ids.find((x) => x.name === 'Jo').id;

  // G15
  const rows = [{ day: '2026-11-03', amount: '-4.50', note: 'STARBUCKS 123' }, { day: '2026-11-03', amount: '-4.50', note: 'STARBUCKS 123' }, { day: '2026-11-03', amount: '-12.00', note: 'SHELL' }];
  r = await jo('POST', '/money/import', { rows });
  ok(r.body.added === 3 && r.body.skipped === 0, `G15 two identical coffees on the same day are two charges (${r.body.added} added)`);
  r = await jo('POST', '/money/import', { rows });
  ok(r.body.added === 0 && r.body.skipped === 3, `G15 importing the same statement again adds nothing (${r.body.added} added)`);

  // B11: a private campaign's stack.
  const camp = (await jo('POST', '/campaigns', { name: 'Owner plans', private: true })).body;
  const stackId = camp.stackId || (await jo('GET', '/state')).body.workspace.stacks.find((x) => x.campaignId === camp.id)?.id;
  r = await sam('PATCH', `/stacks/${stackId}`, { name: 'Renamed by Sam' });
  ok(r.status === 404 && (await jo('GET', '/state')).body.workspace.stacks.find((x) => x.id === stackId)?.name !== 'Renamed by Sam', `B11 someone outside a private campaign can’t rename its stack (${r.status})`);
  // B11: a locked doc.
  const doc = (await jo('POST', '/items', { type: 'text', text: 'Pricing rules' })).body;
  await jo('PATCH', `/items/${doc.id}`, { locked: true });
  ok((await sam('DELETE', `/items/${doc.id}`)).status >= 400, 'B11 a locked doc can’t be deleted by someone else');
  ok((await sam('PATCH', `/items/${doc.id}`, { stackId: null, channelId: null, dirId: null })).status === 403, 'B11 nor moved');
  ok((await sam('POST', `/items/${doc.id}/share`, { hours: 24 })).status === 403, 'B11 nor shared');
  ok((await jo('POST', `/items/${doc.id}/share`, { hours: 24 })).status === 200, 'B11 but whoever made it can share it');
  // B11: someone else's folder upload.
  const folder = (await jo('POST', '/folders', { name: 'Site photos' })).body;
  r = await fetch(`${B}/api/upload?folder=${folder.id}&relPath=x.txt`, { method: 'PUT', headers: { authorization: 'Bearer ' + (await call()('POST', '/auth', { mode: 'email', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'sam-dev' })).body.token }, body: 'not yours' });
  ok(r.status === 404, `B11 files go into a folder that’s still uploading only from whoever is uploading it (${r.status})`);
  // F11: linking a record to a doc the person can't see.
  await jo('PATCH', '/workspace', { tools: { projects: true } });
  const p = (await sam('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const rec = (await sam('POST', `/projects/${p.id}/records`, { typeId: p.types[0].id, values: { job: 'Lopez' } })).body;
  const dir = (await jo('POST', '/dirs', { name: 'Owner only', private: true })).body;
  const privDoc = (await jo('POST', '/items', { type: 'text', text: 'Secret margins', ...(dir?.id ? { dirId: dir.id } : {}) })).body;
  const samSees = (await sam('GET', '/state')).body.items.some((x) => x.id === privDoc.id);
  if (!samSees) {
    r = await sam('PATCH', `/records/${rec.id}`, { docId: privDoc.id });
    ok(!r.body?.docId, 'F11 a record can’t be linked to a doc the person can’t see');
  } else console.log('SKIP F11: no private place for the doc in this setup');

  // B7: Sam only sees his own; a task handed between Jo and someone else isn't sent to him live.
  await jo('PATCH', '/workspace', { visibility: 'own' });
  const samLive = [];
  const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: 'Bearer ' + (await call()('POST', '/auth', { mode: 'email', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'sam-dev2' })).body.token } });
  sock.on('message', (d) => samLive.push(String(d)));
  await new Promise((r2) => sock.on('open', r2));
  // A task of Jo's that waits on another of hers: finishing the first hands the second off (a "handoff" update).
  const first = (await jo('POST', '/tasks', { text: 'Gather supplier quotes', assigneeId: joId })).body;
  const task = (await jo('POST', '/tasks', { text: 'Owner-only pricing review', assigneeId: joId, blockedBy: [first.id] })).body;
  await jo('PATCH', `/tasks/${first.id}`, { done: true });
  await sleep(600);
  sock.close();
  ok(!samLive.some((m) => m.includes('Owner-only pricing review')), 'B7 with members seeing only theirs, Sam hears nothing about Jo’s own task');

  // E19
  const key = (await jo('POST', '/integrations/keys', { name: 'zap' })).body.token;
  r = await call(key)('POST', '/v1/webhooks', { url: `http://127.0.0.1:${RECV}/hook`, events: ['contact.created'] });
  ok(r.status === 201, '(setup) a webhook for new contacts');
  for (let i = 0; i < 12; i++) await jo('POST', '/contacts', { name: 'Lead ' + i, email: `lead${i}@x.test` });
  for (let i = 0; i < 60 && got < 12; i++) await sleep(150);
  ok(got === 12 && most <= 4, `E19 12 deliveries all arrive, at most 4 at a time (${got} arrived, ${most} at once)`);

  // B10: an item from before accounts, with only a device id: it gets an owner, and that device id alone proves nothing.
  const old = (await jo('POST', '/items', { type: 'message', text: 'Old note from before accounts' })).body;
  await stop();
  const db = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
  delete db.items[old.id].memberId;
  db.items[old.id].deviceId = 'jo-dev';
  db.items[old.id].by = 'Jo';
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  await start();
  r = await call()('POST', '/auth', { mode: 'email', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'jo-dev' });
  const fake = call(r.body.token);
  ok((await fake('PATCH', `/items/${old.id}`, { text: 'changed by Sam' })).status === 403, 'B10 claiming someone’s device id doesn’t make their old messages yours');
  ok((await call(joTok)('PATCH', `/items/${old.id}`, { text: 'edited by Jo' })).status === 200, 'B10 the old message is Jo’s (the sign-in that posted it)');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv?.kill();
  recv.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
