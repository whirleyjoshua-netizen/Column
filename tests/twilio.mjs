// Texting through the team's own Twilio account, against a stand-in Twilio: connecting (bad details refused, the
// number pointed at Kloomie), texting a contact, on my way and reminders texted, do not contact respected, replies
// signed by Twilio landing on the contact (unsigned ones refused, a new number becoming a lead, STOP and START),
// delivery status, the token kept sealed, and disconnecting.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { twilioSignature } from '../server/twilio.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/twilio';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4753, B = `http://127.0.0.1:${PORT}`, F_PORT = 4754, F = `http://127.0.0.1:${F_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };

const SID = 'AC' + 'a'.repeat(32), TOKEN = 'b'.repeat(32), NUM = '+17025550100';
const T = { number: { sid: 'PN1', phone_number: NUM, sms_url: '' }, sent: [] };
const fake = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const u = new URL(req.url, F);
  const out = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.headers.authorization !== 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64')) return out(401, { code: 20003, message: 'Authenticate' });
  const base = `/2010-04-01/Accounts/${SID}`;
  if (u.pathname === base + '.json') return out(200, { sid: SID, friendly_name: 'Cool Air LLC', type: 'Full' });
  if (u.pathname === base + '/IncomingPhoneNumbers.json') return out(200, { incoming_phone_numbers: u.searchParams.get('PhoneNumber') === NUM ? [T.number] : [] });
  if (u.pathname === base + '/IncomingPhoneNumbers/PN1.json') {
    if (req.method === 'POST') Object.assign(T.number, { sms_url: Object.fromEntries(new URLSearchParams(raw)).SmsUrl });
    return out(200, T.number);
  }
  if (u.pathname === base + '/Messages.json' && req.method === 'POST') {
    const f = Object.fromEntries(new URLSearchParams(raw));
    if (f.To === '+15555550199') return out(400, { code: 21211, message: "The 'To' number is not a valid phone number." });
    const m = { sid: 'SM' + (T.sent.length + 1), status: 'queued', ...f };
    T.sent.push(m);
    return out(201, m);
  }
  out(404, { message: 'nope' });
});
await new Promise((r) => fake.listen(F_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', TWILIO_API: F }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const go = async (b) => { const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const r = await go(body);
  // A message to a customer asks first (docs/jobflows/PHASE3B.md §1): here the person presses Send on the preview.
  return r.status === 428 && r.body?.confirm ? go({ ...(body || {}), confirm: r.body.confirm }) : r;
};
// A text from a customer, as Twilio would send it (signed, or not).
const inbound = async (path, params, sign = true) => {
  const body = new URLSearchParams(params).toString();
  const headers = { 'content-type': 'application/x-www-form-urlencoded', ...(sign ? { 'x-twilio-signature': twilioSignature(TOKEN, B + path, params) } : { 'x-twilio-signature': 'nope' }) };
  return fetch(B + path, { method: 'POST', headers, body });
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Txt ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Txt ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);

  ok((await sam('GET', '/texting')).status === 403, 'members can’t see the Twilio connection');
  ok((await jo('GET', '/texting')).body.connected === false, 'not connected to start with');
  ok((await jo('PUT', '/texting', { sid: 'nope', token: TOKEN, number: NUM })).status === 400, 'a malformed Account SID is refused');
  r = await jo('PUT', '/texting', { sid: SID, token: 'c'.repeat(32), number: NUM });
  ok(r.status === 400 && /didn’t accept/.test(r.body.error), 'a wrong auth token is refused');
  r = await jo('PUT', '/texting', { sid: SID, token: TOKEN, number: '702 555 0199' });
  ok(r.status === 400 && /isn’t a number in that Twilio account/.test(r.body.error), 'a number that isn’t theirs is refused');
  r = await jo('PUT', '/texting', { sid: SID, token: TOKEN, number: '(702) 555-0100' });
  ok(r.status === 200 && r.body.connected && r.body.number === NUM && r.body.account === 'Cool Air LLC', 'connected: texting from ' + r.body.number);
  ok(T.number.sms_url.startsWith(B + '/twilio/sms/'), 'the number’s incoming texts now come to Kloomie');
  const smsPath = new URL(T.number.sms_url).pathname;
  await sleep(600);
  ok(!fs.readFileSync(DIR + '/db.json', 'utf8').includes(TOKEN), 'the auth token is kept sealed');

  // Texting a contact.
  const dana = (await jo('POST', '/contacts', { name: 'Dana Ruiz', phone: '702-555-0142', email: 'dana@x.test' })).body;
  r = await jo('POST', `/contacts/${dana.id}/texts`, { body: 'Hi Dana, your blinds are in!' });
  ok(r.status === 200 && r.body.dir === 'out' && r.body.sid === 'SM1', 'a text to Dana goes out');
  ok(T.sent[0].To === '+17025550142' && T.sent[0].From === NUM && T.sent[0].StatusCallback?.startsWith(B + '/twilio/status/'), 'to her number in +1 form, from the team’s number, with delivery updates');
  ok((await sam('GET', `/contacts/${dana.id}/texts`)).status === 403, 'members don’t see contact texts');
  const bad = (await jo('POST', '/contacts', { name: 'Bad Number', phone: '555-555-0199' })).body;
  r = await jo('POST', `/contacts/${bad.id}/texts`, { body: 'hi' });
  ok(r.status === 502 && /Twilio didn’t send it/.test(r.body.error), 'Twilio refusing a text says why');
  const no = (await jo('POST', '/contacts', { name: 'No Thanks', phone: '702-555-0177', dne: true })).body;
  ok((await jo('POST', `/contacts/${no.id}/texts`, { body: 'hi' })).status === 400, 'nobody marked do not contact is texted');

  // Delivery status, signed by Twilio.
  const statusPath = new URL(T.sent[0].StatusCallback).pathname;
  ok((await inbound(statusPath, { MessageSid: 'SM1', MessageStatus: 'delivered' })).status === 200, 'Twilio’s delivery update is accepted');
  ok(await until(async () => (await jo('GET', `/contacts/${dana.id}/texts`)).body[0]?.status === 'delivered'), 'and the text shows as delivered');

  // On my way, from a job, goes by text.
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: dana.id, address: '10 A St' } })).body;
  const samId = (await jo('GET', '/state')).body.workspace.members.find((x) => x.name === 'Sam').id;
  const v = (await jo('POST', `/records/${job.id}/visits`, { date: '2026-12-02', start: 540, memberIds: [samId], kind: 'Service' })).body;
  r = await jo('POST', `/visits/${v.id}/on-my-way`, { minutes: 20, email: false });
  ok(r.status === 200 && r.body.texted && !r.body.sms && /on my way/.test(T.sent.at(-1).Body), 'On my way is texted from the team’s number (no phone app needed)');
  r = await jo('POST', `/visits/${v.id}/remind`);
  ok(r.body.texted && /reminder/.test(T.sent.at(-1).Body), 'a visit reminder is texted too');

  // Replies.
  ok((await inbound(smsPath, { MessageSid: 'SMin1', From: '+17025550142', To: NUM, Body: 'Great, see you then!' }, false)).status === 403, 'a reply without Twilio’s signature is refused');
  r = await inbound(smsPath, { MessageSid: 'SMin1', From: '+17025550142', To: NUM, Body: 'Great, see you then!' });
  ok(r.status === 200 && (await r.text()).includes('<Response>'), 'a signed reply is accepted');
  r = await jo('GET', `/contacts/${dana.id}/texts`);
  ok(r.body.at(-1)?.dir === 'in' && r.body.at(-1).body === 'Great, see you then!', 'and lands on Dana’s thread');
  await inbound(smsPath, { MessageSid: 'SMin1', From: '+17025550142', To: NUM, Body: 'Great, see you then!' });
  ok((await jo('GET', `/contacts/${dana.id}/texts`)).body.filter((x) => x.dir === 'in').length === 1, 'Twilio retrying the same message doesn’t double it');
  const notices = (await jo('GET', '/state')).body.notices || [];
  ok(notices.some((n) => n.title === 'Text from Dana Ruiz' && n.go === 'contact:' + dana.id), 'owners and admins are notified, and it opens her contact');
  await inbound(smsPath, { MessageSid: 'SMin2', From: '+17025550111', To: NUM, Body: 'Hi, do you install shutters?' });
  const lead = (await jo('GET', '/contacts')).body.contacts.find((x) => x.phone === '+17025550111');
  ok(lead && lead.source === 'Text message', 'a text from a new number becomes a new contact (a lead)');
  await inbound(smsPath, { MessageSid: 'SMin3', From: '+17025550111', To: NUM, Body: 'STOP' });
  ok((await jo('GET', '/contacts')).body.contacts.find((x) => x.id === lead.id)?.dne, 'STOP marks them do not contact');
  await inbound(smsPath, { MessageSid: 'SMin4', From: '+17025550111', To: NUM, Body: 'start' });
  ok(!(await jo('GET', '/contacts')).body.contacts.find((x) => x.id === lead.id)?.dne, 'START undoes it');

  // Disconnecting.
  r = await jo('DELETE', '/texting');
  ok(!r.body.connected && T.number.sms_url === '', 'disconnecting clears the number’s messaging address');
  r = await jo('POST', `/visits/${v.id}/on-my-way`, { minutes: 20, email: false });
  ok(!r.body.texted && r.body.sms?.phone, 'afterwards, texts go back to opening the phone’s Messages app');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log(srv.log.slice(-2000));
  srv.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
