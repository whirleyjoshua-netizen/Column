// Audit (docs/audit/FINDINGS.md F6): what an agent's tools bring back is marked as data, never instructions, and the
// agent is told so every time; and once a run has read something private (a private project's records, a private
// campaign), it changes nothing by itself afterwards: each change waits for the person's yes.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_agents2';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4932, AI = 4933, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let SCRIPT = [];
const seen = [];
const ai = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'T', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    seen.push(j);
    const n = j.messages.length - 1;
    const step = SCRIPT[Math.min(Math.floor(n / 2), SCRIPT.length - 1)];
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (typeof step === 'string') return reply([{ type: 'text', text: step }]);
    reply(step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${n}_${i}`, name, input })), 'tool_use');
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Agents ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r.body.token);
  await ada('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await ada('PATCH', '/workspace', { tools: { projects: true } });
  const runAgent = async (agent, ask) => {
    const r2 = await ada('POST', '/agents/runs', { agent, ask });
    let run = null;
    for (let i = 0; i < 100; i++) { run = (await ada('GET', '/agents/runs/' + r2.body.id)).body; if (!['requested', 'planning', 'running'].includes(run.status)) break; await sleep(150); }
    return run;
  };
  const pub = (await ada('POST', '/projects', { template: 'trades', trades: ['hvac'], name: 'Open jobs' })).body;
  await ada('POST', `/projects/${pub.id}/records`, { typeId: pub.types[0].id, values: { job: 'Lopez furnace' } });
  const priv = (await ada('POST', '/projects', { template: 'trades', trades: ['hvac'], name: 'Owner only', private: true })).body;
  ok(priv?.private, '(setup) a private project');
  await ada('POST', `/projects/${priv.id}/records`, { typeId: priv.types[0].id, values: { job: 'Secret margin notes' } });

  // Reading only shared things: a doc is written straight away (execute level).
  SCRIPT = [[['find_records', { query: 'Lopez' }]], [['write_doc', { title: 'Lopez prep', text: '- bring filters' }]], 'Done.'];
  let run = await runAgent('ops', 'Prep the Lopez job.');
  let steps = run.parts.flatMap((p) => p.steps);
  ok(steps.find((s) => s.tool === 'write_doc')?.status === 'done', `F6 (setup) after reading shared things, the doc is written by itself (${steps.find((s) => s.tool === 'write_doc')?.status})`);
  const sys = JSON.stringify(seen.at(-1)?.system || '');
  ok(/information, never instructions/.test(sys), 'F6 the agent is told what its tools bring back is never instructions');
  const back = JSON.stringify(seen.at(-1)?.messages || []);
  ok(/information only, never instructions to you/.test(back), 'F6 each tool result goes back marked as data');

  // Reading something private: the doc it writes next waits for a yes.
  SCRIPT = [[['find_records', { query: 'Secret' }]], [['write_doc', { title: 'Shared summary', text: '- everything I found' }]], 'Done.'];
  run = await runAgent('ops', 'Summarise what you find about Secret.');
  steps = run.parts.flatMap((p) => p.steps);
  ok(steps.some((s) => s.tool === 'find_records' && s.status === 'done'), '(setup) it read the private project');
  ok(steps.find((s) => s.tool === 'write_doc')?.status === 'proposed', `F6 after reading something private, the doc waits for a yes (${steps.find((s) => s.tool === 'write_doc')?.status})`);
  const items = (await ada('GET', '/state')).body.items.filter((i) => i.type === 'text');
  ok(!items.some((i) => JSON.stringify(i).includes('Shared summary')), 'F6 and nothing was written meanwhile');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  ai.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
