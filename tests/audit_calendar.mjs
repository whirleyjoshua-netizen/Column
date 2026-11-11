// Audit (docs/audit/FINDINGS.md G8): two quick edits to a new block (made, then moved a moment later) create one event
// in the connected calendar, not two. Uses a copy of the CalDAV stand-in on its own port.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_calendar';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4920, DAV = 4921, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const fakeSrc = fs.readFileSync(new URL('./fakecaldav.mjs', import.meta.url), 'utf8').replace('const PORT = 4794;', `const PORT = ${DAV};`);
fs.writeFileSync(DIR + '/fakecaldav.mjs', fakeSrc);
const dav = spawn('node', [DIR + '/fakecaldav.mjs'], { stdio: 'ignore' });
await sleep(500);
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', APPLE_CALDAV: `http://127.0.0.1:${DAV}` }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const store = async () => (await (await fetch(`http://127.0.0.1:${DAV}/_store`)).json());
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Cal ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  r = await jo('POST', '/calendars/connect', { provider: 'apple', user: 'jo@icloud.com', pass: 'abcd-efgh-ijkl-mnop', tz: 'America/Los_Angeles' });
  ok(r.status === 200 && r.body.writeCalId, 'G8 (setup) Apple calendar connected, with a calendar to write to');
  await sleep(800);
  const before = Object.keys((await store()).work || {}).length;
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const e = (await jo('POST', '/entries', { text: 'Measure at Lopez', date: day, start: 600, end: 660 })).body;
  await jo('PATCH', '/entries/' + e.id, { start: 630, end: 690 }); // moved a moment later, before the first push is done
  await sleep(2500);
  const after = Object.keys((await store()).work || {}).length;
  ok(after - before === 1, `G8 one event in the calendar, not two (${after - before} made)`);

  // G16: a visit's event deleted in the calendar cancels the visit through the visit's own path, so the job follows.
  await jo('PATCH', '/workspace', { tools: { projects: true } });
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Ruiz AC tune-up' } })).body;
  const vday = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const v = (await jo('POST', `/records/${job.id}/visits`, { date: vday, start: 540, end: 600 })).body;
  ok(!!v?.id, '(setup) a visit on the job');
  const sched = () => jo('GET', `/projects/${p.id}/records`).then((x) => x.body.find((y) => y.id === job.id)?.values[tp.fields.find((f) => f.key === 'scheduled').id] || null);
  ok((await sched()) === vday, '(setup) the job is scheduled for it');
  let file = null;
  for (let i = 0; i < 40 && !file; i++) { await sleep(150); file = Object.entries((await store()).work || {}).find(([, txt]) => txt.includes('Ruiz'))?.[0]; }
  ok(!!file, '(setup) the visit went to the calendar');
  await fetch(`http://127.0.0.1:${DAV}/_edit`, { method: 'POST', body: JSON.stringify({ cal: 'work', file, text: null }) }); // deleted in the calendar
  ok(!Object.keys((await store()).work || {}).includes(file), '(setup) the event is gone from the calendar');
  const conn = (await jo('GET', '/calendars')).body.connections[0];
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) { await jo('POST', `/calendars/${conn.id}/sync`); gone = (await jo('GET', `/records/${job.id}/visits`)).body.length === 0; if (!gone) await sleep(300); }
  ok(gone, 'G16 deleted in the calendar, the visit is cancelled');
  ok((await sched()) === null, 'G16 and the job’s Scheduled day follows');
  const log = (await jo('GET', `/records/${job.id}/log`)).body || [];
  ok(log.some((x) => /deleted the .* visit in their calendar/.test(x.note || '')), 'G16 the job’s timeline says why');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  dav.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
