// An automation for one task (2026-11-23, from the campaign planner): narrowed to a task by its name and id, inside
// its step. It fires for that task only, still does after the task is renamed, and fires for the task of the same
// name in the same step (a saved campaign's next run). A task filter needs a step, is dropped on events that aren't
// about one task, and a task the maker can't see (or another team's) isn't kept.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/taskautos';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5460, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Ta ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r0.body.token);
  r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r0.body.token);
  const camp = (await maria('POST', '/campaigns', { name: 'Roof' })).body;
  const prep = (await maria('POST', '/goals', { campaignId: camp.id, title: 'Prep' })).body;
  const tarp = (await maria('POST', '/tasks', { goalId: prep.id, text: 'Lay the tarps' })).body;
  const order = (await maria('POST', '/tasks', { goalId: prep.id, text: 'Order shingles' })).body;
  const mk = (who, name, trigger) => who('POST', '/automations', { name, on: true, trigger, actions: [{ kind: 'notify', text: 'Done: {task}', to: ['owners'] }] });
  let r = await mk(maria, 'Tarps done', { kind: 'task.done', campaignId: camp.id, step: 'Prep', task: 'Lay the tarps', taskId: tarp.id });
  ok(r.status === 200 && r.body.trigger.task === 'Lay the tarps' && r.body.trigger.taskId === tarp.id, 'an automation can be narrowed to one task (its name and id)');
  const one = r.body;
  r = await mk(maria, 'No step', { kind: 'task.done', campaignId: camp.id, task: 'Lay the tarps', taskId: tarp.id });
  ok(r.status === 200 && r.body.trigger.step === 'Prep', 'a task without its step gets the task’s step');
  ok((await mk(maria, 'Step done', { kind: 'step.done', step: 'Prep', task: 'Lay the tarps', taskId: tarp.id })).body?.trigger?.task == null, 'a task filter is dropped on “a step is finished”');
  ok((await mk(maria, 'Contact', { kind: 'contact.created', task: 'Lay the tarps' })).body?.trigger?.task == null, 'and on events that aren’t about tasks');
  r = await mk(olga, 'Theirs', { kind: 'task.done', step: 'Prep', task: 'Lay the tarps', taskId: tarp.id });
  ok(r.status === 200 && r.body.trigger.taskId == null, 'another team’s task id isn’t kept');
  const runsOf = async (id, want = 1) => { for (let i = 0; i < 30; i++) { const x = (await maria('GET', '/automations')).body.find((y) => y.id === id); if ((x?.runs?.length || 0) >= want) return x.runs; await sleep(100); } return (await maria('GET', '/automations')).body.find((y) => y.id === id)?.runs || []; };
  await maria('PATCH', '/tasks/' + order.id, { done: true });
  await sleep(600);
  ok(!(await runsOf(one.id)).length, 'another task in the same step doesn’t set it off');
  await maria('PATCH', '/tasks/' + tarp.id, { text: 'Lay the blue tarps' });
  await maria('PATCH', '/tasks/' + tarp.id, { done: true });
  ok((await runsOf(one.id))[0]?.ok, 'its own task does, even renamed');
  // A second run of the campaign: a task of the same name in the same step.
  const camp2 = (await maria('POST', '/campaigns', { name: 'Roof 2' })).body;
  const prep2 = (await maria('POST', '/goals', { campaignId: camp2.id, title: 'Prep' })).body;
  const tarp2 = (await maria('POST', '/tasks', { goalId: prep2.id, text: 'lay the tarps' })).body;
  const any = (await mk(maria, 'Tarps, any campaign', { kind: 'task.done', step: 'Prep', task: 'Lay the tarps' })).body;
  ok(any.trigger.task === 'Lay the tarps' && any.trigger.taskId == null, 'a task can be named without an id (the full builder)');
  await maria('PATCH', '/tasks/' + tarp2.id, { done: true });
  ok((await runsOf(any.id))[0]?.ok, 'the task of the same name in the same step sets it off (a saved campaign’s next run)');
  const other = (await maria('POST', '/goals', { campaignId: camp2.id, title: 'Clean up' })).body;
  const tarp3 = (await maria('POST', '/tasks', { goalId: other.id, text: 'Lay the tarps' })).body;
  await maria('PATCH', '/tasks/' + tarp3.id, { done: true });
  await sleep(600);
  ok((await runsOf(any.id)).length === 1, 'but not one of the same name in another step');
  ok(!/Error|TypeError/.test(srv.log), 'no server errors');
} catch (e) { ok(false, e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
