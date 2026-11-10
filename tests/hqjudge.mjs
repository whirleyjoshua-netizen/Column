// A real-model check of the behavior engine (not in run.sh: it needs a real AI key and costs a little):
//   node tests/hqjudge.mjs <workdir> [openai|anthropic]
// The key comes from ~/.config/kloomie/<provider>.key. A local Kloomie with two very different companies set up in
// Company HQ runs the real features (the email button, Docs AI, the campaign planner) on the real model; then the
// same model grades each draft against what the company told Kloomie: its voice, its values and rules, whether it
// made things up, and whether it said what it didn't know. A report goes to <workdir>/hqjudge-report.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { llms } from '../server/llm.js';
const S = path.resolve(process.argv[2] || '.');
const PROVIDER = process.argv[3] || 'openai';
const KEY = fs.readFileSync(path.join(os.homedir(), '.config/kloomie', PROVIDER + '.key'), 'utf8').trim();
const DIR = S + '/dk/hqjudge';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4737, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// ---------- the two companies ----------
const COMPANIES = {
  rivera: {
    name: 'Rivera Shades',
    entries: [
      { kind: 'about', text: 'Family-owned blinds, shades and shutters for homes in Las Vegas and Henderson. Maria Rivera measures and quotes every job herself.' },
      { kind: 'service', title: 'Plantation shutters' }, { kind: 'service', title: 'Motorized roller shades' }, { kind: 'service', title: 'Faux wood blinds' },
      { kind: 'area', text: 'Las Vegas and Henderson, Nevada' },
      { kind: 'notwanted', title: 'Commercial jobs over 50 windows' },
      { kind: 'mission', text: 'Make every home feel cared for, the way we’d treat our own family’s.' },
      { kind: 'value', title: 'Customer before the sale', text: 'Nobody is ever pressured.', do: ['Give people time to decide', 'Answer every question plainly'], dont: ['Countdown deals', 'Pushing to sign today'], areas: ['customers', 'sales'], priority: 1 },
      { kind: 'voice', text: 'Warm and personal. First names. Short, friendly sentences. We say “your home”, never “the property”. Sign off as Maria.' },
      { kind: 'avoid', title: 'Deal, cheap, ASAP, limited time' },
      { kind: 'never', title: 'Install dates', text: 'Never promise an install date before the order ships (usually 2–3 weeks).' },
      { kind: 'goal', title: 'Steady cash flow', horizon: 'quarter', target: '$40k a month in installs', priority: 1 },
      { kind: 'goal', title: 'Open a small showroom', horizon: 'long', priority: 3 },
      { kind: 'pricing', title: 'Plantation shutters', text: '$38 per square foot, installed. Free in-home measure.' },
      { kind: 'policy', title: 'Deposit', text: '50% to order, the rest on install day.' },
    ],
    rules: { discount: { level: 'approval', over: 10 } },
  },
  apex: {
    name: 'Apex Commercial Cleaning',
    entries: [
      { kind: 'about', text: 'Nightly janitorial service for offices and medical clinics in Phoenix, on monthly contracts.' },
      { kind: 'service', title: 'Nightly office cleaning' }, { kind: 'service', title: 'Clinic disinfection' },
      { kind: 'voice', text: 'Concise and professional. Bullet points where they help. No small talk, no exclamation marks. Sign off as “Apex Operations”.' },
      { kind: 'value', title: 'Standard every time', text: 'Every site gets the same checklist, every night.', do: ['Follow the site checklist', 'Log every visit'], dont: ['Skipping steps to save time'], areas: ['jobs', 'team'] },
      { kind: 'never', title: 'Start dates', text: 'Never promise a start date before a site walk-through.' },
      { kind: 'goal', title: 'Margin over 30% on every contract', horizon: 'year', priority: 1 },
      { kind: 'process', title: 'Site walk-through', text: 'Every new contract starts with a free site walk-through before pricing.' },
    ],
    rules: {},
  },
};

// What each scenario asks and what a good answer must do, for the judge.
const SCENARIOS = [
  { co: 'rivera', tool: 'email', task: 'Follow up with Dana Ruiz: she got a shutter quote last week and hasn’t replied', ask: '', must: ['warm, personal, first names, signed by Maria', 'no pressure, no countdown or “limited time” language', 'does not promise an install date', 'does not use the words deal, cheap, ASAP or limited time'] },
  { co: 'rivera', tool: 'email', task: 'Reply to Dana Ruiz', ask: 'Dana says she will sign today if we take 25% off the quote. Reply to her.', must: ['does not agree to the 25% discount', 'says it needs to be checked or approved first (discounts over 10% need the owner’s OK)', 'stays warm and pressure-free'] },
  { co: 'rivera', tool: 'email', task: 'Give Mark Chen a ballpark price', ask: 'Mark wants a rough price for 6 plantation shutters, each window 30 x 60 inches.', must: ['uses $38 per square foot (6 windows × 12.5 sq ft ≈ 75 sq ft ≈ $2,850)', 'does not invent other prices or fees beyond what the profile says', 'mentions the free in-home measure or that the final price follows a measure'] },
  { co: 'rivera', tool: 'doc', task: 'Intro page', ask: 'Write a one-page “about us” for new customers.', must: ['in the warm family voice', 'reflects the family-owned, never-pushy values', 'does not invent facts (years in business, awards, staff numbers, reviews) that aren’t in the profile'] },
  { co: 'rivera', tool: 'plan', brief: 'A spring push to book more installs over the next 6 weeks.', must: ['works toward the top priority: steady cash flow ($40k a month in installs)', 'does not target commercial jobs over 50 windows', 'does not center the plan on the showroom (a long-term, low-priority goal)', 'no pressure tactics like countdown deals'] },
  { co: 'apex', tool: 'email', task: 'Follow up with the office manager at Desert Pediatrics after a walk-through', ask: '', must: ['concise and professional, no small talk, no exclamation marks', 'signed “Apex Operations”', 'does not promise a start date before pricing is agreed (a walk-through comes before pricing)'] },
  { co: 'apex', tool: 'email', task: 'Reply to a prospect', ask: 'A new prospect asks if we can start tonight, and whether we also clean windows and carpets.', must: ['does not promise to start tonight (start dates come after a walk-through)', 'does not claim to offer window or carpet cleaning (not in the profile); says so or offers to check', 'concise, professional'] },
  { co: 'apex', tool: 'email', task: 'Give a prospect a price', ask: 'The prospect wants our monthly price for a 4,000 sq ft office cleaned five nights a week.', must: ['does not make up a price (the profile has no pricing)', 'points to the free site walk-through before pricing', 'concise, professional'] },
  { co: 'apex', tool: 'plan', brief: 'Win more clinic contracts in Q1.', must: ['keeps margin over 30% on every contract in view (no race to the bottom on price)', 'includes site walk-throughs before pricing', 'consistent with “standard every time” service'] },
  { co: 'apex', tool: 'doc', task: 'Onboarding note', ask: 'Write a short note for new night cleaners about how we work.', must: ['stresses following the same checklist every night and logging every visit', 'concise, professional, bullet points', 'does not invent policies (pay, shifts, benefits) that aren’t in the profile'] },
];

const report = [`# Company HQ, graded on a real model (${PROVIDER})`, '', `Run ${new Date().toLocaleString()}.`, ''];
let pass = 0, scored = 0;
try {
  const t = Date.now();
  const teams = {};
  for (const [k, c] of Object.entries(COMPANIES)) {
    const r = await call()('POST', '/auth', { mode: 'create', workspace: c.name + ' ' + t, name: k === 'rivera' ? 'Maria' : 'Ops', email: `${k}${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd' + k });
    const me = call(r.body.token);
    const key = await me('PUT', '/ai/keys/' + PROVIDER, { key: KEY });
    if (key.status !== 200) throw new Error('The key didn’t work: ' + JSON.stringify(key.body));
    await me('PATCH', '/ai', { provider: PROVIDER });
    for (const e of c.entries) await me('POST', '/hq/entries', e);
    if (Object.keys(c.rules).length) await me('PUT', '/rules', c.rules);
    teams[k] = me;
  }
  const model = (await teams.rivera('GET', '/ai')).body.model;
  report.push(`Model: ${model}`, '');
  console.log('model:', model);

  for (const [i, sc] of SCENARIOS.entries()) {
    const me = teams[sc.co];
    let out;
    if (sc.tool === 'email' || sc.tool === 'docTask') {
      const task = (await me('POST', '/tasks', { text: sc.task })).body;
      const r = await me('POST', '/ai/task', { taskId: task.id, tool: 'email', ask: sc.ask });
      out = r.status === 200 ? `Subject: ${r.body.subject}\n\n${r.body.body}` : 'ERROR ' + JSON.stringify(r.body);
    } else if (sc.tool === 'doc') {
      const r = await me('POST', '/ai/doc', { mode: 'write', ask: sc.ask, title: sc.task });
      out = r.status === 200 ? (r.body.text || JSON.stringify(r.body)) : 'ERROR ' + JSON.stringify(r.body);
    } else {
      const camp = (await me('POST', '/campaigns', { name: 'Push ' + i, brief: sc.brief, start: new Date().toISOString().slice(0, 10) })).body;
      const r = await me('POST', '/ai/plan', { campaignId: camp.id });
      out = r.status === 200 ? JSON.stringify(r.body, null, 1).slice(0, 6000) : 'ERROR ' + JSON.stringify(r.body);
    }
    // The grade: same model, given the company's profile and what a good answer must do.
    const profile = COMPANIES[sc.co].entries.map((e) => `- ${e.kind}: ${[e.title, e.text].filter(Boolean).join(': ')}${e.do ? ` (do: ${e.do.join('; ')})` : ''}${e.dont ? ` (never: ${e.dont.join('; ')})` : ''}`).join('\n') + (Object.keys(COMPANIES[sc.co].rules).length ? '\n- enforced rule: discounts over 10% need the owner’s OK' : '');
    const judge = await llms[PROVIDER].run({
      key: KEY, model,
      system: 'You grade whether an AI draft written for a small business follows what the business told its software. Be strict and specific. A plan may propose its own targets, numbers and steps, and a document may add ordinary wording; only count as made up something presented as an existing fact about this business (a price, fee, policy, procedure, service, date, promise or history) that the profile doesn’t support. A [gap in brackets] left for the owner to fill is fine. Reply with JSON only: {"checks":[{"must":"…","ok":true|false,"why":"one short sentence"}],"voice":1-5,"made_up":["any facts, prices, policies or promises in the draft that are not supported by the profile"],"summary":"one sentence"}',
      history: [{ role: 'user', text: `The business: ${COMPANIES[sc.co].name}\n\nWhat it told Kloomie:\n${profile}\n\nThe request: ${sc.task}${sc.ask ? ' — ' + sc.ask : ''}${sc.brief ? 'Campaign brief: ' + sc.brief : ''}\n\nWhat a good answer must do:\n${sc.must.map((m) => '- ' + m).join('\n')}\n\nThe draft:\n${out}` }],
      tools: [], web: false, exec: () => Promise.reject(new Error('No tools')),
    });
    let g;
    try { g = JSON.parse(judge.text.slice(judge.text.indexOf('{'), judge.text.lastIndexOf('}') + 1)); } catch { g = { checks: [], summary: 'The grade didn’t parse: ' + judge.text.slice(0, 200) }; }
    const ok = (g.checks || []).filter((x) => x.ok).length;
    const all = (g.checks || []).length;
    const clean = !(g.made_up || []).length;
    const good = all && ok === all && clean;
    scored++;
    if (good) pass++;
    console.log(`${good ? 'PASS' : 'MISS'} ${i + 1}. ${COMPANIES[sc.co].name} · ${sc.tool} · ${sc.task || sc.brief}: ${ok}/${all} checks, voice ${g.voice}/5${clean ? '' : ', made up: ' + g.made_up.join('; ')}`);
    report.push(`## ${i + 1}. ${COMPANIES[sc.co].name} · ${sc.tool}: ${sc.task || sc.brief}`, sc.ask || sc.brief || '', '', `**${good ? 'Pass' : 'Miss'}**: ${ok} of ${all} checks · voice ${g.voice}/5${clean ? '' : ' · made up: ' + g.made_up.join('; ')}`, '', ...(g.checks || []).map((x) => `- ${x.ok ? '✅' : '❌'} ${x.must}: ${x.why}`), '', `> ${g.summary}`, '', '<details><summary>The draft</summary>', '', '```', out.slice(0, 4000), '```', '</details>', '');
  }
} catch (e) {
  console.log('ERROR', e.message);
  report.push('Stopped: ' + e.message);
}
srv.kill();
report.splice(4, 0, `**${pass} of ${scored} scenarios fully passed.**`, '');
fs.writeFileSync(S + '/hqjudge-report.md', report.join('\n'));
console.log(`${pass} of ${scored} fully passed · report: ${S}/hqjudge-report.md`);
process.exit(0);
