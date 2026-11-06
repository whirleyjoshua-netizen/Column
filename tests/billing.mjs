// Billing: a new team gets a 14-day trial; after it a team is read-only (look, export, pay) until an owner
// subscribes on Stripe; Stripe's webhook (signed) turns it on and off; seats follow the team; teams from
// before billing are free.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/billing';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4787, B = `http://127.0.0.1:${PORT}`, SP = 4785, WHSEC = 'whsec_test123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(200); } return false; };

// A stand-in for Stripe.
const seen = [];
const sub = { id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'active', metadata: {}, cancel_at: null, items: { data: [{ id: 'si_1', quantity: 2, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } };
const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const f = Object.fromEntries(new URLSearchParams(body));
  seen.push({ method: req.method, path: req.url, f, auth: req.headers.authorization });
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/customers') return res.end(JSON.stringify({ id: 'cus_1' }));
  if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }));
  if (req.url === '/v1/billing_portal/sessions') return res.end(JSON.stringify({ url: 'https://billing.stripe.test/p_1' }));
  if (req.url === '/v1/subscriptions/sub_1' && req.method === 'GET') return res.end(JSON.stringify(sub));
  if (req.url === '/v1/subscription_items/si_1') { sub.items.data[0].quantity = Number(f.quantity); return res.end(JSON.stringify(sub.items.data[0])); }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => fake.listen(SP, '127.0.0.1', r));
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE: 'price_seat', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API: `http://127.0.0.1:${SP}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const stop = async () => { srv.kill('SIGTERM'); await srv.exited; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const hook = (event, secret = WHSEC) => {
  const raw = JSON.stringify(event), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return fetch(B + '/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: raw });
};
const t = Date.now();
await start();
try {
  let r = await call()('POST', '/api/auth', { mode: 'create', workspace: 'Pay ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jt = r.body.token, J = call(jt), wsId = r.body.workspace.id;
  const code = (await J('GET', '/api/state')).body.workspace.inviteCode;
  const join = async (name, n) => (await call()('POST', '/api/auth', { mode: 'join', workspace: 'Pay ' + t, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd' + n })).body.token;
  const K = call(await join('Ken', 2));
  r = await J('GET', '/api/billing');
  ok(r.body.state === 'trial' && r.body.daysLeft === 14 && r.body.price === 1500 && !r.body.readOnly, 'a new team starts a 14-day free trial');
  ok((await J('POST', '/api/tasks', { text: 'Works in the trial' })).status === 200, 'everything works during the trial');

  // the trial runs out
  await stop();
  const db = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
  db.workspaces[wsId].billing.trialEnds = Date.now() - 1000;
  // and a team from before billing
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  await start();
  r = await J('GET', '/api/billing');
  ok(r.body.state === 'trial_over' && r.body.readOnly, 'when the trial ends without a subscription, the team is read-only');
  r = await J('POST', '/api/tasks', { text: 'Blocked' });
  ok(r.status === 402 && /free trial has ended/.test(r.body.error), 'adding things is refused, saying why: ' + r.body?.error);
  ok((await J('GET', '/api/state')).status === 200, 'everyone can still look');
  ok((await J('POST', '/api/exports', { kind: 'team' })).status === 200, 'and export');
  ok((await J('GET', '/api/state')).body.workspace.billing.readOnly === true, 'the app is told it’s read-only');

  // subscribing
  ok((await K('POST', '/api/billing/checkout')).status === 403, 'only owners subscribe');
  r = await J('POST', '/api/billing/checkout');
  ok(r.body.url === 'https://checkout.stripe.test/cs_1', 'an owner is sent to Stripe’s checkout');
  const cs = seen.find((x) => x.path === '/v1/checkout/sessions');
  ok(cs && cs.f.mode === 'subscription' && cs.f['line_items[0][price]'] === 'price_seat' && cs.f['line_items[0][quantity]'] === '2' && cs.f.client_reference_id === wsId && cs.f.customer === 'cus_1', 'for 2 seats (the team), as a Stripe customer for this team');
  ok(seen.every((x) => x.auth === 'Bearer sk_test_x'), 'with the server’s Stripe key');
  ok((await hook({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: wsId, customer: 'cus_1', subscription: 'sub_1' } } }, 'whsec_wrong')).status === 400, 'a webhook not signed by Stripe is turned away');
  ok((await J('GET', '/api/billing')).body.readOnly, 'and changes nothing');
  r = await hook({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: wsId, customer: 'cus_1', subscription: 'sub_1' } } });
  ok(r.status === 200, 'Stripe’s signed webhook is accepted');
  r = await J('GET', '/api/billing');
  ok(r.body.state === 'active' && !r.body.readOnly && r.body.seats === 2 && r.body.periodEnd > Date.now(), 'the team is subscribed and works again');
  ok((await J('POST', '/api/tasks', { text: 'Paid' })).status === 200, 'adding things works');
  ok((await J('POST', '/api/billing/checkout')).status === 409, 'subscribing twice is refused');
  r = await J('POST', '/api/billing/portal');
  ok(r.body.url === 'https://billing.stripe.test/p_1', 'Manage billing opens Stripe’s portal');

  // seats follow the team
  await join('Lee', 3);
  ok(await until(() => seen.some((x) => x.path === '/v1/subscription_items/si_1' && x.f.quantity === '3' && x.f.proration_behavior === 'create_prorations')), 'someone joining adds a seat, prorated');
  ok(await until(async () => (await J('GET', '/api/billing')).body.seats === 3), 'and the team shows 3 seats');

  // it ends
  r = await hook({ type: 'customer.subscription.updated', data: { object: { ...sub, status: 'past_due' } } });
  ok((await J('GET', '/api/billing')).body.state === 'past_due' && (await J('POST', '/api/tasks', { text: 'still ok' })).status === 200, 'a failed payment warns but keeps working while Stripe retries');
  await hook({ type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } });
  r = await J('GET', '/api/billing');
  ok(r.body.state === 'ended' && r.body.readOnly, 'a cancelled subscription makes the team read-only again');
  ok(/subscription has ended/.test((await J('POST', '/api/tasks', { text: 'x' })).body.error), 'saying the subscription ended');

  // teams from before billing
  await stop();
  const db2 = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
  delete db2.workspaces[wsId].billing;
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db2));
  await start();
  r = await J('GET', '/api/billing');
  ok(r.body.state === 'free' && !r.body.readOnly, 'a team from before billing is free');
} finally {
  await stop().catch(() => {});
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
