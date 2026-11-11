// Leads from any website, funnel or form tool: the snippet's posts (with the page they came from), nested JSON
// (ClickFunnels-style), Typeform's answers, Tally's label/value list, Jotform's multipart rawRequest, odd field names
// matched by what they contain, leftovers kept in the note, secrets never kept; the lead log (every result, a test
// that saves nothing, clearing it), the field names seen, and the team's own matches winning.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/leadsources';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4771, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Src ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  r = await jo('PUT', '/lead-capture', { on: true, stage: 'New', tags: 'web' });
  const hookUrl = r.body.webhookUrl;
  ok(r.body.snippet === `<script src="${B}/k.js" data-key="${r.body.key}" async></script>`, 'there’s a one-line website snippet with the team’s key');
  const js = await fetch(B + '/k.js');
  ok(js.ok && /javascript/.test(js.headers.get('content-type')) && js.headers.get('access-control-allow-origin') === '*' && (await js.text()).includes('/hooks/lead/'), 'the snippet script is served to any site');
  const contacts = async () => (await jo('GET', '/contacts')).body.contacts;
  const find = async (email) => (await contacts()).find((x) => x.email === email);

  // The snippet's post, as a browser would send it.
  const snip = new URLSearchParams({ 'your-name': 'Ana Ruiz', 'your-email': 'ana@x.test', 'your-message': 'Need shutters', 'Window count': '6', website: 'https://anas-bakery.test', card_number: '4111111111111111', _page: 'https://www.blindsco.test/contact?utm_source=google', _title: 'Contact', _via: 'snippet' });
  r = await fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: snip });
  let ana = await find('ana@x.test');
  ok(r.status === 201 && ana?.name === 'Ana Ruiz' && ana.source === 'Website (blindsco.test)', 'a snippet lead is added, its source the website it came from');
  ok(/Need shutters/.test(ana.note) && /Window count: 6/.test(ana.note) && /website: https:\/\/anas-bakery/.test(ana.note), 'their message and the other fields are kept in the note (a real “website” field isn’t taken for spam)');
  ok(!/4111/.test(JSON.stringify(ana)), 'a card number is never kept');

  // Nested JSON, like ClickFunnels.
  r = await fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'contact.created', data: { contact: { first_name: 'Ben', last_name: 'Ode', email: 'ben@x.test', phone: '702-555-0101' }, funnel: { name: 'Free quote' } } }) });
  const ben = await find('ben@x.test');
  ok(r.status === 201 && ben?.name === 'Ben Ode' && ben.phone === '702-555-0101', 'nested JSON (a funnel builder) is read');

  // Typeform.
  r = await fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_type: 'form_response', form_response: { definition: { fields: [{ id: 'a1', title: 'What’s your name?' }, { id: 'a2', title: 'Email' }, { id: 'a3', title: 'What do you need?' }] },
    answers: [{ type: 'text', text: 'Cleo Park', field: { id: 'a1' } }, { type: 'email', email: 'cleo@x.test', field: { id: 'a2' } }, { type: 'choice', choice: { label: 'Blinds' }, field: { id: 'a3' } }] } }) });
  const cleo = await find('cleo@x.test');
  ok(r.status === 201 && cleo?.name === 'Cleo Park' && /What do you need\?: Blinds/.test(cleo.note), 'Typeform answers are read by their questions');

  // Tally: a list of label/value fields.
  r = await fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventType: 'FORM_RESPONSE', data: { fields: [{ key: 'q1', label: 'Full name', value: 'Dee Lane' }, { key: 'q2', label: 'Phone number', value: '(702) 555-0102' }, { key: 'q3', label: 'Budget', value: '$2,000' }] } }) });
  const dee = (await contacts()).find((x) => x.name === 'Dee Lane');
  ok(r.status === 201 && dee?.phone === '(702) 555-0102' && /Budget: \$2,000/.test(dee.note), 'Tally’s label/value fields are read, by what their labels say');

  // Jotform: multipart with rawRequest.
  const fd = new FormData();
  fd.append('formID', '123'); fd.append('pretty', 'Name:Eli Moss, Email:eli@x.test');
  fd.append('rawRequest', JSON.stringify({ q3_name: { first: 'Eli', last: 'Moss' }, q4_email: 'eli@x.test', q5_phoneNumber: { full: '(702) 555-0103' }, q6_typeA: 'Roller shades' }));
  r = await fetch(hookUrl, { method: 'POST', body: fd });
  const eli = await find('eli@x.test');
  ok(r.status === 201 && eli?.name === 'Eli Moss' && eli.phone === '(702) 555-0103', 'Jotform’s multipart post (rawRequest) is read');

  // Refused, and logged.
  r = await fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'No Contact', comments: 'hi' }) });
  ok(r.status === 400, 'a lead with no email or phone is refused');

  r = await jo('GET', '/lead-capture');
  const log = r.body.log;
  ok(log.length >= 6 && log[0].result === 'refused' && /email or a phone/.test(log[0].error), 'the log shows every lead, the newest first, with why one was refused');
  const anaLog = log.find((e) => e.who === 'Ana Ruiz');
  ok(anaLog?.via === 'snippet' && anaLog.from === 'www.blindsco.test/contact' && anaLog.result === 'added' && anaLog.contactId === ana.id, 'a logged lead says where it came from and which contact it made');
  ok(anaLog.fields.find((f) => f.k === 'your-email')?.to === 'email' && anaLog.fields.find((f) => f.k === 'Window count')?.to === 'note' && !anaLog.fields.some((f) => /card/.test(f.k)), 'and how each field was read (no card number)');
  ok('Budget' in r.body.seen && 'Window count' in r.body.seen && !('_page' in r.body.seen), 'the field names seen are listed for matching (not housekeeping ones)');

  // The team's own matches.
  r = await jo('PUT', '/lead-capture', { map: { Budget: 'ignore', 'Job type': 'source', bogus: 'not-a-target' } });
  ok(r.body.map.Budget === 'ignore' && r.body.map['Job type'] === 'source' && !('bogus' in r.body.map), 'matches are saved (only real places)');
  await fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fay Vo', email: 'fay@x.test', Budget: '$900', 'Job type': 'Angi' }) });
  const fay = await find('fay@x.test');
  ok(fay?.source === 'Angi' && !/900/.test(fay.note || ''), 'a lead uses them: Job type became the source, Budget was left out');

  // A test saves nothing.
  const before = (await contacts()).length;
  r = await jo('POST', '/lead-capture/test', {});
  ok(r.body.ok && r.body.lead.email === 'test.lead@example.com' && r.body.log[0].result === 'test' && (await contacts()).length === before, 'Send a test lead shows how it’s read and saves no contact');
  r = await jo('POST', '/lead-capture/test', { fields: { name: 'Only Name' } });
  ok(!r.body.ok && r.body.log[0].result === 'refused', 'a test with no email or phone says it would be refused');
  r = await jo('DELETE', '/lead-capture/log');
  ok(r.body.log.length === 0, 'the log can be cleared');
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Src ' + t, code: (await jo('GET', '/state')).body.workspace.inviteCode, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  ok((await call(r.body.token)('GET', '/lead-capture')).status === 403, 'members don’t see the lead log');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log(srv.log.slice(-2500));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
