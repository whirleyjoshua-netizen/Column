// Flows, step 3: actions in every tool, through the app's own routes. An automation books a visit, makes an invoice,
// adds the business's money and writes a doc from a template right away, as its maker (their permissions, the team's
// rules) and named as the automation. What goes to a customer (a text, an email, sending an invoice) waits for a
// person's OK every time, even when an owner made it; OK'd, it goes out through the same route, once. Declined,
// nothing goes. Nobody marked do not contact gets anything. The OK also answers the team's invoice rule, so it isn't
// asked twice. What an automation does, and what an OK'd send does, sets no automation off (no loops).
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_actions';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const OUTBOX = DIR + '/outbox';
const PORT = 4970, F_PORT = 4971, B = `http://127.0.0.1:${PORT}`, F = `http://127.0.0.1:${F_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const mails = () => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().map((f) => JSON.parse(fs.readFileSync(OUTBOX + '/' + f, 'utf8'))) : []);

// A stand-in Twilio: the account, the number, and texts going out.
const SID = 'AC' + 'a'.repeat(32), TOKEN = 'b'.repeat(32), NUM = '+17025550100';
const T = { number: { sid: 'PN1', phone_number: NUM, sms_url: '' }, sent: [] };
const fake = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const u = new URL(req.url, F);
  const out = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  const base = `/2010-04-01/Accounts/${SID}`;
  if (u.pathname === base + '.json') return out(200, { sid: SID, friendly_name: 'Cool Air', type: 'Full' });
  if (u.pathname === base + '/IncomingPhoneNumbers.json') return out(200, { incoming_phone_numbers: [T.number] });
  if (u.pathname === base + '/IncomingPhoneNumbers/PN1.json') { if (req.method === 'POST') T.number.sms_url = Object.fromEntries(new URLSearchParams(raw)).SmsUrl; return out(200, T.number); }
  if (u.pathname === base + '/Messages.json' && req.method === 'POST') { const f = Object.fromEntries(new URLSearchParams(raw)); const m = { sid: 'SM' + (T.sent.length + 1), status: 'queued', ...f }; T.sent.push(m); return out(201, m); }
  out(404, {});
});
await new Promise((r) => fake.listen(F_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', TWILIO_API: F }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Acts ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Acts ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  const ricoId = st.me.memberId, samId = st.workspace.members.find((m) => m.name === 'Sam Reed').id;
  await rico('PATCH', `/members/${samId}`, { role: 'admin' });
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  r = await rico('PUT', '/texting', { sid: SID, token: TOKEN, number: NUM });
  ok(r.status === 200, '(setup) texting connected to a stand-in Twilio');

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const fid = (k) => tp.fields.find((f) => f.key === k)?.id;
  const statusF = tp.fields.find((f) => f.key === 'status');
  const choice = (label) => statusF.choices.find((c) => c.label === label)?.id;
  const dana = (await rico('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '702-555-0142' })).body;
  const newJob = async (name, customer = dana.id) => (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: name, customer, price: { rows: [{ desc: 'Tune-up', qty: 1, price: '300' }] } } })).body;
  const feed = async (name) => { const w = (await rico('POST', '/channels', { name })).body; return (w.channels || w.workspace?.channels || []).find((c) => c.name === name)?.id; };
  const posts = async (f) => (await rico('GET', '/state')).body.items.filter((x) => x.type === 'message' && x.channelId === f).map((x) => x.text);
  const auto = async (who, name, trigger, actions) => (await who('POST', '/automations', { name, trigger, actions }));
  const runsOf = async (name) => (await rico('GET', '/automations')).body.find((x) => x.name === name)?.runs || [];

  // A doc template to write from.
  const doc = (await rico('POST', '/items', { type: 'text', doc: { title: 'Work order', blocks: [{ type: 'p', runs: [{ text: 'Checklist for the crew' }] }] } })).body;
  const tpl = (await rico('POST', '/doc-templates', { docId: doc.id, name: 'Work order' })).body;
  ok(!!tpl.id, '(setup) a doc template');

  // What's checked when it's saved.
  r = await auto(sam, 'Sam’s money', { kind: 'record.stage', projectId: p.id, to: 'Done' }, [{ kind: 'money', direction: 'in', amount: 50 }]);
  ok(r.status === 400 && /Only owners/.test(r.body.error), 'only owners can have an automation add the business’s money');
  r = await auto(rico, 'No words', { kind: 'record.stage', projectId: p.id }, [{ kind: 'text', text: '' }]);
  ok(r.status === 400, 'a text with no words is refused');
  r = await auto(rico, 'No subject', { kind: 'record.stage', projectId: p.id }, [{ kind: 'email', subject: '', text: 'hi' }]);
  ok(r.status === 400, 'an email with no subject is refused');
  r = await auto(rico, 'Bad doc', { kind: 'record.stage', projectId: p.id }, [{ kind: 'doc', templateId: 'nope' }]);
  ok(r.status === 400, 'a doc from a template that isn’t the team’s is refused');

  // Something that listens for what the automation does: it must never run from that.
  const loopF = await feed('loops');
  for (const k of ['visit.scheduled', 'money.added', 'doc.created', 'invoice.sent']) await auto(rico, 'Heard ' + k, { kind: k }, [{ kind: 'post', text: 'heard ' + k, channelId: loopF }]);

  // The whole thing: a job is done → book the install, bill it (and send it, after an OK), text and email Dana
  // (after an OK), add the money, write the work order.
  r = await auto(rico, 'Done → follow through', { kind: 'record.stage', projectId: p.id, to: 'Done' }, [
    { kind: 'visit', visit: 'Install', inDays: 2, start: '09:00', length: 90, crew: [samId] },
    { kind: 'invoice', send: true },
    { kind: 'text', text: 'Hi, {record} is done. Thanks from Cool Air!' },
    { kind: 'email', subject: '{record} is done', text: 'Hi,\n\n{record} is finished.\n\nThanks!' },
    { kind: 'money', direction: 'in', amount: 300, category: 'Jobs', note: 'Paid for {record}' },
    { kind: 'doc', templateId: tpl.id, title: 'Work order: {record}' },
  ]);
  ok(r.status === 200 && r.body.actions.length === 6, 'an automation with a visit, an invoice, a text, an email, money and a doc is saved');
  const job = await newJob('AC tune-up');
  await rico('PATCH', `/records/${job.id}`, { values: { [statusF.id]: choice('Done') } });
  ok(await until(async () => (await runsOf('Done → follow through')).length > 0), 'moving the job to Done runs it');
  const run = (await runsOf('Done → follow through'))[0];
  ok(run.ok, `it ran (${run.note})`);
  ok(/Booked the install on \d{4}-\d\d-\d\d at 09:00/.test(run.note) && /Made INV-\d+ · Waiting for an OK: Send INV-\d+ for \$300\.00 to Dana Ruiz/.test(run.note), 'the log says it booked the install and made the invoice, which waits for an OK to send');
  ok(/Waiting for an OK: Text Dana Ruiz/.test(run.note) && /Waiting for an OK: Email Dana Ruiz: AC tune-up is done/.test(run.note), 'and the text and email wait for an OK');
  ok(/Added \$300\.00 in to Finance/.test(run.note) && /Wrote the doc “Work order: AC tune-up”/.test(run.note), 'and added the money and wrote the doc');

  const visits = (await rico('GET', `/records/${job.id}/visits`)).body;
  ok(visits.length === 1 && visits[0].kind === 'Install' && visits[0].start === 540 && visits[0].end === 630 && visits[0].memberIds.length === 1 && visits[0].memberIds[0] === samId, 'the install is booked on the job: 9:00 to 10:30, for Sam');
  st = (await rico('GET', '/state')).body;
  const inv = (await rico('GET', '/invoices')).body.find((x) => x.recordId === job.id);
  ok(inv && inv.status === 'draft' && !inv.sentAt, 'the invoice is made, as a draft (not sent yet)');
  const money = st.money.find((x) => x.note === 'Paid for AC tune-up');
  ok(money && money.kind === 'in' && money.amount === 30000 && money.scope === 'business' && money.by === 'Done → follow through', 'the money is in the business’s Finance, by the automation');
  const made = st.items.find((x) => x.type === 'text' && x.title === 'Work order: AC tune-up');
  ok(!!made && made.by === 'Done → follow through', 'the doc is written from the template, by the automation');
  ok(T.sent.length === 0 && !mails().some((m) => m.to === 'dana@x.test'), 'nothing has gone to Dana yet');
  await sleep(300);
  ok((await posts(loopF)).length === 0, 'what the automation did set nothing off (visit, money, doc)');

  // The OKs: the owner who made it is asked too, and can OK it.
  const aps = (await rico('GET', '/approvals')).body.approvals.filter((x) => x.status === 'pending' && x.flow);
  ok(aps.length === 3 && aps.every((x) => x.by === 'Automation “Done → follow through”'), 'three OKs wait, from the automation');
  const apOf = (re) => aps.find((x) => re.test(x.summary));
  ok((await sam('POST', `/approvals/${apOf(/^Text/).id}/approve`)).status === 403, 'an admin can’t OK when only owners approve');
  r = await rico('POST', `/approvals/${apOf(/^Text/).id}/approve`, {});
  ok(r.status === 200 && r.body.approval.status === 'approved', 'the owner OKs the text');
  ok(await until(() => T.sent.length === 1) && T.sent[0].To === '+17025550142' && T.sent[0].Body === 'Hi, AC tune-up is done. Thanks from Cool Air!', 'and it goes to Dana’s phone, with the words filled in');
  r = await rico('POST', `/approvals/${apOf(/^Email/).id}/approve`, {});
  ok(r.body.approval.status === 'approved' && await until(() => mails().some((m) => m.to === 'dana@x.test' && m.subject === 'AC tune-up is done')), 'the email goes to Dana once it’s OK’d');
  const timeline = (await rico('GET', `/records/${job.id}/log`)).body;
  ok(JSON.stringify(timeline).includes('Emailed Dana Ruiz: AC tune-up is done'), 'and it’s on the job’s timeline');
  r = await rico('POST', `/approvals/${apOf(/^Send INV/).id}/approve`, {});
  ok(r.body.approval.status === 'approved', 'the invoice send is OK’d');
  const sentInv = (await rico('GET', `/invoices/${inv.id}`)).body;
  ok(!!sentInv.sentAt, 'and the invoice is sent');
  ok((await rico('POST', `/approvals/${apOf(/^Text/).id}/approve`, {})).status === 409 && T.sent.length === 1, 'an OK can’t send it twice');
  await sleep(300);
  ok((await posts(loopF)).length === 0, 'an OK’d send sets nothing off either (invoice sent)');

  // Declined: nothing goes.
  const job2 = await newJob('Furnace check');
  await rico('PATCH', `/records/${job2.id}`, { values: { [statusF.id]: choice('Done') } });
  ok(await until(async () => (await rico('GET', '/approvals')).body.approvals.filter((x) => x.status === 'pending' && x.flow).length === 3), '(setup) the next job’s OKs wait');
  for (const x of (await rico('GET', '/approvals')).body.approvals.filter((y) => y.status === 'pending' && y.flow)) await rico('POST', `/approvals/${x.id}/decline`, {});
  await sleep(300);
  ok(T.sent.length === 1 && !mails().some((m) => m.subject === 'Furnace check is done'), 'declined, nothing goes to the customer');

  // A person's own invoice send still sets off what listens for it (so it was the automation's that didn't).
  const inv2 = (await rico('GET', '/invoices')).body.find((x) => x.recordId === job2.id);
  await rico('POST', `/invoices/${inv2.id}/send`, {});
  ok(await until(async () => (await posts(loopF)).includes('heard invoice.sent')), 'a person sending an invoice does set off what listens for it');

  // Do not contact: nothing asked, it says why.
  const ned = (await rico('POST', '/contacts', { name: 'Ned No', email: 'ned@x.test', phone: '702-555-0143', dne: true })).body;
  await auto(rico, 'Ping', { kind: 'record.stage', projectId: p.id, to: 'Scheduled' }, [{ kind: 'text', text: 'Hi' }]);
  const job3 = await newJob('Duct clean', ned.id);
  const pending = (await rico('GET', '/approvals')).body.approvals.filter((x) => x.status === 'pending').length;
  await rico('PATCH', `/records/${job3.id}`, { values: { [statusF.id]: choice('Scheduled') } });
  ok(await until(async () => /Didn’t text Ned No: they asked not to be contacted/.test((await runsOf('Ping'))[0]?.note || '')), 'someone marked do not contact isn’t texted, and the log says why');
  ok((await rico('GET', '/approvals')).body.approvals.filter((x) => x.status === 'pending').length === pending, 'and no OK is asked for');

  // The team's invoice rule: an admin's automation, an invoice over the limit. One OK covers both.
  await rico('PUT', '/rules', { invoice: { level: 'approval', over: '$100' } });
  await auto(sam, 'Sam bills', { kind: 'record.stage', projectId: p.id, to: 'Invoiced' }, [{ kind: 'invoice', send: true }]);
  const job4 = await newJob('Heat pump');
  await rico('PATCH', `/records/${job4.id}`, { values: { [statusF.id]: choice('Invoiced') } });
  ok(await until(async () => (await rico('GET', '/approvals')).body.approvals.some((x) => x.status === 'pending' && x.by === 'Automation “Sam bills”')), 'an admin’s automation asks for an OK to send');
  const sb = (await rico('GET', '/approvals')).body.approvals.find((x) => x.status === 'pending' && x.by === 'Automation “Sam bills”');
  r = await rico('POST', `/approvals/${sb.id}/approve`, {});
  const inv4 = (await rico('GET', '/invoices')).body.find((x) => x.recordId === job4.id);
  ok(r.body.approval.status === 'approved' && !!inv4.sentAt, 'the owner’s OK sends it, over the team’s limit too');
  ok(!(await rico('GET', '/approvals')).body.approvals.some((x) => x.status === 'pending' && /INV/.test(x.summary) && x.by === 'Sam Reed'), 'without asking a second time for the team rule');

  // A maker who's no longer an admin: what it does is refused by the routes, and the log says so.
  await auto(sam, 'Sam’s visit', { kind: 'record.stage', projectId: p.id, to: 'Scheduled' }, [{ kind: 'invoice', send: false }]);
  await rico('PATCH', `/members/${samId}`, { role: 'member' });
  const job5 = await newJob('Thermostat');
  await rico('PATCH', `/records/${job5.id}`, { values: { [statusF.id]: choice('Scheduled') } });
  ok(await until(async () => { const x = (await runsOf('Sam’s visit'))[0]; return x && !x.ok; }), `a member’s automation can’t bill (${(await runsOf('Sam’s visit'))[0]?.note})`);
  ok(!(await rico('GET', '/invoices')).body.some((x) => x.recordId === job5.id), 'and no invoice was made');

  // Old steps still work as before (a post), and the label for Projects.
  const cat = (await rico('GET', '/automations/catalog')).body;
  ok(cat.tools.projects === 'Projects', 'the editor calls the tool Projects');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
fake.close();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
