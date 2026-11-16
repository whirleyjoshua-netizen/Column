// The team's workload (the owner, 2026-11-15): GET /api/workload?week=<Sunday>. For each person, how much they're
// carrying: open tasks, overdue, due that week, with no date, done that week, hours booked, job visits and campaigns
// they own, with a day-by-day split. Counts only, never what a task says, and private tasks count too ("yes"). Owners
// and admins only.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/workload';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5144, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-time-zone': 'UTC', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const key = (d) => d.toISOString().slice(0, 10);
const plus = (k, n) => key(new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5));
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Load ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const ben = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Load ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  const benId = (await ada('GET', '/state')).body.workspace.members.find((x) => x.name === 'Ben').id;
  const today = (await ada('GET', '/state')).body.today || key(new Date());
  const sunday = plus(today, -new Date(today + 'T12:00:00Z').getUTCDay());
  const wed = plus(sunday, 3);
  // Ben's load: three given to him (one overdue, one due this week, one with no date), one of his own with no date
  // and a private-sounding name, one done this week, two hours on Wednesday and a repeating 30 minutes every weekday.
  await ada('POST', '/tasks', { text: 'Late thing', assigneeId: benId, due: plus(sunday, -2) });
  await ada('POST', '/tasks', { text: 'This week thing', assigneeId: benId, due: plus(sunday, 4) });
  await ada('POST', '/tasks', { text: 'Someday thing', assigneeId: benId });
  await ben('POST', '/tasks', { text: 'Secret salary review', due: null });
  const done = (await ada('POST', '/tasks', { text: 'Finished thing', assigneeId: benId })).body;
  await ben('PATCH', '/tasks/' + done.id, { done: true });
  await ben('POST', '/entries', { text: 'Site walk', date: wed, start: 9 * 60, end: 11 * 60 });
  await ben('POST', '/entries', { text: 'Standup', date: sunday, start: 8 * 60, end: 8 * 60 + 30, repeat: 'weekdays' });
  // Ada's: one task.
  await ada('POST', '/tasks', { text: 'Ada task', due: today });

  let r = await ben('GET', '/workload?week=' + sunday);
  ok(r.status === 403, 'a member can’t see the team’s workload');
  r = await ada('GET', '/workload?week=nope');
  ok(r.status === 400, 'a bad week is turned away');
  r = await ada('GET', '/workload?week=' + sunday);
  ok(r.status === 200 && r.body.week === sunday && r.body.days.length === 7 && r.body.days[0] === sunday, 'the week runs Sunday to Saturday');
  const b = r.body.people.find((x) => x.id === benId);
  ok(!!b && b.name === 'Ben', 'Ben is listed');
  ok(b.open === 4, `Ben has 4 open tasks, his private one included (${b.open})`);
  ok(b.overdue === 1, `1 overdue (${b.overdue})`);
  ok(b.dueWeek === 1, `1 due this week (${b.dueWeek})`);
  ok(b.noDate === 2, `2 with no date (${b.noDate})`);
  ok(b.doneWeek === 1, `1 done this week (${b.doneWeek})`);
  ok(b.bookedMin === 120 + 5 * 30, `booked: 2 hours plus the weekday standups (${b.bookedMin} min)`);
  ok(b.perDay.length === 7 && b.perDay[3].min === 150 && b.perDay[0].min === 0, 'split by day: Wednesday has 2.5 hours, Sunday none');
  ok(b.perDay[4].due === 1, 'and the due task sits on Thursday');
  const a = r.body.people.find((x) => x.name === 'Ada');
  ok(a && a.open === 1, 'Ada is listed with her own task');
  const raw = JSON.stringify(r.body);
  ok(!/Secret salary|Late thing|Site walk|Standup/.test(raw), 'no task or entry text in it, just counts');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
