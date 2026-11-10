// Leads from the website: the team's lead form page (branded, spam traps, someone already in Contacts updated not
// doubled, the message kept) and the lead webhook (JSON or a form, the usual field names, CORS for browsers), each
// telling admins and setting off automations; limits per address; a new key retiring the old one; off means off.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/leads';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4757, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const postForm = (url, fields) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Lead ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Lead ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  ok((await sam('GET', '/lead-capture')).status === 403, 'members can’t set up lead capture');
  ok((await jo('GET', '/lead-capture')).body.on === false, 'off to start with');
  // An automation: every new contact gets a call-back task.
  await jo('POST', '/automations', { name: 'Call new leads', trigger: { kind: 'contact.added' }, actions: [{ kind: 'task', text: 'Call the new lead' }] });
  r = await jo('PUT', '/lead-capture', { on: true, stage: 'New', tags: 'website' });
  const { formUrl, webhookUrl } = r.body;
  ok(r.body.on && formUrl?.startsWith(B + '/l/') && webhookUrl?.startsWith(B + '/hooks/lead/'), 'turned on: a form link and a lead webhook address');

  // The form.
  let html = await (await fetch(formUrl)).text();
  ok(/Contact Lead /.test(html) && /name="website"/.test(html) && /name="t" value="\d+"/.test(html), 'the form page shows, titled for the team, with its spam traps');
  ok(((await fetch(formUrl)).headers.get('content-security-policy') || '').includes("default-src 'none'"), 'the page runs no scripts');
  const started = String(Date.now() - 5000);
  r = await postForm(formUrl, { name: 'Dana Ruiz', email: 'dana@x.test', phone: '702-555-0142', message: 'Quote for 6 windows please', t: started, website: '' });
  ok(r.status === 303 && r.headers.get('location').includes('sent=1'), 'sending it thanks them');
  ok(/Thank you/.test(await (await fetch(B + r.headers.get('location'))).text()), 'with a thank-you page');
  let dana = (await jo('GET', '/contacts')).body.contacts.find((x) => x.email === 'dana@x.test');
  ok(dana && dana.source === 'Website form' && dana.stage === 'New' && dana.tags.includes('website') && /Quote for 6 windows/.test(dana.note), 'Dana is a new contact: from the website form, at New, tagged, with her message');
  ok(await until(async () => (await jo('GET', '/state')).body.tasks.some((x) => x.text === 'Call the new lead')), 'the new-contact automation ran (a call-back task)');
  ok((await jo('GET', '/state')).body.notices.some((n) => /New lead: Dana Ruiz/.test(n.title) && n.go === 'contact:' + dana.id), 'admins are told, and it opens her contact');
  r = await postForm(formUrl, { name: 'D Ruiz', email: 'DANA@x.test', message: 'Also the patio door', t: started });
  dana = (await jo('GET', '/contacts')).body.contacts.filter((x) => emailOf(x) === 'dana@x.test');
  ok(dana.length === 1 && dana[0].name === 'Dana Ruiz' && /patio door/.test(dana[0].note) && /6 windows/.test(dana[0].note), 'sending again with the same email updates her, keeping both messages');
  const before = (await jo('GET', '/contacts')).body.contacts.length;
  await postForm(formUrl, { name: 'Bot', email: 'bot@x.test', t: started, website: 'http://spam' });
  await postForm(formUrl, { name: 'Fast Bot', email: 'fast@x.test', t: String(Date.now()) });
  ok((await jo('GET', '/contacts')).body.contacts.length === before, 'the hidden field filled, or a form sent too fast, is thanked but kept out');
  html = await (await postForm(formUrl, { name: 'No Way Back', t: started })).text();
  ok(/email or a phone number/.test(html) && /No Way Back/.test(html), 'without an email or phone it asks for one, keeping what they typed');

  // The webhook.
  r = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ first_name: 'Lee', last_name: 'Park', Phone_Number: '(702) 555-0111', Comments: 'Shutters?', utm_source: 'Angi' }) });
  let j = await r.json();
  ok(r.status === 201 && j.added && j.contact_id, 'a JSON lead with first and last name is added');
  const lee = (await jo('GET', '/contacts')).body.contacts.find((x) => x.id === j.contact_id);
  ok(lee?.name === 'Lee Park' && lee.phone === '(702) 555-0111' && lee.source === 'Angi' && /Shutters/.test(lee.note), 'with the usual field names understood (phone number, comments, source)');
  r = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Ann+Lo&email=ann%40x.test' });
  ok(r.status === 201, 'a form-encoded lead works too');
  r = await fetch(webhookUrl, { method: 'OPTIONS', headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' } });
  ok(r.status === 204 && r.headers.get('access-control-allow-origin') === '*', 'a website can send leads straight from the browser (CORS)');
  r = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Nobody' }) });
  ok(r.status === 400 && /email or a phone/.test((await r.json()).error), 'a lead with no way to reach them is refused, saying why');
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rep ' + i, email: `rep${i}@x.test` }) })).status === 429;
  ok(limited, 'too many from one address in an hour are turned away');

  // A new key, and turning it off.
  r = await jo('POST', '/lead-capture/new-key');
  ok(r.body.formUrl !== formUrl && (await fetch(formUrl)).status === 404, 'a new link retires the old one');
  await jo('PUT', '/lead-capture', { on: false });
  ok((await fetch(r.body.formUrl)).status === 404 && (await fetch(r.body.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 404, 'turned off, the form and webhook take nothing');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log(srv.log.slice(-2000));
  srv.kill();
}
function emailOf(x) { return String(x.email || '').toLowerCase(); }
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
