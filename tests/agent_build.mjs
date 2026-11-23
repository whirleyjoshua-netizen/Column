// Build your own agents (2026-11-22, agent builder step 3): describe it and the AI drafts a name, icon, job, connections
// and workflows (only modes that exist); save it; it runs with only the tools its connections give, from the job its
// builder wrote, under Kloomie's rules. A test run holds every change as a draft. It's the builder's alone, on every
// path (the agents list, the app's list, runs, settings, delete, automations, saved asks, chat pins). Workflows can be
// scheduled. Limits on names, size and count. Owners can turn building off for members; agents already made still work.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/agent_build';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5441, AI_PORT = 5440, B = `http://127.0.0.1:${PORT}`, F = `http://127.0.0.1:${AI_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// The stand-in model: a draft when asked to build one; otherwise it calls whatever the request says after RUN:.
let offered = [], system = '', drafts = 0;
const DRAFT = { name: 'Estimate Checker', icon: '📐', job: 'You check every estimate before it goes out.\n- Look for missing measurements\n- Make a task to fix each one', connections: { tasks: 'act', jobs: 'read', money: 'everything', nope: 'act' }, workflows: [{ name: 'Check this week’s estimates', ask: 'Check every estimate made this week.' }, { name: 'x' }, { name: 'a', ask: 'b' }, { name: 'c', ask: 'd' }, { name: 'e', ask: 'f' }] };
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const out = (x) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(x)); };
    if (req.url.startsWith('/v1/models')) return out({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false });
    const j = JSON.parse(b);
    system = typeof j.system === 'string' ? j.system : j.system.map((s) => s.text).join(' ');
    offered = (j.tools || []).map((t) => t.name);
    const reply = (content, stop = 'end_turn') => out({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    if (system.includes('build an AI agent')) { drafts++; return reply([{ type: 'text', text: 'Here it is: ' + JSON.stringify(DRAFT) }]); }
    const last = [...j.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    const after = j.messages.slice(j.messages.lastIndexOf(last) + 1);
    const script = last?.content.match(/RUN:(.*):END/)?.[1];
    if (after.length || !script) return reply([{ type: 'text', text: 'Done.' }]);
    reply(JSON.parse(script).map(([name, input], i) => ({ type: 'tool_use', id: 't' + i, name, input })), 'tool_use');
  });
});
await new Promise((r) => fake.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: F, AGENT_TICK_MS: '400' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const steps = (x) => x.parts.flatMap((p) => p.steps);
async function finished(who, id) {
  for (let i = 0; i < 100; i++) {
    const x = (await who('GET', '/agents/runs/' + id)).body;
    if (!['requested', 'planning', 'running'].includes(x.status)) return x;
    await sleep(80);
  }
  throw new Error('run never finished');
}
async function run(who, agent, tools, more = {}) {
  const r = await who('POST', '/agents/runs', { agent, ask: `RUN:${JSON.stringify(tools)}:END`, ...more });
  if (r.status !== 200) throw new Error('run: ' + JSON.stringify(r.body));
  return finished(who, r.body.id);
}
try {
  const t = Date.now(), team = 'Build ' + t;
  const ada = call((await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' })).body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const ben = call((await call()('POST', '/auth', { mode: 'join', workspace: team, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  for (const w of [ada, ben]) await w('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await ada('PATCH', '/workspace', { tools: { projects: true, bills: true } });
  const get = async (who = ada) => (await who('GET', '/agents')).body;
  const tools = (a) => a.tools.map((x) => x.key);

  // What there is to build with.
  const g0 = await get();
  ok(g0.catalog?.length >= 10 && g0.catalog.every((c) => c.key && c.name && c.modes.includes('off')) && g0.build && !g0.build.off && g0.build.max === 20, 'Agents lists the connections to build with, and building is on');

  // Describe it: the AI drafts it; nothing saved; only modes that exist.
  ok((await ada('POST', '/agents/draft', { describe: 'hi' })).status === 400, 'a description needs a sentence');
  const dr = await ada('POST', '/agents/draft', { describe: 'Check my estimates before they go out and make me tasks to fix them.' });
  ok(dr.status === 200 && dr.body.name === 'Estimate Checker' && dr.body.icon === '📐' && dr.body.job.startsWith('You check every estimate'), 'the AI drafts a name, icon and job from a description');
  ok(dr.body.connections?.tasks === 'act' && dr.body.connections.jobs === 'read' && dr.body.connections.money === 'off' && !('nope' in dr.body.connections), 'its connections: only real ones, only real modes (a made-up mode is off)');
  ok(dr.body.workflows.length === 3 && dr.body.workflows.every((w) => w.name && w.ask), 'its workflows: whole ones only, at most four: ' + dr.body.workflows.length);
  ok(Object.keys((await get()).agents).every((k) => !k.startsWith('my_')), 'a draft isn’t saved');

  // Save it.
  let r = await ada('POST', '/agents/mine', { ...dr.body, name: 'Chief of Staff' });
  ok(r.status === 400, 'a built-in’s name is taken');
  r = await ada('POST', '/agents/mine', { ...dr.body, job: '  ' });
  ok(r.status === 400, 'it needs a job');
  r = await ada('POST', '/agents/mine', { ...dr.body, job: 'x'.repeat(6001) });
  ok(r.status === 400, 'a job over 6,000 characters is refused');
  r = await ada('POST', '/agents/mine', { ...dr.body, connections: { tasks: 'everything' } });
  ok(r.status === 400, 'a connection set to a mode that isn’t one is refused');
  r = await ada('POST', '/agents/mine', { ...dr.body, icon: '<img src=x>' });
  const mine = r.body, key = mine?.key;
  ok(r.status === 200 && /^my_/.test(key) && mine.own && mine.name === 'Estimate Checker' && mine.icon === '✨', 'saved: its own key, and an icon that isn’t an emoji is replaced');
  ok(tools(mine).includes('create_task') && tools(mine).includes('list_tasks') && tools(mine).includes('find_records') && !tools(mine).includes('create_record') && !tools(mine).includes('look_at_money') && tools(mine).includes('notify_me'), 'its tools are exactly its connections: Tasks to act, Jobs to read, Money off');
  ok(mine.connections.find((c) => c.key === 'jobs').mode === 'read' && mine.connections.find((c) => c.key === 'money').mode === 'off' && mine.job.text.startsWith('You check'), 'its connections and job read back');
  ok((await ada('POST', '/agents/mine', { ...dr.body })).status === 400, 'the same name twice is refused');
  const list = (await ada('GET', '/state')).body.workspace.agentList;
  ok(list.some((a) => a.key === key && a.own && a.name === 'Estimate Checker') && list.findIndex((a) => a.key === key) === list.length - 1, 'the app’s list of agents has it, after the built-ins');

  // Only Ada's.
  ok(!Object.keys((await get(ben)).agents).includes(key) && !(await ben('GET', '/state')).body.workspace.agentList.some((a) => a.key === key), 'Ben doesn’t see it, in Agents or the app’s list');
  ok((await ben('POST', '/agents/runs', { agent: key, ask: 'hi' })).status === 400, 'Ben can’t ask it');
  ok((await ben('PATCH', '/agents/' + key, { name: 'Mine now' })).status >= 400 && (await ben('PATCH', '/agents/' + key, { level: 'observe' })).status >= 400, 'or change it');
  ok((await ben('DELETE', '/agents/' + key)).status >= 400 && (await get()).agents[key], 'or delete it');
  ok((await ben('POST', '/automations', { name: 'x', trigger: { kind: 'task.done' }, actions: [{ kind: 'agent', agent: key, ask: 'hi' }] })).status >= 400, 'or put it in an automation');
  const sa = (await ben('POST', '/task-presets', { kind: 'ask', ask: 'Check them', agent: key, name: 'Check' })).body;
  ok(sa?.agent === 'team', 'or save an ask for it (it goes to his team instead)');
  for (const bad of ['my_constructor', 'my___proto__', 'my_', 'my_' + key]) ok((await ada('POST', '/agents/runs', { agent: bad, ask: 'hi' })).status === 400, `“${bad}” isn’t an agent`);
  ok((await ada('POST', '/channels/general/pins', { kind: 'agent', id: 'chief' })).status === 200, '(a built-in can be pinned to a chat)');
  const pin = await ada('POST', '/channels/general/pins', { kind: 'agent', id: key });
  ok(pin.status === 404 && !JSON.stringify((await ben('GET', '/state')).body).includes('Estimate Checker'), 'hers can’t be pinned to a chat everyone reads (sharing is next): ' + pin.status);

  // It runs with its own job, under Kloomie's rules, with only its tools.
  let x = await run(ada, key, [['list_tasks', {}]]);
  ok(x.status === 'completed' && system.includes('You are the Estimate Checker') && system.includes('You check every estimate before it goes out.') && system.includes('Kloomie’s own rules'), 'it works from the job Ada wrote, with Kloomie’s rules after it');
  ok(offered.includes('create_task') && offered.includes('find_records') && !offered.includes('create_record') && !offered.includes('look_at_money'), 'it’s offered only its tools: ' + offered.join(','));
  const recsBefore = (await ada('GET', '/state')).body.tasks.length;
  await ada('POST', '/budgets', { name: 'SECRET-BUDGET', amount: 500 });
  x = await run(ada, key, [['create_record', { project: 'Jobs', values: { Name: 'Sneaky' } }], ['look_at_money', {}]]);
  ok(!steps(x).some((s) => ['create_record', 'look_at_money'].includes(s.tool) && s.status === 'done') && !JSON.stringify(x).includes('SECRET-BUDGET'), 'a tool it wasn’t given can’t be called: ' + JSON.stringify(steps(x).map((s) => [s.tool, s.status])));
  x = await run(ada, key, [['create_task', { text: 'Fix the Lee estimate' }]]);
  ok(steps(x).some((s) => s.tool === 'create_task' && s.status === 'done') && (await ada('GET', '/state')).body.tasks.some((y) => y.text === 'Fix the Lee estimate'), 'at Execute it makes the task itself');

  // A test run: every change is a draft.
  x = await run(ada, key, [['create_task', { text: 'Test only task' }]], { test: true });
  ok(x.test === true && steps(x).some((s) => s.tool === 'create_task' && s.status === 'proposed') && !(await ada('GET', '/state')).body.tasks.some((y) => y.text === 'Test only task'), 'a test run holds the change as a draft, made only if approved');
  ok(!offered.includes('hand_off'), 'and doesn’t hand anything to another agent');
  x = await run(ada, key, [['hand_off', { agent: 'chief', ask: 'make tasks' }]], { test: true });
  ok(x.parts.length === 1, 'even if it tries');
  ok((await ada('GET', '/state')).body.tasks.length >= recsBefore, 'nothing was lost');

  // Change it: name, job, connections, workflows; schedules follow workflows.
  r = await ada('PATCH', '/agents/' + key, { name: 'Quote Checker', icon: '🧮', connections: { money: 'read' }, job: 'You check quotes.' });
  ok(r.status === 200 && r.body.name === 'Quote Checker' && r.body.icon === '🧮' && tools(r.body).includes('look_at_money') && !tools(r.body).includes('add_bill') && tools(r.body).includes('create_task') && r.body.job.text === 'You check quotes.', 'its name, icon, job and connections change (the rest stay)');
  ok((await ada('PATCH', '/agents/' + key, { job: '' })).status === 400, 'its job can’t be emptied');
  const wfs = r.body.workflows;
  r = await ada('PATCH', '/agents/' + key, { workflows: [...wfs, { name: 'Friday check', ask: 'RUN:[["list_tasks",{}]]:END' }] });
  const fri = r.body.workflows.find((w) => w.name === 'Friday check');
  ok(r.status === 200 && fri?.key && r.body.workflows.filter((w) => wfs.some((o) => o.key === w.key)).length === wfs.length, 'a workflow is added; the others keep their keys');
  ok((await ada('PATCH', '/agents/' + key, { workflows: Array.from({ length: 9 }, (_, i) => ({ name: 'w' + i, ask: 'a' })) })).status === 400, 'up to 8 workflows');
  x = await finished(ada, (await ada('POST', '/agents/runs', { agent: key, workflow: fri.key })).body.id);
  ok(x.title === 'Friday check' && x.status === 'completed', 'a workflow runs in one tap');
  // A schedule a minute ago, at Automate: it runs on its own.
  const tz = (await ada('GET', '/state')).body.workspace.tz || 'UTC';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date()).map((y) => [y.type, y.value]));
  const nowMin = (Number(p.hour) % 24) * 60 + Number(p.minute), dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  r = await ada('PATCH', '/agents/' + key, { level: 'automate', schedules: [{ workflow: fri.key, days: [dow], at: Math.max(0, nowMin - 1) }, { workflow: 'nope', days: [1], at: 60 }] });
  ok(r.status === 200 && r.body.schedules.length === 1, 'its own workflow can be scheduled (one that isn’t its own can’t)');
  let ran = null;
  for (let i = 0; i < 40 && !ran; i++) { await sleep(150); ran = (await get()).runs.find((y) => y.scheduled && y.agent === key); }
  ok(!!ran && ran.title === 'Friday check', 'and runs on schedule');
  r = await ada('PATCH', '/agents/' + key, { workflows: wfs });
  ok(r.body.schedules.length === 0, 'taking the workflow away takes its schedule too');

  // An automation can ask it, for its maker.
  r = await ada('POST', '/automations', { name: 'Check new quotes', trigger: { kind: 'task.done' }, actions: [{ kind: 'agent', agent: key, ask: 'Check it' }] });
  ok(r.status === 200, 'Ada’s automation can ask her own agent');
  const sa2 = (await ada('POST', '/task-presets', { kind: 'ask', ask: 'Check them', agent: key, name: 'Check' })).body;
  ok(sa2?.agent === key, 'and her saved asks can go to it');

  // As many as twenty.
  for (let i = 0; i < 19; i++) await ada('POST', '/agents/mine', { name: 'Helper ' + i, job: 'You help.', connections: {} });
  ok(Object.keys((await get()).agents).filter((k) => k.startsWith('my_')).length === 20 && (await ada('POST', '/agents/mine', { name: 'One more', job: 'You help.' })).status === 400, 'twenty agents of your own at most');

  // Owners can turn building off for members; what's built still works.
  const bens = (await ben('POST', '/agents/mine', { name: 'Ben’s helper', job: 'You help Ben.', connections: { tasks: 'read' } })).body;
  ok(bens?.key && bens.key !== key, 'a member builds his own');
  ok((await ben('PATCH', '/workspace', { memberAccess: { agentBuild: false } })).status === 403, 'a member can’t turn building off');
  await ada('PATCH', '/workspace', { memberAccess: { agentBuild: false } });
  ok((await get(ben)).build.off && (await ben('POST', '/agents/mine', { name: 'Another', job: 'x' })).status === 403 && (await ben('POST', '/agents/draft', { describe: 'Something to do my invoices for me' })).status === 403, 'off for members: Ben can’t build or draft');
  ok((await ben('PATCH', '/agents/' + bens.key, { job: 'You do anything.' })).status === 403 && (await ben('PATCH', '/agents/' + bens.key, { level: 'prepare' })).status === 200, 'or change what his agent is, but its level he can');
  x = await run(ben, bens.key, [['list_tasks', {}]]);
  ok(x.status === 'completed', 'and the one he made still works');
  ok(!(await get()).build.off && (await ada('PATCH', '/agents/' + key, { name: 'Quote Checker 2' })).status === 200, 'owners still build');
  await ada('PATCH', '/workspace', { memberAccess: { agentBuild: true } });

  // Delete it.
  ok((await ada('DELETE', '/agents/' + key)).status === 200, 'it can be deleted');
  const g1 = await get();
  ok(!g1.agents[key] && g1.runs.some((y) => y.agent === key) && !(await ada('GET', '/state')).body.workspace.agentList.some((a) => a.key === key), 'it’s gone from the lists; its past work stays');
  ok((await ada('POST', '/agents/runs', { agent: key, ask: 'hi' })).status === 400, 'and it can’t be asked any more');
  // Ben leaves: the agents he built go with him.
  const benId = (await ben('GET', '/state')).body.me.memberId;
  ok((await ada('DELETE', '/members/' + benId)).status === 200, '(Ben is removed from the team)');
  const saved = () => { try { const db = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8')); return !Object.values(db.myAgents || {}).some((y) => y.memberId === benId) && Object.values(db.myAgents || {}).some((y) => y.name === 'Helper 0'); } catch { return false; } };
  let gone = false;
  for (let i = 0; i < 40 && !(gone = saved()); i++) await sleep(150);
  ok(gone, 'his agents go with him; Ada’s stay (and are saved)');
  ok(!/ReferenceError|TypeError|Agent run failed/i.test(srv.log), 'no server errors');
} catch (e) {
  console.log('FAIL threw: ' + e.stack + srv.log.slice(-1500));
  fails++;
}
srv.kill();
fake.close();
console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(fails ? 1 : 0);
