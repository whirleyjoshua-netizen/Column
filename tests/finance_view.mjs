// Finance, step 2 (the owner, 2026-11-20): Finance is the business's view. The business's money, bills and budgets
// are for owners and admins (the same rule as invoices and what jobs cost); personal money stays its owner's; members
// see none of the business's. Finance lists every quote the team has sent, and every invoice.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/finance_view';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5154, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-time-zone': 'UTC', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'View ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'View ' + t, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token);
  const ben = await join('Ben', 2), cy = await join('Cy', 3);
  const benId = (await ada('GET', '/state')).body.workspace.members.find((x) => x.name === 'Ben').id;
  await ada('PATCH', '/members/' + benId, { role: 'admin' });
  await ada('PATCH', '/workspace', { tools: { bills: true, projects: true } });
  const today = new Date().toISOString().slice(0, 10);

  // The business's money: owners and admins.
  await ada('POST', '/money', { kind: 'out', amount: '2000', day: today, category: 'Rent', note: 'Shop rent', scope: 'business' });
  await ada('POST', '/money', { kind: 'out', amount: '12', day: today, category: 'Food', note: 'Ada lunch', scope: 'personal' });
  await ada('POST', '/bills', { name: 'Insurance', amount: '300', due: today, repeat: 'monthly', scope: 'business' });
  let st = (await ben('GET', '/state')).body;
  ok(st.money.some((x) => x.note === 'Shop rent') && st.bills.some((x) => x.name === 'Insurance'), 'Ben (admin) sees the business’s money and bills');
  ok(!st.money.some((x) => x.note === 'Ada lunch'), 'but not Ada’s personal money');
  st = (await cy('GET', '/state')).body;
  ok(!st.money.some((x) => x.scope === 'business') && !st.bills.some((x) => x.scope === 'business'), 'Cy (member) sees none of the business’s');
  let r = await ben('POST', '/money', { kind: 'in', amount: '500', day: today, category: 'Sales', note: 'Walk-in', scope: 'business' });
  ok(r.body?.scope === 'business', 'Ben can add the business’s money');
  ok((await cy('POST', '/money', { kind: 'in', amount: '5', day: today, scope: 'business' })).body?.scope === 'personal', 'Cy can’t: his stays personal');
  r = await ben('PUT', '/budgets', { scope: 'business', category: 'Fuel', limit: '400' });
  ok(r.status === 200 && (r.body?.scope || r.body?.budget?.scope) === 'business', 'Ben can set a business budget');
  const rent = (await ben('GET', '/state')).body.money.find((x) => x.note === 'Shop rent');
  ok((await ben('PATCH', '/money/' + rent.id, { note: 'Shop rent (Nov)' })).body?.note === 'Shop rent (Nov)', 'and fix one of Ada’s business entries');
  ok((await cy('PATCH', '/money/' + rent.id, { note: 'x' })).status === 404, 'Cy can’t reach it');

  // Quotes, team-wide.
  const p = (await ada('POST', '/projects', { template: 'bids', name: 'Estimating' })).body;
  const T = Object.fromEntries(p.types.map((x) => [x.key, x]));
  const add = async (k, values) => (await ada('POST', `/projects/${p.id}/records`, { typeId: T[k].id, values })).body;
  const cl = await add('clients', { name: 'Desert Auto', email: 'maria@x.test' });
  const q1 = await add('quotes', { title: 'Showroom tint', client: cl.id, valid_until: '2099-12-31', items: { rows: [{ desc: 'Film', qty: 2, price: 100 }] } });
  await add('quotes', { title: 'Not sent yet', client: cl.id, items: { rows: [{ desc: 'Film', qty: 1, price: 50 }] } });
  await ada('POST', `/records/${q1.id}/share`, { hours: 0 });
  r = await ben('GET', '/quotes');
  ok(r.status === 200 && r.body.quotes.length === 1, 'Finance’s quotes list has the one that was sent');
  const q = r.body.quotes[0];
  ok(q && q.title === 'Showroom tint' && q.status === 'pending' && q.total === 20000 && q.customer === 'Desert Auto' && q.number, `with its number, customer, total and where it stands (${JSON.stringify(q)})`);
  ok((await cy('GET', '/quotes')).status === 403, 'members can’t see it');
  ok((await ben('GET', '/invoices')).status === 200, 'and the team’s invoices list is there for admins');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
