// Stock used for a step of a job's work counts for that step (2026-11-18, with column-a9's job steps): a move takes
// its step from its task, or a step named on it when that step is on this job's work (anything else is dropped,
// never trusted). The job's materials say what each step cost, for owners and admins.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_steps';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5216, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Steps ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Steps ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bill Nye · furnace' } })).body;
  const other = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Ann Lee · AC' } })).body;
  const camp = (await rico('POST', '/campaigns', { name: 'Bill Nye work', recordId: job.id })).body;
  const camp2 = (await rico('POST', '/campaigns', { name: 'Ann Lee work', recordId: other.id })).body;
  const gA = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Rough-in', kind: 'tasks' })).body;
  const gB = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Trim-out', kind: 'tasks' })).body;
  const gX = (await rico('POST', '/goals', { campaignId: camp2.id, title: 'Other job step', kind: 'tasks' })).body;
  const a1 = (await rico('POST', '/tasks', { text: 'Run the ducts', goalId: gA.id })).body;
  const fit = (await rico('POST', '/inventory/items', { name: 'Copper fitting', cost: '2.00', onHand: 50 })).body;
  const main = (await rico('GET', '/inventory')).body.places[0];
  const use = (who, extra) => who('POST', '/inventory/moves', { kind: 'use', itemId: fit.id, qty: 10, from: main.id, jobId: job.id, ...extra });

  r = await use(sam, { taskId: a1.id });
  ok(r.status === 200 && r.body.goalId === gA.id, `used for a step’s task: the move is that step’s (${r.body?.goalId})`);
  r = await use(sam, { taskId: a1.id, goalId: gB.id });
  ok(r.body.goalId === gA.id, 'the task’s step wins over one named on the move');
  r = await use(rico, { goalId: gB.id, qty: 5 });
  ok(r.status === 200 && r.body.goalId === gB.id, 'a step named on the move, on this job’s work');
  r = await use(rico, { goalId: gX.id, qty: 1 });
  ok(r.status === 200 && r.body.goalId == null, 'a step on another job’s work is dropped (the stock is still used)');
  r = await rico('POST', '/inventory/moves', { kind: 'use', itemId: fit.id, qty: 1, from: main.id, goalId: gB.id });
  ok(r.status === 200 && r.body.goalId == null, 'no job on the move: no step either');
  r = await rico('POST', '/inventory/moves', { kind: 'return', itemId: fit.id, qty: 4, to: main.id, jobId: job.id, goalId: gB.id });
  ok(r.body.goalId === gB.id, 'brought back from a step');

  const jv = (await rico('GET', '/inventory/job/' + job.id)).body;
  const by = Object.fromEntries((jv.bySteps || []).map((s) => [s.goalId ?? 'none', s]));
  ok(by[gA.id]?.cost === 4000 && by[gA.id]?.title === 'Rough-in', `Rough-in: 20 fittings, $40 (${JSON.stringify(by[gA.id])})`);
  ok(by[gB.id]?.cost === 200 && by[gB.id]?.title === 'Trim-out', `Trim-out: 5 used, 4 back, $2 (${JSON.stringify(by[gB.id])})`);
  ok(by.none?.cost === 200 && jv.cost === 4400, `not for a step: $2; the job’s total still $44 (${jv.cost})`);
  const sv = (await sam('GET', '/inventory/job/' + job.id)).body;
  ok(sv.bySteps?.length === 3 && sv.bySteps.every((s) => s.cost === undefined && s.title !== undefined), 'members see the steps but not the costs');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
