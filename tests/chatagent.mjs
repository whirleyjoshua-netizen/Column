// An agent pinned to a chat (chat plan step 4): @mention it in that feed ("@Chief of Staff …" or "@chief …") and it
// takes the job as whoever asked, on their AI key, with their agents' usual rules (what it may do on its own, what
// waits for their yes). It says it's on it in the message's thread and answers there, with a link to the assignment
// (only the asker opens it). It's told the feed reads its answer. Not pinned there, or no AI key: no run.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chatagent';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5147, AI_PORT = 5148, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
// A stand-in for Claude: every turn, a one-line answer. It remembers what it was asked.
const asked = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    asked.push(JSON.stringify(j.messages));
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'Start with the Smith install, then the Jones measure.' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
}).listen(AI_PORT);
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1', SCHEDULE_TICK_MS: '500', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Agent ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const ben = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Agent ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  const benId = (await ada('GET', '/state')).body.workspace.members.find((x) => x.name === 'Ben').id;
  await ada('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  const crew = (await ada('POST', '/channels', { name: 'crew', memberIds: [benId] })).body.channels.find((x) => x.name === 'crew');
  await ada('POST', `/channels/${crew.id}/pins`, { kind: 'agent', id: 'chief' });
  const thread = async (rootId) => (await ada('GET', '/state')).body.items.filter((i) => i.parentId === rootId).sort((a, b) => a.createdAt - b.createdAt);
  const runs = async () => (await ada('GET', '/agents')).body?.runs || [];

  // Asked in #crew, where the Chief of Staff is pinned.
  const q = (await ada('POST', '/items', { type: 'message', text: '@Chief of Staff what should the crew do first tomorrow?', channelId: crew.id })).body;
  const ack = await until(async () => (await thread(q.id)).find((i) => /on it/i.test(i.text)));
  ok(ack && ack.by === 'Chief of Staff' && ack.channelId === crew.id && !ack.memberId, 'the Chief of Staff says it’s on it, in the message’s thread');
  const answer = await until(async () => (await thread(q.id)).find((i) => i.text.includes('Smith install')));
  ok(!!answer && answer.by === 'Chief of Staff', 'and answers there');
  const run = (await runs()).find((x) => x.ask?.includes('what should the crew do first'));
  ok(!!run && run.agent === 'chief', 'it ran as an assignment for Ada, on her key');
  ok(answer && run && answer.text.includes(`[[agent:${run.id}]]`), 'the answer links to the assignment (only Ada opens it)');
  ok(run && /#crew/.test(run.ask) && /Ben/.test(run.ask), 'the agent is told the feed (and who’s in it) reads its answer');
  const ask = (await ben('POST', '/links', { links: [{ type: 'agent', id: run.id }] })).body.links['agent:' + run.id];
  ok(ask && !ask.ok, 'Ben sees the link but can’t open Ada’s assignment');

  // A reply in the thread asks again; the answer stays in the same thread.
  const n0 = (await runs()).length;
  await ada('POST', '/items', { type: 'message', text: '@chief and after that?', parentId: q.id });
  ok(await until(async () => (await runs()).length === n0 + 1), 'asking in the thread starts another assignment');
  ok(await until(async () => (await thread(q.id)).filter((i) => i.text.includes('Smith install')).length === 2), 'answered in the same thread');

  // Not pinned here, or not mentioned: nothing.
  const n1 = (await runs()).length;
  await ada('POST', '/items', { type: 'message', text: '@Sales can you look at this?', channelId: crew.id });
  await ada('POST', '/items', { type: 'message', text: '@Chief of Staff in general', channelId: null });
  await ada('POST', '/items', { type: 'message', text: 'the chief said so', channelId: crew.id });
  await sleep(1500);
  ok((await runs()).length === n1, 'an agent that isn’t pinned to the feed, or isn’t @mentioned, doesn’t start');

  // Ben has no AI key: told so, no run.
  const bq = (await ben('POST', '/items', { type: 'message', text: '@chief help me plan', channelId: crew.id })).body;
  const told = await until(async () => (await thread(bq.id)).find((i) => /AI key/i.test(i.text)));
  ok(!!told && /@Ben/.test(told.text), 'without an AI key, Ben is told in the thread how to get one');
  ok(!(await ben('GET', '/agents')).body?.runs?.length, 'and nothing runs for him');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  ai.close();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error|fail/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
