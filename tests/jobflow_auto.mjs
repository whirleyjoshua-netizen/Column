// Job Flows Phase 3 (docs/jobflows/PHASE3.md): steps that run by themselves. Visit reminder, On my way and Review
// request steps; Send the quote by email and its follow-up; the automatic invoice emailed; payment reminders. Each
// message goes once: a send blocked before the provider waits and retries, one that may have gone (the provider threw,
// or the server died mid-send) is "unsure" and never sent again. A customer who can't be reached is skipped by Kloomie
// and the job moves on. Jobs that were ever on a flow get none of the team-wide reminders or review requests.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflow_auto';
const OUTBOX = DIR + '/outbox';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5253, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(150); } return false; };
const mails = (to, tag) => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().map((f) => JSON.parse(fs.readFileSync(OUTBOX + '/' + f, 'utf8'))) : []).filter((x) => (!to || x.to === to) && (!tag || x.tag === tag));
// A time zone where it's past 9am and not late, so "tomorrow" and the 9am rule are steady.
const hourIn = (tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const tz = ['Pacific/Kiritimati', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Pago_Pago'].find((z) => hourIn(z) >= 10 && hourIn(z) <= 21);
const dayIn = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
const DAY = 2000; // JOBFLOWS_DAY_MS: a "day" for follow-ups and review delays
// A stand-in Twilio (as tests/twilio.mjs), for the team that texts.
const F_PORT = 5254, F = `http://127.0.0.1:${F_PORT}`;
const SID = 'AC' + 'a'.repeat(32), TOKEN = 'b'.repeat(32), NUM = '+17025550100';
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
const base = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test', CUSTMSG_TICK_MS: '300', REVIEW_DELAY_MS: '0', JOBFLOWS_DAY_MS: String(DAY), JOBFLOWS_TEST_DROP_RUN: '1', TWILIO_API: F };
// A server left on this test's port by an earlier run would answer instead: stop it first.
try { (await import('node:child_process')).execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null`); await sleep(300); } catch {}
let srv;
const start = async (extra = { MAIL_OUTBOX: '1' }) => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...base, MAIL_OUTBOX: '', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.gone = new Promise((r) => srv.once('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return true; } catch {} await sleep(150); }
  return false;
};
const stop = async () => { if (srv.exitCode === null) srv.kill(); await srv.gone; await sleep(200); };
if (!(await start())) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const go = async (b) => { const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).catch(() => null); return r ? { status: r.status, body: await r.json().catch(() => null) } : { status: 0, body: null }; };
  const r = await go(body);
  // A message a person sends asks first (PHASE3B.md §1): here they press Send on the preview.
  return r.status === 428 && r.body?.confirm ? go({ ...(body || {}), confirm: r.body.confirm }) : r;
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Auto ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  let rico = call(ricoTok);
  const st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Auto ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samTok = r.body.token;
  let sam = call(samTok);
  await rico('PATCH', '/workspace', { tz, tools: { ...st.workspace.tools, projects: true, bills: true } });
  const samId = (await rico('GET', '/state')).body.workspace.members.find((m) => m.name === 'Sam Reed').id;
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const tp = p.types[0];
  const list = { projectId: p.id, typeId: tp.id };
  const today = dayIn(Date.now()), tomorrow = dayIn(Date.now() + 864e5);
  const daysAgo = (n) => dayIn(Date.now() - n * 864e5);
  let n = 0;
  const person = async (extra = {}) => { n++; const c = (await rico('POST', '/contacts', { name: `Cust${n} Ruiz`, email: `cust${n}.${t}@x.test`, address: `${n} A St`, ...extra })).body; return c.id ? c : c.contact; };
  const flowOf = async (name, body) => {
    // Phase 3's steps send by themselves; since Phase 3b that's said on each (PHASE3B.md §2: left out means ask).
    const auto = (st) => (['remind', 'review', 'quote', 'invoice', 'payment'].includes(st.kind) ? { ...st, settings: { send: 'auto', ...(st.settings || {}) } } : st);
    const made = await rico('POST', '/job-flows', { name, list, ...body, ...(body.steps ? { steps: body.steps.map(auto) } : {}) });
    const f = made.body;
    const pub = await rico('POST', `/job-flows/${f?.id}/publish`);
    return { id: f?.id, status: pub.status, error: (made.status !== 200 ? `(save ${made.status}: ${f?.error}) ` : '') + (pub.body?.error || ''), sid: (nm) => pub.body?.version?.body?.steps?.find((s) => s.name === nm)?.id };
  };
  const job = async (flowId, contact, who = rico) => (await who('POST', '/jobs', { flowId, ...(contact ? { contactId: contact.id } : {}), values: { job: 'J' + Math.random().toString(36).slice(2, 7) } })).body?.job;
  const runOf = async (id, who = rico) => (await who('GET', `/jobs/${id}/run`)).body?.run;
  const stepOf = async (id, name, who = rico) => (await runOf(id, who))?.steps?.find((s) => s.name === name);
  const visit = (id, date) => rico('POST', `/records/${id}/visits`, { kind: 'Service', date, start: 600, end: 660, memberIds: [samId] });
  const C = { kind: 'client', name: 'Client' }, BK = { kind: 'book', name: 'Book' }, DO = { kind: 'custom', name: 'Do it', settings: { text: 'Do it.' } };

  // 1. Publish rules (§1, §2, §5).
  for (const [why, steps] of [
    ['a review link that isn’t https', [C, { kind: 'review', name: 'Review', settings: { url: 'http://g.page/x' } }]],
    ['a review delay over 168 hours', [C, { kind: 'review', name: 'Review', settings: { delayHours: 169 } }]],
    ['a payment reminder of 0 days', [C, { kind: 'invoice', name: 'Inv' }, { kind: 'payment', name: 'Pay', settings: { reminders: [0] } }]],
    ['payment reminders not ascending', [C, { kind: 'invoice', name: 'Inv' }, { kind: 'payment', name: 'Pay', settings: { reminders: [5, 3] } }]],
    ['four payment reminders', [C, { kind: 'invoice', name: 'Inv' }, { kind: 'payment', name: 'Pay', settings: { reminders: [1, 2, 3, 4] } }]],
    ['a payment reminder over 60 days', [C, { kind: 'invoice', name: 'Inv' }, { kind: 'payment', name: 'Pay', settings: { reminders: [61] } }]],
  ]) ok((await flowOf('Bad ' + why, { steps })).status === 400, 'refused at publish: ' + why);
  const can = (await rico('POST', '/job-items', { name: 'Can clean', price: 2500 })).body?.item;
  ok((await flowOf('Bad follow-up', { billing: 'quote', items: [{ itemId: can?.id, qty: 1 }], steps: [C, { kind: 'quote', name: 'Q', settings: { followUpDays: 31 } }, { kind: 'invoice', name: 'Inv' }] })).status === 400, 'refused at publish: a quote follow-up over 30 days');
  const FR = await flowOf('Reminded', { steps: [C, BK, { kind: 'remind', name: 'Remind' }, DO] });
  ok(FR.status === 200, 'a flow with a Visit reminder publishes: ' + FR.error);

  // 2. Visit reminder (§1, §3).
  const dana = await person();
  const jr = await job(FR.id, dana);
  await sleep(700);
  ok(!mails(dana.email).length && (await stepOf(jr?.id, 'Book'))?.state === 'current', 'nothing is sent while the reminder isn’t the current step');
  await visit(jr?.id, tomorrow);
  ok(await until(async () => mails(dana.email, 'visit-reminder').length === 1), 'the visit booked for tomorrow: the reminder goes (it’s past 9am, team time)');
  ok(await until(async () => (await stepOf(jr?.id, 'Remind'))?.state === 'done'), 'and the step is done');
  let s = await stepOf(jr?.id, 'Remind');
  ok(s?.auto === true && !!s?.sent?.at && s.sentTo === 'email', 'it says it was sent, by email: ' + JSON.stringify({ auto: s?.auto, sent: s?.sent, sentTo: s?.sentTo }));
  await sleep(900);
  ok(mails(dana.email, 'visit-reminder').length === 1, 'and only once');
  ok(/visit reminder/i.test(JSON.stringify((await rico('GET', `/records/${jr?.id}/log`)).body)), 'on the job’s timeline');
  const ms = await stepOf(jr?.id, 'Remind', sam);
  ok(!!ms?.sent && ms.sentTo === undefined && !String(JSON.stringify(await runOf(jr?.id, sam))).includes(dana.email), 'a member sees it was sent, but not how or the customer’s email');
  // The visit is today: skipped by Kloomie.
  const eve = await person();
  const jt = await job(FR.id, eve);
  await visit(jt?.id, today);
  ok(await until(async () => (await stepOf(jt?.id, 'Remind'))?.state === 'skipped'), 'a visit today: the reminder is skipped');
  s = await stepOf(jt?.id, 'Remind');
  ok(s?.skippedBy === 'kloomie' && /today/i.test(s.skipReason || '') && !mails(eve.email).length && (await runOf(jt?.id))?.current?.name === 'Do it', 'by Kloomie, saying why, nothing sent, and the job moves on: ' + s?.skipReason);
  // Can't reach them.
  const phil = await person({ email: '', phone: '555-0177' });
  const jp = await job(FR.id, phil);
  await visit(jp?.id, tomorrow);
  ok(await until(async () => (await stepOf(jp?.id, 'Remind'))?.state === 'skipped'), 'a customer with a phone but no email, and no Twilio: skipped');
  ok(/no email or text number/i.test((await stepOf(jp?.id, 'Remind'))?.skipReason || ''), 'saying they have no email or text number (the phone’s Messages app never counts for an automatic message)');
  const pat = await person({ dne: true });
  const jd = await job(FR.id, pat);
  await visit(jd?.id, tomorrow);
  ok(await until(async () => /do not contact/i.test((await stepOf(jd?.id, 'Remind'))?.skipReason || '')) && !mails(pat.email).length, 'a customer marked do not contact: skipped, nothing sent');
  const F1 = await flowOf('Remind only', { steps: [{ kind: 'remind', name: 'Remind' }] });
  const jn = await job(F1.id, null);
  ok(await until(async () => /no client/i.test((await stepOf(jn?.id, 'Remind'))?.skipReason || '')), 'no client on the job: skipped');
  const jw = await job(F1.id, await person());
  await sleep(800);
  s = await stepOf(jw?.id, 'Remind');
  ok(s?.state === 'current' && /no visit booked/i.test(s.waiting || ''), 'no visit booked: it waits, saying so: ' + s?.waiting);

  // 3. Review request (§1, §3).
  const FV = await flowOf('Reviewed', { steps: [C, DO, { kind: 'review', name: 'Ask', settings: { delayHours: 12, url: 'https://g.page/r/ours' } }] });
  const vic = await person();
  const jv = await job(FV.id, vic);
  await sleep(700);
  ok(!mails(vic.email, 'review-request').length, 'not current yet: no review request');
  await rico('POST', `/jobs/${jv?.id}/steps/${FV.sid('Do it')}/done`);
  await sleep(300);
  ok(!mails(vic.email, 'review-request').length, 'just current: it waits its delay (counted from becoming current)');
  ok(await until(async () => mails(vic.email, 'review-request').length === 1, DAY * 2), 'after the delay the request goes');
  ok(String(JSON.stringify(mails(vic.email, 'review-request')[0])).includes('https://g.page/r/ours'), 'with the step’s own link');
  ok(await until(async () => (await stepOf(jv?.id, 'Ask'))?.state === 'done') && (await runOf(jv?.id))?.status === 'done', 'and the step and the run are done');
  const FV2 = await flowOf('Reviewed, no link', { steps: [C, { kind: 'review', name: 'Ask', settings: { delayHours: 0 } }] });
  const wil = await person();
  const jv2 = await job(FV2.id, wil);
  await sleep(800);
  s = await stepOf(jv2?.id, 'Ask');
  ok(s?.state === 'current' && /review link/i.test(s.waiting || '') && !mails(wil.email).length, 'no link on the step or the team: it waits for one: ' + s?.waiting);
  await rico('PATCH', '/workspace', { custMsgs: { reviewUrl: 'https://g.page/r/team' } });
  ok(await until(async () => String(JSON.stringify(mails(wil.email, 'review-request'))).includes('https://g.page/r/team')), 'the team’s link added: it goes with that one');

  // 4. On my way (§1).
  const FO = await flowOf('Coming', { steps: [C, BK, { kind: 'omw', name: 'On the way' }, DO] });
  const olga = await person();
  const pre = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Omw job', customer: olga.id } })).body;
  const pv = (await visit(pre.id, tomorrow)).body;
  await sam('POST', `/visits/${pv.id}/on-my-way`, { minutes: 20, email: false });
  await sleep(30);
  await rico('POST', `/jobs/${pre.id}/flow`, { flowId: FO.id });
  ok((await runOf(pre.id))?.current?.name === 'On the way', 'an On my way tapped before the run started doesn’t count');
  await sam('POST', `/visits/${pv.id}/on-my-way`, { minutes: 20, email: false });
  ok(await until(async () => (await runOf(pre.id))?.current?.name === 'Do it'), 'Sam taps On my way on the job’s visit: the step is done');

  // 5. Send the quote, and its follow-up (§2, §3.3).
  const FQ = await flowOf('Quoted', { billing: 'quote', items: [{ itemId: can?.id, qty: 2 }], steps: [C, { kind: 'quote', name: 'Quote', settings: { email: true, followUpDays: 1 } }, { kind: 'invoice', name: 'Inv' }] });
  ok(FQ.status === 200, '(setup) a quote flow with email and a 1-day follow-up: ' + FQ.error);
  const quin = await person();
  const jq = await job(FQ.id, quin);
  r = await rico('POST', `/jobs/${jq?.id}/quote/send`);
  ok(r.status === 200 && r.body?.told?.emailed === true && /\/q\//.test(r.body?.url || ''), 'Send the quote: the link, and the customer emailed: ' + JSON.stringify(r.body?.told));
  ok(mails(quin.email, 'quote-sent').length === 1 && String(JSON.stringify(mails(quin.email, 'quote-sent')[0])).includes(r.body?.url), 'the email has the link');
  const url1 = r.body?.url;
  r = await rico('POST', `/jobs/${jq?.id}/quote/send`);
  ok(r.body?.url === url1 && mails(quin.email, 'quote-sent').length === 1, 'Send again for the same link: the same link, no second email');
  ok((await sam('POST', `/jobs/${jq?.id}/quote/send`)).status === 403, 'a member can’t send it');
  const bea = await person();
  const jcc = await job(FQ.id, bea);
  const both = await Promise.all([rico('POST', `/jobs/${jcc?.id}/quote/send`), rico('POST', `/jobs/${jcc?.id}/quote/send`)]);
  await sleep(300);
  ok(both.every((x) => x.status === 200) && both[0].body?.url === both[1].body?.url && mails(bea.email, 'quote-sent').length === 1, 'two Send taps at once: one link, one email');
  ok(await until(async () => mails(quin.email, 'quote-follow-up').length === 1, DAY * 3), 'no answer after a day: one follow-up');
  await sleep(DAY * 1.5);
  ok(mails(quin.email, 'quote-follow-up').length === 1, 'only one per link');
  s = await stepOf(jq?.id, 'Quote');
  ok(!!s?.followUp?.sentAt && s.followUp.days === 1, 'the step says the follow-up went');
  await rico('POST', `/jobs/${jq?.id}/requote`);
  r = await rico('POST', `/jobs/${jq?.id}/quote/send`);
  ok(r.body?.url !== url1 && mails(quin.email, 'quote-sent').length === 2, 'a New quote: a new link, emailed');
  ok(await until(async () => mails(quin.email, 'quote-follow-up').length === 2, DAY * 3), 'and it gets its own follow-up');
  const ana = await person();
  const ja2 = await job(FQ.id, ana);
  r = await rico('POST', `/jobs/${ja2?.id}/quote/send`);
  const tok = String(r.body?.url || '').split('/q/')[1];
  const v = (await (await fetch(`${B}/q/${tok}`)).text()).match(/name="v" value="([^"]+)"/)?.[1] || '';
  await fetch(`${B}/q/${tok}/accept`, { method: 'POST', body: new URLSearchParams({ name: 'Ana', v }), redirect: 'manual' });
  await sleep(DAY * 2);
  ok(!mails(ana.email, 'quote-follow-up').length, 'an accepted quote gets no follow-up');

  // 6. The automatic invoice, emailed; payment reminders (§2, §3.3, §3.4).
  const FA = await flowOf('Billed', { billing: 'auto', items: [{ itemId: can?.id, qty: 1 }], steps: [C, DO, { kind: 'invoice', name: 'Inv', settings: { email: true } }, { kind: 'payment', name: 'Pay', settings: { reminders: [1, 3] } }] });
  ok(FA.status === 200, '(setup) an auto-billing flow, invoice emailed, reminders at 1 and 3 days: ' + FA.error);
  const invsOf = async (id) => { const b = (await rico('GET', `/records/${id}/invoices`)).body; return Array.isArray(b) ? b : []; };
  const iva = await person();
  const ja = await job(FA.id, iva);
  await rico('POST', `/jobs/${ja?.id}/steps/${FA.sid('Do it')}/done`);
  ok(await until(async () => mails(iva.email, 'invoice').length === 1), 'the automatic invoice is emailed to the customer');
  let inv = (await invsOf(ja?.id))[0];
  ok(String(JSON.stringify(mails(iva.email, 'invoice')[0])).includes(inv?.url) && inv?.status === 'sent', 'with its pay link');
  await sleep(700);
  ok(mails(iva.email, 'invoice').length === 1, 'once');
  await rico('POST', `/invoices/${inv?.id}/void`);
  ok(await until(async () => mails(iva.email, 'invoice').length === 2) && (await invsOf(ja?.id)).filter((x) => x.status !== 'void').length === 1, 'a voided invoice’s replacement is emailed too (its own history)');
  inv = (await invsOf(ja?.id)).find((x) => x.status !== 'void');
  await sleep(500);
  ok(!mails(iva.email, 'payment-reminder').length, 'not past due: no payment reminder');
  await rico('PATCH', `/invoices/${inv?.id}`, { due: daysAgo(1) });
  ok(await until(async () => mails(iva.email, 'payment-reminder').length === 1), 'a day past due (team calendar): the first reminder');
  await rico('POST', `/invoices/${inv?.id}/payments`, { amount: '5', method: 'cash' });
  await rico('PATCH', `/invoices/${inv?.id}`, { due: daysAgo(3) });
  ok(await until(async () => mails(iva.email, 'payment-reminder').length === 2), 'a partial payment doesn’t stop them: three days past due, the second');
  s = await stepOf(ja?.id, 'Pay');
  ok(s?.reminders?.length === 2 && s.reminders.every((x) => x?.sentAt), 'the payment step lists them: ' + JSON.stringify(s?.reminders));
  await sleep(700);
  ok(mails(iva.email, 'payment-reminder').length === 2, 'each once');
  const bo = await person();
  const jb = await job(FA.id, bo);
  await rico('POST', `/jobs/${jb?.id}/steps/${FA.sid('Do it')}/done`);
  await until(async () => (await invsOf(jb?.id))[0]?.status === 'sent');
  await rico('PATCH', `/invoices/${(await invsOf(jb?.id))[0]?.id}`, { due: daysAgo(4) });
  ok(await until(async () => mails(bo.email, 'payment-reminder').length === 1), 'both offsets due at once: a reminder goes');
  await sleep(900);
  ok(mails(bo.email, 'payment-reminder').length === 1, 'only one, not a burst');
  const cy = await person();
  const jc = await job(FA.id, cy);
  await rico('POST', `/jobs/${jc?.id}/steps/${FA.sid('Do it')}/done`);
  await until(async () => (await invsOf(jc?.id))[0]?.status === 'sent');
  const ci = (await invsOf(jc?.id))[0];
  await rico('POST', `/invoices/${ci?.id}/payments`, { amount: '25', method: 'cash' });
  await rico('PATCH', `/invoices/${ci?.id}`, { due: daysAgo(5) });
  await sleep(900);
  ok(!mails(cy.email, 'payment-reminder').length, 'paid in full: no reminders');

  // 7. Team-wide switches retire for jobs that were ever on a flow (§4).
  await rico('PATCH', '/workspace', { custMsgs: { reminders: true, reviews: true, reviewUrl: 'https://g.page/r/team' } });
  const off = await person();
  const plain = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Plain', customer: off.id } })).body;
  await visit(plain.id, tomorrow);
  ok(await until(async () => mails(off.email, 'visit-reminder').length === 1), 'a job never on a flow still gets the team-wide reminder');
  const FX = await flowOf('Bare', { steps: [DO] });
  const was = await person();
  const jx = await job(FX.id, was);
  await rico('POST', `/jobs/${jx?.id}/flow/cancel`, { reason: 'By hand' });
  const dropped = await person();
  const jy = await job(FX.id, dropped);
  r = await rico('POST', `/jobs/${jy?.id}/flow/test-drop`);
  ok(r.status === 200 && !(await runOf(jy?.id)), '(test hook) the run is removed from the data');
  const recs = (await rico('GET', `/projects/${p.id}/records`)).body;
  ok(!!recs.find((x) => x.id === jx?.id)?.onFlowSince && !!recs.find((x) => x.id === jy?.id)?.onFlowSince, 'both jobs keep onFlowSince');
  await visit(jx?.id, tomorrow);
  await visit(jy?.id, tomorrow);
  const statusF = tp.fields.find((f) => f.key === 'status');
  const paid = statusF.choices.find((c) => c.label === 'Paid')?.id;
  await rico('PATCH', `/records/${jx?.id}`, { values: { status: paid } });
  await rico('PATCH', `/records/${jy?.id}`, { values: { status: paid } });
  await sleep(1500);
  ok(!mails(was.email).length && !mails(dropped.email).length, 'a job whose run was cancelled, or removed, gets no team-wide reminder or review request');

  // 7b. A team with Twilio: a customer with a textable phone and no email gets the automatic message as a text.
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Texting ' + t, name: 'Tess', email: `tess${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd9' });
  const tess = call(r.body.token);
  const st2 = (await tess('GET', '/state')).body;
  await tess('PATCH', '/workspace', { tz, tools: { ...st2.workspace.tools, projects: true } });
  r = await tess('PUT', '/texting', { sid: SID, token: TOKEN, number: '(702) 555-0100' });
  ok(r.status === 200 && r.body?.connected, '(setup) the team connects Twilio: ' + (r.body?.error || ''));
  const p2 = (await tess('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const ff = (await tess('POST', '/job-flows', { name: 'Texted', list: { projectId: p2.id, typeId: p2.types[0].id }, steps: [{ kind: 'review', name: 'Ask', settings: { delayHours: 0, url: 'https://g.page/r/tx', send: 'auto' } }] })).body;
  await tess('POST', `/job-flows/${ff?.id}/publish`);
  const tc = (await tess('POST', '/contacts', { name: 'Tom Text', phone: '(702) 555-0142' })).body;
  const tj = (await tess('POST', '/jobs', { flowId: ff?.id, contactId: (tc.id ? tc : tc.contact).id, values: { job: 'Texted job' } })).body?.job;
  ok(await until(async () => TW.sent.some((m) => m.To === '+17025550142' && /g\.page\/r\/tx/.test(m.Body || ''))), 'the review request goes as a text through the team’s Twilio');
  const ts = (await tess('GET', `/jobs/${tj?.id}/run`)).body?.run?.steps?.[0];
  ok(ts?.state === 'done' && ts.sentTo === 'text' && !ts.sent?.unsure, 'a text alone counts as sent: ' + JSON.stringify({ state: ts?.state, sentTo: ts?.sentTo }));
  ok(TW.sent.filter((m) => m.To === '+17025550142').length === 1, 'once');

  // 8. Not sent for sure (mail off): waits and retries; Send the quote reports it and doesn't retry by itself.
  await stop();
  ok(await start({}), '(setup) restarted with email off');
  rico = call(ricoTok); sam = call(samTok);
  const gus = await person();
  const jg = await job(FR.id, gus);
  await visit(jg?.id, tomorrow);
  await sleep(1000);
  s = await stepOf(jg?.id, 'Remind');
  ok(s?.state === 'current' && !!s.waiting && !s.sent, 'email off: the reminder waits, saying why: ' + s?.waiting);
  const hal = await person();
  const jh = await job(FQ.id, hal);
  r = await rico('POST', `/jobs/${jh?.id}/quote/send`);
  ok(r.status === 200 && !!r.body?.url && r.body?.told?.emailed === false && !!r.body?.told?.reason, 'Send the quote with email off: the link is made, and it says it wasn’t emailed: ' + JSON.stringify(r.body?.told));
  ok((await stepOf(jh?.id, 'Quote'))?.quote?.status === 'sent', 'the quote is sent all the same');
  s = await stepOf(jh?.id, 'Quote');
  ok(s?.told?.state === 'blocked' && !!s.told.reason && !(await stepOf(jh?.id, 'Quote', sam))?.told, 'the job’s quote step keeps “not emailed” and why, for owners and admins: ' + JSON.stringify(s?.told));
  const ira = await person();
  const ji = await job(FA.id, ira);
  await rico('POST', `/jobs/${ji?.id}/steps/${FA.sid('Do it')}/done`);
  ok(await until(async () => (await invsOf(ji?.id))[0]?.status === 'sent'), 'the automatic invoice is sent (its link) with email off');
  const pia = await person();
  const jpa = await job(FA.id, pia);
  await rico('POST', `/jobs/${jpa?.id}/steps/${FA.sid('Do it')}/done`);
  await until(async () => (await invsOf(jpa?.id))[0]?.status === 'sent');
  await rico('POST', `/invoices/${(await invsOf(jpa?.id))[0]?.id}/payments`, { amount: '25', method: 'cash' });
  ok((await invsOf(jpa?.id))[0]?.status === 'paid', '(setup) another job’s invoice is paid in full while its email waits');
  await stop();
  ok(await start(), '(setup) restarted with email on');
  rico = call(ricoTok); sam = call(samTok);
  ok(await until(async () => mails(gus.email, 'visit-reminder').length === 1), 'the waiting reminder goes on a later tick');
  ok(await until(async () => mails(ira.email, 'invoice').length === 1) && (await invsOf(ji?.id)).length === 1, 'the invoice email is retried and goes, with no second invoice');
  await sleep(900);
  ok(!mails(pia.email, 'invoice').length && (await invsOf(jpa?.id)).length === 1, 'the invoice paid while its email waited is never emailed, and no other invoice is made');
  await sleep(800);
  ok(!mails(hal.email, 'quote-sent').length, 'Send the quote’s email isn’t retried in the background');
  r = await rico('POST', `/jobs/${jh?.id}/quote/send`);
  ok(r.body?.told?.emailed === true && mails(hal.email, 'quote-sent').length === 1, 'a blocked first email lets the next tap try again');
  ok((await stepOf(jh?.id, 'Quote'))?.told?.state === 'sent', 'and then the step says it was sent');

  // 9. In doubt (the provider threw): unsure, counted as done, never retried.
  await stop();
  ok(await start({ MAIL_OUTBOX: '1', JOBFLOWS_MAIL_THROW: '1' }), '(setup) restarted with the provider throwing');
  rico = call(ricoTok);
  const jen = await person();
  const jj = await job(FV2.id, jen);
  ok(await until(async () => (await stepOf(jj?.id, 'Ask'))?.state === 'done'), 'a send that may have gone: the step counts as done');
  s = await stepOf(jj?.id, 'Ask');
  ok(s?.sent?.unsure === true && /may not have gone/i.test(s.note || ''), 'marked unsure, saying it may not have gone: ' + JSON.stringify({ sent: s?.sent, note: s?.note }));
  await stop();
  ok(await start(), '(setup) restarted, the provider working');
  rico = call(ricoTok);
  await sleep(1200);
  ok(!mails(jen.email).length, 'and it’s never sent again by itself');

  // 10. A crash after the provider took it, before "sent" was saved: unsure, no second send.
  await stop();
  ok(await start({ MAIL_OUTBOX: '1', JOBFLOWS_CRASH_AFTER_SEND: '1' }), '(setup) restarted to die right after a send');
  rico = call(ricoTok);
  const kim = await person();
  await job(FV2.id, kim);
  ok(await until(async () => srv.exitCode !== null), 'the server dies right after handing the email over');
  ok(mails(kim.email, 'review-request').length === 1, 'the email went once');
  ok(await start(), '(setup) restarted');
  rico = call(ricoTok);
  const kj = (await rico('GET', '/jobs')).body?.jobs?.find((x) => x.client?.name === kim.name);
  ok(await until(async () => (await stepOf(kj?.id, 'Ask'))?.sent?.unsure === true), 'after the restart the step is unsure (it was mid-send)');
  await sleep(1200);
  ok(mails(kim.email, 'review-request').length === 1, 'and the customer got it once, not twice');
} catch (e) {
  console.log('FAIL threw: ' + (e.stack || e.message));
  fails++;
} finally {
  if (srv.exitCode === null) srv.kill();
  fake.close();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
