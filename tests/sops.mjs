// SOPs (Command Center part 5, 2026-11-20): a saved campaign is a team's standard way of doing something. It has a
// version; an owner or admin updates it from a campaign (a run that did better), with a note of what changed, and can
// go back to an earlier version; each person says they've read the version they read, and the owner asks whoever
// hasn't read the current one (a notice that opens its guide).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/sops';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4985, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Sop ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r0.body.token);
  const code = (await maria('GET', '/state')).body.workspace.inviteCode;
  r0 = await call()('POST', '/auth', { mode: 'join', workspace: 'Sop ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r0.body.token);
  r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r0.body.token);
  const samId = (await sam('GET', '/state')).body.me.memberId;

  const camp = (await maria('POST', '/campaigns', { name: 'Blind install', brief: 'How we install blinds.' })).body;
  const g = (await maria('POST', '/goals', { campaignId: camp.id, title: 'Install' })).body;
  await maria('POST', '/tasks', { goalId: g.id, text: 'Hang the blinds', description: 'Level first.', checklist: [{ text: 'Brackets' }] });
  let r = await maria('POST', '/templates', { campaignId: camp.id, name: 'Blind install', tz: 'America/Los_Angeles' });
  const tp = r.body;
  ok(r.status === 200 && tp.version === 1 && tp.versions?.length === 1 && tp.versions[0].v === 1 && !('snap' in tp.versions[0]), 'a saved campaign starts at version 1 (its history sent without the copies)');
  r = await sam('POST', `/templates/${tp.id}/read`, {});
  ok(r.status === 200 && r.body.reads?.[samId]?.v === 1, 'Sam says he’s read version 1');
  r = await maria('POST', `/templates/${tp.id}/ask`, {});
  ok(r.status === 200 && r.body.asked === 0, 'asking: everyone has read it (Maria saved it): ' + JSON.stringify(r.body));

  // A run that did better: its changes go back into the SOP as version 2.
  const run = (await maria('POST', `/templates/${tp.id}/run`, { date: '2026-12-01' })).body;
  ok(run.templateId === tp.id, 'a run knows which SOP it came from');
  const g2 = (await maria('GET', '/state')).body.goals.find((x) => x.campaignId === run.id);
  await maria('POST', '/tasks', { goalId: g2.id, text: 'Walk the customer through it' });
  r = await sam('POST', `/templates/${tp.id}/update`, { campaignId: run.id, note: 'x' });
  ok(r.status === 403, 'Sam (a member) can’t change the SOP');
  const oc = (await olga('POST', '/campaigns', { name: 'Elsewhere' })).body;
  r = await maria('POST', `/templates/${tp.id}/update`, { campaignId: oc.id });
  ok(r.status === 404, 'nor from another team’s campaign');
  r = await maria('POST', `/templates/${tp.id}/update`, { campaignId: run.id, note: 'Added the walk-through at the end' });
  const v2 = r.body;
  ok(r.status === 200 && v2.version === 2 && v2.versions.map((x) => x.v).join() === '1,2' && v2.versions[1].note === 'Added the walk-through at the end' && v2.versions[1].by === 'Maria', 'updated from the run: version 2, with what changed and who');
  ok(v2.goals[0].tasks.map((x) => x.text).join('|') === 'Hang the blinds|Walk the customer through it', 'it has the run’s new task');
  ok(v2.name === 'Blind install' && v2.goals[0].tasks[0].description === 'Level first.', 'and keeps its name and how-to');
  ok(v2.reads[samId].v === 1, 'Sam read version 1, not this one');
  // Asking the ones who haven't read it.
  r = await maria('POST', `/templates/${tp.id}/ask`, {});
  ok(r.body.asked === 1, 'asking tells the one who hasn’t read version 2');
  const n = (await sam('GET', '/notices')).body.filter((x) => x.kind === 'sop');
  ok(n.length === 1 && n[0].go === 'sop:' + tp.id && /Blind install/.test(n[0].title + n[0].text) && /version 2/.test(n[0].text), 'Sam gets a notice that opens it: ' + JSON.stringify(n[0] && { title: n[0].title, text: n[0].text }));
  r = await sam('POST', `/templates/${tp.id}/ask`, {});
  ok(r.status === 403, 'only an owner or admin asks');
  await sam('POST', `/templates/${tp.id}/read`, {});
  r = await maria('POST', `/templates/${tp.id}/ask`, {});
  ok(r.body.asked === 0, 'once he’s read it, nobody is left to ask');
  // Going back.
  r = await maria('POST', `/templates/${tp.id}/restore`, { v: 1 });
  ok(r.status === 200 && r.body.version === 3 && r.body.goals[0].tasks.length === 1 && r.body.versions[2].note === 'Back to version 1', 'back to version 1, as version 3: ' + JSON.stringify(r.body.versions?.at(-1)));
  r = await maria('POST', `/templates/${tp.id}/restore`, { v: 9 });
  ok(r.status === 404, 'a version that doesn’t exist can’t be restored');
  // A run from now on is the current version.
  const run2 = (await maria('POST', `/templates/${tp.id}/run`, { date: '2026-12-08' })).body;
  const st = (await maria('GET', '/state')).body;
  const gRun2 = st.goals.find((x) => x.campaignId === run2.id);
  ok(st.tasks.filter((x) => x.goalId === gRun2.id).length === 1, 'a new run follows the current version');
  r = await olga('POST', `/templates/${tp.id}/read`, {});
  ok(r.status === 404, 'someone on another team can’t see it');
} catch (e) { ok(false, e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
