// Audit (docs/audit/FINDINGS.md): A15 an email another account is switching to can't start a second account;
// E14 webhook signing secrets are stored sealed (shown once, still sign deliveries, old ones sealed at start);
// B8 a read-only team can delete itself, change passwords and remove people, not change settings or roles.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_batch7';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4923, RECV = 4924, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv = null;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE: 'price_x', STRIPE_API: 'http://127.0.0.1:4925', ALLOW_LOCAL_WEBHOOKS: '1', COLUMN_SECRET_KEY: 'cd'.repeat(32) }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const stop = async () => { const p = new Promise((r) => srv.on('exit', r)); srv.kill(); await p; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const OUT = DIR + '/outbox';
const mails = () => (fs.existsSync(OUT) ? fs.readdirSync(OUT).map((f) => JSON.parse(fs.readFileSync(OUT + '/' + f, 'utf8'))) : []);
const readDb = () => JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
const t = Date.now();
const got = [];
const recv = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; got.push({ sig: req.headers['x-kloomie-signature'], body: b }); res.end('ok'); });
await new Promise((r) => recv.listen(RECV, '127.0.0.1', r));
try {
  await start();
  // A15
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Ana ' + t, name: 'Ana', email: `ana${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ana = call(r.body.token), wsId = r.body.workspace.id, invite = r.body.workspace.inviteCode;
  // Cy joins now, for B8 later.
  const joined = await call()('POST', '/auth', { mode: 'join', workspace: 'Ana ' + t, code: invite, name: 'Cy', email: `cy${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const cyId = joined.body?.workspace?.members?.find((m) => m.name === 'Cy')?.id;
  const code0 = mails().filter((m) => m.to === `ana${t}@t.test`).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
  await ana('POST', '/account/verify', { code: code0 });
  const X = `shared${t}@t.test`;
  r = await ana('POST', '/account/email/change', { email: X, password: 'longenough1' });
  ok(r.status === 200 && r.body.pendingEmail === X, 'A15 (setup) Ana is switching to a new address, waiting for its code');
  const code1 = mails().filter((m) => m.to === X).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Bo ' + t, name: 'Bo', email: X, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  ok(r.status !== 200, `A15 nobody else can start an account with that address meanwhile (${r.status})`);
  r = await ana('POST', '/account/verify', { code: code1 });
  ok((r.status === 200 && r.body.email === X) || r.status === 400, 'A15 and Ana gets it once she enters the code (or is told it’s taken)');

  // E14
  const key = (await ana('POST', '/integrations/keys', { name: 'zap' })).body.token;
  r = await call(key)('POST', '/v1/webhooks', { url: `http://127.0.0.1:${RECV}/hook`, events: ['task.created'] });
  const secret = r.body?.secret;
  ok(r.status === 201 && /^whsec_/.test(secret || ''), 'E14 a new webhook shows its signing secret once');
  const listed = (await call(key)('GET', '/v1/webhooks')).body;
  ok(!JSON.stringify(listed).includes('whsec_'), 'E14 listing webhooks never shows a secret');
  await ana('POST', '/tasks', { text: 'Ring Lopez' });
  await sleep(800);
  const d = got.at(-1);
  const [ts, v1] = (d?.sig || '').split(',').map((x) => x.split('=')[1]);
  ok(d && v1 === crypto.createHmac('sha256', secret).update(`${ts}.${d.body}`).digest('hex'), 'E14 deliveries are signed with that secret');
  await stop();
  ok(!fs.readFileSync(DIR + '/db.json', 'utf8').includes(secret), 'E14 the secret isn’t stored in plain text');
  ok(Object.values(readDb().users).filter((u) => u.email === X).length === 1, 'A15 one account per address');
  // An older webhook kept in plain text is sealed when the server starts, and still signs with the same secret.
  const db = readDb();
  const hid = Object.keys(db.webhooks)[0];
  const old = 'whsec_' + 'o'.repeat(32);
  delete db.webhooks[hid].sealed;
  db.webhooks[hid].secret = old;
  // B8 setup while stopped: the trial has ended.
  db.workspaces[wsId].billing.trialEnds = Date.now() - 1000;
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  await start();
  await sleep(300);
  await stop();
  ok(!fs.readFileSync(DIR + '/db.json', 'utf8').includes(old), 'E14 an older plain secret is sealed at start');
  await start();
  // B8
  ok((await ana('POST', '/tasks', { text: 'after' })).status === 402, 'B8 (setup) the team is read-only');
  ok((await ana('PATCH', '/workspace', { name: 'Renamed' })).status === 402, 'B8 a read-only team can’t change its settings');
  if (cyId) {
    ok((await ana('PATCH', '/members/' + cyId, { role: 'admin' })).status === 402, 'B8 nor anyone’s role');
    ok((await ana('DELETE', '/members/' + cyId)).status === 200, 'B8 but it can remove people (fewer seats)');
  } else ok(false, `B8 (setup) Cy couldn’t join (${joined.status} ${JSON.stringify(joined.body).slice(0, 200)})`);
  ok((await ana('POST', '/members/me/password', { current: 'longenough1', next: 'longenough9' })).status === 200, 'B8 and change a password');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv?.kill();
  recv.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
