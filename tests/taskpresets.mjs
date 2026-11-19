// Saved tasks and bundles (the owner, 2026-11-19: "a way to make preset tasks… you can just select or drag and
// drop… would this help the automation builder"). A saved task is the task without a date: what it says, who it
// usually goes to (a person or a role), when it's due after it's made, priority, repeat, who signs it off. A bundle is
// saved tasks in order: each waits for the one before and is due some days after that one's done. Anyone on the team
// can use them; whoever made one (or an admin) changes it. Using one makes real tasks, for a day, a person, a job.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/taskpresets';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5150, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-time-zone': 'UTC', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const plus = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Presets ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const ben = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Presets ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  const cy = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Presets ' + t, code, name: 'Cy', email: `cy${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' })).body.token);
  const st = (await ada('GET', '/state')).body;
  const today = st.today || new Date().toISOString().slice(0, 10);
  const benId = st.workspace.members.find((x) => x.name === 'Ben').id, cyId = st.workspace.members.find((x) => x.name === 'Cy').id;

  // A saved task.
  let r = await ben('POST', '/task-presets', { text: 'Order the materials', assigneeId: benId, dueIn: 2, priority: 2 });
  ok(r.status === 200 && r.body.kind === 'task' && r.body.name === 'Order the materials' && r.body.dueIn === 2 && r.body.priority === 2 && r.body.assigneeId === benId, 'Ben saves a task: what it says, who, due 2 days after, priority');
  const order = r.body;
  ok((await ben('POST', '/task-presets', { text: '' })).status === 400, 'a saved task has to say something');
  ok((await ben('POST', '/task-presets', { text: 'x', assigneeId: 'nobody' })).body?.assigneeId == null, 'someone not on the team isn’t kept');
  const call2 = (await ada('POST', '/task-presets', { text: 'Call the customer to book', name: 'Book the install' })).body;
  const fu = (await ada('POST', '/task-presets', { text: 'Follow up: happy with it?', signoffId: cyId })).body;
  ok(fu.signoffId === cyId, 'with who signs it off');

  // Everyone on the team sees them; only the maker or an admin changes one.
  const list = (await cy('GET', '/task-presets')).body;
  ok(list.presets.length === 4 && list.presets.some((x) => x.id === order.id), 'Cy sees the team’s saved tasks');
  ok((await cy('PATCH', '/task-presets/' + order.id, { text: 'Hijacked' })).status === 403, 'Cy can’t change Ben’s');
  ok((await ada('PATCH', '/task-presets/' + order.id, { dueIn: 3 })).body?.dueIn === 3, 'an admin can');
  ok((await ben('PATCH', '/task-presets/' + order.id, { dueIn: 2 })).body?.dueIn === 2, 'and so can Ben');

  // Using a saved task makes a task.
  r = await cy('POST', `/task-presets/${order.id}/use`, {});
  const made = r.body?.tasks?.[0];
  ok(r.status === 200 && made && made.text === 'Order the materials' && made.due === plus(today, 2) && made.assigneeId === benId && made.priority === 2, 'using it makes the task, due 2 days from today, for Ben');
  ok((await ben('GET', '/state')).body.tasks.some((x) => x.id === made.id), 'Ben has it');
  r = await cy('POST', `/task-presets/${order.id}/use`, { date: plus(today, 5), assigneeId: cyId });
  ok(r.body?.tasks?.[0]?.due === plus(today, 5) && r.body.tasks[0].assigneeId === cyId, 'dropped on a day and a person: that day, that person');
  ok((await cy('POST', `/task-presets/${order.id}/use`, { date: 'tomorrow' })).status === 400, 'a bad day is turned away');

  // A bundle: saved tasks in order.
  r = await ada('POST', '/task-presets', { kind: 'bundle', name: 'New install', steps: [{ presetId: call2.id }, { presetId: order.id, after: 1 }, { presetId: fu.id, after: 7 }] });
  ok(r.status === 200 && r.body.kind === 'bundle' && r.body.steps.length === 3, 'Ada saves a bundle of three');
  const bundle = r.body;
  ok((await ada('POST', '/task-presets', { kind: 'bundle', name: 'Empty', steps: [] })).status === 400, 'a bundle needs at least one saved task');
  ok((await ada('POST', '/task-presets', { kind: 'bundle', name: 'Nested', steps: [{ presetId: bundle.id }] })).status === 400, 'a bundle can’t hold a bundle');
  r = await ben('POST', `/task-presets/${bundle.id}/use`, { date: plus(today, 1) });
  const [a1, a2, a3] = r.body?.tasks || [];
  ok(r.status === 200 && r.body.tasks.length === 3, 'using it makes three tasks');
  ok(a1 && a1.text === 'Call the customer to book' && a1.due === plus(today, 1) && !(a1.blockedBy || []).length, 'the first is due on the day it was dropped');
  ok(a2 && a2.blockedBy?.[0] === a1.id && a2.dueAfter === 1 && a2.due == null && a2.assigneeId === benId, 'the second waits for the first, due a day after it’s done, still Ben’s');
  ok(a3 && a3.blockedBy?.[0] === a2.id && a3.dueAfter === 7, 'the third waits for the second');
  ok(a1 && a1.preset === bundle.id && a2.preset === bundle.id, 'they remember the bundle they came from');

  // On a job.
  const p = (await ada('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const hv = p.types.find((x) => x.key === 'trade_hvac');
  const job = (await ada('POST', `/projects/${p.id}/records`, { typeId: hv.id, values: { job: 'Smith furnace' } })).body;
  r = await ada('POST', `/task-presets/${order.id}/use`, { recordId: job.id });
  ok(r.body?.tasks?.[0]?.recordId === job.id, 'used on a job, the task is the job’s');

  // In an automation: "Make a task" from a saved task or a bundle.
  const flow = { name: 'New customer, new install', trigger: { kind: 'contact.created' }, actions: [{ kind: 'task', presetId: bundle.id, assignee: '' }, { kind: 'task', presetId: order.id, assignee: cyId, dueIn: 4 }] };
  ok((await ada('POST', '/automations', { ...flow, actions: [{ kind: 'task', presetId: 'nope' }] })).status === 400, 'a saved task that isn’t there can’t be picked');
  r = await ada('POST', '/automations/test', flow);
  ok(r.status === 200 && r.body.steps[0].said === 'Make 3 tasks from the bundle “New install”' && r.body.steps[1].said === 'Make the task “Order the materials” for Cy', `testing it says what it would make (${r.body.steps?.map((x) => x.said).join(' | ')})`);
  const n0 = (await ada('GET', '/state')).body.tasks.length;
  await sleep(300);
  ok((await ada('GET', '/state')).body.tasks.length === n0, 'and makes nothing');
  const auto = (await ada('POST', '/automations', flow)).body;
  ok(auto?.actions?.[0]?.presetId === bundle.id && auto.actions[0].presetName === 'New install' && !auto.problems.length, 'saved, it keeps which bundle');
  ok((await ada('GET', '/task-presets')).body.presets.find((x) => x.id === bundle.id).used.automations[0] === 'New customer, new install', 'the bundle says which automation makes it');
  ok((await ada('DELETE', '/task-presets/' + bundle.id)).status === 409, 'so it can’t be deleted while the automation uses it');
  await ada('POST', '/contacts', { name: 'Dana Ruiz' });
  let mine = [];
  for (let i = 0; i < 40 && mine.length < 4; i++) { await sleep(150); mine = (await ada('GET', '/state')).body.tasks.filter((x) => x.preset && x.createdAt > Date.now() - 10_000 && x.by === 'New customer, new install'); }
  ok(mine.length === 4, `a new contact: the automation makes the bundle’s three and the one (${mine.length})`);
  const fromOrder = mine.find((x) => x.preset === order.id);
  ok(fromOrder && fromOrder.assigneeId === cyId && fromOrder.due === plus(today, 4), 'the step’s own person and due day win');
  ok(mine.filter((x) => x.preset === bundle.id).some((x) => x.blockedBy?.length), 'and the bundle’s tasks wait for each other');
  await ada('PATCH', '/task-presets/' + order.id, { text: 'Order the materials (check the van first)' });
  r = await ada('POST', '/automations/test', flow);
  ok(r.body.steps[1].said.includes('check the van first'), 'changing the saved task changes what the automation makes');
  await ada('DELETE', '/automations/' + auto.id);

  // Gone things, and deleting.
  ok((await ada('DELETE', '/task-presets/' + order.id)).status === 409, 'a saved task in a bundle can’t be deleted');
  ok((await cy('DELETE', '/task-presets/' + bundle.id)).status === 403, 'Cy can’t delete Ada’s bundle');
  ok((await ada('DELETE', '/task-presets/' + bundle.id)).status === 200, 'Ada deletes the bundle');
  ok((await ben('DELETE', '/task-presets/' + order.id)).status === 200, 'then Ben’s task can go');
  ok((await cy('POST', `/task-presets/${order.id}/use`, {})).status === 404, 'and can’t be used');

  // Another team sees none of it.
  const other = call((await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Zed', email: `zed${t}@t.test`, password: 'longenough4', device: 'Mac', deviceId: 'd4' })).body.token);
  ok((await other('GET', '/task-presets')).body.presets.length === 0, 'another team sees none');
  ok((await other('POST', `/task-presets/${call2.id}/use`, {})).status === 404, 'and can’t use ours');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
