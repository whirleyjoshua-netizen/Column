// Flows, step 1: one event bus, triggers from every tool. Automations hear jobs and records (added, moved to a
// stage however it moved, deleted), quotes answered, visits, invoices and payments, business money, texts, docs and
// Map pins, as well as what they heard before (tasks, contacts, calls, campaigns, files, signatures). Something
// private sets off only an automation narrowed to it whose maker can see it; business money only owners'
// automations; old automations keep working under the new names; the editor's list comes from the server.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { twilioSignature } from '../server/twilio.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_bus';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4892, F_PORT = 4893, B = `http://127.0.0.1:${PORT}`, F = `http://127.0.0.1:${F_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
// A stand-in Twilio (from tests/twilio.mjs), for a text coming in.
const SID = 'AC' + 'a'.repeat(32), TOKEN = 'b'.repeat(32), NUM = '+17025550100';
const T = { number: { sid: 'PN1', phone_number: NUM, sms_url: '' } };
const fake = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const u = new URL(req.url, F);
  const out = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  const base = `/2010-04-01/Accounts/${SID}`;
  if (u.pathname === base + '.json') return out(200, { sid: SID, friendly_name: 'Cool Air', type: 'Full' });
  if (u.pathname === base + '/IncomingPhoneNumbers.json') return out(200, { incoming_phone_numbers: [T.number] });
  if (u.pathname === base + '/IncomingPhoneNumbers/PN1.json') { if (req.method === 'POST') T.number.sms_url = Object.fromEntries(new URLSearchParams(raw)).SmsUrl; return out(200, T.number); }
  out(404, {});
});
await new Promise((r) => fake.listen(F_PORT, '127.0.0.1', r));
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', TWILIO_API: F }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
};
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  await start();
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Flows ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  const rico = call(ricoTok);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Flows ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  const samId = st.workspace.members.find((m) => m.name === 'Sam Reed').id;
  await rico('PATCH', `/members/${samId}`, { role: 'admin' });
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  // Each automation posts to its own feed, so what ran is easy to see.
  const posts = async (feed) => (await rico('GET', '/state')).body.items.filter((x) => x.type === 'message' && x.channelId === feed).map((x) => x.text);
  const feed = async (name) => { const w = (await rico('POST', '/channels', { name })).body; return (w.channels || w.workspace?.channels || []).find((c) => c.name === name)?.id; };
  const auto = async (who, name, trigger, text, ch) => { const r = await who('POST', '/automations', { name, trigger, actions: [{ kind: 'post', text, channelId: ch }] }); if (r.status !== 200) console.log('automation', name, r.status, JSON.stringify(r.body)); return r.body; };

  // The list the editor draws.
  const cat = (await rico('GET', '/automations/catalog')).body;
  ok(cat?.events?.length >= 25 && ['record.stage', 'invoice.paid', 'payment.received', 'money.added', 'visit.scheduled', 'text.received', 'doc.created', 'pin.dropped', 'quote.accepted'].every((k) => cat.events.some((e) => e.type === k)) && cat.tools.projects, `the editor’s list comes from the server: ${cat?.events?.length} events from ${Object.keys(cat?.tools || {}).length} tools`);
  ok((await rico('POST', '/automations', { name: 'x', trigger: { kind: 'nonsense' }, actions: [{ kind: 'post', text: 'x', channelId: 'general' }] })).status === 400, 'an event that isn’t on the list is refused');

  // Jobs: added, moved to a stage (only when the stage changes), deleted.
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const fid = (k) => tp.fields.find((f) => f.key === k)?.id;
  const statusF = tp.fields.find((f) => f.key === 'status');
  const choice = (label) => statusF.choices.find((c) => c.label === label)?.id;
  const later = statusF.choices[2].label;
  const fJobs = await feed('jobs');
  await auto(rico, 'New job', { kind: 'record.created', projectId: p.id }, 'New job: {record} in {project}', fJobs);
  await auto(rico, 'Moved', { kind: 'record.stage', projectId: p.id, to: later }, '{record} moved from {from} to {stage}', fJobs);
  await auto(rico, 'Gone', { kind: 'record.deleted' }, '{record} was deleted by {who}', fJobs);
  const dana = (await rico('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '+17025550142' })).body;
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: dana.id, price: { rows: [{ desc: 'Tune-up', qty: 1, price: '300' }], taxRate: 0 } } })).body;
  const okNew = await until(async () => (await posts(fJobs)).includes(`New job: AC tune-up in ${p.name}`));
  ok(okNew, 'a job added sets off “New job” (with its name and project)');
  await rico('PATCH', `/records/${job.id}`, { values: { [fid('job')]: 'AC tune-up (2 units)' } });
  await rico('PATCH', `/records/${job.id}`, { values: { [statusF.id]: choice(later) } });
  ok(await until(async () => (await posts(fJobs)).some((x) => x.startsWith('AC tune-up (2 units) moved from') && x.endsWith('to ' + later))), `moving it to ${later} sets off “Moved”, saying where from`);
  const movedN = (await posts(fJobs)).filter((x) => x.includes(' moved from ')).length;
  await rico('PATCH', `/records/${job.id}`, { values: { [fid('job')]: 'AC tune-up (renamed)' } });
  await sleep(400);
  ok((await posts(fJobs)).filter((x) => x.includes(' moved from ')).length === movedN, 'changing anything but the stage doesn’t');

  // Visits, invoices, payments.
  const fMoney = await feed('money');
  await auto(rico, 'Visit', { kind: 'visit.scheduled' }, 'Visit for {record} on {date} at {time}', fMoney);
  await auto(rico, 'Sent', { kind: 'invoice.sent', over: 100 }, 'Sent {invoice} to {customer} for {amount}', fMoney);
  await auto(rico, 'Paid', { kind: 'payment.received' }, '{customer} paid {amount} on {invoice}', fMoney);
  await rico('POST', `/records/${job.id}/visits`, { date: '2099-01-15', start: 540, end: 600 });
  ok(await until(async () => (await posts(fMoney)).some((x) => x.startsWith('Visit for AC tune-up') && x.includes('2099-01-15') && x.includes('09:00'))), 'a visit scheduled sets off “Visit”, with the day and time');
  const inv = (await rico('POST', `/records/${job.id}/invoices`)).body;
  await rico('POST', `/invoices/${inv.id}/send`);
  ok(await until(async () => (await posts(fMoney)).includes(`Sent ${inv.number} to Dana Ruiz for $300.00`)), 'an invoice over $100 sent sets off “Sent”');
  await rico('POST', `/invoices/${inv.id}/payments`, { amount: '100', method: 'cash' });
  ok(await until(async () => (await posts(fMoney)).includes(`Dana Ruiz paid $100.00 on ${inv.number}`)), 'a payment sets off “Paid”');

  // Business money: owners' automations only, and never someone's own money.
  const fFin = await feed('finance');
  await auto(rico, 'Big spend', { kind: 'money.added', over: 500, direction: 'out' }, 'Spent {amount} on {category}: {note}', fFin);
  await auto(sam, 'Sam spend', { kind: 'money.added' }, 'SAM heard {amount}', fFin);
  await rico('POST', '/money', { kind: 'out', amount: 800, day: '2026-11-11', category: 'Tools', note: 'Vacuum pump', scope: 'business' });
  await rico('POST', '/money', { kind: 'out', amount: 900, day: '2026-11-11', category: 'Personal', note: 'MY OWN dinner', scope: 'personal' });
  await rico('POST', '/money', { kind: 'out', amount: 50, day: '2026-11-11', category: 'Tools', note: 'Tape', scope: 'business' });
  await sleep(500);
  const fin = await posts(fFin);
  ok(fin.includes('Spent $800.00 on Tools: Vacuum pump') && !fin.some((x) => x.includes('Tape')), 'business money out over $500 sets off the owner’s automation (and $50 doesn’t)');
  ok(!fin.some((x) => x.includes('MY OWN')) && !fin.some((x) => x.startsWith('SAM heard $800')), 'someone’s own money never does, and an admin who isn’t an owner doesn’t hear business money');

  // A text in.
  await rico('PUT', '/texting', { sid: SID, token: TOKEN, number: NUM });
  const fTxt = await feed('texts');
  await auto(rico, 'Text', { kind: 'text.received' }, '{contact} texted: {text}', fTxt);
  const smsPath = new URL(T.number.sms_url).pathname;
  const params = { MessageSid: 'SMin1', From: '+17025550142', To: NUM, Body: 'Running late, 10 min' };
  await fetch(B + smsPath, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature(TOKEN, B + smsPath, params) }, body: new URLSearchParams(params).toString() });
  ok(await until(async () => (await posts(fTxt)).includes('Dana Ruiz texted: Running late, 10 min')), 'a text from a customer sets off “Text”');

  // Docs and the Map; private things stay private.
  const fDocs = await feed('docs');
  await auto(sam, 'Docs', { kind: 'doc.created' }, 'New doc: {doc} by {who}', fDocs);
  await rico('POST', '/items', { type: 'text', doc: { title: 'Install guide', blocks: [] } });
  const dir = (await rico('POST', '/dirs', { name: 'Mine', private: true })).body;
  await rico('POST', '/items', { type: 'text', doc: { title: 'PRIVATE plans', blocks: [] }, dirId: dir.id });
  await sleep(400);
  ok((await posts(fDocs)).includes('New doc: Install guide by Rico Vega') && !(await posts(fDocs)).some((x) => x.includes('PRIVATE')), 'a team doc sets off “Docs”; one in a private folder doesn’t');
  const camp = (await rico('POST', '/campaigns', { name: 'Door knocking' })).body;
  await auto(rico, 'Pins', { kind: 'pin.dropped', campaignId: camp.id }, 'Pin: {pin} ({note}) in {campaign}', fDocs);
  await rico('POST', '/pins', { lat: 36.1, lng: -115.1, kind: 'lead', note: 'Interested', address: '12 Main St', campaignId: camp.id });
  await rico('POST', '/pins', { lat: 36.1, lng: -115.1, kind: 'flyer', note: 'MY OWN pin' });
  await sleep(400);
  ok((await posts(fDocs)).some((x) => x.startsWith('Pin: ') && x.includes('Interested') && x.includes('Door knocking')) && !(await posts(fDocs)).some((x) => x.includes('MY OWN')), 'a campaign’s pin sets off “Pins”; someone’s own pin doesn’t');

  // A private campaign: only an automation narrowed to it, by someone in it.
  const fPriv = await feed('private-check');
  const priv = (await rico('POST', '/campaigns', { name: 'SECRET deal', private: true })).body;
  await auto(sam, 'Sam tasks', { kind: 'task.done' }, 'SAM: {task} done', fPriv);
  await auto(rico, 'Rico secret', { kind: 'task.done', campaignId: priv.id }, 'RICO: {task} done', fPriv);
  const g = (await rico('POST', '/goals', { campaignId: priv.id, title: 'Steps', kind: 'tasks' })).body;
  const tk = (await rico('POST', '/tasks', { goalId: g.id, text: 'SECRET step' })).body;
  await rico('PATCH', `/tasks/${tk.id}`, { done: true });
  await sleep(500);
  const pv = await posts(fPriv);
  ok(!pv.some((x) => x.startsWith('SAM:')), 'a private campaign’s task done doesn’t set off an automation that isn’t narrowed to it (Sam would post it to the team)');
  ok(pv.includes('RICO: SECRET step done'), 'one narrowed to that campaign, by someone in it, runs');
  r = await sam('POST', '/automations', { name: 'Peek', trigger: { kind: 'task.done', campaignId: priv.id }, actions: [{ kind: 'post', text: 'x', channelId: fPriv }] });
  ok(r.status === 200 && !r.body.trigger.campaignId, 'Sam can’t narrow one to a private campaign he isn’t in');
  const pp = (await rico('POST', '/projects', { template: 'crm', name: 'SECRET pipeline', private: true })).body;
  await auto(sam, 'Sam records', { kind: 'record.created' }, 'SAM record {record}', fPriv);
  await rico('POST', `/projects/${pp.id}/records`, { typeId: pp.types[0].id, values: { [pp.types[0].primary]: 'SECRET record' } });
  await sleep(400);
  ok(!(await posts(fPriv)).some((x) => x.includes('SECRET record')), 'nor does a record in a private project');

  // Old automations, under their old names, keep working; and a restart keeps stages to compare.
  const fOld = await feed('old');
  r = await rico('POST', '/automations', { name: 'Old style', trigger: { kind: 'contact.added' }, actions: [{ kind: 'post', text: 'Welcome {contact}', channelId: fOld }] });
  ok(r.status === 200 && r.body.trigger.kind === 'contact.created', 'an old name (contact.added) is taken as the new one');
  await rico('POST', '/contacts', { name: 'Lee Park', email: 'lee@x.test' });
  ok(await until(async () => (await posts(fOld)).includes('Welcome Lee Park')), 'and runs');
  srv.kill();
  await sleep(700);
  const data = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
  const a2 = Object.values(data.automations).find((x) => x.name === 'Old style');
  a2.trigger.kind = 'contact.added';
  for (const rec of Object.values(data.records)) delete rec.flowStage;
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(data));
  await start();
  ok((await rico('GET', '/automations')).body.find((x) => x.name === 'Old style').trigger.kind === 'contact.created', 'at start, an automation saved under an old name is renamed');
  await rico('PATCH', `/records/${job.id}`, { values: { [statusF.id]: statusF.choices[0].id } });
  await rico('PATCH', `/records/${job.id}`, { values: { [statusF.id]: choice(later) } });
  ok(await until(async () => (await posts(fJobs)).filter((x) => x.includes(' moved from ')).length === movedN + 1), 'records from before still tell their first move after a restart');
  await rico('DELETE', `/records/${job.id}`);
  ok(await until(async () => (await posts(fJobs)).includes('AC tune-up (renamed) was deleted by Rico Vega')), 'a job deleted sets off “Gone”');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log('Server log:\n' + srv?.log.slice(-3000));
  srv?.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
