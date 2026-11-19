// Finance, step 4 (the owner, 2026-11-20): what a job cost, kept honest. The price lines' costs are the estimate; actual
// cost is only what really happened (materials used, labor at each person's own rate or the team's, expenses put on
// the job), plus overhead as a percent. No actual costs yet means no margin, not the estimate passed off as actual.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/costing_truth';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5158, B = `http://127.0.0.1:${PORT}`;
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
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Cost ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const ben = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Cost ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  const st = (await ada('GET', '/state')).body;
  const adaId = st.me.memberId, benId = st.workspace.members.find((x) => x.name === 'Ben').id;
  await ada('PATCH', '/workspace', { tools: { bills: true, projects: true } });
  const p = (await ada('POST', '/projects', { template: 'trades', trades: ['blinds'] })).body;
  const bl = p.types.find((x) => x.key === 'trade_blinds');
  const F = (k) => bl.fields.find((f) => f.key === k) || bl.fields.find((f) => f.type === k);
  const itemsF = bl.fields.find((f) => f.type === 'items'), matsF = bl.fields.find((f) => f.type === 'materials');
  const job = (await ada('POST', `/projects/${p.id}/records`, { typeId: bl.id, values: { job: 'Smith shades' } })).body;
  await ada('PATCH', '/records/' + job.id, { values: { [itemsF.id]: { rows: [{ desc: 'Shades', qty: 4, price: 250, cost: 100 }, { desc: 'Install', qty: 1, price: 200, cost: 80 }] } } });
  const cost = async () => (await ada('GET', `/records/${job.id}/costing`)).body;

  // Only the estimate so far.
  let c = await cost();
  ok(c.price === 120000 && c.estimatedCost === 48000 && c.estimatedMargin === 72000 && c.estimatedMarginPct === 60, `the price lines’ costs are the estimate: $480 against $1,200 (${c.estimatedCost})`);
  ok(c.materials === 0 && c.cost === 0 && c.hasActual === false && c.margin === null, 'nothing actual yet: materials $0 and no margin, not the estimate passed off as actual');

  // Actuals: materials used, a visit for two people at their own rates, an expense, overhead.
  await ada('PATCH', '/records/' + job.id, { values: { [matsF.id]: { rows: [{ item: 'Fabric', qty: 4, cost: '110' }] } } });
  const today = new Date().toISOString().slice(0, 10);
  const v = (await ada('POST', `/records/${job.id}/visits`, { kind: 'Install', date: today, start: 540, end: 660, memberIds: [adaId, benId] })).body;
  await ada('PATCH', '/visits/' + v.id, { done: true });
  ok((await ben('PATCH', '/workspace', { laborRates: { [benId]: '99' } })).status === 403, 'only owners and admins set labor rates');
  await ada('PATCH', '/workspace', { laborRate: '40', laborRates: { [benId]: '25', nobody: '5' } });
  c = await cost();
  ok(c.hours === 4 && c.labor === 2 * 4000 + 2 * 2500, `labor: 2 h for Ada at the team’s $40, 2 h for Ben at his $25 = $130 (${c.labor})`);
  ok(c.rates.people[benId] === 2500 && !c.rates.people.nobody, 'Ben’s rate is kept; someone not on the team isn’t');
  await ada('POST', '/money', { kind: 'out', amount: '60', day: today, category: 'Delivery', note: 'Freight', scope: 'business', jobs: [{ recordId: job.id }] });
  await ada('PATCH', '/workspace', { overheadPct: '10' });
  c = await cost();
  ok(c.materials === 44000 && c.expenses === 6000, 'actual materials $440 and the $60 expense');
  ok(c.overheadPct === 10 && c.overhead === 6300 && c.cost === 44000 + 13000 + 6000 + 6300, `overhead 10% on $630 direct = $63; actual cost $693 (${c.cost})`);
  ok(c.hasActual && c.margin === 120000 - 69300 && c.marginPct === 42.3, `actual margin $507 · 42.3% (${c.margin} · ${c.marginPct})`);
  ok(c.estimatedCost === 48000, 'and the estimate is still there beside it');
  const ws = (await ben('GET', '/state')).body.workspace;
  ok(!JSON.stringify(ws).includes('laborRates') && !JSON.stringify(ws).includes('overheadPct'), 'rates and overhead aren’t in what everyone sees');
  await ada('PATCH', '/workspace', { laborRates: { [benId]: '' } });
  ok(!(await cost()).rates.people[benId], 'clearing Ben’s rate goes back to the team’s');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
