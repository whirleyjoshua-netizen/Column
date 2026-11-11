// Audit (docs/audit/FINDINGS.md): A12 only a hash of each sign-in is stored (old ones converted at start), and a
// sign-in ends 180 days after it was made; A11 wrong passwords from one place can't lock someone else out; A14 "sign
// out everywhere else" keeps only this sign-in and the ones this browser holds, not every one claiming its device id.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_signin';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4934, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv = null;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', TRUST_PROXY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const stop = async () => { const p = new Promise((r) => srv.on('exit', r)); srv.kill(); await p; };
const call = (tok, ip = '203.0.113.1') => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const readDb = () => JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
const t = Date.now();
try {
  await start();
  const email = `jo${t}@t.test`;
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Signin ' + t, name: 'Jo', email, password: 'longenough1', device: 'Mac', deviceId: 'dev-1' });
  const tok1 = r.body.token;
  ok((await call(tok1)('GET', '/state')).status === 200, '(setup) Jo is signed in');

  // A12: what's stored.
  await stop();
  let raw = fs.readFileSync(DIR + '/db.json', 'utf8');
  ok(!raw.includes(tok1), 'A12 the sign-in itself isn’t stored, only its hash');
  // An older data file with a sign-in kept as it is: converted at start, and it keeps working.
  const db = readDb();
  const old = 'old' + crypto.randomBytes(16).toString('hex');
  const any = Object.values(db.tokens)[0];
  db.tokens[old] = { ...any, createdAt: Date.now(), lastSeen: Date.now(), deviceId: 'dev-old' };
  // And one made 200 days ago, still used every day.
  const ancient = 'anc' + crypto.randomBytes(16).toString('hex');
  db.tokens[ancient] = { ...any, createdAt: Date.now() - 200 * 864e5, lastSeen: Date.now(), deviceId: 'dev-anc' };
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  await start();
  ok((await call(old)('GET', '/state')).status === 200, 'A12 a sign-in from before still works after the change');
  ok((await call(ancient)('GET', '/state')).status === 401, 'A12 a sign-in made 200 days ago has ended, however much it was used');
  await call(tok1)('POST', '/tasks', { text: 'force a save' });
  await sleep(1500);
  await stop();
  raw = fs.readFileSync(DIR + '/db.json', 'utf8');
  ok(!raw.includes(old), 'A12 and it’s kept by its hash from then on');
  await start();
  ok((await call(tok1)('GET', '/state')).status === 200 && (await call(old)('GET', '/state')).status === 200, 'A12 sign-ins keep working after a restart');

  // A14: a third sign-in claiming the same device id as Jo's first one.
  r = await call(null, '203.0.113.50')('POST', '/auth', { mode: 'email', email, password: 'longenough1', device: 'Phone', deviceId: 'dev-2' });
  const tok2 = r.body.token;
  r = await call(null, '203.0.113.60')('POST', '/auth', { mode: 'email', email, password: 'longenough1', device: 'Mac', deviceId: 'dev-1' });
  const tok3 = r.body.token;
  ok(!!tok3, '(setup) a sign-in elsewhere that claims the same device id');
  r = await call(tok1)('POST', '/account/signout-others', { keep: [tok1] });
  ok(r.status === 200, '(setup) Jo signs out everywhere else');
  ok((await call(tok1)('GET', '/state')).status === 200, 'A14 Jo stays signed in here');
  ok((await call(tok3)('GET', '/state')).status === 401, 'A14 the one claiming the same device id is signed out');
  ok((await call(tok2)('GET', '/state')).status === 401 && (await call(old)('GET', '/state')).status === 401, 'A14 and so is every other');

  // A11: someone else guessing Jo's password from their own address.
  for (let i = 0; i < 12; i++) await call(null, '198.51.100.7')('POST', '/auth', { mode: 'email', email, password: 'wrong-guess-' + i });
  r = await call(null, '198.51.100.7')('POST', '/auth', { mode: 'email', email, password: 'longenough1' });
  ok(r.status === 429, `A11 the guesser’s address is stopped after 10 wrong tries (${r.status})`);
  r = await call(null, '203.0.113.50')('POST', '/auth', { mode: 'email', email, password: 'longenough1', device: 'Phone', deviceId: 'dev-2' });
  ok(r.status === 200 && !!r.body.token, `A11 but Jo, from her own address, still signs in (${r.status})`);

} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv?.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
