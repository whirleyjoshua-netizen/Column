// A task stays with the right job (the forecast's audit, 2026-11-18): a task in a job's campaign is that job's, so
// when the campaign is moved to another job its tasks go with it, and a task moved into another job's campaign
// becomes that job's. One given another job, or none, on purpose keeps it.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/joblinks';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5227, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Shades ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const mk = async (name) => (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: name } })).body;
  const A = await mk('Job A'), Bj = await mk('Job B'), C = await mk('Job C'), D = await mk('Job D');
  const task = async (id) => (await rico('GET', '/state')).body.tasks.find((x) => x.id === id);

  const ca = (await rico('POST', '/campaigns', { name: 'Work', recordId: A.id })).body;
  const ga = (await rico('POST', '/goals', { campaignId: ca.id, title: 'Step', kind: 'tasks' })).body;
  const t1 = (await rico('POST', '/tasks', { text: 'Follows the campaign', goalId: ga.id })).body;
  const t2 = (await rico('POST', '/tasks', { text: 'Given job D on purpose', goalId: ga.id, recordId: D.id })).body;
  const t3 = (await rico('POST', '/tasks', { text: 'Given no job on purpose', goalId: ga.id, recordId: null })).body;
  ok(t1.recordId === A.id && t2.recordId === D.id && t3.recordId === null, '(setup) one task follows the campaign’s job, one was given job D, one none');

  r = await rico('PATCH', `/campaigns/${ca.id}`, { recordId: Bj.id });
  ok(r.status === 200 && r.body.recordId === Bj.id, '(setup) the campaign is moved to job B');
  ok((await task(t1.id)).recordId === Bj.id, 'its task goes with it to job B: ' + (await task(t1.id)).recordId);
  ok((await task(t2.id)).recordId === D.id && (await task(t3.id)).recordId === null, 'ones given a job, or none, on purpose keep it');

  const cc = (await rico('POST', '/campaigns', { name: 'Other', recordId: C.id })).body;
  const gc = (await rico('POST', '/goals', { campaignId: cc.id, title: 'Step C', kind: 'tasks' })).body;
  r = await rico('PATCH', `/tasks/${t1.id}`, { goalId: gc.id });
  ok(r.status === 200 && r.body.recordId === C.id, 'a task moved into job C’s campaign becomes job C’s: ' + r.body?.recordId);
  r = await rico('PATCH', `/tasks/${t2.id}`, { goalId: gc.id });
  ok(r.body.recordId === D.id, 'one given job D on purpose keeps it when moved');
} catch (e) { ok(false, 'threw ' + e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-30).join('\n'));
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
