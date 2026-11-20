// Work shifts (Team plan step 2, the owner 2026-11-20): owners and admins build the week's shifts as a draft and Send
// them; each person whose shifts changed is told once and from then on sees what they were sent. Changing or removing
// a sent shift waits for the next Send. Usual hours and time off are the person's and owners' and admins'; the builder
// warns about time off, outside usual hours, overlaps and weeks over 40 hours. Members see their own sent shifts, and
// everyone's only when an admin lets them see the team's schedule. Someone who leaves takes their shifts with them.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/shifts';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5351, B = `http://127.0.0.1:${PORT}`;
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
const next = addDays(week, 7), nextMon = addDays(next, 1), nextTue = addDays(next, 2), nextWed = addDays(next, 3);
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Crew ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Crew ' + t, code: st.workspace.inviteCode, name, email: `${n}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: n })).body.token);
  const sam = await join('Sam Reed', 'sam'), ben = await join('Ben Cho', 'ben');
  st = (await rico('GET', '/state')).body;
  const id = (name) => st.workspace.members.find((m) => m.name === name).id;
  const samId = id('Sam Reed'), benId = id('Ben Cho');
  const notes = async (who) => (await who('GET', '/notices')).body.filter((n) => n.kind === 'shifts');

  // Building: owners and admins only.
  r = await sam('POST', '/shifts', { memberId: samId, date: nextMon, start: 420, end: 900 });
  ok(r.status === 403, 'a member can’t add shifts: ' + r.status);
  r = await rico('POST', '/shifts', { memberId: samId, date: nextMon, start: 420, end: 900, breakMin: 30, label: 'Morning' });
  ok(r.status === 200 && r.body.state === 'new' && r.body.end === 900, 'an owner adds Sam’s Monday 7–3: ' + JSON.stringify(r.body));
  const mon = r.body;
  ok((await rico('POST', '/shifts', { memberId: 'nobody', date: nextMon, start: 420, end: 900 })).status === 400, 'only someone on the team');
  ok((await rico('POST', '/shifts', { memberId: samId, date: '2026-13-40', start: 420, end: 900 })).status === 400, 'only a real day');
  ok((await rico('POST', '/shifts', { memberId: samId, date: nextMon, start: 420, end: 900, breakMin: 600 })).status === 400, 'a break can’t be longer than the shift');
  r = await rico('POST', '/shifts', { memberId: benId, date: nextTue, start: 1320, end: 360, label: 'Night' });
  ok(r.status === 200 && r.body.end === 360 + 1440, 'a 22:00–06:00 shift runs overnight: ' + r.body?.end);
  const night = r.body;

  // Nobody hears about a draft.
  r = await sam('GET', '/shifts?week=' + next);
  ok(r.status === 200 && r.body.shifts.length === 0 && r.body.canEdit === false, 'Sam sees nothing before Send: ' + JSON.stringify(r.body?.shifts));
  ok((await notes(sam)).length === 0, 'and isn’t told');
  r = await rico('GET', '/shifts?week=' + next);
  ok(r.body.canEdit && r.body.shifts.length === 2 && r.body.unsent === 2, 'the owner sees both drafts, 2 to send');
  ok(r.body.totals[samId] === 450, 'Sam’s paid time leaves out the break (7.5 h): ' + r.body.totals[samId]);

  // Send.
  ok((await sam('POST', '/shifts/send', { week: next })).status === 403, 'a member can’t Send');
  r = await rico('POST', '/shifts/send', { week: next });
  ok(r.status === 200 && r.body.people === 2, 'Send tells the two people with shifts: ' + JSON.stringify(r.body));
  let n = await notes(sam);
  ok(n.length === 1 && /Your shifts for the week of/.test(n[0].title) && /7am–3pm Morning/.test(n[0].text) && /7\.5 h/.test(n[0].text) && n[0].go === 'shifts:' + next, 'Sam is told his shifts: ' + JSON.stringify(n[0]));
  ok((await notes(rico)).length === 0, 'the sender with no shifts isn’t told');
  r = await sam('GET', '/shifts?week=' + next);
  ok(r.body.shifts.length === 1 && r.body.shifts[0].start === 420 && !('state' in r.body.shifts[0]), 'Sam now sees his own sent shift, and only his');
  r = await rico('POST', '/shifts/send', { week: next });
  ok(r.body.people === 0 && (await notes(sam)).length === 1, 'a second Send with nothing new tells nobody');

  // A change after Send waits for the next Send; Sam keeps what he was sent.
  r = await rico('PATCH', '/shifts/' + mon.id, { start: 480, end: 960 });
  ok(r.body.state === 'changed' && r.body.pub.start === 420, 'changing a sent shift is a draft again: ' + r.body.state);
  r = await sam('GET', '/shifts?week=' + next);
  ok(r.body.shifts[0].start === 420, 'Sam still sees 7am until the next Send');
  r = await rico('DELETE', '/shifts/' + night.id);
  ok(r.body.gone === true, 'removing a sent shift keeps it until Send');
  r = await ben('GET', '/shifts/mine?days=28');
  ok(r.body.shifts.length === 1 && r.body.shifts[0].label === 'Night', 'Ben still has his night shift: ' + r.body.shifts.length);
  r = await rico('POST', '/shifts/send', { week: next });
  ok(r.body.people === 2 && r.body.removed === 1, 'the next Send tells both: ' + JSON.stringify(r.body));
  n = await notes(sam);
  ok(n.length === 1 && /changed/.test(n[0].title) && /8am–4pm/.test(n[0].text), 'Sam’s notice folds into one, now “changed”, with the new hours: ' + JSON.stringify(n.map((x) => x.title)));
  n = await notes(ben);
  ok(n.length === 1 && /No shifts that week/.test(n[0].text), 'Ben is told he’s off that week: ' + n[0]?.text);
  ok((await ben('GET', '/shifts/mine?days=28')).body.shifts.length === 0, 'and his night shift is gone');
  // An unsent shift that's removed just goes.
  r = await rico('POST', '/shifts', { memberId: benId, date: nextWed, start: 600, end: 700 });
  await rico('DELETE', '/shifts/' + r.body.id);
  ok(!(await rico('GET', '/shifts?week=' + next)).body.shifts.some((s) => s.id === r.body.id), 'a draft that’s removed is simply gone');

  // Usual hours and time off: the person and owners/admins.
  const hours = [[], [[480, 1020]], [[480, 1020]], [[480, 1020]], [[480, 1020]], [[480, 1020]], []];
  r = await sam('PUT', '/availability/me', { week: hours, off: [{ from: nextWed, to: nextWed, note: 'Dentist' }] });
  ok(r.status === 200 && r.body.week[1][0][0] === 480 && r.body.off[0].note === 'Dentist', 'Sam sets his usual hours and a day off');
  ok((await ben('GET', '/availability/' + samId)).status === 403, 'another member can’t read Sam’s time off');
  ok((await ben('PUT', '/availability/' + samId, { off: [] })).status === 403, '…or change it');
  ok((await rico('GET', '/availability/' + samId)).body.off.length === 1, 'the owner can');
  ok((await sam('PUT', '/availability/me', { week: [[[600, 500]], [], [], [], [], [], []] })).status === 400, 'a stretch must end after it starts');
  ok((await sam('PUT', '/availability/me', { week: [[], [[480, 700], [600, 900]], [], [], [], [], []] })).status === 400, 'stretches on a day can’t overlap');

  // Warnings: on time off, outside usual hours, overlapping, over 40 hours. They never block.
  const wed = (await rico('POST', '/shifts', { memberId: samId, date: nextWed, start: 480, end: 960 })).body;
  const sun = (await rico('POST', '/shifts', { memberId: samId, date: next, start: 600, end: 900 })).body;
  const two = (await rico('POST', '/shifts', { memberId: samId, date: nextMon, start: 900, end: 1080 })).body;
  r = await rico('GET', '/shifts?week=' + next);
  const W = r.body.warnings;
  ok(W[wed.id]?.includes('off'), 'Wednesday is on his time off: ' + JSON.stringify(W[wed.id]));
  ok(W[sun.id]?.includes('outside'), 'Sunday is outside his usual hours');
  ok(W[two.id]?.includes('overlap') && W[mon.id]?.includes('overlap'), 'Monday 3pm–6pm overlaps his 8–4');
  ok(!W[mon.id]?.includes('outside') || false, 'his 8–4 Monday is inside his hours');
  ok(r.body.avail[samId].off.length === 1, 'the builder sees time off in the week');
  ok((await sam('GET', '/shifts?week=' + next)).body.warnings === undefined, 'members don’t get the warnings (they’d name time off)');
  for (const d of [nextTue, addDays(next, 4), addDays(next, 5)]) await rico('POST', '/shifts', { memberId: samId, date: d, start: 420, end: 1080 });
  r = await rico('GET', '/shifts?week=' + next);
  ok(r.body.over.includes(samId) && r.body.totals[samId] > 2400, 'over 40 hours is flagged: ' + r.body.totals[samId]);

  // Copy last week, without doubling.
  r = await rico('POST', '/shifts/copy', { from: next, to: addDays(next, 7) });
  const copied = r.body.copied;
  ok(copied >= 6, 'copy the week into the one after: ' + copied);
  r = await rico('POST', '/shifts/copy', { from: next, to: addDays(next, 7) });
  ok(r.body.copied === 0, 'copying again adds nothing');
  r = await rico('GET', '/shifts?week=' + addDays(next, 7));
  ok(r.body.shifts.length === copied && r.body.shifts.every((s) => s.state === 'new'), 'the copies are drafts');
  ok((await sam('GET', '/shifts/mine?days=28')).body.shifts.length === 1, 'Sam sees only what he was sent');

  // Seeing the team's shifts: off for members until an admin turns it on.
  await rico('POST', '/shifts/send', { week: next });
  r = await ben('GET', '/shifts?week=' + next);
  ok(r.body.shifts.length === 0 && r.body.people.length === 1, 'Ben sees only himself: ' + r.body.shifts.length);
  await rico('PATCH', '/workspace', { memberAccess: { teamSchedule: true } });
  r = await ben('GET', '/shifts?week=' + next);
  ok(r.body.shifts.length > 0 && r.body.shifts.every((s) => s.memberId === samId) && r.body.people.length === 3 && !r.body.avail, 'with the team’s schedule on, Ben sees everyone’s sent shifts, never their time off');

  // Saved shifts.
  ok((await sam('PUT', '/shifts/presets', { presets: [] })).status === 403, 'members can’t change saved shifts');
  r = await rico('PUT', '/shifts/presets', { presets: [{ label: 'Morning', start: 420, end: 900, breakMin: 30 }, { label: 'Late', start: 840, end: 1320 }] });
  ok(r.status === 200 && r.body.presets.length === 2, 'the owner saves two shifts');
  ok((await rico('PUT', '/shifts/presets', { presets: [{ label: '', start: 420, end: 900 }] })).status === 400, 'a saved shift needs a name');
  ok((await rico('GET', '/shifts?week=' + next)).body.presets.length === 2, 'the builder gets them');

  // Exports carry one's own shifts.
  // Someone who leaves takes their shifts and hours with them.
  ok((await rico('DELETE', '/members/' + samId)).status === 200, 'Sam is removed from the team');
  r = await rico('GET', '/shifts?week=' + next);
  ok(!r.body.shifts.some((s) => s.memberId === samId) && !r.body.avail[samId], 'his shifts and hours are gone');
  ok(!/Error|TypeError/.test(srv.log), 'no server errors' + (/Error/.test(srv.log) ? ': ' + srv.log.slice(-600) : ''));
} catch (e) {
  ok(false, 'crashed: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
