// What a step needs (job plan Phase 4, the owner 2026-11-18). Besides its tasks, a step of a job's campaign can list
// what it needs: materials (an item and how many, used on the job for this step), equipment (checked out to the job),
// a visit of a kind (done), or a field on the job filled in (a signature, photos). Each is ticked off by what really
// happens, the step isn't finished (and the job doesn't move to its stage) until they're all met, and an owner can
// tick one off by hand. Once met, materials, equipment and visits stay met (gear brought back doesn't reopen it).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobneeds';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5220, B = `http://127.0.0.1:${PORT}`;
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Shades ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Shades ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const [s0, s1] = statusF.choices;
  const noteF = tp.fields.find((f) => f.type === 'text' && f.id !== tp.primary && f.key !== 'status');
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bill Nye · new unit', [statusF.id]: s0.id } })).body;
  // Sam works this job: he's its crew (only whoever a job is assigned to, its maker and admins move it: tests/job_lock.mjs).
  { const st0 = (await rico('GET', '/state')).body; const sid = st0.workspace.members.find((m) => m.name.startsWith('Sam')).id; await rico('PATCH', '/records/' + job.id, { values: { [tp.fields.find((f) => f.type === 'person').id]: sid } }); }
  const stageOf = async () => (await rico('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === job.id)?.values[statusF.id];
  ok(!!noteF, '(setup) a job with a text field: ' + noteF?.name);

  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 1' })).body;
  const wire = (await rico('POST', '/inventory/items', { name: 'Copper line set', unit: 'ft', cost: 2 })).body;
  const vac = (await rico('POST', '/inventory/items', { name: 'Vacuum pump', track: 'units' })).body;
  r = await rico('POST', '/inventory/moves', { kind: 'receive', itemId: wire.id, qty: 100, to: truck.id });
  const pump = (await rico('POST', `/inventory/items/${vac.id}/units`, { name: 'Pump A', place: truck.id })).body;
  ok(!!truck.id && !!wire.id && !!pump.id && r.status === 200, '(setup) a truck with 100 ft of line set and a vacuum pump');

  const camp = (await rico('POST', '/campaigns', { name: 'Bill Nye install', recordId: job.id })).body;
  const g = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Install', kind: 'tasks', stage: s1.label })).body;
  const task = (await rico('POST', '/tasks', { text: 'Set the unit', goalId: g.id })).body;

  // Listing what it needs.
  r = await rico('PATCH', `/goals/${g.id}`, { needs: [{ kind: 'stock', itemId: 'nope', qty: 2 }] });
  ok(r.status === 400, 'an item that isn’t in inventory is refused: ' + r.body?.error);
  r = await rico('PATCH', `/goals/${g.id}`, { needs: [{ kind: 'stock', itemId: wire.id, qty: 25 }, { kind: 'equipment', itemId: vac.id }, { kind: 'visit', visit: 'Estimate' }, { kind: 'field', field: noteF.name }] });
  ok(r.status === 200 && r.body.needs?.length === 4 && r.body.needs.every((n) => n.id && n.met === false), 'a step lists what it needs: materials, equipment, a visit, a field: ' + JSON.stringify(r.body?.needs?.map((n) => [n.kind, n.met])));
  ok(r.body.needs[0].item === 'Copper line set' && r.body.needs[0].unit === 'ft' && r.body.needs[0].have === 0, 'with the item’s name and how much was used so far');
  const needs = r.body.needs;

  // Tasks done but needs open: not finished, and the job is held.
  await sam('PATCH', `/tasks/${task.id}`, { done: true });
  await sleep(400);
  ok((await stageOf()) === s0.id, 'its tasks done but its needs not met: the job doesn’t move on');
  r = await sam('PATCH', `/records/${job.id}`, { values: { [statusF.id]: s1.id } });
  ok(r.status === 409 && r.body?.steps?.[0]?.needs === 4 && /what’s left/.test(r.body.error), 'and can’t be moved there, the step saying what it still needs: ' + r.status + ' ' + r.body?.error);

  // Materials: only what's used for this step counts.
  await sam('POST', '/inventory/moves', { kind: 'use', itemId: wire.id, qty: 10, from: truck.id, jobId: job.id });
  await sam('POST', '/inventory/moves', { kind: 'use', itemId: wire.id, qty: 15, from: truck.id, jobId: job.id, taskId: task.id });
  const goal = async () => (await rico('GET', '/state')).body.goals.find((x) => x.id === g.id);
  ok(await until(async () => (await goal()).needs[0].have === 15), 'stock used for the step’s task counts for it (stock used on the job for nothing in particular doesn’t)');
  ok(!(await goal()).needs[0].met, '15 of 25 ft: not met yet');
  // On order (column-02's supplier orders): an open order for this step shows on the need, one for nothing in particular as on order anywhere.
  r = await rico('POST', '/inventory/orders', { supplier: 'Coastal', lines: [{ itemId: wire.id, qty: 5 }] });
  ok(r.status === 200, '(setup) an order not for the step: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  let n0 = (await goal()).needs[0];
  ok(n0.ordered === 0 && n0.onOrder === 5, 'a stock need shows what’s on order anywhere, but none of it for this step: ' + n0.ordered + ' / ' + n0.onOrder);
  const ord = (await rico('POST', '/inventory/orders', { supplier: 'Coastal', lines: [{ itemId: wire.id, qty: 10 }], jobId: job.id, goalId: g.id })).body;
  n0 = (await goal()).needs[0];
  ok(n0.ordered === 10 && n0.onOrder === 15 && !n0.met, 'an order placed for the step shows on its need, and on order isn’t met: ' + n0.ordered + ' / ' + n0.onOrder + ' ' + n0.met);
  await rico('POST', `/inventory/orders/${ord.id || ord.order?.id}/cancel`);
  ok((await goal()).needs[0].ordered === 0, 'cancelled, it’s off the need');
  await sam('POST', '/inventory/moves', { kind: 'use', itemId: wire.id, qty: 10, from: truck.id, jobId: job.id, goalId: g.id });
  ok(await until(async () => (await goal()).needs[0].met), 'stock used on the job for the step: 25 of 25 ft, met');

  // Equipment: checked out to the job, and it stays met when brought back.
  await sam('POST', `/inventory/units/${pump.id}/act`, { act: 'checkout', jobId: job.id });
  ok(await until(async () => (await goal()).needs[1].met), 'the vacuum pump checked out to the job: met');
  await sam('POST', `/inventory/units/${pump.id}/act`, { act: 'return', place: truck.id });
  await sleep(300);
  ok((await goal()).needs[1].met, 'brought back: still met');

  // A visit of that kind, done.
  const v = (await sam('POST', `/records/${job.id}/visits`, { kind: 'Estimate', date: '2026-12-01', start: 540 })).body;
  await sleep(300);
  ok(!(await goal()).needs[2].met, 'an estimate visit booked isn’t enough');
  await sam('PATCH', `/visits/${v.id}`, { done: true });
  ok(await until(async () => (await goal()).needs[2].met), 'the visit done: met (an Estimate visit, which doesn’t move the job by itself)');

  // Ticking by hand: owners only.
  r = await sam('PATCH', `/goals/${g.id}`, { got: { [needs[3].id]: true } });
  ok(r.status === 403, 'a member can’t tick a need off by hand: ' + r.status);
  ok((await stageOf()) === s0.id, 'one need still open: the job still waits');

  // The last one: a field on the job filled in finishes the step and moves the job.
  await sam('PATCH', `/records/${job.id}`, { values: { [noteF.id]: 'Unit set, line set brazed' } });
  ok(await until(async () => (await stageOf()) === s1.id), `the job’s ${noteF.name} filled in: every need met, the job moves to ${s1.label}`);

  // An owner ticks one by hand; clearing the field reopens without it.
  await sam('PATCH', `/records/${job.id}`, { values: { [statusF.id]: s0.id, [noteF.id]: '' } });
  ok(await until(async () => !(await goal()).needs[3].met), 'the field cleared: that need is open again');
  r = await rico('PATCH', `/goals/${g.id}`, { got: { [needs[3].id]: true } });
  ok(r.status === 200 && r.body.needs[3].met && r.body.needs[3].got?.by === 'Rico Vega', 'an owner can tick it off by hand, and it says who');
  ok(await until(async () => (await stageOf()) === s1.id), 'and the job moves on');

  // Editing the list keeps what's met.
  r = await rico('PATCH', `/goals/${g.id}`, { needs: (await goal()).needs.map(({ id, kind, itemId, qty, visit, field }) => ({ id, kind, itemId, qty, visit, field })) });
  ok(r.status === 200 && r.body.needs.every((n) => n.met), 'saving the list again keeps what’s met');
  r = await rico('PATCH', `/goals/${g.id}`, { needs: [...r.body.needs.map(({ id, kind, itemId, qty, visit, field }) => ({ id, kind, itemId, qty: kind === 'stock' ? 40 : qty, visit, field }))] });
  ok(r.status === 200 && !r.body.needs[0].met && r.body.needs[0].have === 25, 'asking for more (40 ft) opens it again, counting what’s been used');

  // An automation that uses stock when a step is finished runs once, and a person finishing a step right after still
  // sets it off (an automation's look at the steps and a person's are never folded together, column-02 2026-11-18).
  const auto = (await rico('POST', '/automations', { name: 'Step done: use a fitting', trigger: { kind: 'step.done' }, actions: [{ kind: 'stock', act: 'use', itemId: wire.id, qty: 1, from: truck.id }] })).body;
  ok(!!auto?.id, '(setup) an automation: when a step is finished, use 1 ft on the job ' + (auto?.error || ''));
  const gC = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Check', kind: 'tasks' })).body;
  const gD = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Clean up', kind: 'tasks' })).body;
  const tC = (await rico('POST', '/tasks', { text: 'Check pressures', goalId: gC.id })).body;
  const tD = (await rico('POST', '/tasks', { text: 'Sweep up', goalId: gD.id })).body;
  await sleep(300);
  await sam('PATCH', `/tasks/${tC.id}`, { done: true });
  const runsOf = async () => (await rico('GET', '/automations')).body.find((x) => x.id === auto.id)?.runs || [];
  ok(await until(async () => (await runsOf()).length >= 1), 'a person finishing a step sets it off');
  await sam('PATCH', `/tasks/${tD.id}`, { done: true });
  ok(await until(async () => (await runsOf()).length >= 2), 'and finishing the next one right after sets it off again');
  await sleep(1200);
  const used = (await rico('GET', `/inventory/job/${job.id}`)).body;
  ok((await runsOf()).length === 2 && (await runsOf()).every((x) => x.ok), 'two runs, no more: what the automation does doesn’t set it off again: ' + JSON.stringify((await runsOf()).map((x) => x.note)));
  ok(used.bySteps?.find((x) => x.goalId === gC.id) && used.bySteps?.find((x) => x.goalId === gD.id), 'and the stock it used counts for the step that set it off');

  // An automation's change that finishes another step doesn't set the automation off again, even when a person's
  // change lands in the same moment (column-02's case: E needs the job's field, the automation on C's step.done fills it).
  await rico('PATCH', `/automations/${auto.id}`, { on: false });
  const job2 = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Ann Lee · tune-up', [statusF.id]: s0.id } })).body;
  const camp2 = (await rico('POST', '/campaigns', { name: 'Ann Lee tune-up', recordId: job2.id })).body;
  const gC2 = (await rico('POST', '/goals', { campaignId: camp2.id, title: 'Check', kind: 'tasks' })).body;
  const gE2 = (await rico('POST', '/goals', { campaignId: camp2.id, title: 'Write up', kind: 'tasks', stage: s1.label })).body;
  const tC2 = (await rico('POST', '/tasks', { text: 'Check the filter', goalId: gC2.id })).body;
  const tE2 = (await rico('POST', '/tasks', { text: 'Note what was done', goalId: gE2.id })).body;
  await rico('PATCH', `/goals/${gE2.id}`, { needs: [{ kind: 'field', field: noteF.name }] });
  await rico('PATCH', `/tasks/${tE2.id}`, { done: true });
  const auto2 = (await rico('POST', '/automations', { name: 'Step done: note it', trigger: { kind: 'step.done', campaignId: camp2.id }, actions: [{ kind: 'record', projectId: p.id, typeId: tp.id, set: [{ field: noteF.id, value: 'Checked by {who}' }] }] })).body;
  ok(!!auto2?.id, '(setup) a step that needs the job’s note, and an automation that fills it when a step is finished ' + (auto2?.error || ''));
  await sleep(300);
  await Promise.all([sam('POST', '/inventory/moves', { kind: 'use', itemId: wire.id, qty: 1, from: truck.id, jobId: job2.id }), sam('PATCH', `/tasks/${tC2.id}`, { done: true })]);
  const gState = async (id) => (await rico('GET', '/state')).body.goals.find((x) => x.id === id);
  ok(await until(async () => (await gState(gE2.id))?.finished === true), 'the automation’s note finishes the step that needed it');
  await sleep(1500);
  const runs2 = (await rico('GET', '/automations')).body.find((x) => x.id === auto2.id)?.runs || [];
  ok(runs2.length === 1, 'and the automation ran once: the step its own change finished didn’t set it off again: ' + runs2.length);
  // Only automations are held back: the step the automation finished still moves the job and finishes the campaign.
  const st2 = (await rico('GET', '/state')).body;
  ok((await rico('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === job2.id)?.values[statusF.id] === s1.id, `the step it finished still moves the job to ${s1.label}`);
  ok(st2.campaigns.find((c) => c.id === camp2.id)?.status === 'done', 'and, its last step, finishes the job’s campaign');

  // A step with needs on a campaign without a job isn't held by them.
  const free = (await rico('POST', '/campaigns', { name: 'Shop tidy' })).body;
  const g2 = (await rico('POST', '/goals', { campaignId: free.id, title: 'Tidy', kind: 'tasks' })).body;
  const t2 = (await rico('POST', '/tasks', { text: 'Sweep', goalId: g2.id })).body;
  await rico('PATCH', `/goals/${g2.id}`, { needs: [{ kind: 'visit', visit: 'Install' }] });
  await rico('PATCH', `/tasks/${t2.id}`, { done: true });
  ok(await until(async () => (await rico('GET', '/state')).body.goals.find((x) => x.id === g2.id)?.finished === true), 'without a job, needs don’t hold a step up');

  // Saved campaigns keep what each step needs.
  r = await rico('POST', '/templates', { campaignId: camp.id, name: 'HVAC install' });
  const tpl = r.body;
  ok(r.status === 200 && JSON.stringify(tpl).includes('Vacuum pump') || JSON.stringify(tpl).includes(vac.id), 'a saved campaign keeps what its steps need');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
} finally {
  srv.kill();
  if (fails) console.log(srv.log.slice(-3000));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
