// Agents: the three specialists working through the API as the person. Reads change nothing; at execute, routine
// changes land as real tasks, calendar time, contacts, records and docs (made "by Ada's Chief of Staff"), each
// kept as a step with what it changed and how to undo it; emails always wait for a yes and go out only then;
// prepare proposes everything, observe only suggests; the coordinator splits a request across specialists and
// each hears what the others did; hand_off brings another one in; the team's rules still hold; schedules run at
// automate; and nobody sees anyone else's agents.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/agents';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4721, B = `http://127.0.0.1:${PORT}`, AI_PORT = 4720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// A stand-in for Claude that follows a script per request: which tools to call on each turn, then a report.
const asked = [];
const text = (c) => (typeof c === 'string' ? c : (c || []).map((b) => b.text || (b.type === 'tool_result' ? b.content : '')).join(' '));
let today = '';
const OPS = { job: null, inv: null }; // ids the invoice and sign-off scripts use, set as the test goes
const SCRIPTS = {
  'plan my day': (n, sys, last) => [
    [['look_at_day', {}], ['list_tasks', { which: 'overdue' }]],
    [['create_task', { text: 'Call the blind supplier about the Smith order', due: today, priority: 1, why: 'It was overdue' }], ['schedule_time', { text: 'Finish the Jones proposal', date: today, start: '9:00am', end: '10:30am' }]],
    'Your day: supplier call first, then the Jones proposal 9 to 10:30.',
  ][n],
  'new lead': (n) => [
    [['list_projects', {}]],
    [['save_contact', { name: 'Maria Lopez', email: 'maria@lopez.test', phone: '555-0101', company: 'Lopez Dental' }], ['create_record', { project: 'Sales', list: 'Contacts', values: { Name: 'Maria Lopez', Email: 'maria@lopez.test', Stage: 'Lead' } }]],
    [['create_record', { project: 'Sales', list: 'Deals', values: { Name: 'Lopez Dental office blinds', Stage: 'Proposal', Value: '4200', Contact: 'maria@lopez.test', Bogus: 'x' } }], ['draft_email', { to_name: 'Maria Lopez', to_email: 'maria@lopez.test', subject: 'Your office window coverings', body: 'Hi Maria,\n\nThanks for reaching out about blinds for Lopez Dental. Could we visit Tuesday or Wednesday morning to measure?\n\nBest,\nAda' }], ['create_task', { text: 'Follow up with Maria Lopez', due: today }]],
    'Lead recorded, reply drafted for you to send, follow-up set.',
  ][n],
  'prepare test': (n) => [[['create_task', { text: 'A proposed task' }], ['create_task', { text: 'Another proposed task' }]], 'Two tasks proposed.'][n],
  'observe test': (n) => [[['look_at_day', {}], ['create_task', { text: 'Should not exist' }]], 'I would add a task.'][n],
  'install checklist': (n) => [[['write_doc', { title: 'Smith install checklist', text: '# Before\n- [ ] Confirm measurements\n- [ ] Load 12 blinds' }]], 'Checklist written.'][n],
  'handoff test': (n) => [[['hand_off', { agent: 'ops', ask: 'Write the install checklist for the Smith job' }]], 'Handed the checklist to Operations.'][n],
  'customer wants a quote': (n, sys) => (sys.startsWith('You are the Client & Sales Manager')
    ? [[['create_task', { text: 'Send the Kim quote', due: today }]], 'Quote task set.'][n]
    : [[['create_task', { text: 'Prep the Kim estimate visit', due: today }]], 'Visit prep set.'][n]),
  'member undo': (n) => [[['create_record', { project: 'Sales', list: 'Deals', values: { Name: 'Ben deal' } }]], 'Deal made.'][n],
  'contacts as member': (n) => [[['find_contacts', { query: 'maria' }]], 'Couldn’t open Contacts.'][n],
  'morning briefing': (n) => [[['look_at_day', {}]], 'Briefing: nothing urgent.'][n],
  'follow up more': (n) => [[['create_task', { text: 'Second follow-up' }]], 'Added another.'][n],
  'money plan': (n) => [
    [['look_at_money', {}]],
    [['set_budget', { category: 'Fuel', limit: 300, scope: 'business', why: 'Trucks run daily' }], ['add_bill', { name: 'Truck lease', amount: 450, due: today, repeat: 'monthly', scope: 'business', why: 'Fixed cost' }]],
    'Planned your money: a fuel budget and the truck lease.',
  ][n],
  'garcia job': (n) => [[['create_record', { project: 'Jobs', list: 'Jobs', values: { Job: 'Garcia blinds', Value: '1800' } }]], 'Job made.'][n],
  'bill garcia': (n) => [[['draft_invoice', { record_id: OPS.job, why: 'Install is done' }], ['send_signoff', { record_id: OPS.job, name: 'Ana Garcia', email: 'ana@garcia.test' }]], 'Drafted the invoice.'][n],
  'send garcia': (n) => [[['send_invoice', { invoice_id: OPS.inv }]], 'Ready to send when you say.'][n],
  'hq fact': (n) => [[['add_to_company_hq', { kind: 'service', title: 'Window blinds', text: 'We measure and install blinds in Las Vegas homes and shops.', why: 'From the jobs' }]], 'Suggested an HQ entry.'][n],
  'template test': (n) => [[['find_templates', { kind: 'email' }]], [['save_template', { kind: 'reply', name: 'Thanks for the review', when: 'After a customer leaves a review', body: 'Thank you so much, {customer}!' }]], 'Used the quote template and saved a reply.'][n],
  'sop test': (n) => [[['read_sops', {}], ['read_sops', { name: 'blind install' }]], 'Followed the SOP.'][n],
  'restart test': (n) => [[['create_task', { text: 'Made before the restart' }]], 'never'][n],
};
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    const msgs = j.messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    asked.push({ sys, msgs: JSON.stringify(msgs), tools: (j.tools || []).map((t) => t.name) });
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (sys.includes('You coordinate four specialists')) {
      const u = text(msgs[0].content).toLowerCase();
      if (u.includes('vague')) return reply([{ type: 'text', text: JSON.stringify({ question: 'Which customer do you mean?', parts: [] }) }]);
      return reply([{ type: 'text', text: JSON.stringify({ summary: 'Sales records it, Operations preps the visit', parts: [{ agent: 'sales', ask: 'Customer wants a quote: set the quote task' }, { agent: 'ops', ask: 'Customer wants a quote: prep the visit' }], question: null }) }]);
    }
    const key = Object.keys(SCRIPTS).find((k) => text(lastUser?.content).toLowerCase().includes(k));
    // Turns since the last plain user message.
    const n = msgs.length - 1 - msgs.lastIndexOf(lastUser);
    const step = key ? SCRIPTS[key](Math.floor(n / 2), sys) : 'Done.';
    if (key === 'restart test' && n > 0) return; // hangs: the server is restarted while it waits
    if (typeof step === 'string' || !step) return reply([{ type: 'text', text: step || 'Done.' }]);
    reply([{ type: 'text', text: 'Working on it.' }, ...step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${n}_${i}`, name, input }))], 'tool_use');
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const boot = async () => {
  const p = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', AGENT_TICK_MS: '500', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = ''; p.stdout.on('data', (d) => (p.log += d)); p.stderr.on('data', (d) => (p.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
  return p;
};
let srv = await boot();
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Premier ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const ben = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Premier ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  await ada('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await ben('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-0987654321' });
  await ada('PATCH', '/workspace', { tools: { projects: true, bills: true } }); // agents follow the team's tool switches
  const st = (await ada('GET', '/state')).body;
  today = new Date().toLocaleDateString('en-CA'); // the team's clock is this machine's when no time zone is sent
  const wait = async (tok, id) => { for (let i = 0; i < 80; i++) { const x = (await tok('GET', '/agents/runs/' + id)).body; if (x && !['requested', 'planning', 'running'].includes(x.status)) return x; await sleep(100); } return (await tok('GET', '/agents/runs/' + id)).body; };
  const steps = (x) => x.parts.flatMap((p) => p.steps);

  r = await ada('GET', '/agents');
  ok(r.status === 200 && Object.keys(r.body.agents).join() === 'chief,sales,ops,marketing' && Object.values(r.body.agents).every((a) => a.level === 'execute'), 'four agents, each at execute (balanced) to start');
  ok(r.body.agents.sales.tools.find((x) => x.key === 'draft_email').important && !r.body.agents.chief.tools.some((x) => x.key === 'draft_email'), 'each has its own tools; emailing is marked important');
  ok((await ada('GET', '/state')).body.workspace.tools?.agents !== false, 'Agents are on for the team');

  // ----- Chief of Staff, at execute: Plan my day -----
  await ada('POST', '/tasks', { text: 'Old overdue thing', due: '2020-01-01' });
  r = await ada('POST', '/agents/runs', { agent: 'chief', workflow: 'plan_day' });
  let x = await wait(ada, r.body.id);
  ok(x.status === 'completed' && x.title === 'Plan my day' && /supplier call first/.test(x.parts[0].report), 'Plan my day: the Chief of Staff finishes with a report');
  const sc = asked.find((q) => q.sys.includes('You are the Chief of Staff'));
  ok(sc.sys.includes('Ada') && sc.sys.includes('Ben') && sc.tools.includes('schedule_time') && !sc.tools.includes('draft_email') && sc.tools.includes('hand_off'), 'it hears who it works for and the team, with only its own tools (and hand_off)');
  ok(asked.some((q) => q.msgs.includes('Old overdue thing')), 'it reads the overdue task through the person’s own view');
  const s1 = steps(x);
  ok(s1.filter((s) => s.kind === 'read').length === 2 && s1.find((s) => s.tool === 'create_task').status === 'done' && s1.find((s) => s.tool === 'schedule_time').status === 'done', 'two reads, then the task and the time block are done');
  let state = (await ada('GET', '/state')).body;
  const madeTask = state.tasks.find((y) => y.text === 'Call the blind supplier about the Smith order');
  const madeEntry = state.entries.find((y) => y.text === 'Finish the Jones proposal');
  ok(madeTask && madeTask.due === today && madeTask.by === 'Ada’s Chief of Staff', 'a real task in the Day, made by “Ada’s Chief of Staff”');
  ok(madeEntry && madeEntry.start === 540 && madeEntry.end === 630, 'and real time on the calendar, 9 to 10:30');
  const st1 = s1.find((s) => s.tool === 'create_task');
  ok(st1.changed[0].id === madeTask.id && st1.why === 'It was overdue' && /Call the blind supplier/.test(st1.label), 'the step says what changed and why');
  r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'undo', id: st1.id });
  ok(steps(r.body).find((s) => s.id === st1.id).status === 'undone' && !(await ada('GET', '/state')).body.tasks.some((y) => y.id === madeTask.id), 'Undo takes the task away again');

  // ----- Client & Sales Manager: a new lead -----
  await ada('POST', '/projects', { template: 'crm', name: 'Sales' });
  r = await ada('POST', '/agents/runs', { agent: 'sales', workflow: 'lead', ask: 'From: Maria Lopez <maria@lopez.test>\nWe need blinds for our dental office.' });
  ok((await ada('POST', '/agents/runs', { agent: 'sales', workflow: 'lead' })).status === 400, 'a paste-in workflow needs something pasted');
  x = await wait(ada, r.body.id);
  const s2 = steps(x);
  ok(x.status === 'awaiting', 'the lead run waits for a yes (the email)');
  state = (await ada('GET', '/state')).body;
  const contact = (await ada('GET', '/contacts')).body.contacts.find((c) => c.email === 'maria@lopez.test');
  ok(contact && contact.company === 'Lopez Dental', 'the contact is saved in Contacts');
  const recs = (await ada('GET', `/projects/${state.projects.find((p) => p.name === 'Sales').id}/records`)).body;
  const deal = recs.find((y) => Object.values(y.values).includes('Lopez Dental office blinds'));
  const sales = state.projects.find((p) => p.name === 'Sales');
  const dealT = sales.types.find((y) => y.id === deal?.typeId);
  const F = (k) => dealT.fields.find((f) => f.key === k || f.name === k);
  ok(deal && deal.values[F('value').id] === 420000 && deal.values[F('stage').id] === F('stage').choices.find((c) => c.label === 'Proposal').id, 'a deal in the Sales project, $4,200 at Proposal (names and labels matched to Kloomie’s own)');
  const crmContact = recs.find((y) => Object.values(y.values).includes('Maria Lopez'));
  ok(crmContact && deal.values[F('contact').id]?.[0] === crmContact.id && deal.values[dealT.primary] === 'Lopez Dental office blinds', 'its name in the Deal field, and linked to Maria’s contact record (found by her email)');
  const em = s2.find((s) => s.tool === 'draft_email');
  ok(em.status === 'proposed' && !fs.existsSync(DIR + '/outbox') || (em.status === 'proposed' && !fs.readdirSync(DIR + '/outbox').some((f) => fs.readFileSync(DIR + '/outbox/' + f, 'utf8').includes('maria@lopez.test'))), 'the reply is a draft: nothing has been emailed');
  ok(s2.find((s) => s.tool === 'create_task' && s.status === 'done'), 'the follow-up task is made');
  // Edit the draft, then send it.
  r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'approve', id: em.id, args: { body: 'Hi Maria,\n\nTuesday at 9 works for us to measure.\n\nAda' } });
  const em2 = steps(r.body).find((s) => s.id === em.id);
  ok(em2.status === 'done' && r.body.status === 'completed', 'approving sends it, and the assignment is complete');
  const sent = fs.readdirSync(DIR + '/outbox').map((f) => fs.readFileSync(DIR + '/outbox/' + f, 'utf8')).find((f) => f.includes('maria@lopez.test'));
  ok(sent && sent.includes('Tuesday at 9') && !sent.includes('Wednesday morning'), 'with the person’s edits');

  // ----- Prepare: everything waits; approve one, skip one -----
  await ada('PATCH', '/agents/chief', { level: 'prepare' });
  r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'prepare test' });
  x = await wait(ada, r.body.id);
  const [p1, p2] = steps(x);
  ok(x.status === 'awaiting' && p1.status === 'proposed' && p2.status === 'proposed' && !(await ada('GET', '/state')).body.tasks.some((y) => y.text === 'A proposed task'), 'at prepare, changes are proposed and nothing is made');
  r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'approve', id: p1.id });
  await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'skip', id: p2.id });
  x = (await ada('GET', '/agents/runs/' + x.id)).body;
  state = (await ada('GET', '/state')).body;
  ok(state.tasks.some((y) => y.text === 'A proposed task') && !state.tasks.some((y) => y.text === 'Another proposed task') && x.status === 'completed', 'approve makes it, skip doesn’t, and then it’s complete');

  // ----- Observe: suggestions only -----
  await ada('PATCH', '/agents/chief', { level: 'observe' });
  r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'observe test' });
  x = await wait(ada, r.body.id);
  ok(steps(x).find((s) => s.tool === 'create_task').status === 'suggested' && !(await ada('GET', '/state')).body.tasks.some((y) => y.text === 'Should not exist'), 'at observe, a change is only a suggestion');
  ok(asked.at(-1).sys.includes('only look and report'), 'and it’s told so');
  await ada('PATCH', '/agents/chief', { level: 'execute' });

  // ----- Hand-off: the Chief of Staff brings in Operations -----
  r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'handoff test' });
  x = await wait(ada, r.body.id);
  ok(x.parts.length === 2 && x.parts[1].agent === 'ops' && x.parts[1].from === 'chief' && x.parts[1].status === 'completed', 'hand_off adds an Operations part, which runs next');
  ok((await ada('GET', '/state')).body.items.some((y) => y.title === 'Smith install checklist'), 'and Operations writes the checklist doc');
  ok(asked.some((q) => q.sys.includes('Operations Manager') && q.msgs.includes('What the Chief of Staff did')), 'Operations hears what the Chief of Staff did');

  // ----- The coordinator: one request, two specialists -----
  r = await ada('POST', '/agents/runs', { agent: 'team', ask: 'New customer Kim: the customer wants a quote and a visit next week' });
  x = await wait(ada, r.body.id);
  ok(x.plan === 'Sales records it, Operations preps the visit' && x.parts.map((p) => p.agent).join() === 'sales,ops' && x.status === 'completed', 'Ask your team: the coordinator splits it between Sales and Operations, in order');
  state = (await ada('GET', '/state')).body;
  ok(state.tasks.some((y) => y.text === 'Send the Kim quote' && y.by === 'Ada’s Client & Sales Manager') && state.tasks.some((y) => y.text === 'Prep the Kim estimate visit' && y.by === 'Ada’s Operations Manager'), 'each specialist’s work lands under its own name');
  ok(asked.some((q) => q.sys.includes('Operations Manager') && q.msgs.includes('Send the Kim quote')), 'Operations hears what Sales did');
  r = await ada('POST', '/agents/runs', { agent: 'team', ask: 'something vague' });
  x = await wait(ada, r.body.id);
  ok(x.status === 'blocked' && x.question === 'Which customer do you mean?', 'when it can’t tell, the coordinator asks first');

  // ----- Replying carries on the same assignment -----
  const done1 = (await ada('GET', '/agents')).body.runs.find((y) => y.title === 'Plan my day');
  r = await ada('POST', `/agents/runs/${done1.id}/reply`, { text: 'follow up more on that' });
  x = await wait(ada, done1.id);
  ok(x.parts.length === 2 && x.parts[1].reply && steps(x).some((s) => s.label.includes('Second follow-up')), 'a reply runs again in the same assignment');
  ok(asked.at(-1).msgs.includes('supplier call first'), 'remembering what it said before');

  // ----- The team's own rules still apply: Ben's undo of a deal needs Ada's OK -----
  await ada('PUT', '/rules', { deleteRecord: { level: 'approval' } });
  r = await ben('POST', '/agents/runs', { agent: 'sales', ask: 'member undo' });
  x = await wait(ben, r.body.id);
  const bd = steps(x).find((s) => s.tool === 'create_record');
  ok(bd.status === 'done', 'Ben’s Sales Manager makes a deal');
  r = await ben('POST', `/agents/runs/${x.id}/steps`, { do: 'undo', id: bd.id });
  ok(steps(r.body).find((s) => s.id === bd.id).status === 'done' && /OK/.test(steps(r.body).find((s) => s.id === bd.id).error), 'undoing it (a delete) waits for an owner’s OK under the team’s rules');
  r = await ben('POST', '/agents/runs', { agent: 'sales', ask: 'contacts as member' });
  x = await wait(ben, r.body.id);
  ok(steps(x)[0].status === 'failed' && /owners and admins/.test(steps(x)[0].error), 'Ben’s agent can’t open Contacts, because Ben can’t');

  // ----- Nobody sees anyone else's agents -----
  ok((await ben('GET', '/agents/runs/' + done1.id)).status === 404 && !(await ben('GET', '/agents')).body.runs.some((y) => y.id === done1.id), 'Ben can’t see Ada’s assignments');

  // ----- Settings and schedules -----
  ok((await ada('PATCH', '/agents/sales', { level: 'boss' })).status === 400, 'an unknown level is refused');
  r = await ada('PATCH', '/agents/sales', { instructions: 'Always offer a free measure.' });
  ok(r.body.instructions === 'Always offer a free measure.', 'standing instructions are kept');
  r = await ada('POST', '/agents/runs', { agent: 'sales', ask: 'contacts as member' });
  await wait(ada, r.body.id);
  ok(asked.at(-1).sys.includes('Always offer a free measure.'), 'and the agent hears them');
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  r = await ada('PATCH', '/agents/chief', { level: 'automate', schedules: [{ workflow: 'briefing', days: [0, 1, 2, 3, 4, 5, 6], at: nowMin }, { workflow: 'inbox', days: [1], at: 60 }, { workflow: 'nope', days: [1], at: 60 }] });
  ok(r.body.schedules.length === 1 && r.body.schedules[0].workflow === 'briefing', 'schedules keep only workflows that can run alone');
  let sched = null;
  for (let i = 0; i < 40 && !sched; i++) { await sleep(150); sched = (await ada('GET', '/agents')).body.runs.find((y) => y.scheduled && y.title === 'Morning briefing'); }
  ok(sched, 'at automate, the morning briefing runs on its own');
  if (sched) sched = await wait(ada, sched.id);
  await sleep(300);
  ok((await ada('GET', '/state')).body.notices.some((n) => n.title.startsWith('Chief of Staff: Morning briefing')), 'and the result comes as a notification');
  await sleep(1200);
  ok((await ada('GET', '/agents')).body.runs.filter((y) => y.scheduled).length === 1, 'once a day, not every tick');
  r = (await ada('GET', '/agents')).body.agents;
  ok(r.chief.stats.done >= 3 && r.chief.stats.undone === 1 && r.chief.stats.skipped === 1 && r.chief.stats.approved === 1, 'each agent’s record: done, approved, skipped, undone');

  // ----- A restart (a deploy) partway through: the assignment says so instead of spinning forever -----
  await ada('PATCH', '/agents/chief', { level: 'execute' });
  r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'restart test' });
  const rid0 = r.body.id;
  for (let i = 0; i < 50; i++) { if ((await ada('GET', '/agents/runs/' + rid0)).body.parts[0].steps.length) break; await sleep(100); }
  srv.kill('SIGTERM');
  await new Promise((res) => srv.on('exit', res));
  srv = await boot();
  x = (await ada('GET', '/agents/runs/' + rid0)).body;
  ok(x.status === 'failed' && /restarted/.test(x.error) && x.parts[0].steps[0].status === 'done', 'after a restart mid-run: marked as interrupted, keeping what it had done');
  ok((await ada('GET', '/state')).body.tasks.some((y) => y.text === 'Made before the restart'), 'and what it made is still there');

  // ----- Sidekick (2026-11-14): asked from a page, the team hears what the person is looking at -----
  {
    const before = asked.length;
    r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'follow up more on this', page: { kind: 'campaign', id: 'c_spring', label: 'Spring push' } });
    ok(r.status === 200 && r.body.page?.label === 'Spring push', 'an assignment keeps the page it was asked from');
    for (let i = 0; i < 60 && !asked.slice(before).some((a) => a.msgs.includes('Spring push')); i++) await sleep(100);
    ok(asked.slice(before).some((a) => a.msgs.includes('looking at') && a.msgs.includes('Spring push') && a.msgs.includes('c_spring')), 'and the agent is told what the person is looking at');
    const junk = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'follow up more', page: { kind: '<script>', id: 'x'.repeat(500), label: 'y'.repeat(900) } });
    ok(junk.status === 200 && !junk.body.page, 'a page of an unknown kind is dropped');
    for (let i = 0; i < 60; i++) { const d = (await ada('GET', '/agents')).body; if (!d.runs.some((x) => ['requested', 'planning', 'running'].includes(x.status))) break; await sleep(150); }
  }

  // ----- Plan my business (2026-11-14): money tools, and a plan where every change waits for a yes -----
  {
    await ada('PATCH', '/agents/chief', { level: 'execute' });
    // This month's money, business and personal (live check 2026-11-20: an agent called the business part the total).
    const mday = (await ada('GET', '/state')).body.today || new Date().toISOString().slice(0, 10);
    await ada('POST', '/money', { kind: 'out', amount: 45, day: mday, category: 'Gas', scope: 'business' });
    await ada('POST', '/money', { kind: 'out', amount: 62.4, day: mday, category: 'Home Depot', scope: 'personal' });
    const askedBefore = asked.length;
    r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'money plan for the business', plan: true });
    ok(r.status === 200 && r.body.asPlan === true, 'a plan run is marked as a plan');
    let x;
    for (let i = 0; i < 60; i++) { x = (await ada('GET', '/agents/runs/' + r.body.id)).body; if (!['requested', 'planning', 'running'].includes(x.status)) break; await sleep(150); }
    const steps = x.parts.flatMap((p) => p.steps);
    const read = steps.find((st) => st.tool === 'look_at_money');
    ok(read && read.status === 'done', 'it can look at budgets and bills');
    ok(asked.slice(askedBefore).map((q) => q.msgs.replace(/\\"/g, '"')).some((m) => m.includes('"thisMonth"') && m.includes('"total":{"in":0,"out":107.4}') && m.includes('"business":{"in":0,"out":45}')), 'and this month’s money in and out: business, personal and the total of both');
    ok(asked.some((q) => q.msgs.includes('plan for the person to review') && q.msgs.includes('Company HQ is empty')), 'a plan tells the agents where Company HQ is, and that no HQ section means it is empty (live, 2026-11-15, they went looking for it in docs)');
    const bud = steps.find((st) => st.tool === 'set_budget'), bill = steps.find((st) => st.tool === 'add_bill');
    ok(x.status === 'awaiting' && bud?.status === 'proposed' && bill?.status === 'proposed', 'even at execute, a plan only proposes: the budget and the bill wait for a yes');
    let st = (await ada('GET', '/state')).body;
    ok(!st.budgets.some((b) => b.category === 'Fuel') && !st.bills.some((b) => b.name === 'Truck lease'), 'nothing changed yet');
    r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'approve', ids: [bud.id, bill.id] });
    for (let i = 0; i < 30; i++) { st = (await ada('GET', '/state')).body; if (st.budgets.some((b) => b.category === 'Fuel') && st.bills.some((b) => b.name === 'Truck lease')) break; await sleep(100); }
    ok(st.budgets.some((b) => b.category === 'Fuel' && b.limit === 30000 && b.scope === 'business'), 'approved: a $300 business fuel budget');
    ok(st.bills.some((b) => b.name === 'Truck lease' && b.amount === 45000 && b.repeat === 'monthly'), 'and the $450 monthly truck lease bill');
    x = (await ada('GET', '/agents/runs/' + x.id)).body;
    const bstep = x.parts.flatMap((p) => p.steps).find((s2) => s2.tool === 'add_bill');
    r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'undo', id: bstep.id });
    st = (await ada('GET', '/state')).body;
    ok(r.status === 200 && !st.bills.some((b) => b.name === 'Truck lease'), 'and the bill can be undone');
    const bud2 = x.parts.flatMap((p) => p.steps).find((s2) => s2.tool === 'set_budget');
    r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'undo', id: bud2.id });
    st = (await ada('GET', '/state')).body;
    ok(r.status === 200 && !st.budgets.some((b) => b.category === 'Fuel'), 'so can the budget');
    r = await ada('GET', '/agents');
    ok(r.body.agents.chief.tools.some((t) => t.key === 'set_budget') && r.body.agents.chief.tools.some((t) => t.key === 'add_bill'), 'the Chief of Staff lists the money tools');
  }

  // ----- Running the business (2026-11-15): invoices, sign-offs and Company HQ, with the right ones waiting for a yes -----
  {
    const waitRun = async (id) => { let x; for (let i = 0; i < 60; i++) { x = (await ada('GET', '/agents/runs/' + id)).body; if (!['requested', 'planning', 'running'].includes(x.status)) break; await sleep(150); } return x; };
    const stepsOf = (x) => x.parts.flatMap((p) => p.steps);
    await ada('PATCH', '/agents/ops', { level: 'execute' });
    await ada('POST', '/projects', { template: 'jobs', name: 'Jobs' });
    await waitRun((await ada('POST', '/agents/runs', { agent: 'ops', ask: 'garcia job please' })).body.id);
    const st0 = (await ada('GET', '/state')).body;
    const jobsP = st0.projects.find((p) => p.name === 'Jobs');
    OPS.job = (await ada('GET', `/projects/${jobsP.id}/records`)).body.find((r2) => Object.values(r2.values || {}).includes('Garcia blinds'))?.id;
    ok(!!OPS.job, '(setup) a Garcia job to bill');
    let x = await waitRun((await ada('POST', '/agents/runs', { agent: 'ops', ask: 'bill garcia now' })).body.id);
    const inv = stepsOf(x).find((s2) => s2.tool === 'draft_invoice');
    let invs = (await ada('GET', '/invoices')).body;
    ok(inv?.status === 'done' && invs.some((i2) => i2.recordId === OPS.job && i2.status === 'draft'), 'Operations drafts an invoice from the job (a routine change, done at execute)');
    OPS.inv = invs.find((i2) => i2.recordId === OPS.job).id;
    const so = stepsOf(x).find((s2) => s2.tool === 'send_signoff');
    ok(so && so.status === 'failed' && /sign-off/i.test(so.error || ''), 'a sign-off on a job without a sign-off field fails, saying so: ' + (so?.error || so?.status));
    x = await waitRun((await ada('POST', '/agents/runs', { agent: 'ops', ask: 'send garcia invoice' })).body.id);
    const sendSt = stepsOf(x).find((s2) => s2.tool === 'send_invoice');
    invs = (await ada('GET', '/invoices')).body;
    ok(sendSt?.status === 'proposed' && invs.find((i2) => i2.id === OPS.inv).status === 'draft', 'sending an invoice always waits for a yes, even at execute');
    r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'skip', id: sendSt.id });
    r = await ada('POST', `/agents/runs/${(await ada('GET', '/agents')).body.runs.find((y) => y.ask.includes('bill garcia')).id}/steps`, { do: 'undo', id: inv.id });
    invs = (await ada('GET', '/invoices')).body;
    ok(invs.find((i2) => i2.id === OPS.inv).status === 'void', 'undoing the draft voids it');
    // Company HQ: an addition always waits for a yes; approved, it's in HQ; undone, it's gone.
    x = await waitRun((await ada('POST', '/agents/runs', { agent: 'chief', ask: 'hq fact please' })).body.id);
    const hq = stepsOf(x).find((s2) => s2.tool === 'add_to_company_hq');
    let h1 = (await ada('GET', '/hq')).body;
    ok(hq?.status === 'proposed' && !h1.entries.some((e2) => e2.title === 'Window blinds'), 'adding to Company HQ waits for a yes, even at execute');
    await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'approve', id: hq.id });
    h1 = (await ada('GET', '/hq')).body;
    ok(h1.entries.some((e2) => e2.kind === 'service' && e2.title === 'Window blinds' && e2.status === 'approved'), 'approved, it is in Company HQ as a service');
    await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'undo', id: hq.id });
    h1 = (await ada('GET', '/hq')).body;
    ok(!h1.entries.some((e2) => e2.title === 'Window blinds'), 'and undo takes it out again');
    const ag = (await ada('GET', '/agents')).body.agents;
    ok(['draft_invoice', 'send_invoice', 'send_signoff'].every((k) => ag.ops.tools.some((t) => t.key === k)) && ag.chief.tools.some((t) => t.key === 'add_to_company_hq'), 'Operations lists invoices and sign-offs; the Chief of Staff lists Company HQ');
  }

  // ----- How can Kloomie help you? (2026-11-15): a goal picks a playbook: what to find out, look at and prepare -----
  {
    const waitRun = async (id) => { let x; for (let i = 0; i < 60; i++) { x = (await ada('GET', '/agents/runs/' + id)).body; if (!['requested', 'planning', 'running'].includes(x.status)) break; await sleep(150); } return x; };
    let before = asked.length;
    r = await ada('POST', '/agents/runs', { agent: 'team', ask: 'Help me grow from $20k to $40k a month by June', mission: 'grow' });
    ok(r.status === 200 && r.body.mission === 'grow' && r.body.asPlan === true, 'a goal is kept on the assignment, and it is a plan (every change waits for a yes)');
    await waitRun(r.body.id);
    const coord = asked.slice(before).find((q) => q.sys.includes('You coordinate four specialists'));
    ok(coord && /monthly revenue/i.test(coord.msgs + coord.sys) && /average job/i.test(coord.msgs + coord.sys) && /capacity/i.test(coord.msgs + coord.sys), 'the coordinator gets the Grow playbook: revenue now and target, average job, capacity');
    ok(coord && /one short question/i.test(coord.msgs + coord.sys), 'and is told to ask first when a must-know fact is missing');
    ok(asked.slice(before).some((q) => !q.sys.includes('You coordinate') && /Grow/.test(q.msgs) && /prepare/i.test(q.msgs)), 'the specialists hear the goal and what to prepare');
    before = asked.length;
    r = await ada('POST', '/agents/runs', { agent: 'team', ask: 'I want more customers in Henderson', mission: 'auto' });
    await waitRun(r.body.id);
    const c2 = asked.slice(before).find((q) => q.sys.includes('You coordinate four specialists'));
    ok(r.body.asPlan === true && c2 && /More leads/.test(c2.msgs + c2.sys) && /Run my operations/.test(c2.msgs + c2.sys), 'a goal in their own words: the coordinator picks the closest playbook from all six');
    r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'follow up more', mission: 'world-domination' });
    ok(r.status === 200 && !r.body.mission && !r.body.asPlan, 'an unknown goal is ignored (and is no plan)');
    const ms = (await ada('GET', '/agents')).body.missions;
    ok(ms?.map((m) => m.key).join() === 'grow,leads,ops,time,money,team' && ms.every((m) => m.name && m.start.includes('Help me')), 'the six goals and their starting sentences come with the agents');
    await waitRun(r.body.id);
  }

  // ----- Templates (2026-11-16): the team's own wording to start from, and new ones saved -----
  {
    await ada('PATCH', '/agents/chief', { level: 'execute' });
    await ada('POST', '/msg-templates', { kind: 'email', name: 'Quote follow-up', when: 'A quote with no answer', subject: 'Your quote for {record}', body: 'Hi {customer}, checking in on {record}.' });
    const before = asked.length;
    r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'template test please' });
    let x;
    for (let i = 0; i < 60; i++) { x = (await ada('GET', '/agents/runs/' + r.body.id)).body; if (!['requested', 'planning', 'running'].includes(x.status)) break; await sleep(150); }
    const steps = x.parts.flatMap((p) => p.steps);
    ok(steps.find((s2) => s2.tool === 'find_templates')?.status === 'done' && asked.slice(before).some((q) => q.msgs.includes('Hi {customer}, checking in on {record}.')), 'an agent reads the team’s templates, wording and {words} included');
    ok(asked.slice(before).some((q) => /The team keeps templates/.test(q.sys)), 'and every agent is told to start from a template that fits');
    const sv = steps.find((s2) => s2.tool === 'save_template');
    let tl = (await ada('GET', '/msg-templates')).body;
    ok(sv?.status === 'done' && tl.some((t2) => t2.kind === 'reply' && t2.name === 'Thanks for the review' && t2.body.includes('{customer}')), 'it can save a new template for the team');
    await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'undo', id: sv.id });
    tl = (await ada('GET', '/msg-templates')).body;
    ok(!tl.some((t2) => t2.name === 'Thanks for the review'), 'and undo removes it');
    const ag = (await ada('GET', '/agents')).body.agents;
    ok(['chief', 'sales', 'ops', 'marketing'].every((k) => ag[k].tools.some((t2) => t2.key === 'find_templates')), 'all four specialists have the templates');
  }

  // ----- SOPs (Command Center part 5, 2026-11-20): agents read the team's saved campaigns as their standard way -----
  {
    const sc = (await ada('POST', '/campaigns', { name: 'Blind install', brief: 'How we install blinds.' })).body;
    const sg = (await ada('POST', '/goals', { campaignId: sc.id, title: 'Install day' })).body;
    await ada('POST', '/tasks', { goalId: sg.id, text: 'Level the brackets', description: 'Laser level, then pencil marks.' });
    await ada('POST', '/templates', { campaignId: sc.id, name: 'Blind install', tz: 'America/Los_Angeles' });
    const before = asked.length;
    r = await ada('POST', '/agents/runs', { agent: 'ops', ask: 'sop test please' });
    let x;
    for (let i = 0; i < 60; i++) { x = (await ada('GET', '/agents/runs/' + r.body.id)).body; if (!['requested', 'planning', 'running'].includes(x.status)) break; await sleep(150); }
    const steps = x.parts.flatMap((p) => p.steps).filter((s2) => s2.tool === 'read_sops');
    ok(steps.length === 2 && steps.every((s2) => s2.status === 'done'), 'an agent reads the team’s SOPs: ' + steps.map((s2) => s2.status));
    ok(asked.slice(before).some((q) => q.msgs.includes('Laser level, then pencil marks.') && q.msgs.includes('Install day')), 'one in full, its phases and how-to included');
    const ag = (await ada('GET', '/agents')).body.agents;
    ok(['chief', 'sales', 'ops', 'marketing'].every((k) => ag[k].tools.some((t2) => t2.key === 'read_sops')), 'all four specialists can read SOPs');
  }

  // ----- Stop, delete, switch off -----
  r = await ada('POST', `/agents/runs/${done1.id}/delete`);
  ok(r.status === 200 && (await ada('GET', '/agents/runs/' + done1.id)).status === 404, 'an assignment can be deleted');
  await ada('PATCH', '/workspace', { tools: { agents: false } });
  ok((await ada('GET', '/agents')).status === 403, 'switched off for the team: no agents');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
ai.close();
if (fails) console.log(srv.log.split('\n').slice(-25).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
