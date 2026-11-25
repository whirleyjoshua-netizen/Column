// Job Flows and the job's stage (docs/jobflows/CONTRACTS.md §1.5 "Stage ownership", §2.1): a job with a run has its
// stage moved and held by the run's steps alone. An ordinary campaign on the same job still runs and finishes, but
// neither moves nor holds the stage. The stage never moves back by itself when a step reopens. A job without a run
// behaves exactly as today.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflow_stage';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5248, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
if (!(await fetch(B + '/api/health').then((x) => x.ok, () => false))) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Stage ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const label = (rec) => statusF.choices.find((c) => c.id === rec?.values[statusF.id])?.label;
  const choice = (l) => statusF.choices.find((c) => c.label === l).id;
  const stageOf = async (id) => label((await rico('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === id));
  // HVAC (service family): New, Scheduled, In progress, Waiting on parts, Done, Invoiced, Paid.
  const steps = [
    { kind: 'custom', name: 'Look at it', stage: 'Scheduled', settings: { text: 'Go look.' } },
    { kind: 'custom', name: 'Ring the customer', settings: { text: 'No stage on this one.' } },
    { kind: 'custom', name: 'Fix it', stage: 'Done', settings: { text: 'Fix it.' } },
  ];
  const flow = (await rico('POST', '/job-flows', { name: 'Simple service', list: { projectId: p.id, typeId: tp.id }, steps })).body;
  const pub = (await rico('POST', `/job-flows/${flow?.id}/publish`)).body;
  const sid = (n) => pub?.version?.body?.steps?.find((s) => s.name === n)?.id;

  // A job with a run, and an ordinary campaign on the same job with an unfinished goal naming a later stage.
  const job = (await rico('POST', '/jobs', { flowId: flow?.id, values: { job: 'Bill · AC', [statusF.id]: choice('New') } })).body?.job;
  ok(!!job?.id, '(setup) a job on the flow');
  const camp = (await rico('POST', '/campaigns', { name: 'Upsell a warranty', recordId: job?.id })).body;
  const g1 = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Offer the warranty', kind: 'tasks', stage: 'In progress' })).body;
  const t1 = (await rico('POST', '/tasks', { text: 'Call about the warranty', goalId: g1.id })).body;

  await rico('POST', `/jobs/${job.id}/steps/${sid('Look at it')}/done`);
  ok(await until(async () => (await stageOf(job.id)) === 'Scheduled'), 'the run’s first step moves the job to Scheduled');
  await rico('POST', `/jobs/${job.id}/steps/${sid('Ring the customer')}/done`);
  await sleep(300);
  ok((await stageOf(job.id)) === 'Scheduled', 'a step with no stage doesn’t move it');
  await rico('POST', `/jobs/${job.id}/steps/${sid('Fix it')}/done`);
  ok(await until(async () => (await stageOf(job.id)) === 'Done'), 'the run’s last step moves it to Done, though the ordinary campaign’s “In progress” goal is still open');

  // Holding: the ordinary goal doesn't hold a manual move; the run's open steps do.
  const job2 = (await rico('POST', '/jobs', { flowId: flow.id, values: { job: 'Ann · furnace', [statusF.id]: choice('New') } })).body?.job;
  const camp2 = (await rico('POST', '/campaigns', { name: 'Side work', recordId: job2.id })).body;
  const g2 = (await rico('POST', '/goals', { campaignId: camp2.id, title: 'Side step', kind: 'tasks', stage: 'Scheduled' })).body;
  await rico('POST', '/tasks', { text: 'Something open', goalId: g2.id });
  r = await rico('PATCH', '/records/' + job2.id, { values: { [statusF.id]: choice('Scheduled') } });
  ok(r.status === 409, 'moving it to Scheduled is held by the run’s open step “Look at it”: ' + r.status);
  ok(!JSON.stringify(r.body || {}).includes('Side step'), 'and the hold names the run’s step, not the ordinary campaign’s');
  await rico('POST', `/jobs/${job2.id}/steps/${sid('Look at it')}/done`);
  await until(async () => (await stageOf(job2.id)) === 'Scheduled');
  r = await rico('PATCH', '/records/' + job2.id, { values: { [statusF.id]: choice('In progress') } });
  ok(r.status === 200, 'a manual move the run allows isn’t held by the ordinary campaign’s open “Scheduled” goal: ' + r.status);

  // The ordinary campaign still finishes on its own.
  await rico('PATCH', `/tasks/${t1.id}`, { done: true });
  ok(await until(async () => (await rico('GET', '/state')).body.campaigns.find((c) => c.id === camp.id)?.status === 'done'), 'the ordinary campaign finishes when its goal does');
  ok((await stageOf(job.id)) === 'Done', 'and doesn’t move the job’s stage (its goal named In progress)');

  // A step reopening never moves the stage back by itself.
  await rico('POST', `/jobs/${job.id}/steps/${sid('Fix it')}/reopen`);
  await sleep(400);
  ok((await rico('GET', `/jobs/${job.id}/run`)).body?.run?.current?.name === 'Fix it', 'reopening “Fix it” makes it current again');
  ok((await stageOf(job.id)) === 'Done', 'the job stays Done (no automatic move back)');
  r = await rico('PATCH', '/records/' + job.id, { values: { [statusF.id]: choice('In progress') } });
  ok(r.status === 200, 'a person can still move it back by hand');
  r = await rico('PATCH', '/records/' + job.id, { values: { [statusF.id]: choice('Done') } });
  ok(r.status === 409, 'and moving it forward again is held until the step is met: ' + r.status);

  // Without a run: today's behavior, every campaign on the job counts.
  const legacy = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Cy · legacy', [statusF.id]: choice('New') } })).body;
  const lc = (await rico('POST', '/campaigns', { name: 'Cy work', recordId: legacy.id })).body;
  const lg = (await rico('POST', '/goals', { campaignId: lc.id, title: 'Visit', kind: 'tasks', stage: 'Scheduled' })).body;
  const lt = (await rico('POST', '/tasks', { text: 'Go', goalId: lg.id })).body;
  r = await rico('PATCH', '/records/' + legacy.id, { values: { [statusF.id]: choice('Scheduled') } });
  ok(r.status === 409, 'a job without a run is held by its ordinary campaign’s open step, as today: ' + r.status);
  await rico('PATCH', `/tasks/${lt.id}`, { done: true });
  ok(await until(async () => (await stageOf(legacy.id)) === 'Scheduled'), 'and moved by it when the step is done, as today');
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
