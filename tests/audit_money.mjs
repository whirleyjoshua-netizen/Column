// Audit (money, docs/audit/FINDINGS.md): G1, a customer can't be charged twice for one invoice.
// Pay twice reuses the one open card page; recording a payment or changing the lines closes it in Stripe; payments by
// hand or the API can't be more than is owed.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_money';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4905, F_PORT = 4906, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
// A stand-in for Stripe: Checkout sessions that can be read, paid (by the test) and expired.
const TEAM_KEY = 'sk_test_teamkey1234567890';
const sessions = {};
const made = [];
const fake = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'Bearer ' + TEAM_KEY) { res.writeHead(401); return res.end('{"error":{"message":"Invalid API Key provided"}}'); }
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/account') return res.end(JSON.stringify({ id: 'acct_1', settings: { dashboard: { display_name: 'Cool Air LLC' } } }));
  if (u.pathname === '/v1/checkout/sessions' && req.method === 'POST') {
    const f = Object.fromEntries(new URLSearchParams(raw));
    const id = 'cs_test_' + (made.length + 1);
    sessions[id] = { id, amount_total: Number(f['line_items[0][price_data][unit_amount]']), payment_status: 'unpaid', status: 'open', url: `https://checkout.stripe.com/c/pay/${id}` };
    made.push(sessions[id]);
    return res.end(JSON.stringify(sessions[id]));
  }
  const ex = u.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/);
  if (ex && sessions[ex[1]]) {
    const s = sessions[ex[1]];
    if (s.status !== 'open') { res.writeHead(400); return res.end('{"error":{"message":"Only open sessions can be expired."}}'); }
    s.status = 'expired';
    return res.end(JSON.stringify(s));
  }
  const m = u.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
  if (m && sessions[m[1]]) return res.end(JSON.stringify(sessions[m[1]]));
  res.writeHead(404); res.end('{"error":{"message":"No such thing"}}');
});
await new Promise((r) => fake.listen(F_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', STRIPE_API: `http://127.0.0.1:${F_PORT}`, INVOICE_CHECK_MS: '60000' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Money ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  await jo('PUT', '/payments/stripe', { key: TEAM_KEY });
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const dana = (await jo('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test' })).body;
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: dana.id ?? dana.contact?.id, price: { rows: [{ desc: 'Tune-up', qty: 1, price: '500' }] } } })).body;
  let inv = (await jo('POST', `/records/${job.id}/invoices`)).body;
  inv = (await jo('POST', `/invoices/${inv.id}/send`)).body;
  const token = inv.url.split('/i/')[1];
  const pay = () => fetch(`${B}/i/${token}/pay`, { method: 'POST', redirect: 'manual' });

  // Pay clicked twice (two tabs, or back and pay again): one card page, reused.
  let a = await pay(), b = await pay();
  ok(made.length === 1 && a.headers.get('location') === made[0].url && b.headers.get('location') === made[0].url, `G1 clicking Pay twice opens one card page, reused (${made.length} made)`);

  // A check recorded by hand closes the open card page, so it can't be paid as well.
  ok((await jo('POST', `/invoices/${inv.id}/payments`, { amount: '600', method: 'check' })).status === 400, 'G1 a payment by hand can’t be more than is owed');
  r = await jo('POST', `/invoices/${inv.id}/payments`, { amount: '200', method: 'check' });
  ok(r.status === 200 && r.body.balance === 30000, 'G1 (setup) a $200 check, $300 left');
  ok(await until(() => made[0].status === 'expired'), 'G1 and the old $500 card page is closed in Stripe');
  a = await pay();
  ok(made.length === 2 && made[1].amount_total === 30000 && a.headers.get('location') === made[1].url, 'G1 Pay now opens a new page for the $300 still owed');

  // The customer pays that one: recorded once, and a page that was somehow paid as well is flagged.
  made[1].payment_status = 'paid'; made[1].status = 'complete';
  await fetch(`${inv.url}?paid=${made[1].id}`);
  inv = (await jo('GET', '/invoices/' + inv.id)).body;
  ok(inv.status === 'paid' && inv.payments.length === 2 && inv.balance === 0, 'G1 paid in full, counted once');
  // The API can't overpay either.
  const key = (await jo('POST', '/integrations/keys', { name: 'books' })).body.token;
  let inv2 = (await jo('POST', `/records/${job.id}/invoices`)).body;
  inv2 = (await jo('POST', `/invoices/${inv2.id}/send`)).body;
  r = await call(key)('POST', `/v1/invoices/${inv2.id}/payments`, { amount: '5000' });
  ok(r.status === 400, 'G1 the API can’t record more than is owed either');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails && process.env.SHOWLOG) console.log(srv.log.slice(-2500));
  srv.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
