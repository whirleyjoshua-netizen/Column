// Job Flows Phase 4 §5b (docs/jobflows/PHASE4.md): Gear check-out and Gear check-in steps. Gear is Inventory's
// one-by-one equipment (track 'units'); the steps only point at it. Check-out is done when enough DIFFERENT units of
// each listed item went out to this job within its round (from the unit ledger, so bringing them back doesn't undo
// it); check-in is done when its check-out is done and nothing is still out on the job. Rounds pair in order; a
// round's end is fixed the first time its check-in is done (g.roundEnd); the flow's check-out works only when its step
// is current. Publish rules, a member doing both, the run card's gear line, a deleted job's gear, no costs.
//
// Shapes the tests fix (PHASE4.md §10):
//   GET  /api/jobs/:id/steps/:sid/gear → { items: [{ itemId, name, need, got, free: [{ id, name }] }], out: [{ unitId, name, item, memberId }], notes: [] }
//   POST /api/jobs/:id/steps/:sid/gear { act: 'checkout', unitId, memberId? } | { act: 'return', unitId, placeId? }
//        → 200 { run, gear }; a check-out step that isn't current → 409; a unit already out → 409 with a fresh { gear }.
//   The run view: run.gearLine ("Gear out: Pressure washer, Ladder ×2", or null); a gear step's `gear` (as above);
//   run.current.missing names a shortage ("Only 1 Pressure washer available, 2 needed").
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflow_gear';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5258, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const base = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test' };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: base, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return true; } catch {} await sleep(150); }
  return false;
};
const stop = async () => { await sleep(300); srv.kill(); await new Promise((r) => srv.once('exit', r)); };
if (!(await start())) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Gear flows ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  let rico = call(ricoTok);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Gear flows ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samTok = r.body.token;
  let sam = call(samTok);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Zed', email: `zed${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const zed = call(r.body.token);
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });
  st = (await rico('GET', '/state')).body;
  const samId = st.workspace.members.find((m) => m.name === 'Sam Reed').id;
  const ricoId = st.workspace.members.find((m) => m.name === 'Rico Vega').id;
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const tp = p.types[0];
  const list = { projectId: p.id, typeId: tp.id };

  // Gear: 2 pressure washers, 3 ladders (one by one); hose is counted stock; another team's item.
  const units = async (id) => (await rico('GET', '/inventory/items/' + id)).body?.units || [];
  const pw = (await rico('POST', '/inventory/items', { name: 'Pressure washer', track: 'units', cost: '400', onHand: 2 })).body;
  const lad = (await rico('POST', '/inventory/items', { name: 'Ladder', track: 'units', cost: '150', onHand: 3 })).body;
  const hose = (await rico('POST', '/inventory/items', { name: 'Hose', unit: 'each', cost: '20' })).body;
  const zedPw = (await zed('POST', '/inventory/items', { name: 'Zed washer', track: 'units', onHand: 1 })).body;
  const [pw1, pw2] = await units(pw.id);
  const [l1, l2, l3] = await units(lad.id);
  const main = (await rico('GET', '/inventory')).body.places[0];
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 1', kind: 'vehicle' })).body;
  ok(!!pw1 && !!pw2 && !!l1 && !!l2 && !!l3 && !!hose?.id && !!zedPw?.id && !!main?.id && !!truck?.id, '(setup) 2 pressure washers, 3 ladders, counted hose, another team’s washer, two places');

  const flowOf = async (name, steps) => {
    const f = (await rico('POST', '/job-flows', { name, list, steps })).body;
    const pub = await rico('POST', `/job-flows/${f?.id}/publish`);
    return { id: f?.id, status: pub.status, error: pub.body?.error || '', version: pub.body?.version, sid: (n) => pub.body?.version?.body?.steps?.find((s) => s.name === n)?.id };
  };
  const C = { kind: 'client', name: 'Client' };
  const OUT = (items, name = 'Gear out') => ({ kind: 'gearOut', name, settings: { items } });
  const IN = (name = 'Gear in') => ({ kind: 'gearIn', name });
  const D = (name) => ({ kind: 'custom', name, settings: { text: name } });

  // 1. Publish rules.
  for (const [why, steps] of [
    ['an item not tracked by unit', [OUT([{ itemId: hose.id, qty: 1 }])]],
    ['another team’s item', [OUT([{ itemId: zedPw.id, qty: 1 }])]],
    ['a made-up item', [OUT([{ itemId: 'nope', qty: 1 }])]],
    ['an item twice', [OUT([{ itemId: pw.id, qty: 1 }, { itemId: pw.id, qty: 1 }])]],
    ['qty 0', [OUT([{ itemId: pw.id, qty: 0 }])]],
    ['qty 21', [OUT([{ itemId: pw.id, qty: 21 }])]],
    ['qty 1.5', [OUT([{ itemId: pw.id, qty: 1.5 }])]],
    ['no items', [OUT([])]],
    ['11 items', [OUT(Array.from({ length: 11 }, (_, i) => ({ itemId: 'x' + i, qty: 1 })))]],
    ['a check-in with no check-out before it', [C, IN()]],
    ['a check-in before its check-out', [IN(), OUT([{ itemId: pw.id, qty: 1 }])]],
    ['two check-ins after one check-out', [OUT([{ itemId: pw.id, qty: 1 }]), IN(), IN('Again')]],
    ['two check-outs in a row', [OUT([{ itemId: pw.id, qty: 1 }]), OUT([{ itemId: lad.id, qty: 1 }], 'More gear'), IN()]],
  ]) {
    const F = await flowOf('Bad: ' + why, steps);
    ok(!!F.id && F.status === 400, `refused at publish: ${why} (${F.status} ${F.error})`);
  }
  let F = await flowOf('Gear stays', [C, OUT([{ itemId: pw.id, qty: 1 }])]);
  ok(F.status === 200, 'a check-out with no check-in publishes (gear that stays at the site): ' + F.error);
  ok(F.version?.body?.steps?.find((s) => s.kind === 'gearOut')?.who?.type === 'anyone' && F.version.body.steps.find((s) => s.kind === 'gearOut').name === 'Gear out', 'a gear step is for anyone on the job by default');
  const F2 = await flowOf('Two visits', [OUT([{ itemId: pw.id, qty: 1 }, { itemId: lad.id, qty: 2 }], 'Out A'), D('Visit A'), IN('In A'), OUT([{ itemId: lad.id, qty: 1 }], 'Out B'), D('Visit B'), IN('In B')]);
  ok(F2.status === 200, 'two rounds in order publish: ' + F2.error);
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: false } });
  ok((await flowOf('Tool off', [OUT([{ itemId: pw.id, qty: 1 }]), IN()])).status === 400, 'refused at publish: the Inventory tool off');
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });

  // Helpers on a job.
  const runOf = async (id, who = rico) => (await who('GET', `/jobs/${id}/run`)).body?.run;
  const stepOf = async (id, name, who = rico) => (await runOf(id, who))?.steps?.find((s) => s.name === name);
  const stateOf = async (id, name) => (await stepOf(id, name))?.state;
  const gearAt = (id, sid, who = rico) => who('GET', `/jobs/${id}/steps/${sid}/gear`);
  const gearDo = (id, sid, body, who = rico) => who('POST', `/jobs/${id}/steps/${sid}/gear`, body);
  const inv = (u, body, who = rico) => who('POST', `/inventory/units/${u.id}/act`, body);
  const bareJob = async (name) => (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: name } })).body;
  const attach = (id, flowId) => rico('POST', `/jobs/${id}/flow`, { flowId });
  const done = (id, sid) => rico('POST', `/jobs/${id}/steps/${sid}/done`);
  const backAll = async () => { for (const u of [pw1, pw2, l1, l2, l3]) { const cur = (await rico('GET', '/inventory/units/' + u.id)).body?.unit; if (cur?.status === 'out') await inv(u, { act: 'return', placeId: main.id }); if (cur?.status === 'repair' || cur?.status === 'lost') { await inv(u, { act: 'found', placeId: main.id }); } } };

  // 2. Counting (a one-round flow: Out [washer 1, ladder 2] → In).
  const F1 = await flowOf('One round', [OUT([{ itemId: pw.id, qty: 1 }, { itemId: lad.id, qty: 2 }]), D('Work'), IN()]);
  ok(F1.status === 200, '(setup) a one-round gear flow: ' + F1.error);
  const j1 = await bareJob('Deck wash');
  // Gear checked out to the job before the run doesn't count, even if still out.
  await inv(l1, { act: 'checkout', jobId: j1.id });
  await sleep(10);
  r = await attach(j1.id, F1.id);
  ok(r.status === 200, '(setup) the job goes on the flow: ' + (r.body?.error || ''));
  const sOut = F1.sid('Gear out'), sIn = F1.sid('Gear in');
  r = await gearAt(j1.id, sOut);
  const need = (g, id) => g?.items?.find((x) => x.itemId === id);
  ok(r.status === 200 && need(r.body, pw.id)?.need === 1 && need(r.body, pw.id)?.got === 0 && need(r.body, lad.id)?.need === 2 && need(r.body, lad.id)?.got === 0, 'the sheet lists what the step needs: washer 0 of 1, ladder 0 of 2 (the ladder out before the run doesn’t count): ' + JSON.stringify(r.body?.items));
  ok(need(r.body, lad.id)?.free?.length === 2 && !need(r.body, lad.id).free.some((u) => u.id === l1.id), 'and only the free ladders to pick');
  ok(r.status === 200 && Array.isArray(r.body?.items) && !/cost|value|40000|15000/.test(JSON.stringify(r.body)), 'no costs on the sheet');
  const keys = (o) => Object.keys(o || {}).sort().join();
  ok(keys(r.body) === 'items,notes,out' && Array.isArray(r.body.out) && Array.isArray(r.body.notes) && r.body.items.length === 2 && r.body.items.every((x) => keys(x) === 'free,got,itemId,name,need' && x.free.every((u) => keys(u) === 'id,name')) && need(r.body, pw.id)?.name === 'Pressure washer', 'the sheet’s exact shape: { items: [{ itemId, name, need, got, free: [{ id, name }] }], out, notes }: ' + JSON.stringify(r.body?.items?.[0]));
  // Gear for another job doesn't count.
  const other = await bareJob('Other job');
  await inv(l2, { act: 'checkout', jobId: other.id });
  // One unit out twice counts once.
  r = await gearDo(j1.id, sOut, { act: 'checkout', unitId: pw1.id });
  ok(r.status === 200 && need(r.body?.gear, pw.id)?.got === 1, 'the flow checks out washer 1 for the job: ' + r.status + ' ' + (r.body?.error || ''));
  ok((await rico('GET', '/inventory/units/' + pw1.id)).body?.unit?.jobId === j1.id, 'through Inventory: the unit is out on the job');
  r = await gearDo(j1.id, sOut, { act: 'checkout', unitId: l3.id, memberId: samId });
  ok(r.status === 200 && (await rico('GET', '/inventory/units/' + l3.id)).body?.unit?.memberId === samId, 'a ladder checked out to Sam');
  await inv(l3, { act: 'return', placeId: main.id });
  await inv(l3, { act: 'checkout', jobId: j1.id });
  await sleep(300);
  ok(need((await gearAt(j1.id, sOut)).body, lad.id)?.got === 1 && (await stateOf(j1.id, 'Gear out')) === 'current', 'out, back and out again is one ladder: still 1 of 2, the step waits');
  // A unit taken between the sheet opening and the checkout is refused, and the shortage refreshed.
  const sheet = (await gearAt(j1.id, sOut)).body;
  const free = need(sheet, lad.id)?.free || [];
  ok(!!need(sheet, lad.id) && free.length === 0, 'no ladders free now (l1 out before, l2 on another job, l3 counted): ' + JSON.stringify(free));
  await inv(l2, { act: 'return', placeId: main.id });
  const sheet2 = (await gearAt(j1.id, sOut)).body;
  ok(need(sheet2, lad.id)?.free?.some((u) => u.id === l2.id), 'l2 back in the yard: it’s free on the sheet');
  await inv(l2, { act: 'checkout', jobId: other.id }, sam);
  r = await gearDo(j1.id, sOut, { act: 'checkout', unitId: l2.id });
  ok(r.status === 409 && /already out/i.test(r.body?.error || '') && !need(r.body?.gear, lad.id)?.free?.some((u) => u.id === l2.id), 'someone else took it first: refused ("already out"), the sheet refreshed: ' + r.status + ' ' + (r.body?.error || ''));
  // Not enough free: the step says so and waits.
  const run1 = await runOf(j1.id);
  ok(run1?.current?.kind === 'gearOut' && /Only 0 Ladders? available, 1 needed/i.test(run1?.current?.missing || ''), 'the step says what’s short: ' + run1?.current?.missing);
  // A unit checked out to the job by hand (in Inventory, during the round) counts.
  await inv(l2, { act: 'return', placeId: main.id }, sam);
  await inv(l2, { act: 'checkout', jobId: j1.id }, sam);
  ok(await until(async () => (await stateOf(j1.id, 'Gear out')) === 'done'), 'a ladder checked out to the job by hand counts: 2 of 2, the check-out is done');
  const run1b = await runOf(j1.id);
  ok(/^Gear out: /.test(run1b?.gearLine || '') && /Pressure washer/.test(run1b.gearLine) && /Ladder ×3/.test(run1b.gearLine), 'the run card’s gear line: ' + run1b?.gearLine);
  ok(!!run1b?.gearLine && !/"cost"|"value"|"price"/.test(JSON.stringify(run1b)), 'no costs on the run');
  // Check-in waits while anything is out on the job (the ladder from before the run too).
  await done(j1.id, F1.sid('Work'));
  await sleep(300);
  r = await gearAt(j1.id, sIn);
  ok((r.body?.out || []).length > 0 && (r.body?.out || []).every((u) => Object.keys(u).sort().join() === 'item,memberId,name,unitId') && (r.body?.out || []).some((u) => u.unitId === l3.id && u.item === 'Ladder'), 'each thing out: unitId, name, item, who has it');
  ok(r.status === 200 && r.body?.out?.length === 4 && (await stateOf(j1.id, 'Gear in')) === 'current', 'check-in lists the 4 out on the job (one from before the run) and waits: ' + r.body?.out?.length);
  // Returning the gear doesn't reopen the check-out.
  r = await gearDo(j1.id, sIn, { act: 'return', unitId: pw2.id });
  ok([400, 409].includes(r.status), 'checking in a unit that isn’t out on this job is refused: ' + r.status);
  r = await gearDo(j1.id, sIn, { act: 'return', unitId: pw1.id, placeId: 'nowhere' });
  ok([400, 404].includes(r.status) && (await rico('GET', '/inventory/units/' + pw1.id)).body?.unit?.status === 'out', 'or to a place that isn’t there: ' + r.status);
  r = await gearDo(j1.id, sIn, { act: 'return', unitId: pw1.id });
  ok(r.status === 200 && (await rico('GET', '/inventory/units/' + pw1.id)).body?.unit?.placeId === main.id, 'check in through the flow: back to where it came from by default');
  r = await gearDo(j1.id, sIn, { act: 'return', unitId: l3.id, placeId: truck.id });
  ok(r.status === 200 && (await rico('GET', '/inventory/units/' + l3.id)).body?.unit?.placeId === truck.id, 'or to another place');
  ok((await stateOf(j1.id, 'Gear out')) === 'done', 'bringing gear back doesn’t undo the check-out');
  // A unit returned in Inventory counts; one in repair or lost doesn't hold the step up, and is noted.
  await inv(l2, { act: 'return', placeId: main.id }, sam);
  await inv(l1, { act: 'lost' });
  ok(await until(async () => (await stateOf(j1.id, 'Gear in')) === 'done'), 'a ladder returned in Inventory and one reported lost: nothing out, check-in done');
  ok(((await stepOf(j1.id, 'Gear in'))?.gear?.notes || []).some((n) => /Ladder.*lost/i.test(n)), 'and the lost one is noted: ' + JSON.stringify((await stepOf(j1.id, 'Gear in'))?.gear?.notes));
  ok((await runOf(j1.id))?.gearLine === null, 'no gear line when nothing is out');
  await backAll();

  // 3. A check-in can't tick before its check-out (nothing out on the job yet).
  const j0 = await bareJob('Empty yard');
  await attach(j0.id, F1.id);
  r = await done(j0.id, sIn);
  ok(r.status === 409, 'Done on a check-in is refused: it finishes by itself: ' + r.status);
  await sleep(400);
  ok((await stateOf(j0.id, 'Gear out')) === 'current' && (await stateOf(j0.id, 'Gear in')) === 'waiting', 'with nothing out at all, check-in still isn’t done while its check-out isn’t: ' + (await stateOf(j0.id, 'Gear in')));
  // Its check-out skipped with a reason, and nothing out: check-in passes.
  await rico('POST', `/jobs/${j0.id}/steps/${F1.sid('Gear out')}/skip`, { reason: 'Customer has their own' });
  ok(await until(async () => (await stateOf(j0.id, 'Gear in')) === 'done'), 'its check-out skipped and nothing out: check-in passes');

  // 4. Two rounds.
  const j2 = await bareJob('Two visits');
  await attach(j2.id, F2.id);
  const A = F2.sid('Out A'), IA = F2.sid('In A'), OB = F2.sid('Out B'), IB = F2.sid('In B');
  r = await gearDo(j2.id, OB, { act: 'checkout', unitId: l1.id });
  ok(r.status === 409, 'round B’s check-out through the flow before check-in A is done: 409: ' + r.status + ' ' + (r.body?.error || ''));
  ok(r.status === 409 && (await rico('GET', '/inventory/units/' + l1.id)).body?.unit?.status === 'available', 'and nothing went out');
  for (const u of [pw1, l1, l2]) { r = await gearDo(j2.id, A, { act: 'checkout', unitId: u.id }, sam); ok(r.status === 200, 'Sam (crew) checks out ' + u.name + ' through the step: ' + r.status + ' ' + (r.body?.error || '')); }
  ok(await until(async () => (await stateOf(j2.id, 'Out A')) === 'done'), 'round A’s check-out is done');
  await done(j2.id, F2.sid('Visit A'));
  ok((await stateOf(j2.id, 'In A')) === 'current', 'check-in A waits for the gear');
  for (const u of [pw1, l1, l2]) { r = await gearDo(j2.id, IA, { act: 'return', unitId: u.id }, sam); ok(r.status === 200, 'Sam checks in ' + u.name + ': ' + r.status); }
  ok(await until(async () => (await stateOf(j2.id, 'In A')) === 'done'), 'check-in A done');
  ok((await stateOf(j2.id, 'Out B')) === 'current', 'round B: visit A’s ladders don’t tick off its check-out; it’s waiting');
  const runA = await runOf(j2.id);
  // A restart keeps the round boundaries.
  await stop();
  ok(await start(), 'restarted');
  rico = call(ricoTok); sam = call(samTok);
  ok((await stateOf(j2.id, 'Out B')) === 'current' && (await stateOf(j2.id, 'Out A')) === 'done' && (await stateOf(j2.id, 'In A')) === 'done', 'after a restart: round A done, round B still waiting');
  // Reopening a done check-in A doesn't move round B's start.
  await rico('POST', `/jobs/${j2.id}/steps/${IA}/reopen`);
  await sleep(300);
  ok(await until(async () => (await stateOf(j2.id, 'In A')) === 'done'), 'check-in A reopened finishes again (nothing out)');
  ok(need((await gearAt(j2.id, OB)).body, lad.id)?.got === 0, 'round B still counts 0 ladders: visit A’s checkout stays before its boundary');
  // Gear checked out for B, then In B waits for it.
  r = await gearDo(j2.id, OB, { act: 'checkout', unitId: l3.id });
  ok(r.status === 200 && (await until(async () => (await stateOf(j2.id, 'Out B')) === 'done')), 'round B’s ladder goes out: check-out B done');
  await stop();
  ok(await start(), 'restarted again');
  rico = call(ricoTok); sam = call(samTok);
  ok(need((await gearAt(j2.id, OB)).body, lad.id)?.got === 1, 'after a restart round B still counts only its own checkout (1, not 3)');
  await done(j2.id, F2.sid('Visit B'));
  ok((await stateOf(j2.id, 'In B')) === 'current', 'check-in B waits for check-out B’s ladder');
  void runA;

  // A member who can't see the job: the gear routes don't exist for him.
  const pp = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'], private: true, name: 'Private jobs' })).body;
  const fp = (await rico('POST', '/job-flows', { name: 'Private gear', list: { projectId: pp.id, typeId: pp.types[0].id }, steps: [OUT([{ itemId: pw.id, qty: 1 }]), IN()] })).body;
  const fpv = (await rico('POST', `/job-flows/${fp?.id}/publish`)).body;
  const jpv = (await rico('POST', `/projects/${pp.id}/records`, { typeId: pp.types[0].id, values: { job: 'Private gear job' } })).body;
  await attach(jpv.id, fp?.id);
  const fpOut = fpv?.version?.body?.steps?.[0]?.id;
  ok(!!fpOut && (await gearAt(jpv.id, fpOut)).status === 200, '(setup) a gear job on a private board');
  ok(!!fpOut && (await gearAt(jpv.id, fpOut)).status === 200 && (await gearAt(jpv.id, fpOut, sam)).status === 404 && (await gearDo(jpv.id, fpOut, { act: 'checkout', unitId: pw2.id }, sam)).status === 404, 'Sam, who can’t see that job, gets 404 from its gear sheet and its check-out');
  ok(!!fpOut && (await gearAt(jpv.id, fpOut)).status === 200 && (await rico('GET', '/inventory/units/' + pw2.id)).body?.unit?.status === 'available', 'and nothing went out');

  // 5. A deleted job with gear still out: the unit stays out with the person, the job link cleared, the ledger kept.
  const j3 = await bareJob('Deleted later');
  await attach(j3.id, F1.id);
  r = await gearDo(j3.id, F1.sid('Gear out'), { act: 'checkout', unitId: pw2.id, memberId: samId });
  ok(r.status === 200, '(setup) a washer out to Sam on a job');
  const movesBefore = ((await rico('GET', '/inventory/units/' + pw2.id)).body?.moves || []).filter((m) => m.kind === 'checkout' && m.jobId === j3.id).length;
  r = await rico('DELETE', `/records/${j3.id}`);
  ok(r.status === 200, '(setup) the job is deleted');
  const after = (await rico('GET', '/inventory/units/' + pw2.id)).body;
  ok(after?.unit?.status === 'out' && after.unit.memberId === samId && after.unit.jobId === null, 'the washer stays out with Sam, the job link cleared: ' + JSON.stringify({ s: after?.unit?.status, m: after?.unit?.memberId, j: after?.unit?.jobId }));
  ok(movesBefore === 1 && (after?.moves || []).filter((m) => m.kind === 'checkout' && m.jobId === j3.id).length === 1, 'its checkout entry keeps the job’s id as history');
  void ricoId;
} catch (e) {
  ok(false, 'threw: ' + (e?.stack || e));
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
