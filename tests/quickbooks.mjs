// QuickBooks Online: connecting a company (Intuit sign-in), sent invoices copied in under the same number with their
// customer, lines, discount and tax; payments taken in Kloomie recorded there; payments recorded there coming back
// (the job moves to Paid) without echoing; voids followed; an invoice number already there linked, not doubled;
// earlier invoices only when asked; tokens refreshed and kept sealed; members kept out; disconnecting revokes.
import './cookiejar.mjs'; // a browser's cookies: connecting an account finishes in the browser that started it
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/quickbooks';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4743, B = `http://127.0.0.1:${PORT}`, F_PORT = 4744, F = `http://127.0.0.1:${F_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(120); } return false; };

// ---------- a stand-in for Intuit and one QuickBooks company ----------
const Q = { access: null, refresh: null, refreshes: 0, revoked: [], seq: 100, Account: [{ Id: '1', Name: 'Services', AccountType: 'Income' }, { Id: '2', Name: 'Board of Equalization Payable', AccountType: 'Other Current Liability' }], Item: [], Customer: [{ Id: '9', DisplayName: 'Dana Ruiz (vendor)' }], Invoice: [], Estimate: [], Payment: [], posts: [] };
const issue = (short) => { Q.access = 'at_' + ++Q.seq; Q.refresh = 'rt_' + ++Q.seq; return { access_token: Q.access, refresh_token: Q.refresh, expires_in: short ? 1 : 3600, x_refresh_token_expires_in: 8640000 }; };
let shortTokens = false;
const PJtotal = (v) => { const sub = v.rows.reduce((n, r) => n + Math.round(r.qty * r.price), 0); return sub + Math.round(sub * (v.taxRate || 0) / 100); };
const total = (inv) => Math.round(inv.Line.reduce((n, l) => n + (l.DetailType === 'DiscountLineDetail' ? -l.Amount : l.Amount), 0) * 100) / 100;
const fake = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const u = new URL(req.url, F);
  const out = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (u.pathname === '/token') {
    const f = Object.fromEntries(new URLSearchParams(raw));
    if (req.headers.authorization !== 'Basic ' + Buffer.from('cid:csecret').toString('base64')) return out(401, { error: 'invalid_client' });
    if (f.grant_type === 'authorization_code') return f.code === 'good' && f.redirect_uri === B + '/oauth/quickbooks/callback' ? out(200, issue(shortTokens)) : out(400, { error: 'invalid_grant' });
    if (f.grant_type === 'refresh_token') { if (f.refresh_token !== Q.refresh) return out(400, { error: 'invalid_grant' }); Q.refreshes++; return out(200, issue(shortTokens)); }
    return out(400, { error: 'unsupported_grant_type' });
  }
  if (u.pathname === '/.well-known/openid_sandbox_configuration') { Q.discovered = (Q.discovered || 0) + 1; return out(200, { issuer: F, authorization_endpoint: F + '/connect', token_endpoint: F + '/token', revocation_endpoint: F + '/revoke' }); }
  if (u.pathname === '/revoke') { Q.revoked.push(JSON.parse(raw).token); return out(200, {}); }
  const m = u.pathname.match(/^\/v3\/company\/R1\/(.+)$/);
  if (!m) return out(404, {});
  if (req.headers.authorization !== 'Bearer ' + Q.access) return out(401, { Fault: { Error: [{ Message: 'AuthenticationFailed', code: '3200' }] } });
  const path = m[1];
  if (u.searchParams.get('minorversion') !== '75') return out(400, { Fault: { Error: [{ Message: 'minorversion' }] } });
  if (path === 'companyinfo/R1') return out(200, { CompanyInfo: { CompanyName: 'Cool Air LLC' } });
  if (path === 'query') {
    const sql = u.searchParams.get('query');
    const w = sql.match(/^select \* from (\w+) where (\w+) = '((?:[^'\\]|\\.)*)'$/);
    const list = (Q[w[1]] || []).filter((x) => String(x[w[2]]) === w[3].replace(/\\(.)/g, '$1'));
    return out(200, { QueryResponse: list.length ? { [w[1]]: list } : {} });
  }
  if (path === 'cdc') {
    Q.cdc = (Q.cdc || 0) + 1;
    const since = Date.parse(u.searchParams.get('changedSince'));
    return out(200, { CDCResponse: [{ QueryResponse: [{ Payment: Q.Payment.filter((p) => p.at > since) }] }] });
  }
  const g = path.match(/^invoice\/(\w+)$/);
  if (g && req.method === 'GET') { const inv = Q.Invoice.find((x) => x.Id === g[1]); return inv ? out(200, { Invoice: inv }) : out(404, {}); }
  const ge = path.match(/^estimate\/(\w+)$/);
  if (ge && req.method === 'GET') { const e = Q.Estimate.find((x) => x.Id === ge[1]); return e ? out(200, { Estimate: e }) : out(404, {}); }
  if (req.method === 'POST') {
    const body = JSON.parse(raw);
    Q.posts.push([path, body]);
    if (path === 'account') { const a = { Id: String(++Q.seq), ...body }; Q.Account.push(a); return out(200, { Account: a }); }
    if (path === 'item') { const a = { Id: String(++Q.seq), ...body }; Q.Item.push(a); return out(200, { Item: a }); }
    if (path === 'customer') {
      if (Q.Customer.some((x) => x.DisplayName === body.DisplayName)) return out(400, { Fault: { Error: [{ Message: 'Duplicate Name Exists Error', code: '6240' }] } });
      const a = { Id: String(++Q.seq), ...body }; Q.Customer.push(a); return out(200, { Customer: a });
    }
    if (path === 'invoice' && u.searchParams.get('operation') === 'void') { const inv = Q.Invoice.find((x) => x.Id === body.Id); inv.voided = true; inv.SyncToken = String(Number(inv.SyncToken) + 1); return out(200, { Invoice: inv }); }
    if (path === 'invoice') {
      if (!body.Line.every((l) => l.DetailType !== 'SalesItemLineDetail' || Math.abs(l.Amount - l.SalesItemLineDetail.Qty * l.SalesItemLineDetail.UnitPrice) < 0.01)) return out(400, { Fault: { Error: [{ Message: 'Amount is not equal to UnitPrice * Qty', code: '6070' }] } });
      if (body.Id) { const inv = Q.Invoice.find((x) => x.Id === body.Id); if (inv.SyncToken !== body.SyncToken) return out(400, { Fault: { Error: [{ Message: 'Stale Object Error', code: '5010' }] } }); Object.assign(inv, body, { SyncToken: String(Number(inv.SyncToken) + 1) }); inv.TotalAmt = total(inv); return out(200, { Invoice: inv }); }
      const inv = { Id: String(++Q.seq), SyncToken: '0', ...body }; inv.TotalAmt = total(inv); Q.Invoice.push(inv);
      for (const lt of body.LinkedTxn || []) { const e = lt.TxnType === 'Estimate' && Q.Estimate.find((x) => x.Id === lt.TxnId); if (e) { e.TxnStatus = 'Closed'; e.SyncToken = String(Number(e.SyncToken) + 1); } }
      return out(200, { Invoice: inv });
    }
    if (path === 'estimate') {
      if (body.Id) {
        const e = Q.Estimate.find((x) => x.Id === body.Id);
        if (e.SyncToken !== body.SyncToken) return out(400, { Fault: { Error: [{ Message: 'Stale Object Error', code: '5010' }] } });
        const { sparse, ...rest } = body;
        Object.assign(e, rest);
        e.SyncToken = String(Number(e.SyncToken) + 1); e.TotalAmt = total(e); return out(200, { Estimate: e });
      }
      const e = { Id: String(++Q.seq), SyncToken: '0', TxnStatus: 'Pending', ...body }; e.TotalAmt = total(e); Q.Estimate.push(e); return out(200, { Estimate: e });
    }
    if (path === 'payment') { const p = { Id: String(++Q.seq), ...body, at: Date.now() }; Q.Payment.push(p); return out(200, { Payment: p }); }
  }
  out(404, { Fault: { Error: [{ Message: 'Unknown ' + path }] } });
});
await new Promise((r) => fake.listen(F_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '',
  QBO_CLIENT_ID: 'cid', QBO_CLIENT_SECRET: 'csecret', QBO_API: F, QBO_DISCOVERY_URL: F + '/.well-known/openid_sandbox_configuration', QBO_TICK_MS: '400', QBO_SOON_MS: '100', QBO_PULL_MS: '2500' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const vOf = async (u) => (await (await fetch(u)).text()).match(/name="v" value="([^"]+)"/)?.[1] || ''; // the accept form's fingerprint, as a browser sends it
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Qb ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Qb ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);

  // A job, and one invoice sent before QuickBooks is connected.
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const dana = (await jo('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '555-0100', address: '10 A St' })).body;
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: dana.id, address: '10 A St',
    price: { rows: [{ desc: 'Tune-up', qty: 1, price: '300' }, { desc: 'Filter', qty: 2, price: '25.50' }], taxRate: 8.25, discount: { type: 'amount', value: 20 } } } })).body;
  const early = (await jo('POST', `/records/${job.id}/invoices`)).body;
  await jo('POST', `/invoices/${early.id}/send`);

  ok((await sam('GET', '/quickbooks')).status === 403, 'members can’t see the QuickBooks connection');
  r = await jo('GET', '/quickbooks');
  ok(r.body.configured && !r.body.connected, 'set up on the server, not connected yet');

  // Connecting.
  r = await jo('POST', '/quickbooks/connect');
  const auth = new URL(r.body.url);
  ok(Q.discovered === 1, 'Intuit’s sign-in addresses come from its discovery document');
  ok(auth.origin + auth.pathname === F + '/connect' && auth.searchParams.get('scope') === 'com.intuit.quickbooks.accounting' && auth.searchParams.get('redirect_uri') === B + '/oauth/quickbooks/callback', 'connect sends them to Intuit for the accounting scope');
  const st = auth.searchParams.get('state');
  ok(/expired/i.test(await (await fetch(`${B}/oauth/quickbooks/callback?code=good&state=made-up&realmId=R1`)).text()), 'a made-up state is refused');
  shortTokens = true;
  const cbRes = await fetch(`${B}/oauth/quickbooks/callback?code=good&state=${st}&realmId=R1`, { redirect: 'manual' });
  ok(cbRes.status === 302 && cbRes.headers.get('location') === '/quickbooks/done?r=connected' && !(await cbRes.text()).includes('<'), 'coming back from Intuit (code and company in the address) answers with a redirect, never a page');
  const page = await (await fetch(B + cbRes.headers.get('location'))).text();
  ok(/QuickBooks connected/.test(page), 'which says QuickBooks is connected');
  ok(/expired/i.test(await (await fetch(`${B}/oauth/quickbooks/callback?code=good&state=${st}&realmId=R1`)).text()), 'the same link can’t be used twice');
  r = await jo('GET', '/quickbooks');
  ok(r.body.connected && r.body.company === 'Cool Air LLC' && r.body.by === 'Jo', 'Settings shows the company and who connected it');
  await sleep(1200);
  ok(!Q.Invoice.some((x) => x.DocNumber === early.number), 'an invoice from before connecting isn’t copied');

  // A new invoice, sent.
  let inv = (await jo('POST', `/records/${job.id}/invoices`)).body;
  await sleep(800);
  ok(!Q.Invoice.some((x) => x.DocNumber === inv.number), 'a draft isn’t copied');
  await jo('POST', `/invoices/${inv.id}/send`);
  ok(await until(() => Q.Invoice.some((x) => x.DocNumber === inv.number)), `sent: ${inv.number} is in QuickBooks`);
  let qi = Q.Invoice.find((x) => x.DocNumber === inv.number);
  const cust = Q.Customer.find((x) => x.Id === qi.CustomerRef.value);
  ok(cust?.DisplayName === 'Dana Ruiz' && cust.PrimaryEmailAddr?.Address === 'dana@x.test' && cust.BillAddr?.Line1 === '10 A St', 'billed to Dana, added as a customer with her email and address');
  const lines = qi.Line;
  ok(lines.length === 4 && lines[0].SalesItemLineDetail.UnitPrice === 300 && lines[1].SalesItemLineDetail.Qty === 2 && lines[1].Amount === 51, 'both lines go in with their quantity and price');
  ok(lines[2].DetailType === 'DiscountLineDetail' && lines[2].Amount === 20, 'the $20 discount goes in');
  const kl = (await jo('GET', '/invoices/' + inv.id)).body;
  ok(lines[3].Description.startsWith('Sales tax') && Math.round(lines[3].Amount * 100) === kl.tax, `tax as its own line: $${lines[3].Amount}`);
  ok(Math.round(qi.TotalAmt * 100) === kl.total, `the totals match: $${qi.TotalAmt}`);
  const item = Q.Item.find((x) => x.Id === lines[0].SalesItemLineDetail.ItemRef.value);
  const taxItem = Q.Item.find((x) => x.Id === lines[3].SalesItemLineDetail.ItemRef.value);
  ok(item?.Name === 'Kloomie services' && item.IncomeAccountRef.value === '1', 'work goes in on a Kloomie services item, into Services income');
  const taxAcct = Q.Account.find((x) => x.Id === taxItem?.IncomeAccountRef.value);
  ok(taxItem?.Name === 'Sales tax (from Kloomie)' && taxAcct?.AccountType === 'Other Current Liability' && taxAcct.Name === 'Sales tax from Kloomie', 'tax goes to a sales tax liability account (made, since none says tax), not income');
  ok(Q.refreshes > 0, `the hour-long token was refreshed (${Q.refreshes} times), with the new refresh token kept`);
  shortTokens = false;

  // A payment in Kloomie goes there.
  await jo('POST', `/invoices/${inv.id}/payments`, { amount: '100', method: 'check', note: 'Check 1042' });
  ok(await until(() => Q.Payment.some((x) => x.Line[0].LinkedTxn[0].TxnId === qi.Id && x.TotalAmt === 100)), 'a $100 check taken in Kloomie is recorded against it there');
  const nPay = Q.Payment.length;
  // The rest paid in QuickBooks comes back.
  const rest = Math.round((kl.total - 10000)) / 100;
  Q.Payment.push({ Id: 'QP1', TotalAmt: rest, TxnDate: '2026-11-21', PaymentRefNum: 'ACH 77', at: Date.now(), Line: [{ Amount: rest, LinkedTxn: [{ TxnId: qi.Id, TxnType: 'Invoice' }] }] });
  ok(await until(async () => (await jo('GET', '/invoices/' + inv.id)).body.status === 'paid'), 'the rest, recorded in QuickBooks, comes back: paid');
  inv = (await jo('GET', '/invoices/' + inv.id)).body;
  const back = inv.payments.find((x) => x.by === 'QuickBooks');
  ok(back && back.amount === Math.round(rest * 100) && back.day === '2026-11-21' && /ACH 77/.test(back.note), 'as a payment by QuickBooks, on the day and with the reference');
  await sleep(1500);
  ok(Q.Payment.length === nPay + 1, 'and it isn’t sent back to QuickBooks again');
  ok(inv.payments.filter((x) => x.by === 'QuickBooks').length === 1, 'nor brought in twice');
  const rec = (await jo('GET', `/projects/${p.id}/records`)).body.find?.((x) => x.id === job.id);
  ok(rec && tp.fields.find((f) => f.key === 'status').choices.find((c) => c.id === rec.values[tp.fields.find((f) => f.key === 'status').id])?.label === 'Paid', 'the job moved to Paid');

  // Changing lines before it's paid updates it; voiding voids it.
  let inv2 = (await jo('POST', `/records/${job.id}/invoices`)).body;
  await jo('POST', `/invoices/${inv2.id}/send`);
  ok(await until(() => Q.Invoice.some((x) => x.DocNumber === inv2.number)), `${inv2.number} copied`);
  await jo('PATCH', `/invoices/${inv2.id}`, { lines: { rows: [{ desc: 'Bigger job', qty: 1, price: '900' }], taxRate: 0 } });
  ok(await until(() => Q.Invoice.find((x) => x.DocNumber === inv2.number)?.TotalAmt === 900), 'its new lines are updated there: $900');
  await jo('POST', `/invoices/${inv2.id}/void`);
  ok(await until(() => Q.Invoice.find((x) => x.DocNumber === inv2.number)?.voided), 'voided in Kloomie, voided there');

  // A number already in QuickBooks is linked, not doubled.
  const n3 = 'INV-' + (Number(inv2.number.split('-')[1]) + 1);
  Q.Invoice.push({ Id: 'HAND1', SyncToken: '0', DocNumber: n3, Line: [], TotalAmt: 0, CustomerRef: { value: '9' } });
  const inv3 = (await jo('POST', `/records/${job.id}/invoices`)).body;
  ok(inv3.number === n3, 'the next invoice gets that number: ' + n3);
  await jo('POST', `/invoices/${inv3.id}/send`);
  ok(await until(async () => (await jo('GET', '/invoices/' + inv3.id)).body.qbo?.id === 'HAND1'), 'it links to the one already there');
  ok(Q.Invoice.filter((x) => x.DocNumber === n3).length === 1, 'without making a second');

  // Quotes become estimates.
  const fid = (k) => tp.fields.find((f) => f.key === k)?.id;
  const lee = (await jo('POST', '/contacts', { name: 'Lee Park', email: 'lee@x.test', address: '22 B St' })).body;
  const qjob = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Heat pump install', customer: lee.id, address: '22 B St', price: { rows: [{ desc: 'Heat pump', qty: 1, price: '4200' }, { desc: 'Labor', qty: 6, price: '95' }], taxRate: 8.25 } } })).body;
  const sh = (await jo('POST', `/records/${qjob.id}/share`, { hours: 0 })).body;
  const token = sh.share.token;
  ok(await until(() => Q.Estimate.some((x) => Q.Customer.find((c) => c.Id === x.CustomerRef?.value)?.DisplayName === 'Lee Park')), 'a quote sent from a job goes in as an estimate, for Lee');
  let est = Q.Estimate.at(-1);
  ok(est.TxnStatus === 'Pending' && est.Line.length === 3 && est.Line[0].SalesItemLineDetail.UnitPrice === 4200 && est.Line[2].Description.startsWith('Sales tax'), 'pending, with both lines and the tax line');
  const kq = PJtotal({ rows: [{ qty: 1, price: 420000 }, { qty: 6, price: 9500 }], taxRate: 8.25 });
  ok(Math.round(est.TotalAmt * 100) === kq, `its total matches the quote: $${est.TotalAmt}`);
  ok(est.DocNumber === 'KQ-1001', 'under the team’s first quote number: ' + est.DocNumber);
  // Changing the price before they answer updates it.
  await jo('PATCH', `/records/${qjob.id}`, { values: { [fid('price')]: { rows: [{ desc: 'Heat pump', qty: 1, price: '3900' }, { desc: 'Labor', qty: 6, price: '95' }], taxRate: 8.25 } } });
  ok(await until(() => Q.Estimate.find((x) => x.Id === est.Id)?.Line[0].SalesItemLineDetail.UnitPrice === 3900), 'a new price before they answer updates the estimate');
  // Accepted on the customer's page.
  await fetch(`${B}/q/${token}/accept`, { method: 'POST', body: new URLSearchParams({ name: 'Lee Park', v: await vOf(`${B}/q/${token}`) }), redirect: 'manual' });
  ok(await until(() => Q.Estimate.find((x) => x.Id === est.Id)?.TxnStatus === 'Accepted'), 'accepted by the customer: Accepted there');
  est = Q.Estimate.find((x) => x.Id === est.Id);
  ok(est.AcceptedBy === 'Lee Park' && /^\d{4}-\d{2}-\d{2}$/.test(est.AcceptedDate), 'with who accepted it and when');
  // Invoiced: linked to the estimate, which closes.
  const qinv = (await jo('POST', `/records/${qjob.id}/invoices`)).body;
  await jo('POST', `/invoices/${qinv.id}/send`);
  ok(await until(() => Q.Invoice.some((x) => x.DocNumber === qinv.number)), `the job’s invoice ${qinv.number} goes in`);
  const qi2 = Q.Invoice.find((x) => x.DocNumber === qinv.number);
  ok(qi2.LinkedTxn?.[0]?.TxnId === est.Id && qi2.LinkedTxn[0].TxnType === 'Estimate', 'linked to its estimate');
  ok(Q.Estimate.find((x) => x.Id === est.Id).TxnStatus === 'Closed', 'and the estimate shows as closed (invoiced)');
  await sleep(1200);
  ok(Q.Estimate.find((x) => x.Id === est.Id).TxnStatus === 'Closed', 'Kloomie leaves it closed');
  // Declined, and withdrawn.
  const dj = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Duct cleaning', customer: lee.id, price: { rows: [{ desc: 'Ducts', qty: 1, price: '350' }], taxRate: 0 } } })).body;
  const dsh = (await jo('POST', `/records/${dj.id}/share`, {})).body;
  ok(await until(() => Q.Estimate.length === 2), 'a second quote, a second estimate');
  const dEst = Q.Estimate.at(-1);
  await fetch(`${B}/q/${dsh.share.token}/decline`, { method: 'POST', body: new URLSearchParams({ name: 'Lee', reason: 'Too much' }), redirect: 'manual' });
  ok(await until(() => Q.Estimate.find((x) => x.Id === dEst.Id)?.TxnStatus === 'Rejected'), 'declined: Rejected there');
  const wj = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Thermostat', customer: lee.id, price: { rows: [{ desc: 'Thermostat', qty: 1, price: '180' }], taxRate: 0 } } })).body;
  await jo('POST', `/records/${wj.id}/share`, {});
  ok(await until(() => Q.Estimate.length === 3), 'a third quote');
  const wEst = Q.Estimate.at(-1);
  await jo('DELETE', `/records/${wj.id}/share`);
  ok(await until(() => Q.Estimate.find((x) => x.Id === wEst.Id)?.TxnStatus === 'Closed'), 'its link turned off: closed there');
  ok((await jo('GET', '/quickbooks')).body.quotes === 3, 'Settings counts 3 quotes in QuickBooks');
  const noQuote = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Not quoted', customer: lee.id, price: { rows: [{ desc: 'X', qty: 1, price: '10' }] } } })).body;
  await sleep(900);
  ok(Q.Estimate.length === 3 && noQuote.id, 'a job whose quote was never sent isn’t copied');

  // Asking QuickBooks what changed is metered, so it's spaced out (2.5s here, 20 minutes for real), not every tick.
  const cdc0 = Q.cdc || 0;
  await sleep(3000);
  ok((Q.cdc || 0) - cdc0 <= 2, `idle, it asks QuickBooks what changed only every so often: ${(Q.cdc || 0) - cdc0} times in 3s, with a check every 0.4s`);
  const b2 = Q.cdc || 0;
  await jo('POST', '/quickbooks/sync');
  ok((Q.cdc || 0) > b2, 'Sync now asks right away');

  // Earlier invoices, when asked.
  r = await jo('POST', '/quickbooks/earlier');
  ok(await until(() => Q.Invoice.some((x) => x.DocNumber === early.number)), `asked for: ${early.number} from before is copied too`);
  r = await jo('POST', '/quickbooks/sync');
  ok(r.body.copied >= 4 && r.body.waiting === 0 && !r.body.error && r.body.syncedAt, `Sync now: ${r.body.copied} copied, nothing waiting`);
  ok(Q.Customer.filter((x) => x.DisplayName === 'Dana Ruiz').length === 1, 'Dana is one customer there, however many invoices');

  // Kept safe.
  await sleep(700);
  const dbText = fs.readFileSync(DIR + '/db.json', 'utf8');
  ok(!dbText.includes(Q.access) && !dbText.includes(Q.refresh), 'the tokens are kept sealed');
  ok(!/"realmId"\s*:/.test(dbText) && !dbText.includes('"R1"'), 'and so is the company id');
  ok(await new Promise((r) => http.request(B + '/', { method: 'TRACE' }, (x) => { x.resume(); r(x.statusCode === 405); }).on('error', () => r(false)).end()), 'TRACE is turned away');
  ok((await fetch(B + '/api/quickbooks', { headers: { authorization: 'Bearer x' } })).headers.get('cache-control') === 'no-store', 'answers with data aren’t cached');
  ok(!JSON.stringify((await jo('GET', '/quickbooks')).body).includes('rt_'), 'and never sent to the app');

  const dp = await fetch(B + '/quickbooks/disconnected');
  ok(dp.status === 200 && /disconnected from QuickBooks/.test(await dp.text()), 'the page Intuit sends people to after disconnecting there explains it');

  // Disconnecting.
  const lastRefresh = Q.refresh;
  r = await jo('DELETE', '/quickbooks');
  ok(!r.body.connected && Q.revoked.includes(lastRefresh), 'disconnecting tells Intuit to forget the access');
  const before = Q.Invoice.length;
  const inv4 = (await jo('POST', `/records/${job.id}/invoices`)).body;
  await jo('POST', `/invoices/${inv4.id}/send`);
  await sleep(1200);
  ok(Q.Invoice.length === before, 'nothing more is copied');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log(srv.log.slice(-3000));
  srv.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
