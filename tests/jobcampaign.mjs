// A job owns its work (the owner, 2026-11-17): a campaign can belong to one job (c.recordId), started from a saved
// campaign for that job, by hand or by an automation the job sets off. Its tasks are the job's tasks: they show on
// the job without anyone linking each one. Only a job in the team that the person can see; a job that's deleted
// leaves its campaigns unlinked. An automation's task, set off by a job, is that job's task.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobcampaign';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5210, B = `http://127.0.0.1:${PORT}`;
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
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  await olga('PATCH', '/workspace', { tools: { ...(await olga('GET', '/state')).body.workspace.tools, projects: true } });

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const choice = (label) => statusF.choices.find((c) => c.label === label)?.id;
  const newJob = async (who, pj, name) => (await who('POST', `/projects/${pj.id}/records`, { typeId: pj.types[0].id, values: { job: name } })).body;
  const job = await newJob(rico, p, 'Bill Nye · 6 windows');
  ok(!!job.id, '(setup) a job');
  const op = (await olga('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const otherJob = await newJob(olga, op, 'Not yours');
  const priv = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  await rico('PATCH', `/projects/${priv.id}`, { private: true });
  const privJob = await newJob(rico, priv, 'Rico only');

  // A campaign for a job, made by hand.
  r = await rico('POST', '/campaigns', { name: 'Bill Nye work', recordId: job.id, inOrder: true });
  ok(r.status === 200 && r.body.recordId === job.id, 'a campaign can belong to a job: ' + r.body?.recordId);
  const camp = r.body;
  r = await rico('POST', '/campaigns', { name: 'Theirs', recordId: otherJob.id });
  ok(r.status === 200 && !r.body.recordId, 'not to another team’s job');
  r = await sam('POST', '/campaigns', { name: 'Sneaky', recordId: privJob.id });
  ok(r.status === 200 && !r.body.recordId, 'not to a job the person can’t see');

  // Its steps and tasks are the job's.
  const g1 = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Measure', kind: 'tasks' })).body;
  const t1 = (await rico('POST', '/tasks', { text: 'Measure six windows', goalId: g1.id })).body;
  ok(t1.recordId === job.id, 'a task in the job’s campaign is the job’s task: ' + t1.recordId);
  const t2 = (await rico('POST', '/tasks', { text: 'Not about the job', goalId: g1.id, recordId: null })).body;
  ok(!t2.recordId, 'unless it’s made without one on purpose');
  r = await rico('PATCH', `/tasks/${t2.id}`, { text: 'Still not' });
  ok(!r.body.recordId, 'and it stays that way when it’s changed');

  // Linking a campaign later links its tasks that have no job.
  const c2 = (await rico('POST', '/campaigns', { name: 'Linked later' })).body;
  const g2 = (await rico('POST', '/goals', { campaignId: c2.id, title: 'Order', kind: 'tasks' })).body;
  const t3 = (await rico('POST', '/tasks', { text: 'Submit supplier order', goalId: g2.id })).body;
  ok(!t3.recordId, '(setup) a task in a campaign with no job');
  r = await rico('PATCH', `/campaigns/${c2.id}`, { recordId: job.id });
  ok(r.status === 200 && r.body.recordId === job.id, 'a campaign can be given its job later');
  st = (await rico('GET', '/state')).body;
  ok(st.tasks.find((x) => x.id === t3.id)?.recordId === job.id, 'and its tasks become the job’s');

  // A saved campaign, run for a job.
  const tpl = (await rico('POST', '/templates', { campaignId: camp.id, name: 'Blinds install' })).body;
  ok(!!tpl.id, '(setup) saved the campaign');
  r = await rico('POST', `/templates/${tpl.id}/run`, { recordId: job.id });
  ok(r.status === 200 && r.body.recordId === job.id, 'a saved campaign runs for a job');
  st = (await rico('GET', '/state')).body;
  const runTasks = st.tasks.filter((x) => st.goals.some((g) => g.id === x.goalId && g.campaignId === r.body.id));
  ok(runTasks.length && runTasks.every((x) => x.recordId === job.id), 'and every task it makes is the job’s: ' + runTasks.map((x) => x.recordId).join());
  r = await sam('POST', `/templates/${tpl.id}/run`, { recordId: privJob.id });
  ok(r.status !== 200 || !r.body.recordId, 'not for a job the person can’t see');

  // Automations: a job moving on starts its campaign, and a task it makes is the job's.
  const f = (await rico('POST', '/automations', { name: 'Booked → work', trigger: { kind: 'record.stage', projectId: p.id }, actions: [
    { kind: 'campaign', templateId: tpl.id },
    { kind: 'task', text: 'Call {record}', assignee: '' },
  ] }));
  ok(f.status === 200, '(setup) an automation: start the campaign, make a task ' + JSON.stringify(f.body?.error || ''));
  const job2 = await newJob(rico, p, 'Ann Lee · 3 windows');
  await rico('PATCH', `/records/${job2.id}`, { values: { [statusF.id]: choice(statusF.choices[1].label) } });
  ok(await until(async () => (await rico('GET', '/state')).body.campaigns.some((c) => c.recordId === job2.id)), 'the campaign an automation starts belongs to the job that set it off');
  st = (await rico('GET', '/state')).body;
  ok(st.tasks.some((x) => x.text.startsWith('Call ') && x.recordId === job2.id), 'and the task it makes is the job’s');

  // A job that's deleted leaves its campaigns, unlinked.
  const job3 = await newJob(rico, p, 'Gone soon');
  const c3 = (await rico('POST', '/campaigns', { name: 'For gone', recordId: job3.id })).body;
  ok(c3.recordId === job3.id, '(setup) a campaign for a job that will be deleted');
  await rico('DELETE', `/records/${job3.id}`);
  ok(await until(async () => { const c = (await rico('GET', '/state')).body.campaigns.find((x) => x.id === c3.id); return c && !c.recordId; }), 'deleting the job keeps the campaign, with no job');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  if (fails) console.log(srv.log.slice(-3000));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
