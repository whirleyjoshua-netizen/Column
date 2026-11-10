// Technology & software, step 2: the roadmap timeline and sprints. A tech project has a Sprints list, a Sprint field
// on work items, a Sprint planner view and a Roadmap timeline; finishing a sprint marks it done and moves what
// isn't done to the next sprint (made if there's none, with the same length and capacity) or back to the backlog;
// projects made before this step get all of it.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/tech2';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4731, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
};
await start();
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Atlas ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const tok = r.body.token;
  const ada = call(tok);
  const p = (await ada('POST', '/projects', { template: 'tech', name: 'Atlas' })).body;
  const T = (k) => p.types.find((x) => x.key === k);
  const work = T('work'), feats = T('features'), spr = T('sprints');
  const F = (tp, k) => tp.fields.find((x) => x.key === k);
  const C = (tp, k, l) => F(tp, k).choices.find((x) => x.label === l).id;
  ok(spr && F(work, 'sprint').target === spr.id, 'a tech project has sprints, and work items belong to one');
  const sv = work.views.find((v) => v.kind === 'sprint');
  ok(sv && sv.sprint === F(work, 'sprint').id && work.views[1] === sv, 'the work items have a Sprint planner view, next to the board');
  const tl = feats.views[0];
  ok(tl.kind === 'timeline' && tl.start === F(feats, 'start').id && tl.end === F(feats, 'target').id && tl.groupBy === F(feats, 'phase').id, 'features open on a Roadmap timeline from start to target date, by phase');

  // A view can be made a timeline, and a sprint view finds its sprints.
  r = await ada(`POST`, `/projects/${p.id}/schema`, { op: 'addView', typeId: work.id, name: 'Due dates', kind: 'timeline' });
  ok(r.status === 200 && r.body.project.types.find((x) => x.id === work.id).views.at(-1).start === F(work, 'due').id, 'any list with a date can be shown as a timeline');

  // A sprint.
  const s1 = (await ada('POST', `/projects/${p.id}/records`, { typeId: spr.id, values: { name: 'Sprint 1', start: '2026-11-02', end: '2026-11-15', capacity: 8, status: C(spr, 'status', 'Active') } })).body;
  const item = async (title, status, pts) => (await ada('POST', `/projects/${p.id}/records`, { typeId: work.id, values: { title, status: C(work, 'status', status), estimate: pts, sprint: [s1.id] } })).body;
  const a = await item('Sign-in', 'Done', 5), b = await item('Password reset', 'In progress', 3), c = await item('Dashboard', 'Ready', 8);
  r = await ada('POST', `/records/${s1.id}/finish-sprint`, { to: 'next' });
  ok(r.status === 200 && r.body.moved === 2 && r.body.next?.values[F(spr, 'name').id] === 'Sprint 2', 'finishing Sprint 1 moves the 2 unfinished items into a new Sprint 2');
  const s2 = r.body.next;
  ok(s2.values[F(spr, 'start').id] === '2026-11-16' && s2.values[F(spr, 'end').id] === '2026-11-29' && s2.values[F(spr, 'capacity').id] === 8, 'Sprint 2 starts the next day, is as long, with the same capacity');
  const recs = (await ada('GET', `/projects/${p.id}/records`)).body;
  const by = (id) => recs.find((x) => x.id === id);
  ok(by(b.id).values[F(work, 'sprint').id][0] === s2.id && by(c.id).values[F(work, 'sprint').id][0] === s2.id && by(a.id).values[F(work, 'sprint').id][0] === s1.id, 'unfinished work moved; finished work stays with Sprint 1');
  ok(by(s1.id).values[F(spr, 'status').id] === C(spr, 'status', 'Done'), 'Sprint 1 is marked done');
  r = await ada('POST', `/records/${s2.id}/finish-sprint`, { to: 'next' });
  ok(r.body.next?.values[F(spr, 'name').id] === 'Sprint 3', 'and the next is Sprint 3');
  const s3 = r.body.next;
  r = await ada('POST', `/records/${s3.id}/finish-sprint`, { to: 'backlog' });
  const after = (await ada('GET', `/projects/${p.id}/records`)).body;
  ok(r.body.moved === 2 && !after.find((x) => x.id === b.id).values[F(work, 'sprint').id], 'or back to the backlog');
  ok((await ada('POST', `/records/${a.id}/finish-sprint`, { to: 'next' })).status === 400, 'only a sprint can be finished');

  // A project made before this step gets sprints and the timeline.
  const old = (await ada('POST', '/projects', { template: 'tech', name: 'Old' })).body;
  srv.kill(); await srv.exited;
  const dbf = DIR + '/db.json';
  const db = JSON.parse(fs.readFileSync(dbf, 'utf8'));
  const op = db.projects[old.id];
  op.types = op.types.filter((x) => x.key !== 'sprints');
  const ow = op.types.find((x) => x.key === 'work');
  ow.fields = ow.fields.filter((x) => x.key !== 'sprint');
  ow.views = ow.views.filter((x) => x.kind !== 'sprint');
  const of = op.types.find((x) => x.key === 'features');
  of.views = of.views.filter((x) => x.kind !== 'timeline');
  fs.writeFileSync(dbf, JSON.stringify(db));
  await start();
  const up = (await call(tok)('GET', '/projects')).body.find((x) => x.id === old.id);
  const uw = up.types.find((x) => x.key === 'work'), us = up.types.find((x) => x.key === 'sprints'), uf = up.types.find((x) => x.key === 'features');
  ok(us && F(uw, 'sprint')?.target === us.id && uw.fields.findIndex((x) => x.key === 'sprint') === uw.fields.findIndex((x) => x.key === 'release') + 1, 'an older project gets the Sprints list and the Sprint field, in place');
  ok(uw.views[1]?.kind === 'sprint' && uw.views[1].sprint === F(uw, 'sprint').id && uf.views[0]?.kind === 'timeline' && uf.views[0].start === F(uf, 'start').id, 'and the Sprint and Roadmap views');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
