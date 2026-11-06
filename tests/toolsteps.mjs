// Steps done with a tool: a payment logged from the step, files coming in on its link, the last call on its list,
// each ticks the step off (or sends it for sign-off), hands off what waited, and leaves what it made on the step.
const B = 'http://127.0.0.1:4797';
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const auth = async (body) => (await (await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
const t0 = Date.now();
const a = await auth({ mode: 'create', workspace: 'steps ' + t0, name: 'Jo', email: `jo${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = call(a.token);
const code = (await jo('GET', '/state')).body.workspace.inviteCode;
const s = await auth({ mode: 'join', workspace: 'steps ' + t0, code, name: 'Sam', email: `sam${t0}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
const sam = call(s.token);
const samId = (await sam('GET', '/state')).body.me.memberId;
await jo('PATCH', '/workspace', { tools: { bills: true } });
const task = async (id) => (await jo('GET', '/state')).body.tasks.find((x) => x.id === id);
const today = new Date().toLocaleDateString('en-CA');

const c = (await jo('POST', '/campaigns', { name: 'Open house', start: today })).body;
const g = (await jo('POST', '/goals', { campaignId: c.id, title: 'Get ready', kind: 'tasks' })).body;

// Paying for something.
let r = await jo('POST', '/tasks', { goalId: g.id, text: 'Pay for the banner', action: { kind: 'pay' } });
const pay = r.body;
ok(pay.action?.kind === 'pay', 'a step can say which tool does it');
r = await jo('POST', '/tasks', { goalId: g.id, text: 'Nope', action: { kind: 'teleport' } });
ok(!r.body.action, 'only real tools');
const hang = (await jo('POST', '/tasks', { goalId: g.id, text: 'Hang the banner', blockedBy: [pay.id], assigneeId: samId })).body;
r = await jo('POST', '/money', { kind: 'out', amount: '84.50', day: today, category: 'Printing', note: 'Banner', taskId: pay.id });
ok(r.status === 200 && r.body.campaignId === c.id, 'a payment logged from the step counts toward its campaign');
let t = await task(pay.id);
ok(t.done && /Paid \$84\.50/.test(t.doneNote), 'and ticks the step off: ' + t.doneNote);
ok((await task(hang.id)).waiting === false, 'which opens what waited for it');

// Files coming in on the step's link, for a step that needs sign-off.
const photos = (await jo('POST', '/tasks', { goalId: g.id, text: 'Get photos from the owner', action: { kind: 'files' }, assigneeId: samId, signoff: { memberId: (await jo('GET', '/state')).body.me.memberId } })).body;
const use = (await jo('POST', '/tasks', { goalId: g.id, text: 'Post the listing', blockedBy: [photos.id] })).body;
r = await sam('POST', `/stacks/${c.stackId}/request`, { days: 7, note: 'Photos of each room', taskId: photos.id });
const tok = r.body.stacks.find((x) => x.id === c.stackId).request.token;
t = await task(photos.id);
ok(t.toolRef?.kind === 'files' && !t.done, 'making the link from the step shows it’s under way');
r = await fetch(`${B}/api/public/request/${tok}/file?name=kitchen.jpg&from=Pat`, { method: 'PUT', body: 'jpegbytes' });
ok(r.status === 200, 'the owner drops a photo in');
t = await task(photos.id);
ok(!t.done && t.submitted && t.files?.length === 1, 'the step needs sign-off, so it goes for sign-off, with the photo on it');
ok((await task(use.id)).waiting === true, 'and what waits for it waits until it’s approved');
await fetch(`${B}/api/public/request/${tok}/file?name=bath.jpg&from=Pat`, { method: 'PUT', body: 'jpegbytes2' });
ok((await task(photos.id)).files.length === 2, 'more files keep landing on the step');
await jo('PATCH', '/tasks/' + photos.id, { done: true });
ok((await task(use.id)).waiting === false, 'approved: the next step opens');

// The last call on the list.
r = await jo('POST', '/lists', { campaignId: c.id, name: 'Neighbors', kind: 'calls', columns: ['Name', 'Phone'], rows: [{ cells: ['Ann', '555-0101'] }, { cells: ['Bo', '555-0102'] }] });
const l = r.body;
ok(r.status === 200 && l.rows.length === 2, 'a call list on the campaign');
const calls = (await jo('POST', '/tasks', { goalId: g.id, text: 'Invite the neighbors', listId: l.id, action: { kind: 'calls' } })).body;
const plain = (await jo('POST', '/tasks', { goalId: g.id, text: 'Work the list by hand', listId: l.id })).body;
await jo('POST', '/attempts', { campaignId: c.id, outcome: 'Interested', listId: l.id, rowId: l.rows[0].id, contact: 'Ann' });
ok(!(await task(calls.id)).done, 'one of two reached: not done');
await jo('POST', '/attempts', { campaignId: c.id, outcome: 'No answer', listId: l.id, rowId: l.rows[1].id, contact: 'Bo' });
t = await task(calls.id);
ok(t.done && /Everyone on “Neighbors” reached/.test(t.doneNote), 'everyone reached: the step is done');
ok(!(await task(plain.id)).done, 'a task on the same list that isn’t a calls step is left alone');

// Saved campaigns keep which tool does each step.
r = await jo('POST', '/templates', { campaignId: c.id, name: 'Open house' });
r = await jo('POST', '/templates/' + r.body.id + '/run', {});
const st = (await jo('GET', '/state')).body;
const again = st.tasks.find((x) => x.text === 'Pay for the banner' && st.goals.find((y) => y.id === x.goalId)?.campaignId === r.body.id);
ok(again?.action?.kind === 'pay' && !again.done, 'a new run’s steps keep their tools');

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
