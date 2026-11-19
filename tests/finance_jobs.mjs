// Finance, step 1 (the owner, 2026-11-20): money goes on jobs. A business expense or income entry can be for one job,
// or split across several (a $500 supplier run for three jobs), each with its share, without copying the money. The
// job's costing counts its share of expenses, what came in outside invoices, and what's on order from suppliers.
// Only business money goes on a job. Owners and admins put it there; admins see the business money that's on jobs
// (they already see what jobs cost), and nothing else of the business's. Members see none of it.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/finance_jobs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5152, B = `http://127.0.0.1:${PORT}`;
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
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Money ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Money ' + t, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token);
  const ben = await join('Ben', 2), cy = await join('Cy', 3);
  const mem = (await ada('GET', '/state')).body.workspace.members;
  const benId = mem.find((x) => x.name === 'Ben').id;
  await ada('PATCH', '/members/' + benId, { role: 'admin' });
  await ada('PATCH', '/workspace', { tools: { bills: true, projects: true, inventory: true } });
  const p = (await ada('POST', '/projects', { template: 'trades', trades: ['blinds'] })).body;
  const bl = p.types.find((x) => x.key === 'trade_blinds');
  const job = async (name) => (await ada('POST', `/projects/${p.id}/records`, { typeId: bl.id, values: { job: name } })).body;
  const smith = await job('Smith shades'), jones = await job('Jones shades'), lee = await job('Lee shades');
  const today = new Date().toISOString().slice(0, 10);
  const cost = async (who, rec) => (await who('GET', `/records/${rec.id}/costing`)).body;

  // One job.
  let r = await ada('POST', '/money', { kind: 'out', amount: '120', day: today, category: 'Delivery', note: 'Freight', scope: 'business', jobs: [{ recordId: smith.id }] });
  ok(r.status === 200 && r.body.jobs?.length === 1 && r.body.jobs[0].recordId === smith.id && r.body.jobs[0].amount === 12000, 'an expense on one job takes the whole amount');
  const freight = r.body;
  let c = await cost(ada, smith);
  ok(c.expenses === 12000 && c.cost >= 12000 && c.entries.length === 1 && c.entries[0].note === 'Freight', `the job’s costing counts it (${c.expenses})`);

  // Split across three, without copying it.
  r = await ada('POST', '/money', { kind: 'out', amount: '500', day: today, category: 'Materials', note: 'Supplier run', scope: 'business', jobs: [{ recordId: smith.id, amount: '200' }, { recordId: jones.id }, { recordId: lee.id }] });
  ok(r.status === 200 && r.body.jobs.map((j) => j.amount).join() === '20000,15000,15000', `a $500 run split: $200 to Smith, the rest evenly (${r.body.jobs?.map((j) => j.amount)})`);
  const run = r.body;
  ok((await ada('GET', '/state')).body.money.filter((x) => x.note === 'Supplier run').length === 1, 'it’s one entry in Finance, not three');
  ok((await cost(ada, jones)).expenses === 15000 && (await cost(ada, smith)).expenses === 32000, 'each job counts its share');
  ok((await ada('POST', '/money', { kind: 'out', amount: '100', day: today, scope: 'business', jobs: [{ recordId: smith.id, amount: '80' }, { recordId: jones.id, amount: '40' }] })).status === 400, 'shares can’t add up to more than the amount');
  ok((await ada('POST', '/money', { kind: 'out', amount: '10', day: today, scope: 'personal', jobs: [{ recordId: smith.id }] })).status === 400, 'personal money can’t go on a job');
  ok((await ada('POST', '/money', { kind: 'out', amount: '10', day: today, scope: 'business', jobs: [{ recordId: 'nope' }] })).status === 400, 'nor on a job that isn’t there');

  // Changing it.
  r = await ada('PATCH', '/money/' + freight.id, { amount: '150' });
  ok(r.body?.jobs?.[0]?.amount === 15000, 'a one-job expense follows its amount');
  ok((await ada('PATCH', '/money/' + run.id, { amount: '300' })).status === 400, 'a split one can’t shrink below its shares');
  r = await ada('PATCH', '/money/' + run.id, { amount: '300', jobs: [{ recordId: smith.id }, { recordId: jones.id }] });
  ok(r.status === 200 && r.body.jobs.map((j) => j.amount).join() === '15000,15000' && (await cost(ada, lee)).expenses === 0, 'split again two ways: Lee’s share is gone');

  // Income on a job outside an invoice (a cash deposit).
  await ada('POST', '/money', { kind: 'in', amount: '400', day: today, category: 'Deposit', note: 'Cash deposit', scope: 'business', jobs: [{ recordId: jones.id }] });
  c = await cost(ada, jones);
  ok(c.income === 40000 && c.received >= 40000, 'a deposit logged on the job counts as received');

  // What's on order for the job.
  const it = (await ada('POST', '/inventory/items', { name: 'Fabric roll', unit: 'roll', cost: '90', supplier: 'Acme' })).body;
  const ord = await ada('POST', '/inventory/orders', { supplier: 'Acme', jobId: smith.id, lines: [{ itemId: it.id, qty: 2 }] });
  c = await cost(ada, smith);
  ok(ord.status === 200 && c.committed === 18000, `on order from a supplier, not in yet: committed (${ord.status} ${c.committed})`);

  // Who sees what.
  const benMoney = (await ben('GET', '/state')).body.money;
  ok(benMoney.some((x) => x.id === run.id) && benMoney.some((x) => x.id === freight.id), 'Ben (admin) sees the business money that’s on jobs');
  await ada('POST', '/money', { kind: 'out', amount: '2000', day: today, category: 'Rent', note: 'Shop rent', scope: 'business' });
  ok(!(await ben('GET', '/state')).body.money.some((x) => x.note === 'Shop rent'), 'but not the rest of the business’s money');
  ok((await cost(ben, smith)).expenses > 0, 'and his costing shows the job’s expenses');
  r = await ben('POST', '/money', { kind: 'out', amount: '35', day: today, category: 'Fuel', note: 'Gas to Lee', scope: 'business', jobs: [{ recordId: lee.id }] });
  ok(r.status === 200 && r.body.scope === 'business', 'Ben can put a business expense on a job');
  ok((await ben('POST', '/money', { kind: 'out', amount: '35', day: today, scope: 'business' })).body?.scope === 'personal', 'but business money that isn’t on a job stays the owners’');
  ok((await ben('PATCH', '/money/' + freight.id, { jobs: [] })).status === 400, 'and he can’t take an owner’s entry off its job');
  ok(!(await cy('GET', '/state')).body.money.some((x) => x.scope === 'business'), 'Cy (member) sees none of the business’s money');
  ok((await cy('POST', '/money', { kind: 'out', amount: '5', day: today, scope: 'business', jobs: [{ recordId: smith.id }] })).status === 400, 'and can’t put money on a job');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
