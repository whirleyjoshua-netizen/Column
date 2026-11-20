// Attach proof (workspace profile step 3, 2026-11-19): proof of licenses & insurance anywhere in the flow.
// {proof} in an automation's words is a link to what's current in the profile (one per customer or job, reused while
// it has a week or more left); quote and invoice pages show "Our licenses & insurance" when an owner or admin turns
// that on; a link can be "everything current" (what /proof and the AI team make); expired items never show on those.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/proof_attach';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4949, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const page = async (path) => { const r = await fetch(B + path); return { status: r.status, text: await r.text() }; };
const proofIn = (s) => String(s || '').match(/https?:\/\/[^\s"'<]+\/proof\/[\w-]+/)?.[0] || null;
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Attach ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const joTok = r.body.token, jo = call(joTok), code = r.body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Attach ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  const prof = (await jo('GET', '/profile')).body.project, lt = prof.types[0];
  const F = (k) => lt.fields.find((f) => f.key === k).id;
  const mk = async (values) => (await jo('POST', `/projects/${prof.id}/records`, { typeId: lt.id, values })).body;

  // Nothing in the profile yet: {proof} fills with nothing, and an "everything" link can't be made.
  ok((await sam('POST', '/profile/proofs', { all: true })).status === 400, 'with nothing in the profile, there’s nothing to send');
  await mk({ [F('name')]: 'General liability', [F('number')]: 'GL-88231', [F('expires')]: '2030-03-01' });
  await mk({ [F('name')]: 'Old license', [F('number')]: 'OLD-0001', [F('expires')]: '2020-01-01' });

  // Everything current, as /proof and the AI team make it.
  r = await sam('POST', '/profile/proofs', { all: true, days: 7, to: 'Desert Ridge GC' });
  ok(r.status === 200 && proofIn(r.body.url) && r.body.names.join() === 'General liability', 'a member makes an “everything current” link: it leaves out what’s expired');
  const allPath = new URL(r.body.url).pathname;
  let pg = await page(allPath);
  ok(pg.status === 200 && pg.text.includes('GL-88231') && !pg.text.includes('OLD-0001'), 'its page shows what’s current');
  const later = await mk({ [F('name')]: 'Workers comp', [F('number')]: 'WC-777', [F('expires')]: '2031-01-01' });
  ok((await page(allPath)).text.includes('WC-777'), 'and something added later shows too');

  // {proof} in an automation's words.
  r = await jo('POST', '/automations', { name: 'Proof for leads', trigger: { kind: 'contact.created' }, actions: [{ kind: 'task', text: 'Send {contact} our proof: {proof}' }] });
  ok(r.status === 200, '(setup) an automation with {proof}');
  const dana = (await jo('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test' })).body;
  const danaId = dana.id ?? dana.contact?.id;
  let task = null;
  for (let i = 0; i < 40 && !task; i++) { await sleep(150); task = (await jo('GET', '/state')).body.tasks?.find((x) => /Dana Ruiz our proof/.test(x.text)); }
  const link1 = proofIn(task?.text);
  ok(!!link1, `{proof} becomes a proof link (${task?.text})`);
  pg = await page(new URL(link1).pathname);
  ok(pg.status === 200 && pg.text.includes('GL-88231') && pg.text.includes('WC-777') && !pg.text.includes('OLD-0001'), 'that link shows what’s current');
  // The same customer again reuses it (no pile of links); another customer gets their own.
  await jo('PATCH', '/contacts/' + danaId, { notes: 'x' });
  const runOn = async (name) => {
    await jo('POST', '/contacts', { name, email: name.toLowerCase().replace(/\W/g, '') + '@x.test' });
    let tk = null;
    for (let i = 0; i < 40 && !tk; i++) { await sleep(150); tk = (await jo('GET', '/state')).body.tasks?.find((x) => x.text.includes(name + ' our proof')); }
    return proofIn(tk?.text);
  };
  const link2 = await runOn('Ray Ortiz');
  ok(link2 && link2 !== link1, 'another customer gets their own link');
  let list = (await jo('GET', '/profile/proofs')).body;
  const auto = list.filter((x) => x.auto);
  ok(auto.length === 2 && auto.every((x) => x.live && x.all), 'the team sees the automation’s links in Proof links sent');
  ok((await sam('DELETE', '/profile/proofs/' + auto[0].id)).status === 403, 'a member can’t turn off an automation’s link');
  ok((await jo('DELETE', '/profile/proofs/' + auto[0].id)).status === 200, 'an owner can');

  // Quote and invoice pages: off until an owner or admin turns it on.
  ok((await jo('GET', '/profile/settings')).body?.onPages === false, 'proof on quotes & invoices starts off');
  ok((await sam('PATCH', '/profile/settings', { onPages: true })).status === 403, 'a member can’t turn it on');
  const bids = (await jo('POST', '/projects', { template: 'bids', name: 'Estimating' })).body;
  const qt = bids.types.find((x) => x.key === 'quotes');
  const q = (await jo('POST', `/projects/${bids.id}/records`, { typeId: qt.id, values: { title: 'Kitchen', items: { rows: [{ desc: 'Work', qty: 1, price: 500 }] } } })).body;
  const shared = (await jo('POST', `/records/${q.id}/share`, { hours: 0 })).body;
  const qPath = '/q/' + shared.share.token;
  ok(!proofIn((await page(qPath)).text), 'a quote page has no proof link while it’s off');
  r = await jo('PATCH', '/profile/settings', { onPages: true });
  ok(r.status === 200 && r.body.onPages === true, 'an owner turns it on');
  pg = await page(qPath);
  const qLink = proofIn(pg.text);
  ok(!!qLink && /licenses &amp; insurance/i.test(pg.text), 'the quote page links “Our licenses & insurance”');
  ok((await page(new URL(qLink).pathname)).text.includes('GL-88231'), 'and it opens to what’s current');
  ok(proofIn((await page(qPath)).text) === qLink, 'the same link every time (one for the team’s pages)');

  const trades = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = trades.types[0];
  const job = (await jo('POST', `/projects/${trades.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: danaId, price: { rows: [{ desc: 'Tune-up', qty: 1, price: '300' }] } } })).body;
  const inv = (await jo('POST', `/records/${job.id}/invoices`)).body;
  const sent = (await jo('POST', `/invoices/${inv.id}/send`)).body;
  const iPath = new URL(sent.url || sent.invoice?.url).pathname;
  ok(proofIn((await page(iPath)).text) === qLink, 'the invoice page links the same proof');

  // Turned off: the pages get a fresh link next time; turned off in settings: none.
  list = (await jo('GET', '/profile/proofs')).body;
  const pagesLink = list.find((x) => x.auto && x.pages);
  ok(!!pagesLink, 'the pages’ link is in the list too');
  await jo('DELETE', '/profile/proofs/' + pagesLink.id);
  ok((await page(new URL(qLink).pathname)).status === 404, 'turned off, the old link is dead');
  const qLink2 = proofIn((await page(qPath)).text);
  ok(qLink2 && qLink2 !== qLink, 'and the quote shows a new one');
  await jo('PATCH', '/profile/settings', { onPages: false });
  ok(!proofIn((await page(qPath)).text) && !proofIn((await page(iPath)).text), 'turned off in settings, the pages show none');
  ok((await jo('GET', '/profile/proofs')).body.filter((x) => x.pages && x.live).length === 0, 'and the pages’ link is turned off with it');

  // The AI team's tool waits for a yes (it makes a link someone outside opens).
  const agents = fs.readFileSync(new URL('../server/agents.js', import.meta.url), 'utf8');
  ok(/make_proof_link[\s\S]{0,400}important:\s*true/.test(agents), 'the AI team’s make_proof_link waits for a yes');
  void later;
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
