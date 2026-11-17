// A job moves on when its work is done (the owner, 2026-11-17). A step (goal) in a job's campaign can say which of
// the job's stages it finishes. The job can't be moved to that stage or past it while the step has open tasks: not
// by a person, the API or an automation. An owner or admin can move it anyway, with a reason that goes on the
// job's timeline. Finishing a step's tasks moves the job to its stage. A job's campaign is finished when all its
// steps are, and back on when a task is reopened. Backwards is always fine. Saved campaigns keep each step's stage.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobsteps';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5212, B = `http://127.0.0.1:${PORT}`;
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
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const [s0, s1, s2, s3] = statusF.choices;
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bill Nye · 6 windows', [statusF.id]: s0.id } })).body;
  const stageOf = async (id = job.id) => (await rico('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === id)?.values[statusF.id];
  const move = (who, to, extra = {}) => who('PATCH', `/records/${job.id}`, { values: { [statusF.id]: to.id }, ...extra });
  ok((await stageOf()) === s0.id, `(setup) a job at ${s0.label}; stages ${s0.label} → ${s1.label} → ${s2.label}`);

  const camp = (await rico('POST', '/campaigns', { name: 'Bill Nye work', recordId: job.id })).body;
  r = await rico('POST', '/goals', { campaignId: camp.id, title: 'Measure', kind: 'tasks', stage: s1.label });
  ok(r.status === 200 && r.body.stage === s1.label, 'a step can say which of the job’s stages it finishes: ' + r.body?.stage);
  const gA = r.body;
  const gB = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Order', kind: 'tasks', stage: s2.label })).body;
  const a1 = (await rico('POST', '/tasks', { text: 'Measure six windows', goalId: gA.id })).body;
  const a2 = (await rico('POST', '/tasks', { text: 'Upload measurements', goalId: gA.id })).body;
  const b1 = (await rico('POST', '/tasks', { text: 'Submit supplier order', goalId: gB.id })).body;
  ok(a1.recordId === job.id && b1.recordId === job.id, '(setup) the steps’ tasks are the job’s');
  ok((await stageOf()) === s0.id, 'a step with no tasks done doesn’t move the job');

  // Held.
  r = await move(sam, s2);
  ok(r.status === 409 && /Measure/.test(r.body?.error) && r.body?.steps?.some((x) => x.title === 'Measure'), `moving past open work is refused, naming the step: ${r.status} ${r.body?.error}`);
  ok((await stageOf()) === s0.id, 'and the job stays where it was');
  r = await move(sam, s1);
  ok(r.status === 409, `moving to the step’s own stage is refused too: ${r.status}`);
  r = await move(sam, s1, { override: 'Customer measured it themselves' });
  ok(r.status === 403 && (await stageOf()) === s0.id, `a member can’t move it anyway: ${r.status}`);
  r = await move(rico, s1, { override: ' ' });
  ok(r.status === 400, `an owner moving it anyway gives a reason: ${r.status}`);

  // Backwards is fine; an owner's override goes on the timeline.
  r = await move(rico, s2, { override: 'Customer measured it themselves' });
  ok(r.status === 200 && (await stageOf()) === s2.id, `an owner can move it anyway, with a reason: ${r.status} ${r.body?.error || ''}`);
  const log = (await rico('GET', `/records/${job.id}/log`)).body;
  ok(Array.isArray(log) && log.some((e) => e.kind === 'override' && /Customer measured it themselves/.test(e.note) && /Measure/.test(e.note)), 'and the reason goes on the job’s timeline: ' + JSON.stringify((log || []).slice(0, 2)));
  r = await move(sam, s0);
  ok(r.status === 200 && (await stageOf()) === s0.id, 'moving a job back is always fine');

  // Finishing a step's tasks moves the job on.
  await sam('PATCH', `/tasks/${a1.id}`, { done: true });
  await sleep(300);
  ok((await stageOf()) === s0.id, 'one task of two done: the job stays');
  await sam('PATCH', `/tasks/${a2.id}`, { done: true });
  ok(await until(async () => (await stageOf()) === s1.id), `the step’s last task done moves the job to ${s1.label}`);
  const log2 = (await rico('GET', `/records/${job.id}/log`)).body;
  ok(log2.some((e) => e.kind === 'change' && e.to === s1.label && /Measure/.test(e.note || e.by || '')), 'and the timeline says the step did it: ' + JSON.stringify(log2.slice(0, 2)));
  r = await move(sam, s2);
  ok(r.status === 409 && /Order/.test(r.body?.error), 'the next step holds the next stage');
  st = (await rico('GET', '/state')).body;
  ok(st.campaigns.find((c) => c.id === camp.id).status === 'active', 'the campaign is still going');

  // The last step done: the job moves on and the campaign is finished. Reopened: the campaign is back on.
  await sam('PATCH', `/tasks/${b1.id}`, { done: true });
  ok(await until(async () => (await stageOf()) === s2.id), `the last step moves the job to ${s2.label}`);
  ok(await until(async () => (await rico('GET', '/state')).body.campaigns.find((c) => c.id === camp.id).status === 'done'), 'and the job’s campaign is finished when all its steps are');
  await sam('PATCH', `/tasks/${b1.id}`, { done: false });
  ok(await until(async () => (await rico('GET', '/state')).body.campaigns.find((c) => c.id === camp.id).status === 'active'), 'a task reopened puts the campaign back on');
  ok((await stageOf()) === s2.id, 'and leaves the job where it is');
  r = await move(sam, s3);
  ok(r.status === 409 && /Order/.test(r.body?.error), `and the reopened step holds it again: it can’t go past ${s2.label}: ` + r.status);

  // A campaign finished by hand stays finished.
  await rico('PATCH', `/campaigns/${camp.id}`, { status: 'done' });
  await sam('PATCH', `/tasks/${b1.id}`, { done: true });
  await sam('PATCH', `/tasks/${b1.id}`, { done: false });
  await sleep(300);
  ok((await rico('GET', '/state')).body.campaigns.find((c) => c.id === camp.id).status === 'done', 'a campaign someone finished by hand stays finished');

  // Saved, the steps keep their stages.
  const tpl = (await rico('POST', '/templates', { campaignId: camp.id, name: 'Blinds install' })).body;
  const job2 = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Ann Lee', [statusF.id]: s0.id } })).body;
  const run = (await rico('POST', `/templates/${tpl.id}/run`, { recordId: job2.id })).body;
  st = (await rico('GET', '/state')).body;
  const gs = st.goals.filter((g) => g.campaignId === run.id).map((g) => g.title + ':' + g.stage).join(',');
  ok(gs.includes('Measure:' + s1.label) && gs.includes('Order:' + s2.label), 'a saved campaign keeps each step’s stage: ' + gs);
  const r2 = await rico('PATCH', `/records/${job2.id}`, { values: { [statusF.id]: s2.id } });
  ok(r2.status === 409, 'and holds the new job the same way');
  // The public API is held too.
  const key = (await rico('POST', '/integrations/keys', { name: 'Zap' })).body?.token;
  const v1 = await call(key)('PATCH', `/v1/projects/${p.id}/${tp.key}/records/${job2.id}`, { fields: { status: s2.label } });
  ok(v1.status === 409, 'the public API is held too: ' + v1.status + ' ' + JSON.stringify(v1.body));

  // An automation is held too, and says so in its log.
  const job3 = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Cy Fox', [statusF.id]: s3.id } })).body;
  const c3 = (await rico('POST', '/campaigns', { name: 'Cy work', recordId: job3.id })).body;
  const g3 = (await rico('POST', '/goals', { campaignId: c3.id, title: 'Install', kind: 'tasks', stage: s2.label })).body;
  await rico('POST', '/tasks', { text: 'Hang the shades', goalId: g3.id });
  const f = await rico('POST', '/automations', { name: 'Back? Push it on', trigger: { kind: 'record.stage', projectId: p.id, typeId: tp.id, to: s0.label }, actions: [{ kind: 'record', projectId: p.id, typeId: tp.id, set: [{ field: statusF.id, value: s2.label }] }] });
  ok(f.status === 200, '(setup) an automation that moves jobs on ' + JSON.stringify(f.body?.error || ''));
  await rico('PATCH', `/records/${job3.id}`, { values: { [statusF.id]: s0.id } });
  const runsOf = async () => (await rico('GET', '/automations')).body.find((x) => x.name === 'Back? Push it on')?.runs || [];
  ok(await until(async () => (await runsOf()).length > 0), '(it ran)');
  const run3 = (await runsOf())[0];
  ok(!run3.ok && /Install/.test(run3.note), 'the automation is held, and its log says why: ' + run3.note);
  ok((await stageOf(job3.id)) === s0.id, 'and the job stays put');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  if (fails) console.log(srv.log.slice(-3000));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
