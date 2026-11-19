// Send proof (workspace profile step 2, 2026-11-19): a link a customer or GC opens to see the business's licenses and
// insurance, only the items picked, with a copy of each and nothing else. The token is kept only as a hash; a link
// expires and can be turned off (by whoever made it, or an admin); it always shows the items as they are now; text
// goes into the page as text; and there are limits.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/proof_links';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4947, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const page = async (path) => { const r = await fetch(B + path); return { status: r.status, text: await r.text(), r }; };
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Proof ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const joTok = r.body.token, jo = call(joTok), code = r.body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Proof ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  const prof = (await jo('GET', '/profile')).body.project, lt = prof.types[0];
  const F = (k) => lt.fields.find((f) => f.key === k).id;
  const gl = lt.fields.find((f) => f.key === 'kind').choices.find((c) => c.label === 'General liability insurance').id;
  const up = await (await fetch(`${B}/api/upload?name=coi.pdf`, { method: 'PUT', headers: { authorization: 'Bearer ' + joTok, 'content-type': 'application/pdf' }, body: Buffer.from('%PDF-1.4 the COI') })).json();
  ok(!!up?.id, '(setup) a COI uploaded');
  const mk = async (values) => (await jo('POST', `/projects/${prof.id}/records`, { typeId: lt.id, values })).body;
  const glRec = await mk({ [F('name')]: 'General liability <script>alert(1)</script>', [F('kind')]: gl, [F('number')]: 'GL-88231', [F('expires')]: '2030-03-01', [F('files')]: [up.id] });
  const lic = await mk({ [F('name')]: 'Contractor license', [F('number')]: '0084512', [F('expires')]: '2020-01-01' });
  const secret = await mk({ [F('name')]: 'Workers comp (not sent)', [F('number')]: 'WC-SECRET' });

  // Made.
  r = await sam('POST', '/profile/proofs', { recordIds: [glRec.id, lic.id, 'nope'], days: 30, to: 'Desert Ridge GC' });
  ok(r.status === 200 && r.body.url?.startsWith(B + '/proof/') && r.body.names.length === 2, 'a member makes a proof link of two items');
  const url = r.body.url, path = new URL(url).pathname, token = path.split('/')[2], pid = r.body.id;
  const stored = () => JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
  await sleep(2500);
  ok(!JSON.stringify(stored().proofs).includes(token), 'the token itself isn’t stored, only its hash');
  ok(!(await sam('GET', '/profile/proofs')).body.some((x) => JSON.stringify(x).includes(token)), 'and it isn’t in the list of links');

  // Opened, with no sign-in.
  let pg = await page(path);
  ok(pg.status === 200 && pg.text.includes('Proof ' + t) && pg.text.includes('GL-88231') && pg.text.includes('0084512'), 'the page shows the business and the two items');
  ok(!pg.text.includes('WC-SECRET') && !pg.text.includes('Workers comp'), 'and not the one that wasn’t picked');
  ok(!pg.text.includes('<script>alert(1)') && pg.text.includes('&lt;script&gt;'), 'a name goes in as text');
  ok(/Expired Jan 1, 2020/.test(pg.text) && /Expires Mar 1, 2030/.test(pg.text), 'it says which has expired');
  ok(pg.r.headers.get('x-robots-tag') === 'noindex' && pg.r.headers.get('referrer-policy') === 'no-referrer', 'it isn’t indexed and doesn’t leak its address');
  let f = await page(`${path}/f/${up.id}`);
  ok(f.status === 200 && f.text.includes('the COI'), 'the COI opens from it');
  // Another file of the team's, not on these items, can't be read through it.
  const other = await (await fetch(`${B}/api/upload?name=private.txt`, { method: 'PUT', headers: { authorization: 'Bearer ' + joTok }, body: Buffer.from('private stuff') })).json();
  f = await page(`${path}/f/${other.id}`);
  ok(f.status === 404 && !f.text.includes('private stuff'), 'any other file of the team’s can’t be');
  ok((await page('/proof/' + token.slice(0, -2) + 'xx')).status === 404, 'a wrong token finds nothing');
  r = await sam('GET', '/profile/proofs');
  ok(r.body.find((x) => x.id === pid)?.views === 1 && r.body[0].to === 'Desert Ridge GC', 'the team sees it was opened once, and who it was for');

  // Always as it is now: a renewed copy shows, a removed item drops off.
  await jo('PATCH', `/records/${lic.id}`, { values: { [F('expires')]: '2031-06-30' } });
  await jo('DELETE', `/records/${glRec.id}`);
  pg = await page(path);
  ok(/Expires Jun 30, 2031/.test(pg.text) && !pg.text.includes('GL-88231'), 'it shows the items as they are now (renewed; one removed drops off)');

  // Turned off: Jo (an owner) can; Sam made it too. Someone else's link only by admins.
  r = await jo('POST', '/profile/proofs', { recordIds: [lic.id], days: 7 });
  const joLink = r.body;
  ok((await sam('DELETE', '/profile/proofs/' + joLink.id)).status === 403, 'a member can’t turn off someone else’s link');
  ok((await jo('DELETE', '/profile/proofs/' + pid)).status === 200, 'an owner can');
  ok((await page(path)).status === 404 && (await page(`${path}/f/${up.id}`)).status === 404, 'and then the page and its copies are gone');
  ok((await sam('POST', '/profile/proofs', { recordIds: [] })).status === 400, 'a link needs at least one item');

  // Expired.
  r = await jo('POST', '/profile/proofs', { recordIds: [lic.id], days: 7 });
  const exPath = new URL(r.body.url).pathname, exId = r.body.id;
  srv.kill('SIGTERM'); await new Promise((res) => srv.once('exit', res));
  const d = stored(); d.proofs[exId].expiresAt = Date.now() - 1000; fs.writeFileSync(DIR + '/db.json', JSON.stringify(d));
  const srv2 = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
  ok((await page(exPath)).status === 404, 'an expired link shows nothing');

  // Limits: 20 an hour per person.
  const codes = [];
  for (let i = 0; i < 22; i++) codes.push((await call(joTok)('POST', '/profile/proofs', { recordIds: [lic.id], days: 7 })).status);
  ok(codes.includes(429) && codes.filter((c) => c === 200).length <= 20, `at most 20 links an hour per person (${codes.slice(-3).join(',')})`);
  srv2.kill();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
