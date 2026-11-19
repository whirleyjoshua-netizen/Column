// Workload forecast (job plan Phase 5, the owner 2026-11-18): the weeks ahead from the real work. Each person's
// load by day and week, from tasks (their due date; else their step's or campaign's date, as an estimate), booked
// visits and appointments, with overloaded days and double bookings; work nobody is on; what the coming steps need
// (materials against stock and orders, gear against what's free, visits not booked yet); and the jobs likely to fall
// behind. Every number can be opened into the tasks and visits behind it, but what a viewer can't see is only counted.
// Owners and admins, like the team's workload it extends (GET /workload).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/forecast';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5226, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-time-zone': 'UTC', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null), raw: '' };
};
const t = Date.now();
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Shades ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Shades ' + t, code: st.workspace.inviteCode, name, email: `${n}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: n })).body.token);
  const sam = await join('Sam Reed', 'sam'), ben = await join('Ben Cho', 'ben');
  st = (await rico('GET', '/state')).body;
  const id = (name) => st.workspace.members.find((m) => m.name === name).id;
  const ricoId = id('Rico Vega'), samId = id('Sam Reed'), benId = id('Ben Cho');
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const mk = async (name) => (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: name, [statusF.id]: statusF.choices[0].id } })).body;
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 1' })).body;
  const wire = (await rico('POST', '/inventory/items', { name: 'Copper line set', unit: 'ft' })).body;
  await rico('POST', '/inventory/moves', { kind: 'receive', itemId: wire.id, qty: 10, to: truck.id });
  await rico('POST', '/inventory/orders', { supplier: 'Coastal', lines: [{ itemId: wire.id, qty: 5 }] });
  const vac = (await rico('POST', '/inventory/items', { name: 'Vacuum pump', track: 'units' })).body;
  const pump = (await rico('POST', `/inventory/items/${vac.id}/units`, { name: 'Pump A', place: truck.id })).body;

  // Job A: Rough-in (due in 3 days) and Install (needs 25 ft of line set, the vacuum pump and an Install visit).
  const jobA = await mk('Bill Nye · new unit');
  const ca = (await rico('POST', '/campaigns', { name: 'Bill Nye install', recordId: jobA.id, end: day(20) })).body;
  const g1 = (await rico('POST', '/goals', { campaignId: ca.id, title: 'Rough-in', kind: 'tasks', due: day(3) })).body;
  const T1 = (await rico('POST', '/tasks', { text: 'Run the line set', goalId: g1.id, assigneeId: samId, due: day(2) })).body;
  const T2 = (await rico('POST', '/tasks', { text: 'Mount the bracket', goalId: g1.id, assigneeId: samId })).body;
  const T3 = (await rico('POST', '/tasks', { text: 'Pull the permit', goalId: g1.id, due: day(2) })).body;
  const T5 = (await rico('POST', '/tasks', { text: 'Measure the room', goalId: g1.id, assigneeId: samId, due: day(-1) })).body;
  const g2 = (await rico('POST', '/goals', { campaignId: ca.id, title: 'Install', kind: 'tasks' })).body;
  await rico('PATCH', `/goals/${g2.id}`, { needs: [{ kind: 'stock', itemId: wire.id, qty: 25 }, { kind: 'equipment', itemId: vac.id }, { kind: 'visit', visit: 'Install' }] });
  const T4 = (await rico('POST', '/tasks', { text: 'Set the unit', goalId: g2.id, assigneeId: benId, due: day(9) })).body;

  // Job B: the pump is out on it, and Sam is double booked on day 2 (an 8-hour Install on A, then 2 hours on B).
  const jobB = await mk('Ann Lee · repair');
  await rico('POST', `/inventory/units/${pump.id}/act`, { act: 'checkout', jobId: jobB.id });
  const vA = (await rico('POST', `/records/${jobA.id}/visits`, { kind: 'Measure', date: day(2), start: 540, end: 1020, memberIds: [samId] })).body;
  const vB = (await rico('POST', `/records/${jobB.id}/visits`, { kind: 'Repair', date: day(2), start: 960, end: 1080, memberIds: [samId] })).body;
  ok(!!vA?.id && !!vB?.id, '(setup) two visits for Sam on day 2: ' + JSON.stringify([vA?.id || vA, vB?.id || vB]));

  // Ben's private campaign: Rico (not in it) gets the count, never the words.
  const cb = (await ben('POST', '/campaigns', { name: 'Ben private', private: true })).body;
  const gb = (await ben('POST', '/goals', { campaignId: cb.id, title: 'Quiet', kind: 'tasks' })).body;
  await ben('POST', '/tasks', { text: 'Secret thing', goalId: gb.id, assigneeId: benId, due: day(1) });
  // A job with nothing wrong.
  const jobC = await mk('Cy Fox · tune-up');
  const cc = (await rico('POST', '/campaigns', { name: 'Cy Fox tune-up', recordId: jobC.id, end: day(30) })).body;
  const gc = (await rico('POST', '/goals', { campaignId: cc.id, title: 'Tune-up', kind: 'tasks' })).body;
  await rico('POST', '/tasks', { text: 'Check the filters', goalId: gc.id, assigneeId: benId, due: day(5) });

  r = await sam('GET', '/forecast');
  ok(r.status === 403, 'a member can’t see the team’s forecast: ' + r.status);
  r = await rico('GET', '/forecast?weeks=4');
  ok(r.status === 200 && r.body?.weeks?.length === 4 && r.body.days?.length === 28 && r.body.days[0] === r.body.weeks[0], 'four weeks ahead, by day, from this week’s Sunday: ' + r.status + ' ' + (r.body?.error || r.body?.weeks?.join()));
  const F = r.body;
  const raw = JSON.stringify(F);
  const P = (mid) => F.people.find((x) => x.id === mid);
  const di = (n) => F.days.indexOf(day(n));
  const wi = (n) => F.weeks.filter((w) => w <= day(n)).length - 1;
  const items = (f) => F.items.filter(f);
  const it = (taskId) => F.items.find((x) => x.taskId === taskId);

  // Tasks: confirmed (given and dated), estimated (dated from the step or campaign), nobody on it, overdue.
  ok(it(T1.id)?.status === 'confirmed' && it(T1.id).day === day(2) && it(T1.id).memberIds.join() === samId, 'a task given to Sam with a due date is confirmed, on that day');
  ok(it(T2.id)?.status === 'estimated' && it(T2.id).day === day(3) && /step/.test(it(T2.id).dateFrom), 'a task with no date is estimated from its step’s date: ' + JSON.stringify(it(T2.id)));
  ok(it(T3.id)?.status === 'unassigned' && !it(T3.id).memberIds.length, 'a task in a campaign nobody is on is unassigned, not its maker’s: ' + JSON.stringify(it(T3.id)));
  ok(F.unassigned.total === 1 && F.unassigned.perWeek[wi(2)] === 1, 'and counted as work nobody is on: ' + JSON.stringify(F.unassigned));
  ok(it(T5.id)?.status === 'overdue' && it(T5.id).day === day(-1), 'an overdue task is overdue');
  ok(it(T1.id).jobId === jobA.id && it(T1.id).jobName === 'Bill Nye · new unit' && it(T1.id).campaignId === ca.id && it(T1.id).goalId === g1.id && it(T1.id).step === 'Rough-in', 'each item says its job, campaign and step');

  // Per person, by day and week.
  const sp = P(samId);
  ok(sp && sp.days.length === 28 && sp.weeks.length === 4, 'Sam has a row for every day and week');
  ok(sp.days[di(2)].min === 600 && sp.days[di(2)].tasks === 1 && sp.days[di(2)].over, 'day 2: 10 hours booked (over 8) and a task due: overloaded: ' + JSON.stringify(sp.days[di(2)]));
  ok(sp.overdue === 1, 'Sam has 1 overdue: ' + sp.overdue);
  const cf = F.conflicts.find((x) => x.memberId === samId && x.day === day(2));
  ok(cf && cf.visits?.length === 2 && cf.visits.some((v) => v.id === vA.id) && cf.visits.some((v) => v.id === vB.id), 'the two visits that overlap are a conflict: ' + JSON.stringify(cf));
  const bp = P(benId);
  ok(bp.weeks[wi(9)].tasks >= 1 && items((x) => x.memberIds.includes(benId) && x.day === day(9)).length === 1, 'Ben’s Install task lands in its week');
  ok(bp.days[di(1)].tasks === 1, 'Ben’s private task is counted on its day');
  const hid = items((x) => x.memberIds.includes(benId) && x.day === day(1))[0];
  ok(hid?.hidden && !hid.text && !hid.campaignId && !/Secret thing|Ben private|Quiet/.test(raw), 'but Rico, who can’t see that campaign, gets no words or links for it: ' + JSON.stringify(hid));
  ok(!P(ricoId) || P(ricoId).weeks.every((w) => !w.tasks), 'Rico, who made the tasks, isn’t loaded with them: ' + JSON.stringify(P(ricoId)?.weeks));
  ok(F.capacityMin === 480, 'a day is 8 hours: ' + F.capacityMin);

  // What the coming steps need.
  const rs = F.resources.find((x) => x.itemId === wire.id);
  ok(rs && rs.need === 25 && rs.onHand === 10 && rs.onOrder === 5 && rs.short === 10 && rs.steps?.[0]?.goalId === g2.id, 'materials: 25 ft needed, 10 on hand, 5 on order, 10 short, for Install: ' + JSON.stringify(rs));
  const eq = F.equipment.find((x) => x.itemId === vac.id);
  ok(eq && eq.need === 1 && eq.free === 0 && eq.short === 1, 'gear: the pump is needed and none is free: ' + JSON.stringify(eq));
  const tb = F.visitsToBook.find((x) => x.goalId === g2.id);
  ok(tb && tb.kind === 'Install' && tb.jobId === jobA.id, 'a visit a step needs and nobody has booked: ' + JSON.stringify(tb));

  // Jobs likely to fall behind, with why; a job with nothing wrong isn't one.
  const ar = F.atRisk.find((x) => x.jobId === jobA.id);
  ok(ar && ar.reasons.some((x) => x.kind === 'overdue') && ar.reasons.some((x) => x.kind === 'short') && ar.reasons.some((x) => x.kind === 'unassigned'), 'Bill Nye is at risk: overdue work, short of materials, work nobody is on: ' + JSON.stringify(ar?.reasons?.map((x) => x.kind)));
  ok(!F.atRisk.some((x) => x.jobId === jobC.id), 'Cy Fox isn’t');

  // The team's week (GET /workload) agrees: work nobody is on isn't its maker's.
  const sunday = F.weeks[0];
  const wl = (await rico('GET', '/workload?week=' + sunday)).body;
  const wr = wl.people.find((x) => x.id === ricoId);
  ok(wr.open === 0 && wl.unassigned === 1, 'the team’s week no longer counts Rico for the task nobody is on, and says 1 has nobody: ' + JSON.stringify([wr.open, wl.unassigned]));
  ok(wl.people.find((x) => x.id === samId).open === 3, 'Sam still has his 3');
} catch (e) { ok(false, 'threw ' + e.stack); }
srv.kill();
if (fails) console.log(srv.log.split("\n").slice(-60).join("\n"));
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
