// Audit (docs/audit/FINDINGS.md G12): a team being deleted doesn't renew (its subscription is set to end with the
// period, and back on if the delete is undone), and when it's erased the subscription is cancelled first: if that
// fails, the team is kept and it's tried again, so a team that's gone never keeps paying.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_billing2';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4935, SP = 4936, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const calls = [];
let deleteFails = true;
const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  calls.push([req.method, req.url, body]);
  res.setHeader('content-type', 'application/json');
  if (req.method === 'DELETE' && deleteFails) { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: 'Stripe is having a moment' } })); }
  res.end(JSON.stringify({ id: 'sub_1', object: 'subscription', status: 'active' }));
});
await new Promise((r) => fake.listen(SP, '127.0.0.1', r));
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE: 'price_x', STRIPE_API: `http://127.0.0.1:${SP}`, STRIPE_WEBHOOK_SECRET: 'whsec_x' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const stop = async () => { const p = new Promise((r) => srv.on('exit', r)); srv.kill(); await p; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const readDb = () => JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
const t = Date.now();
try {
  await start();
  const team = 'Paying ' + t;
  let r = await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const tok = r.body.token, wsId = r.body.workspace.id;
  await stop();
  let db = readDb();
  Object.assign(db.workspaces[wsId].billing, { sub: 'sub_1', status: 'active', item: 'si_1', seats: 1 });
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  await start();
  const jo = call(tok);

  r = await jo('POST', '/workspace/delete', { name: team, password: 'longenough1' });
  ok(r.status === 200 && r.body.deleteAt, '(setup) Jo starts deleting the team');
  const ends = calls.find(([m, u, b]) => m === 'POST' && u.startsWith('/v1/subscriptions/sub_1') && /cancel_at_period_end=true/.test(b));
  ok(!!ends, 'G12 deleting stops the subscription from renewing at once');
  r = await jo('DELETE', '/workspace/delete');
  ok(r.status === 200 && calls.some(([m, u, b]) => m === 'POST' && u.startsWith('/v1/subscriptions/sub_1') && /cancel_at_period_end=false/.test(b)), 'G12 undoing it turns renewal back on');

  // Deleted for real; the erase date has come; Stripe fails the cancel.
  await jo('POST', '/workspace/delete', { name: team, password: 'longenough1' });
  await stop();
  db = readDb();
  db.workspaces[wsId].deleteAt = Date.now() - 1000;
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  await start();
  await sleep(17_000); // erasing runs 15 seconds after start
  ok(calls.some(([m, u]) => m === 'DELETE' && u.startsWith('/v1/subscriptions/sub_1')), '(setup) it tried to cancel the subscription');
  await stop();
  ok(!!readDb().workspaces[wsId], 'G12 the cancel failed, so the team isn’t erased yet (it would have kept paying)');

  // Stripe works again: the next try cancels and erases.
  deleteFails = false;
  await start();
  await sleep(17_000);
  await stop();
  ok(!readDb().workspaces[wsId], 'G12 once the cancel works, the team is erased');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv?.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
