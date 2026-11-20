// The task drawer (2026-11-20, Command Center part 2): a description; In progress (cleared when done); a checklist that
// keeps who ticked what; subtasks one level deep, and a task can't be finished while they're open; comments that tell
// whoever the task is for (not the writer), deleted only by their writer or an admin; its history; deleting a parent
// keeps its subtasks; a saved campaign keeps descriptions, checklists (unticked) and subtasks.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/tdrawer';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4953, B = `http://127.0.0.1:${PORT}`;
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
  let r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Drw ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r0.body.token);
  const code = (await maria('GET', '/state')).body.workspace.inviteCode;
  r0 = await call()('POST', '/auth', { mode: 'join', workspace: 'Drw ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r0.body.token);
  r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r0.body.token);

  const samId = (await sam('GET', '/state')).body.me.memberId;
  const camp = (await maria('POST', '/campaigns', { name: 'Install week' })).body;
  const g = (await maria('POST', '/goals', { campaignId: camp.id, title: 'Install' })).body;
  let r = await maria('POST', '/tasks', { goalId: g.id, text: 'Hang the blinds', assigneeId: samId, description: 'Living room and kitchen.\r\nBring the long ladder.', checklist: [{ text: 'Measure again' }, { text: 'Drill' }, { text: '' }] });
  const task = r.body;
  ok(r.status === 200 && task.description === 'Living room and kitchen.\nBring the long ladder.' && task.checklist.map((x) => x.text).join() === 'Measure again,Drill' && task.checklist.every((x) => x.id && !x.done), 'a task can have a description and a checklist (empty items dropped)');
  r = await sam('PATCH', '/tasks/' + task.id, { status: 'doing' });
  ok(r.body.status === 'doing', 'Sam marks it In progress');
  r = await sam('PATCH', '/tasks/' + task.id, { checklist: task.checklist.map((x, i) => ({ ...x, done: i === 0, by: 'Sam' })) });
  ok(r.body.checklist[0].done && r.body.checklist[0].by === 'Sam' && r.body.checklist[0].at && !r.body.checklist[1].done, 'ticking a checklist item keeps who and when');
  // Subtasks.
  const sub = (await maria('POST', '/tasks', { goalId: g.id, text: 'Order brackets', parentId: task.id })).body;
  ok(sub.parentId === task.id, 'a subtask belongs to its task');
  ok(!(await maria('POST', '/tasks', { goalId: g.id, text: 'Too deep', parentId: sub.id })).body.parentId, 'one level deep: a subtask can’t have subtasks');
  ok(!(await maria('PATCH', '/tasks/' + task.id, { parentId: task.id })).body.parentId, 'a task can’t be its own subtask');
  r = await sam('PATCH', '/tasks/' + task.id, { done: true });
  ok(r.status === 409 && /Order brackets/.test(r.body.error), 'it can’t be finished while a subtask is open: ' + r.body?.error);
  await maria('PATCH', '/tasks/' + sub.id, { done: true });
  r = await sam('PATCH', '/tasks/' + task.id, { done: true });
  ok(r.status === 200 && r.body.done && !r.body.status, 'with its subtask done it finishes, and In progress clears');
  // Comments.
  r = await maria('POST', `/tasks/${task.id}/comments`, { text: 'Ladder is in the van.' });
  const cm = r.body.comments?.[0];
  ok(r.status === 200 && cm?.text === 'Ladder is in the van.' && cm.by === 'Maria', 'Maria comments on it');
  ok((await sam('GET', '/notices')).body.some((n) => n.text === 'Ladder is in the van.' && n.title.includes('Maria commented')), 'Sam, whose task it is, is told');
  ok(!(await maria('GET', '/notices')).body.some((n) => n.text === 'Ladder is in the van.'), 'the writer isn’t');
  ok((await maria('POST', `/tasks/${task.id}/comments`, { text: '  ' })).status === 400, 'an empty comment is refused');
  const samC = (await sam('POST', `/tasks/${task.id}/comments`, { text: 'Thanks' })).body.comments.find((x) => x.text === 'Thanks');
  ok((await sam('DELETE', `/tasks/${task.id}/comments/${cm.id}`)).status === 403, 'Sam can’t delete Maria’s comment');
  ok((await maria('DELETE', `/tasks/${task.id}/comments/${samC.id}`)).status === 200, 'an owner (admin) can delete Sam’s');
  ok((await olga('POST', `/tasks/${task.id}/comments`, { text: 'hi' })).status === 404, 'another team can’t comment');
  // History.
  r = await sam('GET', `/tasks/${task.id}/history`);
  ok(r.status === 200 && r.body.some((x) => x.k === 'done' && x.by === 'Sam'), 'its history says Sam finished it');
  // Deleting a parent keeps its subtasks.
  const p2 = (await maria('POST', '/tasks', { goalId: g.id, text: 'Pack the van' })).body;
  const s2 = (await maria('POST', '/tasks', { goalId: g.id, text: 'Load ladders', parentId: p2.id })).body;
  await maria('DELETE', '/tasks/' + p2.id);
  const st = (await maria('GET', '/state')).body.tasks;
  ok(st.some((x) => x.id === s2.id && !x.parentId), 'deleting a task keeps its subtasks, as tasks of their own');
  // A saved campaign keeps descriptions, checklists (unticked) and subtasks.
  const fresh = (await maria('POST', '/tasks', { goalId: g.id, text: 'Walk the job', description: 'With the customer', checklist: [{ text: 'Photos', done: true }] })).body;
  await maria('POST', '/tasks', { goalId: g.id, text: 'Before photos', parentId: fresh.id });
  const tp = (await maria('POST', '/templates', { campaignId: camp.id, name: 'Install week', tz: 'America/Los_Angeles' })).body;
  r = await maria('POST', `/templates/${tp.id}/run`, { date: '2026-12-01' });
  const ts = (await maria('GET', '/state')).body.tasks.filter((x) => (x.goalId && (x.goalId !== g.id)));
  const walk = ts.find((x) => x.text === 'Walk the job'), photos = ts.find((x) => x.text === 'Before photos');
  ok(walk && walk.description === 'With the customer' && walk.checklist?.[0]?.text === 'Photos' && !walk.checklist[0].done, 'a saved campaign’s run keeps the description and the checklist, unticked');
  ok(photos && photos.parentId === walk.id, 'and the subtask, under its new task');
} catch (e) { ok(false, e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
