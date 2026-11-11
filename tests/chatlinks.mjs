// Linking things into chat: jobs and records, projects, visits, invoices, signature requests, contacts, agent
// assignments, meeting notes and Company HQ. The server says what each link is for the person reading it, never
// more than they could open themselves; and an agent can post to a chat feed, only after the person says yes, with
// links to what it made.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chatlinks';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4705, B = `http://127.0.0.1:${PORT}`, AI_PORT = 4704;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const text = (c) => (typeof c === 'string' ? c : (c || []).map((b) => b.text || (b.type === 'tool_result' ? b.content : '')).join(' '));
const SCRIPTS = {
  'share the plan': (n) => [[['write_doc', { title: 'Week plan', text: '# Monday\n- Henderson install' }], ['post_to_chat', { feed: 'crew', text: 'This week’s plan is ready.' }], ['post_to_chat', { feed: 'nowhere', text: 'x' }]], 'Plan written; a message for #crew waits for you.'][n],
};
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const msgs = j.messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    const key = Object.keys(SCRIPTS).find((k) => text(lastUser?.content).toLowerCase().includes(k));
    const n = msgs.length - 1 - msgs.lastIndexOf(lastUser);
    const step = key ? SCRIPTS[key](Math.floor(n / 2)) : 'Done.';
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (typeof step === 'string' || !step) return reply([{ type: 'text', text: step || 'Done.' }]);
    reply([{ type: 'text', text: 'Working.' }, ...step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${n}_${i}`, name, input }))], 'tool_use');
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
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
  await ada('PATCH', '/workspace', { tools: { projects: true } });
  const jobs = (await ada('POST', '/projects', { template: 'jobs', name: 'Installs' })).body;
  const jt = jobs.types.find((x) => x.key === 'jobs');
  const F = (k) => jt.fields.find((f) => f.key === k);
  const job = (await ada('POST', `/projects/${jobs.id}/records`, { typeId: jt.id, values: { job: 'Henderson shades', value: 2400, install_date: '2026-11-20', status: F('status').choices[1].id } })).body;
  const secret = (await ada('POST', '/projects', { template: 'blank', name: 'Ada private', private: true })).body;
  const sRec = (await ada('POST', `/projects/${secret.id}/records`, { typeId: secret.types[0].id, values: { name: 'Hush' } })).body;
  const visit = (await ada('POST', `/records/${job.id}/visits`, { date: '2026-11-20', start: 540, end: 600, kind: 'Install' })).body;
  const contact = (await ada('POST', '/contacts', { name: 'Linda Henderson', email: 'linda@h.test', company: 'Henderson Home' })).body;
  const run = (await ada('POST', '/agents/runs', { agent: 'chief', ask: 'nothing much' })).body;
  for (let i = 0; i < 50; i++) { if ((await ada('GET', '/agents/runs/' + run.id)).body.status !== 'running') break; await sleep(100); }
  const links = [['record', job.id], ['record', sRec.id], ['project', jobs.id], ['project', secret.id], ['visit', visit.id], ['contact', contact.id], ['agent', run.id], ['hq', 'profile'], ['meeting', 'nope'], ['nonsense', 'x']].map(([type, id]) => ({ type, id }));
  const A = (await ada('POST', '/links', { links })).body.links;
  const Bn = (await ben('POST', '/links', { links })).body.links;
  ok(A[`record:${job.id}`].ok && A[`record:${job.id}`].label === 'Henderson shades' && /Job · .+ · Fri, Nov 20 · \$2,400/.test(A[`record:${job.id}`].sub), 'a job link: its name, with what it is, its status, date and value: ' + A[`record:${job.id}`].sub);
  ok(Bn[`record:${job.id}`].ok, 'Ben can open it too (the project is the team’s)');
  ok(A[`record:${sRec.id}`].ok && !Bn[`record:${sRec.id}`].ok && Bn[`record:${sRec.id}`].label === 'A record' && !JSON.stringify(Bn).includes('Hush'), 'a record in Ada’s private project: Ben sees only “A record”, never its name');
  ok(A[`project:${jobs.id}`].ok && !Bn[`project:${secret.id}`].ok, 'projects too');
  ok(A[`visit:${visit.id}`].ok && /Fri, Nov 20 · 9am/.test(A[`visit:${visit.id}`].sub) && A[`visit:${visit.id}`].recordId === job.id, 'a visit: the job, day and time, and which job it opens: ' + A[`visit:${visit.id}`].sub);
  ok(A[`contact:${contact.id}`].ok && A[`contact:${contact.id}`].sub === 'Henderson Home' && !Bn[`contact:${contact.id}`].ok && !JSON.stringify(Bn).includes('Linda'), 'a contact: owners and admins see who; Ben sees “A contact”, not the name');
  ok(A[`agent:${run.id}`].ok && !Bn[`agent:${run.id}`].ok && Bn[`agent:${run.id}`].sub === 'Ada’s agents', 'an agent assignment opens for Ada only; Ben sees whose it is');
  ok(A['hq:profile'].ok && Bn['hq:profile'].ok, 'Company HQ opens for everyone');
  ok(!A['meeting:nope'].ok && !('nonsense:x' in A), 'something gone says so; an unknown kind is ignored');
  // A message with links posts fine, and links keep their text.
  r = await ada('POST', '/items', { type: 'message', text: `Can someone take this? [[record:${job.id}]] [[visit:${visit.id}]]` });
  ok(r.status === 200 && r.body.text.includes(`[[record:${job.id}]]`), 'a message can carry the new links');

  // An agent posts to chat: only with a yes, with links to what it made.
  const ws = (await ada('POST', '/channels', { name: 'crew' })).body;
  void ws;
  r = await ada('POST', '/agents/runs', { agent: 'chief', ask: 'share the plan' });
  let x;
  for (let i = 0; i < 60; i++) { x = (await ada('GET', '/agents/runs/' + r.body.id)).body; if (!['requested', 'running'].includes(x.status)) break; await sleep(100); }
  const st = x.parts[0].steps;
  const post = st.find((s) => s.tool === 'post_to_chat' && s.status === 'proposed');
  ok(post && x.status === 'awaiting', 'the message for #crew waits for Ada’s yes');
  ok(st.some((s) => s.tool === 'post_to_chat' && s.status === 'failed' && /No feed called nowhere/.test(s.error)), 'a feed that doesn’t exist goes back to the agent');
  const before = (await ada('GET', '/state')).body.items.filter((i) => i.type === 'message').length;
  ok(before === 1, 'nothing posted yet');
  r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'approve', id: post.id, args: { text: 'Plan for the week is up.' } });
  const items = (await ada('GET', '/state')).body.items.filter((i) => i.type === 'message');
  const doc = (await ada('GET', '/state')).body.items.find((i) => i.title === 'Week plan');
  const msg = items.find((i) => i.text.startsWith('Plan for the week is up.'));
  const crew = (await ada('GET', '/state')).body.workspace.channels.find((c) => c.name === 'crew');
  ok(msg && msg.channelId === crew.id && msg.text.includes(`[[doc:${doc.id}]]`) && msg.by === 'Ada’s Chief of Staff', 'approved (with Ada’s edit): posted in #crew by her Chief of Staff, with a link to the plan it wrote');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
ai.close();
if (fails) console.log(srv.log.split('\n').filter((l) => /error|fail/i.test(l)).slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
