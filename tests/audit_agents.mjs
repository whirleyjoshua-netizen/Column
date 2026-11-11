// Audit (AI agents, docs/audit/FINDINGS.md): F3, approving the same step twice at once does it once; F12, approving
// several at once never covers important steps (emails, posts), which are one at a time.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_agents';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4911, AI = 4912, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
// A stand-in model: drafts two emails and a task, then stops.
const SCRIPT = [[
  ['draft_email', { to_name: 'Dana', to_email: 'dana@x.test', subject: 'Your quote', body: 'Hi Dana, here is your quote.' }],
  ['draft_email', { to_name: 'Lee', to_email: 'lee@x.test', subject: 'Follow up', body: 'Hi Lee, following up.' }],
], 'done'];
const ai = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'T', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const n = j.messages.length - 1;
    const step = SCRIPT[Math.min(Math.floor(n / 2), 1)];
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (typeof step === 'string') return reply([{ type: 'text', text: step }]);
    reply(step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${n}_${i}`, name, input })), 'tool_use');
  });
});
await new Promise((r) => ai.listen(AI, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', MAIL_OUTBOX_DELAY_MS: '300', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const mailsTo = (to) => { const o = DIR + '/outbox'; return fs.existsSync(o) ? fs.readdirSync(o).map((f) => JSON.parse(fs.readFileSync(o + '/' + f, 'utf8'))).filter((m) => m.to === to).length : 0; };
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Ag ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r.body.token);
  await ada('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  r = await ada('POST', '/agents/runs', { agent: 'sales', ask: 'Email Dana her quote and follow up with Lee.' });
  let run = null;
  for (let i = 0; i < 80; i++) { run = (await ada('GET', '/agents/runs/' + r.body.id)).body; if (!['requested', 'planning', 'running'].includes(run.status)) break; await sleep(150); }
  const steps = run.parts.flatMap((p) => p.steps).filter((s) => s.tool === 'draft_email');
  ok(steps.length === 2 && steps.every((s) => s.status === 'proposed'), 'F3 (setup) two emails drafted, waiting for a yes');
  const [dana, lee] = steps;
  // The same step approved twice at once (a double tap, two tabs).
  await Promise.all([ada('POST', `/agents/runs/${run.id}/steps`, { do: 'approve', ids: [dana.id] }), ada('POST', `/agents/runs/${run.id}/steps`, { do: 'approve', ids: [dana.id] })]);
  await sleep(500);
  ok(mailsTo('dana@x.test') === 1, `F3 approving the same email twice at once sends it once (${mailsTo('dana@x.test')} sent)`);
  // Approve all: important steps aren't covered.
  await ada('POST', `/agents/runs/${run.id}/steps`, { do: 'approve', ids: [lee.id, dana.id] });
  await sleep(300);
  ok(mailsTo('lee@x.test') === 0, 'F12 approving several at once doesn’t send an email (those are approved one at a time)');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails && process.env.SHOWLOG) console.log(srv.log.slice(-3000));
  srv.kill();
  ai.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
