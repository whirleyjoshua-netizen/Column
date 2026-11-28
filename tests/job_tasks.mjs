// A job's checklist is a Checklist (the owner, 2026-11-27: "any group of tasks should be considered a campaign … the
// checklist on the job cards … should technically be a campaign"). Each step is a task in a Checklist linked to the
// job (c.jobId, never c.recordId, so Job Flows doesn't take the job for a campaign-run one). The job's checklist field
// is a copy of those tasks, kept in step both ways, so the job card, the Work step, the API and webhooks read it as
// before. From column-fe's crew test: steps start for nobody; whoever is on the job (its lead, its maker, an admin, or
// someone on one of its visits) ticks, and the server names who; its lead and admins add, reword, reorder and mark a step
// "not needed" (kept, so the record shows it was skipped); everyone else only reads. Who sees the Checklist is who sees
// the job. Existing jobs' steps move over once, at start; deleting the job deletes its Checklist.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobtasks';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5502, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', SKIP_SETUP: '1', DATABASE_URL: '', NODE_ENV: 'test' };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.once('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
  console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1);
};
const stop = async () => { srv.kill('SIGTERM'); await srv.exited; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
await start();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Cool ' + t, name: 'Dana Brooks', email: `dana${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const danaTok = r.body.token, dana = call(danaTok);
  let st = (await dana('GET', '/state')).body;
  const toks = {};
  const join = async (name, n) => { toks[name] = (await call()('POST', '/auth', { mode: 'join', workspace: 'Cool ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token; return call(toks[name]); };
  const luis = await join('Luis Ortega', 2), jamie = await join('Jamie Park', 3), kim = await join('Kim Lee', 4);
  st = (await dana('GET', '/state')).body;
  const idOf = (name) => st.workspace.members.find((m) => m.name === name)?.id;
  await dana('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, camps: true } });
  const tz = st.workspace.tz || 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());
  const p = (await dana('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types.find((x) => x.key === 'trade_hvac');
  const cf = tp.fields.find((f) => f.type === 'checklist');
  const crewF = tp.fields.find((f) => f.type === 'person');
  r = await dana('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { [tp.primary]: 'Chen tune-up', [crewF.id]: idOf('Luis Ortega') } });
  const job = r.body;
  await dana('POST', `/records/${job.id}/visits`, { kind: 'Tune-up', date: today, start: 540, end: 660, memberIds: [idOf('Luis Ortega'), idOf('Jamie Park')] });
  const items = async () => (await dana('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === job.id)?.values[cf.id]?.items || [];
  const state = async (C = dana) => (await C('GET', '/state')).body;
  // The Checklist, as tasks: from the job (it's on the job card, not in anyone's Campaigns or Tasks).
  const steps = async (C = dana, id = job.id) => { const y = await C('GET', `/records/${id}/steps`); return { status: y.status, cl: y.body?.campaign, ts: y.body?.tasks || [] }; };
  const go = (who, body) => who('POST', `/records/${job.id}/checklist/${cf.id}`, body);

  // ---- made with the job ----
  let { cl, ts } = await steps(), list = await items();
  ok(cl && cl.type === 'checklist' && !cl.recordId && !cl.channelId && !cl.stackId, 'the job has a Checklist: linked by jobId (not recordId), no feed or stack of its own');
  ok(list.length >= 5 && ts.length === list.length && ts.every((x, i) => x.text === list[i].text), `its tasks are the job’s steps, in order (${ts.length} of ${list.length})`);
  ok(ts.every((x) => !x.assigneeId && !x.roleId), 'and they start for nobody');
  st = await state();
  ok(!(st.campaigns || []).some((c) => c.jobId) && !(st.tasks || []).some((x) => ts.some((y) => y.id === x.id)) && !(st.goals || []).some((g) => g.campaignId === cl.id), 'it stays out of the Campaigns list and Tasks (it’s on the job card)');

  // ---- ticking: whoever is on the job; the server names who ----
  r = await go(jamie, { op: 'tick', itemId: list[0].id });
  ({ cl, ts } = await steps());
  ok(r.status === 200 && ts[0].done && ts[0].doneById === idOf('Jamie Park'), 'Jamie (on the visit) ticks a step on the job card: its task is done, by Jamie');
  r = await luis('PATCH', '/tasks/' + ts[1].id, { done: true });
  list = await items();
  ok(r.status === 200 && list[1].done && list[1].by === 'Luis Ortega', 'Luis ticks the next as a task: the job card’s copy says done, by Luis');
  r = await kim('PATCH', '/tasks/' + ts[2].id, { done: true });
  ok(r.status === 403, `Kim (not on the job) can’t tick its tasks (${r.status})`);
  r = await go(kim, { op: 'tick', itemId: list[2].id });
  ok(r.status === 403, 'nor its steps on the card');

  // ---- changing the steps: its lead and admins ----
  r = await go(luis, { op: 'add', text: 'Check the condensate line' });
  list = await items(); ({ cl, ts } = await steps());
  ok(r.status === 200 && list.at(-1).text === 'Check the condensate line' && ts.at(-1)?.text === 'Check the condensate line', 'Luis (its lead) adds a step: a task too');
  r = await go(luis, { op: 'rename', itemId: list[3].id, text: 'Replace the filter (20x25)' });
  list = await items(); ({ cl, ts } = await steps());
  ok(r.status === 200 && list[3].text === 'Replace the filter (20x25)' && ts[3].text === 'Replace the filter (20x25)', 'rewords one');
  const moving = list.at(-1).id;
  r = await go(luis, { op: 'move', itemId: moving, to: 0 });
  list = await items(); ({ cl, ts } = await steps());
  ok(r.status === 200 && list[0].id === moving && ts[0].text === 'Check the condensate line', 'moves one to the top');
  const skip = list.at(-1);
  r = await go(luis, { op: 'skip', itemId: skip.id });
  list = await items(); ({ cl, ts } = await steps());
  ok(r.status === 200 && list.find((x) => x.id === skip.id)?.skip && list.find((x) => x.id === skip.id)?.text === skip.text && ts.find((x) => x.text === skip.text)?.skipped, 'marks one not needed: still on the list, marked skipped');
  const log = (await dana('GET', `/records/${job.id}/log`)).body;
  ok(JSON.stringify(log).includes('Not needed'), 'and the job’s timeline says so');
  for (const [what, body] of [['add', { op: 'add', text: 'Extra' }], ['reword', { op: 'rename', itemId: list[1].id, text: 'x' }], ['move', { op: 'move', itemId: list[1].id, to: 0 }], ['skip', { op: 'skip', itemId: list[1].id }]]) {
    r = await go(jamie, body);
    ok(r.status === 403, `Jamie (only on the visit) can’t ${what} a step`);
  }
  ({ cl, ts } = await steps());
  r = await jamie('PATCH', '/tasks/' + ts[1].id, { text: 'Mine now' });
  ok(r.status === 403, 'nor reword its task');
  r = await jamie('POST', '/goals', { campaignId: cl.id, title: 'More' });
  ok(r.status === 403, 'nor add to the Checklist');
  r = await luis('PATCH', '/tasks/' + ts[1].id, { text: 'Clean the coils (both)' });
  list = await items();
  ok(r.status === 200 && list[1].text === 'Clean the coils (both)', 'Luis rewords a task: the card follows');

  // ---- a whole-list save (an older app, the API) lands on the tasks too ----
  const cut = list.filter((_, i) => i !== 2);
  r = await dana('PATCH', '/records/' + job.id, { values: { [cf.id]: { items: cut } } });
  ({ cl, ts } = await steps());
  ok(r.status === 200 && ts.length === cut.length && ts.every((x, i) => x.text === cut[i].text), 'a whole-list save that drops a step drops its task');

  // ---- who sees it: who sees the job ----
  await dana('PATCH', '/workspace', { visibility: 'own' });
  ok((await steps(kim)).status === 404, 'with members seeing only theirs, Kim (not on the job) can’t get its Checklist');
  ok((await kim('PATCH', '/tasks/' + ts[0].id, { done: false })).status === 404, 'nor reach its tasks');
  ok((await steps(luis)).ts.length === ts.length, 'Luis can');
  await dana('PATCH', '/workspace', { visibility: 'all' });

  // ---- the Work step counts a skipped step as done ----
  for (const x of await items()) if (!x.done && !x.skip) await go(luis, { op: 'tick', itemId: x.id });
  list = await items();
  ok(list.every((x) => x.done || x.skip), '(setup) every step ticked or not needed');

  // ---- a Checklist made on the one-page create, for a job, isn't campaign steps: Job Flows still moves the job ----
  const lee = (await dana('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { [tp.primary]: 'Lee repair' } })).body;
  r = await dana('POST', '/campaigns', { name: 'Lee extras', type: 'checklist', recordId: lee.id });
  ok(r.status === 200, '(setup) a Checklist for the Lee job, from the create page');
  r = await dana('GET', '/jobs/move');
  const la = (r.body?.lists || []).find((x) => x.projectId === p.id && x.typeId === tp.id);
  ok(la && la.legacy === 0, 'Move my jobs here doesn’t take it for a job on campaign steps: ' + JSON.stringify(la && { n: la.notOnFlow, l: la.legacy }));

  // ---- existing jobs' steps move over once, at start ----
  r = await dana('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { [tp.primary]: 'Old job', [cf.id]: { items: [{ text: 'One', done: true }, { text: 'Two' }] } } });
  const old = r.body;
  await stop();
  const dbf = DIR + '/db.json';
  const raw = JSON.parse(fs.readFileSync(dbf, 'utf8'));
  const oc = Object.values(raw.campaigns).find((c) => c.jobId === old.id);
  ok(!!oc, '(setup) the old job had one');
  // As it was before Checklists: no campaign, no tasks.
  for (const g of Object.values(raw.goals)) if (g.campaignId === oc.id) { for (const x of Object.values(raw.tasks)) if (x.goalId === g.id) delete raw.tasks[x.id]; delete raw.goals[g.id]; }
  delete raw.campaigns[oc.id];
  fs.writeFileSync(dbf, JSON.stringify(raw));
  await start();
  let ms = await steps(dana, old.id);
  ok(ms.cl && ms.ts.map((x) => x.text + (x.done ? '✓' : '')).join(',') === 'One✓,Two', 'a job from before gets its Checklist at start, ticks kept: ' + ms.ts.map((x) => x.text).join(','));
  await stop(); await start();
  ms = await steps(dana, old.id);
  const camps = Object.values(JSON.parse(fs.readFileSync(dbf, 'utf8')).campaigns).filter((c) => c.jobId === old.id);
  ok(camps.length === 1 && ms.ts.length === 2, 'once (another restart doesn’t make two)');

  // ---- deleting the job deletes its Checklist ----
  const clId = (await steps()).cl.id;
  r = await dana('DELETE', '/records/' + job.id);
  await stop();
  const after = JSON.parse(fs.readFileSync(dbf, 'utf8'));
  ok(r.status === 200 && !after.campaigns[clId] && !Object.values(after.goals).some((g) => g.campaignId === clId) && !ts.some((y) => after.tasks[y.id]), 'deleting the job deletes its Checklist and its tasks');
  await start();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  if (fails) console.log(srv.log.slice(-1500));
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
