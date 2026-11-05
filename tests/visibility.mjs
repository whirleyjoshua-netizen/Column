// What members see: everything (the default), or only what's theirs. In "only theirs" a member gets the
// campaigns they run, belong to or have a task in (with everything in them), their own tasks and files
// outside campaigns, and the team's chat. Nothing else reaches them: not the state, not by id, not live.
// Owners and admins see everything.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/vis';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4787, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/api/auth', { mode: 'create', workspace: 'Vis ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jt = r.body.token, J = call(jt);
  const code = (await J('GET', '/api/state')).body.workspace.inviteCode;
  const join = async (name, n) => (await call()('POST', '/api/auth', { mode: 'join', workspace: 'Vis ' + t, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd' + n })).body.token;
  const kt = await join('Ken', 2), K = call(kt), L = call(await join('Lee', 3)), A = call(await join('Ann', 4));
  const ids = Object.fromEntries((await J('GET', '/api/state')).body.workspace.members.map((m) => [m.name, m.id]));
  await J('PATCH', '/api/members/' + ids.Ann, { role: 'admin' });

  // Jo's things
  const campA = (await J('POST', '/api/campaigns', { name: 'With Ken', memberIds: [ids.Ken] })).body;
  const campB = (await J('POST', '/api/campaigns', { name: 'Jo only' })).body;
  const goalB = (await J('POST', '/api/goals', { campaignId: campB.id, title: 'Close five' })).body;
  const taskB = (await J('POST', '/api/tasks', { text: 'Call the dealer', goalId: goalB.id, assigneeId: ids.Lee })).body;
  const joTask = (await J('POST', '/api/tasks', { text: 'Jo’s own errand' })).body;
  const kenTask = (await J('POST', '/api/tasks', { text: 'For Ken', assigneeId: ids.Ken })).body;
  const joDoc = (await J('POST', '/api/items', { type: 'text', text: 'Pricing notes' })).body;
  const joMsg = (await J('POST', '/api/items', { type: 'message', text: 'Morning all' })).body;
  // Ken's
  const kenOwn = (await K('POST', '/api/tasks', { text: 'Ken’s note to self' })).body;
  const kenDoc = (await K('POST', '/api/items', { type: 'text', text: 'Ken’s doc' })).body;
  ok(goalB.id && taskB.id && joDoc.id && kenDoc.id, 'set up');

  const seen = async (who) => { const s = (await who('GET', '/api/state')).body; return { camps: s.campaigns.map((x) => x.id), tasks: s.tasks.map((x) => x.id), items: s.items.map((x) => x.id), goals: s.goals.map((x) => x.id) }; };
  let k = await seen(K);
  ok(k.camps.includes(campB.id) && k.tasks.includes(joTask.id) && k.items.includes(joDoc.id), 'by default members see everything');

  ok((await K('PATCH', '/api/workspace', { visibility: 'own' })).status === 403, 'a member can’t change what members see');
  ok((await K('PATCH', '/api/workspace', { expireHours: 1 })).status === 403, 'or the team’s auto-clear');

  // Ken listens live from here on.
  const live = [];
  const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws?t=${kt}`);
  sock.on('message', (d) => live.push(JSON.parse(d)));
  await new Promise((res) => sock.on('open', res));

  r = await A('PATCH', '/api/workspace', { visibility: 'own' });
  ok(r.status === 200 && r.body.settings.visibility === 'own', 'an admin sets members to see only what’s theirs');
  await sleep(300);
  ok(live.some((m) => m.type === 'resync'), 'members’ apps load again when it changes');

  k = await seen(K);
  ok(k.camps.includes(campA.id) && !k.camps.includes(campB.id), 'Ken sees the campaign he’s in, not the other');
  ok(!k.goals.includes(goalB.id) && !k.tasks.includes(taskB.id), 'nor its goals and tasks');
  ok(k.tasks.includes(kenTask.id) && k.tasks.includes(kenOwn.id) && !k.tasks.includes(joTask.id), 'his tasks (given to him, made by him), not Jo’s');
  ok(k.items.includes(kenDoc.id) && k.items.includes(joMsg.id) && !k.items.includes(joDoc.id), 'his own doc and the team chat, not Jo’s doc');
  const l = await seen(L);
  ok(l.camps.includes(campB.id) && l.goals.includes(goalB.id) && l.tasks.includes(taskB.id), 'Lee sees the campaign she has a task in, with its goal');
  const a = await seen(A), j = await seen(J);
  ok([campA.id, campB.id].every((id) => a.camps.includes(id) && j.camps.includes(id)) && a.tasks.includes(joTask.id) && a.items.includes(joDoc.id), 'owners and admins see everything');

  // not by id either
  ok((await K('PATCH', '/api/tasks/' + joTask.id, { done: true })).status === 404, 'a hidden task can’t be reached by id');
  ok((await K('PATCH', '/api/items/' + joDoc.id, { pinned: true })).status === 404, 'nor a hidden doc');
  ok((await K('POST', '/api/goals', { campaignId: campB.id, title: 'Sneak in' })).status === 404, 'nor a hidden campaign');

  // not live either
  live.length = 0;
  const joDoc2 = (await J('POST', '/api/items', { type: 'text', text: 'Margins' })).body;
  const joTask2 = (await J('POST', '/api/tasks', { text: 'Another of Jo’s' })).body;
  await J('POST', '/api/tasks', { text: 'In the hidden campaign', goalId: goalB.id });
  const kenTask2 = (await J('POST', '/api/tasks', { text: 'Also for Ken', assigneeId: ids.Ken })).body;
  await sleep(500);
  const got = JSON.stringify(live);
  ok(!got.includes('Margins') && !got.includes(joDoc2.id) && !got.includes(joTask2.id) && !got.includes('In the hidden campaign'), 'hidden things never reach Ken live');
  ok(got.includes(kenTask2.id), 'his new task does');

  // handing work over
  live.length = 0;
  await J('PATCH', '/api/tasks/' + kenTask.id, { assigneeId: ids.Lee });
  await sleep(300);
  ok(live.some((m) => m.type === 'task:remove' && m.id === kenTask.id), 'a task handed to someone else goes from Ken’s app');
  await J('PATCH', '/api/tasks/' + taskB.id, { assigneeId: ids.Ken });
  await sleep(300);
  ok(live.some((m) => m.type === 'resync'), 'a campaign task handed to Ken reloads his app…');
  k = await seen(K);
  ok(k.camps.includes(campB.id) && k.tasks.includes(taskB.id), '…and he now sees that campaign');
  ok(!(await seen(L)).camps.includes(campB.id), 'and Lee no longer does');

  // back to everything
  await J('PATCH', '/api/workspace', { visibility: 'all' });
  k = await seen(K);
  ok(k.tasks.includes(joTask.id) && k.items.includes(joDoc.id), 'back to everything: Ken sees it all again');
  sock.close();
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
