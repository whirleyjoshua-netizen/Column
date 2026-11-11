// Audit, smaller fixes (docs/audit/FINDINGS.md): E8 a malformed secret key stops the server; H8 no file named "..";
// G10 impossible times refused; G11 impossible dates refused; B9 a team being deleted can't change texting, lead capture
// or Dropbox; E7 the calendar connection page shows its words as text.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_misc';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4918, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' };
// E8
const bad = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...env, COLUMN_SECRET_KEY: 'not-a-real-key' }, stdio: 'ignore' });
const code = await new Promise((r) => { const t = setTimeout(() => { bad.kill(); r('still running'); }, 6000); bad.on('exit', (c) => { clearTimeout(t); r(c); }); });
ok(code === 1, `E8 a COLUMN_SECRET_KEY that's set but malformed stops the server (exit ${code})`);
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...env, COLUMN_SECRET_KEY: ' ' + 'ab'.repeat(32) + '\n' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  ok((await fetch(B + '/api/health')).ok, 'E8 a key with a stray space and newline still works');
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Misc ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const tok = r.body.token, jo = call(tok);

  // H8
  const up = await (await fetch(`${B}/api/upload?name=..`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: 'x' })).json();
  ok(up.name && up.name !== '..' && up.name !== '.', `H8 a file can't be named ".." (stored as “${up.name}”)`);

  // G11
  ok((await jo('POST', '/entries', { text: 'x', date: '2026-02-31' })).status === 400, 'G11 an impossible date (Feb 31) is refused');
  ok((await jo('POST', '/entries', { text: 'x', date: '2028-02-29' })).status === 200, 'G11 a real one (a leap day) is fine');

  // G10
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: p.types[0].id, values: { job: 'Tune-up' } })).body;
  const key = (await jo('POST', '/integrations/keys', { name: 'k' })).body.token;
  r = await call(key)('POST', '/v1/visits', { job_id: job.id, crew_ids: ['Jo'], date: '2099-01-10', start: '25:00' });
  ok(r.status === 400, 'G10 a visit at 25:00 is refused, not booked at 01:00');
  r = await call(key)('POST', '/v1/visits', { job_id: job.id, crew_ids: ['Jo'], date: '2099-01-10', start: '9:75' });
  ok(r.status === 400, 'G10 and 9:75 too');
  r = await call(key)('POST', '/v1/visits', { job_id: job.id, crew_ids: ['Jo'], date: '2099-01-10', start: '2:15pm' });
  ok(r.status === 201 || r.status === 200, 'G10 a real time works ' + (r.status >= 300 ? JSON.stringify(r.body) : ''));

  // E7
  const page = await (await fetch(B + '/oauth/google/callback?state=<b>x</b>')).text();
  ok(!/<b>x<\/b>/.test(page), 'E7 the calendar connection page never shows anything from the address as HTML');

  // B9
  await jo('POST', '/workspace/delete', { name: 'Misc ' + t, password: 'longenough1' });
  ok((await jo('PUT', '/lead-capture', { on: true })).status === 423, 'B9 a team being deleted can’t turn on lead capture');
  ok((await jo('PUT', '/texting', { sid: 'AC' + 'a'.repeat(32), token: 'x'.repeat(32), from: '+15555550100' })).status === 423, 'B9 or change texting');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
