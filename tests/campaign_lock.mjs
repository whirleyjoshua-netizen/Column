// Who changes a campaign's plan (the owner, 2026-11-27: "lock editing to runners and admins"): whoever runs it (its
// maker, or the person it's handed to) and admins. Everyone else who sees it works it: ticks their own tasks and
// their checklists, comments, and that's all. One rule on every path: phases, tasks, the campaign itself, and saved
// tasks put into a phase.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/camplock';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5492, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', SKIP_SETUP: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  const team = 'Lock ' + t;
  let r = await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Rico', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const code = (await rico('GET', '/state')).body.workspace.inviteCode;
  const join = async (name, n) => (await call()('POST', '/auth', { mode: 'join', workspace: team, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body;
  const an = await join('Ana', 2), sm = await join('Sam', 3);
  const ana = call(an.token), sam = call(sm.token);
  const anaId = (await ana('GET', '/state')).body.me.memberId, samId = (await sam('GET', '/state')).body.me.memberId;

  // Rico makes it and hands it to Ana to run. Sam has tasks in it.
  const c = (await rico('POST', '/campaigns', { name: 'Spring push' })).body;
  await rico('PATCH', '/campaigns/' + c.id, { assigneeId: anaId });
  const g = (await rico('POST', '/goals', { campaignId: c.id, title: 'Calls' })).body;
  const samTask = (await rico('POST', '/tasks', { goalId: g.id, text: 'Call the Lees', assigneeId: samId })).body;
  await rico('PATCH', '/tasks/' + samTask.id, { checklist: [{ text: 'Ask about the patio' }, { text: 'Book a visit' }] });
  const anaTask = (await rico('POST', '/tasks', { goalId: g.id, text: 'Call the Diaz family', assigneeId: anaId })).body;
  const nobody = (await rico('POST', '/tasks', { goalId: g.id, text: 'Send quotes' })).body;
  const preset = (await sam('POST', '/task-presets', { kind: 'task', text: 'Order samples', name: 'Order samples' })).body;
  const loose = (await sam('POST', '/tasks', { text: 'My own reminder' })).body;

  // ---- Sam (a member, not running it) can't change the plan ----
  const no = async (what, p) => { const x = await p; ok(x.status === 403 && /runs this campaign/.test(x.body?.error || ''), `Sam can’t ${what} (${x.status})`); };
  await no('add a phase', sam('POST', '/goals', { campaignId: c.id, title: 'Sneaky phase' }));
  await no('rename a phase', sam('PATCH', '/goals/' + g.id, { title: 'Renamed' }));
  await no('delete a phase', sam('DELETE', '/goals/' + g.id));
  await no('add a task to a phase', sam('POST', '/tasks', { goalId: g.id, text: 'Extra task' }));
  await no('rename his own task', sam('PATCH', '/tasks/' + samTask.id, { text: 'Renamed task' }));
  await no('re-date his own task', sam('PATCH', '/tasks/' + samTask.id, { due: '2030-01-01' }));
  await no('hand his task to someone else', sam('PATCH', '/tasks/' + samTask.id, { assigneeId: anaId }));
  await no('add a checklist item', sam('PATCH', '/tasks/' + samTask.id, { checklist: [...(await rico('GET', '/state')).body.tasks.find((x) => x.id === samTask.id).checklist, { text: 'New item' }] }));
  r = await sam('PATCH', '/tasks/' + anaTask.id, { done: true });
  ok(r.status === 403 && /whoever it’s for/.test(r.body?.error || ''), 'Sam can’t tick someone else’s task');
  r = await sam('PATCH', '/tasks/' + nobody.id, { done: true });
  ok(r.status === 200 && r.body.done, 'but he can tick one nobody is on yet (it’s up for grabs)');
  r = await sam('PATCH', '/tasks/' + nobody.id, { done: false });
  await no('delete a task', sam('DELETE', '/tasks/' + nobody.id));
  await no('move his own task into the campaign', sam('PATCH', '/tasks/' + loose.id, { goalId: g.id }));
  await no('put saved tasks into a phase', sam('POST', `/task-presets/${preset.id}/use`, { goalId: g.id }));
  await no('rename the campaign', sam('PATCH', '/campaigns/' + c.id, { name: 'Mine now' }));
  r = await sam('DELETE', '/campaigns/' + c.id);
  ok(r.status === 403, 'Sam can’t delete the campaign (only its maker or an admin, as before)');
  let st = (await rico('GET', '/state')).body;
  ok(st.goals.find((x) => x.id === g.id)?.title === 'Calls' && st.tasks.find((x) => x.id === samTask.id)?.text === 'Call the Lees' && st.campaigns.find((x) => x.id === c.id)?.name === 'Spring push', 'nothing he tried changed');

  // ---- …but he works it ----
  const cl = st.tasks.find((x) => x.id === samTask.id).checklist;
  r = await sam('PATCH', '/tasks/' + samTask.id, { checklist: cl.map((x, i) => (i === 0 ? { ...x, done: true } : x)) });
  ok(r.status === 200 && r.body.checklist[0].done && !r.body.checklist[1].done, 'Sam ticks his own checklist');
  r = await sam('PATCH', '/tasks/' + samTask.id, { status: 'doing' });
  ok(r.status === 200 && r.body.status === 'doing', 'and marks his task in progress');
  r = await sam('POST', `/tasks/${anaTask.id}/comments`, { text: 'I called them yesterday' });
  ok(r.status === 200, 'comments on anyone’s task');
  r = await sam('PATCH', '/tasks/' + samTask.id, { checklist: cl.map((x) => ({ ...x, done: true })) });
  r = await sam('PATCH', '/tasks/' + samTask.id, { done: true });
  ok(r.status === 200 && r.body.done, 'and finishes his own task');
  r = await sam('PATCH', '/tasks/' + samTask.id, { done: false });
  ok(r.status === 200 && !r.body.done, 'or opens it again');
  r = await sam('PATCH', '/tasks/' + loose.id, { text: 'My own reminder, renamed' });
  ok(r.status === 200, 'his own tasks outside campaigns are his to change');
  r = await sam('POST', `/task-presets/${preset.id}/use`, {});
  ok(r.status === 200 && r.body.tasks?.length === 1, 'and his saved tasks still go on his list');

  // ---- Ana runs it: she changes the plan ----
  r = await ana('POST', '/goals', { campaignId: c.id, title: 'Quotes' });
  ok(r.status === 200, 'Ana (it’s handed to her) adds a phase');
  r = await ana('PATCH', '/tasks/' + samTask.id, { due: '2030-02-01', text: 'Call the Lee family' });
  ok(r.status === 200 && r.body.text === 'Call the Lee family', 'and changes Sam’s task');
  r = await ana('POST', `/task-presets/${preset.id}/use`, { goalId: g.id });
  ok(r.status === 200, 'and puts saved tasks into a phase');
  r = await ana('PATCH', '/campaigns/' + c.id, { name: 'Spring push 2' });
  ok(r.status === 200, 'and the campaign');

  // ---- Rico (admin, and he made it) does too; once it's handed away, he still does as an admin ----
  r = await rico('PATCH', '/goals/' + g.id, { title: 'Calls first' });
  ok(r.status === 200, 'Rico changes it');

  // ---- a campaign Sam makes is his to plan ----
  const mine = (await sam('POST', '/campaigns', { name: 'Sam’s push' })).body;
  r = await sam('POST', '/goals', { campaignId: mine.id, title: 'Mine' });
  ok(r.status === 200, 'Sam plans the campaign he made');
  r = await sam('POST', '/tasks', { goalId: r.body.id, text: 'Do it' });
  ok(r.status === 200, 'with tasks');
  r = await sam('POST', `/task-presets/${preset.id}/use`, { goalId: (await sam('GET', '/state')).body.goals.find((x) => x.campaignId === mine.id).id });
  ok(r.status === 200, 'and his saved tasks go into it');

  // ---- handed to someone else, Ana can't plan it any more ----
  await rico('PATCH', '/campaigns/' + c.id, { assigneeId: samId });
  r = await ana('POST', '/goals', { campaignId: c.id, title: 'Too late' });
  ok(r.status === 403, 'Ana can’t, once it’s handed to Sam');
  r = await sam('POST', '/goals', { campaignId: c.id, title: 'Now mine' });
  ok(r.status === 200, 'and Sam can');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  if (fails) console.log(srv.log.slice(-1500));
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
