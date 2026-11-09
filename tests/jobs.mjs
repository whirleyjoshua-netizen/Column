// Jobs for trades: a Jobs project set up from the kinds of work a team does, each a list with its trade's details,
// checklist and stages; jobs linked to a contact (who start at the contact's address, and carry how to reach them);
// the field types for work on site: checklists, measurements, equipment, materials, readings, sign-off, permits.
const B = 'http://127.0.0.1:4797';
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const auth = async (body) => (await (await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
const t0 = Date.now();
const a = await auth({ mode: 'create', workspace: 'jobs ' + t0, name: 'Jo', email: `jo${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = call(a.token);
const code = (await jo('GET', '/state')).body.workspace.inviteCode;
const s = await auth({ mode: 'join', workspace: 'jobs ' + t0, code, name: 'Sam', email: `sam${t0}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
const sam = call(s.token);

// The kinds of work, by family.
let r = await jo('GET', '/project-templates/trades');
const all = r.body.flatMap((f) => f.trades);
ok(r.status === 200 && r.body.length === 6 && all.length >= 35 && all.some((x) => x.key === 'blinds') && all.some((x) => x.key === 'pest'), `${all.length} trades in ${r.body.length} families`);

// A Jobs project for a blinds installer that also does HVAC.
r = await jo('POST', '/projects', { template: 'trades', trades: ['blinds', 'hvac', 'nope'] });
const p = r.body;
ok(r.status === 200 && p.name === 'Jobs' && p.types.length === 2, 'a Jobs project with a list for each trade picked (unknown ones left out)');
const blinds = p.types.find((x) => x.key === 'trade_blinds'), hvac = p.types.find((x) => x.key === 'trade_hvac');
const fk = (t, key) => t.fields.find((f) => f.key === key);
ok(fk(blinds, 'customer').type === 'contact' && fk(blinds, 'measurements').type === 'measure' && fk(blinds, 'measurements').mode === 'wh' && fk(blinds, 'measurements').unit === 'in', 'blinds jobs: a customer and window measurements in inches');
ok(fk(blinds, 'status').choices.map((c) => c.label).join() === 'Lead,Measure booked,Measured,Quoted,Ordered,Scheduled,Installed,Invoiced,Paid', 'an installer’s stages');
ok(fk(hvac, 'equipment').type === 'equipment' && fk(hvac, 'readings').list.includes('Supply temp °F') && fk(hvac, 'checklist').list.length >= 5 && fk(hvac, 'signoff').type === 'signature', 'HVAC jobs: equipment, readings, a checklist and a sign-off');
ok((await jo('POST', '/projects', { template: 'trades', trades: [] })).status === 400, 'at least one kind of work');

// A customer, and a job for them.
const dana = (await jo('POST', '/contacts', { name: 'Dana Ruiz', phone: '555-0101', email: 'dana@x.test', address: '12 Elm St', city: 'Mesa' })).body;
r = await jo('POST', `/projects/${p.id}/records`, { typeId: blinds.id, values: { job: 'Living room shades', customer: dana.id } });
const job = r.body;
ok(r.status === 200 && job.values[fk(blinds, 'address').id] === '12 Elm St, Mesa', 'a job for a customer starts at their address');
ok(job.people?.[dana.id]?.phone === '555-0101' && job.people[dana.id].name === 'Dana Ruiz', 'and carries how to reach them');
const cl = job.values[fk(blinds, 'checklist').id];
ok(cl.items.length === blinds.fields.find((f) => f.key === 'checklist').list.length && cl.items.every((x) => !x.done), 'it starts with the trade’s checklist, nothing ticked');
ok(job.values[fk(blinds, 'status').id] === fk(blinds, 'status').choices[0].id, 'and at the first stage');
ok((await jo('POST', `/projects/${p.id}/records`, { typeId: blinds.id, values: { customer: 'nobody' } })).status === 400, 'a customer has to be in Contacts');

// On site.
const set = (values) => jo('PATCH', '/records/' + job.id, { values });
r = await set({ measurements: { rows: [{ label: 'Living room left', w: '35.5', h: 60, qty: 2 }, { label: 'Kitchen', w: 24, h: 36 }, { label: '' }] } });
const ms = r.body.values[fk(blinds, 'measurements').id];
ok(r.status === 200 && ms.rows.length === 2 && ms.rows[0].w === 35.5 && ms.rows[0].qty === 2 && ms.rows[1].qty === 1, 'measurements: labels, width × height, how many; empty rows dropped');
cl.items[0].done = true;
r = await set({ checklist: cl });
ok(r.body.values[fk(blinds, 'checklist').id].items[0].done, 'a checklist item ticked');
r = await set({ materials: { rows: [{ item: '2" faux wood blinds', qty: 3, cost: '42.50' }, { item: 'Brackets', qty: 6 }] } });
const mt = r.body.values[fk(blinds, 'materials').id];
ok(mt.rows[0].cost === 4250 && mt.rows[1].cost === undefined && mt.rows[1].qty === 6, 'materials: costs kept in cents');
r = await set({ signoff: { name: 'Dana Ruiz', image: 'data:image/png;base64,iVBORw0KGgo=' } });
ok(r.body.values[fk(blinds, 'signoff').id].name === 'Dana Ruiz' && r.body.values[fk(blinds, 'signoff').id].image && r.body.values[fk(blinds, 'signoff').id].at, 'the customer signs off');
ok((await set({ signoff: { image: 'x' } })).status === 400, 'a sign-off needs a name');
r = await jo('GET', `/records/${job.id}/log`);
const log = JSON.stringify(r.body);
ok(/3 openings/.test(log) && /1 of \d+ done/.test(log) && /signed by Dana Ruiz/.test(log), 'the timeline says it in words: openings, checklist, sign-off');

// HVAC: readings ready to fill, equipment, a permit.
r = await jo('POST', `/projects/${p.id}/records`, { typeId: hvac.id, values: { job: 'No cooling', customer: dana.id } });
const hj = r.body;
const rd = hj.values[fk(hvac, 'readings').id];
ok(rd.rows.find((x) => x.label === 'Supply temp')?.unit === '°F' && rd.rows.find((x) => x.label === 'Superheat')?.unit === '°F' && rd.rows.every((x) => x.value === ''), 'readings start as labels with units, ready to fill');
r = await jo('PATCH', '/records/' + hj.id, { values: { equipment: { rows: [{ kind: 'Condenser', brand: 'Carrier', model: '24ACC636', serial: '1234X', installed: '2019-05-01', warranty: 'soon' }] } } });
const eq = r.body.values[fk(hvac, 'equipment').id].rows[0];
ok(eq.serial === '1234X' && eq.installed === '2019-05-01' && eq.warranty === undefined, 'equipment: make, model, serial, dates (a bad date dropped)');

// Plumbing has no permit field; electrical does.
r = await jo('POST', `/projects/${p.id}/schema`, { op: 'addTypeFrom', key: 'trade_electrical' });
const el = r.body.made;
ok(r.status === 200 && el.key === 'trade_electrical' && el.fields.some((f) => f.type === 'permit'), 'another trade added to the project later');
r = await jo('POST', `/projects/${p.id}/records`, { typeId: el.id, values: { job: 'Panel upgrade', permit: { number: 'E-2231', status: 'approved', inspection: '2026-12-01' } } });
ok(r.body.values[el.fields.find((f) => f.key === 'permit').id].status === 'Approved', 'a permit: number, status, inspection day');

// A team's own fields of these kinds.
r = await jo('POST', `/projects/${p.id}/schema`, { op: 'addField', typeId: blinds.id, name: 'Final check', type: 'checklist', list: ['Remove stickers', 'Vacuum sills'] });
ok(r.body.made.type === 'checklist' && r.body.made.list.length === 2, 'a checklist field of their own, with its items');

// The customer's jobs.
r = await jo('GET', '/records/for-contact/' + dana.id);
ok(r.status === 200 && r.body.length === 2 && r.body.some((x) => x.list === 'Window treatment job') && r.body.every((x) => x.project === 'Jobs'), 'a contact’s jobs, across lists');

// Someone on the team who can't open Contacts still sees who the job is for.
r = await sam('GET', `/projects/${p.id}/records`);
const seen = r.body.find((x) => x.id === job.id);
ok(seen?.people?.[dana.id]?.address === '12 Elm St' && seen.people[dana.id].phone === '555-0101', 'whoever does the job sees the customer’s name, phone and address');

// ----- visits: going to a job -----
const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA');
const samId = (await sam('GET', '/state')).body.me.memberId;
const joId = (await jo('GET', '/state')).body.me.memberId;
r = await jo('POST', `/records/${job.id}/visits`, { kind: 'Measure', date: tomorrow, start: 540, end: 600, memberIds: [samId, joId], note: 'Bring the sample book' });
const visit = r.body;
ok(r.status === 200 && visit.kind === 'Measure' && visit.memberIds.length === 2 && visit.start === 540, 'a visit booked: what kind, when, who’s going');
let samEntries = (await sam('GET', '/state')).body.entries.filter((e) => e.visitId === visit.id);
ok(samEntries.length === 1 && samEntries[0].recordId === job.id && samEntries[0].text === 'Measure: Living room shades · Dana Ruiz' && samEntries[0].note === 'Bring the sample book', 'it’s on Sam’s Day, named for the job and the customer');
r = await jo('GET', `/projects/${p.id}/records`);
const after = r.body.find((x) => x.id === job.id);
ok(after.values[fk(blinds, 'scheduled').id] === tomorrow && after.values[fk(blinds, 'crew').id] === samId, 'the job’s Scheduled day and Assigned to follow its visit');
const stage = (rec) => fk(blinds, 'status').choices.find((c) => c.id === rec.values[fk(blinds, 'status').id])?.label;
ok(stage(after) === 'Measure booked', 'booking a measure moves the job to Measure booked');
const joEntry = (await jo('GET', '/state')).body.entries.find((e) => e.visitId === visit.id);
await jo('PATCH', '/entries/' + joEntry.id, { start: 600, end: 660 });
samEntries = (await sam('GET', '/state')).body.entries.filter((e) => e.visitId === visit.id);
ok(samEntries[0].start === 600 && samEntries[0].end === 660, 'moving your copy of a visit moves everyone’s');
r = await jo('GET', '/schedule?date=' + tomorrow);
ok(r.status === 200 && r.body.visits.length === 1 && r.body.visits[0].label === 'Living room shades · Dana Ruiz' && r.body.members.length === 2, 'the team schedule: every visit that day, by person');
ok(r.body.waiting.some((x) => x.recordId === hj.id) && !r.body.waiting.some((x) => x.recordId === job.id), 'and jobs still waiting for a visit (not ones already booked)');
r = await sam('GET', '/schedule?date=' + tomorrow);
ok(r.body.members.length === 1 && r.body.members[0].id === samId && r.body.visits.length === 1, 'someone who isn’t an admin sees just their own');
r = await jo('GET', `/records/${job.id}/visits`);
ok(r.body.length === 1 && r.body[0].id === visit.id, 'the job lists its visits');
r = await jo('PATCH', '/visits/' + visit.id, { memberIds: [joId] });
samEntries = (await sam('GET', '/state')).body.entries.filter((e) => e.visitId === visit.id);
ok(r.status === 200 && samEntries.length === 0, 'taking someone off a visit takes it off their Day');
r = await jo('PATCH', '/visits/' + visit.id, { done: true });
ok(r.body.done, 'a visit marked done');
ok(stage((await jo('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === job.id)) === 'Measured', 'and the measure done moves it to Measured');
ok((await jo('DELETE', '/visits/' + visit.id)).status === 200 && !(await jo('GET', '/state')).body.entries.some((e) => e.visitId === visit.id), 'a visit cancelled');
const v2 = (await jo('POST', `/records/${hj.id}/visits`, { kind: 'Service', date: tomorrow, start: 780, end: 840 })).body;
ok(v2.memberIds[0] === joId, 'booked with nobody picked: it’s yours');
await jo('DELETE', '/records/' + hj.id);
ok(!(await jo('GET', '/state')).body.entries.some((e) => e.visitId === v2.id), 'deleting a job takes its visits off everyone’s Day');

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
