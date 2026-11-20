// Business cards: each person's card (a draft from their account, saved, turned on once their email is confirmed),
// its address (unique, not reserved), the public page (only what's on the card, as text, noindex, a strict CSP),
// Save contact (a vCard), the QR code, counting views, saves and link taps once per visitor, "Share your info" (into
// Contacts with the card as the source, an existing contact updated not doubled, the owner told, spam traps, a
// limit per visitor), and off meaning off: the card, the Business card tool, Contacts off, the owner leaving.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/cards';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4852, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const OUT = DIR + '/outbox';
const mails = () => (fs.existsSync(OUT) ? fs.readdirSync(OUT).sort().map((f) => JSON.parse(fs.readFileSync(OUT + '/' + f, 'utf8'))) : []);
const confirm = async (who, email) => { const code = mails().filter((x) => x.to === email).at(-1)?.text.match(/\b(\d{6})\b/)?.[1]; return (await who('POST', '/account/verify', { code })).status; };
// Each visitor comes from its own address (the server sits behind a proxy here: TRUST_PROXY isn't set, so all
// requests share one address; the visitor limits are tested as one visitor).
const postForm = (url, fields) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const t = Date.now();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Card ' + t, name: 'Maria <b>Lopez</b>', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r.body.token);
  const code = (await maria('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Card ' + t, code, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  ok((await maria('GET', '/state')).body.workspace.tools.cards === true, 'a new team has the Business card tool on');

  r = await maria('GET', '/card');
  ok(r.status === 200 && r.body.id === null && r.body.off === 'new' && r.body.handle === 'maria-b-lopez-b' && r.body.email === `maria${t}@t.test` && r.body.company === 'Card ' + t, 'no card yet: a draft from the account (name, email, team) with a free address');
  r = await maria('PUT', '/card', { on: true, name: 'Maria <b>Lopez</b>', handle: 'maria' });
  ok(r.status === 403 && /Confirm your email/.test(r.body.error), 'a card can’t go on before the email is confirmed');
  r = await maria('GET', '/card');
  ok(r.body.id && r.body.on === false && r.body.handle === 'maria' && /Lopez/.test(r.body.name), 'but what she typed is kept, off, so it isn’t lost (live check 2026-11-20)');
  ok((await confirm(maria, `maria${t}@t.test`)) === 200, 'Maria confirms her email');
  r = await maria('PUT', '/card', { on: true, handle: 'maria', links: [{ label: 'Bad', url: 'javascript:alert(1)' }] });
  ok(r.status === 400, 'a link must be a web address, email or phone link (javascript: refused)');
  r = await maria('PUT', '/card', { on: true, handle: 'admin' });
  ok(r.status === 409 && /reserved/.test(r.body.error), 'reserved addresses are refused');
  r = await maria('PUT', '/card', { on: true, handle: 'maria', name: 'Maria <b>Lopez</b>', title: 'Owner', company: 'Desert Tint', phone: '(602) 555-0142', email: 'maria@deserttint.test', about: 'Window tint for cars\nand homes.',
    links: [{ label: 'Book a time', url: 'cal.com/maria' }, { label: 'Reviews', url: 'https://g.page/desert-tint' }, { url: 'mailto:quotes@deserttint.test' }] });
  ok(r.status === 200 && r.body.url === B + '/c/maria' && r.body.links.length === 3 && r.body.links[0].url === 'https://cal.com/maria' && r.body.links[2].label === 'quotes@deserttint.test' && r.body.off === null && r.body.qr.startsWith('data:image/svg+xml;base64,'), 'saved and on: its address, links made whole, a QR code for the owner');
  ok((await sam('PUT', '/card', { handle: 'maria' })).status === 409, 'someone else can’t take the same address');
  ok((await sam('GET', '/card')).body.handle === 'sam-reed', 'each person has their own card');

  // The public page.
  let res = await fetch(B + '/c/maria');
  let html = await res.text();
  ok(res.status === 200 && html.includes('Maria &lt;b&gt;Lopez&lt;/b&gt;') && !html.includes('<b>Lopez</b>') && html.includes('Owner · Desert Tint') && html.includes('tel:6025550142') && html.includes('sms:6025550142') && html.includes('mailto:maria@deserttint.test') && html.includes('href="https://cal.com/maria"'), 'the card page shows what’s on it, as text, with call, text and the links');
  ok(/script-src 'self'/.test(res.headers.get('content-security-policy')) && /default-src 'none'/.test(res.headers.get('content-security-policy')) && res.headers.get('x-robots-tag') === 'noindex', 'the page has a strict CSP and isn’t indexed');
  ok(html.includes('name="website"') && /name="t" value="\d+"/.test(html) && html.includes('Share your info with Maria'), 'with "Share your info" and its spam traps');
  ok(!html.includes(`maria${t}@t.test`) && !html.includes(`sam${t}`), 'nothing from the account that isn’t on the card');
  await fetch(B + '/c/maria');
  ok((await maria('GET', '/card')).body.views === 1, 'views are counted once per visitor');
  ok((await fetch(B + '/card.js')).headers.get('content-type').startsWith('text/javascript'), 'the page’s script is served from Kloomie');
  ok((await fetch(B + '/c/maria/qr.svg')).headers.get('content-type') === 'image/svg+xml', 'the QR code as an image');

  // Save contact.
  res = await fetch(B + '/c/maria.vcf');
  const vcf = await res.text();
  ok(res.status === 200 && res.headers.get('content-type').startsWith('text/vcard') && /attachment; filename="maria-b-lopez-b\.vcf"/.test(res.headers.get('content-disposition')), 'Save contact downloads a vCard');
  ok(vcf.startsWith('BEGIN:VCARD\r\nVERSION:3.0') && vcf.includes('FN:Maria <b>Lopez</b>') && vcf.includes('ORG:Desert Tint') && vcf.includes('TEL;TYPE=CELL:(602) 555-0142') && vcf.includes(`URL:${B}/c/maria`) && vcf.includes('NOTE:Window tint for cars\\nand homes.'), 'with the name, company, phone, card link and note');
  await fetch(B + '/c/maria.vcf');
  await fetch(B + '/c/maria/tap?i=1', { method: 'POST' });
  await fetch(B + '/c/maria/tap?i=1', { method: 'POST' });
  await fetch(B + '/c/maria/tap?i=9', { method: 'POST' });
  r = await maria('GET', '/card');
  ok(r.body.saves === 1 && r.body.links[1].taps === 1 && r.body.links[0].taps === 0, 'saves and taps on each link are counted once per visitor');

  // A photo.
  ok((await maria('PUT', '/card/photo', { data: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64') })).status === 400, 'an SVG photo is refused');
  r = await maria('PUT', '/card/photo', { data: 'data:image/png;base64,' + PNG.toString('base64') });
  ok(r.status === 200 && r.body.photo?.startsWith('/c/maria/photo/'), 'a photo is added');
  res = await fetch(B + r.body.photo);
  ok(res.status === 200 && res.headers.get('content-type') === 'image/png' && res.headers.get('x-content-type-options') === 'nosniff', 'and served as the image it is');
  ok((await (await fetch(B + '/c/maria.vcf')).text()).includes('PHOTO;ENCODING=b;TYPE=PNG:'), 'the vCard carries the photo');

  // Share your info.
  const form = (v) => postForm(B + '/c/maria', { t: String(Date.now() - 10_000), website: '', ...v });
  await form({ name: 'Bot', phone: '5551112222', website: 'http://spam.test' });
  await postForm(B + '/c/maria', { name: 'Fast bot', phone: '5551112223', t: String(Date.now()) });
  let contacts = (await maria('GET', '/contacts')).body;
  const list = Array.isArray(contacts) ? contacts : contacts.contacts;
  ok(!list.some((x) => /bot/i.test(x.name)), 'spam traps: the hidden field filled in or sent too fast, and nothing is kept');
  res = await form({ name: 'Ben Ortiz', phone: '(480) 555-0199', email: 'ben@ortiz.test', message: 'Need my truck tinted' });
  ok(res.status === 303 && res.headers.get('location') === '/c/maria?sent=1#ask', 'a visitor shares their info and is thanked');
  const all = async () => { const b = (await maria('GET', '/contacts')).body; return Array.isArray(b) ? b : b.contacts; };
  let ben = (await all()).filter((x) => x.email === 'ben@ortiz.test');
  ok(ben.length === 1 && ben[0].source === 'Business card (Maria <b>Lopez</b>)' && ben[0].tags.includes('business card') && /Need my truck tinted/.test(ben[0].note) && ben[0].phone === '(480) 555-0199', 'they land in Contacts with the card as the source and their note');
  const notes = (await maria('GET', '/notices')).body;
  ok(notes.some((n) => n.title === 'From your card: Ben Ortiz' && n.text.includes('(480) 555-0199') && n.go === 'contact:' + ben[0].id), 'the card’s owner is told who it is and how to reach them, linked to the contact');
  await form({ name: 'Ben O', email: 'BEN@ortiz.test', message: 'Also the shop windows' });
  ben = (await all()).filter((x) => x.email.toLowerCase() === 'ben@ortiz.test');
  ok(ben.length === 1 && /shop windows/.test(ben[0].note) && ben[0].name === 'Ben Ortiz', 'someone already in Contacts is updated, not doubled, and their name kept');
  r = await maria('GET', '/card');
  ok(r.body.leads === 2 && r.body.recent[0].name === 'Ben O', 'the card counts who shared and shows the latest');
  res = await form({ name: 'No way to reach' });
  ok(res.status === 400 && (await res.text()).includes('Add a phone number or an email'), 'a phone or email is needed, said on the page');
  res = await form({ name: '<img src=x onerror=alert(1)>', phone: '5550001111' });
  await form({ name: 'Five', phone: '5550001112' });
  res = await form({ name: 'Six', phone: '5550001113' });
  ok(res.status === 429, 'one visitor can share at most 5 times an hour');
  ok((await all()).some((x) => x.name === '<img src=x onerror=alert(1)>'), 'what visitors type is kept as text');

  // A member's card: what they're sent doesn't link into Contacts they can't open.
  ok((await confirm(sam, `sam${t}@t.test`)) === 200, 'Sam confirms his email');
  ok((await sam('PUT', '/card', { on: true, phone: '6025550100' })).status === 201, 'a member makes a card');
  await postForm(B + '/c/sam-reed', { name: 'Lee Park', phone: '6025559999', t: String(Date.now() - 10_000) });
  const sn = (await sam('GET', '/notices')).body.find((n) => n.title === 'From your card: Lee Park');
  ok(sn && sn.go === 'card', 'a member hears about who shared with them, pointed at their card (not Contacts)');

  // Off means off.
  await maria('PATCH', '/workspace', { tools: { contacts: false } });
  html = await (await fetch(B + '/c/maria')).text();
  ok(!html.includes('Share your info') && html.includes('Save contact'), 'Contacts off: the card shows without "Share your info"');
  ok((await form({ name: 'X', phone: '5550002222' })).status === 403, 'and nothing can be sent to it');
  await maria('PATCH', '/workspace', { tools: { contacts: true } });
  await maria('PUT', '/card', { on: false });
  ok((await fetch(B + '/c/maria')).status === 404 && (await fetch(B + '/c/maria.vcf')).status === 404, 'a card turned off isn’t there');
  await maria('PUT', '/card', { on: true });
  await maria('PATCH', '/workspace', { tools: { cards: false } });
  ok((await fetch(B + '/c/maria')).status === 404 && (await maria('GET', '/card')).status === 403, 'the Business card tool off: no cards, no editing');
  await maria('PATCH', '/workspace', { tools: { cards: true } });
  ok((await fetch(B + '/c/maria')).status === 200, 'and back on');
  ok((await sam('POST', '/account/leave', { password: 'longenough2' })).status === 200, 'Sam leaves the team');
  ok((await fetch(B + '/c/sam-reed')).status === 404, 'and his card goes with him');
  ok((await fetch(B + '/c/nobody')).status === 404 && (await fetch(B + '/c/..%2Fapi')).status === 404, 'no card at other addresses');
  r = await maria('DELETE', '/card');
  ok(r.status === 200 && (await fetch(B + '/c/maria')).status === 404 && (await maria('GET', '/card')).body.id === null, 'a card can be deleted');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails && process.env.SHOW_LOG) console.log(srv.log);
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
