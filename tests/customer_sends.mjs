// Job Flows Phase 3b §1–§2 (docs/jobflows/PHASE3B.md): nothing reaches a customer without an OK. Every send a person
// starts answers 428 with a preview and a one-time ticket, and sends only when called again with that ticket (bound to
// the team, the person, the route, the target and the exact message; single use; 10 minutes). Automatic steps send by
// themselves only when set to "Send by itself"; otherwise (and for every version from before this) they wait as a
// pending message with Send / Don't send for owners and admins. Every provider call is listed in docs/jobflows/SENDS.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import './cookiejar.mjs'; // connecting Gmail finishes in the browser that started it
const S = path.resolve(process.argv[2] || '.');
const DIR = S + '/dk/customer_sends';
const OUTBOX = DIR + '/outbox';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5256, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(150); } return false; };
const mails = (to, tag) => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().map((f) => JSON.parse(fs.readFileSync(OUTBOX + '/' + f, 'utf8'))) : []).filter((x) => (!to || x.to === to) && (!tag || x.tag === tag));
const hourIn = (tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const tz = ['Pacific/Kiritimati', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Pago_Pago'].find((z) => hourIn(z) >= 10 && hourIn(z) <= 21);
const dayIn = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
const TICKET_MS = 4000; // SEND_TICKET_MS: how long a ticket lasts here (10 minutes in production)

// A stand-in Twilio (as tests/twilio.mjs).
const F_PORT = 5259, F = `http://127.0.0.1:${F_PORT}`;
const SID = 'AC' + 'c'.repeat(32), TOKEN = 'd'.repeat(32), NUM = '+17025550199';
const TW = { number: { sid: 'PN1', phone_number: NUM, sms_url: '' }, sent: [] };
const fake = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const u = new URL(req.url, F);
  const out = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.headers.authorization !== 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64')) return out(401, { code: 20003, message: 'Authenticate' });
  const b = `/2010-04-01/Accounts/${SID}`;
  if (u.pathname === b + '.json') return out(200, { sid: SID, friendly_name: 'Texting Co', type: 'Full' });
  if (u.pathname === b + '/IncomingPhoneNumbers.json') return out(200, { incoming_phone_numbers: u.searchParams.get('PhoneNumber') === NUM ? [TW.number] : [] });
  if (u.pathname === b + '/IncomingPhoneNumbers/PN1.json') { if (req.method === 'POST') Object.assign(TW.number, { sms_url: Object.fromEntries(new URLSearchParams(raw)).SmsUrl }); return out(200, TW.number); }
  if (u.pathname === b + '/Messages.json' && req.method === 'POST') { const m = { sid: 'SM' + (TW.sent.length + 1), status: 'queued', ...Object.fromEntries(new URLSearchParams(raw)) }; TW.sent.push(m); return out(201, m); }
  out(404, { message: 'nope' });
});
await new Promise((r) => fake.listen(F_PORT, '127.0.0.1', r));
// A stand-in for Google (as tests/gmail.mjs), so a teammate can email a signing link from their own Gmail.
const G_PORT = 5260, gsent = [];
const gfake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const url = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/token') return res.end(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send' }));
  if (url.pathname === '/v1/userinfo') return res.end(JSON.stringify({ email: 'rico@gmail.com' }));
  if (url.pathname.endsWith('/calendarList')) return res.end(JSON.stringify({ items: [{ id: 'primary', summary: 'Rico', primary: true, accessRole: 'owner' }] }));
  if (url.pathname.endsWith('/events')) return res.end(JSON.stringify({ items: [] }));
  if (url.pathname === '/gmail/v1/users/me/messages/send') { gsent.push(Buffer.from(JSON.parse(body).raw, 'base64url').toString()); return res.end(JSON.stringify({ id: 'm' + gsent.length })); }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => gfake.listen(G_PORT, '127.0.0.1', r));
const texts = (digits) => TW.sent.filter((m) => String(m.To || '').replace(/\D/g, '').endsWith(digits));

const base = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test', CUSTMSG_TICK_MS: '300', REVIEW_DELAY_MS: '0', JOBFLOWS_DAY_MS: '2000', TWILIO_API: F, SEND_TICKET_MS: String(TICKET_MS), SEND_TICKET_KEEP_MS: '20000', SENDS_TEST_AGENT: '1', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', GOOGLE_API: `http://127.0.0.1:${G_PORT}` };
try { execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null`); await sleep(300); } catch {}
let srv;
const start = async (extra = { MAIL_OUTBOX: '1' }) => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...base, MAIL_OUTBOX: '', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.gone = new Promise((r) => srv.once('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return true; } catch {} await sleep(150); }
  return false;
};
const stop = async () => { if (srv.exitCode === null) srv.kill(); await srv.gone; await sleep(200); };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  return r ? { status: r.status, body: await r.json().catch(() => null) } : { status: 0, body: null };
};

// §1: every provider call is accounted for. SENDS.md lists, per server file, how many calls of each sender it has and
// how each is covered; a new call anywhere (or one gone) fails this until the list says which way it's covered. The
// categories are fixed: ticket (a person confirmed it), auto step (a Job Flow step set to "Send by itself"), team switch
// (a Customer messages switch an owner turned on, which says it sends by itself), approval (an agent's draft the person
// accepted, the Flows hold, the Mail tool's review), own action (a receipt for what the customer just did), internal
// (to the team, never a customer). It's a text count, not a parser: SENDS.md says so, and lists each route in §1.
{
  const SENDERS = ['mailer.customerEmail(', 'tellCustomer(', 'flowTell(', 'twilioText(', 'sendText(', '.sendMail(', 'SIGNOFF_MAIL(', 'emailCustomer(', 'emailSignLink(', 'agentEmail('];
  const CATS = ['ticket', 'auto step', 'team switch', 'approval', 'own action', 'internal'];
  const doc = fs.existsSync(S + '/docs/jobflows/SENDS.md') ? fs.readFileSync(S + '/docs/jobflows/SENDS.md', 'utf8') : '';
  ok(!!doc, 'docs/jobflows/SENDS.md lists every call that emails or texts a customer');
  const listed = {}, badCat = [];
  for (const m of doc.matchAll(/^\|\s*`server\/([\w.]+)`\s*\|\s*`([\w.]+\()`\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/gm)) {
    listed[`${m[1]} ${m[2]}`] = (listed[`${m[1]} ${m[2]}`] || 0) + Number(m[3]);
    for (const c of m[4].split(/\s*,\s*/)) if (!CATS.includes(c)) badCat.push(`${m[1]} ${m[2]}: ${c}`);
  }
  const found = {};
  const defn = (l, name) => new RegExp(`^\\s*(async\\s+)?(function\\s+)?${name.replace(/[.(]/g, (x) => '\\' + x)}[^)]*\\)\\s*\\{`).test(l) || new RegExp(`^\\s*(const|let)?\\s*${name.replace(/[.(]/g, '').replace(/^\./, '')}\\s*[:=]`).test(l);
  for (const f of fs.readdirSync(S + '/server').filter((x) => x.endsWith('.js'))) {
    const lines = fs.readFileSync(S + '/server/' + f, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l));
    for (const name of SENDERS) {
      const n = lines.filter((l) => !defn(l, name)).reduce((k, l) => k + l.split(name).length - 1, 0);
      if (n) found[`${f} ${name}`] = n;
    }
  }
  const diff = [...new Set([...Object.keys(found), ...Object.keys(listed)])].filter((k) => found[k] !== listed[k]).map((k) => `${k} code ${found[k] || 0}, listed ${listed[k] || 0}`);
  ok(Object.keys(found).length >= 8 && !diff.length, 'each provider call in the server is listed with how it’s covered: ' + diff.join('; '));
  ok(!badCat.length, 'only the fixed categories are used: ' + badCat.join('; '));
  const routes = ['POST /jobs/:id/quote/send', 'POST /visits/:id/on-my-way', 'POST /visits/:id/remind', 'POST /records/:id/review-request', 'POST /contacts/:id/texts', 'POST /signoff/:r/:f/send', 'POST /signoff/:r/:f/remind', 'POST /signs/:id/email', 'POST /profile/proofs'];
  ok(routes.every((x) => doc.includes(x)), 'SENDS.md names every route in §1: ' + routes.filter((x) => !doc.includes(x)).join(', '));
  ok(/not a parser|text count/i.test(doc), 'and says the check is a text count');
}

if (!(await start())) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Sends ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  let rico = call(ricoTok);
  const st = (await rico('GET', '/state')).body;
  const join = async (name, n) => (await call()('POST', '/auth', { mode: 'join', workspace: 'Sends ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token;
  const samTok = await join('Sam Reed', 2), adaTok = await join('Ada Moss', 3);
  let sam = call(samTok), ada = call(adaTok);
  await rico('PATCH', '/workspace', { tz, tools: { ...st.workspace.tools, projects: true, bills: true, contacts: true }, custMsgs: { reviewUrl: 'https://g.page/r/team' } });
  const mem = (await rico('GET', '/state')).body.workspace.members;
  const samId = mem.find((m) => m.name === 'Sam Reed').id, adaId = mem.find((m) => m.name === 'Ada Moss').id;
  ok((await rico('PATCH', `/members/${adaId}`, { role: 'admin' })).status === 200, '(setup) Ada is an admin');
  r = await rico('PUT', '/texting', { sid: SID, token: TOKEN, number: '(702) 555-0199' });
  ok(r.status === 200 && r.body?.connected, '(setup) the team connects Twilio: ' + (r.body?.error || ''));
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const tp = p.types[0];
  const list = { projectId: p.id, typeId: tp.id };
  const today = dayIn(Date.now()), tomorrow = dayIn(Date.now() + 864e5), later = dayIn(Date.now() + 5 * 864e5);
  let n = 0;
  const person = async (extra = {}) => { n++; const c = (await rico('POST', '/contacts', { name: `Cust${n} Ruiz`, email: `cust${n}.${t}@x.test`, address: `${n} A St`, ...extra })).body; return c.id ? c : c.contact; };
  const flowOf = async (name, body) => {
    const f = (await rico('POST', '/job-flows', { name, list, ...body })).body;
    const pub = await rico('POST', `/job-flows/${f?.id}/publish`);
    return { id: f?.id, status: pub.status, error: pub.body?.error || '', version: pub.body?.version, sid: (nm) => pub.body?.version?.body?.steps?.find((x) => x.name === nm)?.id };
  };
  const job = async (flowId, contact) => (await rico('POST', '/jobs', { flowId, ...(contact ? { contactId: contact.id } : {}), values: { job: 'J' + Math.random().toString(36).slice(2, 7) } })).body?.job;
  const runOf = async (id, who = rico) => (await who('GET', `/jobs/${id}/run`)).body?.run;
  const stepOf = async (id, name, who = rico) => (await runOf(id, who))?.steps?.find((s) => s.name === name);
  const visit = async (id, date) => (await rico('POST', `/records/${id}/visits`, { kind: 'Service', date, start: 600, end: 660, memberIds: [samId] })).body;
  const C = { kind: 'client', name: 'Client' }, BK = { kind: 'book', name: 'Book' }, DO = { kind: 'custom', name: 'Do it', settings: { text: 'Do it.' } };
  const FB = await flowOf('Plain', { steps: [C, BK, DO] });

  // ---------- §1, route by route: 428 + preview + nothing sent, then the ticket sends once ----------
  const dana = await person({ phone: '(702) 555-0101' });
  const jd = await job(FB.id, dana);
  const vd = await visit(jd?.id, tomorrow);
  const nothingTo = (c, digits) => !mails(c.email).length && !texts(digits).length;
  // Each route: [name, who, path, body, the email tag it sends, the customer, phone digits].
  const routes = [
    ['On my way', sam, `/visits/${vd?.id}/on-my-way`, { minutes: 20 }, 'on-my-way'],
    ['Remind the customer', rico, `/visits/${vd?.id}/remind`, {}, 'visit-reminder'],
    ['Ask for a review', rico, `/records/${jd?.id}/review-request`, {}, 'review-request'],
  ];
  for (const [name, who, pth, body, tag] of routes) {
    const before = mails(dana.email).length, tb = texts('5550101').length, tagBefore = mails(dana.email, tag).length;
    r = await who('POST', pth, body);
    ok(r.status === 428 && !!r.body?.confirm && !!r.body?.preview?.text && r.body.preview.to === dana.name && ['email', 'text', 'both'].includes(r.body.preview.via), `${name}: without confirm, 428 with a preview and a ticket: ` + JSON.stringify(r.body).slice(0, 200));
    await sleep(300);
    ok(mails(dana.email).length === before && texts('5550101').length === tb, `${name}: and nothing was sent`);
    const tk = r.body?.confirm;
    const shown = r.body?.preview?.text || '';
    r = await who('POST', pth, { ...body, confirm: tk });
    ok(r.status === 200, `${name}: with the ticket, it sends: ` + r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
    ok(mails(dana.email, tag).length === tagBefore + 1, `${name}: the email went, once`);
    const sentText = mails(dana.email, tag).at(-1)?.text || '';
    ok(!!shown && shown.split('\n').filter((l) => !/: https?:/.test(l)).every((l) => sentText.includes(l)), `${name}: what went is word for word what was shown (the arrival time included)`);
    const after = mails(dana.email).length, ta = texts('5550101').length;
    r = await who('POST', pth, { ...body, confirm: tk });
    ok(r.status === 409 && r.body?.sent === true, `${name}: the same ticket again: 409, it already went`);
    await sleep(200);
    ok(mails(dana.email).length === after && texts('5550101').length === ta, `${name}: and nothing is sent twice`);
  }
  // A member's preview shows no more than their screen: the customer's name (and the phone On my way already shows), never the email.
  r = await sam('POST', `/visits/${vd?.id}/on-my-way`, { minutes: 10 });
  ok(r.status === 428 && !JSON.stringify(r.body).includes(dana.email), 'a member’s preview never shows the customer’s email');
  r = await rico('POST', `/visits/${vd?.id}/on-my-way`, { minutes: 10 });
  ok(r.status === 428 && r.body?.preview?.email === dana.email, 'an owner’s preview shows where it goes');

  // Send the quote (Phase 3's quote step).
  const can = (await rico('POST', '/job-items', { name: 'Can clean', price: 2500 })).body?.item;
  const FQ = await flowOf('Quoted', { billing: 'quote', items: [{ itemId: can?.id, qty: 2 }], steps: [C, { kind: 'quote', name: 'Quote', settings: { email: true, send: 'auto' } }, { kind: 'invoice', name: 'Inv' }] });
  ok(FQ.status === 200, '(setup) a quote flow publishes: ' + FQ.error);
  const quinn = await person();
  const jq = await job(FQ.id, quinn);
  r = await rico('POST', `/jobs/${jq?.id}/quote/send`);
  ok(r.status === 428 && /quote/i.test(r.body?.preview?.subject || '') && r.body.preview.email === quinn.email, 'Send the quote: 428 with the subject and where it goes');
  await sleep(300);
  ok(!mails(quinn.email).length, 'nothing sent yet');
  r = await rico('POST', `/jobs/${jq?.id}/quote/send`, { confirm: r.body?.confirm });
  ok(r.status === 200 && mails(quinn.email, 'quote-sent').length === 1, 'with the ticket the quote is emailed once');

  // Text a contact: the words are in the request, so changed words need a new preview.
  const tess = await person({ phone: '(702) 555-0102' });
  r = await rico('POST', `/contacts/${tess.id}/texts`, { body: 'Hi Tess, see you at 9.' });
  ok(r.status === 428 && r.body?.preview?.text === 'Hi Tess, see you at 9.' && r.body.preview.via === 'text', 'Text a contact: 428 with the words');
  const tkT = r.body?.confirm;
  r = await rico('POST', `/contacts/${tess.id}/texts`, { body: 'Hi Tess, see you at 10.', confirm: tkT });
  ok(r.status === 409 && r.body?.preview?.text === 'Hi Tess, see you at 10.' && !!r.body.confirm && r.body.confirm !== tkT, 'different words than confirmed: 409 with a fresh preview');
  ok(!texts('5550102').length, 'and nothing went');
  r = await rico('POST', `/contacts/${tess.id}/texts`, { body: 'Hi Tess, see you at 10.', confirm: r.body?.confirm });
  ok(r.status === 200 && texts('5550102').length === 1, 'the confirmed words go, once');
  // The recipient changed after the preview.
  r = await rico('POST', `/contacts/${tess.id}/texts`, { body: 'One more thing.' });
  const tkR = r.body?.confirm;
  await rico('PATCH', `/contacts/${tess.id}`, { phone: '(702) 555-0103' });
  r = await rico('POST', `/contacts/${tess.id}/texts`, { body: 'One more thing.', confirm: tkR });
  ok(r.status === 409 && /555-?0103|5550103/.test(JSON.stringify(r.body?.preview || {})), 'the number changed since the preview: 409 with the new one');
  ok(!texts('5550103').length && texts('5550102').length === 1, 'nothing went to either number');

  // Sign-offs: send to sign and remind.
  const sigF = tp.fields.find((f) => f.key === 'signoff');
  if (sigF) {
    const sara = await person();
    const js = await job(FB.id, sara);
    r = await rico('POST', `/signoff/${js?.id}/${sigF.id}/send`, { email: sara.email, name: sara.name });
    ok(r.status === 428 && r.body?.preview?.email === sara.email, 'Send to sign: 428 with a preview');
    await sleep(200);
    ok(!mails(sara.email).length && !(await rico('GET', '/signs')).body?.some?.((x) => x.signer?.email === sara.email), 'nothing emailed and no request made yet');
    r = await rico('POST', `/signoff/${js?.id}/${sigF.id}/send`, { email: sara.email, name: sara.name, confirm: r.body?.confirm });
    ok(r.status === 200 && mails(sara.email, 'sign-request').length === 1, 'with the ticket: sent once');
    r = await rico('POST', `/signoff/${js?.id}/${sigF.id}/remind`);
    ok(r.status === 428 && !!r.body?.confirm, 'Remind to sign: 428 first');
    r = await rico('POST', `/signoff/${js?.id}/${sigF.id}/remind`, { confirm: r.body?.confirm });
    ok(r.status === 200 && mails(sara.email, 'sign-request').length === 2, 'then the reminder goes once');
  } else ok(false, '(setup) the trades list has a sign-off field');

  // ---------- §1, the ticket's rules ----------
  const ed = await person({ phone: '(702) 555-0104' });
  const je = await job(FB.id, ed);
  const ve = await visit(je?.id, later), ve2 = await visit(je?.id, dayIn(Date.now() + 6 * 864e5));
  r = await rico('POST', `/visits/${ve?.id}/remind`);
  const tkE = r.body?.confirm;
  ok((await rico('POST', `/visits/${ve2?.id}/remind`, { confirm: tkE })).status === 409, 'a ticket for another visit: 409');
  ok((await rico('POST', `/visits/${ve?.id}/on-my-way`, { minutes: 20, confirm: tkE })).status === 409, 'a ticket for another route: 409');
  ok((await ada('POST', `/visits/${ve?.id}/remind`, { confirm: tkE })).status === 409, 'someone else’s ticket: 409');
  await sleep(200);
  ok(!mails(ed.email).length && !texts('5550104').length, 'none of those sent anything');
  // Two at once: one sends.
  const both = await Promise.all([rico('POST', `/visits/${ve?.id}/remind`, { confirm: tkE }), rico('POST', `/visits/${ve?.id}/remind`, { confirm: tkE })]);
  ok(both.map((x) => x.status).sort().join() === '200,409', 'two confirmations at once: one sends, the other is told it already went: ' + both.map((x) => x.status));
  await sleep(300);
  ok(mails(ed.email, 'visit-reminder').length === 1, 'and the customer gets it once');
  // Expired.
  r = await rico('POST', `/visits/${ve2?.id}/remind`);
  const tkX = r.body?.confirm;
  await sleep(TICKET_MS + 300);
  r = await rico('POST', `/visits/${ve2?.id}/remind`, { confirm: tkX });
  ok(r.status === 409 && !!r.body?.preview && !!r.body.confirm && r.body.confirm !== tkX, 'an expired ticket: 409 with a fresh preview');
  ok(mails(ed.email, 'visit-reminder').length === 1, 'nothing sent with it');
  ok((await rico('POST', `/visits/${ve2?.id}/remind`, { confirm: 'made-up-ticket' })).status === 409, 'a made-up ticket: 409');
  const edT0 = texts('5550104').length; // the reminders above went by text too
  // Permission is checked again at confirm: Ada, an admin when she asked, a member when she confirms.
  r = await ada('POST', `/contacts/${ed.id}/texts`, { body: 'From Ada.' });
  ok(r.status === 428, 'an admin can preview a text');
  const tkA = r.body?.confirm;
  await rico('PATCH', `/members/${adaId}`, { role: 'member' });
  r = await ada('POST', `/contacts/${ed.id}/texts`, { body: 'From Ada.', confirm: tkA });
  ok(r.status === 403 && texts('5550104').length === edT0, 'demoted before confirming: refused, nothing sent: ' + r.status + ' ' + texts('5550104').length);
  await rico('PATCH', `/members/${adaId}`, { role: 'admin' });

  // An API key can't send without the two calls (and keys don't reach the app's send routes at all).
  const key = (await rico('POST', '/integrations/keys', { name: 'Zap' })).body?.token;
  r = await call(key)('POST', `/visits/${ve2?.id}/remind`);
  ok(r.status === 401 && mails(ed.email, 'visit-reminder').length === 1 && texts('5550104').length === edT0, 'an API key on a send route: 401, nothing sent (' + r.status + ')');
  r = await call(key)('POST', `/visits/${ve2?.id}/remind`, { confirm: tkE });
  ok(r.status === 401 && mails(ed.email, 'visit-reminder').length === 1, 'and a replayed ticket through a key: 401, nothing sent');
  // An agent (working as Rico, without his OK) gets the preview, and can't confirm it itself.
  r = await rico('POST', '/test/agent-call', { method: 'POST', path: `/api/visits/${ve2?.id}/remind`, body: {} });
  const agTk = r.body?.body?.confirm;
  ok(r.status === 200 && r.body?.status === 428, 'an agent calling a send route gets 428: ' + JSON.stringify(r.body).slice(0, 160));
  r = await rico('POST', '/test/agent-call', { method: 'POST', path: `/api/visits/${ve2?.id}/remind`, body: { confirm: agTk } });
  ok(r.body?.status === 403 || r.body?.status === 409, 'and confirming it itself is refused: ' + r.body?.status);
  r = await rico('POST', `/visits/${ve2?.id}/remind`, { confirm: agTk });
  ok(r.status === 409, 'nor can its ticket be used by the person (it was made for the agent’s call)');
  await sleep(200);
  ok(mails(ed.email, 'visit-reminder').length === 1, 'nothing sent by the agent');

  // An agent can't use a ticket a person was given either.
  r = await rico('POST', `/visits/${ve2?.id}/remind`);
  const humanTk = r.body?.confirm;
  r = await rico('POST', '/test/agent-call', { method: 'POST', path: `/api/visits/${ve2?.id}/remind`, body: { confirm: humanTk } });
  ok([403, 409].includes(r.body?.status) && mails(ed.email, 'visit-reminder').length === 1, 'an agent with the person’s ticket: refused, nothing sent (' + r.body?.status + ')');
  // Another team's person, with this team's ticket, on their own visit.
  const ot = (await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga Pine', email: `olga${t}@t.test`, password: 'longenough9', device: 'Mac', deviceId: 'd9' })).body?.token;
  const olga = call(ot);
  await olga('PATCH', '/workspace', { tools: { projects: true, contacts: true } });
  const op = (await olga('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const oc = (await olga('POST', '/contacts', { name: 'Otto Cust', email: `otto${t}@x.test` })).body;
  const orec = (await olga('POST', `/projects/${op?.id}/records`, { typeId: op?.types?.[0]?.id, values: { job: 'Other job', customer: oc?.id ?? oc?.contact?.id } })).body;
  const olgaId = (await olga('GET', '/state')).body?.workspace?.members?.[0]?.id;
  const ov = (await olga('POST', `/records/${orec?.id}/visits`, { kind: 'Service', date: later, start: 600, end: 660, memberIds: [olgaId] })).body;
  ok(!!ov?.id, '(setup) another team with a visit of its own: ' + JSON.stringify(ov).slice(0, 120));
  r = await rico('POST', `/visits/${ve2?.id}/remind`);
  r = await olga('POST', `/visits/${ov?.id}/remind`, { confirm: r.body?.confirm });
  ok(r.status === 409 && !mails(`otto${t}@x.test`).length, 'another team’s ticket: 409, nothing sent: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  // Tickets are kept in the data: one made before a restart still works after it (within its time).
  r = await rico('POST', `/contacts/${ed.id}/texts`, { body: 'Across a restart.' });
  const tkRs = r.body?.confirm;
  await stop();
  ok(await start(), '(setup) restarted');
  rico = call(ricoTok); sam = call(samTok); ada = call(adaTok);
  r = await rico('POST', `/contacts/${ed.id}/texts`, { body: 'Across a restart.', confirm: tkRs });
  ok(r.status === 200 && texts('5550104').length === edT0 + 1, 'a ticket made before a restart still sends once after it: ' + r.status + ' ' + texts('5550104').length);
  ok((await rico('POST', `/contacts/${ed.id}/texts`, { body: 'Across a restart.', confirm: tkRs })).status === 409 && texts('5550104').length === edT0 + 1, 'and stays used');
  // At most 200 open tickets a team: the oldest go first. Checked in a fresh team with no tickets, and every ticket's
  // presence read from the store in one call (not by using it), so neither expiry nor older tickets can stand in.
  const capTok = (await call()('POST', '/auth', { mode: 'create', workspace: 'Cap ' + t, name: 'Cara Cap', email: `cara${t}@t.test`, password: 'longenough8', device: 'Mac', deviceId: 'd8' })).body?.token;
  const cara = call(capTok);
  await cara('PATCH', '/workspace', { tz, tools: { projects: true, contacts: true } });
  const cp = (await cara('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const cc = (await cara('POST', '/contacts', { name: 'Cap Cust', email: `capcust${t}@x.test` })).body;
  const crec = (await cara('POST', `/projects/${cp?.id}/records`, { typeId: cp?.types?.[0]?.id, values: { job: 'Cap job', customer: cc?.id ?? cc?.contact?.id } })).body;
  const caraId = (await cara('GET', '/state')).body?.workspace?.members?.[0]?.id;
  const cv = (await cara('POST', `/records/${crec?.id}/visits`, { kind: 'Service', date: later, start: 600, end: 660, memberIds: [caraId] })).body;
  const keptAll = async (ids) => (await cara('POST', '/test/send-tickets', { ids })).body?.has || {};
  ok((await cara('GET', '/test/send-tickets')).body?.total === 0, '(setup) a fresh team with no tickets at all');
  const loopStart = Date.now();
  const tks = [];
  for (let i = 0; i <= 205; i++) tks.push((await cara('POST', `/visits/${cv?.id}/remind`)).body?.confirm);
  const loopMs = Date.now() - loopStart;
  ok(tks.every(Boolean) && new Set(tks).size === 206 && loopMs < 10_000, '(setup) 206 previews in ' + loopMs + ' ms, far inside the 20 s keeping time, so none were trimmed for age');
  let cnt = (await cara('GET', '/test/send-tickets')).body;
  ok(cnt?.open === 200 && cnt.total === 200, 'exactly 200 tickets kept for the team: ' + JSON.stringify(cnt));
  const has = await keptAll(tks);
  ok(tks.slice(0, 6).every((x) => has[x] === false) && tks.slice(6).every((x) => has[x] === true), 'the 6 oldest were dropped to make room, all 200 others are kept');
  ok((await cara('POST', `/visits/${cv?.id}/remind`, { confirm: tks[0] })).status === 409 && !mails(`capcust${t}@x.test`).length, 'the oldest can’t be used: 409, nothing sent');
  await sleep(20_500);
  await cara('POST', `/visits/${cv?.id}/remind`);
  cnt = (await cara('GET', '/test/send-tickets')).body;
  ok(cnt?.total === 1, 'tickets past their keeping time are trimmed (only the newest is left): ' + JSON.stringify(cnt));
  ok(!mails(`capcust${t}@x.test`).length && texts('5550104').length === edT0 + 1, 'none of those previews sent anything');
  // The signing link from the person's own Gmail (POST /signs/:id/email).
  const ob = DIR + '/outbox';
  const vcode = mails(`rico${t}@t.test`).map((m) => (m.subject || '') + ' ' + (m.text || '')).join(' ').match(/\d{3}[ -]?\d{3}/)?.[0];
  await rico('POST', '/account/verify', { code: vcode });
  const { url: gUrl } = (await rico('POST', '/calendars/connect', { provider: 'google', tz, mail: true })).body || {};
  if (gUrl) await fetch(`${B}/oauth/google/callback?code=c&state=${new URL(gUrl).searchParams.get('state')}`);
  ok((await rico('GET', '/mail')).body?.via === 'Gmail', '(setup) Rico connects Gmail');
  const pend = ((await rico('GET', '/signs')).body || []).find((x) => ['sent', 'viewed'].includes(x.status));
  r = await rico('POST', `/signs/${pend?.id}/email`);
  ok(r.status === 428 && !!r.body?.preview?.email && !gsent.length, 'Email the signing link from Gmail: 428 with a preview, nothing sent');
  const tkG = r.body?.confirm;
  r = await rico('POST', `/signs/${pend?.id}/email`, { confirm: tkG });
  ok(r.status === 200 && gsent.length === 1, 'with the ticket it goes from Gmail, once');
  ok((await rico('POST', `/signs/${pend?.id}/email`, { confirm: tkG })).status === 409 && gsent.length === 1, 'replayed: 409, not again');
  // Send proof makes a link and emails nobody: no ticket, nothing sent.
  const prof = (await rico('GET', '/profile')).body?.project, lt = prof?.types?.[0];
  const PF = (k) => lt?.fields.find((f) => f.key === k)?.id;
  await rico('POST', `/projects/${prof?.id}/records`, { typeId: lt?.id, values: { [PF('name')]: 'Contractor license', [PF('number')]: '0084512', [PF('expires')]: '2030-01-01' } });
  const before = mails().length;
  r = await rico('POST', '/profile/proofs', { all: true, days: 7, to: 'A GC' });
  ok(r.status === 200 && String(r.body?.url || '').includes('/proof/') && mails().length === before && gsent.length === 1, 'Send proof makes a link (200) and emails nobody: ' + r.status);
  // A receipt for the customer's own act (own action): the signed copy, once, only after they sign.
  if (sigF) {
    const ivy = await person();
    const jv = await job(FB.id, ivy);
    ok(!mails(ivy.email).length, 'no signed copy before they sign');
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    r = await rico('POST', `/signoff/${jv?.id}/${sigF.id}/sign`, { consent: true, name: ivy.name, email: ivy.email, sig: PNG });
    ok(r.status === 200, '(setup) the customer signs in person');
    ok(await until(async () => mails(ivy.email, 'signed-copy').length === 1) || gsent.some((m) => m.includes(ivy.email)), 'their signed copy is emailed once, with no ticket');
    const copies = () => mails(ivy.email, 'signed-copy').length + gsent.filter((m) => m.includes(ivy.email)).length;
    const once = copies();
    r = await rico('POST', `/signoff/${jv?.id}/${sigF.id}/sign`, { consent: true, name: ivy.name, email: ivy.email, sig: PNG });
    await sleep(500);
    ok(once === 1 && r.status === 409 && copies() === 1, 'signing again is refused and sends no second copy, by Kloomie or Gmail: ' + once + ' → ' + copies());
  }

  // ---------- §2, automatic steps ----------
  const FA = await flowOf('Ask first', { steps: [C, BK, { kind: 'remind', name: 'Remind' }, DO] }); // no setting: ask
  const FX = await flowOf('Explicit ask', { steps: [C, BK, { kind: 'remind', name: 'Remind', settings: { send: 'ask' } }, DO] });
  const FS = await flowOf('By itself', { steps: [C, BK, { kind: 'remind', name: 'Remind', settings: { send: 'auto' } }, DO] });
  ok(FA.status === 200 && FX.status === 200 && FS.status === 200, '(setup) three reminder flows publish: ' + [FA.error, FX.error, FS.error].join(' '));
  ok((await flowOf('Bad send', { steps: [C, BK, { kind: 'remind', name: 'Remind', settings: { send: 'sometimes' } }] })).status === 400, 'a send setting other than auto or ask is refused at publish');
  // Send by itself: as Phase 3.
  const al = await person();
  const ja = await job(FS.id, al);
  await visit(ja?.id, tomorrow);
  ok(await until(async () => mails(al.email, 'visit-reminder').length === 1), '"Send by itself": the reminder goes by itself');
  ok(await until(async () => (await stepOf(ja?.id, 'Remind'))?.state === 'done'), 'and the step is done');
  // Ask me first (no setting): a pending message, a notification, nothing sent.
  const bo = await person();
  const jb = await job(FA.id, bo);
  await visit(jb?.id, tomorrow);
  ok(await until(async () => !!(await stepOf(jb?.id, 'Remind'))?.pending), 'no setting (every version before this): the reminder waits for an OK');
  let s = await stepOf(jb?.id, 'Remind');
  ok(s?.pending?.kind === 'remind' && !!s?.pending?.key && s?.pending?.preview?.to === bo.name && !!s?.pending?.preview?.text && s?.state === 'current', 'the step shows the waiting message with its preview: ' + String(JSON.stringify(s?.pending)).slice(0, 200));
  await sleep(900);
  ok(!mails(bo.email).length, 'nothing is sent while it waits');
  const seen = async (who) => ((await who('GET', '/notices')).body || []).some((x) => /ready to send/i.test(x.title + ' ' + x.text) && (x.title + x.text).includes(bo.name));
  ok(await seen(rico) && await seen(ada), 'the owners and admins are told it’s ready to send');
  ok(!(await seen(sam)), 'members aren’t');
  ok(!(await stepOf(jb?.id, 'Remind', sam))?.pending?.preview, 'and members don’t see the waiting message');
  ok((await sam('POST', `/jobs/${jb?.id}/steps/${s?.id}/message`, { action: 'send', key: s?.pending?.key })).status === 403, 'a member can’t send it');
  ok((await sam('POST', `/jobs/${jb?.id}/steps/${s?.id}/message`, { action: 'skip', key: s?.pending?.key })).status === 403, 'or decline it');
  ok((await rico('POST', `/jobs/${jb?.id}/steps/${s?.id}/message`, { action: 'send', key: 'stale' })).status === 409, 'a stale key: 409');
  await sleep(200);
  ok(!mails(bo.email).length, 'and nothing went');
  r = await rico('POST', `/jobs/${jb?.id}/steps/${s?.id}/message`, { action: 'send', key: s?.pending?.key });
  ok(r.status === 200 && mails(bo.email, 'visit-reminder').length === 1, 'Send: it goes once');
  ok(await until(async () => (await stepOf(jb?.id, 'Remind'))?.state === 'done'), 'and the step is done');
  ok(!(await stepOf(jb?.id, 'Remind'))?.pending, 'the waiting message is cleared');
  ok((await rico('POST', `/jobs/${jb?.id}/steps/${s?.id}/message`, { action: 'send', key: s?.pending?.key })).status === 409, 'sending it again: 409');
  await sleep(600);
  ok(mails(bo.email, 'visit-reminder').length === 1, 'still once');
  // Explicit ask, then Don't send.
  const cy = await person();
  const jc = await job(FX.id, cy);
  await visit(jc?.id, tomorrow);
  ok(await until(async () => !!(await stepOf(jc?.id, 'Remind'))?.pending), '"Ask me first": waits too');
  s = await stepOf(jc?.id, 'Remind');
  r = await ada('POST', `/jobs/${jc?.id}/steps/${s?.id}/message`, { action: 'skip', key: s?.pending?.key });
  ok(r.status === 200, 'an admin presses Don’t send');
  s = await stepOf(jc?.id, 'Remind');
  ok(s?.state === 'skipped' && /not sent/i.test(s?.skipReason || '') && !s.pending, 'the step is skipped, "Not sent": ' + s.skipReason);
  ok((await runOf(jc?.id))?.current?.name === 'Do it', 'and the job moves on');
  await sleep(1000);
  ok(!mails(cy.email).length && !(await stepOf(jc?.id, 'Remind'))?.pending, 'never sent, and never asked again');
  ok(/not sent/i.test(JSON.stringify((await rico('GET', `/records/${jc?.id}/log`)).body)), 'on the timeline');
  // Too late while waiting: the visit day comes. Dropped, never sent late.
  const di = await person();
  const jdi = await job(FA.id, di);
  const vdi = await visit(jdi?.id, tomorrow);
  ok(await until(async () => !!(await stepOf(jdi?.id, 'Remind'))?.pending), '(setup) a reminder waiting');
  const keyDi = (await stepOf(jdi?.id, 'Remind'))?.pending?.key, sidDi = (await stepOf(jdi?.id, 'Remind'))?.id;
  await rico('PATCH', `/visits/${vdi?.id}`, { date: today });
  r = await rico('POST', `/jobs/${jdi?.id}/steps/${sidDi}/message`, { action: 'send', key: keyDi });
  ok(r.status === 409 || r.body?.outcome === 'dropped', 'Send after the visit day came: too late, checked at that moment: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  ok(await until(async () => { const x = await stepOf(jdi?.id, 'Remind'); return !x?.pending && x?.state === 'skipped'; }), 'the waiting message is dropped and the step skipped');
  ok(/today/i.test((await stepOf(jdi?.id, 'Remind'))?.skipReason || '') && !mails(di.email).length, 'saying the visit is today, nothing sent');

  // A blocked Send keeps the waiting message, with why; it can be sent again once fixed. Waiting messages survive a restart.
  const ev = await person({ phone: '' });
  const jev = await job(FA.id, ev);
  await visit(jev?.id, tomorrow);
  ok(await until(async () => !!(await stepOf(jev?.id, 'Remind'))?.pending), '(setup) a reminder waiting');
  const keyEv = (await stepOf(jev?.id, 'Remind'))?.pending?.key, sidEv = (await stepOf(jev?.id, 'Remind'))?.id;
  await stop();
  ok(await start({ MAIL_OUTBOX: '' }), '(setup) restarted with email off');
  rico = call(ricoTok); sam = call(samTok); ada = call(adaTok);
  s = await stepOf(jev?.id, 'Remind');
  ok(!!keyEv && s?.pending?.key === keyEv, 'the waiting message is still there after a restart');
  r = await rico('POST', `/jobs/${jev?.id}/steps/${sidEv}/message`, { action: 'send', key: keyEv });
  s = await stepOf(jev?.id, 'Remind');
  ok(!!s?.pending && !!s?.pending?.lastTry?.reason && s?.state === 'current', 'Send while email can’t go: blocked, the waiting message stays with why: ' + String(JSON.stringify(s?.pending?.lastTry)));
  await sleep(900);
  ok(!!(await stepOf(jev?.id, 'Remind'))?.pending && !mails(ev.email).length, 'and the scheduler never sends it by itself');
  await stop();
  ok(await start(), '(setup) restarted with email on');
  rico = call(ricoTok); sam = call(samTok); ada = call(adaTok);
  const keyEv2 = (await stepOf(jev?.id, 'Remind'))?.pending?.key;
  r = await rico('POST', `/jobs/${jev?.id}/steps/${sidEv}/message`, { action: 'send', key: keyEv2 });
  ok(r.status === 200 && mails(ev.email, 'visit-reminder').length === 1, 'Send again once fixed: it goes, once');
  ok(await until(async () => (await stepOf(jev?.id, 'Remind'))?.state === 'done'), 'and the step is done');

  // The same for a quote's follow-up and an automatic invoice's email: they wait when set to ask (or not set).
  const FF = await flowOf('Follow, ask', { billing: 'quote', items: [{ itemId: can?.id, qty: 1 }], steps: [C, { kind: 'quote', name: 'Quote', settings: { email: true, followUpDays: 1 } }, { kind: 'invoice', name: 'Inv' }] });
  ok(FF.status === 200, '(setup) a quote flow with a follow-up and no send setting: ' + FF.error);
  const fi = await person();
  const jf = await job(FF.id, fi);
  r = await rico('POST', `/jobs/${jf?.id}/quote/send`);
  await rico('POST', `/jobs/${jf?.id}/quote/send`, { confirm: r.body?.confirm });
  ok(mails(fi.email, 'quote-sent').length === 1, '(setup) the quote went (a person confirmed it)');
  ok(await until(async () => !!(await stepOf(jf?.id, 'Quote'))?.pending, 9000), 'the follow-up, due, waits for an OK instead of going');
  s = await stepOf(jf?.id, 'Quote');
  ok(s?.pending?.kind === 'quoteFollow' && !mails(fi.email, 'quote-follow-up').length, 'nothing sent: ' + s?.pending?.kind);
  r = await rico('POST', `/jobs/${jf?.id}/steps/${s?.id}/message`, { action: 'skip', key: s?.pending?.key });
  ok(r.status === 200, 'Don’t send');
  await sleep(2500);
  ok(!mails(fi.email, 'quote-follow-up').length && !(await stepOf(jf?.id, 'Quote'))?.pending, 'declined: never sent, never asked again for that link');

  // A version with no send setting stays without one (it isn't filled in as "ask" or "auto" at publish): read as ask
  // at the moment it's due, as every version published before Phase 3b is.
  ok(FA.version && FA.version.body.steps.find((x) => x.kind === 'remind')?.settings?.send === undefined, 'a version with no send setting is kept without one (as older versions are)');

  // The waiting message's words changed before Send (the visit moved to the afternoon): 409 with the new preview and a new key.
  const gus = await person();
  const jg = await job(FA.id, gus);
  const vg = await visit(jg?.id, tomorrow);
  ok(await until(async () => !!(await stepOf(jg?.id, 'Remind'))?.pending), '(setup) a reminder waiting');
  s = await stepOf(jg?.id, 'Remind');
  const oldKey = s?.pending?.key, oldText = s?.pending?.preview?.text;
  await rico('PATCH', `/visits/${vg?.id}`, { start: 900, end: 960 });
  r = await rico('POST', `/jobs/${jg?.id}/steps/${s?.id}/message`, { action: 'send', key: oldKey });
  s = await stepOf(jg?.id, 'Remind');
  ok(r.status === 409 && !!s?.pending?.key && s.pending.key !== oldKey && s.pending.preview?.text !== oldText, 'the words changed since it was shown: 409, a new preview and key');
  ok(!mails(gus.email).length, 'nothing sent');
  r = await rico('POST', `/jobs/${jg?.id}/steps/${s?.id}/message`, { action: 'send', key: s?.pending?.key });
  ok(r.status === 200 && mails(gus.email, 'visit-reminder').length === 1 && /3:00|3 ?pm|15:00/i.test(JSON.stringify(mails(gus.email, 'visit-reminder')[0])), 'Send with the new key sends the new words');

  // Unsure (the provider threw): counted as done, "may not have gone", the waiting message cleared, never sent again.
  const hal = await person();
  const jh = await job(FA.id, hal);
  await visit(jh?.id, tomorrow);
  ok(await until(async () => !!(await stepOf(jh?.id, 'Remind'))?.pending), '(setup) a reminder waiting');
  const pk = (await stepOf(jh?.id, 'Remind'))?.pending?.key, psid = (await stepOf(jh?.id, 'Remind'))?.id;
  await stop();
  ok(await start({ MAIL_OUTBOX: '1', JOBFLOWS_MAIL_THROW: '1' }), '(setup) restarted with the provider throwing');
  rico = call(ricoTok);
  await rico('POST', `/jobs/${jh?.id}/steps/${psid}/message`, { action: 'send', key: pk });
  s = await stepOf(jh?.id, 'Remind');
  ok(s?.state === 'done' && s.sent?.unsure === true && !s.pending, 'Send that may have gone: done, unsure, the waiting message cleared: ' + JSON.stringify({ state: s?.state, sent: s?.sent }));
  await stop();
  ok(await start(), '(setup) restarted, the provider working');
  rico = call(ricoTok); sam = call(samTok); ada = call(adaTok);
  await sleep(1000);
  ok(!mails(hal.email).length && !(await stepOf(jh?.id, 'Remind'))?.pending, 'never sent again, never asked again');

  // The automatic invoice's email and payment reminders: ask first unless set to send by itself.
  const FI = await flowOf('Billed, ask', { billing: 'auto', items: [{ itemId: can?.id, qty: 1 }], steps: [C, DO, { kind: 'invoice', name: 'Inv', settings: { email: true } }, { kind: 'payment', name: 'Pay', settings: { reminders: [1, 3] } }] });
  const FIA = await flowOf('Billed, auto', { billing: 'auto', items: [{ itemId: can?.id, qty: 1 }], steps: [C, DO, { kind: 'invoice', name: 'Inv', settings: { email: true, send: 'auto' } }, { kind: 'payment', name: 'Pay', settings: { reminders: [1], send: 'auto' } }] });
  ok(FI.status === 200 && FIA.status === 200, '(setup) auto-billing flows, asking and sending by themselves: ' + FI.error + FIA.error);
  const invsOf = async (id) => { const b = (await rico('GET', `/records/${id}/invoices`)).body; return Array.isArray(b) ? b : []; };
  const daysAgo = (k) => dayIn(Date.now() - k * 864e5);
  const ian = await person();
  const ji = await job(FIA.id, ian);
  await rico('POST', `/jobs/${ji?.id}/steps/${FIA.sid('Do it')}/done`);
  ok(await until(async () => mails(ian.email, 'invoice').length === 1), '"Send by itself": the invoice is emailed by itself');
  await rico('PATCH', `/invoices/${(await invsOf(ji?.id))[0]?.id}`, { due: daysAgo(1) });
  ok(await until(async () => mails(ian.email, 'payment-reminder').length === 1), 'and its payment reminder too');
  const jo = await person();
  const jj = await job(FI.id, jo);
  await rico('POST', `/jobs/${jj?.id}/steps/${FI.sid('Do it')}/done`);
  ok(await until(async () => (await stepOf(jj?.id, 'Inv'))?.pending?.kind === 'invoice'), 'no setting: the invoice is made and sent (a link), its email waits for an OK');
  await sleep(700);
  ok(!mails(jo.email, 'invoice').length, 'not emailed while it waits');
  let inv = (await invsOf(jj?.id))[0];
  await rico('PATCH', `/invoices/${inv?.id}`, { due: daysAgo(1) });
  ok(await until(async () => (await stepOf(jj?.id, 'Pay'))?.pending?.kind === 'payReminder'), 'its first payment reminder waits too: two waiting messages, on two steps, side by side');
  ok((await stepOf(jj?.id, 'Inv'))?.pending?.kind === 'invoice', 'the invoice’s email is still waiting (one doesn’t replace the other)');
  ok((await stepOf(jj?.id, 'Pay'))?.pending?.day === 1, 'the 1-day reminder is the one waiting');
  await rico('PATCH', `/invoices/${inv?.id}`, { due: daysAgo(3) });
  await sleep(900);
  const payKey = (await stepOf(jj?.id, 'Pay'))?.pending?.key;
  ok((await stepOf(jj?.id, 'Pay'))?.pending?.day === 1, 'the 3-day reminder comes due while the 1-day one waits: it waits its turn, the waiting one isn’t replaced: ' + JSON.stringify((await stepOf(jj?.id, 'Pay'))?.pending || null).slice(0, 160));
  r = await rico('POST', `/jobs/${jj?.id}/steps/${(await stepOf(jj?.id, 'Inv'))?.id}/message`, { action: 'send', key: (await stepOf(jj?.id, 'Inv'))?.pending?.key });
  ok(r.status === 200 && mails(jo.email, 'invoice').length === 1, 'Send the invoice’s email: it goes once');
  r = await rico('POST', `/jobs/${jj?.id}/steps/${(await stepOf(jj?.id, 'Pay'))?.id}/message`, { action: 'skip', key: payKey });
  ok(r.status === 200, 'Don’t send the 1-day reminder');
  ok(await until(async () => (await stepOf(jj?.id, 'Pay'))?.pending?.day === 3), 'then the 3-day one asks');
  await sleep(600);
  ok(!mails(jo.email, 'payment-reminder').length, 'nothing sent for either yet');
  // Too late: the invoice is paid while a reminder waits.
  await rico('POST', `/invoices/${inv?.id}/payments`, { amount: '25', method: 'cash' });
  ok(await until(async () => !(await stepOf(jj?.id, 'Pay'))?.pending), 'paid in full: the waiting reminder is dropped');
  await sleep(600);
  ok(!mails(jo.email, 'payment-reminder').length && /not sent/i.test(JSON.stringify((await rico('GET', `/records/${jj?.id}/log`)).body)), 'never sent, and the timeline says why');
  // Too late: the invoice is voided while its email waits.
  const kay = await person();
  const jk = await job(FI.id, kay);
  await rico('POST', `/jobs/${jk?.id}/steps/${FI.sid('Do it')}/done`);
  ok(await until(async () => (await stepOf(jk?.id, 'Inv'))?.pending?.kind === 'invoice'), '(setup) an invoice email waiting');
  const kInv = (await invsOf(jk?.id))[0];
  const kKey = (await stepOf(jk?.id, 'Inv'))?.pending?.key;
  await rico('POST', `/invoices/${kInv?.id}/void`);
  r = await rico('POST', `/jobs/${jk?.id}/steps/${(await stepOf(jk?.id, 'Inv'))?.id}/message`, { action: 'send', key: kKey });
  ok(r.status === 409 && !mails(kay.email).some((m) => m.tag === 'invoice' && JSON.stringify(m).includes(kInv?.number)), 'the voided invoice’s email: too late, never sent');
  // A flow that ends at its Invoice step finishes once the invoice is sent: its email still asks, and can still go.
  const FE = await flowOf('Ends at invoice', { billing: 'auto', items: [{ itemId: can?.id, qty: 1 }], steps: [C, DO, { kind: 'invoice', name: 'Inv', settings: { email: true } }] });
  const nia = await person();
  const jn = await job(FE.id, nia);
  await rico('POST', `/jobs/${jn?.id}/steps/${FE.sid('Do it')}/done`);
  ok(await until(async () => (await runOf(jn?.id))?.status === 'done' && (await stepOf(jn?.id, 'Inv'))?.pending?.kind === 'invoice'), 'a flow ending at its Invoice step finishes, and the invoice’s email still waits for an OK (it belongs to the invoice)');
  r = await rico('POST', `/jobs/${jn?.id}/steps/${(await stepOf(jn?.id, 'Inv'))?.id}/message`, { action: 'send', key: (await stepOf(jn?.id, 'Inv'))?.pending?.key });
  ok(r.status === 200 && mails(nia.email, 'invoice').length === 1, 'and Send emails it after the run finished');
  // Everything else waiting is dropped when the run finishes: a follow-up waiting when the job is taken off the flow.
  // The invoice's email waiting when its step is skipped: dropped, and Send refuses it.
  const oli = await person();
  const jo2 = await job(FI.id, oli);
  await rico('POST', `/jobs/${jo2?.id}/steps/${FI.sid('Do it')}/done`);
  ok(await until(async () => (await stepOf(jo2?.id, 'Inv'))?.pending?.kind === 'invoice'), '(setup) an invoice email waiting');
  const oKey = (await stepOf(jo2?.id, 'Inv'))?.pending?.key, oSid = (await stepOf(jo2?.id, 'Inv'))?.id;
  await rico('POST', `/jobs/${jo2?.id}/steps/${oSid}/skip`, { reason: 'Billed another way' });
  r = await rico('POST', `/jobs/${jo2?.id}/steps/${oSid}/message`, { action: 'send', key: oKey });
  ok(r.status === 409 && !mails(oli.email, 'invoice').length, 'the Invoice step skipped while its email waits: Send refuses it, nothing goes');
  ok(await until(async () => !(await stepOf(jo2?.id, 'Inv'))?.pending), 'and the waiting email is dropped');
  // The job taken off its flow while an invoice email waits: Send right away (before the scheduler's next look) sends
  // nothing, and the waiting email is dropped.
  const qia = await person();
  const jq2 = await job(FI.id, qia);
  await rico('POST', `/jobs/${jq2?.id}/steps/${FI.sid('Do it')}/done`);
  ok(await until(async () => (await stepOf(jq2?.id, 'Inv'))?.pending?.kind === 'invoice'), '(setup) an invoice email waiting');
  const qKey = (await stepOf(jq2?.id, 'Inv'))?.pending?.key, qSid = (await stepOf(jq2?.id, 'Inv'))?.id;
  const [, sentNow] = await Promise.all([rico('POST', `/jobs/${jq2?.id}/flow/cancel`, { reason: 'Handled outside the flow' }), (async () => { await sleep(20); return rico('POST', `/jobs/${jq2?.id}/steps/${qSid}/message`, { action: 'send', key: qKey }); })()]);
  await sleep(1200);
  ok(sentNow.status !== 200 && !mails(qia.email, 'invoice').length, 'cancelled while its invoice email waits: Send right after sends nothing (' + sentNow.status + ')');
  ok(!(await rico('GET', `/jobs/${jq2?.id}/run`)).body?.run?.steps?.find((x) => x.name === 'Inv')?.pending, 'and nothing is left waiting');
  // A payment reminder waiting when the run finishes another way (taken off its flow): dropped, never sendable.
  const pia = await person();
  const jp2 = await job(FI.id, pia);
  await rico('POST', `/jobs/${jp2?.id}/steps/${FI.sid('Do it')}/done`);
  await until(async () => (await invsOf(jp2?.id))[0]?.status === 'sent');
  await rico('POST', `/jobs/${jp2?.id}/steps/${(await stepOf(jp2?.id, 'Inv'))?.id}/message`, { action: 'skip', key: (await stepOf(jp2?.id, 'Inv'))?.pending?.key });
  await rico('PATCH', `/invoices/${(await invsOf(jp2?.id))[0]?.id}`, { due: daysAgo(1) });
  ok(await until(async () => (await stepOf(jp2?.id, 'Pay'))?.pending?.kind === 'payReminder'), '(setup) a payment reminder waiting');
  const pKey = (await stepOf(jp2?.id, 'Pay'))?.pending?.key, pSid = (await stepOf(jp2?.id, 'Pay'))?.id;
  await rico('POST', `/jobs/${jp2?.id}/flow/cancel`, { reason: 'Handled outside the flow' });
  r = await rico('POST', `/jobs/${jp2?.id}/steps/${pSid}/message`, { action: 'send', key: pKey });
  await sleep(800);
  ok(r.status !== 200 && !mails(pia.email, 'payment-reminder').length, 'the job taken off its flow while a reminder waits: never sent (' + r.status + ')');

  // Too late: the quote is answered while its follow-up waits.
  const lou = await person();
  const jl = await job(FF.id, lou);
  r = await rico('POST', `/jobs/${jl?.id}/quote/send`);
  r = await rico('POST', `/jobs/${jl?.id}/quote/send`, { confirm: r.body?.confirm });
  const ltok = String(r.body?.url || '').split('/q/')[1];
  ok(await until(async () => (await stepOf(jl?.id, 'Quote'))?.pending?.kind === 'quoteFollow', 9000), '(setup) a follow-up waiting');
  const lv = (await (await fetch(`${B}/q/${ltok}`)).text()).match(/name="v" value="([^"]+)"/)?.[1] || '';
  const acc = await fetch(`${B}/q/${ltok}/accept`, { method: 'POST', body: new URLSearchParams({ name: lou.name, v: lv }), redirect: 'manual' });
  ok(acc.status === 303 && (await stepOf(jl?.id, 'Quote'))?.quote?.status === 'accepted', 'the customer accepts (303, recorded as accepted)');
  ok(await until(async () => !(await stepOf(jl?.id, 'Quote'))?.pending), 'the waiting follow-up is dropped');
  ok(!mails(lou.email, 'quote-follow-up').length, 'never sent');

  // The team's own switches (Settings → Customer messages) say they send by themselves: turning one on is that choice.
  await rico('PATCH', '/workspace', { custMsgs: { reminders: true, reviews: false, reviewUrl: 'https://g.page/r/team' } });
  const mo = await person();
  const jm = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Plain job', customer: mo.id } })).body;
  await rico('POST', `/records/${jm?.id}/visits`, { kind: 'Service', date: tomorrow, start: 600, end: 660, memberIds: [samId] });
  ok(await until(async () => mails(mo.email, 'visit-reminder').length === 1), 'a team switch the owner turned on (“Visit reminders: email customers the day before”) sends by itself, as it says');
  await rico('PATCH', '/workspace', { custMsgs: { reminders: true, reviews: true, reviewUrl: 'https://g.page/r/team' } });
  const stF = tp.fields.find((f) => f.key === 'status');
  await rico('PATCH', `/records/${jm?.id}`, { values: { [stF?.id]: stF?.choices.find((x) => x.label === 'Paid')?.id } });
  ok(await until(async () => mails(mo.email, 'review-request').length === 1), 'and the review switch: the job moves to Paid, the review request goes by itself');
} catch (e) {
  console.log('FAIL threw: ' + (e.stack || e.message));
  fails++;
} finally {
  if (srv.exitCode === null) srv.kill();
  fake.close();
  gfake.close();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
