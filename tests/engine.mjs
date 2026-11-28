// The Jobs & projects engine round, steps 0 and 1 (docs/research/reports/Kloomie trade workflows research.md).
// Step 0, trade projects as they really run: a service plans list, the customer's own equipment, licenses and
// insurance, a sealed gate code on every job, a calendar of jobs, HOA and year built where they matter.
// Step 1, the engine: formula fields (worked out on the server from a record's own fields, so the app, API and
// webhooks agree), rollups over linked records (kept up to date when one of them changes), a calendar view,
// automations that change the record or add one (through the same path as a person's edit, never past a rule, only
// in projects their maker can see, still never setting each other off), and a trigger on a record's date (N days
// before, on or after it, once per date, never for a "before" date that's already passed).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/engine';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4841, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', SCHEDULE_TICK_MS: '150', DATE_SWEEP_MS: '200' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const t0 = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Engine ' + t0, name: 'Rico Vega', email: `rico${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const st0 = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Engine ' + t0, code: st0.workspace.inviteCode, name: 'Sam Lee', email: `sam${t0}@t.test`, password: 'longenough2', device: 'PC', deviceId: 'd2' });
  const sam = call(r.body.token);
  const feed = async (name) => { const w = (await rico('POST', '/channels', { name })).body; return (w.channels || w.workspace?.channels || []).find((c) => c.name === name)?.id; };
  const posts = async (f) => (await rico('GET', '/state')).body.items.filter((x) => x.type === 'message' && x.channelId === f).map((x) => x.text);
  const recs = async (pid) => (await rico('GET', `/projects/${pid}/records`)).body;
  const recOf = async (pid, id) => (await recs(pid)).find((x) => x.id === id);
  const schema = async (pid, body) => rico('POST', `/projects/${pid}/schema`, body);

  // ---------- Step 0: trade projects ----------
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac', 'pool', 'roofing', 'lawn'] })).body;
  const list = (k) => p.types.find((x) => x.key === k);
  const fk = (tp, k) => tp?.fields.find((f) => f.key === k);
  const hvac = list('trade_hvac'), plans = list('plans'), gear = list('equipment');
  // Licenses & insurance live in the workspace profile now, once for the business (2026-11-19), not on each board.
  const prof = (await rico('GET', '/profile')).body.project, lic = prof.types.find((x) => x.key === 'licenses');
  ok(hvac && list('trade_pool') && list('trade_roofing') && list('trade_lawn'), 'a trades project has a list for each trade picked');
  ok(plans && fk(plans, 'customer')?.type === 'contact' && fk(plans, 'renews')?.type === 'date' && fk(plans, 'visits')?.type === 'number' && fk(plans, 'status')?.choices.some((c) => c.label === 'Active'), 'and Service plans (customer, visits a year, renews, status) for the repair and recurring trades');
  ok(gear && fk(gear, 'customer')?.type === 'contact' && fk(gear, 'unit')?.type === 'equipment' && fk(gear, 'installed')?.type === 'date' && fk(gear, 'age')?.type === 'formula', 'and Customer equipment (whose, make/model/serial, installed, its age worked out)');
  ok(lic && fk(lic, 'expires')?.type === 'date' && fk(lic, 'left')?.type === 'formula' && fk(lic, 'kind')?.choices.some((c) => /NSCB/.test(c.label)), 'Licenses & insurance are in the workspace profile (Nevada contractor license among the kinds, expiry, days left)');
  ok(!list('licenses'), 'and not a tab on the board');
  ok(fk(hvac, 'entry')?.type === 'secret' && !/gate code/i.test(fk(hvac, 'access')?.hint || ''), 'every job has a sealed gate / lockbox code, and Access notes no longer asks for codes in plain text');
  ok(hvac.views.some((v) => v.kind === 'calendar' && v.start === fk(hvac, 'scheduled').id), 'and a Calendar of jobs by their scheduled day');
  ok(fk(list('trade_roofing'), 'hoa')?.type === 'select' && fk(list('trade_lawn'), 'watering')?.type === 'text' && !fk(hvac, 'hoa'), 'roofing asks about HOA approval, lawn care has the water district’s watering group, HVAC has neither');
  const jobsOnly = (await rico('POST', '/projects', { template: 'trades', trades: ['painting'] })).body;
  ok(!jobsOnly.types.some((x) => x.key === 'plans') && !jobsOnly.types.some((x) => x.key === 'licenses') && fk(jobsOnly.types[0], 'year')?.type === 'number', 'a painter gets no service plans (nor a licenses tab), but the year the home was built (pre-1978 lead rules)');
  r = await schema(jobsOnly.id, { op: 'addTypeFrom', key: 'plans' });
  ok(r.status === 200 && r.body.project.types.some((x) => x.key === 'plans'), 'and can add Service plans later, as a ready-made list');

  // ---------- Step 1: formulas ----------
  const bp = (await rico('POST', '/projects', { template: 'blank', name: 'Formulas' })).body;
  const bt = bp.types[0];
  const add = async (body) => { const y = await schema(bp.id, { typeId: bt.id, op: 'addField', ...body }); return y; };
  await add({ name: 'Price', type: 'money' });
  await add({ name: 'Qty', type: 'number' });
  await add({ name: 'Due', type: 'date' });
  await add({ name: 'Rush', type: 'checkbox' });
  r = await add({ name: 'Total', type: 'formula', expr: '{Price} * {Qty} + if({Rush}, 50, 0)', format: 'money' });
  ok(r.status === 200, 'a formula field is added');
  const fx = (pr) => pr.types[0].fields.find((f) => f.name === 'Total');
  let tot = fx(r.body.project);
  ok(tot && /\{#[\w-]+\}/.test(tot.expr) && !tot.expr.includes('{Price}'), 'it’s kept by field id, so renaming a field doesn’t break it');
  const fid = (name) => (r.body.project.types[0].fields.find((f) => f.name === name) || {}).id;
  const rec = (await rico('POST', `/projects/${bp.id}/records`, { typeId: bt.id, values: { [fid('Price')]: '120.50', [fid('Qty')]: 3, [fid('Rush')]: true } })).body;
  ok(rec.values[tot.id] === 41150, `its value is worked out on the server, in cents for money (${rec.values[tot.id]})`);
  await schema(bp.id, { typeId: bt.id, op: 'updateField', fieldId: fid('Price'), name: 'Unit price' });
  await rico('PATCH', `/records/${rec.id}`, { values: { [fid('Qty')]: 2 } });
  ok((await recOf(bp.id, rec.id)).values[tot.id] === 29100, 'and follows its fields (after Price was renamed, Qty changed to 2)');
  r = await rico('PATCH', `/records/${rec.id}`, { values: { [tot.id]: 5 } });
  ok((await recOf(bp.id, rec.id)).values[tot.id] === 29100, 'what’s sent for a formula is ignored');
  ok((await add({ name: 'Bad', type: 'formula', expr: '{Price} * ', format: 'number' })).status === 400, 'a formula that doesn’t parse is refused');
  ok((await add({ name: 'Bad2', type: 'formula', expr: '{Nope} + 1', format: 'number' })).status === 400, 'one naming a field that isn’t there is refused');
  r = await add({ name: 'Days to go', type: 'formula', expr: '{Due} - today()', format: 'days' });
  const dtg = r.body.project.types[0].fields.find((f) => f.name === 'Days to go');
  await rico('PATCH', `/records/${rec.id}`, { values: { [fid('Due')]: day(10) } });
  ok((await recOf(bp.id, rec.id)).values[dtg.id] === 10, 'dates count in days ({Due} - today() is 10)');
  r = await add({ name: 'Ends', type: 'formula', expr: '{Due} + 30', format: 'date' });
  const ends = r.body.project.types[0].fields.find((f) => f.name === 'Ends');
  ok((await recOf(bp.id, rec.id)).values[ends.id] === day(40), 'and a date result is a day (Due + 30)');
  r = await add({ name: 'Per unit', type: 'formula', expr: '{Total} / ({Qty} - 2)', format: 'money' });
  const per = r.body.project.types[0].fields.find((f) => f.name === 'Per unit');
  ok(r.status === 200 && (await recOf(bp.id, rec.id)).values[per.id] === undefined, 'a formula can use another; dividing by zero leaves it empty');
  ok((await schema(bp.id, { typeId: bt.id, op: 'updateField', fieldId: tot.id, expr: '{Per unit} + 1' })).status === 400, 'one that would end up using itself is refused');

  // ---------- rollups ----------
  r = await schema(bp.id, { op: 'addType', name: 'Parts' });
  const parts = r.body.project.types.find((x) => x.name === 'Parts');
  r = await schema(bp.id, { typeId: parts.id, op: 'addField', name: 'Cost', type: 'money' });
  const costF = r.body.project.types.find((x) => x.id === parts.id).fields.find((f) => f.name === 'Cost');
  r = await add({ name: 'Parts', type: 'link', target: parts.id, many: true });
  const linkF = r.body.project.types[0].fields.find((f) => f.name === 'Parts');
  r = await add({ name: 'Parts cost', type: 'rollup', via: linkF.id, of: costF.id, fn: 'sum' });
  ok(r.status === 200, 'a rollup over linked records is added');
  const pc = r.body.project.types[0].fields.find((f) => f.name === 'Parts cost');
  r = await add({ name: 'How many parts', type: 'rollup', via: linkF.id, fn: 'count' });
  const cnt = r.body.project.types[0].fields.find((f) => f.name === 'How many parts');
  const a1 = (await rico('POST', `/projects/${bp.id}/records`, { typeId: parts.id, values: { [costF.id]: '40' } })).body;
  const a2 = (await rico('POST', `/projects/${bp.id}/records`, { typeId: parts.id, values: { [costF.id]: '15.25' } })).body;
  await rico('PATCH', `/records/${rec.id}`, { values: { [linkF.id]: [a1.id, a2.id] } });
  let got = await recOf(bp.id, rec.id);
  ok(got.values[pc.id] === 5525 && got.values[cnt.id] === 2, `it adds up the linked parts ($${got.values[pc.id] / 100}, ${got.values[cnt.id]} parts)`);
  await rico('PATCH', `/records/${a2.id}`, { values: { [costF.id]: '60' } });
  ok((await recOf(bp.id, rec.id)).values[pc.id] === 10000, 'and changes when one of them does');
  await rico('DELETE', `/records/${a1.id}`);
  got = await recOf(bp.id, rec.id);
  ok(got.values[pc.id] === 6000 && got.values[cnt.id] === 1, 'and when one is deleted');
  r = await add({ name: 'Margin', type: 'formula', expr: '{Total} - {Parts cost}', format: 'money' });
  const mg = r.body.project.types[0].fields.find((f) => f.name === 'Margin');
  ok((await recOf(bp.id, rec.id)).values[mg.id] === 29100 - 6000, 'a formula can use a rollup');
  ok((await add({ name: 'Bad rollup', type: 'rollup', via: fid('Qty'), fn: 'sum' })).status === 400, 'a rollup needs a link field to go through');

  // ---------- the calendar view ----------
  r = await schema(bp.id, { typeId: bt.id, op: 'addView', name: 'Calendar', kind: 'calendar' });
  ok(r.status === 200 && r.body.view?.kind === 'calendar' || r.body.project?.types[0].views.some((v) => v.kind === 'calendar' && v.start === fid('Due')), 'a calendar view goes by a date field');
  ok((await schema(bp.id, { typeId: parts.id, op: 'addView', name: 'Cal', kind: 'calendar' })).status === 400, 'a list with no date can’t have one');

  // ---------- automations that change records ----------
  const st = fk(hvac, 'status');
  const later = st.choices[2].label;
  const fJobs = await feed('jobs');
  r = await rico('POST', '/automations', { name: 'Started? Set it up', trigger: { kind: 'record.stage', projectId: p.id, typeId: hvac.id, to: later }, actions: [
    { kind: 'record', projectId: p.id, typeId: hvac.id, set: [{ field: fk(hvac, 'crew').id, value: 'who' }, { field: fk(hvac, 'scheduled').id, value: 'today+2' }, { field: fk(hvac, 'access').id, value: 'Moved to {stage} by {who}' }] },
    { kind: 'create', projectId: p.id, typeId: gear.id, set: [{ field: fk(gear, 'unit_name')?.id || gear.primary, value: 'Unit at {record}' }] },
    { kind: 'post', text: 'Done with {record}', channelId: fJobs }] });
  ok(r.status === 200 && r.body.actions[0].kind === 'record' && r.body.actions[1].kind === 'create', 'an automation can change the record and add one');
  const dana = (await rico('POST', '/contacts', { name: 'Dana Ruiz', address: '12 Desert Rd', city: 'Henderson' })).body;
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: hvac.id, values: { job: 'AC not cooling', customer: dana.id } })).body;
  await sam('PATCH', `/records/${job.id}`, { values: { [st.id]: st.choices[2].id } });
  ok(await until(async () => (await posts(fJobs)).includes('Done with AC not cooling')), '(it ran)');
  got = await recOf(p.id, job.id);
  const samId = (await rico('GET', '/state')).body.workspace.members.find((m) => m.name === 'Sam Lee').id;
  ok(got.values[fk(hvac, 'crew').id] === samId && got.values[fk(hvac, 'scheduled').id] === day(2) && got.values[fk(hvac, 'access').id] === `Moved to ${later} by Sam Lee`, 'it assigned whoever moved it, scheduled it two days out and filled in the words');
  const log = (await rico('GET', `/records/${job.id}/log`)).body;
  ok(log.some((e) => e.by === 'Started? Set it up'), 'the job’s timeline says the automation changed it');
  const made = (await recs(p.id)).find((x) => x.typeId === gear.id && x.values[gear.primary] === 'Unit at AC not cooling');
  ok(made && made.values[fk(gear, 'customer').id] === dana.id, 'the record it added is for the same customer');
  await rico('POST', '/automations', { name: 'Added? (should not hear)', trigger: { kind: 'record.created', projectId: p.id, typeId: gear.id }, actions: [{ kind: 'post', text: 'LOOP {record}', channelId: fJobs }] });
  await rico('PATCH', `/records/${job.id}`, { values: { [st.id]: st.choices[0].id } });
  await rico('PATCH', `/records/${job.id}`, { values: { [st.id]: st.choices[2].id } });
  await until(async () => (await posts(fJobs)).filter((x) => x === 'Done with AC not cooling').length === 2);
  await sleep(300);
  ok(!(await posts(fJobs)).some((x) => x.startsWith('LOOP')), 'what an automation adds never sets another one off');
  ok((await rico('POST', '/automations', { name: 'x', trigger: { kind: 'record.created' }, actions: [{ kind: 'record', projectId: p.id, typeId: hvac.id, set: [{ field: fk(hvac, 'price').id, value: '1' }] }] })).status === 400, 'it can’t set price lines (they have their own rules, like the discount OK)');
  ok((await rico('POST', '/automations', { name: 'x', trigger: { kind: 'record.created' }, actions: [{ kind: 'record', projectId: p.id, typeId: hvac.id, set: [{ field: st.id, value: 'Not a stage' }] }] })).status === 400, 'or a stage that isn’t one');
  await rico('POST', '/automations', { name: 'Lead? Make a job', trigger: { kind: 'contact.created' }, actions: [{ kind: 'create', projectId: p.id, typeId: hvac.id, set: [{ field: fk(hvac, 'job').id, value: 'Estimate for {contact}' }] }] });
  const lead = (await rico('POST', '/contacts', { name: 'Lee Newlead' })).body;
  ok(await until(async () => (await recs(p.id)).some((x) => x.typeId === hvac.id && x.values[fk(hvac, 'job').id] === 'Estimate for Lee Newlead' && x.values[fk(hvac, 'customer').id] === lead.id)), 'a new contact can make a job, for that contact');
  const priv = (await rico('POST', '/projects', { template: 'blank', name: 'Rico private', private: true })).body;
  await rico('PATCH', '/members/' + samId, { role: 'admin' }); // an admin can make automations, but can't see Rico's private project
  ok((await sam('POST', '/automations', { name: 'x', trigger: { kind: 'record.created' }, actions: [{ kind: 'create', projectId: priv.id, typeId: priv.types[0].id, set: [] }] })).status === 400, 'nobody can point one at a project they can’t see');

  // ---------- a record's date ----------
  const fDates = await feed('dates');
  const lf = (k) => fk(lic, k).id;
  r = await rico('POST', '/automations', { name: 'Expiring', trigger: { kind: 'record.date', projectId: prof.id, typeId: lic.id, fieldId: lf('expires'), days: -30, time: '00:00' }, actions: [{ kind: 'post', text: '{record} expires {date}', channelId: fDates }] });
  ok(r.status === 200 && r.body.trigger.days === -30, 'an automation can go off 30 days before a record’s date');
  ok((await rico('POST', '/automations', { name: 'x', trigger: { kind: 'record.date', projectId: prof.id, typeId: lic.id, fieldId: lf('number'), days: 0 }, actions: [{ kind: 'post', text: 'x', channelId: fDates }] })).status === 400, 'only on a date field');
  const mk = (name, exp) => rico('POST', `/projects/${prof.id}/records`, { typeId: lic.id, values: { name, [lf('expires')]: exp } });
  await mk('NSCB C-21', day(30));
  await mk('Liability insurance', day(12));
  await mk('Bond', day(45));
  await mk('Old card', day(-3));
  ok(await until(async () => { const x = await posts(fDates); return x.includes(`NSCB C-21 expires ${day(30)}`) && x.includes(`Liability insurance expires ${day(12)}`); }), 'it goes off for a license 30 days out, and for one already inside the 30 days');
  await sleep(800);
  let dp = await posts(fDates);
  ok(!dp.some((x) => x.startsWith('Bond')) && !dp.some((x) => x.startsWith('Old card')), 'not for one 45 days out, nor one that’s already expired');
  ok(dp.filter((x) => x.startsWith('NSCB')).length === 1, 'and once per date');
  const bond = (await recs(prof.id)).find((x) => x.values[lic.primary] === 'Bond');
  await rico('PATCH', `/records/${bond.id}`, { values: { [lf('expires')]: day(20) } });
  ok(await until(async () => (await posts(fDates)).includes(`Bond expires ${day(20)}`)), 'a date changed to inside the window sets it off for the new date');
  r = await rico('POST', '/automations', { name: 'Review ask', trigger: { kind: 'record.date', projectId: p.id, typeId: hvac.id, fieldId: fk(hvac, 'scheduled').id, days: 1, time: '00:00' }, actions: [{ kind: 'post', text: 'Ask {record} for a review', channelId: fDates }] });
  await rico('POST', `/projects/${p.id}/records`, { typeId: hvac.id, values: { job: 'Yesterday job', scheduled: day(-1) } });
  await rico('POST', `/projects/${p.id}/records`, { typeId: hvac.id, values: { job: 'Last month job', scheduled: day(-40) } });
  ok(await until(async () => (await posts(fDates)).includes('Ask Yesterday job for a review')), 'a day after a job, it goes off');
  await sleep(600);
  ok(!(await posts(fDates)).includes('Ask Last month job for a review'), 'but not for a job from before the automation was made');
  ok((await sam('POST', '/automations', { name: 'Sam peeks', trigger: { kind: 'record.date', projectId: priv.id, typeId: priv.types[0].id, fieldId: 'x', days: 0 }, actions: [{ kind: 'post', text: 'x', channelId: 'general' }] })).status === 400, 'nobody can watch dates in a project they can’t see');
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
