// Google Contacts as a connector: an admin connects it, everyone in "My contacts" comes into Contacts (matched to
// people already there), stays current, keeps what the team adds, and stays when it's disconnected.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/gcontacts';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4783, B = `http://127.0.0.1:${PORT}`, G_PORT = 4781;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// A stand-in for Google: sign-in, who you are, the People API (two pages), and revoking.
let grantContacts = false;
let people = [
  { resourceName: 'people/c1', names: [{ displayName: 'Ana Ruiz' }], emailAddresses: [{ value: 'ANA@shop.test' }], phoneNumbers: [{ value: '555-0101' }] },
  { resourceName: 'people/c2', names: [{ givenName: 'Ben', familyName: 'Ito' }], organizations: [{ name: 'Acme Gym' }], phoneNumbers: [{ value: '555-0102', metadata: { primary: true } }],
    addresses: [{ streetAddress: '12 Elm St', city: 'Mesa', metadata: { primary: true } }] },
  { resourceName: 'people/c3' },
];
const page2 = [{ resourceName: 'people/c4', names: [{ displayName: 'Cara Diaz' }], emailAddresses: [{ value: 'cara@diaz.test' }] }];
let revoked = 0;
const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const url = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/token') return res.end(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid email' + (grantContacts ? ' https://www.googleapis.com/auth/contacts.readonly' : '') }));
  if (url.pathname === '/v1/userinfo') return res.end(JSON.stringify({ email: 'jo@gmail.com' }));
  if (url.pathname === '/v1/people/me/connections') {
    if (req.headers.authorization !== 'Bearer at') { res.writeHead(401); return res.end('{}'); }
    return res.end(JSON.stringify(url.searchParams.get('pageToken') === 'p2' ? { connections: page2 } : { connections: people, nextPageToken: 'p2' }));
  }
  if (url.pathname === '/revoke') { revoked++; return res.end('{}'); }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => fake.listen(G_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', GOOGLE_API: `http://127.0.0.1:${G_PORT}`, MS_CLIENT_ID: '', MS_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'GC ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'GC ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  ok((await sam('GET', '/gcontacts')).status === 403, 'a member can’t connect Google Contacts');
  r = await jo('GET', '/gcontacts');
  ok(r.body.configured && !r.body.connected, 'Google is set up here, nothing connected yet');

  // Someone already typed in, with a note: Google's Ana should land on her, not make a second Ana.
  const typed = (await jo('POST', '/contacts', { name: 'Ana (shop)', email: 'ana@shop.test', note: 'Met at the expo' })).body;

  const connect = async () => {
    const { url } = (await jo('POST', '/gcontacts/connect')).body;
    const u = new URL(url);
    return { scope: u.searchParams.get('scope'), page: await (await fetch(`${B}/oauth/google/callback?code=c&state=${u.searchParams.get('state')}`)).text() };
  };
  let c = await connect();
  ok(/contacts\.readonly/.test(c.scope) && !/calendar|gmail/.test(c.scope), 'it asks Google only to read contacts');
  ok(/wasn’t allowed/.test(c.page) && !(await jo('GET', '/gcontacts')).body.connected, 'unticking contacts on Google’s screen connects nothing');
  grantContacts = true;
  c = await connect();
  ok(/Google Contacts connected/.test(c.page) && /3 people/.test(c.page), 'connected: 3 people came in (one with nothing on it is left out): ' + c.page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
  r = await jo('GET', '/gcontacts');
  ok(r.body.connected && r.body.account === 'jo@gmail.com' && r.body.by === 'Jo' && r.body.syncedAt, 'it shows the account, who connected it and when it last synced');

  let all = (await jo('GET', '/contacts')).body.contacts;
  const ana = all.filter((x) => /ana/i.test(x.name));
  ok(ana.length === 1 && ana[0].id === typed.id && ana[0].note === 'Met at the expo' && ana[0].name === 'Ana (shop)' && ana[0].ext.google === 'people/c1', 'Google’s Ana is matched to the one already here, which keeps its own name and note');
  const ben = all.find((x) => x.ext?.google === 'people/c2');
  ok(ben && ben.name === 'Ben Ito' && ben.company === 'Acme Gym' && ben.address === '12 Elm St' && ben.city === 'Mesa' && ben.source === 'Google Contacts' && ben.via === 'google', 'a new person comes in with company and address, from “Google Contacts”');
  ok(all.some((x) => x.email === 'cara@diaz.test'), 'the second page of contacts comes in too');

  // Google's details are changed in Google; the team's are kept.
  r = await jo('PATCH', '/contacts/' + ben.id, { name: 'Benny', stage: 'customer', tags: 'gym' });
  ok(r.body.name === 'Ben Ito' && r.body.stage === 'customer' && r.body.tags.includes('gym'), 'the name stays Google’s; stage and tags are the team’s');
  people[1] = { ...people[1], phoneNumbers: [{ value: '555-9999' }] };
  await jo('POST', '/gcontacts/sync');
  all = (await jo('GET', '/contacts')).body.contacts;
  const ben2 = all.find((x) => x.id === ben.id);
  ok(ben2.phone === '555-9999' && ben2.stage === 'customer', 'a change in Google comes through, and the team’s stage stays');

  // Gone from Google: someone the team never touched goes; someone with a stage stays.
  people = people.filter((p) => p.resourceName !== 'people/c2');
  page2.length = 0;
  await jo('POST', '/gcontacts/sync');
  all = (await jo('GET', '/contacts')).body.contacts;
  ok(!all.some((x) => x.email === 'cara@diaz.test'), 'someone removed in Google, with nothing the team added, goes');
  const ben3 = all.find((x) => x.id === ben.id);
  ok(ben3 && !ben3.ext.google && ben3.via === null, 'someone removed in Google that the team gave a stage stays, as the team’s own');

  // Disconnecting: Google forgets the access, people stay and become editable.
  r = await jo('DELETE', '/gcontacts');
  ok(!r.body.connected && revoked >= 1, 'disconnecting tells Google to forget Kloomie’s access');
  all = (await jo('GET', '/contacts')).body.contacts;
  const ana2 = all.find((x) => x.id === typed.id);
  ok(ana2 && ana2.via === null, 'its people stay in Contacts');
  r = await jo('PATCH', '/contacts/' + ana2.id, { name: 'Ana Ruiz' });
  ok(r.body.name === 'Ana Ruiz', 'and can be edited like any other');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
fake.close();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
