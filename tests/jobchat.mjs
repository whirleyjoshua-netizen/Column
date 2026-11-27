// Chat and stacks together, and a chat for every job (docs/jobflows/JOBCHAT.md). A job gets its own feed when it's
// made (the board, the Jobs tab, the public API, an import), in the Jobs chat folder, linked to the job's stack (its
// Files), with the job pinned; once, however many ask at once; made on demand when the team switch is off or the job
// is older. Who's in it follows who sees the job ("members see only theirs" included); nobody adds, removes, leaves or
// deletes it by hand; a member with Chat off reaches neither the feed nor its stack. The job renamed: the feed follows;
// deleted: the feed, its items and its stack go. Done: archived, out of the app's state, still there for whoever sees
// the job; a message or Reopen brings it back. A feed's Files: its stack, made once, no wider than the feed. Campaign
// feeds and stacks are linked; a standalone team stack gets a team feed once (restarts don't make two).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobchat';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5269, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test' };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.once('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
  console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1);
};
const stop = async () => { srv.kill('SIGTERM'); await srv.exited; };
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
const t = Date.now();
await start();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Chat ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token, rico = call(ricoTok);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => (await call()('POST', '/auth', { mode: 'join', workspace: 'Chat ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token;
  const adaTok = await join('Ada Admin', 2), samTok = await join('Sam Reed', 3), miaTok = await join('Mia Cruz', 4);
  const ada = call(adaTok), sam = call(samTok), mia = call(miaTok);
  st = (await rico('GET', '/state')).body;
  const idOf = (name) => st.workspace.members.find((m) => m.name === name)?.id;
  const samId = idOf('Sam Reed'), miaId = idOf('Mia Cruz'), adaId = idOf('Ada Admin');
  await rico('PATCH', '/members/' + adaId, { role: 'admin' });
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, column: true, camps: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status' && f.type === 'select');
  const add = (C, values) => C('POST', `/projects/${p.id}/records`, { typeId: tp.id, values }).then((y) => y.body);
  const ws = async (C = rico) => (await C('GET', '/state')).body;
  const feedOf = (s2, recId) => (s2.workspace.channels || []).find((c) => c.recordId === recId);
  const jobsFolder = (s2) => (s2.workspace.chatFolders || []).find((f) => f.jobs);

  // ---- made with the job, by every path ----
  ok(st.workspace.jobChats === true, 'the team switch, Make a chat for each new job, is on by default: ' + st.workspace.jobChats);
  const jBoard = await add(rico, { job: 'Smith kitchen' });
  st = await ws();
  let fd = feedOf(st, jBoard.id);
  ok(!!fd, 'a job made on the board gets its own feed');
  ok(fd && jobsFolder(st) && fd.folderId === jobsFolder(st).id, 'in the Jobs chat folder');
  ok(fd?.name === 'smith-kitchen', 'named after the job: ' + fd?.name);
  const jStack = st.workspace.stacks.find((x) => x.recordId === jBoard.id);
  ok(jStack && fd?.stackId === jStack?.id && jStack.channelId === fd?.id, 'linked both ways to the job’s stack (its Files)');
  ok((fd?.pins || []).some((x) => x.kind === 'job' && x.id === jBoard.id), 'the job is pinned to it');
  ok(!fd?.memberIds && !fd?.campaignId, 'it carries no member list and no campaign');
  r = await rico('GET', '/jobs');
  ok((r.body?.jobs || []).find((j) => j.id === jBoard.id)?.chatId === fd?.id, 'the Jobs list carries the job’s chatId');
  r = await rico('GET', `/projects/${p.id}/records`);
  ok((r.body || []).find((x) => x.id === jBoard.id)?.chatId === fd?.id, 'and so does the record');
  const f1 = (await rico('POST', '/job-flows', { name: 'One step', list: { projectId: p.id, typeId: tp.id }, whoCreates: 'anyone', steps: [{ kind: 'custom', name: 'Finish', who: { type: 'admins' }, settings: { text: 'Finish' } }] })).body;
  const pub = await rico('POST', `/job-flows/${f1?.id}/publish`);
  const finishId = pub.body?.version?.body?.steps[0]?.id;
  const jFlow = (await rico('POST', '/jobs', { flowId: f1?.id, values: { job: 'Flow job' } })).body?.job;
  ok(!!feedOf(await ws(), jFlow?.id), 'a job started from the Jobs tab gets one');
  const key = (await rico('POST', '/integrations/keys', { name: 'Zap' })).body?.token;
  r = await call(key)('POST', `/v1/projects/${p.id}/${tp.key}/records`, { fields: { job: 'API job' } });
  const jApi = r.body?.id || r.body?.record?.id;
  ok(jApi && !!feedOf(await ws(), jApi), 'a job made through the public API gets one ' + (r.body?.error || ''));
  const jobF = tp.fields.find((f) => f.key === 'job') || tp.fields[0];
  r = await rico('POST', `/projects/${p.id}/import`, { typeId: tp.id, rows: [{ [jobF.id]: 'Imported one' }, { [jobF.id]: 'Imported two' }] });
  st = await ws();
  const imported = st.workspace.channels.filter((c) => c.recordId && /^imported-/.test(c.name));
  ok(r.status === 200 && imported.length === 2, 'each job from an import gets one: ' + imported.map((c) => c.name));
  const jNoName = await add(rico, {});
  ok(feedOf(await ws(), jNoName.id)?.name === 'job', 'a job with no name yet: “job”');
  const jSame = await add(rico, { job: 'Smith kitchen' });
  ok(feedOf(await ws(), jSame.id)?.name === 'smith-kitchen-2', 'two jobs with one name: -2');

  // ---- once ----
  await rico('PATCH', '/workspace', { jobChats: false });
  ok((await ws()).workspace.jobChats === false, 'the switch turns off');
  const jOff = await add(rico, { job: 'Made while off' });
  ok(!feedOf(await ws(), jOff.id), 'off: no feed with the job');
  r = await rico('GET', `/jobs/${jOff.id}/chat`);
  ok(r.status === 200 && r.body?.feed === null, 'GET /jobs/:id/chat says there’s none yet');
  const both = await Promise.all([rico('POST', `/jobs/${jOff.id}/chat`), ada('POST', `/jobs/${jOff.id}/chat`)]);
  st = await ws();
  ok(both.every((x) => x.status === 200) && both[0].body?.feed?.id === both[1].body?.feed?.id && st.workspace.channels.filter((c) => c.recordId === jOff.id).length === 1 && st.workspace.stacks.filter((x) => x.recordId === jOff.id).length === 1, 'two asking at once: one feed, one stack');
  await rico('PATCH', '/workspace', { jobChats: true });
  await rico('PATCH', `/records/${jBoard.id}`, { values: { [jobF.id]: 'Smith kitchen' } }); // a change, so a sweep runs
  const jOff2 = await add(rico, { job: 'Second while on' });
  await sleep(300);
  st = await ws();
  ok(!!feedOf(st, jOff2.id), 'back on: new jobs get one again');
  await rico('PATCH', '/workspace', { jobChats: false });
  const jOff3 = await add(rico, { job: 'Third while off' });
  await rico('PATCH', '/workspace', { jobChats: true });
  await rico('PATCH', `/records/${jBoard.id}`, { values: { [jobF.id]: 'Smith kitchen' } });
  await sleep(400);
  ok(!feedOf(await ws(), jOff3.id), 'a job made while it was off doesn’t get one when it’s turned back on (the safety net starts from then)');

  // ---- rename, can't be changed by hand ----
  await rico('PATCH', `/records/${jFlow.id}`, { values: { [jobF.id]: 'Renamed flow job' } });
  st = await ws();
  fd = feedOf(st, jFlow.id);
  ok(fd?.name === 'renamed-flow-job', 'the job renamed: the feed follows: ' + fd?.name);
  ok(st.workspace.stacks.find((x) => x.id === fd?.stackId)?.name === 'Renamed flow job', 'and its stack');
  ok((await rico('PATCH', `/channels/${fd?.id}`, { memberIds: [samId] })).status === 400, 'adding people by hand: 400');
  ok((await rico('POST', `/channels/${fd?.id}/leave`)).status === 400, 'leaving: 400');
  ok((await rico('DELETE', `/channels/${fd?.id}`)).status === 400, 'deleting it: 400');
  ok((await rico('DELETE', `/stacks/${fd?.stackId}`)).status === 400, 'deleting its stack: 400 (its files would fall into the team’s Stacks)');

  // ---- members see only theirs ----
  const jSam = await add(rico, { job: 'Sams job', crew: samId });
  const jMia = await add(rico, { job: 'MIAONLYJOB', crew: miaId });
  await rico('PATCH', '/workspace', { visibility: 'own' });
  st = await ws();
  const samFeed = feedOf(st, jSam.id), miaFeed = feedOf(st, jMia.id);
  await rico('POST', '/items', { type: 'message', text: 'MIAMSG in the job chat', channelId: miaFeed?.id });
  await rico('POST', '/items', { type: 'text', text: 'MIAFILE in the job files', stackId: miaFeed?.stackId });
  let ss = await ws(sam);
  ok(feedOf(ss, jSam.id)?.id === samFeed?.id, 'Sam (own team) gets his job’s feed');
  ok(!feedOf(ss, jMia.id) && !ss.workspace.stacks.some((x) => x.id === miaFeed?.stackId) && !JSON.stringify(ss).includes('MIAMSG') && !JSON.stringify(ss).includes('MIAFILE') && !JSON.stringify(ss).includes('miaonlyjob'), 'not Mia’s job’s feed, stack, message, file or name');
  ok((await sam('GET', `/jobs/${jMia.id}/chat`)).status === 404 && (await sam('POST', `/jobs/${jMia.id}/chat`)).status === 404, 'her job’s chat: 404, to read or to make');
  const miaMsg = (await ws()).items.find((x) => x.text === 'MIAMSG in the job chat');
  ok((await sam('PATCH', `/items/${miaMsg?.id}`, { text: 'x' })).status === 404, 'changing a message in it: 404');
  r = await sam('POST', '/items', { type: 'text', text: 'SAMSNEAK', stackId: miaFeed?.stackId });
  ok(!(await ws()).items.some((x) => x.text === 'SAMSNEAK' && x.stackId === miaFeed?.stackId), 'he can’t put a file in her job’s stack by its id');
  r = await sam('POST', '/items', { type: 'message', text: 'SAMSNEAK2', channelId: miaFeed?.id });
  ok(!(await ws()).items.some((x) => x.text === 'SAMSNEAK2' && x.channelId === miaFeed?.id), 'or a message in her job’s feed');
  ok((await sam('POST', `/channels/${miaFeed?.id}/pins`, { kind: 'doc', id: 'x' })).status === 404, 'or pin to it');
  const a = (await ada('GET', '/state')).body;
  ok(!!feedOf(a, jMia.id) && JSON.stringify(a).includes('MIAMSG'), 'an admin sees every job’s feed');
  // Gaining and losing the job.
  const ear = listen(samTok); await ear.ready;
  await rico('PATCH', `/records/${jMia.id}`, { values: { crew: samId } });
  ok(await until(() => ear.heard.some((x) => x.type === 'resync' || (x.type === 'record' && x.record?.id === jMia.id))), 'given her job: Sam is told');
  ss = await ws(sam);
  ok(!!feedOf(ss, jMia.id) && JSON.stringify(ss).includes('MIAMSG') && JSON.stringify(ss).includes('MIAFILE'), 'and gets its feed, messages and files');
  ear.heard.length = 0;
  await rico('PATCH', `/records/${jMia.id}`, { values: { crew: miaId } });
  ok(await until(() => ear.heard.some((x) => x.type === 'resync' || x.type === 'record:gone')), 'taken off it: told at once');
  ss = await ws(sam);
  ok(!feedOf(ss, jMia.id) && !JSON.stringify(ss).includes('MIAMSG'), 'and it’s gone from his state');
  ear.heard.length = 0;
  await rico('POST', '/items', { type: 'message', text: 'MIAMSG2 later', channelId: miaFeed?.id });
  await sleep(300);
  ok(!JSON.stringify(ear.heard).includes('MIAMSG2'), 'a new message in it never reaches him live');

  // ---- Chat off for members ----
  await rico('PATCH', '/workspace', { memberAccess: { chat: false } });
  ss = await ws(sam);
  ok(!feedOf(ss, jSam.id) && !ss.workspace.stacks.some((x) => x.id === samFeed?.stackId), 'Chat off for members: Sam gets neither his job’s feed nor its stack');
  r = await sam('GET', `/jobs/${jSam.id}/chat`);
  ok(r.status === 403, 'his job’s chat: 403 (Chat is off for members): ' + r.status);
  r = await sam('POST', '/items', { type: 'text', text: 'OFFSNEAK', stackId: samFeed?.stackId });
  ok(!(await ws()).items.some((x) => x.text === 'OFFSNEAK' && x.stackId === samFeed?.stackId), 'nor can he put a file in its stack');
  r = await sam('GET', '/jobs');
  ok((r.body?.jobs || []).some((j) => j.id === jSam.id), '(he still has the job)');
  ok(!!feedOf(await ws(ada), jSam.id), 'an admin still has it');
  await rico('PATCH', '/workspace', { memberAccess: { chat: true, column: false } });
  ss = await ws(sam);
  ok(!!feedOf(ss, jSam.id) && ss.workspace.stacks.some((x) => x.id === samFeed?.stackId), 'Stacks off but Chat on: a feed’s Files still reach him');
  await rico('PATCH', '/workspace', { memberAccess: { column: true }, visibility: 'all' });

  // ---- archived when done ----
  r = await rico('POST', `/jobs/${jFlow.id}/steps/${finishId}/done`);
  ok(await until(async () => !feedOf(await ws(), jFlow.id)), 'the run done: its feed leaves the app’s state (archived)');
  r = await rico('GET', `/jobs/${jFlow.id}/chat`);
  ok(r.status === 200 && r.body?.feed?.archived && Array.isArray(r.body?.items), 'GET /jobs/:id/chat still has it, archived, with its items');
  const last = statusF.choices[statusF.choices.length - 1];
  await rico('PATCH', `/records/${jSam.id}`, { values: { [statusF.id]: last.id } });
  ok(await until(async () => !feedOf(await ws(), jSam.id)), 'a job with no flow at its last stage: archived too');
  const samArch = (await rico('GET', `/jobs/${jSam.id}/chat`)).body?.feed;
  ok(!!samArch?.archived, '(its chat says archived)');
  await rico('POST', '/items', { type: 'message', text: 'Back again', channelId: samArch?.id });
  ok(await until(async () => !!feedOf(await ws(), jSam.id)), 'a message in it reopens it');
  await sleep(300);
  ok(!!feedOf(await ws(), jSam.id), 'and the sweep doesn’t archive it again for the same finish');
  ok((await sam('POST', `/channels/${feedOf(await ws(), jSam.id)?.id}/reopen`)).status === 403, 'Reopen is for owners and admins');
  r = await rico('POST', `/channels/${(await rico('GET', `/jobs/${jFlow.id}/chat`)).body?.feed?.id}/reopen`);
  ok(r.status === 200 && !!feedOf(await ws(), jFlow.id), 'an owner’s Reopen brings it back');

  // ---- deleted with the job ----
  const jDel = await add(rico, { job: 'To delete' });
  const delFeed = feedOf(await ws(), jDel.id);
  await rico('POST', '/items', { type: 'message', text: 'DELMSG', channelId: delFeed?.id });
  await rico('POST', '/items', { type: 'text', text: 'DELFILE', stackId: delFeed?.stackId });
  r = await rico('DELETE', `/records/${jDel.id}`);
  st = await ws();
  ok(r.status === 200 && !st.workspace.channels.some((c) => c.id === delFeed?.id) && !st.workspace.stacks.some((x) => x.id === delFeed?.stackId), 'the job deleted: its feed and stack go');
  ok(!JSON.stringify(st).includes('DELMSG') && !JSON.stringify(st).includes('DELFILE'), 'with their messages and files');
  r = await rico('GET', '/trash');
  ok(!JSON.stringify(r.body || {}).includes('DELFILE'), 'not left in Trash to restore somewhere wider');

  // ---- a feed's Files ----
  const plain = (await rico('POST', '/channels', { name: 'yard crew', memberIds: [miaId] })).body;
  const yard = plain.channels?.find((c) => c.name === 'yard-crew');
  ok(yard && !yard?.stackId, 'a plain feed starts with no stack');
  const two = await Promise.all([rico('POST', `/channels/${yard?.id}/stack`), rico('POST', `/channels/${yard?.id}/stack`)]);
  st = await ws();
  ok(two.every((x) => x.status === 200) && two[0].body?.stack?.id === two[1].body?.stack?.id && st.workspace.stacks.filter((x) => x.channelId === yard?.id).length === 1, 'its Files’ stack is made once, however many ask');
  const yst = st.workspace.stacks.find((x) => x.channelId === yard?.id);
  ok(yst?.name === 'yard-crew' && st.workspace.channels.find((c) => c.id === yard?.id)?.stackId === yst?.id, 'named after the feed and linked both ways');
  await rico('POST', '/items', { type: 'text', text: 'YARDFILE', stackId: yst?.id });
  ss = await ws(sam);
  ok(!ss.workspace.stacks.some((x) => x.id === yst?.id) && !JSON.stringify(ss).includes('YARDFILE'), 'an invite-only feed’s Files: Sam (not in it) gets neither the stack nor the file');
  ok((await sam('POST', `/stacks/${yst?.id}/request`, { days: 7 })).status === 404, 'nor a request link on it');
  ok(JSON.stringify(await ws(mia)).includes('YARDFILE'), 'Mia (in it) does');
  await rico('PATCH', `/channels/${yard?.id}`, { name: 'yard team' });
  ok((await ws()).workspace.stacks.find((x) => x.id === yst?.id)?.name === 'yard-team', 'the feed renamed: its stack follows');
  ok((await rico('POST', `/channels/${yard?.id}/stack`, { stackId: jStack?.id })).body?.stack?.id === yst?.id, 'asking again never swaps in another stack');
  r = await rico('DELETE', `/channels/${yard?.id}`);
  st = await ws();
  ok(!st.workspace.stacks.some((x) => x.id === yst?.id) && !JSON.stringify(st).includes('YARDFILE'), 'the feed deleted: its stack and files go with it');

  // ---- review round 1 (checkpoint 2): more paths and edges ----
  // An automation makes a job (a contact comes in).
  await rico('POST', '/automations', { name: 'Lead? Make a job', trigger: { kind: 'contact.created' }, actions: [{ kind: 'create', projectId: p.id, typeId: tp.id, set: [{ field: jobF.id, value: 'Auto job for {contact}' }] }] });
  await rico('POST', '/contacts', { name: 'Lena Lead', email: 'lena@x.test' });
  let autoJob = null;
  await until(async () => { const s2 = await ws(); autoJob = s2.workspace.channels.filter((c) => c.recordId && /^auto-job/.test(c.name)); return autoJob.length; }, 6000);
  st = await ws();
  const aj = autoJob?.[0];
  const ajRec = ((await rico('GET', `/projects/${p.id}/records`)).body || []).find((x) => x.id === aj?.recordId);
  ok(ajRec && ajRec.values?.[jobF.id] === 'Auto job for Lena Lead', 'the automation made the job (its record, with the name it was given): ' + JSON.stringify(ajRec?.values?.[jobF.id]));
  ok(autoJob?.length === 1 && st.workspace.stacks.filter((x) => x.recordId === aj.recordId).length === 1 && st.workspace.stacks.find((x) => x.recordId === aj.recordId)?.channelId === aj.id && (aj.pins || []).some((x) => x.kind === 'job' && x.id === aj.recordId), 'a job an automation makes gets one feed, one stack, linked, the job pinned');
  // Move my jobs here: a job from before (made while the switch was off) moved onto a flow gets its chat.
  await rico('PATCH', '/workspace', { jobChats: false });
  const p2 = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'], name: 'Old board' })).body;
  const tp2 = p2.types[0];
  const old1 = (await rico('POST', `/projects/${p2.id}/records`, { typeId: tp2.id, values: { job: 'Old board job' } })).body;
  await rico('PATCH', '/workspace', { jobChats: true });
  ok(!feedOf(await ws(), old1.id), '(an older job with no chat)');
  const f2 = (await rico('POST', '/job-flows', { name: 'Old flow', list: { projectId: p2.id, typeId: tp2.id }, steps: [{ kind: 'custom', name: 'Do it', who: { type: 'admins' }, settings: { text: 'x' } }] })).body;
  await rico('POST', `/job-flows/${f2?.id}/publish`);
  r = await rico('POST', '/jobs/move', { projectId: p2.id, typeId: tp2.id, flowId: f2?.id });
  st = await ws();
  const mf = feedOf(st, old1.id);
  ok(r.status === 200 && mf && st.workspace.stacks.find((x) => x.id === mf.stackId)?.channelId === mf.id && (mf.pins || []).some((x) => x.kind === 'job'), 'Move my jobs here: the moved job gets its feed, stack and pin ' + (r.body?.error || ''));

  // Chat off for members: plain and campaign feeds too; POST /jobs/:id/chat; stack routes by id.
  const team = (await rico('POST', '/channels', { name: 'all hands' })).body.channels.find((c) => c.name === 'all-hands');
  const teamSt = (await rico('POST', `/channels/${team.id}/stack`)).body?.stack;
  await rico('POST', '/items', { type: 'text', text: 'TEAMFILE', stackId: teamSt?.id });
  const camp2 = (await rico('POST', '/campaigns', { name: 'Fall push' })).body;
  st = await ws();
  const c2st = st.workspace.stacks.find((x) => x.campaignId === camp2.id);
  await rico('POST', '/items', { type: 'text', text: 'CAMPFILE', stackId: c2st?.id });
  await rico('PATCH', '/workspace', { jobChats: false });
  const jSeen = await add(rico, { job: 'Sam sees no chat', crew: samId });
  await rico('PATCH', '/workspace', { jobChats: true });
  ss = await ws(sam);
  ok(ss.workspace.stacks.some((x) => x.id === teamSt?.id) && ss.workspace.stacks.some((x) => x.id === c2st?.id) && JSON.stringify(ss).includes('TEAMFILE') && JSON.stringify(ss).includes('CAMPFILE'), '(control) Chat on: Sam has a team feed’s and a campaign’s Files');
  await rico('PATCH', '/workspace', { memberAccess: { chat: false } });
  ss = await ws(sam);
  ok(!ss.workspace.channels.some((c) => c.id === team.id) && !ss.workspace.stacks.some((x) => x.id === teamSt?.id) && !JSON.stringify(ss).includes('TEAMFILE'), 'Chat off: a team feed and its Files are gone for him');
  ok(!ss.workspace.stacks.some((x) => x.id === c2st?.id) && !JSON.stringify(ss).includes('CAMPFILE'), 'and a campaign’s Files');
  for (const [nm, sid] of [['the team feed’s', teamSt?.id], ['the campaign’s', c2st?.id]]) {
    await sam('POST', '/items', { type: 'text', text: 'OFFW ' + nm, stackId: sid });
    ok(!(await ws()).items.some((x) => x.text === 'OFFW ' + nm && x.stackId === sid), `he can’t put a file in ${nm} stack`);
    ok((await sam('POST', `/stacks/${sid}/request`, { days: 7 })).status === 404, `or make a request link on it`);
    ok((await sam('PATCH', `/stacks/${sid}`, { name: 'renamed by sam' })).status === 404, `or rename it`);
  }
  r = await sam('POST', `/jobs/${jSeen.id}/chat`);
  ok(r.status === 403 && !feedOf(await ws(), jSeen.id), 'POST /jobs/:id/chat for a job he sees: 403, and nothing is made');
  const as = await ws(ada);
  ok(as.workspace.stacks.some((x) => x.id === teamSt?.id) && as.workspace.stacks.some((x) => x.id === c2st?.id), 'an admin keeps both');
  await rico('PATCH', '/workspace', { memberAccess: { chat: true } });
  // A member who can't see a job can't rename or delete its stack by id (own team).
  await rico('PATCH', '/workspace', { visibility: 'own' });
  r = await sam('PATCH', `/stacks/${miaFeed?.stackId}`, { name: 'hacked' });
  const r2 = await sam('DELETE', `/stacks/${miaFeed?.stackId}`);
  st = await ws();
  const mst = st.workspace.stacks.find((x) => x.id === miaFeed?.stackId);
  ok(r.status === 404 && r2.status === 404 && mst && mst.name !== 'hacked' && st.items.some((x) => x.text === 'MIAFILE in the job files' && x.stackId === mst.id), 'Sam can’t rename or delete the stack of a job he can’t see; its files stay in it');
  await rico('PATCH', '/workspace', { visibility: 'all' });

  // Archived: out of everyone's state (the owner's too), items included; reads still follow the job.
  const jArc = await add(rico, { job: 'Archive me', crew: miaId });
  const arcFeed = feedOf(await ws(), jArc.id);
  await rico('POST', '/items', { type: 'message', text: 'ARCMSG', channelId: arcFeed?.id });
  await rico('POST', '/items', { type: 'text', text: 'ARCFILE', stackId: arcFeed?.stackId });
  await rico('PATCH', `/records/${jArc.id}`, { values: { [statusF.id]: last.id } });
  ok(await until(async () => !feedOf(await ws(), jArc.id)), '(archived at its last stage)');
  st = await ws();
  ok(!JSON.stringify(st).includes('ARCMSG') && !JSON.stringify(st).includes('ARCFILE') && !st.workspace.stacks.some((x) => x.id === arcFeed?.stackId), 'an archived feed’s messages, files and stack are out of the owner’s state too');
  r = await rico('GET', `/jobs/${jArc.id}/chat`);
  ok(JSON.stringify(r.body?.items || []).includes('ARCMSG') && JSON.stringify(r.body?.items || []).includes('ARCFILE'), 'GET /jobs/:id/chat has both');
  await rico('PATCH', '/workspace', { visibility: 'own' });
  ok((await sam('GET', `/jobs/${jArc.id}/chat`)).status === 404, 'own team: Sam (not on it) can’t read the archived chat');
  const arcMsg = r.body?.items?.find((x) => x.text === 'ARCMSG');
  ok((await sam('PATCH', `/items/${arcMsg?.id}`, { text: 'x' })).status === 404, 'or change a message in it');
  r = await mia('GET', `/jobs/${jArc.id}/chat`);
  ok(r.status === 200 && JSON.stringify(r.body?.items || []).includes('ARCMSG'), 'Mia (on it) can');
  // Ask (the server's search over docs and records): an archived chat's doc is found for whoever sees the job only.
  const NONE = /couldn’t find anything/;
  r = await sam('POST', '/ai/ask', { q: 'ARCFILE' });
  ok(NONE.test(r.body?.answer || '') && !JSON.stringify(r.body || {}).includes('ARCFILE in'), 'Ask: Sam (not on it) finds nothing of the archived chat: ' + JSON.stringify(r.body).slice(0, 120));
  r = await mia('POST', '/ai/ask', { q: 'ARCFILE' });
  ok(!NONE.test(r.body?.answer || ''), 'Mia (on it) gets past “nothing found” (a source was found): ' + JSON.stringify(r.body).slice(0, 120));
  await rico('PATCH', '/workspace', { visibility: 'all' });
  // A second finish after it was reopened archives it again; the first finish doesn't, twice.
  await rico('POST', '/items', { type: 'message', text: 'reopen it', channelId: arcFeed?.id });
  ok(await until(async () => !!feedOf(await ws(), jArc.id)), '(reopened by a message)');
  await rico('PATCH', `/records/${jArc.id}`, { values: { [statusF.id]: statusF.choices[0].id } });
  await sleep(300);
  ok(!!feedOf(await ws(), jArc.id), 'moved back from the last stage: stays open');
  await rico('PATCH', `/records/${jArc.id}`, { values: { [statusF.id]: last.id } });
  ok(await until(async () => !feedOf(await ws(), jArc.id)), 'finished again: archived again (a new finish)');

  // ---- campaigns, standalone stacks, the migration ----
  const camp = (await rico('POST', '/campaigns', { name: 'Spring push' })).body;
  st = await ws();
  const cch = st.workspace.channels.find((c) => c.campaignId === camp?.id), cst = st.workspace.stacks.find((x) => x.campaignId === camp?.id);
  ok(cch && cst && cch.stackId === cst?.id && cst.channelId === cch.id, 'a new campaign’s feed and stack are linked');
  await rico('POST', '/stacks', { name: 'Receipts' });
  st = await ws();
  const rec = st.workspace.stacks.find((x) => x.name === 'Receipts');
  const recFeed = st.workspace.channels.find((c) => c.stackId === rec?.id);
  const stacksFolder = st.workspace.chatFolders.find((f) => f.stacks);
  ok(recFeed && rec.channelId === recFeed.id && !recFeed.memberIds && stacksFolder && recFeed.folderId === stacksFolder.id, 'a stack made in Settings gets a team feed in the Stacks folder');
  // Another team, with a stack of its own.
  const o = (await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olly Other', email: `olly${t}@t.test`, password: 'longenough9', device: 'Mac', deviceId: 'd9' })).body;
  await call(o.token)('POST', '/stacks', { name: 'OTHERTEAMSTACK' });
  // Old data: unlink everything and clear the marker, as before this piece; restart twice.
  await stop();
  const db = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
  const w = Object.values(db.workspaces).find((x) => x.name === 'Chat ' + t);
  w.stacks.push({ id: 'oldstk01', name: 'Old photos' });
  w.channels.push({ id: 'oldphoto', name: 'old-photos', folderId: null }); // a feed already called that
  for (const c of w.channels) if (c.campaignId) delete c.stackId;
  for (const x of w.stacks) if (x.campaignId) delete x.channelId;
  // Links that conflict are left as they are, never overwritten: a stack already another feed's, a feed already
  // another stack's, and a link to a stack in another team.
  w.stacks.push({ id: 'confstk1', name: 'Conflicted', channelId: 'oldphoto' });
  w.channels.push({ id: 'conffeed', name: 'conf-feed', folderId: null, stackId: 'nosuchst' });
  const other = Object.values(db.workspaces).find((x) => x.id !== w.id && x.stacks?.some((y) => y.name === 'OTHERTEAMSTACK'));
  const camp2ch = w.channels.find((c) => c.campaignId === camp2?.id);
  if (other && camp2ch) camp2ch.stackId = other.stacks.find((y) => y.name === 'OTHERTEAMSTACK').id;
  delete w.chatStacks;
  fs.writeFileSync(DIR + '/db.json', JSON.stringify(db));
  await start();
  st = await ws();
  const cch2 = st.workspace.channels.find((c) => c.campaignId === camp?.id);
  ok(cch2?.stackId === cst?.id && st.workspace.stacks.find((x) => x.id === cst?.id)?.channelId === cch2?.id, 'migration: a campaign’s feed and stack are linked again');
  const oldFeeds = st.workspace.channels.filter((c) => c.stackId === 'oldstk01');
  ok(oldFeeds.length === 1 && oldFeeds[0].name === 'old-photos-2', 'a standalone stack gets one team feed (a clash gets -2): ' + oldFeeds.map((c) => c.name));
  ok(st.workspace.stacks.find((x) => x.id === 'confstk1')?.channelId === 'oldphoto' && !st.workspace.channels.some((c) => c.stackId === 'confstk1') && st.workspace.channels.find((c) => c.id === 'oldphoto')?.stackId == null, 'a stack pointing at a feed that doesn’t point back: left as it is, no new feed made for it, the feed not changed');
  ok(st.workspace.channels.find((c) => c.id === 'conffeed')?.stackId === 'nosuchst' || st.workspace.channels.find((c) => c.id === 'conffeed')?.stackId == null, 'a feed pointing at another stack: not linked to anything else');
  const c2now = st.workspace.channels.find((c) => c.campaignId === camp2?.id);
  ok(c2now && !st.workspace.stacks.some((x) => x.id === c2now.stackId && x.channelId === c2now.id && x.campaignId !== camp2.id), 'a campaign feed pointing at another team’s stack: never linked to it');
  r = await rico('GET', '/state');
  ok(!!other && !JSON.stringify(r.body).includes('OTHERTEAMSTACK'), 'and nothing of that team’s stack comes through');
  await stop();
  await start();
  st = await ws();
  ok(st.workspace.channels.filter((c) => c.stackId === 'oldstk01').length === 1 && st.workspace.channels.filter((c) => c.stackId === rec?.id).length === 1, 'a second restart makes no more');
  ok(st.workspace.channels.filter((c) => c.recordId === jBoard.id).length === 1, 'and no second feed for a job');
} catch (e) {
  console.log('FAIL threw: ' + (e.stack || e));
  fails++;
} finally {
  for (const s of sockets) try { s.close(); } catch {}
  await stop().catch(() => {});
}
if (fails) console.log(srv.log.slice(-1500));
console.log(fails ? `jobchat: ${fails} failed` : 'jobchat: all passed');
process.exit(fails ? 1 : 0);
