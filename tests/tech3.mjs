// Technology & software, step 3: daily standups. Each person answers three questions for the day; the project gets a
// team report (who posted, who hasn't, blockers); a blocker becomes a task for the project lead, who hears about
// it; weekday mornings, people who haven't posted get a reminder; only the project's maker or an admin sets it up.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/tech3';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4729, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', STANDUP_TICK_MS: '300', STANDUP_FROM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Atlas ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r.body.token);
  await ada('PATCH', '/workspace', { tz: 'UTC' });
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Atlas ' + t, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token);
  const ben = await join('Ben', 2), cy = await join('Cy', 3);
  const ids = Object.fromEntries((await ada('GET', '/state')).body.workspace.members.map((m) => [m.name, m.id]));
  const p = (await ada('POST', '/projects', { template: 'tech', name: 'Atlas' })).body;

  r = await ben('GET', `/projects/${p.id}/standup`);
  ok(r.status === 200 && r.body.entries.length === 0 && r.body.waiting.length === 3 && r.body.leadId === ids.Ada && r.body.on === false, 'a project’s standup: nobody has posted, the lead is whoever made it, reminders are off');
  ok((await ben('POST', `/projects/${p.id}/standup`, {})).status === 400, 'an empty standup is refused');
  r = await ben('POST', `/projects/${p.id}/standup`, { did: 'Login screen', doing: 'Google sign-in', blocked: '' });
  ok(r.status === 200 && r.body.entries.length === 1 && r.body.waiting.length === 2 && r.body.blockers === 0, 'Ben posts: the report has him, and two are still to post');
  r = await cy('POST', `/projects/${p.id}/standup`, { did: 'Dashboard layout', doing: 'API integration', blocked: 'Need the API key for staging' });
  ok(r.body.blockers === 1, 'Cy is blocked');
  const tasks = (await ada('GET', '/state')).body.tasks;
  const tk = tasks.find((x) => /Unblock Cy: Need the API key/.test(x.text));
  ok(tk && tk.assigneeId === ids.Ada, 'Ada, the lead, gets a task to unblock Cy');
  ok((await ada('GET', '/notices')).body.some((n) => /Cy is blocked/.test(n.title)), 'and hears about it');
  r = await cy('POST', `/projects/${p.id}/standup`, { did: 'Dashboard layout', doing: 'API integration', blocked: 'Need the API key for staging' });
  ok((await ada('GET', '/state')).body.tasks.filter((x) => /Unblock Cy/.test(x.text)).length === 1, 'posting the same blocker again doesn’t make another task');
  r = await ben('POST', `/projects/${p.id}/standup`, { did: 'Login screen', doing: 'Google sign-in, then tests' });
  ok(r.body.entries.length === 2 && r.body.entries.find((x) => x.memberId === ids.Ben).doing === 'Google sign-in, then tests', 'posting again updates your answer for the day');
  ok((await ben('GET', `/projects/${p.id}/standup?day=2020-01-01`)).body.entries.length === 0, 'another day has its own report');

  // Setting it up, and the morning reminder.
  ok((await ben('PATCH', `/projects/${p.id}/standup`, { on: true })).status === 403, 'only the project’s maker or an admin sets it up');
  r = await ada('PATCH', `/projects/${p.id}/standup`, { on: true, leadId: ids.Ben });
  ok(r.body.on && r.body.leadId === ids.Ben, 'Ada turns on reminders and makes Ben the lead');
  await sleep(1200);
  const weekday = ![0, 6].includes(new Date().getUTCDay());
  const ada_n = (await ada('GET', '/notices')).body.filter((n) => /Standup for Atlas/.test(n.title));
  const ben_n = (await ben('GET', '/notices')).body.filter((n) => /Standup for Atlas/.test(n.title));
  if (weekday) ok(ada_n.length === 1 && ben_n.length === 0, 'a weekday morning: Ada (who hasn’t posted) is reminded, Ben (who has) isn’t');
  else ok(ada_n.length === 0, 'no reminders at the weekend');
  await sleep(800);
  ok((await ada('GET', '/notices')).body.filter((n) => /Standup for Atlas/.test(n.title)).length === ada_n.length, 'once a day');
  const priv = (await ada('POST', '/projects', { template: 'tech', name: 'Secret', private: true })).body;
  ok((await ben('GET', `/projects/${priv.id}/standup`)).status === 404, 'a private project’s standup is private');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
