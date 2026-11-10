// Technology & software, step 5: QA and releases. Test cases with a result; a failing test makes a linked bug with its
// steps and expected result (once, while that bug is open), and a run notes when and who; a new test run puts a
// release's tests (or all) back to Not run; release notes are drafted by the team's AI from what's done in the
// release, with serious open bugs as known issues, and never from what isn't done.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/tech5';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4725, B = `http://127.0.0.1:${PORT}`, AI_PORT = 4724;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const asked = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    asked.push({ sys: typeof j.system === 'string' ? j.system : JSON.stringify(j.system), user: JSON.stringify(j.messages) });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: JSON.stringify({ text: '# What’s new\n- Sign in with email\n# Fixed\n- The login button on Android' }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
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
  const me = (await ada('GET', '/state')).body.me.memberId;
  const p = (await ada('POST', '/projects', { template: 'tech', name: 'Atlas Mobile' })).body;
  const T = (k) => p.types.find((x) => x.key === k);
  const work = T('work'), tests = T('tests'), rel = T('releases'), feats = T('features');
  const F = (tp, k) => tp.fields.find((x) => x.key === k);
  const C = (tp, k, l) => F(tp, k).choices.find((x) => x.label === l).id;
  ok(tests && F(tests, 'bug').target === work.id && tests.views[0].groupBy === F(tests, 'result').id, 'a tech project has test cases, on a test-run board by result');
  const v1 = (await ada('POST', `/projects/${p.id}/records`, { typeId: rel.id, values: { name: 'v1.0' } })).body;
  const v2 = (await ada('POST', `/projects/${p.id}/records`, { typeId: rel.id, values: { name: 'v1.1' } })).body;
  const signIn = (await ada('POST', `/projects/${p.id}/records`, { typeId: feats.id, values: { title: 'Sign-in', release: [v1.id] } })).body;
  const test = (await ada('POST', `/projects/${p.id}/records`, { typeId: tests.id, values: { title: 'Duplicate email is refused', feature: [signIn.id], release: [v1.id], steps: '1. Sign up with ada@x.test\n2. Sign up again with it', expected: 'A clear “already used” message' } })).body;
  ok(test.values[F(tests, 'result').id] === C(tests, 'result', 'Not run'), 'a new test starts as Not run');

  // A failing test makes a bug.
  r = await ada('PATCH', '/records/' + test.id, { values: { [F(tests, 'result').id]: C(tests, 'result', 'Fail'), [F(tests, 'actual').id]: 'A second account was made' } });
  const bugId = r.body.values[F(tests, 'bug').id]?.[0];
  ok(bugId && r.body.values[F(tests, 'ran').id] && r.body.values[F(tests, 'tester').id] === me, 'marking it Fail links a new bug, and notes when and who ran it');
  let recs = (await ada('GET', `/projects/${p.id}/records`)).body;
  const bug = recs.find((x) => x.id === bugId);
  ok(bug.values[F(work, 'type').id] === C(work, 'type', 'Bug') && /^Test failed: Duplicate email/.test(bug.values[F(work, 'title').id]) && bug.values[F(work, 'steps').id].includes('Sign up again') && bug.values[F(work, 'expected').id].includes('already used') && bug.values[F(work, 'actual').id] === 'A second account was made', 'the bug carries the test’s steps, what was expected and what happened');
  ok(bug.values[F(work, 'feature').id][0] === signIn.id && bug.values[F(work, 'release').id][0] === v1.id && bug.values[F(work, 'severity').id] === C(work, 'severity', 'Medium'), 'and its feature and release');
  await ada('PATCH', '/records/' + test.id, { values: { [F(tests, 'result').id]: C(tests, 'result', 'Not run') } });
  await ada('PATCH', '/records/' + test.id, { values: { [F(tests, 'result').id]: C(tests, 'result', 'Fail') } });
  recs = (await ada('GET', `/projects/${p.id}/records`)).body;
  ok(recs.filter((x) => x.typeId === work.id).length === 1 && JSON.stringify((await ada('GET', `/records/${bugId}/log`)).body).includes('failed again'), 'failing again while that bug is open notes it on the bug, no second bug');

  // Fixed, re-run, passes.
  await ada('PATCH', '/records/' + bugId, { values: { [F(work, 'status').id]: C(work, 'status', 'Done') } });
  r = await ada('PATCH', '/records/' + test.id, { values: { [F(tests, 'result').id]: C(tests, 'result', 'Pass') } });
  ok(r.body.values[F(tests, 'result').id] === C(tests, 'result', 'Pass'), 'once fixed, it passes');
  const other = (await ada('POST', `/projects/${p.id}/records`, { typeId: tests.id, values: { title: 'Other release test', release: [v2.id], result: C(tests, 'result', 'Pass') } })).body;
  r = await ada('POST', `/projects/${p.id}/test-run`, { releaseId: v1.id });
  recs = (await ada('GET', `/projects/${p.id}/records`)).body;
  ok(r.body.reset === 1 && recs.find((x) => x.id === test.id).values[F(tests, 'result').id] === C(tests, 'result', 'Not run') && recs.find((x) => x.id === other.id).values[F(tests, 'result').id] === C(tests, 'result', 'Pass'), 'a new test run for v1.0 puts its tests back to Not run, and leaves v1.1’s alone');

  // Release notes.
  ok((await ada('POST', `/records/${v2.id}/release-notes`)).status === 400, 'nothing done in a release: nothing to write up');
  await ada('POST', `/projects/${p.id}/records`, { typeId: work.id, values: { title: 'Email + password sign-in', type: C(work, 'type', 'Story'), status: C(work, 'status', 'Done'), feature: [signIn.id], description: 'Sign up and sign in with an email address.' } });
  await ada('POST', `/projects/${p.id}/records`, { typeId: work.id, values: { title: 'Secret admin panel', type: C(work, 'type', 'Story'), status: C(work, 'status', 'In progress'), release: [v1.id] } });
  await ada('POST', `/projects/${p.id}/records`, { typeId: work.id, values: { title: 'Crash on logout', type: C(work, 'type', 'Bug'), severity: C(work, 'severity', 'Critical'), status: C(work, 'status', 'Ready'), release: [v1.id] } });
  asked.length = 0;
  r = await ada('POST', `/records/${v1.id}/release-notes`);
  const q = asked[0];
  ok(r.status === 200 && /What’s new/.test(r.body.text) && r.body.done === 2 && r.body.open === 1, 'release notes for v1.0: drafted from 2 finished items, with 1 serious bug open');
  ok(q.sys.includes('release notes') && q.user.includes('Email + password sign-in') && q.user.includes('Test failed: Duplicate email') && q.user.includes('Crash on logout'), 'the AI hears what’s done (through the feature too) and the open critical bug');
  ok(!q.user.includes('Secret admin panel'), 'but not work that isn’t done');
  ok((await ada('POST', `/records/${bugId}/release-notes`)).status === 404, 'only a release has release notes');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
ai.close();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
