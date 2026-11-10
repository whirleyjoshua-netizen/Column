// The behavior engine's scenarios: two very different companies, and what each kind of AI work hears about them.
// A family blinds company that leads with relationships, and a commercial cleaning company that leads with
// efficiency, should brief the same features differently; a value tagged for the team shouldn't reach a customer
// email; what a piece of work needs but the profile lacks is named; suggestions never reach the AI. Then the real
// features, through the server, each ask for their own kind of work.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { hqModule } from '../server/hq.js';
const S = (await import('node:path')).resolve(process.argv[2]);
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// ---------- part 1: what each kind of work hears ----------
const db = { hq: {} };
let n = 0;
const M = hqModule({ db, save() {}, broadcast() {}, rid: () => 'e' + ++n, cleanText: (s, max) => String(s ?? '').trim().slice(0, max), readJson() {}, send() {}, isAdmin: () => true, aiAsk() {}, aiRun() {}, itemFiles() {}, replyJson() {} });
const put = (wsId, x, status = 'approved') => { const id = 'e' + ++n; db.hq[id] = { id, wsId, status, createdAt: n, source: { type: 'owner' }, pillar: null, title: '', text: '', ...x }; return id; };
const family = { id: 'fam', name: 'Rivera Shades' };
put('fam', { kind: 'about', pillar: 'identity', text: 'Family-owned blinds and shutters for homes in Las Vegas.' });
put('fam', { kind: 'service', pillar: 'identity', title: 'Plantation shutters' });
put('fam', { kind: 'voice', pillar: 'brand', text: 'Warm and personal. We say “your home”. First names.' });
put('fam', { kind: 'avoid', pillar: 'brand', title: 'Deal, cheap, ASAP' });
put('fam', { kind: 'never', pillar: 'brand', title: 'Install dates', text: 'Never promise a date before the order ships.' });
put('fam', { kind: 'value', pillar: 'purpose', title: 'Customer before the sale', text: 'We never pressure anyone.', do: ['Give people time to decide'], dont: ['Countdown deals'], areas: ['customers', 'sales'], priority: 1 });
put('fam', { kind: 'value', pillar: 'purpose', title: 'We fix our own mistakes', text: 'Whoever made it owns it.', areas: ['team'] });
put('fam', { kind: 'goal', pillar: 'goals', title: 'Get cash flow steady', horizon: 'quarter', target: '$40k a month', priority: 1 });
put('fam', { kind: 'goal', pillar: 'goals', title: 'Open a showroom', horizon: 'long', priority: 3 });
put('fam', { kind: 'notwanted', pillar: 'identity', title: 'Commercial jobs over 50 windows' });
put('fam', { kind: 'pricing', pillar: 'operations', title: 'Shutters', text: 'From $38 a square foot installed.' });
put('fam', { kind: 'process', pillar: 'operations', title: 'Same-day call back', text: 'Every lead hears from us the same day.' });
put('fam', { kind: 'rule', pillar: 'rules', title: 'Discounts', text: 'Over 10% off', level: 'approval' });
put('fam', { kind: 'service', pillar: 'identity', title: 'Solar screens (suggested only)' }, 'suggested');

const clean = { id: 'cln', name: 'Apex Commercial Cleaning' };
put('cln', { kind: 'about', pillar: 'identity', text: 'Nightly janitorial for offices and clinics under contract.' });
put('cln', { kind: 'voice', pillar: 'brand', text: 'Concise and professional. Bullet points. No small talk.' });
put('cln', { kind: 'value', pillar: 'purpose', title: 'Standard every time', text: 'Same checklist, every site.', areas: ['jobs'] });
put('cln', { kind: 'goal', pillar: 'goals', title: 'Margin over 30% on every contract', horizon: 'year', priority: 1 });

const P = (ws, task) => M.prompt(ws, task);
const famEmail = P(family, 'customer');
const clnEmail = P(clean, 'customer');
ok(famEmail.includes('writing to a customer') && famEmail.includes('Warm and personal') && famEmail.includes('Countdown deals') && famEmail.includes('Never promise a date'), '1 · a customer email for the family company: their warm voice, “never pushy” with what to avoid, and what never to promise');
ok(!famEmail.includes('We fix our own mistakes') && !famEmail.includes('cash flow') && !famEmail.includes('showroom'), '2 · but not the team-only value or the business goals');
ok(clnEmail.includes('Concise and professional') && !clnEmail.includes('Warm and personal') && !clnEmail.includes('Standard every time'), '3 · the cleaning company’s email gets its own concise voice, and not its jobs-only value');
const famPlan = P(family, 'plan');
ok(famPlan.includes('Get cash flow steady') && famPlan.indexOf('Get cash flow steady') < famPlan.indexOf('Open a showroom') && /cash flow steady.*Top priority/.test(famPlan), '4 · planning: the goals, this quarter’s top priority first');
ok(famPlan.includes('Commercial jobs over 50 windows') && famPlan.includes('Over 10% off') && !famPlan.includes('Deal, cheap, ASAP'), '5 · and the work they don’t want and the rules, not the word list');
const famJob = P(family, 'jobs');
ok(famJob.includes('$38 a square foot') && famJob.includes('Never promise a date') && !famJob.includes('Warm and personal'), '6 · estimates: prices and what never to promise, not the voice');
ok(P(clean, 'jobs').includes('doesn’t say yet: pricing') && P(clean, 'jobs').includes('Standard every time'), '7 · the cleaning company has no prices yet: the estimate is told to say so, not guess');
const famTeam = P(family, 'internal');
ok(famTeam.includes('We fix our own mistakes') && !famTeam.includes('Customer before the sale'), '8 · team notes get the team value, not the customer-only one');
ok(famEmail.includes('needs their OK') && famEmail.includes('Over 10% off'), '9 · a rule needing an OK: the email says it needs their OK rather than offering it');
ok(![famEmail, famPlan, famJob, famTeam, P(family, 'general')].some((x) => x.includes('Solar screens')), '10 · a suggestion nobody accepted never reaches the AI');
ok(P(clean, 'sales').includes('doesn’t say yet: ideal customer') && !P(family, 'customer').includes('doesn’t say yet'), '11 · what’s missing is named per kind of work');
ok(P(family, 'profile') === '' && P({ id: 'empty' }, 'customer') === '', '12 · the profile tools, and an empty profile, add nothing');
const big = { id: 'big', name: 'Big' };
for (let i = 0; i < 300; i++) put('big', { kind: i % 2 ? 'service' : 'policy', pillar: i % 2 ? 'identity' : 'operations', title: `Thing number ${i} with a fairly long name to fill space`, text: 'x'.repeat(40) });
const bigP = P(big, 'general');
ok(bigP.length < 7000 && (bigP.match(/Thing number/g) || []).length <= 16, `13 · a huge profile stays short: ${bigP.length} characters, at most 8 of each kind`);
ok(P(family, 'money').includes('$40k a month') && !P(family, 'money').includes('Warm and personal'), '14 · money work gets the goals and their targets');

// ---------- part 2: the real features ask for their own kind of work ----------
const DIR = S + '/dk/hqeval';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4749, B = `http://127.0.0.1:${PORT}`, AI_PORT = 4748;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    seen.push(typeof j.system === 'string' ? j.system : JSON.stringify(j.system));
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: JSON.stringify({ text: 'ok', subject: 'Hi', body: 'Hello', title: 'T', goals: [] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
try {
  const t = Date.now();
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Eval ' + t, name: 'Rae', email: `rae${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rae = call(r.body.token);
  await rae('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await rae('POST', '/hq/entries', { kind: 'voice', text: 'Warm, plain, never pushy' });
  await rae('POST', '/hq/entries', { kind: 'goal', title: 'Win 10 commercial accounts', horizon: 'quarter' });
  const task = (await rae('POST', '/tasks', { text: 'Follow up with Dana about shutters' })).body;
  const camp = (await rae('POST', '/campaigns', { name: 'Fall push', brief: 'Win commercial accounts before the holidays', start: new Date().toISOString().slice(0, 10) })).body;
  const ask = async (label, fn) => { seen.length = 0; await fn(); return seen.find((x) => x.includes('What the team has told Kloomie')) || ''; };
  let sys = await ask('email', () => rae('POST', '/ai/task', { taskId: task.id, tool: 'email' }));
  ok(sys.includes('(writing to a customer)') && sys.includes('Warm, plain') && !sys.includes('Win 10 commercial'), 'the email button writes to a customer: voice, no business goals');
  sys = await ask('research', () => rae('POST', '/ai/task', { taskId: task.id, tool: 'research' }));
  ok(sys.includes('(notes and reports for the team)'), 'research is team work');
  sys = await ask('doc', () => rae('POST', '/ai/doc', { mode: 'write', ask: 'A proposal' }));
  ok(sys.includes('(writing a document)') && sys.includes('Warm, plain'), 'Docs AI writes a document, in their voice');
  let pr;
  sys = await ask('plan', async () => { pr = await rae('POST', '/ai/plan', { campaignId: camp.id }); });
  ok(sys.includes('(planning work)') && sys.includes('Win 10 commercial'), 'a campaign plan is planning, with the goals');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
ai.close();
if (fails) console.log(srv.log.split('\n').slice(-12).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
