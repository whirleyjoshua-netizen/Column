// Work history, kept for team performance reporting (job plan Phase 5, the owner 2026-11-19). From now on Kloomie keeps,
// whichever way the work happens (the app, the public API, an automation, a step's tool, a sign-off):
// - for a task: who finished it (as a person, not a name) and how (in the app, the API, an automation, Kloomie), the
//   due date it had when finished and the first one it was given, when it was given to whoever has it now, and a
//   short history of being given, re-dated, sent for sign-off, finished and reopened;
// - for a step: when work on it started (its first task done), when it was finished and by whose change, and reopens;
// - for a visit: when it was done and by whom;
// - for an automation: how many runs went and failed each day, beyond its last 20;
// - for a job: each stage it moved to, when, and by whom, beyond its timeline's last 300 entries.
// None of it is sent to the browser with the task, step or job.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/history';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5228, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', FLOW_TIME_SCALE: '0.001', SCHEDULE_TICK_MS: '150' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// What's kept on disk: the server writes db.json, so the test reads what it really keeps.
// A write that started after the change: the file's time is after it (the server writes within 2 seconds of a change).
const disk = async () => { const since = Date.now(); await sleep(250); for (let i = 0; i < 60 && fs.statSync(DIR + '/db.json').mtimeMs < since + 200; i++) await sleep(100); return JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8')); };
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
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const [s0, s1] = statusF.choices;
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bill Nye', [statusF.id]: s0.id } })).body;
  const camp = (await rico('POST', '/campaigns', { name: 'Bill Nye install', recordId: job.id })).body;
  const g = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Install', kind: 'tasks', stage: s1.label })).body;

  // A task: given, re-dated, finished, reopened, given to someone else, finished again.
  const t1 = (await rico('POST', '/tasks', { text: 'Set the unit', goalId: g.id, assigneeId: samId, due: day(2) })).body;
  await sleep(20);
  await rico('PATCH', `/tasks/${t1.id}`, { due: day(-1) });
  await sam('PATCH', `/tasks/${t1.id}`, { done: true });
  let D = await disk(), T = D.tasks[t1.id];
  ok(T.doneById === samId && T.doneVia === 'app' && T.doneBy === 'Sam Reed', 'who finished it is kept as a person, and how: ' + JSON.stringify([T.doneById, T.doneVia]));
  ok(T.doneDue === day(-1) && T.firstDue === day(2), 'with the due date it had when finished (late) and the first one it was given: ' + JSON.stringify([T.doneDue, T.firstDue]));
  ok(T.assignedAt >= t1.createdAt && T.assignedAt <= t1.createdAt + 1000, 'and when it was given to Sam');
  const kinds = (x) => (x.hist || []).map((e) => e.k + ':' + (e.by === samId ? 'sam' : e.by === ricoId ? 'rico' : e.by === benId ? 'ben' : e.by || e.via));
  ok(kinds(T).join() === 'assigned:rico,due:rico,done:sam', 'its history: given by Rico, re-dated by Rico, done by Sam: ' + kinds(T).join());
  ok(T.hist[1].from === day(2) && T.hist[1].to === day(-1) && T.hist[0].to === samId, 'what changed is in it');
  ok(D.goals[g.id].startedAt === T.doneAt && D.goals[g.id].finishedAt >= T.doneAt && D.goals[g.id].finishedById === samId, 'the step: started when its first task was done, finished by Sam’s change: ' + JSON.stringify([D.goals[g.id].startedAt, D.goals[g.id].finishedAt, D.goals[g.id].finishedById]));
  await rico('PATCH', `/tasks/${t1.id}`, { done: false });
  await rico('PATCH', `/tasks/${t1.id}`, { assigneeId: benId });
  await ben('PATCH', `/tasks/${t1.id}`, { done: true });
  D = await disk(); T = D.tasks[t1.id];
  ok(T.reopens === 1 && T.doneById === benId && kinds(T).slice(3).join() === 'reopened:rico,assigned:rico,done:ben', 'reopened by Rico, given to Ben, done by Ben: ' + kinds(T).join());
  ok(D.goals[g.id].reopens === 1 && D.goals[g.id].finishedById === benId, 'the step was reopened once, and finished again by Ben’s change');

  // The job's stages, with when and who, kept apart from its timeline.
  const stages = (D.records[job.id].stages || []).map((x) => x.stage + ':' + (x.by === samId ? 'sam' : x.by === benId ? 'ben' : x.by === ricoId ? 'rico' : x.by || x.via));
  ok(stages.join() === `${s0.label}:rico,${s1.label}:sam`, 'the job’s stages: made at the first by Rico, moved on by Sam finishing its step (and not again when Ben finished it a second time, already there): ' + stages.join());

  // A sign-off: the one who did the work finished it; who approved it is kept too.
  const t2 = (await rico('POST', '/tasks', { text: 'Wire the thermostat', goalId: g.id, assigneeId: samId, signoff: { memberId: ricoId } })).body;
  await sam('PATCH', `/tasks/${t2.id}`, { done: true });
  await rico('PATCH', `/tasks/${t2.id}`, { done: true });
  D = await disk(); T = D.tasks[t2.id];
  ok(T.done && T.doneById === samId && T.approvedById === ricoId, 'signed off: Sam did it, Rico approved it: ' + JSON.stringify([T.doneById, T.approvedById]));
  ok(kinds(T).join() === 'assigned:rico,submitted:sam,done:rico', 'with the sign-off in its history: ' + kinds(T).join());

  // A step's tool: paying logs the money and finishes the step, as the person who paid.
  const t3 = (await rico('POST', '/tasks', { text: 'Pay for the part', goalId: g.id, assigneeId: benId, action: { kind: 'pay' } })).body;
  r = await ben('POST', '/money', { kind: 'out', amount: '84.50', day: day(0), category: 'Parts', note: 'Part', taskId: t3.id });
  D = await disk(); T = D.tasks[t3.id];
  ok(T.done && T.doneById === benId && T.doneVia === 'tool', 'done by its tool, as Ben: ' + JSON.stringify([r.status, T.done, T.doneById, T.doneVia]));

  // The public API: as the key's person, through the API.
  const key = (await rico('POST', '/integrations/keys', { name: 'Zapier' })).body.token;
  const v1 = async (m, path, body) => { const x = await fetch(B + '/api/v1' + path, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: body ? JSON.stringify(body) : undefined }); return { status: x.status, body: await x.json().catch(() => null) }; };
  r = await v1('POST', '/tasks', { text: 'From Zapier', assignee_id: samId, due: day(3) });
  const t4 = r.body;
  await v1('PATCH', `/tasks/${t4.id}`, { done: true });
  D = await disk(); T = D.tasks[t4.id];
  ok(r.status === 201 && T.doneById === ricoId && T.doneVia === 'api' && T.firstDue === day(3) && kinds(T).join() === 'assigned:rico,done:rico', 'through the API: as the key’s person, via the API: ' + JSON.stringify([T.doneById, T.doneVia, kinds(T)]));

  // An automation: its tasks are its own work, not a person's.
  const auto = (await rico('POST', '/automations', { name: 'Kickoff', trigger: { kind: 'campaign.started' }, actions: [{ kind: 'task', text: 'Kickoff call for {campaign}', assignee: samId }] })).body;
  ok(!!auto?.id, '(setup) an automation that adds a task ' + (auto?.error || ''));
  await rico('POST', '/campaigns', { name: 'Second job' });
  ok(await until(async () => Object.values((await disk()).tasks).some((x) => /Kickoff call/.test(x.text))), '(setup) it ran');
  D = await disk(); T = Object.values(D.tasks).find((x) => /Kickoff call/.test(x.text));
  ok(T.hist?.[0]?.k === 'assigned' && T.hist[0].via === 'automation' && T.hist[0].auto === auto.id && !T.hist[0].by && T.assignedAt > 0, 'given by the automation, not by a person: ' + JSON.stringify(T.hist));
  const tally = D.automations[auto.id].tally || {};
  ok(tally[Object.keys(tally)[0]]?.[0] === 1 && tally[Object.keys(tally)[0]]?.[1] === 0, 'the automation’s runs are tallied by day (1 went, 0 failed): ' + JSON.stringify(tally));

  // A run is counted once, when it ends: one that waits isn't counted while it waits, nor twice when it goes on;
  // one stopped while waiting counts as one that didn't go.
  const tl = async (aid) => { const x = (await disk()).automations[aid].tally || {}; return Object.values(x).reduce((n, v) => [n[0] + v[0], n[1] + v[1]], [0, 0]).join('/'); };
  const short = (await rico('POST', '/automations', { name: 'Short wait', trigger: { kind: 'task.reopened' }, actions: [{ kind: 'wait', amount: 1, unit: 'minutes' }, { kind: 'post', text: 'Back', channelId: 'general' }] })).body;
  const long = (await rico('POST', '/automations', { name: 'Long wait', trigger: { kind: 'task.reopened' }, actions: [{ kind: 'wait', amount: 2, unit: 'days' }, { kind: 'post', text: 'Later', channelId: 'general' }] })).body;
  await rico('PATCH', `/tasks/${t4.id}`, { done: false });
  ok(!!short?.id && !!long?.id, '(setup) two automations that wait: ' + (short?.error || long?.error || ''));
  ok(await until(async () => ((await rico('GET', '/automations')).body.find((x) => x.id === short.id)?.runs || []).some((y) => /After waiting/.test(y.note)), 15000), '(setup) the short wait went on');
  ok(await tl(short.id) === '1/0', 'a run that waited, then went on, counts once: ' + await tl(short.id));
  ok(await tl(long.id) === '0/0', 'one still waiting isn’t counted yet: ' + await tl(long.id));
  const ws = (await rico('GET', `/automations/${long.id}/waits`)).body;
  r = await rico('DELETE', `/automations/${long.id}/waits/${ws[0]?.id}`);
  ok(r.status === 200 && await tl(long.id) === '0/1', 'stopped while waiting: one that didn’t go: ' + await tl(long.id));
  const cnt = async (aid) => (await rico('GET', '/automations')).body.find((x) => x.id === aid)?.count || 0;
  ok(await cnt(short.id) === 1 && await cnt(long.id) === 0, 'its runs in all count the same way: ' + [await cnt(short.id), await cnt(long.id)].join('/'));
  r = await rico('POST', '/automations/test', { name: 'Short wait', trigger: { kind: 'task.reopened' }, actions: [{ kind: 'post', text: 'Try', channelId: 'general' }] });
  ok(r.status === 200 && await tl(short.id) === '1/0' && await cnt(short.id) === 1, 'testing an automation (a dry run) isn’t counted: ' + r.status);
  const nowA = (await rico('POST', '/automations', { name: 'By hand', trigger: { kind: 'schedule', slots: [{ days: [1], time: '09:00' }] }, actions: [{ kind: 'post', text: 'Now', channelId: 'general' }] })).body;
  r = await rico('POST', `/automations/${nowA?.id}/run`);
  ok(r.status === 200 && await tl(nowA.id) === '1/0' && await cnt(nowA.id) === 1, 'run by hand: counted once: ' + r.status + ' ' + (r.body?.error || '') + ' ' + await tl(nowA?.id));

  // A saved task used (saved tasks, column-f9): its task is given, by whoever used it.
  const pre = (await rico('POST', '/task-presets', { kind: 'task', text: 'Check the filters', dueIn: 2 })).body;
  r = await rico('POST', `/task-presets/${pre?.id}/use`, { assigneeId: benId });
  D = await disk();
  T = Object.values(D.tasks).find((x) => x.text === 'Check the filters');
  ok(r.status === 200 && T && kinds(T).join() === 'assigned:rico' && T.firstDue === T.due && T.assignedAt > 0, 'a saved task used: given to Ben by Rico, with its first due date: ' + JSON.stringify([r.status, r.body?.error, T && kinds(T)]));

  // A visit done: when and by whom.
  const v = (await rico('POST', `/records/${job.id}/visits`, { kind: 'Estimate', date: day(0), start: 540, memberIds: [samId, benId] })).body;
  await sam('PATCH', `/visits/${v.id}`, { done: true });
  D = await disk();
  const es = Object.values(D.entries).filter((e) => e.visitId === v.id);
  ok(es.length === 2 && es.every((e) => e.done && e.doneAt > 0 && e.doneById === samId), 'a visit done: when, and by Sam, on both its entries: ' + JSON.stringify(es.map((e) => [e.doneAt, e.doneById])));
  await sam('PATCH', `/visits/${v.id}`, { done: false });
  D = await disk();
  ok(Object.values(D.entries).filter((e) => e.visitId === v.id).every((e) => !e.done && !e.doneAt), 'and undone, cleared');

  // Kept on the server: none of it goes to the browser.
  st = (await sam('GET', '/state')).body;
  const pt = st.tasks.find((x) => x.id === t1.id), pg = st.goals.find((x) => x.id === g.id);
  ok(pt && !('hist' in pt) && pg && !('hist' in pg), 'the history isn’t sent with the task or step');
  const pr = (await rico('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === job.id);
  ok(pr && !('stages' in pr), 'nor the job’s stages with the job');
} catch (e) { ok(false, 'threw ' + e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-30).join('\n'));
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
