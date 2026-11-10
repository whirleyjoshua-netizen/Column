// Company HQ step 5: learning from how people edit AI drafts (kept, and every few turned into suggested writing
// preferences; small typo fixes teach nothing), the three-monthly "are these still your priorities?" check, and
// the Company Playbook, a doc made from what's approved and updated in place.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/hqlearn';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4741, B = `http://127.0.0.1:${PORT}`, AI_PORT = 4740;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const asked = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    asked.push({ sys, user: JSON.stringify(j.messages) });
    let out = { text: 'ok' };
    if (sys.includes('compare AI drafts')) out = { entries: [
      { kind: 'avoid', title: 'Exclamation marks', why: 'Removed from all three drafts' },
      { kind: 'prefer', title: 'Talk soon, Jo', text: 'How every email is signed off', why: 'Added to every email' },
      { kind: 'rule', title: 'Not a writing preference', level: 'never' },
    ], seen: 'They make drafts shorter and calmer.' };
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}`, HQ_REVIEW_DAYS: String(1.5 / 86400) }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Calm ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  const sam = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Calm ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  await jo('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });

  // The Playbook needs something to be made from.
  ok((await jo('POST', '/hq/playbook')).status === 400, 'an empty profile has no Playbook yet');

  // Learning from edits.
  const draft = 'Hi Dana!! Thanks so much for your time today!!! We would absolutely love to get your shutters installed ASAP! Let me know!!';
  r = await sam('POST', '/hq/learn', { kind: 'email', draft, final: draft.replace('today!!!', 'today!!') });
  ok(r.status === 200 && r.body.kept === false, 'a tiny fix (a typo) teaches nothing');
  for (const [i, final] of ['Hi Dana, thanks for your time today. I’ve sent the shutter quote over. Talk soon, Jo', 'Hi Ben, good to meet you. The blinds quote is attached; no rush. Talk soon, Jo'].entries()) {
    r = await (i ? jo : sam)('POST', '/hq/learn', { kind: 'email', draft, final });
    ok(r.body.kept === true, `an edited draft is kept (${i + 1})`);
  }
  await sleep(300);
  ok(!asked.some((x) => x.sys.includes('compare AI drafts')), 'two isn’t enough to look for a pattern');
  ok((await jo('GET', '/hq')).body.learning.edits === 2 && (await sam('GET', '/hq')).body.learning === null, 'Jo sees two edits waiting (members don’t see the count)');
  await sam('POST', '/hq/learn', { kind: 'script', draft: 'Hey there!!! Got a minute?! This will be quick!!!', final: 'Hi, it’s Sam from Calm. Is now a good time for two minutes?' });
  for (let i = 0; i < 40 && !(await jo('GET', '/hq')).body.entries.some((x) => x.source?.type === 'learned'); i++) await sleep(150);
  const look = asked.find((x) => x.sys.includes('compare AI drafts'));
  ok(look && look.user.includes('Talk soon, Jo') && look.user.includes('Got a minute'), 'the third edit: Kloomie compares all three drafts with what was used');
  r = await jo('GET', '/hq');
  const learned = r.body.entries.filter((x) => x.source?.type === 'learned');
  ok(learned.length === 2 && learned.every((x) => x.status === 'suggested') && learned.some((x) => x.kind === 'avoid' && x.title === 'Exclamation marks'), 'it suggests writing preferences, not rules, for an owner to accept: ' + learned.map((x) => x.title).join(', '));
  ok(/Removed from all three/.test(learned.find((x) => x.kind === 'avoid').source.why) && r.body.learning.edits === 0, 'each says what the edits showed, and the edits are marked looked at');

  // The three-monthly check.
  ok((await jo('GET', '/hq')).body.review === null, 'no goals, nothing to check');
  await jo('POST', '/hq/entries', { kind: 'goal', title: 'Ten commercial accounts', horizon: 'quarter', priority: 1 });
  ok((await jo('GET', '/hq')).body.review === null, 'a goal just set doesn’t need checking');
  await sleep(1700);
  r = await jo('GET', '/hq');
  ok(r.body.review?.goals === 1, 'after the period, owners are asked whether the goals still hold');
  r = await jo('POST', '/hq/review');
  ok(r.body.review === null, '“Still right” resets the clock');
  ok((await sam('POST', '/hq/review')).status === 403, 'only owners and admins answer it');

  // The Company Playbook.
  await jo('POST', '/hq/entries', { kind: 'about', text: 'Calm Shades fits blinds and shutters in homes around Tucson.' });
  await jo('POST', '/hq/entries', { kind: 'value', title: 'No pressure', text: 'People decide in their own time.', do: ['Send the quote and wait'], dont: ['Countdown deals'] });
  await jo('POST', '/hq/entries', { kind: 'voice', text: 'Calm and plain. Short sentences.' });
  await jo('POST', '/hq/entries', { kind: 'rule', title: 'Discounts', text: 'Over 10% off', level: 'approval' });
  await jo('PUT', '/rules', { deleteRecord: { level: 'never' } });
  ok((await sam('POST', '/hq/playbook')).status === 403, 'members can’t make the Playbook');
  r = await jo('POST', '/hq/playbook');
  const pb = r.body.item;
  ok(r.status === 200 && pb.title === `Calm ${t} Company Playbook` && r.body.playbook.id === pb.id, 'Jo makes the Playbook: a doc with the team’s name');
  const st = (await jo('GET', '/state')).body;
  const dir = st.workspace.dirs.find((d) => d.name === 'Company HQ');
  const doc = (await jo('GET', `/items/${pb.id}/doc`)).body;
  const text = JSON.stringify(doc.blocks);
  ok(dir && st.items.find((x) => x.id === pb.id)?.dirId === dir.id, 'kept in the Company HQ folder');
  ok(['Who we are', 'What we never compromise', 'Where we’re going', 'How we sound', 'How we decide'].every((s) => text.includes(s)), 'with the sections a new hire would read');
  ok(text.includes('Tucson') && text.includes('Never: Countdown deals') && text.includes('This quarter: Ten commercial accounts') && text.includes('Calm and plain') && text.includes('Deleting a job or record: not allowed'), 'and what’s approved, including the enforced rules');
  ok(!text.includes('Exclamation marks') && !text.includes('**'), 'but not unaccepted suggestions, and no stray markdown');
  ok(text.includes('Still to fill in'), 'and what’s still missing');
  await jo('POST', '/hq/entries', { kind: 'mission', text: 'Make homes calmer.' });
  r = await jo('POST', '/hq/playbook');
  ok(r.body.item.id === pb.id && JSON.stringify((await jo('GET', `/items/${pb.id}/doc`)).body.blocks).includes('Make homes calmer') && (await jo('GET', `/items/${pb.id}/doc`)).body.v === 1, 'making it again updates the same doc');
  ok((await jo('GET', `/items/${pb.id}/history`)).status === 200, 'and the earlier version is in its history');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
ai.close();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
