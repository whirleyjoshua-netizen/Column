// Audit (docs/audit/FINDINGS.md B4): when a team's trial or subscription has ended the team is read-only, and that
// holds for the public API too (reading still works).
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_billing';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4910, B = `http://127.0.0.1:${PORT}`, SP = 4914, WHSEC = 'whsec_audit';
// A stand-in for Stripe: subscriptions as Stripe has them now (events may arrive late or out of order).
const subs = {};
const fake = http.createServer(async (req, res) => {
  for await (const c of req) void c;
  res.setHeader('content-type', 'application/json');
  const m = req.url.match(/^\/v1\/subscriptions\/([^/?]+)$/);
  if (m && subs[m[1]]) return res.end(JSON.stringify(subs[m[1]]));
  res.end('{}');
});
await new Promise((r) => fake.listen(SP, '127.0.0.1', r));
const hook = (event) => {
  const raw = JSON.stringify(event), ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', WHSEC).update(`${ts}.${raw}`).digest('hex');
  return fetch(B + '/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` }, body: raw });
};
const subOf = (id, wsId, status) => ({ id, object: 'subscription', customer: 'cus_' + wsId, status, metadata: { wsId }, cancel_at: null, items: { data: [{ id: 'si_' + id, quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE: 'price_x', STRIPE_API: `http://127.0.0.1:${SP}`, STRIPE_WEBHOOK_SECRET: WHSEC }, stdio: 'ignore' });
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const stop = async () => { srv.kill(); await srv.exited; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  await start();
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Bill ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token), wsId = r.body.workspace.id;
  const key = (await jo('POST', '/integrations/keys', { name: 'zap' })).body.token;
  ok((await call(key)('POST', '/v1/tasks', { text: 'in the trial' })).status === 201, 'B4 (setup) the API can write during the trial');
  await stop();
  const db = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
  db.workspaces[wsId].billing.trialEnds = Date.now() - 1000;
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  await start();
  ok((await jo('POST', '/tasks', { text: 'after' })).status === 402, 'B4 (setup) the app is read-only after the trial');
  r = await call(key)('POST', '/v1/tasks', { text: 'after the trial' });
  ok(r.status === 402, 'B4 the API can’t write either once the trial has ended');
  ok((await call(key)('GET', '/v1/tasks')).status === 200, 'B4 reading through the API still works');

  // G5: Stripe events can arrive late and out of order: what Stripe says now is what counts.
  subs.sub_A = subOf('sub_A', wsId, 'active');
  await hook({ type: 'customer.subscription.updated', data: { object: subs.sub_A } });
  ok((await jo('GET', '/billing')).body.state === 'active', 'G5 (setup) subscribed: active');
  await hook({ type: 'customer.subscription.created', data: { object: { ...subs.sub_A, status: 'incomplete' } } }); // a late, out-of-date event
  r = (await jo('GET', '/billing')).body;
  ok(r.state === 'active' && !r.readOnly, 'G5 a late “incomplete” event doesn’t lock a paying team');
  // G4: a second live subscription doesn't take over the team's billing; owners are told.
  subs.sub_B = subOf('sub_B', wsId, 'active');
  await hook({ type: 'customer.subscription.created', data: { object: subs.sub_B } });
  await sleep(200);
  const st2 = (await jo('GET', '/state')).body;
  ok(st2.notices.some((n) => /subscribed twice/.test(n.title)), 'G4 a second live subscription is flagged to the owner instead of quietly taking over');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv?.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
