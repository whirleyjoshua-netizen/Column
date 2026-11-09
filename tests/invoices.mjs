// Invoices: made from a job's price lines, numbered for the team, sent as a customer link that moves the job to
// Invoiced; paid by card through the team's own Stripe (back from Checkout, or caught by the check that runs every
// few minutes) or by hand; paid in full moves the job to Paid and puts the money in Finance. What the job cost:
// labor from done visits at the team's rate, materials, margin. Only owners and admins see any of it.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/invoices';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4763, B = `http://127.0.0.1:${PORT}`, F_PORT = 4761;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(150); } return false; };

// A stand-in for Stripe: one team key, Checkout sessions that a test marks paid.
const TEAM_KEY = 'sk_test_teamkey1234567890';
const sessions = {};
let made = [];
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
    sessions[id] = { id, amount_total: Number(f['line_items[0][price_data][unit_amount]']), payment_status: 'unpaid', status: 'open', form: f };
    made.push(sessions[id]);
    return res.end(JSON.stringify({ id, url: `https://checkout.stripe.com/c/pay/${id}` }));
  }
  const m = u.pathname.match(/^\/v1\/checkout\/sessions\/(.+)$/);
  if (m && sessions[m[1]]) return res.end(JSON.stringify(sessions[m[1]]));
  res.writeHead(404); res.end('{"error":{"message":"No such thing"}}');
});
await new Promise((r) => fake.listen(F_PORT, '127.0.0.1', r));
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', STRIPE_API: `http://127.0.0.1:${F_PORT}`, INVOICE_CHECK_MS: '400' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const today = new Date().toLocaleDateString('en-CA');
try {
  await start();
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Inv ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Inv ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  const samId = (await jo('GET', '/state')).body.workspace.members.find((x) => x.name === 'Sam').id;

  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const fid = (k) => tp.fields.find((f) => f.key === k)?.id;
  const stage = (rec) => tp.fields.find((f) => f.key === 'status').choices.find((c) => c.id === rec.values[fid('status')])?.label;
  ok(tp.fields.some((f) => f.key === 'price' && f.type === 'items'), 'a trade job has price lines');
  const dana = (await jo('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '555-0100', address: '10 A St' })).body;
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: dana.id ?? dana.contact?.id, address: '10 A St',
    price: { rows: [{ desc: 'Tune-up', qty: 1, price: '300' }, { desc: 'Filter', qty: 2, price: '25', cost: '15' }], taxRate: 10 } } })).body;
  ok(job.id && job.values[fid('price')]?.rows.length === 2, 'the job’s price: a tune-up and two filters, 10% tax');

  // Making one.
  ok((await sam('POST', `/records/${job.id}/invoices`)).status === 403, 'members can’t make invoices');
  ok((await sam('GET', `/records/${job.id}/costing`)).status === 403, 'or see what a job cost');
  r = await jo('POST', `/records/${job.id}/invoices`);
  let inv = r.body;
  ok(r.status === 200 && inv.number === 'INV-1001' && inv.status === 'draft' && inv.total === 38500 && inv.balance === 38500, `an invoice from the job’s lines: ${inv.number}, ${inv.total / 100} with tax`);
  ok(inv.to.name === 'Dana Ruiz' && inv.to.email === 'dana@x.test' && inv.to.address === '10 A St' && inv.lines.rows.every((x) => x.cost == null), 'billed to the job’s customer, and our costs aren’t on it');
  ok(inv.due > today && !inv.token, 'due in two weeks, no link until it’s sent');
  ok((await fetch(B + '/i/' + 'x'.repeat(24))).status === 404, 'a made-up link finds nothing');

  r = await jo('PATCH', '/invoices/' + inv.id, { lines: { rows: [...inv.lines.rows.map((x) => ({ ...x, price_cents: x.price })), { desc: 'Service call', qty: 1, price: '50' }], taxRate: 10 }, note: 'Thanks!' });
  inv = r.body;
  ok(inv.total === 44000 && inv.note === 'Thanks!', 'its lines can be changed before it’s paid: now ' + inv.total / 100);

  // Sending it.
  r = await jo('POST', `/invoices/${inv.id}/send`);
  inv = r.body;
  let rec = (await jo('GET', `/projects/${p.id}/records`)).body.find?.((x) => x.id === job.id) || (await jo('GET', `/projects/${p.id}`)).body.records?.find((x) => x.id === job.id);
  ok(inv.status === 'sent' && inv.url?.startsWith(B + '/i/'), 'sending it makes the customer’s link');
  ok(rec && stage(rec) === 'Invoiced', 'and moves the job to Invoiced: ' + (rec && stage(rec)));
  const token = inv.url.split('/i/')[1];

  // The customer's page, before Stripe is connected.
  let page = await (await fetch(inv.url)).text();
  ok(/Invoice INV-1001/.test(page) && /\$440\.00/.test(page) && /Contact Inv /.test(page) && !/Pay \$/.test(page), 'the customer sees it, with no card button until Stripe is connected');
  ok((await jo('GET', '/invoices/' + inv.id)).body.status === 'viewed', 'opening it marks it viewed');

  // Connecting the team's Stripe.
  ok((await sam('PUT', '/payments/stripe', { key: TEAM_KEY })).status === 403, 'members can’t connect Stripe');
  ok((await jo('PUT', '/payments/stripe', { key: 'pk_live_nope' })).status === 400, 'a publishable key is refused');
  ok((await jo('PUT', '/payments/stripe', { key: 'sk_test_wrongkey12345678' })).status === 400, 'a key Stripe rejects is refused');
  r = await jo('PUT', '/payments/stripe', { key: TEAM_KEY });
  ok(r.body.connected && r.body.account === 'Cool Air LLC' && r.body.live === false, 'connected: ' + r.body.account);
  await sleep(700);
  const dbText = fs.readFileSync(DIR + '/db.json', 'utf8');
  ok(!dbText.includes(TEAM_KEY), 'the key is kept sealed, never as written');
  ok(!JSON.stringify((await jo('GET', '/payments/stripe')).body).includes('sk_'), 'and never sent back');

  // A cash payment, then the rest by card.
  r = await jo('POST', `/invoices/${inv.id}/payments`, { amount: '100', method: 'cash', note: 'deposit' });
  inv = r.body;
  ok(inv.status === 'partial' && inv.paid === 10000 && inv.balance === 34000, 'a $100 cash deposit: part paid, $340 left');
  ok((await jo('PATCH', '/invoices/' + inv.id, { lines: { rows: [] } })).status === 400, 'with a payment on it, the lines are locked');
  page = await (await fetch(inv.url)).text();
  ok(/Pay \$340\.00 by card/.test(page), 'now the page offers to pay the $340 left by card');
  r = await fetch(`${B}/i/${token}/pay`, { method: 'POST', redirect: 'manual' });
  const cs = made.at(-1);
  ok(r.status === 303 && r.headers.get('location') === `https://checkout.stripe.com/c/pay/${cs.id}`, 'Pay goes to Stripe Checkout');
  ok(cs.amount_total === 34000 && cs.form.customer_email === 'dana@x.test' && cs.form['metadata[kloomie_invoice]'] === inv.id && cs.form.success_url.includes('?paid={CHECKOUT_SESSION_ID}'), 'for what’s owed, with her email, and back to the invoice after');
  page = await (await fetch(`${inv.url}?paid=${cs.id}`)).text();
  ok(!/Thank you, your payment/.test(page) && (await jo('GET', '/invoices/' + inv.id)).body.status === 'partial', 'coming back before Stripe says paid records nothing');
  cs.payment_status = 'paid'; cs.status = 'complete';
  page = await (await fetch(`${inv.url}?paid=${cs.id}`)).text();
  inv = (await jo('GET', '/invoices/' + inv.id)).body;
  ok(/Thank you, your payment went through/.test(page) && /Paid in full/.test(page), 'back from Checkout: thank you, paid in full');
  ok(inv.status === 'paid' && inv.balance === 0 && inv.payments.length === 2 && inv.payments[1].method === 'card', 'the invoice is paid: cash plus card');
  await fetch(`${inv.url}?paid=${cs.id}`);
  ok((await jo('GET', '/invoices/' + inv.id)).body.payments.length === 2, 'coming back again doesn’t count it twice');
  rec = (await jo('GET', `/projects/${p.id}/records`)).body.find?.((x) => x.id === job.id) || (await jo('GET', `/projects/${p.id}`)).body.records?.find((x) => x.id === job.id);
  ok(stage(rec) === 'Paid', 'the job moved to Paid');
  let money = (await jo('GET', '/state')).body.money.filter((x) => x.category === 'Client payment');
  ok(money.length === 2 && money.every((x) => x.kind === 'in' && x.scope === 'business') && money.reduce((n, x) => n + x.amount, 0) === 44000, 'both payments are money in for the business in Finance');
  ok(!(await sam('GET', '/state')).body.money.some((x) => x.category === 'Client payment'), 'which members don’t see');
  ok((await jo('DELETE', `/invoices/${inv.id}/payments/${inv.payments[1].id}`)).status === 400, 'a card payment can’t be removed here (it’s refunded in Stripe)');
  ok((await jo('POST', `/invoices/${inv.id}/void`)).status === 400, 'a paid invoice can’t be voided');

  // Someone pays and closes the tab: the check that runs every few minutes catches it.
  inv = (await jo('POST', `/records/${job.id}/invoices`)).body;
  ok(inv.number === 'INV-1002', 'the next invoice is INV-1002');
  await jo('POST', `/invoices/${inv.id}/send`);
  inv = (await jo('GET', '/invoices/' + inv.id)).body;
  await fetch(`${inv.url.replace(B, B)}/pay`.replace('/i/', '/i/'), { method: 'POST', redirect: 'manual' });
  made.at(-1).payment_status = 'paid';
  ok(await until(async () => (await jo('GET', '/invoices/' + inv.id)).body.status === 'paid'), 'a card payment nobody came back from is recorded by the background check');

  // A hand payment removed takes its Finance entry with it.
  let inv3 = (await jo('POST', `/records/${job.id}/invoices`)).body;
  inv3 = (await jo('POST', `/invoices/${inv3.id}/payments`, { amount: '20', method: 'check', note: '#1042' })).body;
  const before = (await jo('GET', '/state')).body.money.length;
  inv3 = (await jo('DELETE', `/invoices/${inv3.id}/payments/${inv3.payments[0].id}`)).body;
  ok(inv3.paid === 0 && (await jo('GET', '/state')).body.money.length === before - 1, 'removing a check payment takes it out of Finance too');
  ok((await jo('DELETE', '/invoices/' + inv3.id)).status === 200, 'a draft can be deleted');

  // What the job cost.
  await jo('PATCH', `/records/${job.id}`, { values: { [fid('materials')]: { rows: [{ item: 'Filter', qty: 2, cost: '15' }, { item: 'Refrigerant', qty: 1, cost: '40' }] } } });
  const v = (await jo('POST', `/records/${job.id}/visits`, { kind: 'Service', date: today, start: 540, end: 660, memberIds: [samId, (await jo('GET', '/state')).body.me.memberId] })).body;
  await jo('PATCH', '/visits/' + v.id, { done: true });
  ok((await sam('PATCH', '/workspace', { laborRate: '50' })).status === 403, 'only admins set the labor rate');
  r = await jo('PATCH', '/workspace', { laborRate: '50' });
  ok(r.status === 200 && r.body.settings.laborRate === undefined && !JSON.stringify(r.body).includes('"laborRate"'), 'the rate isn’t in the settings everyone sees');
  const c = (await jo('GET', `/records/${job.id}/costing`)).body;
  ok(c.hours === 4 && c.labor === 20000 && c.laborRate === 5000, `labor: a 2-hour visit with 2 people at $50 = ${c.labor / 100}`);
  ok(c.materials === 7000 && c.price === 82500 && c.billed === 82500, `materials $${c.materials / 100}; billed $${c.price / 100} on two invoices ($440 and $385)`);
  ok(c.cost === 27000 && c.margin === 55500 && c.marginPct === 67.3, `margin $${c.margin / 100} · ${c.marginPct}%`);

  // Turning off a link: voiding.
  let inv4 = (await jo('POST', `/records/${job.id}/invoices`)).body;
  inv4 = (await jo('POST', `/invoices/${inv4.id}/send`)).body;
  ok((await jo('POST', `/invoices/${inv4.id}/void`)).body.status === 'void', 'an unpaid invoice can be voided');
  page = await (await fetch(inv4.url)).text();
  ok(/was cancelled/.test(page) && !/Pay \$/.test(page), 'and its page says nothing is owed');
  ok((await jo('GET', `/records/${job.id}/costing`)).body.billed === 82500, 'a void invoice isn’t counted as billed');

  r = await jo('DELETE', '/payments/stripe');
  ok(r.body.connected === false, 'Stripe can be disconnected');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv?.kill();
fake.close();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
