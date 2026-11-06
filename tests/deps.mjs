// What waits on what: tasks waiting for tasks, goals for goals, the hand-off when work opens up, and saved campaigns keeping it.
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
const a = await auth({ mode: 'create', workspace: 'deps ' + t0, name: 'Jo', email: `jo${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = call(a.token);
const code = (await jo('GET', '/state')).body.workspace.inviteCode;
const b = await auth({ mode: 'join', workspace: 'deps ' + t0, code, name: 'Sam', email: `sam${t0}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
const sam = call(b.token);
const samId = (await sam('GET', '/state')).body.me.memberId;
const heard = [];
const sock = new WebSocket(`ws://127.0.0.1:4797/ws?t=${b.token}`);
sock.on('message', (d) => heard.push(JSON.parse(d)));
await new Promise((r) => sock.on('open', r));
const task = async (id) => (await jo('GET', '/state')).body.tasks.find((x) => x.id === id);

const c = (await jo('POST', '/campaigns', { name: 'Gym launch' })).body;
const design = (await jo('POST', '/goals', { campaignId: c.id, title: 'Design', kind: 'tasks' })).body;
const mail = (await jo('POST', '/goals', { campaignId: c.id, title: 'Mail', kind: 'tasks' })).body;
const flyer = (await jo('POST', '/tasks', { goalId: design.id, text: 'Design the flyer' })).body;
const list = (await jo('POST', '/tasks', { goalId: design.id, text: 'Pull the gym list' })).body;
let r = await jo('POST', '/tasks', { goalId: mail.id, text: 'Mail the flyers', assigneeId: samId, blockedBy: [flyer.id, list.id], dueAfter: 2 });
const send = r.body;
ok(r.status === 200 && send.blockedBy.length === 2 && send.waiting === true, 'a task can wait for two others, and says it’s waiting');
ok(send.dueAfter === 2 && !send.due, 'it can be due a set number of days after it opens');

r = await sam('PATCH', '/tasks/' + send.id, { done: true });
ok(r.status === 409 && /Design the flyer/.test(r.body.error), 'it can’t be ticked off while it waits: ' + r.body?.error);

r = await jo('PATCH', '/tasks/' + flyer.id, { blockedBy: [send.id] });
ok(r.status === 400 && /wait on each other/.test(r.body.error), 'two steps can’t wait on each other');
r = await jo('PATCH', '/tasks/' + send.id, { blockedBy: [send.id, flyer.id, list.id, 'nope'] });
ok(r.body.blockedBy.length === 2, 'itself and made-up steps are left out');

await jo('PATCH', '/tasks/' + flyer.id, { done: true });
await sleep(150);
ok(!heard.some((m) => m.type === 'handoff'), 'one of two done: still waiting, nobody’s told');
ok((await task(send.id)).waiting === true, 'still waiting on the list');

await jo('PATCH', '/tasks/' + list.id, { done: true });
await sleep(200);
const ho = heard.find((m) => m.type === 'handoff');
ok(ho && ho.task.id === send.id && ho.by === 'Jo', 'the last one done hands it over: Sam hears they’re up, from Jo');
const opened = await task(send.id);
const inTwo = new Date(Date.now() + 2 * 864e5).toLocaleDateString('en-CA');
ok(opened.waiting === false && opened.openedAt > 0, 'it’s open now');
ok(Math.abs(Date.parse(opened.due) - Date.parse(inTwo)) <= 864e5, 'and due 2 days from now: ' + opened.due);
r = await sam('PATCH', '/tasks/' + send.id, { done: true });
ok(r.status === 200, 'Sam can tick it off now');

// Undoing a step puts what waits for it back to waiting.
await sam('PATCH', '/tasks/' + send.id, { done: false });
await jo('PATCH', '/tasks/' + list.id, { done: false });
ok((await task(send.id)).waiting === true, 'un-ticking the list makes the mailing wait again');
// Deleting a step it waits for lets it go.
heard.length = 0;
await jo('DELETE', '/tasks/' + list.id);
await sleep(200);
const after = await task(send.id);
ok(after.blockedBy.length === 1 && after.waiting === false, 'deleting the list drops it from what the mailing waits for');
ok(heard.some((m) => m.type === 'handoff' && m.task.id === send.id), 'and that opens it, so Sam is told');

// Goals waiting for goals.
const follow = (await jo('POST', '/goals', { campaignId: c.id, title: 'Follow up', kind: 'tasks', blockedBy: [mail.id] })).body;
ok(follow.blockedBy?.[0] === mail.id, 'a goal can wait for another goal');
r = await jo('PATCH', '/goals/' + mail.id, { blockedBy: [follow.id] });
ok(r.status === 400, 'goals can’t wait on each other either');
const call1 = (await jo('POST', '/tasks', { goalId: follow.id, text: 'Call the gyms', assigneeId: samId })).body;
ok(call1.waiting === true, 'a task in a waiting goal waits');
r = await sam('PATCH', '/tasks/' + call1.id, { done: true });
ok(r.status === 409 && /Mail/.test(r.body.error), 'and can’t be ticked off: ' + r.body?.error);
heard.length = 0;
await sam('PATCH', '/tasks/' + send.id, { done: true });
await sleep(200);
ok(heard.some((m) => m.type === 'handoff' && m.task.id === call1.id), 'finishing the Mail goal opens the calls: Sam is told');

// An owner can still pass a waiting step.
const later = (await jo('POST', '/tasks', { goalId: design.id, text: 'Print', blockedBy: [call1.id] })).body;
r = await jo('PATCH', '/tasks/' + later.id, { done: true });
ok(r.status === 200, 'the owner can tick off a waiting step anyway');
r = await sam('PATCH', '/tasks/' + later.id, { unlocked: true });
ok(r.status === 403, 'a teammate can’t unlock one');

// Saved campaigns keep what waits for what.
r = await jo('POST', '/templates', { campaignId: c.id, name: 'Gym launch' });
ok(r.status === 200, 'saved as a campaign to run again');
r = await jo('POST', '/templates/' + r.body.id + '/run', {});
const run = r.body?.campaign || r.body;
let st = (await jo('GET', '/state')).body;
const goals = st.goals.filter((g) => g.campaignId === run.id);
const gFollow = goals.find((g) => g.title === 'Follow up');
const gMail = goals.find((g) => g.title === 'Mail');
const tSend = st.tasks.find((t) => t.goalId === gMail?.id && t.text === 'Mail the flyers');
const tFlyer = st.tasks.find((t) => goals.some((g) => g.id === t.goalId) && t.text === 'Design the flyer');
ok(gFollow?.blockedBy?.[0] === gMail?.id, 'the new run’s goals wait for each other the same way');
ok(tSend?.blockedBy?.length === 1 && tSend.blockedBy[0] === tFlyer?.id && tSend.dueAfter === 2, 'and its tasks too, pointing at the new steps');

sock.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
