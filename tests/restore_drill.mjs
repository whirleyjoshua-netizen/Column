// Restore drill (docs/OPERATIONS.md): proves Kloomie's own daily backup brings a team back after its data is lost.
// Runs against a throwaway Postgres database ONLY (never the live one):
//   DRILL_DATABASE_URL=postgresql://…/drill node tests/restore_drill.mjs <workdir>
// It refuses a database named neondb (Neon's default, where live data lives) and any URL without "drill" in its
// database name. Steps: a server on the empty drill database gets a team with a doc, a task, a contact and a file;
// a restart makes the daily backup; every row is then deleted (the disaster); the backup is put back as
// import-pending.json; the server restarts and everything, including the old sign-in and the file, is checked.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../server/', import.meta.url));
const pg = require('pg');
const URL_ = process.env.DRILL_DATABASE_URL || '';
const dbName = (() => { try { return new URL(URL_).pathname.slice(1); } catch { return ''; } })();
if (!URL_ || dbName === 'neondb' || !/drill/i.test(dbName)) {
  console.log('Refusing: set DRILL_DATABASE_URL to a throwaway database whose name contains "drill".');
  process.exit(2);
}
const S = path.resolve(process.argv[2] || '.');
const DIR = S + '/dk/restore_drill';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4942, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, DATABASE_URL: URL_, MAIL_OUTBOX: '1', RESEND_API_KEY: '', STRIPE_SECRET_KEY: '', COLUMN_SECRET_KEY: 'ef'.repeat(32) }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 200; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
const stop = async () => { const p = new Promise((r) => srv.on('exit', r)); srv.kill(); await p; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const rows = async () => { const c = new pg.Client({ connectionString: URL_ }); await c.connect(); try { return Number((await c.query('select count(*) from column_records')).rows[0].count); } finally { await c.end(); } };
const t = Date.now();
try {
  // Day one: a team and its work, on Postgres.
  await start();
  ok(/Postgres/i.test(srv.log), '(setup) the server runs on the drill database');
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Drill ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const tok = r.body.token, jo = call(tok);
  r = await jo('POST', '/items', { type: 'text', text: 'DRILL-DOC: how we install shutters' });
  ok(r.status === 200, `(setup) a doc (${r.status} ${JSON.stringify(r.body).slice(0, 80)})`);
  await jo('POST', '/tasks', { text: 'DRILL-TASK: order brackets' });
  await jo('POST', '/contacts', { name: 'DRILL Contact', email: 'drill.contact@x.test' });
  const up = await (await fetch(`${B}/api/upload?name=drill-quote.txt`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: 'DRILL-FILE six windows' })).json();
  const before = (await jo('GET', '/state')).body;
  const count = (st) => ({ items: st.items.length, tasks: st.tasks.length, members: st.workspace.members.length });
  const want = count(before);
  await sleep(1500);
  await stop();
  const rowsBefore = await rows();
  ok(rowsBefore > 5, `(setup) the team is in Postgres (${rowsBefore} rows)`);

  // The nightly backup: made the first time the server runs each day (at start, then hourly). The one made when this
  // drill's server first started (before there was any data) stands in for yesterday's, so it goes.
  fs.rmSync(DIR + '/backups', { recursive: true, force: true });
  await start();
  await sleep(1500);
  await stop();
  const backups = fs.existsSync(DIR + '/backups') ? fs.readdirSync(DIR + '/backups').filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)) : [];
  ok(backups.length === 1, `the daily backup was written (${backups.join(', ') || 'none'})`);
  const backup = path.join(DIR, 'backups', backups[0]);
  const raw = fs.readFileSync(backup, 'utf8');
  ok(raw.includes('DRILL-DOC') && raw.includes('DRILL-TASK') && !raw.includes(tok), 'it holds the team’s work, and no sign-in in plain text');

  // The disaster: every row gone.
  const c = new pg.Client({ connectionString: URL_ });
  await c.connect();
  await c.query('delete from column_records');
  await c.end();
  ok((await rows()) === 0, '(disaster) every row in Postgres is gone');

  // The restore: the backup goes back as import-pending.json, and the server starts.
  fs.copyFileSync(backup, DIR + '/import-pending.json');
  await start();
  ok(/Moving import-pending\.json into Postgres/.test(srv.log), 'the server takes the backup in');
  const jo2 = call(tok);
  const after = await jo2('GET', '/state');
  ok(after.status === 200, 'Jo’s sign-in from before still works');
  ok(JSON.stringify(count(after.body)) === JSON.stringify(want), `everything is back: ${JSON.stringify(count(after.body))} (was ${JSON.stringify(want)})`);
  ok(after.body.items.some((x) => (x.text || '').includes('DRILL-DOC')) && after.body.tasks.some((x) => x.text.includes('DRILL-TASK')), 'the doc and the task, with their words');
  ok((await jo2('GET', '/contacts')).body.contacts?.some((x) => x.name === 'DRILL Contact'), 'the contact');
  const f = await fetch(`${B}/api/files/${up.id}`, { headers: { authorization: 'Bearer ' + tok } });
  ok(f.status === 200 && (await f.text()) === 'DRILL-FILE six windows', 'the file opens (files live on the volume, beside the backups)');
  ok((await call()('POST', '/auth', { mode: 'email', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd9' })).status === 200, 'Jo can sign in with her password');
  await jo2('POST', '/tasks', { text: 'after the restore' });
  await sleep(1500);
  await stop();
  ok(!fs.existsSync(DIR + '/import-pending.json') && fs.existsSync(DIR + '/import-pending.json.done'), 'the backup is taken in once (renamed .done)');
  ok((await rows()) >= rowsBefore, `Postgres is whole again (${await rows()} rows)`);
  await start();
  ok((await jo2('GET', '/state')).body.tasks.some((x) => x.text === 'after the restore'), 'a restart keeps what was done after the restore (no second import)');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails && srv) console.log('Server log:\n' + srv.log.slice(-3000));
  srv?.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
