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
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  dav.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
