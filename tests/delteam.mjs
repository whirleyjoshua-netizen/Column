// Deleting a team: only owners, with its name and their password; locked at once (links, keys, sign-in);
// owners can cancel; after the wait everything it owned is erased and nothing else is touched.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const DIR = S + '/dk/delt';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4788, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', ALLOW_LOCAL_WEBHOOKS: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
  console.log(srv.log); process.exit(1);
};
const stop = async () => { srv.kill('SIGTERM'); await srv.exited; };
const call = (tok) => async (m, p, body, raw) => {
  const r = await fetch(B + p, { method: m, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const mails = () => { const o = DIR + '/outbox'; return fs.existsSync(o) ? fs.readdirSync(o).sort().map((f) => JSON.parse(fs.readFileSync(o + '/' + f, 'utf8'))) : []; };
const t = Date.now();
const jo = `jo${t}@t.test`, ken = `ken${t}@t.test`;
await start();

// Team A, with one of most things; team B, which must be left alone
let r = await call()('POST', '/api/auth', { mode: 'create', workspace: 'Doomed ' + t, name: 'Jo', email: jo, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
let J = call(r.body.token);
const wsA = r.body.workspace.id;
const code = (await J('GET', '/api/state')).body.workspace.inviteCode;
r = await call()('POST', '/api/auth', { mode: 'join', workspace: 'Doomed ' + t, code, name: 'Ken', email: ken, password: 'longenough1', device: 'Mac', deviceId: 'd2' });
let K = call(r.body.token);
r = await call()('POST', '/api/auth', { mode: 'create', workspace: 'Keeper ' + t, name: 'Bo', email: `bo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd3' });
const Bo = call(r.body.token);
const wsB = r.body.workspace.id;
const boTask = (await Bo('POST', '/api/tasks', { text: 'Bo’s task stays' })).body;

const doc = (await J('POST', '/api/items', { type: 'text', text: 'Pricing notes' })).body;
const share = (await J('POST', `/api/items/${doc.id}/share`, {})).body.share;
const file = (await J('PUT', '/api/upload?name=plans.txt&type=text/plain', Buffer.from('the plans'), true)).body;
await J('POST', '/api/tasks', { text: 'Call the supplier' });
const camp = (await J('POST', '/api/campaigns', { name: 'Fleet push' })).body;
await J('POST', '/api/goals', { campaignId: camp.id, title: 'Book demos', kind: 'tasks' });
await J('PUT', '/api/ai/keys/anthropic', { key: 'sk-test-1234567890' });
const stack = (await J('POST', '/api/stacks', { name: 'Smith job' })).body.stacks.find((x) => x.name === 'Smith job');
const reqTok = (await J('POST', `/api/stacks/${stack.id}/request`, { days: 7 })).body.stacks.find((x) => x.id === stack.id)?.request?.token;
const proj = (await J('POST', '/api/projects', { template: 'bids', name: 'Estimating' })).body;
const T = Object.fromEntries(proj.types.map((x) => [x.key, x]));
const quote = (await J('POST', `/api/projects/${proj.id}/records`, { typeId: T.quotes.id, values: {} })).body;
const qTok = (await J('POST', `/api/records/${quote.id}/share`, {})).body.share.token;
const key = (await J('POST', '/api/integrations/keys', { name: 'Zapier' })).body;
await J('POST', '/api/integrations/webhooks', { url: 'http://127.0.0.1:4787/none', projectId: proj.id });
const inv = (await J('POST', '/api/invites', { emails: `sam${t}@t.test` })).body.invites[0];
const invTok = inv.link.split('/join/')[1];
ok(doc.id && share?.token && file.id && camp.id && reqTok && qTok && key.token && invTok, 'team A has docs, a shared link, a file, a campaign, a stack link, a quote link, an API key, a webhook and an invite');
const live = async () => ({
  share: (await fetch(`${B}/s/${share.token}`)).status,
  quote: (await fetch(`${B}/q/${qTok}`)).status,
  req: (await call()('GET', `/api/public/request/${reqTok}`)).status,
  key: (await fetch(`${B}/api/v1/me`, { headers: { authorization: 'Bearer ' + key.token } })).status,
  invite: (await call()('GET', `/api/public/invite/${invTok}`)).status,
});
const before = await live();
ok(Object.values(before).every((s) => s === 200), 'all its public links and its API key work: ' + JSON.stringify(before));

// Who can delete, and how
r = await K('POST', '/api/workspace/delete', { name: 'Doomed ' + t, password: 'longenough1' });
ok(r.status === 403, 'a member can’t delete the team');
r = await J('POST', '/api/workspace/delete', { name: 'Doomed', password: 'longenough1' });
ok(r.status === 400 && /Type the team’s name/.test(r.body.error), 'the team’s name has to be typed exactly');
r = await J('POST', '/api/workspace/delete', { name: 'doomed ' + t, password: 'wrongpass1' });
ok(r.status === 403, 'a wrong password is refused');
const mailsBefore = mails().length;
r = await J('POST', '/api/workspace/delete', { name: 'doomed ' + t, password: 'longenough1' });
ok(r.status === 200 && r.body.deleteAt > Date.now() + 6.9 * 86400000 && r.body.deleteBy === 'Jo', 'the owner deletes it: erased in 7 days');

// Locked
ok((await K('GET', '/api/state')).status === 401, 'Ken is signed out');
r = await call()('POST', '/api/auth', { mode: 'email', email: ken, password: 'longenough1', device: 'Mac', deviceId: 'd2' });
ok(r.status === 404, 'and can’t sign in to it');
r = await call()('POST', '/api/auth', { mode: 'join', workspace: 'Doomed ' + t, code, name: 'Newbie', password: 'longenough1', device: 'Mac', deviceId: 'd9' });
ok(r.status === 403, 'nobody can join it');
r = await J('GET', '/api/state');
ok(r.status === 200 && r.body.workspace.deleteAt, 'the owner still gets in, to see it’s being deleted');
r = await J('POST', '/api/tasks', { text: 'one more' });
ok(r.status === 423, 'but can’t change anything');
const locked = await live();
ok(Object.values(locked).every((s) => s === 404 || s === 401), 'every public link and the API key stop working: ' + JSON.stringify(locked));
await sleep(300);
const told = mails().slice(mailsBefore).filter((m) => /is being deleted/.test(m.subject));
ok(told.length === 2 && told.some((m) => m.to === ken) && told.some((m) => m.to === jo), 'everyone on the team with an email is told');
ok((await Bo('GET', '/api/state')).status === 200, 'the other team carries on');

// Cancel
r = await K('DELETE', '/api/workspace/delete');
ok(r.status === 401, '(Ken can’t cancel: he’s signed out)');
r = await J('DELETE', '/api/workspace/delete');
ok(r.status === 200 && !r.body.deleteAt, 'an owner cancels');
r = await call()('POST', '/api/auth', { mode: 'email', email: ken, password: 'longenough1', device: 'Mac', deviceId: 'd2' });
ok(r.status === 200, 'Ken can sign in again');
ok(Object.values(await live()).every((s) => s === 200), 'the links and key work again');
await sleep(300);
ok(mails().some((m) => m.to === ken && /won’t be deleted/.test(m.subject)), 'the team is told it’s kept');

// Delete for real, and let the week pass
r = await J('POST', '/api/workspace/delete', { name: 'Doomed ' + t, password: 'longenough1' });
const filesBefore = fs.readdirSync(DIR + '/files');
ok(filesBefore.includes(file.id), '(the uploaded file is on disk)');
await stop();
const dbf = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
dbf.workspaces[wsA].deleteAt = Date.now() - 1000;
fs.writeFileSync(DIR + '/db.json', JSON.stringify(dbf));
await start();
for (let i = 0; i < 60 && !/Erased team/.test(srv.log); i++) await sleep(500);
ok(/Erased team/.test(srv.log), 'after the wait, the team is erased');
await stop(); // saves
const raw = fs.readFileSync(DIR + '/db.json', 'utf8');
const left = Object.entries(JSON.parse(raw)).flatMap(([coll, recs]) => Object.entries(recs || {}).filter(([k, x]) => k.includes(wsA) || JSON.stringify(x).includes(wsA)).map(([k]) => coll + '/' + k));
ok(left.length === 0, 'nothing in the data mentions the team any more' + (left.length ? ': ' + left.slice(0, 10).join(', ') : ''));
ok(!raw.includes('Pricing notes') && !raw.includes('Fleet push') && !raw.includes('Smith job'), 'its docs, campaigns and stacks are gone');
ok(!fs.readdirSync(DIR + '/files').includes(file.id), 'its uploaded file is deleted from disk');
await start();
ok((await Bo('GET', '/api/state')).body.tasks.some((x) => x.id === boTask.id), 'the other team still has everything');
r = await call()('POST', '/api/auth', { mode: 'email', email: jo, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
ok(r.status === 404 && /isn’t in a team/.test(r.body.error), 'Jo’s account is kept, just with no team');
r = await call()('POST', '/api/auth', { mode: 'create', workspace: 'Doomed ' + t, name: 'Jo', email: jo, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
ok(r.status === 200, 'the team name is free again, and Jo can start over');
await stop();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
