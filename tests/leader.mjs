// The leader's view, server side: check-ins from whoever runs a campaign, "keep me posted", and who finished a step.
const B = 'http://127.0.0.1:4797';
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const auth = async (body) => (await (await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
const t0 = Date.now();
const a = await auth({ mode: 'create', workspace: 'lead ' + t0, name: 'Jo', email: `jo${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = call(a.token);
const code = (await jo('GET', '/state')).body.workspace.inviteCode;
const s = await auth({ mode: 'join', workspace: 'lead ' + t0, code, name: 'Sam', email: `sam${t0}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
const sam = call(s.token);
const samId = (await sam('GET', '/state')).body.me.memberId;

const c = (await jo('POST', '/campaigns', { name: 'Spring push' })).body;
let r = await sam('POST', `/campaigns/${c.id}/checkin`, { status: 'onTrack', note: 'fine' });
ok(r.status === 403, 'someone who doesn’t run it can’t check in');
r = await jo('POST', `/campaigns/${c.id}/checkin`, { status: 'great' });
ok(r.status === 400, 'a check-in has to say on track, at risk or off track');
r = await jo('POST', `/campaigns/${c.id}/checkin`, { status: 'atRisk', note: 'Printer is a week late' });
ok(r.status === 200 && r.body.checkins.at(-1).status === 'atRisk' && r.body.checkins.at(-1).note === 'Printer is a week late' && r.body.checkins.at(-1).by === 'Jo', 'the owner checks in: at risk, and why');
await jo('PATCH', `/campaigns/${c.id}`, { assigneeId: samId });
r = await sam('POST', `/campaigns/${c.id}/checkin`, { status: 'onTrack', note: 'Caught up' });
ok(r.status === 200 && r.body.checkins.length === 2, 'whoever it’s assigned to can check in too');

r = await sam('POST', `/campaigns/${c.id}/watch`, { on: true });
ok(r.body.watch?.includes(samId), 'keep me posted: on');
r = await sam('POST', `/campaigns/${c.id}/watch`, { on: false });
ok(!r.body.watch.includes(samId), 'and off again');

const g = (await jo('POST', '/goals', { campaignId: c.id, title: 'Prep', kind: 'tasks' })).body;
const t = (await jo('POST', '/tasks', { goalId: g.id, text: 'Order signs' })).body;
r = await sam('PATCH', '/tasks/' + t.id, { done: true });
ok(r.body.doneBy === 'Sam', 'a finished step says who finished it');

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
