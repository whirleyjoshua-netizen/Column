// Audit (docs/audit/FINDINGS.md): A9, email from Kloomie's own address needs a confirmed account (REQUIRE_CONFIRMED_SEND
// stands in for real email being on); F5, a member's agent can't pick an admin-only contact by name.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_send';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4915, AI = 4916, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let SCRIPT = [];
let learnCalls = 0;
const ai = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'T', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    if (JSON.stringify(j.system || '').includes('compare AI drafts')) { learnCalls++; return res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: '{"seen":"x","entries":[]}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })); }
    const n = j.messages.length - 1;
    const step = SCRIPT[Math.min(Math.floor(n / 2), SCRIPT.length - 1)];
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (typeof step === 'string') return reply([{ type: 'text', text: step }]);
    reply(step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${n}_${i}`, name, input })), 'tool_use');
  });
});
await new Promise((r) => ai.listen(AI, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', REQUIRE_CONFIRMED_SEND: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI}` }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const OUT = DIR + '/outbox';
const mails = () => (fs.existsSync(OUT) ? fs.readdirSync(OUT).map((f) => JSON.parse(fs.readFileSync(OUT + '/' + f, 'utf8'))) : []);
const runAgent = async (who, agent, ask) => {
  const r = await who('POST', '/agents/runs', { agent, ask });
  let run = null;
  for (let i = 0; i < 80; i++) { run = (await who('GET', '/agents/runs/' + r.body.id)).body; if (!['requested', 'planning', 'running'].includes(run.status)) break; await sleep(150); }
  return run;
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Send ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r.body.token);
  await ada('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });

  // A9
  SCRIPT = [[['draft_email', { to_name: 'Dana', to_email: 'dana@x.test', subject: 'Hi', body: 'Hello Dana' }]], 'done'];
  let run = await runAgent(ada, 'sales', 'Email Dana.');
  let step = run.parts.flatMap((p) => p.steps).find((s) => s.tool === 'draft_email');
  await ada('POST', `/agents/runs/${run.id}/steps`, { do: 'approve', ids: [step.id] });
  await sleep(300);
  ok(!mails().some((m) => m.to === 'dana@x.test'), 'A9 an unconfirmed account can’t send email from Kloomie’s address');
  const code = mails().filter((m) => m.to === `ada${t}@t.test`).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
  await ada('POST', '/account/verify', { code });
  run = await runAgent(ada, 'sales', 'Email Dana again.');
  step = run.parts.flatMap((p) => p.steps).find((s) => s.tool === 'draft_email');
  await ada('POST', `/agents/runs/${run.id}/steps`, { do: 'approve', ids: [step.id] });
  await sleep(300);
  ok(mails().some((m) => m.to === 'dana@x.test'), 'A9 once the email is confirmed, it sends');

  // F5
  const inv = (await ada('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Send ' + t, code: inv, name: 'Max', email: `max${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const max = call(r.body.token);
  await max('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-0987654321' });
  await ada('POST', '/contacts', { name: 'Secret Client', email: 'secret@x.test', phone: '555-0000' });
  const p = (await ada('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const custName = tp.fields.find((f) => f.key === 'customer').name, jobName = tp.fields.find((f) => f.id === tp.primary).name;
  SCRIPT = [[['create_record', { project: p.name, list: tp.name, values: { [jobName]: 'Peek job', [custName]: 'Secret Client' } }]], 'done'];
  run = await runAgent(max, 'ops', 'Make a job for Secret Client.');
  const recs = (await ada('GET', `/projects/${p.id}/records`)).body;
  const made = (Array.isArray(recs) ? recs : recs.records || []).find((x) => x.values[tp.primary] === 'Peek job');
  ok(!made || !made.values[tp.fields.find((f) => f.key === 'customer').id], 'F5 a member’s agent can’t attach an admin-only contact by name (and see their details)');

  // F7: a member sending edit after edit can't run up the owner's AI key: at most one learning run an hour per team.
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Send ' + t, code: inv, name: 'Nia', email: `nia${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const nia = call(r.body.token);
  for (let i = 0; i < 12; i++) await nia('POST', '/hq/learn', { kind: 'email', draft: `Hi there!!! Draft number ${i} is here!!! Let me know ASAP!!!`, final: `Hello. This is a calmer version, number ${i}, written by hand for the customer.` });
  await sleep(400);
  ok(learnCalls <= 1, `F7 twelve edits from a member make at most one AI call on the owner’s key (${learnCalls})`);
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  ai.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
