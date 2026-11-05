// Contacts: owners add, import, merge and mark people do-not-contact; PSS fills Contacts (matching people
// already there) and gets calls logged against its leads; live call lists follow Contacts; the leads kept
// on the PSS connection before Contacts move in once; Kloomie's own unsubscribe link works.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/contacts';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4786, B = `http://127.0.0.1:${PORT}`, PSS_PORT = 4785;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
  console.log(srv.log); process.exit(1);
};
const stop = async () => { srv.kill('SIGTERM'); await srv.exited; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(200); } return false; };

// A stand-in for the PSS website: leads a page at a time, a do-not-email list, and the events it's sent.
const pss = {
  leads: [
    { id: 'lead-1', name: 'Pat Lee', email: 'pat@example.com', phone: '555-111-2222', city: 'Austin', source: 'Website', stage: 'quoted', created_at: '2026-10-01T00:00:00Z' },
    { id: 'lead-2', name: 'Robin Diaz', email: 'robin@example.com', phone: '', city: 'Dallas', source: 'Referral', stage: 'new', created_at: '2026-10-02T00:00:00Z' },
    { id: 'lead-3', name: 'Sam Ortiz', email: 'sam@example.com', phone: '(555) 333-4444', city: 'Austin', source: 'Website', stage: 'sold', created_at: '2026-10-03T00:00:00Z' },
  ],
  dne: ['robin@example.com'], events: [],
};
const fake = http.createServer(async (req, res) => {
  if (req.headers.authorization !== 'Bearer ' + 'k'.repeat(24)) { res.writeHead(401); return res.end(); }
  const url = new URL(req.url, 'http://x');
  let body = '';
  for await (const c of req) body += c;
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/api/column/leads') {
    const after = Number(url.searchParams.get('after') || 0);
    const page = pss.leads.slice(after, after + 2);
    return res.end(JSON.stringify({ leads: page, next: after + 2 < pss.leads.length ? String(after + 2) : null }));
  }
  if (url.pathname === '/api/column/email' && req.method === 'GET') return res.end(JSON.stringify({ do_not_email: pss.dne }));
  if (url.pathname === '/api/column/events') {
    const evs = JSON.parse(body).events;
    pss.events.push(...evs);
    return res.end(JSON.stringify({ saved: evs.map((e) => e.id), missing: [] }));
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => fake.listen(PSS_PORT, '127.0.0.1', r));

const t = Date.now();
await start();
try {
  let r = await call()('POST', '/api/auth', { mode: 'create', workspace: 'Shades ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const J = call(r.body.token);
  const wsId = r.body.workspace.id;
  const code = (await J('GET', '/api/state')).body.workspace.inviteCode;
  r = await call()('POST', '/api/auth', { mode: 'join', workspace: 'Shades ' + t, code, name: 'Ken', email: `ken${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd2' });
  const K = call(r.body.token);
  const list = async () => (await J('GET', '/api/contacts')).body.contacts;

  // ----- by hand -----
  ok((await J('GET', '/api/contacts')).body.contacts.length === 0, 'a new team starts with no contacts, without PSS');
  ok((await K('GET', '/api/contacts')).status === 403, 'members can’t see Contacts');
  ok((await K('POST', '/api/contacts', { name: 'Nope' })).status === 403, 'or add to them');
  ok((await J('POST', '/api/contacts', { note: 'just a note' })).status === 400, 'a contact needs a name, company, email or phone');
  r = await J('POST', '/api/contacts', { name: '  Pat   Lee ', email: 'PAT@example.com', phone: '', company: 'Lee Roofing', tags: 'customer, vip, customer', note: 'Met at the show' });
  const pat = r.body;
  ok(r.status === 200 && pat.name === 'Pat Lee' && pat.company === 'Lee Roofing' && pat.tags.join() === 'customer,vip', 'an owner adds a contact, tidied (spaces, repeated tags)');
  r = await J('PATCH', '/api/contacts/' + pat.id, { phone: '512 555 0100', email: 'not an email' });
  ok(r.body.phone === '512 555 0100' && r.body.email === '', 'changing it; an address that isn’t one is dropped');
  await J('PATCH', '/api/contacts/' + pat.id, { email: 'pat@example.com' });

  // ----- a spreadsheet -----
  r = await J('POST', '/api/contacts/import', { tags: ['show 2026'], rows: [
    { name: 'Pat L', email: 'pat@example.com', city: 'Austin' }, // already here: city filled, name kept
    { name: 'Alex Kim', phone: '(555) 777-8888', company: 'Kim Glass' },
    { name: 'Alex K', phone: '555.777.8888' }, // same phone as the row above: the same person
    { name: '', email: '', phone: '' },
    { name: 'Quinn Ray', email: 'quinn@example.com', tags: 'lead' },
  ] });
  ok(r.body.added === 2 && r.body.updated >= 1 && r.body.skipped >= 1, `import adds new people, fills in ones already here, skips empty rows (${JSON.stringify(r.body)})`);
  let all = await list();
  const p2 = all.find((x) => x.id === pat.id);
  ok(p2.name === 'Pat Lee' && p2.city === 'Austin' && p2.tags.includes('show 2026'), 'someone already here keeps their name and gets the empty fields and tags');
  ok(all.find((x) => x.name === 'Alex Kim')?.company === 'Kim Glass' && all.filter((x) => x.name.startsWith('Alex')).length === 1, 'the same phone written two ways is one person');
  ok(all.find((x) => x.name === 'Quinn Ray')?.tags.join() === 'lead,show 2026' && all.find((x) => x.name === 'Quinn Ray')?.source === 'Import', 'imported people get the row’s tags, everyone’s tag and a source');

  // ----- duplicates -----
  const d1 = (await J('POST', '/api/contacts', { name: 'Morgan Fox', email: 'morgan@example.com', note: 'First call went well', tags: 'a' })).body;
  await sleep(5);
  const d2 = (await J('POST', '/api/contacts', { name: 'M. Fox', email: 'Morgan@Example.com', phone: '555-999-0000', note: 'Wants a quote', tags: 'b' })).body;
  r = await J('GET', '/api/contacts/duplicates');
  ok(r.body.groups.length === 1 && r.body.groups[0].join() === [d1.id, d2.id].join(), 'duplicates are found by email, oldest first');
  r = await J('POST', '/api/contacts/merge', { ids: [d2.id, d1.id] });
  ok(r.body.id === d1.id && r.body.name === 'Morgan Fox' && r.body.phone === '555-999-0000' && r.body.note.includes('First call') && r.body.note.includes('Wants a quote') && r.body.tags.join() === 'a,b', 'merging keeps the oldest and folds in the other’s phone, note and tags');
  ok(!(await list()).some((x) => x.id === d2.id), 'the other one is gone');

  // ----- do not contact; delete -----
  r = await J('PATCH', '/api/contacts/' + d1.id, { dne: true });
  ok(r.body.dne === true && r.body.ownDne === true, 'marking someone do not contact');
  const gone = (await J('POST', '/api/contacts', { name: 'Temp Person' })).body;
  ok((await J('DELETE', '/api/contacts/' + gone.id)).status === 200 && !(await list()).some((x) => x.id === gone.id), 'deleting one typed in');

  // ----- PSS fills Contacts -----
  r = await J('PUT', '/api/pss', { url: `http://127.0.0.1:${PSS_PORT}`, key: 'k'.repeat(24) });
  ok(r.status === 200 && r.body.count === 3, `connecting PSS brings in its 3 leads, a page at a time (${r.body?.count ?? JSON.stringify(r.body)})`);
  all = await list();
  const lead1 = all.find((x) => x.pss === 'lead-1');
  ok(lead1?.id === pat.id && lead1.company === 'Lee Roofing' && lead1.note === 'Met at the show' && lead1.via === null, 'a lead with the email of someone already here links to them, keeping what was typed');
  ok(lead1.stage === 'quoted' && lead1.city === 'Austin', 'and fills in what PSS knows that was empty');
  ok(all.length === 4 + 2, `no one is doubled (${all.length})`);
  const robin = all.find((x) => x.pss === 'lead-2'), sam = all.find((x) => x.pss === 'lead-3');
  ok(robin?.via === 'pss' && robin.dne && robin.extDne && !robin.ownDne, 'PSS’s do-not-email list carries over');
  r = await J('PATCH', '/api/contacts/' + sam.id, { name: 'Changed', tags: 'installed', note: 'Gate code in the vault' });
  ok(r.body.name === 'Sam Ortiz' && r.body.tags.join() === 'installed' && r.body.note === 'Gate code in the vault', 'PSS’s details aren’t changed here, but tags and notes are');
  ok((await J('DELETE', '/api/contacts/' + robin.id)).status === 400, 'a contact PSS made can’t be deleted here (it would come back)');

  // ----- a live call list -----
  const camp = (await J('POST', '/api/campaigns', { name: 'Austin push' })).body;
  r = await J('POST', '/api/lists', { campaignId: camp.id, name: 'Austin', live: { cities: ['austin'], stages: [], sources: [], days: 0, need: null } });
  const live = r.body;
  ok(r.status === 200 && live.rows.length === 2 && live.rows.some((x) => x.leadId === 'lead-3') && live.rows.some((x) => x.contactId === pat.id), `a live list from Contacts holds everyone matching, typed in or from PSS (${live.rows?.length})`);
  ok((await K('POST', '/api/lists', { campaignId: camp.id, live: { cities: [] } })).status !== 200, 'members can’t make one');
  await J('POST', '/api/contacts', { name: 'New Austin', city: 'Austin', phone: '555-000-1234' });
  ok(await until(async () => (await J('GET', '/api/state')).body.lists.find((l) => l.id === live.id)?.rows.length === 3), 'someone new who matches joins the list by themselves');

  // A call logged against a PSS contact goes to PSS.
  r = await J('POST', '/api/attempts', { campaignId: camp.id, outcome: camp.outcomes[0], contact: 'Sam Ortiz', contactId: sam.id });
  ok(r.body.contactId === sam.id && r.body.leadId === 'lead-3', 'a call logged against a contact remembers it, and its PSS lead');
  ok(await until(() => pss.events.some((e) => e.lead_id === 'lead-3'), 12000), 'and PSS gets the call');
  r = await K('POST', '/api/attempts', { campaignId: camp.id, outcome: camp.outcomes[0], contact: 'Sam', contactId: sam.id });
  ok(r.status !== 200 || !r.body.contactId, 'a member can’t tie a call to a contact they can’t see');

  // ----- PSS changes -----
  pss.leads = pss.leads.filter((x) => x.id !== 'lead-2' && x.id !== 'lead-3');
  pss.leads.push({ id: 'lead-4', name: 'Quinn Ray', email: 'quinn@example.com', city: 'Austin', stage: 'new', created_at: '2026-10-04T00:00:00Z' });
  await J('POST', '/api/pss/sync');
  all = await list();
  ok(!all.some((x) => x.id === robin.id), 'a lead gone from PSS that nobody added to is gone');
  const sam2 = all.find((x) => x.id === sam.id);
  ok(sam2 && !sam2.pss && sam2.via === null && sam2.note === 'Gate code in the vault', 'one with a note stays, unlinked and editable');
  ok(all.find((x) => x.pss === 'lead-4')?.name === 'Quinn Ray' && all.filter((x) => x.name === 'Quinn Ray').length === 1, 'a new lead matching an imported contact links to it');
  r = await J('DELETE', '/api/pss');
  all = await list();
  ok(all.some((x) => x.pss === 'lead-1') && all.every((x) => x.via === null), 'disconnecting PSS keeps its people as the team’s own, editable');

  // ----- export -----
  r = await J('POST', '/api/exports', { kind: 'team' });
  ok(r.status === 200, 'an owner can export the team');

  // ----- before Contacts: leads kept on the connection move in, once; an unsubscribe link -----
  await stop();
  const db = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
  for (const [id, x] of Object.entries(db.contacts)) if (x.wsId === wsId && x.name !== 'Pat Lee') delete db.contacts[id];
  db.pss[wsId] = { url: `http://127.0.0.1:${PSS_PORT}`, sealed: 'x', last4: 'kkkk', by: 'Jo', at: Date.now(), tried: Date.now(), dne: [],
    leads: [{ id: 'old-1', name: 'Old Lead', email: 'old@example.com', phone: '', address: '', city: 'Waco', source: 'Website', stage: 'new', createdAt: 1, dne: false },
      { id: 'lead-1', name: 'Pat Lee', email: 'pat@example.com', phone: '', address: '', city: 'Austin', source: 'Website', stage: 'quoted', createdAt: 1, dne: false }] };
  db.unsubs = { tok123: { id: 'tok123', wsId, email: 'pat@example.com', createdAt: Date.now() } };
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  await start();
  all = await list();
  ok(all.some((x) => x.pss === 'old-1' && x.name === 'Old Lead') && all.filter((x) => x.name === 'Pat Lee').length === 1, 'leads kept before Contacts become contacts, matched to ones already there');
  await sleep(1200);
  ok(!JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8')).pss[wsId].leads, 'and aren’t kept twice');

  let page = await fetch(B + '/unsubscribe/tok123');
  let html = await page.text();
  ok(page.status === 200 && html.includes('Unsubscribe from Shades') && html.includes('method="post"'), 'the unsubscribe link asks first (a link checker doesn’t unsubscribe anyone)');
  page = await fetch(B + '/unsubscribe/tok123', { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  ok(page.status === 200 && (await page.text()).includes('You’re unsubscribed'), 'clicking it (or a mail app’s one-click) unsubscribes');
  ok((await list()).find((x) => x.name === 'Pat Lee')?.ownDne === true, 'and marks the contact do not contact');
  ok((await fetch(B + '/unsubscribe/nope')).status === 404, 'a made-up link finds nothing');
} finally {
  await stop().catch(() => {});
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
