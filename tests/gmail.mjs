// Campaign email from Gmail: connecting Gmail to send, each email going out through Gmail with the sender's
// signature and (without PSS) Kloomie's own unsubscribe link, and that link unsubscribing them.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/gmail';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4787, B = `http://127.0.0.1:${PORT}`, G_PORT = 4785;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(250); } return false; };

// A stand-in for Google: sign-in tokens, who you are, calendars, and Gmail's send.
const sent = [];
let grantSend = true;
const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const url = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/token') return res.end(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.events' + (grantSend ? ' https://www.googleapis.com/auth/gmail.send' : '') }));
  if (url.pathname === '/v1/userinfo') return res.end(JSON.stringify({ email: 'jo@gmail.com' }));
  if (url.pathname.endsWith('/calendarList')) return res.end(JSON.stringify({ items: [{ id: 'primary', summary: 'Jo', primary: true, accessRole: 'owner' }] }));
  if (url.pathname.endsWith('/events')) return res.end(JSON.stringify({ items: [] }));
  if (url.pathname === '/gmail/v1/users/me/messages/send') {
    if (req.headers.authorization !== 'Bearer at') { res.writeHead(401); return res.end('{}'); }
    sent.push(Buffer.from(JSON.parse(body).raw, 'base64url').toString());
    return res.end(JSON.stringify({ id: 'm' + sent.length }));
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => fake.listen(G_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', GOOGLE_API: `http://127.0.0.1:${G_PORT}`, MS_CLIENT_ID: '', MS_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/api/auth', { mode: 'create', workspace: 'Mail ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const J = call(r.body.token);
  // confirm Jo's email with the code in the outbox
  const ob = DIR + '/outbox';
  await until(() => fs.existsSync(ob) && fs.readdirSync(ob).length > 0, 5000);
  const codeMail = fs.readdirSync(ob).map((f) => JSON.parse(fs.readFileSync(ob + '/' + f, 'utf8'))).find((x) => /code/i.test(x.subject));
  const vcode = (codeMail.subject.match(/\d{3}[ -]?\d{3}/) || codeMail.text.match(/\d{3}[ -]?\d{3}/))[0];
  ok((await J('POST', '/api/account/verify', { code: vcode })).status === 200, 'Jo confirms her email');
  r = await J('GET', '/api/mail');
  ok(r.body.from === null && r.body.canGmail === true && r.body.canConnect === false, 'nothing connected yet; Gmail can be (Outlook isn’t set up here)');

  // connect Gmail, first without allowing sending
  const connect = async () => {
    const { url } = (await J('POST', '/api/calendars/connect', { provider: 'google', tz: 'America/Los_Angeles', mail: true })).body;
    const u = new URL(url);
    return { scope: u.searchParams.get('scope'), page: await (await fetch(`${B}/oauth/google/callback?code=c&state=${u.searchParams.get('state')}`)).text() };
  };
  grantSend = false;
  let c = await connect();
  ok(c.scope.includes('https://www.googleapis.com/auth/gmail.send') && c.scope.includes('calendar.events'), 'connecting Gmail to send asks for sending, and the calendar');
  ok(c.page.includes('sending email wasn’t allowed') && c.page.includes('leave'), 'unticked on Google’s screen: it says so, and how to fix it');
  ok((await J('GET', '/api/mail')).body.from === null, 'and nothing sends from it');
  grantSend = true;
  c = await connect();
  ok(c.page.includes('can send campaign emails'), 'allowed: Gmail can send');
  r = await J('GET', '/api/mail');
  ok(r.body.from === 'jo@gmail.com' && r.body.via === 'Gmail', 'email now goes from jo@gmail.com, through Gmail');
  ok(!(await J('POST', '/api/calendars/connect', { provider: 'google', mail: false })).body.url.includes('gmail.send'), 'connecting just the calendar doesn’t ask to send email');

  // a signature, a contact, and an email to them
  await J('PUT', '/api/signature', { email: 'Jo Whirley\nPremier Shades' });
  const pat = (await J('POST', '/api/contacts', { name: 'Pat Lee', email: 'pat@example.com' })).body;
  r = await J('POST', '/api/mail/sends', { subject: 'Spring tint deal', body: 'Hi {first name},\n\n20% off this month.', footer: 'Premier Shades\n1 Main St, Henderson NV', to: [{ email: 'pat@example.com', name: 'Pat Lee', first: 'Pat', contactId: pat.id }, { email: 'sam@example.com', name: 'Sam' }] });
  ok(r.status === 200 && r.body.total === 2, 'a send to 2 people starts: ' + JSON.stringify(r.body));
  ok(await until(() => sent.length === 2), 'both go out through Gmail');
  const m = sent.find((x) => x.includes('pat@example.com')) || '';
  const text = Buffer.from(m.split('\r\n\r\n').slice(1).join('').replace(/\r\n/g, ''), 'base64').toString().replace(/\r\n/g, '\n');
  ok(/^From: <jo@gmail.com>/m.test(m) && /^To: "Pat Lee" <pat@example.com>/m.test(m), 'from Jo’s Gmail, to Pat');
  ok(text.startsWith('Hi Pat,') && text.includes('20% off this month.\n\nJo Whirley\nPremier Shades\n\n--\nPremier Shades'), 'merged, with her signature above the footer: ' + JSON.stringify(text.slice(0, 120)));
  const link = (text.match(/Unsubscribe: (\S+)/) || [])[1] || '';
  ok(link.startsWith(B + '/unsubscribe/') && m.includes('List-Unsubscribe') === link.startsWith('https://'), 'with Kloomie’s own unsubscribe link (no PSS); the one-click header comes with https links');
  await J('POST', '/api/mail/sends', { subject: 'x', body: 'y', footer: 'Premier Shades\n1 Main St', signature: false, to: [{ email: 'lee@example.com' }] });
  ok(await until(() => sent.length === 3), 'another send');
  ok(!Buffer.from(sent[2].split('\r\n\r\n').slice(1).join('').replace(/\r\n/g, ''), 'base64').toString().includes('Jo Whirley'), 'leaving the signature off that time leaves it off');

  // they unsubscribe
  r = await fetch(link, { method: 'POST', body: 'List-Unsubscribe=One-Click' });
  ok(r.ok, 'Pat unsubscribes');
  ok((await J('GET', '/api/contacts')).body.contacts.find((x) => x.id === pat.id)?.dne === true, 'she’s do not contact now');
  r = await J('POST', '/api/mail/sends', { subject: 'Again', body: 'Hi', footer: 'Premier Shades\n1 Main St', to: [{ email: 'pat@example.com', contactId: pat.id }] });
  ok(r.status === 400, 'and isn’t emailed again');
  r = await J('POST', '/api/mail/sends', { subject: 'Again', body: 'Hi', footer: 'Premier Shades\n1 Main St', to: [{ email: 'PAT@example.com' }] });
  ok(r.status === 400, 'not even typed in by hand');
} finally {
  srv.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
