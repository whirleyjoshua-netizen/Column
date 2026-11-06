// A campaign's roles: tasks for whoever plays a role, sign-off before a step counts as done, and saved campaigns
// run with a new crew.
import WebSocket from '../server/node_modules/ws/index.js';
const B = 'http://127.0.0.1:4797';
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = async (body) => (await (await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
const t0 = Date.now();
const team = 'cast ' + t0;
const a = await auth({ mode: 'create', workspace: team, name: 'Jo', email: `jo${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = call(a.token);
const code = (await jo('GET', '/state')).body.workspace.inviteCode;
const join = async (name, n) => auth({ mode: 'join', workspace: team, code, name, email: `${name.toLowerCase()}${t0}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n });
const an = await join('Ana', 2), sm = await join('Sam', 3);
const ana = call(an.token), sam = call(sm.token);
const anaId = (await ana('GET', '/state')).body.me.memberId;
const samId = (await sam('GET', '/state')).body.me.memberId;
const heardSam = [], heardAna = [];
for (const [tok, list] of [[sm.token, heardSam], [an.token, heardAna]]) {
  const s = new WebSocket(`ws://127.0.0.1:4797/ws?t=${tok}`);
  s.on('message', (d) => list.push(JSON.parse(d)));
  await new Promise((r) => s.on('open', r));
}

let r = await jo('POST', '/campaigns', { name: 'Gym launch', cast: [
  { name: 'Designer', about: 'Makes the flyer', memberIds: [anaId, 'nobody'] },
  { name: 'Approver', memberIds: [samId] },
  { name: 'designer', memberIds: [samId] },
  { name: '' },
] });
const c = r.body;
ok(r.status === 200 && c.cast.length === 2, 'a campaign gets roles; a repeated name and a blank one are left out');
const designer = c.cast.find((x) => x.name === 'Designer'), approver = c.cast.find((x) => x.name === 'Approver');
ok(designer.memberIds.length === 1 && designer.memberIds[0] === anaId && designer.about === 'Makes the flyer', 'only real teammates can play a role');

const g = (await jo('POST', '/goals', { campaignId: c.id, title: 'Flyer', kind: 'tasks' })).body;
r = await jo('POST', '/tasks', { goalId: g.id, text: 'Design the flyer', castId: designer.id, signoff: { castId: approver.id } });
const flyer = r.body;
ok(flyer.castId === designer.id && !flyer.assigneeId && flyer.signoff?.castId === approver.id, 'a task goes to a role, with another role signing it off');
const next = (await jo('POST', '/tasks', { goalId: g.id, text: 'Print it', blockedBy: [flyer.id], assigneeId: samId })).body;
r = await jo('POST', '/tasks', { text: 'Loose task', castId: designer.id });
ok(r.status === 200 && !r.body.castId, 'a task outside the campaign can’t use its roles');

// Members who only see what's theirs see the work their role gives them.
await jo('PATCH', '/workspace', { visibility: 'own' });
let st = (await ana('GET', '/state')).body;
ok(st.campaigns.some((x) => x.id === c.id) && st.tasks.some((x) => x.id === flyer.id), 'Ana (Designer) sees the campaign and the task for her role');
const kim = await join('Kim', 4);
st = (await call(kim.token)('GET', '/state')).body;
ok(!st.campaigns.some((x) => x.id === c.id), 'someone with no part in it doesn’t');

// Sign-off: Ana ticks it, it goes to Sam; it isn't done, so Print still waits.
r = await ana('PATCH', '/tasks/' + flyer.id, { done: true });
ok(r.status === 200 && r.body.done === false && r.body.submitted?.by === 'Ana', 'ticking a step that needs sign-off sends it for sign-off instead');
await sleep(150);
ok(heardSam.some((m) => m.type === 'signoff' && m.task.id === flyer.id && m.by === 'Ana'), 'the approver hears it’s waiting on them');
st = (await jo('GET', '/state')).body;
ok(st.tasks.find((x) => x.id === next.id).waiting === true, 'what waits for it still waits');
r = await ana('PATCH', '/tasks/' + flyer.id, { sendBack: 'no' });
ok(r.status === 403, 'the doer can’t send their own step back');
r = await sam('PATCH', '/tasks/' + flyer.id, { sendBack: 'Logo is too small' });
ok(r.status === 200 && !r.body.submitted && r.body.returned?.note === 'Logo is too small', 'the approver sends it back with a note');
await sleep(150);
ok(heardAna.some((m) => m.type === 'returned' && m.note === 'Logo is too small'), 'and the Designer hears why');

heardSam.length = 0;
await ana('PATCH', '/tasks/' + flyer.id, { done: true });
r = await sam('PATCH', '/tasks/' + flyer.id, { done: true });
ok(r.status === 200 && r.body.done && r.body.approved?.by === 'Sam' && !r.body.returned, 'sent again and approved: now it’s done');
await sleep(200);
ok(heardSam.some((m) => m.type === 'handoff' && m.task.id === next.id), 'and that hands off what waited for it');

// The owner can finish a sign-off step themselves.
const t2 = (await jo('POST', '/tasks', { goalId: g.id, text: 'Approve the copy', signoff: { memberId: samId } })).body;
r = await jo('PATCH', '/tasks/' + t2.id, { done: true });
ok(r.body.done === true, 'the campaign owner’s tick counts as sign-off');

// Taking a role away frees its tasks.
const roleless = (await jo('POST', '/tasks', { goalId: g.id, text: 'Proof it', castId: designer.id })).body;
r = await jo('PATCH', '/campaigns/' + c.id, { cast: [approver] });
st = (await jo('GET', '/state')).body;
ok(r.body.cast.length === 1 && !st.tasks.find((x) => x.id === roleless.id).castId, 'removing a role sends its tasks back to nobody');
r = await jo('PATCH', '/campaigns/' + c.id, { cast: [approver, { name: 'Designer', memberIds: [anaId] }] });
const designer2 = r.body.cast.find((x) => x.name === 'Designer');
await jo('PATCH', '/tasks/' + roleless.id, { castId: designer2.id });

// Saved and run again with a new crew.
r = await jo('POST', '/templates', { campaignId: c.id, name: 'Gym launch' });
const tpl = r.body;
ok(tpl.campaign.cast.length === 2, 'saving keeps the roles');
r = await jo('POST', '/templates/' + tpl.id + '/run', { cast: { [designer2.id]: [samId] } });
const run = r.body;
ok(run.cast.find((x) => x.name === 'Designer').memberIds.join() === samId, 'running it, Sam plays Designer this time');
ok(run.cast.find((x) => x.name === 'Approver').memberIds.join() === samId, 'roles not picked keep the saved crew');
st = (await jo('GET', '/state')).body;
const proof = st.tasks.find((x) => x.text === 'Proof it' && st.goals.find((y) => y.id === x.goalId)?.campaignId === run.id);
ok(proof?.castId === designer2.id, 'its tasks go to the same roles in the new run');

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
