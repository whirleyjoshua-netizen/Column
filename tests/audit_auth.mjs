// Audit (sign-in and accounts): each check states the safe behaviour. Written to reproduce the reviewer's findings
// (FAIL = the finding is real); kept as the regression test once fixed. IDs match docs/audit/FINDINGS.md.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { totp } from '../server/twostep.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_auth';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4901, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', TRUST_PROXY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
let ipN = 0;
// Each caller gets its own address unless one is given, so the per-address sign-in limit doesn't mix the checks up.
const call = (tok, ip) => async (m, p, body, headers = {}) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`, ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const step = () => Math.floor(Date.now() / 30_000);
const OUTBOX = DIR + '/outbox';
const mails = () => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().map((f) => JSON.parse(fs.readFileSync(OUTBOX + '/' + f, 'utf8'))) : []);
const codeTo = (to) => mails().filter((x) => x.to === to).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
const t = Date.now();
try {
  // A team: Jo (owner, email account), Sam (joins with email), Pat (name-only login).
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Aud ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Aud ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samTok = r.body.token, sam = call(samTok);
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Aud ' + t, code, name: 'Pat', password: 'patpass1', device: 'Mac', deviceId: 'd3' });
  const pat = call(r.body.token);
  const members = (await jo('GET', '/state')).body.workspace.members;
  const samId = members.find((x) => x.name === 'Sam').id, patId = members.find((x) => x.name === 'Pat').id;

  // A3: plain members aren't sent the invite code.
  ok(!(await pat('GET', '/state')).body.workspace.inviteCode, 'A3 a plain member isn’t sent the team’s invite code');

  // A1: a removed admin's API key stops working.
  await jo('PATCH', '/members/' + samId, { role: 'admin' });
  r = await sam('POST', '/integrations/keys', { name: 'mine' });
  const key = r.body.token;
  ok((await call(key)('GET', '/v1/me')).status === 200, 'A1 (setup) the admin’s key works while they’re on the team');
  await jo('DELETE', '/members/' + samId);
  ok((await call(key)('GET', '/v1/me')).status === 401, 'A1 once removed, their API key stops working');
  // A3: and they can't walk back in with the code they had.
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Aud ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  ok(r.status !== 200, 'A3 a removed person can’t rejoin straight away with the old invite code');

  // A4: an admin resetting a name-only member can't then sign in as them.
  const resetR = await jo('POST', `/members/${patId}/reset`);
  const code2 = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Aud ' + t, code: code2, name: 'Pat', password: 'attacker1', device: 'Evil', deviceId: 'dx' });
  ok(!(r.status === 200 && r.body.token), 'A4 after a reset, whoever has the code can’t claim Pat by typing the name');
  ok(resetR.body?.claimCode && r.body?.claim, 'A4 the admin got a one-time reset code for Pat, and joining as Pat asks for it');
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Aud ' + t, code: code2, name: 'Pat', password: 'patnewpass1', claim: resetR.body.claimCode, device: 'Mac', deviceId: 'd3' });
  ok(r.status === 200 && r.body.token, 'A4 Pat, with that code, sets a new password and is back in');
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Aud ' + t, code: code2, name: 'Pat', password: 'again1234', claim: resetR.body.claimCode, device: 'Mac', deviceId: 'd4' });
  ok(r.status !== 200, 'A4 the reset code works once');

  // A2: two-step can't be skipped by linking a name-only login to the account.
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Vic ' + t, name: 'Vic', email: `vic${t}@t.test`, password: 'victimpass1', device: 'Mac', deviceId: 'v1' });
  const vic = call(r.body.token);
  ok((await vic('POST', '/account/two-step/start', { password: 'victimpass1' })).status === 403, 'A5 two-step can’t be turned on before the email is confirmed (nobody can squat on someone else’s address)');
  await vic('POST', '/account/verify', { code: codeTo(`vic${t}@t.test`) });
  r = await vic('POST', '/account/two-step/start', { password: 'victimpass1' });
  const secret = r.body.secret.replace(/\s/g, '');
  await vic('POST', '/account/two-step/confirm', { code: totp(secret, step()) });
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Atk ' + t, name: 'Mallory', password: 'malpass11', device: 'Evil', deviceId: 'm1' });
  const mal = call(r.body.token);
  r = await mal('POST', '/account/email', { email: `vic${t}@t.test`, password: 'victimpass1' });
  ok(r.status !== 200 && r.body?.twoStep, 'A2 knowing the password isn’t enough to link onto an account that has two-step on (it asks for the code)');
  r = await mal('POST', '/account/email', { email: `vic${t}@t.test`, password: 'victimpass1', otp: totp(secret, step() + 1) });
  ok(r.status === 200, 'A2 with the code from that account’s app, joining them up works as before');

  // A5: turning two-step on needs the password.
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Two ' + t, name: 'Tia', email: `tia${t}@t.test`, password: 'tiapass11', device: 'Mac', deviceId: 't1' });
  const tia = call(r.body.token);
  await tia('POST', '/account/verify', { code: codeTo(`tia${t}@t.test`) });
  ok((await tia('POST', '/account/two-step/start', {})).status === 403, 'A5 two-step can’t be started without the password (a stolen session can’t lock the owner out)');
  ok((await tia('POST', '/account/two-step/start', { password: 'tiapass11' })).status === 200, 'A5 with the password (and a confirmed email) it starts as before');

  // A8: guessing the current password behind a session is limited.
  const ip = '10.77.0.1';
  let limited = false;
  const tiaIp = call(tia === null ? null : (await call()('POST', '/auth', { mode: 'email', email: `tia${t}@t.test`, password: 'tiapass11', device: 'Mac', deviceId: 't2' })).body.token, ip);
  for (let i = 0; i < 14 && !limited; i++) limited = (await tiaIp('POST', '/members/me/password', { current: 'guess' + i, next: 'newpass111' })).status === 429;
  ok(limited, 'A8 wrong current passwords on change-password are limited like sign-in');

  // A6: the sign-in limit can't be dodged by changing X-Forwarded-For on each try.
  let blocked = false;
  for (let i = 0; i < 14 && !blocked; i++) {
    r = await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `1.2.3.${i}, 9.9.9.9` }, body: JSON.stringify({ mode: 'email', email: `nobody${i}x${t}@t.test`, password: 'wrong' + i }) });
    blocked = r.status === 429;
  }
  ok(blocked, 'A6 the proxy-added address (rightmost), not the client’s claim, is what the sign-in limit counts');

  // A10: sign-in doesn't say whether a team or a name exists.
  const a = (await call()('POST', '/auth', { mode: 'join', workspace: 'No Such Team ' + t, code: 'AAAAAAAA', name: 'X', password: 'whatever1' })).body?.error;
  const b = (await call()('POST', '/auth', { mode: 'join', workspace: 'Aud ' + t, code: 'AAAAAAAA', name: 'X', password: 'whatever1' })).body?.error;
  ok(a === b, `A10 a made-up team and a wrong code get the same answer (“${a}” vs “${b}”)`);

  // A13: signing out closes that session's live connection.
  r = await call()('POST', '/auth', { mode: 'email', email: `jo${t}@t.test`, password: 'longenough1', device: 'Tab', deviceId: 'd9' });
  const tok9 = r.body.token;
  const { default: WebSocket } = await import('../server/node_modules/ws/index.js');
  const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws?t=${tok9}`);
  await new Promise((res) => sock.on('open', res));
  let closed = false;
  sock.on('close', () => (closed = true));
  await call(tok9)('POST', '/logout');
  for (let i = 0; i < 30 && !closed; i++) await sleep(100);
  ok(closed, 'A13 signing out closes that session’s live updates');
  sock.terminate();

  // B1: a removed member's open live connection is closed and hears nothing more.
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Aud ' + t, code: (await jo('GET', '/state')).body.workspace.inviteCode, name: 'Kim', password: 'kimpass11', device: 'Mac', deviceId: 'k1' });
  const kimTok = r.body.token;
  const kimId = (await jo('GET', '/state')).body.workspace.members.find((x) => x.name === 'Kim').id;
  const ks = new WebSocket(`ws://127.0.0.1:${PORT}/ws?t=${kimTok}`);
  await new Promise((res) => ks.on('open', res));
  let kimClosed = false, kimHeard = false;
  ks.on('close', () => (kimClosed = true));
  ks.on('message', (d) => { if (/after-removal/.test(String(d))) kimHeard = true; });
  // The reviewer's case: the session is signed out first (so it can't be found by its token), then the person removed.
  await call(kimTok)('POST', '/logout');
  await jo('DELETE', '/members/' + kimId);
  await jo('POST', '/items', { type: 'message', text: 'after-removal secret' });
  for (let i = 0; i < 30 && !kimClosed; i++) await sleep(100);
  ok(kimClosed && !kimHeard, 'B1 someone signed out and then removed doesn’t keep a live connection that hears what’s said after');
  ks.terminate();

  // A7: signing out other devices stops notifications to them.
  r = await call()('POST', '/auth', { mode: 'email', email: `jo${t}@t.test`, password: 'longenough1', device: 'Phone', deviceId: 'p1' });
  const phone = call(r.body.token);
  await phone('POST', '/push', { sub: { endpoint: `https://push.example/${t}`, keys: { p256dh: 'BPcMbnWQL5GOYX/5LKZXT6sLmHiMsJSiEvIFvfcDvX7IZ9qqtq68onpTPEYmyxSQNiH7UD/98AgcIuj+Iwj+5sE=', auth: 'k9oHtZMk7uZdA7g3wVZRgQ==' } } });
  await sleep(700);
  const subsBefore = Object.keys(JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8')).pushSubs || {}).length;
  await jo('POST', '/account/signout-others');
  await sleep(700);
  const subsAfter = Object.keys(JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8')).pushSubs || {}).length;
  ok(subsBefore === 1 && subsAfter === 0, `A7 signing out other devices stops notifications to them (${subsBefore} → ${subsAfter})`);
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails && process.env.SHOWLOG) console.log(srv.log.slice(-2000));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
