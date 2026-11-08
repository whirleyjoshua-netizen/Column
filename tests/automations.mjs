// Automations: "when this happens, do that". Triggers from what happens in Kloomie, actions that make tasks, post,
// start saved campaigns, notify people (onto their Home), and change contacts; no loops; scheduled ones run by hand.
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
const a = await auth({ mode: 'create', workspace: 'auto ' + t0, name: 'Jo', email: `jo${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = call(a.token);
const code = (await jo('GET', '/state')).body.workspace.inviteCode;
const s = await auth({ mode: 'join', workspace: 'auto ' + t0, code, name: 'Sam', email: `sam${t0}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
const sam = call(s.token);
const samId = (await sam('GET', '/state')).body.me.memberId;
const today = new Date().toLocaleDateString('en-CA');
const inTwo = new Date(Date.now() + 2 * 864e5).toLocaleDateString('en-CA');
const state = async () => (await jo('GET', '/state')).body;

ok((await sam('GET', '/automations')).status === 403, 'members can’t set up automations');
let r = await jo('POST', '/automations', { name: 'x', actions: [{ kind: 'post', text: 'hi' }] });
ok(r.status === 400 && /sets it off/.test(r.body.error), 'it needs a trigger');
r = await jo('POST', '/automations', { name: 'x', trigger: { kind: 'task.done' }, actions: [] });
ok(r.status === 400 && /something for it to do|thing for it to do/.test(r.body.error), 'and something to do');
r = await jo('POST', '/automations', { name: 'x', trigger: { kind: 'task.done' }, actions: [{ kind: 'notify', text: 'hi', to: [] }] });
ok(r.status === 400 && /who to notify/.test(r.body.error), 'notify needs people');

// When a step in Gym launch is done: a follow-up task for whoever did it, a post in the campaign's feed, a note for owners.
const c = (await jo('POST', '/campaigns', { name: 'Gym launch' })).body;
const g = (await jo('POST', '/goals', { campaignId: c.id, title: 'Prep', kind: 'tasks' })).body;
const other = (await jo('POST', '/campaigns', { name: 'Other' })).body;
const og = (await jo('POST', '/goals', { campaignId: other.id, title: 'Prep', kind: 'tasks' })).body;
r = await jo('POST', '/automations', { name: 'Step done', trigger: { kind: 'task.done', campaignId: c.id }, actions: [
  { kind: 'task', text: 'Invoice for {task} ({campaign})', assignee: 'who', dueIn: 2, campaign: 'same' },
  { kind: 'post', text: '{who} finished {task}', channelId: 'same' },
  { kind: 'notify', text: '{who} finished {task} in {campaign}', to: ['owners'] }] });
const A1 = r.body;
ok(r.status === 200 && A1.on && A1.actions.length === 3, 'an automation with three actions');
const step = (await jo('POST', '/tasks', { goalId: g.id, text: 'Print flyers', assigneeId: samId })).body;
const away = (await jo('POST', '/tasks', { goalId: og.id, text: 'Elsewhere', assigneeId: samId })).body;
await sam('PATCH', '/tasks/' + away.id, { done: true });
await sam('PATCH', '/tasks/' + step.id, { done: true });
await sleep(200);
let st = await state();
const made = st.tasks.find((t) => t.text === 'Invoice for Print flyers (Gym launch)');
ok(made && made.assigneeId === samId && made.due === inTwo && made.goalId === g.id, 'the follow-up task: for Sam, due in 2 days, in the same campaign');
ok(!st.tasks.some((t) => t.text.includes('Elsewhere') && t.text.startsWith('Invoice')), 'a step in another campaign doesn’t set it off');
ok(st.items.some((it) => it.type === 'message' && it.channelId === c.channelId && it.text === 'Sam finished Print flyers' && it.by === 'Step done'), 'it posted in the campaign’s feed, as the automation');
const notes = st.notices;
ok(notes.length === 1 && notes[0].text === 'Sam finished Print flyers in Gym launch' && notes[0].title === 'Step done', 'Jo (owner) has a note on her Home');
ok((await sam('GET', '/notices')).body.length === 0, 'Sam (not an owner) doesn’t');
r = await jo('GET', '/automations');
ok(r.body[0].count === 1 && r.body[0].runs[0].ok && /Made the task/.test(r.body[0].runs[0].note), 'the run is logged: ' + r.body[0].runs[0]?.note);

// Contacts: a stage change sets off an action that changes the stage again; that second change doesn't set anything off.
await jo('POST', '/automations', { name: 'Qualified', trigger: { kind: 'contact.stage', stage: 'qualified' }, actions: [{ kind: 'contact', stage: 'customer', tag: 'auto' }] });
const A4 = (await jo('POST', '/automations', { name: 'Customer', trigger: { kind: 'contact.stage', stage: 'customer' }, actions: [{ kind: 'notify', text: '{contact} is a customer', to: ['owners'] }] })).body;
const ct = (await jo('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test' })).body;
await jo('PATCH', '/contacts/' + ct.id, { stage: 'qualified' });
const ct2 = (await jo('GET', '/contacts')).body.contacts.find((x) => x.id === ct.id);
ok(ct2.stage === 'customer' && ct2.tags.includes('auto'), 'the automation moved Dana on to customer and tagged her');
ok(!(await jo('GET', '/automations')).body.find((x) => x.id === A4.id).runs.length, 'what an automation changes doesn’t set off another one (no loops)');
await jo('PATCH', '/contacts/' + ct.id, { stage: 'customer' });
await jo('PATCH', '/contacts/' + ct.id, { stage: 'lead' });
await jo('PATCH', '/contacts/' + ct.id, { stage: 'customer' });
ok((await jo('GET', '/automations')).body.find((x) => x.id === A4.id).count === 1, 'a person changing the stage does');

// A call logged as Interested; a check-in that's off track; only those.
await jo('POST', '/automations', { name: 'Hot lead', trigger: { kind: 'attempt.logged', outcome: 'Interested' }, actions: [{ kind: 'task', text: 'Send {contact} a quote', assignee: 'who', dueIn: 0 }] });
await sam('POST', '/attempts', { campaignId: c.id, outcome: 'No answer', contact: 'Bo' });
await sam('POST', '/attempts', { campaignId: c.id, outcome: 'Interested', contact: 'Cal' });
st = await state();
ok(st.tasks.some((t) => t.text === 'Send Cal a quote' && t.assigneeId === samId && t.due === today) && !st.tasks.some((t) => t.text === 'Send Bo a quote'), 'only the Interested call made a quote task, for whoever logged it');
const A6 = (await jo('POST', '/automations', { name: 'Off track', trigger: { kind: 'campaign.checkin', statuses: ['offTrack'] }, actions: [{ kind: 'notify', text: '{campaign} is off track: {note}', to: [samId] }] })).body;
await jo('POST', `/campaigns/${c.id}/checkin`, { status: 'atRisk', note: 'meh' });
await jo('POST', `/campaigns/${c.id}/checkin`, { status: 'offTrack', note: 'printer broke' });
r = await sam('GET', '/notices');
ok(r.body.length === 1 && r.body[0].text === 'Gym launch is off track: printer broke', 'off track notified Sam; at risk didn’t');

// Finishing a campaign starts a saved one.
const tpl = (await jo('POST', '/templates', { campaignId: other.id, name: 'Onboarding' })).body;
await jo('POST', '/automations', { name: 'Next up', trigger: { kind: 'campaign.done', campaignId: c.id }, actions: [{ kind: 'campaign', templateId: tpl.id }] });
await jo('PATCH', '/campaigns/' + c.id, { status: 'done' });
st = await state();
ok(st.campaigns.some((x) => x.name.startsWith('Onboarding')), 'finishing Gym launch started the saved Onboarding campaign');

// Files on a request link.
await jo('POST', '/automations', { name: 'Files in', trigger: { kind: 'file.arrived' }, actions: [{ kind: 'notify', text: '{from} sent {file}', to: ['admins'] }] });
const rq = await jo('POST', `/stacks/${c.stackId}/request`, { days: 7 });
const tok = rq.body.stacks.find((x) => x.id === c.stackId).request.token;
await fetch(`${B}/api/public/request/${tok}/file?name=photos.zip&from=Pat`, { method: 'PUT', body: 'zip' });
ok((await jo('GET', '/notices')).body.some((n) => n.text === 'Pat sent photos.zip'), 'a file on a request link notified the admins');

// On a schedule; run by hand to try it. Others can't be.
r = await jo('POST', '/automations', { name: 'Monday', trigger: { kind: 'schedule', slots: [] }, actions: [{ kind: 'post', text: 'Goals for the week?', channelId: 'general' }] });
ok(r.status === 400, 'a schedule needs days and a time');
const A9 = (await jo('POST', '/automations', { name: 'Monday', trigger: { kind: 'schedule', slots: [{ days: [1], time: '09:00' }] }, actions: [{ kind: 'post', text: 'Goals for the week? ({date})', channelId: 'general' }] })).body;
r = await jo('POST', `/automations/${A9.id}/run`);
st = await state();
ok(st.items.some((it) => it.type === 'message' && !it.channelId && it.text === `Goals for the week? (${today})`), 'run by hand, it posted to #general');
ok((await jo('POST', `/automations/${A6.id}/run`)).status === 400, 'only scheduled ones run by hand');

// Off, edited, deleted; notes cleared.
await jo('PATCH', '/automations/' + A1.id, { on: false });
const step2 = (await jo('POST', '/tasks', { goalId: g.id, text: 'Hang banner' })).body;
await jo('PATCH', '/tasks/' + step2.id, { done: true });
ok(!(await state()).tasks.some((t) => t.text.startsWith('Invoice for Hang banner')), 'switched off, it doesn’t run');
ok((await jo('DELETE', '/automations/' + A1.id)).status === 200 && (await jo('GET', '/automations')).body.every((x) => x.id !== A1.id), 'deleted');
await jo('DELETE', '/notices');
ok((await jo('GET', '/notices')).body.length === 0, 'Jo clears her notes');

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
