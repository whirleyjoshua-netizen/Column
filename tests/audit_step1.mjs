// The team audit (2026-11-28), step 1, the small ones:
// - A bill sent without how often it repeats is a one-off (it was saved as monthly); a repeat that isn't one is refused.
// - Removing someone: whoever removes them is shown first what happens to their visits (GET /members/:id/removal:
//   the visits only they were going to, which go to an owner, and the ones shared, where their place is dropped), and
//   is told after (`handed` on the answer). The owner who gets the visits is still told on each one.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_step1';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5498, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Pour ' + t, name: 'Dana Brooks', email: `dana${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const dana = call(r.body.token);
  let st = (await dana('GET', '/state')).body;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Pour ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token);
  const priya = await join('Priya Shah', 2), ben = await join('Ben Carter', 3), luis = await join('Luis Ortega', 4);
  st = (await dana('GET', '/state')).body;
  const idOf = (name) => st.workspace.members.find((m) => m.name === name)?.id;
  await dana('PATCH', '/members/' + idOf('Priya Shah'), { role: 'admin' });
  await dana('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true } });

  // Bills.
  r = await dana('POST', '/bills', { name: 'ABC Supply: gutters material', amount: 812.4, due: '2026-12-10', scope: 'business' });
  ok(r.status === 200 || r.status === 201, '(setup) a supplier bill is added');
  ok(r.body?.repeat === 'once', 'a bill sent without a repeat is a one-off, not monthly');
  r = await dana('POST', '/bills', { name: 'Yard rent', amount: 900, due: '2026-12-01', scope: 'business', repeat: 'monthly' });
  ok(r.body?.repeat === 'monthly', 'a monthly bill is still monthly');
  ok((await dana('POST', '/bills', { name: 'Odd', amount: 5, due: '2026-12-01', repeat: 'fortnightly' })).status === 400, 'a repeat that isn’t one is refused');
  r = await dana('PATCH', '/bills/' + r.body.id, { amount: 950 });
  ok(r.body?.repeat === 'monthly', 'changing a bill’s amount leaves its repeat');

  // Removing Ben: one visit only he's on, one shared with Luis.
  const tz = st.workspace.tz || 'UTC';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now() + 2 * 864e5);
  const p = (await dana('POST', '/projects', { template: 'trades', trades: ['concrete'] })).body;
  const tp = p.types[0];
  const job = (await dana('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { [tp.primary]: 'Lot 12 slab' } })).body;
  await dana('POST', `/records/${job.id}/visits`, { kind: 'Pour', date: day, start: 420, end: 720, memberIds: [idOf('Ben Carter')] });
  await dana('POST', `/records/${job.id}/visits`, { kind: 'Forms', date: day, start: 780, end: 900, memberIds: [idOf('Ben Carter'), idOf('Luis Ortega')] });
  ok((await ben('GET', '/members/' + idOf('Luis Ortega') + '/removal')).status === 403, 'a member can’t look at removing someone');
  r = await priya('GET', '/members/' + idOf('Ben Carter') + '/removal');
  ok(r.status === 200 && r.body.visitsAlone === 1 && r.body.visitsShared === 1 && r.body.heir === 'Dana Brooks', 'Priya sees first: 1 visit only Ben is on goes to Dana, 1 shared visit drops him');
  r = await priya('DELETE', '/members/' + idOf('Ben Carter'));
  ok(r.status === 200 && r.body.handed?.visits === 1 && r.body.handed?.to === 'Dana Brooks', 'and is told after that Ben’s visit is Dana’s now');
  ok(!r.body.members.some((m) => m.name === 'Ben Carter'), 'Ben is off the team');
  st = (await dana('GET', '/state')).body;
  ok(st.notices.some((n) => /Ben Carter’s visit is yours/.test(n.title)), 'Dana is told too');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  if (fails) console.log(srv.log.slice(-1500));
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
