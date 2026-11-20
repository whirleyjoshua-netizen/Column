// Team plan step 5 (the owner 2026-11-20): goals and alerts on Analytics' numbers, and asking about them.
// - A goal: a number to reach this week, month or quarter, shown with how far along it is. An alert: a number going
//   above or below a line. Owners and admins set them; members who may see the team's numbers see the team ones.
// - When a goal is reached or an alert goes off, owners and admins are told (once a period), and the Flows events
//   analytics.goal and analytics.alert fire, for automations an owner or admin made.
// - Ask your data: every agent has business_numbers, which reads Analytics as the person (what they may see).
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/kpiwatch';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5354, AI_PORT = 5355, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
// A stand-in for Claude: asked about numbers, it calls business_numbers once, then answers with what came back.
const seen = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    if (sys.includes('You coordinate')) return reply([{ type: 'text', text: JSON.stringify({ summary: 'Chief looks', parts: [{ agent: 'chief', ask: 'How much money came in this month?' }] }) }]);
    seen.push({ tools: (j.tools || []).map((t) => t.name), msgs: JSON.stringify(j.messages) });
    const results = j.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((x) => x.type === 'tool_result');
    if (!results.length) return reply([{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'tu1', name: 'business_numbers', input: { days: 30, metric: 'income' } }], 'tool_use');
    reply([{ type: 'text', text: 'Here is what came in.' }]);
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', KPI_WATCH_MS: '400', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-time-zone': 'UTC', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(150); } return false; };
const t = Date.now();
const today = new Date().toISOString().slice(0, 10);
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Kpi ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  const sam = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Kpi ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenoughsam', device: 'Mac', deviceId: 'sam' })).body.token);

  // Setting them.
  ok((await sam('POST', '/analytics/watches', { metric: 'income', kind: 'goal', value: 1000, period: 'month' })).status === 403, 'members can’t set goals');
  ok((await rico('POST', '/analytics/watches', { metric: 'nope', kind: 'goal', value: 1 })).status === 400, 'a number from Analytics');
  ok((await rico('POST', '/analytics/watches', { metric: 'income', kind: 'alert', value: 1 })).status === 400, 'an alert is above or below');
  ok((await rico('POST', '/analytics/watches', { metric: 'onTime', kind: 'goal', value: 120 })).status === 400, 'a share is at most 100%');
  ok((await rico('POST', '/analytics/watches', { metric: 'income', kind: 'goal', value: 1000, period: 'year' })).status === 400, 'a week, month or quarter');
  r = await rico('POST', '/analytics/watches', { metric: 'income', kind: 'goal', value: 1000, period: 'month' });
  const goal = r.body;
  ok(r.status === 200 && goal.value === 100000 && goal.current === 0 && goal.pct === 0 && !goal.met, 'a goal: money in $1,000 this month, none yet: ' + JSON.stringify(goal));
  const alert = (await rico('POST', '/analytics/watches', { metric: 'overdueNow', kind: 'alert', op: 'above', value: 1 })).body;
  ok(alert.period === null && !alert.met, 'an alert: overdue tasks above 1 (as of today, so no period)');

  // An automation on a goal reached: makes a task with the words.
  r = await rico('POST', '/automations', { name: 'Celebrate', trigger: { kind: 'analytics.goal' }, actions: [{ kind: 'task', text: 'Celebrate: {metric} hit {value} ({target} {period})' }] });
  ok(r.status === 200, 'an automation can start on a goal reached: ' + JSON.stringify(r.body).slice(0, 160));

  // Money comes in: halfway, then past it.
  await rico('POST', '/money', { kind: 'in', amount: 600, day: today, category: 'Sales', scope: 'business' });
  r = await rico('GET', '/analytics/watches');
  ok(r.body.find((w) => w.id === goal.id).pct === 60, 'the goal shows how far along: 60%');
  ok(!(await rico('GET', '/state')).body.notices.some((n) => /Goal reached/.test(n.title)), 'not reached yet, nobody told');
  await rico('POST', '/money', { kind: 'in', amount: 500, day: today, category: 'Sales', scope: 'business' });
  ok(await until(async () => (await rico('GET', '/state')).body.notices.some((n) => n.title === 'Goal reached: Money in' && n.go === 'analytics:business')), 'reached: the owner is told, and it opens Analytics');
  ok(!(await sam('GET', '/state')).body.notices.some((n) => /Goal reached/.test(n.title)), 'members aren’t told about the business’s money');
  ok(await until(async () => (await rico('GET', '/state')).body.tasks.some((x) => x.text === 'Celebrate: Money in hit $1,100 ($1,000 this month)')), 'the automation runs with the words filled in');
  await rico('POST', '/money', { kind: 'in', amount: 50, day: today, category: 'Sales', scope: 'business' });
  await sleep(1200);
  ok((await rico('GET', '/state')).body.notices.filter((n) => /Goal reached/.test(n.title)).length === 1 && (await rico('GET', '/state')).body.tasks.filter((x) => /^Celebrate/.test(x.text)).length === 1, 'once a period, not again with more money');

  // The alert: two overdue tasks.
  await rico('POST', '/tasks', { text: 'Late one', due: '2020-01-01' });
  await rico('POST', '/tasks', { text: 'Late two', due: '2020-01-02' });
  ok(await until(async () => (await rico('GET', '/state')).body.notices.some((n) => n.title === 'Overdue now is above 1')), 'the alert goes off: overdue above 1');

  // Members who may see the team's numbers see the team's goals and alerts, not the money ones.
  await rico('PATCH', '/workspace', { memberAccess: { teamKpis: true } });
  r = await sam('GET', '/analytics/watches');
  ok(r.status === 200 && r.body.length === 1 && r.body[0].metric === 'overdueNow', 'a member sees the team’s alert only');
  r = await rico('GET', `/analytics?from=${today}&to=${today}`);
  ok(r.body.watches.length === 2 && r.body.watches.some((w) => w.id === goal.id && w.met), 'the report carries them, for the cards');
  ok((await rico('PATCH', '/analytics/watches/' + goal.id, { value: 5000 })).body.met === false, 'a goal can be changed');
  ok((await rico('DELETE', '/analytics/watches/' + alert.id)).status === 200 && (await rico('GET', '/analytics/watches')).body.length === 1, 'and an alert removed');

  // Ask your data: an agent reads the numbers as the person.
  await rico('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  r = await rico('POST', '/agents/runs', { agent: 'chief', ask: 'How much money came in this month?' });
  ok(r.status === 200, 'asked: ' + JSON.stringify(r.body).slice(0, 120));
  let run;
  for (let i = 0; i < 80; i++) { run = (await rico('GET', '/agents/runs/' + r.body.id)).body; if (run && !['requested', 'planning', 'running'].includes(run.status)) break; await sleep(100); }
  ok(seen.some((x) => x.tools.includes('business_numbers')), 'the agent has business_numbers');
  const res = seen.map((x) => x.msgs).find((m) => m.includes('tool_result')) || '';
  ok(/\\"income\\"/.test(res) && /1150/.test(res) && /comparedWith/.test(res), 'it reads money in ($1,150) against before: ' + res.slice(0, 300));
  ok(/records/.test(res) && /dollars/.test(res), 'and the records behind it');
  ok(run?.parts?.[0]?.steps?.some((s) => s.tool === 'business_numbers' && s.kind === 'read'), 'kept as a read step');
  ok(!/TypeError|ReferenceError/.test(srv.log), 'no server errors' + (/Error/.test(srv.log) ? ': ' + srv.log.slice(-600) : ''));
} catch (e) {
  ok(false, 'crashed: ' + e.stack);
} finally {
  srv.kill();
  ai.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
