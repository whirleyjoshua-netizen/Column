// A Checklist has no chat feed or stack of its own (the owner, 2026-11-27: "yes skip"): with one for every job's
// checklist, feeds would pile up, and a job's chat is where a job is talked about. A Campaign still gets both.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/checklist';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5494, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', SKIP_SETUP: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Lists ' + t, name: 'Rico', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  r = await rico('POST', '/campaigns', { name: 'Lee house punch list', type: 'checklist' });
  const cl = r.body;
  ok(r.status === 200 && cl.type === 'checklist', 'a checklist is made');
  ok(!cl.channelId && !cl.stackId, 'with no feed and no stack');
  let st = (await rico('GET', '/state')).body;
  ok(!st.workspace.channels.some((x) => x.campaignId === cl.id) && !st.workspace.stacks.some((x) => x.campaignId === cl.id), 'none in the team either');
  const g = (await rico('POST', '/goals', { campaignId: cl.id, title: 'Tasks' })).body;
  const task = (await rico('POST', '/tasks', { goalId: g.id, text: 'Caulk the tub' })).body;
  r = await rico('PATCH', '/tasks/' + task.id, { done: true });
  ok(r.status === 200 && r.body.done, 'its tasks tick off');
  r = await rico('PATCH', '/campaigns/' + cl.id, { name: 'Lee house: punch list' });
  ok(r.status === 200 && r.body.name === 'Lee house: punch list', 'it can be renamed');
  r = await rico('POST', '/campaigns', { name: 'Spring push' });
  ok(r.status === 200 && r.body.channelId && r.body.stackId, 'a campaign still gets its feed and stack');
  st = (await rico('GET', '/state')).body;
  ok(st.workspace.channels.some((x) => x.campaignId === r.body.id), 'in the team');
  r = await rico('DELETE', '/campaigns/' + cl.id);
  ok(r.status === 200, 'a checklist can be deleted');
  st = (await rico('GET', '/state')).body;
  ok(!st.campaigns.some((x) => x.id === cl.id) && !st.tasks.some((x) => x.id === task.id), 'and its tasks go with it');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  if (fails) console.log(srv.log.slice(-1500));
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
