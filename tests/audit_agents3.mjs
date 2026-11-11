// Audit (docs/audit/FINDINGS.md): F8 stopping an assignment stops it (no more paid calls); F9 a hand-off made while
// answering a follow-up runs; F10 a step's label never names something the person can't see.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_agents3';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4939, AI = 4940, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
// The stand-in AI answers from a queue: a string is a final answer, an array is tool calls. LOOP keeps calling a tool.
let QUEUE = [], LOOP = null, DELAY = 0, calls = 0;
const ai = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', async () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'T', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    calls++;
    if (DELAY) await sleep(DELAY);
    const step = LOOP || QUEUE.shift() || 'Done.';
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (typeof step === 'string') return reply([{ type: 'text', text: step }]);
    reply(step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${calls}_${i}`, name, input })), 'tool_use');
  });
});
await new Promise((r) => ai.listen(AI, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI}` }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  const team = 'Agents3 ' + t;
  let r = await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r.body.token), code = r.body.workspace.inviteCode;
  await ada('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await ada('PATCH', '/workspace', { tools: { projects: true } });
  const waitRun = async (who, id) => { let run; for (let i = 0; i < 150; i++) { run = (await who('GET', '/agents/runs/' + id)).body; if (!['requested', 'planning', 'running'].includes(run.status)) break; await sleep(150); } return run; };

  // F9: answering a follow-up hands part of it to the Sales manager; that part runs.
  QUEUE = ['Prepped.'];
  r = await ada('POST', '/agents/runs', { agent: 'ops', ask: 'Prep the Lopez job.' });
  let run = await waitRun(ada, r.body.id);
  ok(run.status === 'completed', '(setup) the first answer is done');
  QUEUE = [[['hand_off', { agent: 'sales', ask: 'Write Lopez a short follow-up.' }]], 'Handed the email to Sales.', 'Follow-up written.'];
  await ada('POST', `/agents/runs/${run.id}/reply`, { text: 'Also get someone to follow up with Lopez.' });
  run = await waitRun(ada, run.id);
  const salesPart = run.parts.find((p) => p.agent === 'sales');
  ok(salesPart && salesPart.status !== 'planned', `F9 the hand-off made while answering runs (${salesPart?.status || 'no part'})`);

  // F8: stopped while it's working: no more calls to the AI after that.
  LOOP = [['look_at_day', {}]];
  DELAY = 400;
  const before = calls;
  r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'Look at my day, again and again.' });
  for (let i = 0; i < 40 && calls - before < 1; i++) await sleep(100);
  await ada('POST', `/agents/runs/${r.body.id}/cancel`);
  const atStop = calls;
  await sleep(3000);
  LOOP = null;
  DELAY = 0;
  ok(calls - atStop <= 1, `F8 after stopping, it makes at most the call already under way (${calls - atStop} more)`);

  // F10: Sam's agent given the id of Ada's private record: the step doesn't name it.
  const priv = (await ada('POST', '/projects', { template: 'trades', trades: ['hvac'], name: 'Owner only', private: true })).body;
  const secret = (await ada('POST', `/projects/${priv.id}/records`, { typeId: priv.types[0].id, values: { job: 'Secret margin notes' } })).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: team, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  await sam('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-0987654321' });
  QUEUE = [[['read_record', { id: secret.id }]], 'Nothing there.'];
  r = await sam('POST', '/agents/runs', { agent: 'ops', ask: 'Read that record.' });
  run = await waitRun(sam, r.body.id);
  const labels = JSON.stringify(run.parts.flatMap((p) => p.steps.map((s) => [s.label, s.error])));
  ok(!labels.includes('Secret margin'), `F10 a step about a private record doesn’t name it (${labels.slice(0, 120)})`);
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  ai.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
