// Websites (Settings → Website): an owner asks Kloomie to build the team's website (a package, website care or not,
// what they want), Kloomie's own people (KLOOMIE_STAFF_EMAILS) are emailed and see every request, move it along
// (building, review, live with its address) and the team is told each time. Asking turns on lead capture, so the new
// site's contact form can send leads into Contacts from day one. A team with a site already saves its address.
// Members can't ask or see it; one open request at a time; a request can be withdrawn until work starts.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/website';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5480, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const t = Date.now();
const STAFF = `staff${t}@kloomie.test`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', KLOOMIE_STAFF_EMAILS: `Someone@else.test, ${STAFF.toUpperCase()}`, WEBSITE_EMAIL: 'builds@kloomie.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const outbox = () => { try { return fs.readdirSync(DIR + '/outbox').map((f) => JSON.parse(fs.readFileSync(DIR + '/outbox/' + f, 'utf8'))); } catch { return []; } };
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Roof ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Roof ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Kloomie HQ ' + t, name: 'Josh', email: STAFF, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const staff = call(r.body.token);

  ok((await sam('GET', '/website')).status === 403, 'members can’t see the website page');
  r = await jo('GET', '/website');
  ok(r.status === 200 && r.body.packages?.length >= 2 && r.body.packages.every((p) => p.key && p.name && p.price > 0 && p.pages > 0) && r.body.care?.price > 0, 'it lists the packages and website care, with prices');
  ok(!r.body.req && !r.body.own && r.body.staff === false, 'nothing asked for yet, no site saved, and Jo isn’t Kloomie staff');
  ok((await jo('GET', '/state')).body.me.staff !== true && (await staff('GET', '/state')).body.me.staff === true, 'the app knows who is Kloomie staff');
  ok((await jo('GET', '/website/staff')).status === 403, 'only Kloomie staff see everyone’s requests');

  // A site they already have.
  ok((await jo('PUT', '/website', { own: 'javascript:alert(1)' })).status === 400, 'a site address must be a web address');
  r = await jo('PUT', '/website', { own: 'roofco.test' });
  ok(r.status === 200 && r.body.own === 'https://roofco.test', 'a site they already have is saved (https added)');

  // Asking for one.
  ok((await sam('POST', '/website/request', { pkg: 'basic' })).status === 403, 'members can’t ask for a website');
  ok((await jo('POST', '/website/request', { pkg: 'mega' })).status === 400, 'an unknown package is refused');
  ok((await jo('GET', '/lead-capture')).body.on === false, 'lead capture is off before asking');
  r = await jo('POST', '/website/request', { pkg: 'standard', care: true, business: 'Roofing, Las Vegas', pages: 'Home, Services, Reviews', notes: 'Purple like our trucks <b>', phone: '702-555-0100', current: '' });
  ok(r.status === 201 && r.body.req?.status === 'requested' && r.body.req.pkg === 'standard' && r.body.req.care === true && r.body.req.byName === 'Jo', 'Jo asks for the Standard site with website care');
  ok(r.body.req.notes === 'Purple like our trucks <b>', 'what they wrote is kept as written');
  ok((await jo('GET', '/lead-capture')).body.on === true, 'asking turns lead capture on, ready for the new site’s form');
  const mail = outbox().find((x) => x.to === 'builds@kloomie.test');
  ok(mail && /Roof /.test(mail.subject) && /Standard/.test(mail.text) && /website care/i.test(mail.text) && /Purple like our trucks/.test(mail.text) && mail.replyTo === `jo${t}@t.test`, 'Kloomie is emailed the request, and a reply goes to Jo');
  ok(mail && mail.html.includes('trucks &lt;b&gt;') && !mail.html.includes('<b>'), 'what they wrote can’t add to the email’s HTML');
  ok((await jo('POST', '/website/request', { pkg: 'basic' })).status === 409, 'one open request at a time');

  // Kloomie's side.
  r = await staff('GET', '/website/staff');
  const mine = r.body?.list?.find((x) => x.team === 'Roof ' + t);
  ok(r.status === 200 && mine && mine.req.pkg === 'standard' && mine.email === `jo${t}@t.test` && mine.leadsOn === true, 'staff see the request, who asked, and that its leads are ready');
  ok((await jo('PUT', '/website/staff/' + mine.wsId, { status: 'live' })).status === 403, 'a team can’t move its own request');
  ok((await staff('PUT', '/website/staff/' + mine.wsId, { status: 'nope' })).status === 400, 'an unknown status is refused');
  r = await staff('PUT', '/website/staff/' + mine.wsId, { status: 'building', note: 'Got your photos, starting now' });
  ok(r.status === 200 && r.body.req.status === 'building', 'staff mark it building');
  let st = (await jo('GET', '/state')).body;
  ok(st.notices.some((n) => /Your website/.test(n.title) && /Building/i.test(n.title) && /Got your photos/.test(n.text) && n.go === 'settings:website'), 'the team is told, with the note, and it opens the Website page');
  ok((await jo('DELETE', '/website/request')).status === 409, 'once work starts it can’t be withdrawn from the app');
  ok((await staff('PUT', '/website/staff/' + mine.wsId, { status: 'live' })).status === 400, 'live needs the site’s address');
  r = await staff('PUT', '/website/staff/' + mine.wsId, { status: 'live', url: 'https://roofco-new.test' });
  ok(r.status === 200 && r.body.req.status === 'live', 'staff mark it live with its address');
  r = await jo('GET', '/website');
  ok(r.body.req.status === 'live' && r.body.own === 'https://roofco-new.test' && r.body.req.updates.length >= 3, 'the team sees it live, the new address is their site, with each step on the way');
  ok(r.body.leads.on === true && typeof r.body.leads.count === 'number', 'and how many leads it has sent');
  r = await jo('POST', '/website/request', { pkg: 'basic', notes: 'A second site for the gutters side' });
  ok(r.status === 201 && r.body.req.status === 'requested', 'once live, a new request can be made');
  r = await jo('DELETE', '/website/request');
  ok(r.status === 200 && r.body.req === null && r.body.own === 'https://roofco-new.test', 'a request not started yet can be withdrawn, keeping the site');
  ok((await staff('GET', '/website/staff')).body.list.find((x) => x.wsId === mine.wsId)?.req?.status === 'cancelled', 'staff see it was withdrawn');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log(srv.log.slice(-2000));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
