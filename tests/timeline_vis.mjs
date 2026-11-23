// A job's timeline follows the reader's sight (CODING-GUIDE 2): a task in a private campaign, or a call logged from
// one, isn't shown to someone outside it, whether they read the timeline, get it live, ask the AI about the job or
// read it through the public API; and Boards off for members keeps the job's routes from them too.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/timeline_vis';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5421, AI_PORT = 5420, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const prompts = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'T', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    prompts.push(b);
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: '{"answer":"ok","used":[],"read":"ok","steps":[],"lines":[],"assumptions":[]}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let sock;
try {
  const t = Date.now(), team = 'Tl ' + t;
  const adaTok = (await call()('POST', '/api/auth', { mode: 'create', workspace: team, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' })).body.token;
  const ada = call(adaTok);
  const code = (await ada('GET', '/api/state')).body.workspace.inviteCode;
  const benTok = (await call()('POST', '/api/auth', { mode: 'join', workspace: team, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token;
  const ben = call(benTok);
  const benId = (await ben('GET', '/api/state')).body.me.memberId;
  for (const w of [ada, ben]) await w('PUT', '/api/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await ada('PATCH', '/api/workspace', { tools: { projects: true } });
  const p = (await ada('POST', '/api/projects', { template: 'blank', name: 'Open board' })).body;
  const rec = (await ada('POST', `/api/projects/${p.id}/records`, { typeId: p.types[0].id, values: { [p.types[0].primary]: 'OPEN-JOB' } })).body;
  const camp = (await ada('POST', '/api/campaigns', { name: 'SECRET-CAMPAIGN', private: true })).body;
  const goal = (await ada('POST', '/api/goals', { campaignId: camp.id, title: 'Quiet', kind: 'tasks' })).body;
  await ada('POST', '/api/tasks', { text: 'SECRET-TASK', goalId: goal.id, recordId: rec.id });
  await ada('POST', '/api/tasks', { text: 'OPEN-TASK', recordId: rec.id, assigneeId: benId });
  let r;
  const list = (await ada('POST', '/api/lists', { campaignId: camp.id, name: 'Calls', fromProject: { projectId: p.id, typeId: p.types[0].id } })).body;
  r = await ada('POST', '/api/attempts', { campaignId: camp.id, listId: list.id, rowId: list.rows?.find((x) => x.recordId === rec.id)?.id, recordId: rec.id, method: 'Call', outcome: camp.outcomes[0], note: 'SECRET-CALL' });
  const adaLog = JSON.stringify((await ada('GET', `/api/records/${rec.id}/log`)).body);
  ok(adaLog.includes('SECRET-TASK') && adaLog.includes('OPEN-TASK'), 'set up: the owner’s timeline has both tasks' + (adaLog.includes('SECRET-CALL') ? ' and the call' : ' (no call logged: ' + JSON.stringify(r.body).slice(0, 120) + ')'));
  const called = adaLog.includes('SECRET-CALL');

  let benLog = JSON.stringify((await ben('GET', `/api/records/${rec.id}/log`)).body);
  ok(benLog.includes('OPEN-TASK') && !benLog.includes('SECRET-TASK') && !benLog.includes('SECRET-CAMPAIGN') && !benLog.includes('SECRET-CALL'), 'Ben’s timeline leaves out the private campaign’s task and call');

  // Live: the timeline that's sent when it changes.
  const got = [];
  sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: 'Bearer ' + benTok } });
  sock.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'record:log') got.push(JSON.stringify(m)); });
  await new Promise((r) => sock.on('open', r));
  await sleep(300);
  await ada('POST', `/api/records/${rec.id}/log`, { kind: 'note', note: 'A new note' });
  await sleep(500);
  ok(got.length && got.some((m) => m.includes('A new note')) && got.every((m) => !m.includes('SECRET-TASK')), 'live, Ben gets the new note without the private task');
  got.length = 0;
  r = await ada('POST', `/api/records/${rec.id}/log`, { kind: 'note', note: 'Another' });
  ok(JSON.stringify(r.body).includes('SECRET-TASK'), 'the owner still gets everything back');

  // The AI on the job, as Ben.
  prompts.length = 0;
  await ben('POST', '/api/ai/record', { recordId: rec.id });
  await ben('POST', '/api/ai/estimate', { recordId: rec.id });
  await ben('POST', '/api/ai/ask', { q: 'OPEN-JOB' });
  ok(prompts.length >= 2 && prompts.every((x) => !x.includes('SECRET-TASK') && !x.includes('SECRET-CALL') && !x.includes('SECRET-CAMPAIGN')) && prompts.some((x) => x.includes('OPEN-TASK')), `the AI on the job doesn’t read the private task (${prompts.length} asks)`);

  // The public API, with Ben's key.
  await ada('PATCH', '/api/members/' + benId, { role: 'admin' });
  const key = (await ben('POST', '/api/integrations/keys', { name: 'Ben key' })).body;
  await ada('PATCH', '/api/members/' + benId, { role: 'member' });
  if (key?.token) {
    const tl = await fetch(`${B}/api/v1/projects/${p.id}/${p.types[0].key}/records/${rec.id}/timeline`, { headers: { authorization: 'Bearer ' + key.token } });
    const body = await tl.text();
    ok(tl.status === 200 && body.includes('OPEN-TASK') && !body.includes('SECRET-TASK'), `the public API timeline does too (${tl.status})`);
  } else console.log('note: members can’t make API keys here: ' + JSON.stringify(key).slice(0, 120));

  // Boards off for members.
  await ada('PATCH', '/api/workspace', { memberAccess: { projects: false } });
  ok((await ben('GET', `/api/records/${rec.id}/log`)).status === 403, 'Boards off for members: the job’s timeline is refused');
  ok((await ben('POST', `/api/records/${rec.id}/log`, { kind: 'note', note: 'x' })).status === 403, 'and so is writing on it');
  ok((await ada('GET', `/api/records/${rec.id}/log`)).status === 200, 'owners keep it');
  ok(called, 'the logged-call case was exercised');
  ok(!/TypeError|ReferenceError/.test(srv.log), 'no server errors');
} catch (e) {
  console.log('FAIL threw: ' + e.stack + srv.log.slice(-1500));
  fails++;
}
sock?.close();
srv.kill();
ai.close();
console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(fails ? 1 : 0);
