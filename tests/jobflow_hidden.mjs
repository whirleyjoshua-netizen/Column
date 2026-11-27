// Job Flows: a run is never a campaign to anyone (docs/jobflows/CONTRACTS.md §2.3, §4): it isn't in the app's
// campaigns or steps, can't be opened, changed, deleted, saved as a template or added to on the campaign routes,
// isn't on the old job board, and never sets off campaign automations. An ordinary campaign on the same job is
// still an ordinary campaign everywhere.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflow_hidden';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5249, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Hide ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const posts = async () => (await rico('GET', '/state')).body.items.filter((it) => it.type === 'message').map((it) => it.text);
  for (const kind of ['campaign.started', 'campaign.done']) await rico('POST', '/automations', { name: kind, trigger: { kind }, actions: [{ kind: 'post', text: `${kind.toUpperCase()} {campaign}`, channelId: 'general' }] });

  const flow = (await rico('POST', '/job-flows', { name: 'Quick fix', list: { projectId: p.id, typeId: tp.id }, steps: [{ kind: 'custom', name: 'Fix it', settings: { text: 'Fix it.' } }] })).body;
  await rico('POST', `/job-flows/${flow?.id}/publish`);
  r = await rico('POST', '/jobs', { flowId: flow?.id, values: { job: 'Bill · AC' } });
  const job = r.body?.job, runId = r.body?.run?.id;
  ok(!!job?.id && !!runId, '(setup) a job on a flow, with its run');
  const camp = (await rico('POST', '/campaigns', { name: 'Warranty offer', recordId: job?.id })).body;
  const og = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Offer it', kind: 'tasks' })).body;
  const ot = (await rico('POST', '/tasks', { text: 'Call about the warranty', goalId: og.id })).body;
  await rico('POST', '/automations', { name: 'flow done', trigger: { kind: 'job.flow.done' }, actions: [{ kind: 'post', text: 'JOB.FLOW.DONE {record}', channelId: 'general' }] });

  st = (await rico('GET', '/state')).body;
  ok(!st.campaigns.some((c) => c.id === runId || c.kind === 'job'), 'the run isn’t in the app’s campaigns');
  ok(!st.goals.some((g) => g.campaignId === runId || g.kind === 'step'), 'nor are its steps in the app’s steps');
  ok(st.campaigns.some((c) => c.id === camp.id), 'the ordinary campaign on the same job is');

  ok((await rico('GET', `/campaigns/${runId}`)).status === 404, 'the campaign routes can’t open it');
  ok((await rico('PATCH', `/campaigns/${runId}`, { name: 'Renamed' })).status === 404, 'or change it');
  ok((await rico('POST', '/goals', { campaignId: runId, title: 'Sneaked in', kind: 'tasks' })).status === 404, 'or add a step to it');
  ok((await rico('POST', '/templates', { campaignId: runId, name: 'From a run' })).status === 404, 'or save it as a saved campaign');
  r = await rico('POST', '/campaigns', { name: 'Child', parentId: runId });
  const none = await rico('POST', '/campaigns', { name: 'Child 2', parentId: 'no-such-campaign' });
  ok(r.status === none.status && r.status === 400 && r.body?.error === none.body?.error, 'or make it a parent (answered exactly as for a campaign that doesn’t exist): ' + r.status + ' ' + (r.body?.error || ''));
  ok((await rico('DELETE', `/campaigns/${runId}`)).status === 404, 'or delete it');
  ok((await rico('GET', `/jobs/${job.id}/run`)).body?.run?.id === runId, 'it’s still there, through the job');

  r = await rico('GET', '/board');
  ok(!JSON.stringify(r.body || {}).includes(runId), 'the old job board doesn’t show the run');

  await rico('POST', `/jobs/${job.id}/steps/${(await rico('GET', `/jobs/${job.id}/run`)).body?.run?.steps?.[0]?.id}/done`);
  await rico('PATCH', `/tasks/${ot.id}`, { done: true });
  await sleep(800);
  const all = await posts();
  ok(all.some((s) => s === 'CAMPAIGN.STARTED Warranty offer'), 'the ordinary campaign set off campaign.started');
  ok(!all.some((s) => s.startsWith('CAMPAIGN.STARTED') && s !== 'CAMPAIGN.STARTED Warranty offer'), 'starting the run set off no campaign.started');
  ok(all.filter((s) => s.startsWith('CAMPAIGN.DONE')).length === 1 && all.includes('CAMPAIGN.DONE Warranty offer'), 'the ordinary campaign finishing set off campaign.done; the run finishing didn’t');
  ok(all.filter((s) => s.startsWith('JOB.FLOW.DONE')).length === 1, 'the run finishing set off job.flow.done, once');
  ok((await rico('GET', `/jobs/${job.id}/run`)).body?.run?.status === 'done', 'the run is done');

  // Deleting the job takes its run with it.
  await rico('DELETE', '/records/' + job.id);
  await sleep(300);
  ok((await rico('GET', `/jobs/${job.id}/run`)).status === 404, 'deleting the job removes its run');
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
