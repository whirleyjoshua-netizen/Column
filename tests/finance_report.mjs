// Finance, step 4b (the owner, 2026-11-20): Reports. Profit and loss for any dates, from the business's money only:
// money in by category, spending by category and tax category (a likely one from its name, or the team's pick),
// what's deductible, miles driven, and the share of profit the team chose to set aside for taxes. Owners and admins.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/finance_report';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5160, B = `http://127.0.0.1:${PORT}`;
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
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Rep ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const cy = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Rep ' + t, code, name: 'Cy', email: `cy${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' })).body.token);
  await ada('PATCH', '/workspace', { tools: { bills: true, map: true } });
  const m = (day, kind, amount, category, scope = 'business') => ada('POST', '/money', { kind, amount, day, category, note: category, scope });
  await m('2026-10-05', 'in', '5000', 'Sales');
  await m('2026-10-09', 'in', '1000', 'Client payment');
  await m('2026-10-10', 'out', '800', 'Fuel');
  await m('2026-10-12', 'out', '1200', 'Rent');
  await m('2026-10-15', 'out', '300', 'Software');
  await m('2026-10-20', 'out', '200', 'Owner draw');
  await m('2026-10-21', 'out', '99', 'Groceries', 'personal');
  await m('2026-11-02', 'in', '700', 'Sales');
  const trip = await ada('POST', '/mileage', { date: '2026-10-11', from: 'Shop', to: 'Smith', meters: 30 * 1609.344, how: 'manual', purpose: 'Install' });
  ok(trip.status === 200, '(setup) a 30-mile trip: ' + JSON.stringify(trip.body).slice(0, 120));

  ok((await cy('GET', '/finance/report?from=2026-10-01&to=2026-10-31')).status === 403, 'members can’t see the business’s reports');
  ok((await ada('GET', '/finance/report?from=2026-10-31&to=2026-10-01')).status === 400, 'dates the wrong way round are turned away');
  const r = await ada('GET', '/finance/report?from=2026-10-01&to=2026-10-31');
  let x = r.body;
  ok(r.status === 200 && x.income === 600000 && x.incomeBy.length === 2, `October: $6,000 in, from Sales and Client payment (${x.income})`);
  const outs = Object.fromEntries(x.expensesBy.map((e) => [e.name, e]));
  ok(!outs.Groceries, 'personal money isn’t in the business’s report');
  ok(outs.Fuel?.taxLine === 'Car & truck' && outs.Rent?.taxLine === 'Rent' && outs.Software?.taxLine === 'Office & software' && outs['Owner draw']?.taxLine === 'Not deductible', 'spending gets a likely tax category from its name');
  const mile = x.expensesBy.find((e) => e.name === 'Mileage');
  ok(x.distance === 30 && x.trips === 1 && (!mile || mile.taxLine === 'Car & truck'), `30 miles on 1 trip, and a trip that’s an expense goes under Car & truck (${x.distance} ${x.unit})`);
  ok(x.expenses === 250000 + (mile?.amount || 0) && x.deductible === x.expenses - 20000 && x.net === 600000 - x.deductible, `profit after what’s deductible: $${x.net / 100}`);
  ok(x.setAside === 0 && x.taxPct === 0, 'no set-aside until the team picks one');

  // The team's own choices.
  ok((await cy('PATCH', '/workspace', { taxPct: '25' })).status === 403, 'only owners and admins set it up');
  await ada('PATCH', '/workspace', { taxPct: '25', taxLines: { Software: 'Supplies & materials', Fuel: 'not a line' } });
  x = (await ada('GET', '/finance/report?from=2026-10-01&to=2026-10-31')).body;
  ok(x.expensesBy.find((e) => e.name === 'Software').taxLine === 'Supplies & materials' && x.expensesBy.find((e) => e.name === 'Fuel').taxLine === 'Car & truck', 'a category goes where the team puts it (and a made-up tax category is ignored)');
  ok(x.taxPct === 25 && x.setAside === Math.round(x.net * 0.25), `set aside 25% of profit: $${x.setAside / 100}`);
  x = (await ada('GET', '/finance/report?from=2026-10-01&to=2026-12-31')).body;
  ok(x.income === 670000, 'a quarter takes in November too');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
