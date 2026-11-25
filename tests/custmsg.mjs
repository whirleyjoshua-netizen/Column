// Customer messages: "On my way" emailed under the team's name (replies to whoever's coming) or written as a text for
// their phone; a reminder the day before a visit, once, and again if it moves; a review request once a job is paid,
// once; nothing to customers marked do not contact; only owners and admins turn these on.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/custmsg';
const OUTBOX = DIR + '/outbox';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4759, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(150); } return false; };
const mails = (tag) => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().map((f) => JSON.parse(fs.readFileSync(OUTBOX + '/' + f, 'utf8'))) : []).filter((x) => !tag || x.tag === tag);
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', CUSTMSG_TICK_MS: '300', REVIEW_DELAY_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const go = async (b) => { const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const r = await go(body);
  // A message to a customer asks first (docs/jobflows/PHASE3B.md §1): here the person presses Send on the preview.
  return r.status === 428 && r.body?.confirm ? go({ ...(body || {}), confirm: r.body.confirm }) : r;
};
// A time zone where it's past 9am (reminders go out from then) and not yet late, so "tomorrow" is steady.
const hourIn = (tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const tz = ['Pacific/Kiritimati', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Pago_Pago'].find((z) => hourIn(z) >= 10 && hourIn(z) <= 21);
const dayIn = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
const t = Date.now();
const joEmail = `jo${t}@t.test`;
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Cool Air ' + t, name: 'Jo Park', email: joEmail, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = mails('verify').find((x) => x.to === joEmail)?.text.match(/\b(\d{6})\b/)?.[1];
  await jo('POST', '/account/verify', { code });
  await jo('PATCH', '/workspace', { tz });
  const inv = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Cool Air ' + t, code: inv, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  const samId = (await jo('GET', '/state')).body.workspace.members.find((x) => x.name === 'Sam').id;

  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const fid = (k) => tp.fields.find((f) => f.key === k).id;
  const choice = (label) => tp.fields.find((f) => f.key === 'status').choices.find((c) => c.label === label).id;
  const dana = (await jo('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '(555) 010-0100' })).body;
  const pat = (await jo('POST', '/contacts', { name: 'Pat Lee', email: 'pat@x.test', phone: '555-0199', dne: true })).body;
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: dana.id, address: '10 A St' } })).body;
  const patJob = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Furnace', customer: pat.id, address: '20 B St' } })).body;
  const today = dayIn(Date.now());
  const tomorrow = dayIn(Date.now() + 864e5);
  const v = (await jo('POST', `/records/${job.id}/visits`, { kind: 'Service', date: today, start: 600, end: 660, memberIds: [samId] })).body;

  // On my way.
  r = await sam('POST', `/visits/${v.id}/on-my-way`, { minutes: 25, email: false });
  ok(r.status === 200 && r.body.sms?.phone === '5550100100' && /it's Sam from Cool Air/.test(r.body.sms.body) && /about 25 minutes/.test(r.body.sms.body) && !mails('on-my-way').length, 'Sam’s “on my way” as a text for his phone: ' + r.body.sms?.body);
  r = await sam('POST', `/visits/${v.id}/on-my-way`, { minutes: 25 });
  const omw = mails('on-my-way')[0];
  ok(r.body.emailed && omw?.to === 'dana@x.test' && omw.fromName === 'Cool Air ' + t && /Sam is on the way/.test(omw.subject + omw.text) && /10 A St/.test(omw.text), 'or emailed to Dana under the team’s name, with the address');
  ok(omw?.replyTo === joEmail, 'Sam’s email isn’t confirmed, so replies go to the owner');
  r = await jo('POST', `/visits/${v.id}/on-my-way`, { minutes: 10 });
  ok(mails('on-my-way')[1]?.replyTo === joEmail && /^Jo from Cool Air/.test(mails('on-my-way')[1].subject), 'when Jo is coming, it says Jo');
  const pv = (await jo('POST', `/records/${patJob.id}/visits`, { kind: 'Repair', date: tomorrow, start: 540, end: 600, memberIds: [samId] })).body;
  r = await jo('POST', `/visits/${pv.id}/on-my-way`, { minutes: 15 });
  ok(r.body.dne && !r.body.emailed && !r.body.sms && mails('on-my-way').length === 2, 'a customer marked do not contact gets nothing, not even a text to send');

  // Settings.
  ok((await sam('PATCH', '/workspace', { custMsgs: { reminders: true } })).status === 403, 'members can’t turn on customer messages');
  ok((await jo('PATCH', '/workspace', { custMsgs: { reviews: true } })).status === 400, 'review requests need a review link');
  ok((await jo('PATCH', '/workspace', { custMsgs: { reviewUrl: 'http://x.test/r' } })).status === 400, 'and it has to be https');
  await sleep(1000);
  ok(!mails('visit-reminder').length, 'reminders are off until someone turns them on');
  r = await jo('PATCH', '/workspace', { custMsgs: { reminders: true, reviews: true, reviewUrl: 'https://g.page/r/cool/review' } });
  ok(r.status === 200 && r.body.custMsgs.reminders && r.body.custMsgs.reviewUrl === 'https://g.page/r/cool/review', 'Jo turns on reminders and reviews, with the review link');

  // Reminders, the day before.
  const v2 = (await jo('POST', `/records/${job.id}/visits`, { kind: 'Install', date: tomorrow, start: 540, end: 720, memberIds: [samId] })).body;
  ok(await until(() => mails('visit-reminder').length === 1), 'a visit tomorrow: Dana gets a reminder');
  const rm = mails('visit-reminder')[0];
  ok(rm.to === 'dana@x.test' && /tomorrow/.test(rm.subject) && /between 9am and 12pm/.test(rm.text) && /install/.test(rm.text) && rm.replyTo === joEmail, 'it says when and what, and replies go to the owner: ' + rm.subject);
  await sleep(1000);
  ok(mails('visit-reminder').length === 1 && !mails('visit-reminder').some((x) => x.to === 'pat@x.test'), 'once, and not to Pat (do not contact)');
  await jo('PATCH', '/visits/' + v2.id, { start: 600, end: 660 });
  ok(await until(() => mails('visit-reminder').length === 2) && /at 10am/.test(mails('visit-reminder')[1].text), 'moved to 10am: another reminder with the new time');
  r = await sam('POST', `/visits/${v2.id}/remind`);
  ok(r.body.emailed && mails('visit-reminder').length === 3 && /Reply if you need to change it/.test(r.body.sms.body), 'a reminder can also be sent by hand, with a text to send too');
  const far = (await jo('POST', `/records/${job.id}/visits`, { kind: 'Service', date: dayIn(Date.now() + 5 * 864e5), start: 540, end: 600, memberIds: [samId] })).body;
  await sleep(900);
  ok(mails('visit-reminder').length === 3 && far.id, 'a visit days away waits');

  // A review request once the job's paid.
  await jo('PATCH', `/records/${job.id}`, { values: { [fid('status')]: choice('Done') } });
  await sleep(900);
  ok(!mails('review-request').length, 'done isn’t paid: no review request yet');
  await jo('PATCH', `/records/${job.id}`, { values: { [fid('status')]: choice('Paid') } });
  ok(await until(() => mails('review-request').length === 1), 'paid: Dana is asked for a review');
  const rv = mails('review-request')[0];
  ok(rv.to === 'dana@x.test' && rv.html.includes('https://g.page/r/cool/review') && /Leave a review/.test(rv.text), 'with the team’s review link');
  await jo('PATCH', `/records/${job.id}`, { values: { [fid('access')]: 'Gate 1234' } });
  await jo('PATCH', `/records/${job.id}`, { values: { [fid('status')]: choice('Done') } });
  await jo('PATCH', `/records/${job.id}`, { values: { [fid('status')]: choice('Paid') } });
  await sleep(900);
  ok(mails('review-request').length === 1, 'only once, even if it’s paid again');
  r = await sam('POST', `/records/${job.id}/review-request`);
  ok(r.body.emailed && mails('review-request').length === 2 && r.body.sms.body.includes('https://g.page/r/cool/review'), 'asking again by hand sends another, and a text with the link');
  const already = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Old one', customer: dana.id, status: choice('Paid') } })).body;
  await jo('PATCH', `/records/${already.id}`, { values: { [fid('access')]: 'x' } });
  await sleep(900);
  ok(mails('review-request').length === 2, 'a job that was made already paid doesn’t ask');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
