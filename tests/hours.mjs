// The hours calculator (Team plan step 3, the owner 2026-11-20): for a week, the hours each person and the team have,
// against what's booked, and what's free. Someone's hours are their sent shifts that week (a draft doesn't count),
// else their usual hours, else an assumed 8-hour weekday; time off is none. The forecast's "overloaded" now uses the
// same hours instead of a flat 8 hours a day. Owners and admins, and members an admin lets see the team's schedule.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/hours';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5352, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-time-zone': 'UTC', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const today = new Date().toISOString().slice(0, 10);
const addDays = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const week = addDays(today, -new Date(today + 'T12:00:00Z').getUTCDay());
const next = addDays(week, 7), mon = addDays(next, 1), tue = addDays(next, 2), wed = addDays(next, 3);
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Hrs ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Hrs ' + t, code: st.workspace.inviteCode, name, email: `${n}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: n })).body.token);
  const sam = await join('Sam Reed', 'sam'), ben = await join('Ben Cho', 'ben'), amy = await join('Amy Lin', 'amy');
  st = (await rico('GET', '/state')).body;
  const id = (name) => st.workspace.members.find((m) => m.name === name).id;
  const samId = id('Sam Reed'), benId = id('Ben Cho'), amyId = id('Amy Lin'), ricoId = id('Rico Vega');
  const person = (h, mid) => h.people.find((p) => p.id === mid);

  // Who can ask.
  ok((await sam('GET', '/hours?week=' + next)).status === 403, 'members can’t, until an admin lets them see the team’s schedule');
  ok((await rico('GET', '/hours')).status === 400, 'a week is needed');

  // Nobody has said anything: an assumed 8-hour weekday, 40 hours a week each.
  r = await rico('GET', '/hours?week=' + wed);
  ok(r.status === 200 && r.body.week === next, 'any day picks its week (Sunday first): ' + r.body?.week);
  let rc = person(r.body, ricoId);
  ok(rc.available === 2400 && rc.from === 'assumed' && rc.days[0].from === 'assumed', 'with nothing set, 40 hours, assumed: ' + rc.available);

  // Sam: usual hours, Monday to Thursday 7–5 (40 h), and a day off on Wednesday.
  await sam('PUT', '/availability/me', { week: [[], [[420, 1020]], [[420, 1020]], [[420, 1020]], [[420, 1020]], [], []], off: [{ from: wed, to: wed, note: 'Dentist' }] });
  // Ben: sent shifts (Mon 8–4, 30 min break; Tue 8–12) and a draft on Wednesday that isn't sent.
  await rico('POST', '/shifts', { memberId: benId, date: mon, start: 480, end: 960, breakMin: 30 });
  await rico('POST', '/shifts', { memberId: benId, date: tue, start: 480, end: 720 });
  await rico('POST', '/shifts/send', { week: next });
  await rico('POST', '/shifts', { memberId: benId, date: wed, start: 480, end: 960 });
  // Bookings: Sam 3 hours on Wednesday (his day off), Ben 6 hours on Tuesday (his 4-hour shift), Amy 2 hours Monday.
  await sam('POST', '/entries', { text: 'Site walk', date: wed, start: 540, end: 720 });
  await ben('POST', '/entries', { text: 'Install', date: tue, start: 480, end: 840 });
  await amy('POST', '/entries', { text: 'Estimate', date: mon, start: 600, end: 720 });

  r = await rico('GET', '/hours?week=' + next);
  const H = r.body;
  const sm = person(H, samId), bn = person(H, benId), am = person(H, amyId);
  ok(sm.available === 1800 && sm.from === 'usual' && sm.offDays === 1, 'Sam: his usual 40 hours minus Wednesday off = 30: ' + sm.available);
  ok(sm.days[3].cap === 0 && sm.days[3].from === 'off' && sm.days[3].note === 'Dentist', 'Wednesday is time off, with why (for owners and admins)');
  ok(sm.days[0].cap === 0 && sm.days[0].from === 'usual', 'Sunday he doesn’t usually work');
  ok(bn.available === 690 && bn.from === 'shift', 'Ben: only his sent shifts count (7.5 h + 4 h), not the unsent draft: ' + bn.available);
  ok(bn.days[3].cap === 0, 'his draft Wednesday adds nothing until it’s sent');
  ok(bn.booked === 360 && bn.over === 0 && bn.free === 330, 'Ben: 6 hours booked, 5.5 free in the week: ' + JSON.stringify([bn.booked, bn.free]));
  ok(am.available === 2400 && am.booked === 120 && am.free === 2280, 'Amy (nothing set): 40 assumed, 2 booked, 38 free');
  ok(H.short.some((x) => x.memberId === samId && x.day === wed && x.from === 'off'), 'short: Sam is booked on his day off');
  ok(H.short.some((x) => x.memberId === benId && x.day === tue && x.cap === 240 && x.booked === 360), 'short: Ben is booked 6 hours on a 4-hour shift');
  ok(!H.short.some((x) => x.memberId === amyId), 'Amy isn’t short');
  ok(H.totals.available === sm.available + bn.available + am.available + person(H, ricoId).available && H.totals.booked === 3 * 60 + 360 + 120, 'team totals add up: ' + JSON.stringify(H.totals));

  // The forecast uses the same hours.
  if (next <= addDays(week, 27)) {
    const F = (await rico('GET', '/forecast?weeks=4')).body;
    const fb = F.people.find((p) => p.id === benId), fs2 = F.people.find((p) => p.id === samId), fa = F.people.find((p) => p.id === amyId);
    const di = (k) => F.days.indexOf(k);
    ok(fb.days[di(tue)].cap === 240 && fb.days[di(tue)].capFrom === 'shift' && fb.days[di(tue)].over, 'forecast: Ben’s 6 hours on a 4-hour shift is overloaded (it wasn’t over a flat 8): ' + JSON.stringify(fb.days[di(tue)]));
    ok(fs2.days[di(wed)].over && fs2.days[di(wed)].capFrom === 'off', 'Sam booked on his day off is overloaded');
    ok(!fa.days[di(mon)].over && fa.days[di(mon)].cap === 480, 'Amy, with nothing set, still gets 8 hours');
    ok(fb.weeks[1].cap === 690 && fb.weeks[1].over, 'Ben’s week: 11.5 hours, and over (a day is)');
    ok(F.capacityMin === 480, 'the default day is still 8 hours');
  }

  // Members, when an admin lets them: counts only, never why someone is off.
  await rico('PATCH', '/workspace', { memberAccess: { teamSchedule: true } });
  r = await sam('GET', '/hours?week=' + next);
  ok(r.status === 200 && person(r.body, samId).available === 1800, 'with the team’s schedule on, a member sees the hours');
  ok(!JSON.stringify(r.body).includes('Dentist') || person(r.body, samId).id === samId, '(own reason is fine)');
  r = await ben('GET', '/hours?week=' + next);
  ok(!JSON.stringify(r.body).includes('Dentist'), 'but another member never sees why Sam is off');
  ok(!/Error|TypeError/.test(srv.log), 'no server errors' + (/Error/.test(srv.log) ? ': ' + srv.log.slice(-600) : ''));
} catch (e) {
  ok(false, 'crashed: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
