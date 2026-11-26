// Phase 5 §5 (docs/jobflows/PHASE5.md): in a team set to "members see only theirs", a member sees a job only when
// it's theirs: they made it, a person field is them, they're on one of its visits, or the CURRENT step of its run
// names them or a role they have. Every path (board records, the record's own routes, the Jobs list, Overview,
// Schedule, Map, a contact's records, state (stacks, chat pins, search), agents, the export, the public API, live
// updates); owners and admins see all; other lists are unchanged. A job that stops being theirs sends `record:gone`
// to that member only and the next read 404s; one that becomes theirs sends `record`. `all` changes nothing.
// Not here because they aren't things Kloomie does: a direct GET /api/records/:id (there's no such route; a record is
// read through its board's list, its timeline, visits and run, all tested), moving a visit to another job, and
// changing who made a record.
import fs from 'node:fs';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobs_own';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5265, B = `http://127.0.0.1:${PORT}`;
// A stand-in AI (port 5268): keeps what it's sent; runs an agent's RUN:[…]:END script.
const AI_PORT = 5268, F = `http://127.0.0.1:${AI_PORT}`;
let aiSaw = [];
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const out = (x) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(x)); };
    if (req.url.startsWith('/search/geocode/v6/forward')) { const n = Number((new URL(req.url, 'http://x').searchParams.get('q').match(/\d+/) || [])[0]) || 1; return out({ features: [{ geometry: { coordinates: [-(n % 180), 33.4] } }] }); }
    if (req.url.startsWith('/v1/models')) return out({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false });
    aiSaw.push(b);
    const j = JSON.parse(b || '{}');
    const reply = (content, stop = 'end_turn') => out({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    if (JSON.stringify(j).includes('{\\"answer\\":')) return reply([{ type: 'text', text: JSON.stringify({ answer: 'Nothing.', used: [] }) }]);
    const last = [...(j.messages || [])].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    const after = (j.messages || []).slice((j.messages || []).lastIndexOf(last) + 1);
    const script = last?.content.match(/RUN:(.*):END/)?.[1];
    if (after.length || !script) return reply([{ type: 'text', text: 'Done.' }]);
    reply(JSON.parse(script).map(([name, input], i) => ({ type: 'tool_use', id: 't' + i, name, input })), 'tool_use');
  });
});
await new Promise((r) => fake.listen(AI_PORT, '127.0.0.1', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test', ANTHROPIC_BASE_URL: F, MAPBOX_API: F, MAPBOX_TOKEN: 'tok' };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
let up = false;
for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(B + '/api/health')).ok; } catch {} if (!up) await sleep(150); }
if (!up) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok, pre = '/api') => async (m, p, body) => {
  const r = await fetch(B + pre + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sockets = [];
const listen = (tok) => {
  const heard = [];
  const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: 'Bearer ' + tok } });
  s.on('message', (d) => { try { heard.push(JSON.parse(d)); } catch {} });
  sockets.push(s);
  return { heard, ready: new Promise((r) => s.once('open', r)) };
};
const OTHER = 'OTHERJOBXYZ'; // the job Sam may not see: its name, to look for anywhere
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Own ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token, rico = call(ricoTok);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => (await call()('POST', '/auth', { mode: 'join', workspace: 'Own ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token;
  const adaTok = await join('Ada Admin', 2), samTok = await join('Sam Reed', 3), miaTok = await join('Mia Cruz', 4), kimTok = await join('Kim Lee', 5);
  const ada = call(adaTok), sam = call(samTok), mia = call(miaTok), kim = call(kimTok);
  st = (await rico('GET', '/state')).body;
  const idOf = (name) => st.workspace.members.find((m) => m.name === name)?.id;
  const samId = idOf('Sam Reed'), miaId = idOf('Mia Cruz'), adaId = idOf('Ada Admin'), kimId = idOf('Kim Lee');
  await rico('PATCH', '/members/' + adaId, { role: 'admin' });
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, column: true, map: true }, memberAccess: { teamSchedule: true } });
  const crew = ((await rico('POST', '/roles', { name: 'Crew', memberIds: [samId] })).body?.roles || []).find((x) => x.name === 'Crew');
  const tz = st.workspace.tz || 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  let tp = p.types[0];
  const schema = (body) => rico('POST', `/projects/${p.id}/schema`, body);
  r = await schema({ typeId: tp.id, op: 'addField', name: 'Related', type: 'link', target: tp.id, many: true });
  tp = r.body?.project?.types.find((x) => x.id === tp.id) || tp;
  const relF = tp.fields.find((f) => f.name === 'Related');
  r = await schema({ op: 'addType', name: 'Notes' });
  const notesT = r.body?.project?.types.find((x) => x.name === 'Notes');
  const olga = (await rico('POST', '/contacts', { name: 'Olga Other', email: 'olga@x.test' })).body;
  const olgaId = olga.id ?? olga.contact?.id;

  const flow = async (name, steps) => {
    const f = (await rico('POST', '/job-flows', { name, list: { projectId: p.id, typeId: tp.id }, whoCreates: 'admins', steps })).body;
    const y = await rico('POST', `/job-flows/${f?.id}/publish`);
    ok(y.status === 200, `(setup) “${name}” published ${y.body?.error || ''}`);
    return { id: f.id, sid: (i) => y.body?.version?.body?.steps[i]?.id };
  };
  const custom = (name, who) => ({ kind: 'custom', name, who, settings: { text: name } });
  const FS = await flow('Sam does it', [custom('Sam step', { type: 'member', id: samId }), custom('After', { type: 'admins' })]);
  const FR = await flow('Crew does it', [custom('Crew step', { type: 'role', id: crew?.id }), custom('After', { type: 'admins' })]);
  const FL = await flow('Sam later', [custom('Office first', { type: 'admins' }), custom('Sam later step', { type: 'member', id: samId }), custom('Wrap up', { type: 'admins' })]);
  const start = async (f, job) => (await rico('POST', '/jobs', { flowId: f.id, values: { job } })).body?.job;
  const add = (C, values) => C('POST', `/projects/${p.id}/records`, { typeId: tp.id, values }).then((y) => y.body);

  const jMade = await add(sam, { job: 'Sam made this' });
  const jOther = await add(rico, { job: OTHER, customer: olgaId, address: '1 Other St' });
  const jPerson = await add(rico, { job: 'Assigned to Sam', crew: samId, [relF?.key || 'related']: [jOther.id] });
  if (relF) await rico('PATCH', `/records/${jPerson.id}`, { values: { [relF.id]: [jOther.id] } });
  const jVisit = await add(rico, { job: 'Sam visits' });
  await rico('POST', `/records/${jVisit.id}/visits`, { kind: 'Clean', date: today, start: 540, end: 600, memberIds: [samId] });
  const jStep = await start(FS, 'Sam’s step now');
  const jRole = await start(FR, 'Crew’s step now');
  const jLater = await start(FL, 'Sam’s step later');
  const jMia = await add(mia, { job: 'Mia made this' });
  const note = (await rico('POST', `/projects/${p.id}/records`, { typeId: notesT?.id, values: {} })).body;
  const ov = await rico('POST', `/records/${jOther.id}/visits`, { kind: 'Clean', date: today, start: 600, end: 660, memberIds: [miaId] });
  const ovId = ov.body?.id;
  const stk = (await rico('POST', `/jobs/${jOther.id}/stack`)).body?.stack;
  await rico('POST', '/items', { type: 'text', text: 'OTHERNOTE in the job stack', stackId: stk?.id });
  await rico('POST', '/channels/general/pins', { kind: 'job', id: jOther.id });
  ok(jMade?.id && jOther?.id && jPerson?.id && jVisit?.id && jStep?.id && jRole?.id && jLater?.id && jMia?.id && note?.id && stk?.id && ovId, '(setup) the jobs, a note, a visit, a stack and a pin are made');

  const mine = [jMade, jPerson, jVisit, jStep, jRole].map((x) => x?.id);
  const notMine = [jOther, jMia, jLater].map((x) => x?.id);
  await rico('PATCH', '/workspace', { visibility: 'own' });

  // Every read path.
  const recIds = async (C) => ((await C('GET', `/projects/${p.id}/records`)).body || []).map((x) => x.id);
  let ids = await recIds(sam);
  ok(mine.every((id) => ids.includes(id)), 'board records: Sam gets each job that’s his (made, person field, visit, current step, current step’s role)');
  ok(notMine.every((id) => !ids.includes(id)), 'board records: not the job that isn’t, not Mia’s, not one where his step is later');
  ok(ids.includes(note?.id), 'board records: a record in another list is unchanged');
  ids = await recIds(ada);
  ok([...mine, ...notMine].every((id) => ids.includes(id)), 'an admin gets every job');
  ok((await recIds(rico)).length === ids.length, 'the owner too');
  ok((await sam('GET', `/records/${jOther.id}/log`)).status === 404 && (await sam('GET', `/records/${jMade.id}/log`)).status === 200, 'the record’s timeline: 404 for the other job, 200 for his');
  ok((await sam('PATCH', `/records/${jOther.id}`, { values: { access: 'x' } })).status === 404, 'changing the other job: 404');
  ok((await sam('GET', `/records/${jOther.id}/visits`)).status === 404, 'its visits: 404');
  ok((await sam('GET', `/jobs/${jOther.id}/run`)).status === 404 && (await sam('GET', `/jobs/${jLater.id}/run`)).status === 404, 'its run: 404 (and the later-step job’s)');
  const jobIds = ((await sam('GET', '/jobs')).body?.jobs || []).map((j) => j.id);
  ok(mine.every((id) => jobIds.includes(id)) && notMine.every((id) => !jobIds.includes(id)), 'the Jobs list: his jobs only');
  r = await sam('GET', '/jobs/overview');
  ok(r.status === 200 && !Object.values(r.body?.lists || {}).flat().some((id) => notMine.includes(id)) && (r.body?.lists?.today || []).includes(jVisit.id), 'the Overview: counts over his jobs only');
  r = await sam('GET', '/schedule?date=' + today);
  ok(r.status === 200 && r.body.members.length === 5 && r.body.visits.some((v) => v.recordId === jVisit.id) && !r.body.visits.some((v) => v.recordId === jOther.id) && !JSON.stringify(r.body).includes(OTHER), 'the day’s schedule (team switch on): everyone’s lanes, but not the other job’s visit');
  ok(!(r.body?.waiting || []).some((w) => notMine.includes(w.recordId)), 'Jobs to schedule: not the other jobs');
  const sunday = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); })();
  r = await sam('GET', '/schedule?week=' + sunday);
  ok(r.status === 200 && !JSON.stringify(r.body).includes(jOther.id), 'the week: not the other job');
  ok(await until(async () => JSON.stringify((await rico('GET', '/map/jobs?undated=1')).body || {}).includes(jOther.id)), '(control) the owner’s Map → Jobs has the other job');
  r = await sam('GET', '/map/jobs?undated=1');
  ok(!JSON.stringify(r.body || {}).includes(jOther.id) && !JSON.stringify(r.body || {}).includes(OTHER), 'Map → Jobs: not the other job');
  await rico('PATCH', '/workspace', { memberAccess: { contacts: true } });
  r = await sam('GET', `/records/for-contact/${olgaId}`);
  ok(!JSON.stringify(r.body || {}).includes(jOther.id), 'a contact’s records: not the other job');
  r = await sam('GET', '/jobs/clients');
  ok(r.status === 200 && !(r.body?.clients || []).some((c) => c.id === olgaId), 'Clients: answers, without the other job’s client');
  await rico('PATCH', '/workspace', { memberAccess: { contacts: false } });
  st = (await sam('GET', '/state')).body;
  ok(!st.workspace.stacks.some((x) => x.id === stk?.id) && !JSON.stringify(st).includes('OTHERNOTE'), 'state: not the other job’s stack or its note (search reads state)');
  ok(!JSON.stringify(st).includes(OTHER) && !JSON.stringify(st).includes(jOther.id), 'state: the other job’s name and id are nowhere');
  const pinFor = (s2) => (s2.workspace.chatPins || []).find((x) => x.kind === 'job');
  ok(pinFor(st)?.locked === true && !('id' in pinFor(st)) && !('label' in pinFor(st)), 'its chat pin is there as a locked chip, with no id or name: ' + JSON.stringify(pinFor(st)));
  const rst = (await rico('GET', '/state')).body;
  ok(pinFor(rst)?.id === jOther.id && !pinFor(rst).locked && JSON.stringify(pinFor(rst)).includes(OTHER), '(control) the owner’s pin is the job, by name');
  const myRec = ((await sam('GET', `/projects/${p.id}/records`)).body || []).find((x) => x.id === jPerson.id);
  ok(myRec && !JSON.stringify(myRec).includes(OTHER), 'his job that links to the other: no name for it');

  // His own export (before his agent runs below, whose asks name the other job in his own words).
  await sam('POST', '/exports', { kind: 'mine' });
  let ex;
  for (let i = 0; i < 80 && !(ex && ex.status !== 'building'); i++) { ex = ((await sam('GET', '/exports')).body?.exports || []).find((e) => e.kind === 'mine'); if (!ex || ex.status === 'building') await sleep(250); }
  const res = await fetch(`${B}/api/exports/${ex?.id}/file`, { headers: { authorization: 'Bearer ' + samTok } });
  fs.writeFileSync(`${DIR}/mine.zip`, Buffer.from(await res.arrayBuffer()));
  const zipText = execFileSync('unzip', ['-Z1', `${DIR}/mine.zip`]).toString().trim().split('\n').map((n) => execFileSync('unzip', ['-p', `${DIR}/mine.zip`, n]).toString()).join('\n');
  ok(zipText.includes('Sam made this') && !zipText.includes(OTHER) && !zipText.includes(jOther.id), 'his export: his jobs, not the other (by name or id)');

  // Agents work as him.
  await sam('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  aiSaw = [];
  const run = (await sam('POST', '/agents/runs', { agent: 'ops', ask: `RUN:${JSON.stringify([['read_record', { id: jOther.id }], ['find_records', { query: OTHER }], ['read_record', { id: jPerson.id }]])}:END` })).body;
  let x;
  for (let i = 0; i < 100; i++) { x = (await sam('GET', '/agents/runs/' + run?.id)).body; if (x && !['requested', 'planning', 'running'].includes(x.status)) break; await sleep(80); }
  // Each tool's own answer, by its call id (t0 read the other job, t1 find by its name, t2 read his linked job).
  const results = {};
  for (const b of aiSaw) for (const m of JSON.parse(b).messages || []) for (const c of Array.isArray(m.content) ? m.content : []) if (c.type === 'tool_result') results[c.tool_use_id] = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
  ok(results.t0 !== undefined && !results.t0.includes(OTHER) && /not|gone|can’t|no such|isn’t|no record/i.test(results.t0), 'read_record on the other job: refused, no name: ' + String(results.t0).slice(0, 120));
  ok(results.t1 !== undefined && !results.t1.includes(OTHER) && !results.t1.includes(jOther.id), 'find_records by its name: nothing: ' + String(results.t1).slice(0, 120));
  ok(results.t2 !== undefined && results.t2.includes('Assigned to Sam') && !results.t2.includes(OTHER) && !results.t2.includes(jOther.id), 'read_record on his job that links to it: his job, the link without its name or id: ' + String(results.t2).slice(0, 160));
  // Ask (the AI's search over what he can see): his own job is found (control), the other job's address finds nothing.
  aiSaw = [];
  r = await sam('POST', '/ai/ask', { q: 'Assigned to Sam' });
  ok(r.status === 200 && aiSaw.some((x) => (x.match(/Assigned to Sam/g) || []).length >= 2), '(control) Ask about his own job: the AI is given that job: ' + r.status);
  aiSaw = [];
  r = await sam('POST', '/ai/ask', { q: 'Who is at Other St' });
  ok(r.status === 200 && !aiSaw.some((b) => b.includes(OTHER) || b.includes(jOther.id)) && !JSON.stringify(r.body).includes(OTHER), 'Ask (search) by the other job’s address: nothing about it reaches the AI or the answer: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));

  // The public API: a key runs as its maker now.
  const key = (await ada('POST', '/integrations/keys', { name: 'Ada key', write: true })).body;
  const v1 = call(key?.key || key?.token || key?.secret, '/api/v1');
  const v1Ids = async () => (((await v1('GET', `/projects/${p.id}/${tp.key}/records`)).body?.records) || []).map((y) => y.id);
  ok((await v1Ids()).includes(jOther.id), 'the API, maker an admin: every job');
  await rico('PATCH', '/members/' + adaId, { role: 'member' });
  ok(!(await v1Ids()).includes(jOther.id) && (await v1('GET', `/projects/${p.id}/${tp.key}/records/${jOther.id}`)).status === 404, 'maker made a member: the other job is gone from the list and its read 404s');
  await rico('PATCH', '/members/' + adaId, { role: 'admin' });

  // Live updates: Sam hears about his jobs, not the other.
  const S1 = listen(samTok), M1 = listen(miaTok), K1 = listen(kimTok), A1 = listen(adaTok);
  await S1.ready; await M1.ready; await K1.ready; await A1.ready;
  const clear = () => { for (const h of [S1, M1, K1, A1]) h.heard.length = 0; };
  await rico('PATCH', `/records/${jOther.id}`, { values: { access: 'Side gate' } });
  await rico('PATCH', `/records/${jMade.id}`, { values: { access: 'Front door' } });
  await sleep(500);
  const heardRec = (h, id) => h.heard.some((m) => m.type === 'record' && (m.record?.id === id || m.id === id));
  ok(heardRec(S1, jMade.id) && !heardRec(S1, jOther.id) && !JSON.stringify(S1.heard).includes(OTHER), 'live: Sam gets his job’s update and nothing about the other');

  // A job becoming his, and stopping.
  const gone = (h, id) => h.heard.some((m) => m.type === 'record:gone' && m.id === id);
  clear();
  await rico('PATCH', `/visits/${ovId}`, { memberIds: [samId] });
  ok(await until(() => heardRec(S1, jOther.id)), 'booked onto its visit: Sam gets the job');
  ok(!heardRec(K1, jOther.id), 'Kim (nothing to do with it) doesn’t');
  ok((await sam('GET', `/records/${jOther.id}/log`)).status === 200, 'and can read it');
  clear();
  await rico('PATCH', `/visits/${ovId}`, { memberIds: [miaId] });
  ok(await until(() => gone(S1, jOther.id)), 'visit given back to Mia: Sam gets record:gone');
  ok(!gone(M1, jOther.id) && !gone(A1, jOther.id) && !gone(K1, jOther.id), 'Mia (on the visit), the admin and Kim don’t');
  ok((await sam('GET', `/records/${jOther.id}/log`)).status === 404, 'and Sam’s next read 404s');
  // A visit added, then removed.
  clear();
  const kv = (await rico('POST', `/records/${jMia.id}/visits`, { kind: 'Cleaning', date: today, start: 900, end: 960, memberIds: [miaId, samId] })).body;
  ok(await until(() => heardRec(S1, jMia.id)) && !heardRec(K1, jMia.id), 'a new visit with Sam on Mia’s job: Sam gets it, Kim doesn’t');
  ok((await sam('GET', `/records/${jMia.id}/log`)).status === 200, 'and Sam can read it');
  clear();
  r = await rico('DELETE', `/visits/${kv?.id}`);
  ok(r.status === 200, '(the visit is removed) ' + r.status);
  ok(await until(() => gone(S1, jMia.id)), 'the visit removed: Sam gets record:gone');
  ok(!gone(M1, jMia.id) && !gone(A1, jMia.id), 'Mia (who made it) and the admin don’t');
  ok((await sam('GET', `/records/${jMia.id}/log`)).status === 404, 'and Sam’s next read 404s');
  clear();
  await rico('PATCH', `/records/${jPerson.id}`, { values: { crew: miaId } });
  ok(await until(() => gone(S1, jPerson.id)), 'person field changed to Mia: Sam gets record:gone');
  ok(await until(() => heardRec(M1, jPerson.id)), 'and Mia gets the job');
  S1.heard.length = 0;
  await rico('POST', `/jobs/${jLater.id}/steps/${FL.sid(0)}/done`);
  ok(await until(() => heardRec(S1, jLater.id)), 'a later step of his becomes current: Sam gets the job');
  ok((await sam('GET', `/jobs/${jLater.id}/run`)).status === 200, 'and can read its run');
  S1.heard.length = 0;
  r = await sam('POST', `/jobs/${jLater.id}/steps/${FL.sid(1)}/done`);
  ok(r.status === 200, 'Sam does his step: ' + r.status + ' ' + (r.body?.error || ''));
  ok(await until(() => gone(S1, jLater.id)), 'the run moves on: Sam gets record:gone');
  ok((await sam('GET', `/jobs/${jLater.id}/run`)).status === 404, 'and the next read 404s');
  // Reopened: his step is current again.
  S1.heard.length = 0;
  r = await rico('POST', `/jobs/${jLater.id}/steps/${FL.sid(1)}/reopen`);
  ok(r.status === 200, '(an admin reopens Sam’s step) ' + r.status + ' ' + (r.body?.error || ''));
  ok(await until(() => heardRec(S1, jLater.id)), 'his step reopened: Sam gets the job again');
  ok((await sam('GET', `/jobs/${jLater.id}/run`)).status === 200, 'and can read its run');
  // Cancelled: the run is gone, so is his step.
  S1.heard.length = 0;
  r = await rico('POST', `/jobs/${jStep.id}/flow/cancel`, { reason: 'Customer called it off' });
  ok(r.status === 200, '(the run on Sam’s step job is cancelled) ' + r.status);
  ok(await until(() => gone(S1, jStep.id)), 'run cancelled: Sam gets record:gone');
  ok(!(await recIds(sam)).includes(jStep.id), 'and it’s gone from his next read');
  S1.heard.length = 0;
  await rico('PATCH', '/roles/' + crew?.id, { memberIds: [] });
  ok(await until(() => gone(S1, jRole.id) || S1.heard.some((m) => m.type === 'resync')), 'taken out of the Crew role: Sam loses the Crew job (record:gone or a resync)');
  ok(!(await recIds(sam)).includes(jRole.id), 'and it’s gone from his next read');
  // A member leaving: their sign-in stops working; nothing of the team's jobs reaches them after.
  const jKim = await add(kim, { job: 'Kim made this' });
  ok((await recIds(kim)).includes(jKim?.id), '(Kim sees the job she made)');
  K1.heard.length = 0;
  r = await rico('DELETE', '/members/' + kimId);
  ok(r.status === 200, '(Kim is removed from the team) ' + r.status);
  ok([401, 403, 404].includes((await kim('GET', `/projects/${p.id}/records`)).status), 'Kim’s next read is refused');
  await rico('PATCH', `/records/${jKim.id}`, { values: { access: 'After Kim' } });
  await sleep(300);
  ok(!heardRec(K1, jKim.id), 'and her socket hears nothing more about it');

  // Role and setting changes resync.
  S1.heard.length = 0;
  await rico('PATCH', '/members/' + samId, { role: 'admin' });
  ok((await recIds(sam)).includes(jOther.id), 'made an admin: Sam sees every job');
  await rico('PATCH', '/members/' + samId, { role: 'member' });
  ok(await until(() => S1.heard.some((m) => m.type === 'resync' || m.type === 'state' || m.type === 'workspace')), 'made a member again: his app is told to reload');
  ok(!(await recIds(sam)).includes(jOther.id), 'and the next read is his jobs only');
  S1.heard.length = 0;
  await rico('PATCH', '/workspace', { visibility: 'all' });
  ok(await until(() => S1.heard.some((m) => m.type === 'resync')), 'switching to all: his app reloads');
  ids = await recIds(sam);
  ok([...mine, ...notMine].every((id) => ids.includes(id)), 'with all, Sam sees every job (nothing else changes)');
  // And back to own, with his app connected.
  S1.heard.length = 0;
  await rico('PATCH', '/workspace', { visibility: 'own' });
  ok(await until(() => S1.heard.some((m) => m.type === 'resync')), 'switching back to own: his app reloads');
  ids = await recIds(sam);
  ok(!ids.includes(jOther.id) && !ids.includes(jPerson.id) && ids.includes(jMade.id), 'and his next read is his jobs only again');
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e));
}
for (const s of sockets) s.close();
srv.kill();
fake.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
