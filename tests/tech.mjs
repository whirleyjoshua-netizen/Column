// Technology & software, step 1: a project set up for a small team building a product. Work items numbered with
// letters from the project's name, a development board from Backlog to Done, a Bugs view, bug-only fields, long
// descriptions, features on a roadmap by phase (one can depend on others), and releases.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/tech';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4733, B = `http://127.0.0.1:${PORT}`;
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Atlas ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r.body.token);
  await ada('PATCH', '/workspace', { tools: { projects: true } });
  r = await ada('POST', '/projects', { template: 'tech', name: 'Atlas Mobile' });
  const p = r.body;
  ok(r.status === 200 && p.template === 'tech' && p.icon === '💻', 'a Technology & software project');
  const [work, feats, rels] = ['work', 'features', 'releases'].map((k) => p.types.find((x) => x.key === k));
  ok(work && feats && rels, 'with work items, features and releases');
  const f = (tp, k) => tp.fields.find((x) => x.key === k);
  const ch = (tp, k, label) => f(tp, k).choices.find((x) => x.label === label).id;
  ok(f(work, 'status').choices.map((x) => x.label).join() === 'Backlog,Ready,In progress,Code review,Testing,Ready to release,Done', 'the board’s columns: Backlog to Done');
  ok(work.views[0].kind === 'board' && work.views[0].groupBy === f(work, 'status').id, 'the first view is the development board');
  const bugs = work.views.find((v) => v.name === 'Bugs');
  ok(bugs?.filter?.field === f(work, 'type').id && bugs.filter.is[0] === ch(work, 'type', 'Bug'), 'a Bugs view shows only bugs');
  ok(f(work, 'steps').showIf?.field === f(work, 'type').id && f(work, 'steps').showIf.is[0] === ch(work, 'type', 'Bug') && f(work, 'description').long && f(work, 'steps').long, 'steps to reproduce show on bugs; descriptions take several lines');
  ok(f(work, 'feature').target === feats.id && f(feats, 'depends').target === feats.id && f(feats, 'depends').many, 'a work item belongs to a feature; a feature can depend on several others');
  ok(f(feats, 'phase').choices.length === 5 && feats.views[0].groupBy === f(feats, 'phase').id, 'features make a roadmap by phase');
  ok(f(rels, 'checklist').list.includes('No open critical bugs'), 'a release has a checklist');

  // Records.
  const auth = (await ada('POST', `/projects/${p.id}/records`, { typeId: feats.id, values: { title: 'Sign-in', phase: ch(feats, 'phase', 'Foundation'), target: '2026-12-01' } })).body;
  const dash = (await ada('POST', `/projects/${p.id}/records`, { typeId: feats.id, values: { title: 'Dashboard', phase: ch(feats, 'phase', 'Core product'), depends: [auth.id] } })).body;
  ok(dash.values[f(feats, 'depends').id]?.[0] === auth.id, 'Dashboard depends on Sign-in');
  const long = 'Open the app\n'.repeat(300);
  r = await ada('POST', `/projects/${p.id}/records`, { typeId: work.id, values: { title: 'Login button does nothing on Android', type: ch(work, 'type', 'Bug'), severity: ch(work, 'severity', 'High'), priority: ch(work, 'priority', 'Urgent'), steps: long, feature: [auth.id], estimate: 3 } });
  const bug = r.body;
  ok(r.status === 200 && bug.values[f(work, 'number').id] === 'AM-1', 'the first work item is AM-1 (from “Atlas Mobile”)');
  ok(bug.values[f(work, 'status').id] === ch(work, 'status', 'Backlog'), 'new work starts in the Backlog');
  ok(bug.values[f(work, 'steps').id].length > 2000, 'long fields keep long text');
  const story = (await ada('POST', `/projects/${p.id}/records`, { typeId: work.id, values: { title: 'Password reset', type: ch(work, 'type', 'Story'), feature: [auth.id] } })).body;
  ok(story.values[f(work, 'number').id] === 'AM-2', 'the next is AM-2');
  r = await ada('PATCH', '/records/' + story.id, { values: { [f(work, 'status').id]: ch(work, 'status', 'Code review'), [f(work, 'pr').id]: 'https://github.com/atlas/app/pull/12' } });
  ok(r.body.values[f(work, 'status').id] === ch(work, 'status', 'Code review'), 'it moves across the board');
  const p2 = (await ada('POST', '/projects', { template: 'tech', name: 'Kloo' })).body;
  const w2 = p2.types.find((x) => x.key === 'work');
  ok((await ada('POST', `/projects/${p2.id}/records`, { typeId: w2.id, values: { title: 'x' } })).body.values[f(w2, 'number').id] === 'KLO-1', 'one word: its first three letters (KLO-1)');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
