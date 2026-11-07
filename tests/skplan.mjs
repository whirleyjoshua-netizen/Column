// Sidekick plans a campaign in depth: roles with people in them, tasks that wait for each other, tool steps,
// sign-offs, and a campaign to follow. And campaigns in a series.
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
const a = await auth({ mode: 'create', workspace: 'skp ' + t0, name: 'Jo', email: `jo${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = call(a.token);
const code = (await jo('GET', '/state')).body.workspace.inviteCode;
const s = await auth({ mode: 'join', workspace: 'skp ' + t0, code, name: 'Sam', email: `sam${t0}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
const sam = call(s.token);
const samId = (await sam('GET', '/state')).body.me.memberId;
const joId = (await jo('GET', '/state')).body.me.memberId;

let r = await jo('PUT', '/ai/keys/anthropic', { key: 'test-key-for-the-fake-ai' });
ok(r.status === 200, 'an AI key (the test stand-in)');
r = await jo('POST', '/sidekick', { kind: 'campaign' });
const plan = r.body;
r = await jo('POST', `/sidekick/${plan.id}/say`, { text: 'deep plan please' });
ok(r.status === 200, 'Sidekick answers');
const cards = r.body.messages.at(-1).cards;
const roles = cards.find((c) => c.type === 'roles');
ok(roles && roles.roles.length === 2, 'it proposes the campaign’s roles');
ok(roles.roles[0].memberIds.join() === samId && roles.roles[1].memberIds.length === 0, 'people are matched by name; a made-up name is left out');
const flyer = cards.find((c) => c.type === 'goal' && c.title === 'Flyer');
const [design, pay, tele] = flyer.tasks;
ok(design.key === 't1' && design.role === 'Designer' && design.signoff === 'Approver', 'a task has a key, a campaign role and a sign-off');
ok(pay.after.join() === 't1' && pay.dueAfter === 2 && pay.tool === 'pay' && pay.assigneeId === joId, 'one waits for another, is due 2 days after it opens, is a payment step, and goes to Jo');
ok(tele.tool === null, 'a tool that doesn’t exist is dropped');
const mail = cards.find((c) => c.type === 'goal' && c.title === 'Mail');
ok(mail.after.join() === 'Flyer' && mail.tasks[0].tool === 'email', 'a goal can wait for another goal');
const next = cards.find((c) => c.type === 'next');
ok(next && next.name === 'Gym follow-up' && next.start === '2026-12-11', 'and it proposes what comes after');

// Editing a card keeps the plan's links.
r = await jo('PATCH', `/sidekick/${plan.id}/cards/${flyer.id}`, { card: { title: 'The flyer', tasks: flyer.tasks } });
const edited = r.body.messages.flatMap((m) => m.cards || []).find((c) => c.id === flyer.id);
ok(edited.title === 'The flyer' && edited.tasks[1].after.join() === 't1' && edited.tasks[0].role === 'Designer', 'editing a card keeps who, what waits and the tools');

// Campaigns in a series.
const c1 = (await jo('POST', '/campaigns', { name: 'Launch' })).body;
r = await jo('POST', '/campaigns', { name: 'Follow-up', follows: c1.id, assigneeId: samId });
const c2 = r.body;
ok(c2.follows === c1.id, 'a campaign can come after another');
r = await jo('PATCH', '/campaigns/' + c1.id, { follows: c2.id });
ok(r.status === 400, 'two campaigns can’t each come after the other');
const heard = [];
const sock = new WebSocket(`ws://127.0.0.1:4797/ws?t=${s.token}`);
sock.on('message', (d) => heard.push(JSON.parse(d)));
await new Promise((res) => sock.on('open', res));
await jo('PATCH', '/campaigns/' + c1.id, { status: 'done' });
await sleep(200);
ok(heard.some((m) => m.type === 'nextup' && m.campaign.id === c2.id && m.after === 'Launch'), 'finishing the first tells the team the next one is up');
await jo('DELETE', '/campaigns/' + c1.id);
const st = (await jo('GET', '/state')).body;
ok(st.campaigns.find((x) => x.id === c2.id).follows === null, 'deleting the first leaves the next on its own');
sock.close();

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
