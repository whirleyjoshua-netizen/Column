// Leaving a team and deleting an account: private things go, shared things stay, the business keeps what it needs.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const DIR = S + '/dk/leave';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4786, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: 'http://127.0.0.1:4799' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
  console.log(srv.log); process.exit(1);
};
const stop = async () => { srv.kill('SIGTERM'); await srv.exited; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const mails = () => { const o = DIR + '/outbox'; return fs.existsSync(o) ? fs.readdirSync(o).sort().map((f) => JSON.parse(fs.readFileSync(o + '/' + f, 'utf8'))) : []; };
const t = Date.now();
const PW = 'longenough1';
const auth = async (body) => (await call()('POST', '/auth', { password: PW, device: 'Mac', deviceId: 'd' + Math.random(), ...body })).body;
const ai = spawn('node', [new URL('fakeai.mjs', import.meta.url).pathname, S + '/dk/ai.log'], { cwd: S + '/dk', stdio: 'ignore' });
await sleep(500);
await start();

const a = await auth({ mode: 'create', workspace: 'Alpha ' + t, name: 'Jo', email: `jo${t}@t.test` });
const J = call(a.token);
const code = (await J('GET', '/state')).body.workspace.inviteCode;
const k = await auth({ mode: 'join', workspace: 'Alpha ' + t, code, name: 'Ken', email: `ken${t}@t.test` });
const K = call(k.token);
const kenId = k.workspace.members.find((x) => x.name === 'Ken').id;

// Ken's things in Alpha
await K('POST', '/entries', { text: 'KEN-DAY-ENTRY', date: '2026-11-03' });
await K('POST', '/money', { kind: 'out', amount: 12, category: 'Lunch', note: 'KEN-PERSONAL-MONEY', day: '2026-11-03' });
const privCamp = (await K('POST', '/campaigns', { name: 'KEN-PRIVATE-CAMPAIGN', private: true })).body;
const shared = (await K('POST', '/campaigns', { name: 'Ken’s shared campaign' })).body;
const doc = (await K('POST', '/items', { type: 'text', text: 'Ken’s shared doc' })).body;
const task = (await J('POST', '/tasks', { text: 'Ken does this', assigneeId: kenId })).body;
const dir = (await K('POST', '/dirs', { name: 'KEN-PRIVATE-FOLDER', private: true })).body;
await K('POST', '/items', { type: 'text', text: 'KEN-PRIVATE-DOC', dirId: dir.id });
const kk = await K('PUT', '/ai/keys/anthropic', { key: 'sk-KENSKEY-1234567890' });
ok(kk.status === 200 && privCamp.id && shared.id && doc.id && task.assigneeId === kenId && dir.id, 'Ken has private and shared things in Alpha');

const kenState = JSON.stringify((await K('GET', '/state')).body) + JSON.stringify((await K('GET', '/money')).body || '') + JSON.stringify((await K('GET', '/ai/keys')).body || '');
for (const mark of ['KEN-DAY-ENTRY', 'KEN-PERSONAL-MONEY', 'KEN-PRIVATE-CAMPAIGN', 'KEN-PRIVATE-FOLDER', 'KEN-PRIVATE-DOC']) ok(kenState.includes(mark), `(${mark} was really there)`);
// Leaving
let r = await K('POST', '/account/leave', { password: 'wrongpass1' });
ok(r.status === 403, 'leaving needs your password');
r = await J('POST', '/account/leave', { password: PW });
ok(r.status === 409 && /only owner/.test(r.body.error), 'the only owner can’t leave a team with people in it');
r = await K('POST', '/account/leave', { password: PW });
ok(r.status === 200, 'Ken leaves Alpha');
ok((await K('GET', '/state')).status === 401, 'he’s signed out of it');
let st = (await J('GET', '/state')).body;
ok(!st.workspace.members.some((x) => x.name === 'Ken'), 'he’s no longer on the team');
ok(st.items.some((x) => x.id === doc.id && x.by === 'Ken'), 'his shared doc stays, under his name');
ok(st.tasks.find((x) => x.id === task.id)?.assigneeId === null, 'the task given to him is unassigned');
const sc = st.campaigns.find((x) => x.id === shared.id);
ok(sc && sc.ownerId === a.workspace.members[0].id, 'his shared campaign stays, now run by an owner');
r = await call()('POST', '/auth', { mode: 'email', email: `ken${t}@t.test`, password: PW, device: 'Mac', deviceId: 'dk' });
ok(r.status === 404, 'his account is still there, with no team now');

// An owner removing someone also clears their private things
const l = await auth({ mode: 'join', workspace: 'Alpha ' + t, code, name: 'Lu' });
await call(l.token)('POST', '/entries', { text: 'LU-DAY-ENTRY', date: '2026-11-03' });
r = await J('DELETE', '/members/' + l.workspace.members.find((x) => x.name === 'Lu').id);
ok(r.status === 200 && !r.body.members.some((x) => x.name === 'Lu'), 'an owner removes Lu');

// Deleting an account: Ken in Beta (member), Solo (alone), Delta (only owner, with Mo)
const b = await auth({ mode: 'create', workspace: 'Beta ' + t, name: 'Bo', email: `bo${t}@t.test` });
const Bo = call(b.token);
const kb = await auth({ mode: 'join', workspace: 'Beta ' + t, code: (await Bo('GET', '/state')).body.workspace.inviteCode, name: 'Ken', email: `ken${t}@t.test` });
const KB = call(kb.token);
const kenDoc = (await KB('POST', '/items', { type: 'text', text: 'Ken’s note in Beta' })).body;
const solo = await auth({ mode: 'create', workspace: 'Solo ' + t, name: 'Ken', email: `ken${t}@t.test` });
await call(solo.token)('POST', '/items', { type: 'text', text: 'KEN-SOLO-TEAM-DOC' });
const d = await auth({ mode: 'create', workspace: 'Delta ' + t, name: 'Ken', email: `ken${t}@t.test` });
const KD = call(d.token);
const mo = await auth({ mode: 'join', workspace: 'Delta ' + t, code: (await KD('GET', '/state')).body.workspace.inviteCode, name: 'Mo' });
r = await KB('POST', '/account/delete', { password: PW });
ok(r.status === 409 && /only owner of Delta/.test(r.body.error), 'deleting is stopped while he’s the only owner of Delta, which has Mo in it');
const moId = mo.workspace.members.find((x) => x.name === 'Mo').id;
await KD('PATCH', '/members/' + moId, { role: 'owner' });
const before = mails().length;
r = await KB('POST', '/account/delete', { password: PW });
ok(r.status === 200, 'with Mo an owner too, Ken deletes his account');
r = await call()('POST', '/auth', { mode: 'email', email: `ken${t}@t.test`, password: PW, device: 'Mac', deviceId: 'dk' });
ok(r.status === 401, 'his email and password no longer work');
ok((await KD('GET', '/state')).status === 401 && (await call(solo.token)('GET', '/state')).status === 401, 'every sign-in of his is gone');
st = (await Bo('GET', '/state')).body;
ok(!st.workspace.members.some((x) => x.name === 'Ken') && st.items.some((x) => x.id === kenDoc.id), 'he’s out of Beta; his note there stays');
ok(!(await call(mo.token)('GET', '/state')).body.workspace.members.some((x) => x.name === 'Ken'), 'and out of Delta, which carries on with Mo');
r = await call()('POST', '/auth', { mode: 'create', workspace: 'Solo ' + t, name: 'Zed', password: PW, device: 'Mac', deviceId: 'dz' });
ok(r.status === 200, 'his one-person team was deleted (its name is free)');
await sleep(300);
ok(mails().slice(before).some((x) => x.to === `ken${t}@t.test` && /account was deleted/.test(x.subject)), 'he gets an email saying it’s done');

await stop();
const raw = fs.readFileSync(DIR + '/db.json', 'utf8');
for (const mark of ['KEN-DAY-ENTRY', 'KEN-PERSONAL-MONEY', 'KEN-PRIVATE-CAMPAIGN', 'KEN-PRIVATE-FOLDER', 'KEN-PRIVATE-DOC', 'LU-DAY-ENTRY', 'KEN-SOLO-TEAM-DOC', `ken${t}@t.test`]) ok(!raw.includes(mark), `${mark} is gone from the data`);
const dbj = JSON.parse(raw);
ok(dbj.ai[`${a.workspace.id}:${kenId}`] === undefined && dbj.ai[`${a.workspace.id}:${a.workspace.members[0].id}`] === undefined, 'his AI key in Alpha is gone');
console.log(fails ? fails + ' failed' : 'all passed');
ai.kill();
process.exit(fails ? 1 : 0);
