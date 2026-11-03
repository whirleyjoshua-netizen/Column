// Time zones: the team's clock, each person's own "today", and owners changing it.
import fs from 'node:fs';
const S = process.argv[2];
const B = 'http://127.0.0.1:4797/api';
const LOG = S + '/dk/ai.log';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (tok, tz) => async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(tz ? { 'x-time-zone': tz } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const dayIn = (tz) => new Date().toLocaleDateString('en-CA', { timeZone: tz });
const t = Date.now();
// Kiritimati is UTC+14 and Pago Pago UTC-11: always different days.
const EAST = 'Pacific/Kiritimati', WEST = 'Pacific/Pago_Pago';
ok(dayIn(EAST) !== dayIn(WEST), '(the two test zones are on different days)');

let r = await api(null, 'America/Los_Angeles')('POST', '/auth', { mode: 'create', workspace: 'tz ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = r.body.token;
let st = (await api(jo, 'America/Los_Angeles')('GET', '/state')).body;
ok(st.workspace.tz === 'America/Los_Angeles', 'a new team takes the time zone of the first browser it hears from');
const code = st.workspace.inviteCode;
r = await api(null, 'Asia/Tokyo')('POST', '/auth', { mode: 'join', workspace: 'tz ' + t, code, name: 'Ken', email: `ken${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd2' });
const ken = r.body.token;
st = (await api(ken, 'Asia/Tokyo')('GET', '/state')).body;
ok(st.workspace.tz === 'America/Los_Angeles', 'someone joining from elsewhere doesn’t move it');

r = await api(ken, 'Asia/Tokyo')('PATCH', '/workspace', { tz: 'Asia/Tokyo' });
ok(r.status === 403, 'only owners can change it');
r = await api(jo)('PATCH', '/workspace', { tz: 'Mars/Olympus' });
ok(r.status === 400, 'a made-up time zone is refused');
r = await api(jo)('PATCH', '/workspace', { tz: 'America/Denver' });
ok(r.status === 200 && r.body.tz === 'America/Denver', 'an owner changes it');
r = await api(jo, '<script>')('GET', '/state');
ok(r.status === 200 && r.body.workspace.tz === 'America/Denver', 'a junk time zone header is ignored');

// "Today" is the person's own day, from their browser
await api(jo)('PUT', '/ai/keys/anthropic', { key: 'sk-test-1234567890' });
const todayIn = async (tz) => {
  const before = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').length : 0;
  await api(jo, tz)('POST', '/ai/doc', { mode: 'write', ask: 'a short note' });
  await sleep(200);
  return fs.readFileSync(LOG, 'utf8').slice(before).match(/Today is (\d{4}-\d\d-\d\d)/)?.[1];
};
ok(await todayIn(EAST) === dayIn(EAST), 'someone far east gets their own today');
ok(await todayIn(WEST) === dayIn(WEST), 'someone far west gets theirs');
ok(await todayIn(null) === dayIn('America/Denver'), 'with no time zone given, the team’s is used');
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
