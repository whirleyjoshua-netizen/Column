// Phase 5 §6 (docs/jobflows/PHASE5.md): Move my jobs here. GET /api/jobs/move counts each job list's jobs not on a
// flow; POST /api/jobs/move puts them on a flow (a published one, or one made from a ready-made start), each at the
// step for its stage, steps before it met or skipped "Before the move to Job Flows". The move has no side effects
// beyond the run: nothing sent, no step.done / job.flow.done, no automations, no tasks, no invoices; a send on the
// landed step waits for an OK. Legacy jobs and jobs already on a flow are left alone; one run per job under
// overlapping requests; owners and admins only; saved across a restart.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobs_move';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const OUTBOX = DIR + '/outbox';
const PORT = 5266, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const mails = () => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []);
const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test' };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return true; } catch {} await sleep(150); }
  return false;
};
const stop = async () => { srv.kill(); await new Promise((r) => srv.once('exit', r)); };
if (!(await start())) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Move ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => (await call()('POST', '/auth', { mode: 'join', workspace: 'Move ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token;
  const ada = call(await join('Ada Admin', 2)), sam = call(await join('Sam Reed', 3));
  st = (await rico('GET', '/state')).body;
  const samId = st.workspace.members.find((m) => m.name === 'Sam Reed').id;
  await rico('PATCH', '/members/' + st.workspace.members.find((m) => m.name === 'Ada Admin').id, { role: 'admin' });
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true, inventory: true } });
  const tz = st.workspace.tz || 'UTC';
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now() + 864e5);

  const board = async (name) => {
    const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'], name })).body;
    const tp = p.types[0];
    const stage = (label) => tp.fields.find((f) => f.key === 'status').choices.find((c) => c.label === label).id;
    const add = async (job, label, extra = {}) => (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job, status: stage(label), ...extra } })).body;
    return { p, tp, stage, add };
  };
  let n = 0;
  const contact = async () => { n++; const c = (await rico('POST', '/contacts', { name: `Cust${n} Ruiz`, email: `cust${n}.${t}@x.test`, address: `${n} A St` })).body; return c.id ?? c.contact?.id; };
  const posts = async () => ((await rico('GET', '/state')).body.items || []).filter((it) => it.type === 'message').map((it) => it.text).filter((x) => /STEP|FLOW/.test(x));
  const tasksOf = async (id) => ((await rico('GET', '/state')).body.tasks || []).filter((x) => x.recordId === id);
  const runOf = async (id, who = rico) => (await who('GET', `/jobs/${id}/run`)).body?.run;
  const stepNamed = (run, name) => run?.steps?.find((s) => s.name === name);

  // Board A and its flow (published): each step names the stage it reaches.
  const A = await board('Cleaning A');
  await rico('POST', '/automations', { name: 'Step done', trigger: { kind: 'step.done', projectId: A.p.id }, actions: [{ kind: 'post', text: 'STEP {step} done on {record}', channelId: 'general' }] });
  await rico('POST', '/automations', { name: 'Flow done', trigger: { kind: 'job.flow.done', projectId: A.p.id }, actions: [{ kind: 'post', text: 'FLOW done on {record}', channelId: 'general' }] });
  const steps = [
    { kind: 'client', name: 'Client', stage: 'New' },
    { kind: 'book', name: 'Book', stage: 'Scheduled' },
    { kind: 'remind', name: 'Remind', stage: 'In progress', settings: { send: 'auto' } },
    { kind: 'work', name: 'Clean', stage: 'Done' },
    { kind: 'tasks', name: 'Wrap up', stage: 'Invoiced', settings: { tasks: ['Bring the bins back'] } },
    { kind: 'invoice', name: 'Invoice' },
    { kind: 'payment', name: 'Payment', stage: 'Paid' },
  ];
  const fa = (await rico('POST', '/job-flows', { name: 'Cleaning A flow', list: { projectId: A.p.id, typeId: A.tp.id }, steps })).body;
  r = await rico('POST', `/job-flows/${fa?.id}/publish`);
  ok(r.status === 200, '(setup) board A’s flow is published ' + (r.body?.error || ''));

  const jNew = await A.add('New, no client', 'New');
  const jSched = await A.add('Scheduled, with client', 'Scheduled', { customer: await contact() });
  const jDone = await A.add('Done, nothing filled', 'Done');
  const remindC = await contact();
  const jProg = await A.add('In progress, visit tomorrow', 'In progress', { customer: remindC });
  await rico('POST', `/records/${jProg.id}/visits`, { kind: 'Clean', date: tomorrow, start: 600, end: 660, memberIds: [samId] });
  const jInv = await A.add('Invoiced', 'Invoiced', { customer: await contact() });
  const jPaid = await A.add('Paid', 'Paid', { customer: await contact() });
  const jLegacy = await A.add('On campaign steps', 'New');
  await rico('POST', '/campaigns', { name: 'Old way', recordId: jLegacy.id });
  const jOn = (await rico('POST', '/jobs', { flowId: fa.id, values: { job: 'Already on the flow' } })).body?.job;
  const onRunBefore = await runOf(jOn.id);
  await sleep(300);
  const campaignsOf = async () => Object.values((await rico('GET', '/state')).body.campaigns || []).length;
  const allTasks = async () => ((await rico('GET', '/state')).body.tasks || []).length;
  const movesOf = async () => ((await rico('GET', '/inventory/moves')).body || []).length;
  const mailsBefore = mails().length, postsBefore = (await posts()).length, invoicesBefore = ((await rico('GET', '/invoices')).body || []).length;
  const campaignsBefore = await campaignsOf(), tasksBefore = await allTasks();

  // GET /jobs/move.
  ok((await sam('GET', '/jobs/move')).status === 403, 'a member can’t see Move my jobs here');
  r = await rico('GET', '/jobs/move');
  ok(r.status === 200 && Array.isArray(r.body?.lists), 'Move my jobs here answers: ' + r.status + ' ' + (r.body?.error || ''));
  const la = (r.body?.lists || []).find((x) => x.projectId === A.p.id && x.typeId === A.tp.id);
  ok(la?.notOnFlow === 7 && la?.legacy === 1, 'board A: 7 jobs not on a flow (the legacy one included), 1 of them on campaign steps: ' + JSON.stringify(la && { n: la.notOnFlow, l: la.legacy }));
  ok(la?.flows?.some((f) => f.id === fa.id) && la?.stages?.New === 3 && la?.stages?.Paid === 1, 'with the flows for that list and how many jobs are at each stage: ' + JSON.stringify(la?.stages));
  ok(la?.suggested === 'cleaning', 'a cleaning trade’s list suggests the Cleaning visit start: ' + la?.suggested);
  const bids = (await rico('POST', '/projects', { template: 'bids', name: 'Estimating' })).body;
  const bj = bids.types.find((x) => x.key === 'jobs');
  await rico('POST', `/projects/${bids.id}/records`, { typeId: bj.id, values: { job: 'A bids job' } });
  const lb = ((await rico('GET', '/jobs/move')).body?.lists || []).find((x) => x.projectId === bids.id && x.typeId === bj.id);
  ok(lb?.suggested === 'service', 'a list that isn’t a trade’s suggests Service call: ' + lb?.suggested);

  // POST /jobs/move with board A's flow.
  ok((await sam('POST', '/jobs/move', { projectId: A.p.id, typeId: A.tp.id, flowId: fa.id })).status === 403, 'a member can’t move jobs');
  r = await ada('POST', '/jobs/move', { projectId: A.p.id, typeId: A.tp.id, flowId: fa.id });
  ok(r.status === 200 && r.body?.moved === 6 && r.body?.flowId === fa.id, 'an admin moves board A: 6 moved: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  ok((r.body?.skipped || []).some((x) => x.id === jLegacy.id && /campaign/i.test(x.why)), 'the legacy job is reported, not moved');
  const R = {};
  for (const [k, j] of Object.entries({ jNew, jSched, jDone, jProg, jInv, jPaid, jLegacy })) R[k] = await runOf(j.id);
  // Every step, in order: D done (met), S skipped "Before the move to Job Flows", C current, W waiting.
  const shape = (run) => (run?.steps || []).map((x) => (x.state === 'done' ? 'D' : x.state === 'current' ? 'C' : x.state === 'waiting' ? 'W' : x.state === 'skipped' && x.skipReason === 'Before the move to Job Flows' ? 'S' : '?' + x.state)).join('');
  //                       Client Book Remind Clean Wrap-up Invoice Payment
  ok(shape(R.jNew) === 'CWWWWWW', 'New: on Client, nothing skipped: ' + shape(R.jNew));
  ok(shape(R.jSched) === 'DCWWWWW', 'Scheduled: Client met (it had a client), on Book: ' + shape(R.jSched));
  ok(shape(R.jDone) === 'SSSCWWW', 'Done: Client, Book, Remind skipped with the reason, on Clean: ' + shape(R.jDone));
  ok(shape(R.jProg) === 'DDCWWWW', 'In progress: Client and Book met (client, visit booked), on Remind: ' + shape(R.jProg));
  ok(shape(R.jInv) === 'DSSSCWW', 'Invoiced: Client met, Book, Remind, Clean skipped, on Wrap up: ' + shape(R.jInv));
  ok(shape(R.jPaid) === 'DSSSSSS' && R.jPaid?.status === 'done', 'Paid (the last stage): Client met, every other step skipped with the reason, the run done: ' + shape(R.jPaid) + ' ' + R.jPaid?.status);
  ok(!R.jLegacy, 'the legacy job has no run');
  ok((await runOf(jOn.id))?.id === onRunBefore?.id && (await runOf(jOn.id))?.current?.name === onRunBefore?.current?.name, 'the job already on the flow is untouched');
  const stageLabel = async (id) => { const rec = ((await rico('GET', `/projects/${A.p.id}/records`)).body || []).find((x) => x.id === id); return A.tp.fields.find((f) => f.key === 'status').choices.find((c) => c.id === rec?.values[A.tp.fields.find((f) => f.key === 'status').id])?.label; };
  ok((await stageLabel(jDone.id)) === 'Done' && (await stageLabel(jNew.id)) === 'New' && (await stageLabel(jPaid.id)) === 'Paid', 'the jobs’ stages don’t move');

  // No side effects.
  await sleep(1500);
  ok(mails().length === mailsBefore, 'nothing sent (the outbox is as it was)');
  ok((await posts()).length === postsBefore, 'no step.done or job.flow.done automations ran');
  ok(!(await tasksOf(jInv.id)).length && (await allTasks()) === tasksBefore, 'the Tasks step a job landed on made no tasks (no tasks made at all)');
  ok((await campaignsOf()) === campaignsBefore, 'no campaigns made');
  ok(((await rico('GET', '/invoices')).body || []).length === invoicesBefore, 'no invoices made');
  const prog = stepNamed(await runOf(jProg.id), 'Remind');
  ok(prog?.state === 'current' && prog?.pending?.kind === 'remind' && !!prog?.pending?.key, 'the reminder the job landed on waits for an OK, though its step says send by itself: ' + JSON.stringify(prog?.pending || null).slice(0, 120));
  ok((await sam('POST', `/jobs/${jProg.id}/steps/${prog?.id}/message`, { action: 'send', key: prog?.pending?.key })).status === 403, 'a member can’t send it');
  ok(mails().length === mailsBefore, 'still nothing sent');
  r = await rico('POST', `/jobs/${jProg.id}/steps/${prog?.id}/message`, { action: 'send', key: prog?.pending?.key });
  ok(r.status === 200 && mails().length === mailsBefore + 1, 'an owner sends it: it goes, once: ' + r.status + ' ' + (r.body?.error || ''));
  const log = (await rico('GET', `/records/${jDone.id}/log`)).body;
  ok(JSON.stringify(log || '').includes('Moved onto the flow') && JSON.stringify(log).includes('Clean'), 'the timeline says it was moved, and at which step');
  const notes = ((await rico('GET', '/notices')).body || []).map((x) => x.title + ' ' + x.text);
  ok(!notes.some((x) => /step|flow done|your turn/i.test(x) && !/ready to send/i.test(x)), 'no notices about steps (only the reminder’s ready-to-send)');

  // After the move, the job runs normally.
  await rico('POST', `/records/${jSched.id}/visits`, { kind: 'Clean', date: tomorrow, start: 800, end: 860, memberIds: [samId] });
  ok(await until(async () => (await posts()).some((x) => x.includes('STEP Book done') && x.includes('Scheduled, with client'))), 'the next real change sweeps it as any job (Book done fires its automation)');

  // Positive controls: what the move holds back does happen on a job that gets there normally.
  const fa2 = (await rico('POST', '/job-flows', { name: 'One step on A', list: { projectId: A.p.id, typeId: A.tp.id }, steps: [{ kind: 'custom', name: 'Only step', settings: { text: 'x' } }] })).body;
  await rico('POST', `/job-flows/${fa2.id}/publish`);
  const jNorm = (await rico('POST', '/jobs', { flowId: fa2.id, values: { job: 'Normal finish' } })).body?.job;
  await rico('POST', `/jobs/${jNorm.id}/steps/${(await runOf(jNorm.id))?.steps?.[0]?.id}/done`);
  ok(await until(async () => (await posts()).some((x) => x.includes('FLOW done on Normal finish'))), '(control) a job finishing its flow normally fires job.flow.done');

  // Board D: automatic invoicing, stock use, a campaign step and gear, each held back by the move.
  const D = await board('Cleaning D');
  const filter = (await rico('POST', '/inventory/items', { name: 'Filter', unit: 'each', cost: '5' })).body;
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 1', kind: 'vehicle' })).body;
  await rico('POST', '/inventory/moves', { kind: 'receive', itemId: filter.id, qty: 10, to: truck.id });
  const washer = (await rico('POST', '/inventory/items', { name: 'Pressure washer', track: 'units', cost: '400', onHand: 2 })).body;
  const unitsOut = async () => ((await rico('GET', '/inventory/items/' + washer.id)).body?.units || []).filter((u) => u.status === 'out').length;
  const fItem = (await rico('POST', '/job-items', { name: 'Filter swap', unit: 'each', price: 2000, invItemId: filter.id })).body?.item;
  const src = (await rico('POST', '/campaigns', { name: 'Deep clean playbook' })).body;
  await rico('POST', '/goals', { campaignId: src.id, title: 'Book the crew' });
  const tpl = (await rico('POST', '/templates', { campaignId: src.id, name: 'Deep clean' })).body;
  const fd = (await rico('POST', '/job-flows', { name: 'D flow', list: { projectId: D.p.id, typeId: D.tp.id }, billing: 'auto', items: [{ itemId: fItem?.id, qty: 2 }], steps: [
    { kind: 'client', name: 'Client', stage: 'New', canSkip: true },
    { kind: 'campaign', name: 'Playbook', stage: 'Scheduled', settings: { templateId: tpl?.id } },
    { kind: 'gearOut', name: 'Gear out', stage: 'In progress', settings: { items: [{ itemId: washer?.id, qty: 1 }] } },
    { kind: 'work', name: 'Do it', stage: 'Done', canSkip: true, settings: { useStock: true, fromPlace: truck.id } },
    { kind: 'invoice', name: 'Invoice', stage: 'Invoiced' },
    { kind: 'payment', name: 'Payment', stage: 'Paid' },
  ] })).body;
  r = await rico('POST', `/job-flows/${fd?.id}/publish`);
  ok(r.status === 200, '(setup) board D’s flow (auto invoice, a campaign, gear, stock) is published ' + (r.body?.error || ''));
  const stockAt = async () => (await rico('GET', '/inventory/items/' + filter.id)).body?.item?.stock?.[truck.id];
  const invsOf = async (id) => ((await rico('GET', '/invoices')).body || []).filter((x) => x.recordId === id);
  const tick = (id) => rico('PATCH', `/records/${id}`, { values: { checklist: { items: [{ id: 'c1', text: 'All done', done: true }] } } });
  // The moved ones first, so the controls can't make them look busy.
  const dCamp = await D.add('D at the playbook', 'Scheduled', { customer: await contact() });
  const dGear = await D.add('D at gear out', 'In progress', { customer: await contact() });
  const dInv = await D.add('D at invoice, work done', 'Invoiced', { customer: await contact() });
  await tick(dInv.id);
  await sleep(300);
  const c0 = await campaignsOf(), s0 = await stockAt(), m0 = await movesOf(), i0 = ((await rico('GET', '/invoices')).body || []).length;
  r = await rico('POST', '/jobs/move', { projectId: D.p.id, typeId: D.tp.id, flowId: fd.id });
  ok(r.body?.moved === 3, 'board D’s three jobs move: ' + JSON.stringify(r.body).slice(0, 160));
  ok((await runOf(dCamp.id))?.current?.name === 'Playbook' && (await runOf(dGear.id))?.current?.name === 'Gear out' && (await runOf(dInv.id))?.current?.name === 'Invoice', 'each on its step (the playbook, gear out, the invoice)');
  ok(stepNamed(await runOf(dInv.id), 'Do it')?.state === 'done', 'the work step before the invoice was met (its checklist was done)');
  await sleep(1500);
  ok((await campaignsOf()) === c0 && !stepNamed(await runOf(dCamp.id), 'Playbook')?.campaign, 'landing on the campaign step started no campaign');
  ok((await stockAt()) === s0 && (await movesOf()) === m0 && (await unitsOut()) === 0, 'no stock used and no gear checked out (the work step met before the move used none)');
  ok(((await rico('GET', '/invoices')).body || []).length === i0 && !(await invsOf(dInv.id)).length, 'landing on the automatic invoice step made no invoice');
  // A real change after the move: the job runs as any job does.
  await rico('PATCH', `/records/${dInv.id}`, { values: { access: 'Side door' } });
  ok(await until(async () => (await invsOf(dInv.id)).length === 1), 'after a real change, its automatic invoice is drafted as normal');
  await rico('PATCH', `/records/${dCamp.id}`, { values: { access: 'Front' } });
  ok(await until(async () => !!stepNamed(await runOf(dCamp.id), 'Playbook')?.campaign), 'and the campaign step starts its campaign as normal');
  // Controls on board D: a job getting there normally.
  const dNr = await rico('POST', '/jobs', { flowId: fd.id, contactId: await contact(), values: { job: 'D normal' } });
  const dN = dNr.body?.job || {};
  ok(!!dN.id, '(control setup) a normal job on board D: ' + dNr.status + ' ' + (dNr.body?.error || ''));
  ok(await until(async () => !!stepNamed(await runOf(dN.id), 'Playbook')?.campaign), '(control) a normal job reaching the campaign step starts its campaign');
  await rico('POST', `/jobs/${dN.id}/steps/${stepNamed(await runOf(dN.id), 'Playbook')?.id}/skip`, { reason: 'control' });
  await rico('POST', `/jobs/${dN.id}/steps/${stepNamed(await runOf(dN.id), 'Gear out')?.id}/skip`, { reason: 'control' });
  const sBefore = await stockAt();
  await tick(dN.id);
  ok(await until(async () => (await stockAt()) === sBefore - 2), '(control) its work step done uses the stock');
  ok(await until(async () => (await invsOf(dN.id)).length === 1), '(control) and its automatic invoice is drafted');

  // Two steps naming the same stage: the later one; a stage no step names, or none: the first step.
  const Fb = await board('Cleaning F');
  const ff = (await rico('POST', '/job-flows', { name: 'F flow', list: { projectId: Fb.p.id, typeId: Fb.tp.id }, steps: [
    { kind: 'client', name: 'Client', stage: 'New' }, { kind: 'custom', name: 'Prep', stage: 'Scheduled', settings: { text: 'x' } },
    { kind: 'book', name: 'Book', stage: 'Scheduled' }, { kind: 'custom', name: 'Finish', stage: 'Done', settings: { text: 'x' } }] })).body;
  await rico('POST', `/job-flows/${ff.id}/publish`);
  const f1 = await Fb.add('F scheduled', 'Scheduled'), f2 = await Fb.add('F in progress', 'In progress');
  const f3 = (await rico('POST', `/projects/${Fb.p.id}/records`, { typeId: Fb.tp.id, values: { job: 'F no stage', status: null } })).body;
  await rico('POST', '/jobs/move', { projectId: Fb.p.id, typeId: Fb.tp.id, flowId: ff.id });
  ok(shape(await runOf(f1.id)) === 'SSCW', 'two steps at Scheduled: it lands on the later one (Book), Prep skipped: ' + shape(await runOf(f1.id)));
  ok(shape(await runOf(f2.id)) === 'CWWW' && shape(await runOf(f3.id)) === 'CWWW', 'a stage no step names, and no stage: the first step: ' + shape(await runOf(f2.id)) + ' ' + shape(await runOf(f3.id)));

  // recordIds, and a second move.
  const jI = await A.add('Later one', 'New'), jJ = await A.add('Later two', 'New');
  r = await rico('POST', '/jobs/move', { projectId: A.p.id, typeId: A.tp.id, flowId: fa.id, recordIds: [jI.id] });
  ok(r.body?.moved === 1 && !!(await runOf(jI.id)) && !(await runOf(jJ.id)), 'recordIds: only those move');
  r = await rico('POST', '/jobs/move', { projectId: A.p.id, typeId: A.tp.id, flowId: fa.id, recordIds: [jI.id] });
  ok(r.status === 200 && r.body?.moved === 0 && r.body?.skipped?.some((x) => x.id === jI.id), 'moving it again moves nothing and says why');
  ok((await rico('POST', '/jobs/move', { projectId: A.p.id, typeId: A.tp.id, flowId: 'nope' })).status === 404, 'a flow that isn’t there: 404');
  ok((await rico('POST', '/jobs/move', { projectId: A.p.id, typeId: A.tp.id, flowId: ff.id })).status === 400, 'a flow for another list: 400');
  // Some good, some not: the good ones move, the rest are reported.
  const jK = await A.add('Later three', 'New');
  const gone = await A.add('Deleted one', 'New');
  await rico('DELETE', `/records/${gone.id}`);
  r = await rico('POST', '/jobs/move', { projectId: A.p.id, typeId: A.tp.id, flowId: fa.id, recordIds: [jK.id, gone.id, f1.id, 'nope'] });
  const why = (id) => (r.body?.skipped || []).find((x) => x.id === id)?.why || '';
  ok(r.status === 200 && r.body?.moved === 1 && !!(await runOf(jK.id)), 'mixed recordIds: the good one moves: ' + JSON.stringify(r.body).slice(0, 200));
  ok(why(gone.id) && why('nope') && why(f1.id), 'a deleted record, an id that was never there and another list’s job are each reported skipped');
  ok((await runOf(f1.id))?.flowId === ff.id, 'and the other list’s job is untouched');

  // With a ready-made start: a flow is made and published for the list.
  const Bd = await board('Cleaning B');
  const b1 = await Bd.add('B one', 'Scheduled', { customer: await contact() }), b2 = await Bd.add('B two', 'New');
  r = await rico('POST', '/jobs/move', { projectId: Bd.p.id, typeId: Bd.tp.id, start: 'cleaning' });
  ok(r.status === 200 && r.body?.moved === 2 && r.body?.flowId, 'with a start: both move: ' + r.status + ' ' + (r.body?.error || ''));
  const made = ((await rico('GET', '/job-flows')).body?.flows || []).find((f) => f.id === r.body?.flowId);
  ok(made && made.version && made.fromStart === 'cleaning' && made.version.body.list.projectId === Bd.p.id, 'the flow is made from the start, published, for that list');
  ok((await runOf(b1.id))?.current?.kind === 'book' && (await runOf(b2.id))?.flowId === made?.id, 'each job at the step for its stage');
  ok((await rico('POST', '/jobs/move', { projectId: Bd.p.id, typeId: Bd.tp.id, start: 'nonsense' })).status === 400, 'a start that isn’t one: 400');

  // One run per job, whatever overlaps.
  const Cd = await board('Cleaning C');
  const fc = (await rico('POST', '/job-flows', { name: 'C flow', list: { projectId: Cd.p.id, typeId: Cd.tp.id }, steps: [{ kind: 'client', name: 'Client' }, { kind: 'custom', name: 'Do it', settings: { text: 'x' } }] })).body;
  await rico('POST', `/job-flows/${fc.id}/publish`);
  const c1 = await Cd.add('C one', 'New');
  const out = await Promise.all([
    rico('POST', '/jobs/move', { projectId: Cd.p.id, typeId: Cd.tp.id, flowId: fc.id }),
    ada('POST', '/jobs/move', { projectId: Cd.p.id, typeId: Cd.tp.id, flowId: fc.id }),
    rico('POST', `/jobs/${c1.id}/flow`, { flowId: fc.id }),
  ]);
  const wins = (out[0].body?.moved || 0) + (out[1].body?.moved || 0) + (out[2].status === 200 ? 1 : 0);
  ok(wins === 1, 'two overlapping moves and a put-on-a-flow: exactly one puts the job on the flow: ' + out.map((x) => x.status + ':' + (x.body?.moved ?? x.body?.error ?? '')).join(' | '));
  ok(((await rico('GET', '/jobs')).body?.jobs || []).filter((j) => j.id === c1.id).length === 1, 'and the job is listed once');

  // Saved across a restart, and still quiet.
  const mailsAt = mails().length;
  await stop();
  ok(await start(), 'restarted');
  ok((await runOf(jDone.id))?.current?.name === 'Clean' && (await runOf(jPaid.id))?.status === 'done' && !!(await runOf(b1.id)), 'the moved jobs are still on their flows');
  await sleep(1200);
  ok(mails().length === mailsAt && stepNamed(await runOf(jProg.id), 'Remind')?.pending, 'nothing sent after the restart; the reminder still waits');
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e));
}
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
