// Job Flows, checkpoint 3 review (docs/jobflows/CONTRACTS.md §2, §5, §1.5): what a step action answers is what's kept
// (the sweep runs before the answer); members read only flows they may start; a flow attaches only to a job on its own
// list; the payment step waits for every non-void invoice of the run, drafts too; an ordinary campaign's stage done
// while a run owns the stage isn't lost when the run is cancelled; a job that fails to start leaves nothing behind (no
// job, run, tasks or number used); a run's tasks never carry the run as their campaign (agents, public API,
// automations); a Tasks step with a skipped task finishes; Done, reopen and Done again is a second cycle; a PATCH that
// fails changes nothing.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflow_checks';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5250, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
// JOBFLOWS_FAIL_STEP: a step with this name makes starting a run throw (honoured outside production only), so the
// failure path can be tested from outside.
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test', JOBFLOWS_FAIL_STEP: 'Boom' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
if (!(await fetch(B + '/api/health').then((x) => x.ok, () => false))) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Checks ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Checks ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const tp = p.types[0];
  const fid = (k) => tp.fields.find((f) => f.key === k).id;
  const statusF = tp.fields.find((f) => f.key === 'status');
  const choice = (l) => statusF.choices.find((c) => c.label === l).id;
  const stageOf = async (id) => { const rec = (await rico('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === id); return statusF.choices.find((c) => c.id === rec?.values[statusF.id])?.label; };
  const other = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const priv = (await rico('POST', '/projects', { template: 'trades', trades: ['blinds'], private: true })).body;
  const posts = async () => (await rico('GET', '/state')).body.items.filter((it) => it.type === 'message').map((it) => it.text);
  await rico('POST', '/automations', { name: 'step', trigger: { kind: 'step.done', projectId: p.id }, actions: [{ kind: 'post', text: 'STEP {step} done', channelId: 'general' }] });
  await rico('POST', '/automations', { name: 'flow', trigger: { kind: 'job.flow.done', projectId: p.id }, actions: [{ kind: 'post', text: 'FLOWDONE {record}', channelId: 'general' }] });
  await rico('POST', '/automations', { name: 'task', trigger: { kind: 'task.done' }, actions: [{ kind: 'post', text: 'TASKDONE [{campaign}] {task}', channelId: 'general' }] });
  const mk = async (name, steps, extra = {}, list = { projectId: p.id, typeId: tp.id }) => {
    const f = (await rico('POST', '/job-flows', { name, list, steps, ...extra })).body;
    const pub = (await rico('POST', `/job-flows/${f?.id}/publish`)).body;
    return { ...f, sid: (n) => pub?.version?.body?.steps?.find((s) => s.name === n)?.id };
  };

  // 1. The answer to a step action is what's kept: the sweep runs before it.
  const one = await mk('One step', [{ kind: 'custom', name: 'Wave', who: { type: 'anyone' }, settings: { text: 'Wave.' } }]);
  const j1 = (await rico('POST', '/jobs', { flowId: one.id, values: { job: 'Answer' } })).body?.job;
  r = await rico('POST', `/jobs/${j1?.id}/steps/${one.sid('Wave')}/done`);
  ok(r.body?.run?.status === 'done', 'the last step’s Done answers with the run done (not active until a later sweep): ' + r.body?.run?.status);
  r = await rico('POST', `/jobs/${j1?.id}/steps/${one.sid('Wave')}/reopen`);
  ok(r.body?.run?.status === 'active' && r.body?.run?.current?.name === 'Wave', 'reopening it answers with the run going again: ' + r.body?.run?.status);
  r = await rico('POST', `/jobs/${j1?.id}/steps/${one.sid('Wave')}/done`);
  ok(r.body?.run?.status === 'done', 'Done again answers done');
  ok(await until(async () => (await posts()).filter((s) => s === 'STEP Wave done').length === 2), 'Done, reopen, Done: step.done went off twice (a second cycle)');
  ok((await posts()).filter((s) => s.startsWith('FLOWDONE')).length === 2, 'and job.flow.done once for each time the run finished');
  r = await sam('POST', `/jobs/${j1?.id}/steps/${one.sid('Wave')}/reopen`);
  ok(r.status === 403, 'on a finished run a member can’t reopen a step: ' + r.status);
  r = await sam('POST', `/jobs/${j1?.id}/steps/${one.sid('Wave')}/skip`, { reason: 'x' });
  ok(r.status === 403 && (await rico('GET', `/jobs/${j1?.id}/run`)).body?.run?.status === 'done', 'or skip one, and the run stays done');
  const j1b = (await rico('POST', '/jobs', { flowId: one.id, values: { job: 'Cancel me' } })).body?.job;
  r = await rico('POST', `/jobs/${j1b?.id}/flow/cancel`, { reason: 'Customer cancelled' });
  r = await rico('POST', `/jobs/${j1b?.id}/steps/${one.sid('Wave')}/done`);
  ok(r.status === 404, 'a cancelled run’s steps can’t be acted on: ' + r.status);

  // 2. Members read only flows they may start.
  const adminsOnly = await mk('Admins only', [{ kind: 'custom', name: 'A', settings: { text: 'a' } }]);
  const everyone = await mk('Anyone', [{ kind: 'custom', name: 'A', settings: { text: 'a' } }], { whoCreates: 'everyone' });
  const hidden = await mk('Private list', [{ kind: 'custom', name: 'A', settings: { text: 'a' } }], { whoCreates: 'everyone' }, { projectId: priv.id, typeId: priv.types[0].id });
  const seen = (await sam('GET', '/job-flows')).body?.flows?.map((f) => f.id) || [];
  ok(seen.includes(everyone.id), 'a member reads a flow everyone may start');
  ok(!seen.includes(adminsOnly.id) && (await sam('GET', `/job-flows/${adminsOnly.id}`)).status === 404, 'but not an admins-only flow (list or by id)');
  ok(!seen.includes(hidden.id) && (await sam('GET', `/job-flows/${hidden.id}`)).status === 404, 'nor a flow on a private project they can’t see');
  ok((await rico('GET', '/job-flows')).body?.flows?.some((f) => f.id === adminsOnly.id), 'an admin still reads every flow');

  // 3. A flow attaches only to a job on its own list.
  const hvacFlow = await mk('HVAC visit', [{ kind: 'custom', name: 'Look', settings: { text: 'Look.' } }], {}, { projectId: other.id, typeId: other.types[0].id });
  const j3 = (await rico('POST', '/jobs', { flowId: one.id, values: { job: 'Mine' } })).body?.job;
  const before = (await rico('GET', `/jobs/${j3?.id}/run`)).body?.run;
  r = await rico('POST', `/jobs/${j3?.id}/flow`, { flowId: hvacFlow.id, replace: true });
  ok(r.status === 400, 'a flow for another list can’t be attached: ' + r.status + ' ' + (r.body?.error || ''));
  const after = (await rico('GET', `/jobs/${j3?.id}/run`)).body?.run;
  ok(after?.id === before?.id && after?.status === 'active' && after?.flowId === one.id, 'and the job’s run is untouched');
  const plain = (await rico('POST', `/projects/${other.id}/records`, { typeId: other.types[0].id, values: { job: 'Plain HVAC' } })).body;
  ok((await rico('POST', `/jobs/${plain.id}/flow`, { flowId: one.id })).status === 400, 'nor a cleaning flow onto an HVAC job');

  // 4. The payment step waits for every non-void invoice of the run, drafts too.
  const pay = await mk('Pay', [{ kind: 'payment', name: 'Collect payment' }, { kind: 'custom', name: 'After', settings: { text: 'x' } }]);
  const j4 = (await rico('POST', '/jobs', { flowId: pay.id, values: { job: 'Two bills', price: { rows: [{ desc: 'Can', qty: 1, price: '25' }] } } })).body?.job;
  const ia = (await rico('POST', `/records/${j4?.id}/invoices`)).body, ib = (await rico('POST', `/records/${j4?.id}/invoices`)).body;
  const A = ia?.invoice || ia, Bv = ib?.invoice || ib;
  await rico('POST', `/invoices/${A?.id}/send`);
  await rico('POST', `/invoices/${A?.id}/payments`, { amount: '25', method: 'cash' });
  await sleep(500);
  ok((await rico('GET', `/jobs/${j4?.id}/run`)).body?.run?.current?.kind === 'payment', 'one invoice paid and another still a draft: Collect payment stays open');
  await rico('POST', `/invoices/${Bv?.id}/void`);
  ok(await until(async () => (await rico('GET', `/jobs/${j4?.id}/run`)).body?.run?.current?.name === 'After'), 'the draft voided: it finishes');

  // 5. An ordinary campaign's stage done while the run owns the stage moves the job once the run is cancelled.
  const owned = await mk('Owned', [{ kind: 'custom', name: 'Hold', settings: { text: 'x' } }]);
  const j5 = (await rico('POST', '/jobs', { flowId: owned.id, values: { job: 'Handoff', [statusF.id]: choice('New') } })).body?.job;
  const camp = (await rico('POST', '/campaigns', { name: 'Side', recordId: j5?.id })).body;
  const g5 = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Book it', kind: 'tasks', stage: 'Scheduled' })).body;
  const t5 = (await rico('POST', '/tasks', { text: 'Book', goalId: g5.id })).body;
  await rico('PATCH', `/tasks/${t5.id}`, { done: true });
  await sleep(500);
  ok((await stageOf(j5?.id)) === 'New', 'while the run owns the stage, the ordinary campaign’s done “Scheduled” goal doesn’t move it');
  await rico('POST', `/jobs/${j5?.id}/flow/cancel`, { reason: 'Doing it by hand' });
  ok(await until(async () => (await stageOf(j5?.id)) === 'Scheduled'), 'the run cancelled: the ordinary campaign moves the job to Scheduled');

  // 6. A job that fails to start leaves nothing behind.
  r = await rico('POST', `/projects/${p.id}/schema`, { op: 'addField', typeId: tp.id, type: 'autonumber', name: 'Job no', prefix: 'J-', start: 1 });
  ok(r.status === 200, '(setup) an autonumber field on the list: ' + r.status + ' ' + (r.body?.error || ''));
  const numF = ((r.body?.project?.types || []).find((x) => x.id === tp.id)?.fields || []).find((f) => f.type === 'autonumber');
  const boom = await mk('Boom flow', [{ kind: 'tasks', name: 'Prep', settings: { tasks: ['Load up'] } }, { kind: 'custom', name: 'Boom', settings: { text: 'x' } }]);
  const good = await mk('Good flow', [{ kind: 'custom', name: 'Fine', settings: { text: 'x' } }]);
  const jA = (await rico('POST', '/jobs', { flowId: good.id, values: { job: 'Number A' } })).body?.job;
  st = (await rico('GET', '/state')).body;
  const recsBefore = (await rico('GET', `/projects/${p.id}/records`)).body.length, tasksBefore = st.tasks.length, campsBefore = Object.keys(st.campaigns).length;
  const createdPosts = (await posts()).length;
  r = await rico('POST', '/jobs', { flowId: boom.id, values: { job: 'Never made' } });
  ok(r.status >= 500, 'a run that fails to build fails the request: ' + r.status);
  await sleep(400);
  st = (await rico('GET', '/state')).body;
  const recs = (await rico('GET', `/projects/${p.id}/records`)).body;
  ok(recs.length === recsBefore && !recs.some((x) => x.values?.[fid('job')] === 'Never made'), 'no job is left behind');
  ok(st.tasks.length === tasksBefore && !st.tasks.some((x) => x.text === 'Load up'), 'nor the Tasks step’s task');
  ok(Object.keys(st.campaigns).length === campsBefore && (await posts()).length === createdPosts, 'nor anything told about it');
  const jB = (await rico('POST', '/jobs', { flowId: good.id, values: { job: 'Number B' } })).body?.job;
  const nA = parseInt(String(jA?.values?.[numF?.id] || '').replace(/\D/g, ''), 10), nB = parseInt(String(jB?.values?.[numF?.id] || '').replace(/\D/g, ''), 10);
  ok(Number.isFinite(nA) && nB === nA + 1, `and no job number was used up (${jA?.values?.[numF?.id]} then ${jB?.values?.[numF?.id]})`);

  // 7. A run's tasks: a skipped task finishes a Tasks step; they never carry the run as their campaign.
  const prep = await mk('Prep', [{ kind: 'tasks', name: 'Get ready', settings: { tasks: ['Load the truck', 'Rinse the bins'] } }, { kind: 'custom', name: 'Go', settings: { text: 'x' } }]);
  const j7 = (await rico('POST', '/jobs', { flowId: prep.id, values: { job: 'Tasks' } })).body?.job;
  const tids = ((await rico('GET', `/jobs/${j7?.id}/run`)).body?.run?.steps?.[0]?.tasks || []).map((x) => x.id);
  await rico('PATCH', `/tasks/${tids[0]}`, { done: true });
  r = await rico('PATCH', `/tasks/${tids[1]}`, { skipped: true });
  ok(r.status === 200, '(setup) the second task skipped: ' + r.status + ' ' + (r.body?.error || ''));
  ok(await until(async () => (await rico('GET', `/jobs/${j7?.id}/run`)).body?.run?.current?.name === 'Go'), 'one done and one skipped: the Tasks step finishes');
  ok(await until(async () => (await posts()).some((s) => s.startsWith('TASKDONE') && s.endsWith('Load the truck'))), '(setup) task.done went off for the run’s task');
  ok((await posts()).some((s) => s === 'TASKDONE [] Load the truck'), 'and its {campaign} is empty, not the run');
  const token = (await rico('POST', '/integrations/keys', { name: 'Checks', write: false })).body?.token;
  const api = (await call(token)('GET', '/v1/tasks')).body;
  const at = (api?.data || []).find((x) => x.id === tids[0]);
  ok(at && at.campaign === null && at.job_id === j7?.id, 'the public API returns the run’s task with its job and no campaign: ' + JSON.stringify(at?.campaign));

  // 8. A PATCH that fails changes nothing.
  const pf = (await rico('POST', '/job-flows', { name: 'Steady', icon: '🧽', list: { projectId: p.id, typeId: tp.id }, steps: [{ kind: 'custom', name: 'A', settings: { text: 'a' } }] })).body;
  r = await rico('PATCH', `/job-flows/${pf.id}`, { name: 'Renamed', icon: '🚚', steps: [{ kind: 'nope', name: 'Bad' }] });
  const now = (await rico('GET', `/job-flows/${pf.id}`)).body;
  ok(r.status === 400 && now?.name === 'Steady' && now?.icon === '🧽', 'a PATCH with bad steps changes neither the name nor the icon: ' + r.status + ' ' + now?.name);
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
