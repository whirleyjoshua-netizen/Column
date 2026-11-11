// Two-step sign-in: turning it on (scan, confirm with a code, backup codes), signing in with email and password then
// a code (wrong codes count toward the lockout, a code can't be used twice, a backup code works once), joining or
// making another team with that account, the team-name sign-in of a login that has it, new backup codes and turning
// it off (password and code), and the secret kept encrypted.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { totp } from '../server/twostep.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/twostep';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4749, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const step = () => Math.floor(Date.now() / 30_000);
const t = Date.now();
const email = `jo${t}@t.test`;
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Two ' + t, name: 'Jo', email, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  ok((await jo('GET', '/account/two-step')).body.on === false, 'off to start with');
  // Turning it on.
  // Turning it on needs a confirmed email and the password.
  ok((await jo('POST', '/account/two-step/start', { password: 'longenough1' })).status === 403, 'not before the email is confirmed');
  const OUT = DIR + '/outbox';
  const vcode = fs.readdirSync(OUT).sort().map((f) => JSON.parse(fs.readFileSync(OUT + '/' + f, 'utf8'))).filter((x) => x.to === email).at(-1).text.match(/\b(\d{6})\b/)[1];
  await jo('POST', '/account/verify', { code: vcode });
  ok((await jo('POST', '/account/two-step/start', {})).status === 403, 'not without the password');
  r = await jo('POST', '/account/two-step/start', { password: 'longenough1' });
  const secret = r.body.secret.replace(/\s/g, '');
  ok(/^[A-Z2-7]{32}$/.test(secret) && r.body.uri.startsWith('otpauth://totp/Kloomie:') && r.body.uri.includes('issuer=Kloomie') && r.body.qr.startsWith('data:image/svg+xml;base64,'), 'a secret, an otpauth link and a QR code to scan');
  ok((await jo('GET', '/account/two-step')).body.on === false, 'not on until a code is entered');
  ok((await jo('POST', '/account/two-step/confirm', { code: '000000' })).status === 400, 'a wrong code doesn’t turn it on');
  r = await jo('POST', '/account/two-step/confirm', { code: totp(secret, step()) });
  ok(r.status === 200 && r.body.on && r.body.backup.length === 10 && r.body.backup.every((c) => /^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c)), 'the right code turns it on, with 10 backup codes');
  const backup = r.body.backup;
  await sleep(600);
  const dbText = fs.readFileSync(DIR + '/db.json', 'utf8');
  ok(!dbText.includes(secret) && !dbText.includes(backup[0]), 'the secret and backup codes aren’t kept as written');

  // Signing in.
  const signin = (extra) => call()('POST', '/auth', { mode: 'email', email, password: 'longenough1', device: 'Phone', deviceId: 'd2', ...extra });
  r = await signin();
  ok(r.status === 401 && r.body.twoStep && !r.body.token, 'the right password alone isn’t enough: it asks for the code');
  r = await call()('POST', '/auth', { mode: 'email', email, password: 'wrong-pass', device: 'Phone', deviceId: 'd2' });
  ok(r.status === 401 && !r.body.twoStep, 'a wrong password doesn’t say whether there’s a code');
  r = await signin({ otp: '123456' });
  ok(r.status === 401 && r.body.twoStep && /isn’t right/.test(r.body.error), 'a wrong code is refused');
  // The next step's code (allowed for clock drift), so it can't be the one used to turn it on.
  const now = totp(secret, step() + 1);
  r = await signin({ otp: now });
  ok(r.status === 200 && r.body.token, 'the code from the app signs in');
  r = await signin({ otp: now });
  ok(r.status === 401 && r.body.twoStep, 'the same code can’t be used twice');
  r = await signin({ otp: backup[0].toUpperCase().replace('-', '') });
  ok(r.status === 200 && r.body.token, 'a backup code works (any case, dash or not)');
  r = await signin({ otp: backup[0] });
  ok(r.status === 401, 'but only once');
  ok((await jo('GET', '/account/two-step')).body.backupLeft === 9, '9 backup codes left');

  // The same account joining another team.
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Jo', email, password: 'longenough1', device: 'Mac', deviceId: 'd3' });
  ok(r.status === 401 && r.body.twoStep, 'making another team with the account asks for the code too');
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Jo', email, password: 'longenough1', device: 'Mac', deviceId: 'd3', otp: backup[1] });
  ok(r.status === 200 && r.body.token, 'and goes ahead with it');
  // The old team-name sign-in for this login.
  r = await call()('POST', '/auth', { mode: 'signin', workspace: 'Two ' + t, name: 'Jo', password: 'longenough1', device: 'Mac', deviceId: 'd4' });
  ok(r.status === 401 && r.body.twoStep, 'signing in with the team name asks for the code too');

  // New backup codes and turning it off need the password and a code.
  ok((await jo('POST', '/account/two-step/backup', { password: 'longenough1', code: '000000' })).status !== 200, 'new backup codes need a right code');
  r = await jo('POST', '/account/two-step/backup', { password: 'longenough1', code: backup[2] });
  ok(r.status === 200 && r.body.backup.length === 10 && !r.body.backup.includes(backup[3]), 'new backup codes replace the old ones');
  const backup2 = r.body.backup;
  ok((await jo('DELETE', '/account/two-step', { password: 'nope', code: backup2[0] })).status !== 200, 'turning it off needs the password');
  r = await jo('DELETE', '/account/two-step', { password: 'longenough1', code: backup2[1] });
  ok(r.status === 200 && r.body.on === false, 'off with the password and a code');
  ok((await signin()).status === 200, 'and the password alone signs in again');

  // Wrong codes count toward the lockout (last: it locks this address for a while).
  const s2 = (await jo('POST', '/account/two-step/start', { password: 'longenough1' })).body.secret.replace(/\s/g, '');
  await jo('POST', '/account/two-step/confirm', { code: totp(s2, step()) });
  let locked = false;
  for (let i = 0; i < 12 && !locked; i++) locked = (await signin({ otp: '000000' })).status === 429;
  ok(locked, 'too many wrong codes locks sign-in for a while, like wrong passwords');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log(srv.log.slice(-2000));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
