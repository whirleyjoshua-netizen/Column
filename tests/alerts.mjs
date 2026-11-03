// Alerts: when saving keeps failing, ALERT_EMAIL is emailed once and /api/up says 503 until it recovers.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const S = (await import('node:path')).resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

function server(port, dir, env) {
  fs.rmSync(dir, { recursive: true, force: true });
  const p = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(port), DATA_DIR: dir, MAIL_OUTBOX: '1', DATABASE_URL: '', RESEND_API_KEY: '', ...env }, stdio: 'ignore' });
  return p;
}
const up = (port) => fetch(`http://127.0.0.1:${port}/api/up`).then((r) => r.status, () => 0);
const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(250); } return false; };
const outbox = (dir) => { try { return fs.readdirSync(dir + '/outbox').map((f) => JSON.parse(fs.readFileSync(dir + '/outbox/' + f, 'utf8'))); } catch { return []; } };
const breakSaving = (dir) => fs.mkdirSync(dir + '/db.json.tmp', { recursive: true }); // writing the temp file now fails
const makeTeam = (port, team) => fetch(`http://127.0.0.1:${port}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: team, name: 'Jo', email: 'jo@example.com', password: 'secret123', device: 'Laptop', deviceId: 'dev1' }) });

const A = S + '/dk/alertA', B = S + '/dk/alertB';
const a = server(4784, A, { ALERT_EMAIL: 'ops@example.com' });
const b = server(4783, B, {});
try {
  ok(await until(async () => (await up(4784)) === 200, 8000), '/api/up says 200 when all is well');
  ok((await fetch('http://127.0.0.1:4784/api/health')).status === 200, '/api/health still answers 200');
  await until(async () => (await up(4783)) === 200, 8000);

  breakSaving(A); breakSaving(B);
  await makeTeam(4784, 'Alerts A'); await makeTeam(4783, 'Alerts B');
  ok(await until(async () => (await up(4784)) === 503, 20000), 'after saving fails 3 times, /api/up says 503');
  ok((await fetch('http://127.0.0.1:4784/api/health')).status === 200, '/api/health stays 200, so the desktop app still finds the server');
  ok(await until(async () => outbox(A).some((m) => m.tag === 'alert'), 5000), 'an alert email is sent');
  const m = outbox(A).find((x) => x.tag === 'alert');
  ok(m?.to === 'ops@example.com', 'to ALERT_EMAIL');
  ok(/Saving data is failing/.test(m?.subject || ''), 'the subject says saving is failing: ' + m?.subject);
  ok(/EISDIR|illegal operation/.test(m?.text || ''), 'the email includes the error');
  ok(outbox(A).filter((x) => x.tag === 'alert').length === 1, 'only one alert email, not one per retry');

  fs.rmSync(A + '/db.json.tmp', { recursive: true });
  ok(await until(async () => (await up(4784)) === 200, 40000), 'once saving works again, /api/up says 200');
  ok(outbox(A).filter((x) => x.tag === 'alert').length === 1, 'the "works again" note waits for the 15-minute gap');
  ok(JSON.parse(fs.readFileSync(A + '/db.json', 'utf8')).workspaces && Object.values(JSON.parse(fs.readFileSync(A + '/db.json', 'utf8')).workspaces).some((w) => w.name === 'Alerts A'), 'the team made during the outage was saved');

  await until(async () => (await up(4783)) === 503, 20000);
  ok(!outbox(B).some((x) => x.tag === 'alert'), 'without ALERT_EMAIL, no alert email is sent');
} finally {
  a.kill(); b.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
