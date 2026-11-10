// Getting started: Home's list for a new team's owners and admins, ticked by what the team has done; a welcome
// email once the owner's email is confirmed; trial reminders at 3 days, 1 day and the end, each sent once.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/onboard';
const OUTBOX = DIR + '/outbox';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4777, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(150); } return false; };
const mails = () => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().map((f) => JSON.parse(fs.readFileSync(OUTBOX + '/' + f, 'utf8'))) : []);
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE: 'price_seat', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_API: 'http://127.0.0.1:9', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', MS_CLIENT_ID: '', MS_CLIENT_SECRET: '', ONBOARD_TICK_MS: '300' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const stop = async () => { srv.kill('SIGTERM'); await srv.exited; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const edit = async (fn) => { await stop(); const db = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8')); fn(db); fs.writeFileSync(DIR + '/db.json', JSON.stringify(db)); await start(); };
const t = Date.now();
const jo = `jo${t}@t.test`;
await start();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Start ' + t, name: 'Jo', email: jo, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const J = call(r.body.token), wsId = r.body.workspace.id;
  let st = (await J('GET', '/state')).body;
  const keys = (st.start || []).map((x) => x.key);
  ok(keys.join() === 'invite,calendar,contacts,campaign,ai', 'an owner of a new team gets the list (a calendar step, since Apple Calendar or the subscribe link always works; no email step when this server can’t send): ' + keys.join());
  ok(st.start.every((x) => !x.done), 'nothing is ticked yet');

  await sleep(1200);
  ok(!mails().some((x) => x.tag === 'welcome'), 'no welcome until the owner’s email is confirmed');
  const code = mails().find((x) => x.to === jo && x.tag === 'verify')?.text.match(/\b(\d{6})\b/)?.[1];
  r = await J('POST', '/account/verify', { code });
  ok(r.status === 200, 'Jo confirms her email');
  ok(await until(() => mails().some((x) => x.to === jo && x.tag === 'welcome')), 'then the welcome email goes to her');
  const w = mails().find((x) => x.tag === 'welcome');
  ok(/Start /.test(w.subject + w.text) && /14 days/.test(w.text) && /Invite your team/.test(w.text) && w.text.includes(B), 'it names the trial, the first three steps, and links to the app');

  // Doing the steps ticks them off.
  await J('POST', '/campaigns', { name: 'Spring push' });
  await J('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test' });
  const inv = (await J('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Start ' + t, code: inv, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const Sm = call(r.body.token);
  r = await J('GET', '/home/start');
  const done = Object.fromEntries(r.body.start.map((x) => [x.key, x.done]));
  ok(done.campaign && done.contacts && done.invite && !done.ai, 'a campaign, a contact and a teammate tick their steps; the AI key is still to do');
  ok((await Sm('GET', '/state')).body.start === null, 'members don’t get the list');
  await J('PUT', '/ai/keys/anthropic', { key: 'k' }).catch(() => {});

  // Trial reminders: 3 days, 1 day, ended. Each once.
  await edit((db) => { db.workspaces[wsId].billing.trialEnds = Date.now() + 2.5 * 864e5; });
  ok(await until(() => mails().some((x) => x.tag === 'trial-3')), 'with under 3 days left, the 3-day reminder goes');
  const t3 = mails().find((x) => x.tag === 'trial-3');
  ok(t3.to === jo && /ends in 3 days/.test(t3.subject) && /\$15 a person a month: \$30 a month for the 2 people/.test(t3.text) && /billing=open/.test(t3.text), 'it says what it costs for this team and links straight to billing');
  await sleep(1000);
  ok(mails().filter((x) => x.tag === 'trial-3').length === 1, 'only once');
  await edit((db) => { db.workspaces[wsId].billing.trialEnds = Date.now() + 0.5 * 864e5; });
  ok(await until(() => mails().some((x) => x.tag === 'trial-1' && /tomorrow/.test(x.subject))), 'with under a day left, the last-day reminder goes');
  await edit((db) => { db.workspaces[wsId].billing.trialEnds = Date.now() - 3600_000; });
  ok(await until(() => mails().some((x) => x.tag === 'trial-0' && /has ended/.test(x.subject) && /read-only/.test(x.text))), 'when it ends, one more says the team is read-only and nothing is deleted');
  await sleep(1000);
  ok(['trial-3', 'trial-1', 'trial-0', 'welcome'].every((k) => mails().filter((x) => x.tag === k).length === 1), 'every email went exactly once');

  // A team that was already past a reminder's window gets nothing late.
  await edit((db) => { const ws = db.workspaces[wsId]; ws.onboard = {}; ws.billing.trialEnds = Date.now() - 5 * 864e5; ws.createdAt = Date.now() - 19 * 864e5; });
  await sleep(1200);
  ok(mails().filter((x) => /^trial|welcome/.test(x.tag || '')).length === 4, 'a trial that ended days ago, and a team older than 3 days, don’t get a late email');

  // Hiding the list.
  await edit((db) => { db.workspaces[wsId].billing.comp = true; });
  r = await J('DELETE', '/home/start');
  ok(r.status === 200 && (await J('GET', '/state')).body.start === null, 'hiding the list keeps it hidden');

  // The help page.
  r = await fetch(B + '/help');
  const page = await r.text();
  ok(r.status === 200 && /Getting started/.test(page) && /\$15 a person a month/.test(page), 'the help page is served at /help');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
await stop().catch(() => {});
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
