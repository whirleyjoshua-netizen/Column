// AI helpers for software projects: Plan a feature drafts a feature and its work (made only when accepted, with what
// the person changed: unticked items left out, points on the usual scale, only the project's phases and labels),
// and Write test cases drafts tests from a feature's work and acceptance criteria, made linked to the feature and
// its release.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/techai';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4723, B = `http://127.0.0.1:${PORT}`, AI_PORT = 4722;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const asked = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    asked.push({ sys, user: JSON.stringify(j.messages) });
    let out = { text: 'ok' };
    if (sys.includes('product manager')) out = { feature: { title: 'Recurring tasks', why: 'People want tasks to come back on a schedule.', phase: 'core product', priority: 'Should have' }, items: [
      { title: 'Pick a repeat schedule on a task', type: 'Story', estimate: 4, description: 'Daily, weekly, monthly', acceptance: ['You can choose weekly', 'The next one appears when you finish'], labels: ['Frontend', 'Wizardry'] },
      { title: 'Make the next task when one is done', type: 'Task', estimate: 5, acceptance: ['It keeps the same assignee'], labels: ['Backend'] },
      { title: 'Recurring tasks on the calendar', type: 'Story', estimate: 20 },
    ], questions: ['What happens to an overdue repeating task?'], risks: ['Time zones'] };
    if (sys.includes('QA lead')) out = { tests: [{ title: 'Weekly repeat makes next week’s task', steps: '1. Make a task\n2. Repeat weekly\n3. Finish it', expected: 'A task appears for next week', platforms: ['Web', 'Fax'] }, { title: 'Repeat keeps the assignee', steps: '1. …', expected: 'Same person' }] };
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  await ada('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  const p = (await ada('POST', '/projects', { template: 'tech', name: 'Atlas' })).body;
  const T = (k) => p.types.find((x) => x.key === k);
  const work = T('work'), feats = T('features'), tests = T('tests'), rel = T('releases');
  const F = (tp, k) => tp.fields.find((x) => x.key === k);
  const C = (tp, k, l) => F(tp, k).choices.find((x) => x.label === l).id;
  await ada('POST', `/projects/${p.id}/records`, { typeId: feats.id, values: { title: 'Sign-in' } });

  ok((await ada('POST', `/projects/${p.id}/ai-feature`, { idea: ' ' })).status === 400, 'an empty idea is refused');
  r = await ada('POST', `/projects/${p.id}/ai-feature`, { idea: 'Let tasks repeat every week or month' });
  const plan = r.body.plan;
  const q = asked.find((x) => x.sys.includes('product manager'));
  ok(r.status === 200 && q.user.includes('Let tasks repeat') && q.user.includes('Sign-in') && q.sys.includes('Foundation'), 'the AI hears the idea, the features already planned, and the project’s phases');
  ok(plan.feature.phase === 'Core product' && plan.feature.priority === 'Should have', 'the phase and priority are matched to the project’s own');
  ok(plan.items.length === 3 && plan.items[0].estimate === 3 && plan.items[2].estimate === 13 && plan.items[0].labels.join() === 'Frontend', 'points go on the usual scale, and made-up labels are dropped');
  ok(plan.questions.length === 1 && plan.risks[0] === 'Time zones', 'with questions and risks');
  ok(!(await ada('GET', `/projects/${p.id}/records`)).body.some((x) => x.typeId === work.id), 'nothing is made yet');

  // Accept, with changes.
  plan.items[2].on = false;
  plan.items[0].title = 'Choose how often a task repeats';
  r = await ada('POST', `/projects/${p.id}/ai-feature/create`, { plan });
  const feature = r.body.feature;
  ok(r.status === 200 && feature.values[F(feats, 'title').id] === 'Recurring tasks' && feature.values[F(feats, 'phase').id] === C(feats, 'phase', 'Core product') && feature.values[F(feats, 'status').id] === C(feats, 'status', 'Planned'), 'Make them: the feature, planned, in Core product');
  const items = r.body.items;
  ok(items.length === 2 && items[0].values[F(work, 'title').id] === 'Choose how often a task repeats', 'the ticked items, with what was changed');
  ok(items.every((x) => x.values[F(work, 'feature').id][0] === feature.id && x.values[F(work, 'status').id] === C(work, 'status', 'Backlog')) && items[0].values[F(work, 'acceptance').id].items.length === 2 && items[0].values[F(work, 'estimate').id] === 3, 'in the backlog, linked to the feature, with acceptance criteria and points');
  ok(items[1].values[F(work, 'type').id] === C(work, 'type', 'Task') && items[1].values[F(work, 'labels').id][0] === C(work, 'labels', 'Backend'), 'and their types and labels');

  // Test cases.
  const v1 = (await ada('POST', `/projects/${p.id}/records`, { typeId: rel.id, values: { name: 'v1.1' } })).body;
  await ada('PATCH', '/records/' + feature.id, { values: { [F(feats, 'release').id]: [v1.id] } });
  r = await ada('POST', `/records/${feature.id}/ai-tests`);
  const qa = asked.find((x) => x.sys.includes('QA lead'));
  ok(r.status === 200 && r.body.tests.length === 2 && r.body.tests[0].platforms.join() === 'Web' && qa.user.includes('The next one appears when you finish'), 'Write test cases: drafted from the feature’s work and acceptance criteria');
  r.body.tests[1].on = false;
  r = await ada('POST', `/records/${feature.id}/ai-tests/create`, { tests: r.body.tests });
  const made = r.body.tests;
  ok(made.length === 1 && made[0].values[F(tests, 'feature').id][0] === feature.id && made[0].values[F(tests, 'release').id][0] === v1.id && made[0].values[F(tests, 'result').id] === C(tests, 'result', 'Not run'), 'the ticked test is made, Not run, linked to the feature and its release');
  ok((await ada('POST', `/records/${items[0].id}/ai-tests`)).status === 404, 'only a feature gets test cases written');
  const crm = (await ada('POST', '/projects', { template: 'crm' })).body;
  ok((await ada('POST', `/projects/${crm.id}/ai-feature`, { idea: 'x' })).status === 404, 'only a software project plans features');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
ai.close();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
