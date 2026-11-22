// An agent is another door into Kloomie, so the same rules hold there (CODING-GUIDE 1 and 2): tools switched off for
// the team or for members, social posts for owners and admins only, checked again when a draft is approved or undone,
// and no names or text of things the person can't see in a step or a tool's answer.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/agent_perms';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5401, AI_PORT = 5400, B = `http://127.0.0.1:${PORT}`, F = `http://127.0.0.1:${AI_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// The stand-in model calls whatever the request says after RUN:, and keeps what the tools answered.
let answers = [], offered = [];
const pz = [];
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const out = (x) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(x)); };
    const u = new URL(req.url, F);
    if (u.pathname.startsWith('/pz/')) {
      pz.push(`${req.method} ${u.pathname}`);
      if (u.pathname.endsWith('/integrations')) return out([{ id: 'fb1', name: 'Company page', identifier: 'facebook', disabled: false }]);
      if (u.pathname.endsWith('/posts') && req.method === 'POST') return out([{ postId: 'p1', integration: 'fb1' }]);
      if (u.pathname.endsWith('/posts')) return out({ posts: [{ id: 'p0', content: 'Secret launch', state: 'ERROR', error: 'SECRET-POSTIZ-ERROR', integration: { name: 'Company page' } }] });
      return out({ ok: true });
    }
    if (u.pathname.startsWith('/v1/models')) return out({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false });
    const j = JSON.parse(b);
    offered = (j.tools || []).map((t) => t.name);
    const last = [...j.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    const after = j.messages.slice(j.messages.lastIndexOf(last) + 1);
    const reply = (content, stop = 'end_turn') => out({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const script = last?.content.match(/RUN:(.*):END/)?.[1];
    if (after.length || !script) { answers.push(JSON.stringify(after)); return reply([{ type: 'text', text: 'Done.' }]); }
    reply(JSON.parse(script).map(([name, input], i) => ({ type: 'tool_use', id: 't' + i, name, input })), 'tool_use');
  });
});
await new Promise((r) => fake.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ALLOW_LOCAL_WEBHOOKS: '1', ANTHROPIC_BASE_URL: F, POSTIZ_URL: F + '/pz/public/v1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const steps = (x) => x.parts.flatMap((p) => p.steps);
async function run(who, agent, tools) {
  answers = [];
  const r = await who('POST', '/agents/runs', { agent, ask: `RUN:${JSON.stringify(tools)}:END` });
  if (r.status !== 200) throw new Error('run: ' + JSON.stringify(r.body));
  for (let i = 0; i < 100; i++) {
    const x = (await who('GET', '/agents/runs/' + r.body.id)).body;
    if (!['requested', 'planning', 'running'].includes(x.status)) return { x, said: answers.join(' ') + JSON.stringify(steps(x).map((s) => [s.label, s.changed, s.names])), steps: steps(x) };
    await sleep(80);
  }
  throw new Error('run never finished');
}
const approve = async (who, x, s) => steps((await who('POST', `/agents/runs/${x.id}/steps`, { do: 'approve', id: s.id })).body).find((y) => y.id === s.id);
try {
  const t = Date.now(), team = 'Perms ' + t;
  const ada = call((await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' })).body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const ben = call((await call()('POST', '/auth', { mode: 'join', workspace: team, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  const benId = (await ben('GET', '/state')).body.me.memberId;
  for (const w of [ada, ben]) await w('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await ada('PATCH', '/workspace', { tools: { projects: true, bills: true, docs: true, contacts: true, email: true, inventory: true } });

  // What the tests look for.
  const open = (await ada('POST', '/projects', { template: 'blank', name: 'Open board' })).body;
  const hidden = (await ada('POST', '/projects', { template: 'blank', name: 'Owner board', private: true })).body;
  const rec = async (p, name) => (await ada('POST', `/projects/${p.id}/records`, { typeId: p.types[0].id, values: { [p.types[0].primary]: name } })).body;
  const openRec = await rec(open, 'OPEN-JOB');
  const hidRec = await rec(hidden, 'SECRET-JOB');
  const camp = (await ada('POST', '/campaigns', { name: 'SECRET-CAMPAIGN', private: true })).body;
  const goal = (await ada('POST', '/goals', { campaignId: camp.id, title: 'Quiet goal', kind: 'tasks' })).body;
  await ada('POST', '/tasks', { text: 'SECRET-TASK', goalId: goal.id, recordId: openRec.id });
  await ada('POST', '/tasks', { text: 'A task for Ben', assigneeId: benId, recordId: hidRec.id });
  await ada('POST', '/msg-templates', { kind: 'email', name: 'WELCOME-TEMPLATE', subject: 'Hi', body: 'Welcome' });
  await ben('POST', '/bills', { name: 'BEN-BILL', amount: 20, due: '2026-12-01', scope: 'personal', repeat: 'monthly' });
  const inv = (await ada('POST', `/records/${openRec.id}/invoices`, {})).body;
  ok(open.id && hidRec.id && camp.id && (await ben('GET', '/state')).body.campaigns.every((c) => c.id !== camp.id), 'set up: a private board and a private campaign Ben can’t see');

  // Social posting is the company's: owners and admins.
  ok((await ada('PUT', '/postiz', { key: 'pz-good-key-123' })).status === 200, 'set up: Postiz connected');
  pz.length = 0;
  let r = await run(ben, 'marketing', [['draft_social_post', { channels: ['Facebook'], text: 'A member’s post' }]]);
  let s = r.steps[0];
  if (s?.status === 'proposed') s = await approve(ben, r.x, s);
  ok(s?.status === 'failed' && !pz.some((c) => c.startsWith('POST') && c.endsWith('/posts')), 'a member’s agent can’t post to the company’s social channels');
  r = await run(ben, 'marketing', [['marketing_snapshot', {}]]);
  ok(!r.said.includes('SECRET-POSTIZ-ERROR'), 'or read the company’s posts through the marketing snapshot');
  await ada('PATCH', '/members/' + benId, { role: 'admin' });
  r = await run(ben, 'marketing', [['draft_social_post', { channels: ['Facebook'], text: 'An admin’s post' }]]);
  ok(r.steps[0].status === 'proposed', 'an admin’s agent can draft one');
  await ada('PATCH', '/members/' + benId, { role: 'member' });
  pz.length = 0;
  ok((await approve(ben, r.x, r.steps[0])).status === 'failed' && !pz.some((c) => c.startsWith('POST')), 'approving is checked again: no longer an admin, no post');
  await ada('PATCH', '/members/' + benId, { role: 'admin' });
  r = await run(ben, 'marketing', [['draft_social_post', { channels: ['Facebook'], text: 'A later post', when: '2030-01-02 09:30' }]]);
  s = await approve(ben, r.x, r.steps[0]);
  ok(s.status === 'done', 'an admin can schedule one');
  await ada('PATCH', '/members/' + benId, { role: 'member' });
  pz.length = 0;
  await ben('POST', `/agents/runs/${r.x.id}/steps`, { do: 'undo', id: s.id });
  ok(!pz.some((c) => c.startsWith('DELETE')), 'undo is checked again: no longer an admin, no taking posts down');

  // Names and text of what Ben can't see.
  await ben('PATCH', '/agents/marketing', { level: 'prepare' });
  r = await run(ben, 'marketing', [['make_list', { campaign: camp.id, name: 'People', filter: {} }]]);
  ok(!r.said.includes('SECRET-CAMPAIGN'), 'a step’s label doesn’t name a private campaign');
  r = await run(ben, 'ops', [['send_invoice', { invoice_id: inv.id }]]);
  ok(inv.number && !r.said.includes(inv.number), 'a step’s label doesn’t name an invoice only owners and admins see');
  r = await run(ben, 'sales', [['draft_email', { to_email: 'cust@t.test', subject: 'Hello', body: 'Hi there', record_id: hidRec.id }]]);
  s = await approve(ben, r.x, r.steps[0]);
  ok(!JSON.stringify(s).includes('SECRET-JOB'), 'what an email changed doesn’t name a private record');
  r = await run(ben, 'ops', [['read_record', { id: openRec.id }]]);
  ok(r.said.includes('OPEN-JOB') && !r.said.includes('SECRET-TASK'), 'reading a record leaves out a private campaign’s task');
  r = await run(ben, 'chief', [['list_tasks', { which: 'mine' }]]);
  ok(r.said.includes('A task for Ben') && !r.said.includes('SECRET-JOB'), 'a task doesn’t name the private record it’s on');

  // What's off for members is off for their agents, whichever way the tool gets its data.
  const CASES = [
    ['bills', 'chief', ['look_at_money', {}], 'BEN-BILL'],
    ['projects', 'ops', ['find_records', {}], 'OPEN-JOB'],
    ['projects', 'ops', ['list_projects', {}], 'Open board'],
    ['projects', 'ops', ['read_record', { id: openRec.id }], 'OPEN-JOB'],
    ['templates', 'sales', ['find_templates', {}], 'WELCOME-TEMPLATE'],
  ];
  for (const [key, agent, tool, word] of CASES) {
    ok((await run(ben, agent, [tool])).said.includes(word), `${tool[0]} works while ${key} is on`);
    await ada('PATCH', '/workspace', { memberAccess: { [key]: false } });
    r = await run(ben, agent, [tool]);
    ok(!r.said.includes(word) && !offered.includes(tool[0]) && r.steps[0]?.status === 'failed', `${tool[0]}: refused, and not offered, with ${key} off for members`);
    await ada('PATCH', '/workspace', { memberAccess: { [key]: true } });
  }
  await ada('PATCH', '/workspace', { memberAccess: { docs: false } });
  r = await run(ben, 'chief', [['write_doc', { title: 'Not allowed', text: 'No' }]]);
  ok(r.steps[0]?.status === 'failed', 'write_doc: refused with Docs off for members');
  await ada('PATCH', '/workspace', { memberAccess: { docs: true, projects: false, bills: false } });
  r = await run(ada, 'ops', [['find_records', {}]]);
  ok(r.said.includes('OPEN-JOB'), 'owners keep everything that’s only off for members');
  await ada('PATCH', '/workspace', { memberAccess: { projects: true, bills: true }, tools: { projects: false, bills: false } });
  ok(!(await run(ada, 'ops', [['find_records', {}]])).said.includes('OPEN-JOB'), 'off for the whole team is off for an owner’s agent');
  r = await run(ada, 'chief', [['set_budget', { category: 'Fuel', limit: 100 }]]);
  ok(r.steps[0]?.status === 'failed', 'changes too, not only reads');

  // Switched off between the draft and the yes.
  await ada('PATCH', '/workspace', { tools: { projects: true, bills: true } });
  await ben('PATCH', '/agents/ops', { level: 'prepare' });
  r = await run(ben, 'ops', [['create_record', { project: 'Open board', list: open.types[0].name, values: { Name: 'Drafted earlier' } }]]);
  ok(r.steps[0]?.status === 'proposed', 'a change is drafted while Boards is on');
  await ada('PATCH', '/workspace', { memberAccess: { projects: false } });
  ok((await approve(ben, r.x, r.steps[0])).status === 'failed', 'a draft can’t be approved after its tool was switched off');
  ok(!/agent run failed|ReferenceError|TypeError/i.test(srv.log), 'no server errors');
} catch (e) {
  console.log('FAIL threw: ' + e.stack + srv.log.slice(-1500));
  fails++;
}
srv.kill();
fake.close();
console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(fails ? 1 : 0);
