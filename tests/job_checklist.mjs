// A job's checklist on site (the team audit, 2026-11-28): one step at a time, so two people ticking at once can't
// undo each other; the name on a tick is whoever is signed in, never what the phone sends; who can tick and who can
// change the list. POST /api/records/:id/checklist/:fieldId { op: tick|untick|add|remove, itemId, text }.
// Tick and untick: owners and admins, whoever made the job, a person field (Assigned to), anyone on one of its
// visits. Add and remove: owners and admins, whoever made the job, a person field (not a helper on a visit).
// A whole-list save (an older app) can't rewrite who ticked a step or when. Each step changed is on the timeline.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/job_checklist';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5497, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Cool ' + t, name: 'Dana Brooks', email: `dana${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const dana = call(r.body.token);
  let st = (await dana('GET', '/state')).body;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Cool ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token);
  const luis = await join('Luis Ortega', 2), jamie = await join('Jamie Park', 3), kim = await join('Kim Lee', 4);
  st = (await dana('GET', '/state')).body;
  const idOf = (name) => st.workspace.members.find((m) => m.name === name)?.id;
  await dana('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const tz = st.workspace.tz || 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());

  const p = (await dana('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types.find((x) => x.key === 'trade_hvac');
  const cf = tp.fields.find((f) => f.type === 'checklist');
  const crewF = tp.fields.find((f) => f.type === 'person');
  ok(!!cf && !!crewF, '(setup) an HVAC job has a checklist and an Assigned to');
  r = await dana('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { [tp.primary]: 'Chen tune-up', [crewF.id]: idOf('Luis Ortega') } });
  const job = r.body;
  await dana('POST', `/records/${job.id}/visits`, { kind: 'Tune-up', date: today, start: 540, end: 660, memberIds: [idOf('Luis Ortega'), idOf('Jamie Park')] });
  const items = () => dana('GET', `/projects/${p.id}/records`).then((y) => (y.body.records || y.body).find((x) => x.id === job.id)?.values[cf.id]?.items || []);
  let list = await items();
  ok(list.length >= 5, '(setup) the job starts with the HVAC steps');
  const step = (i) => list[i].id;
  const go = (who, body) => who('POST', `/records/${job.id}/checklist/${cf.id}`, body);

  // Ticking: the name is whoever is signed in.
  r = await go(jamie, { op: 'tick', itemId: step(0), by: 'Dana Brooks', at: 1 });
  ok(r.status === 200, 'Jamie, on the visit, ticks a step');
  let it = (await items()).find((x) => x.id === step(0));
  ok(it?.done && it.by === 'Jamie Park' && it.at > t, 'it says Jamie did it, now, not the name and time the phone sent');

  // Two at once: both stay ticked.
  const [a, b] = await Promise.all([go(luis, { op: 'tick', itemId: step(1) }), go(jamie, { op: 'tick', itemId: step(2) })]);
  ok(a.status === 200 && b.status === 200, 'Luis and Jamie tick two steps at the same moment');
  list = await items();
  ok(list[1].done && list[1].by === 'Luis Ortega' && list[2].done && list[2].by === 'Jamie Park' && list[0].done, 'all three ticks are kept');

  r = await go(jamie, { op: 'untick', itemId: step(2) });
  it = (await items()).find((x) => x.id === step(2));
  ok(r.status === 200 && !it.done && !it.by && !it.at, 'unticking clears who and when');

  // A whole-list save from an older app: it can't rewrite who ticked or when, or name someone else for a new tick.
  const stale = (await items()).map((x) => ({ ...x }));
  stale[0].by = 'Someone Else'; stale[0].at = 5;
  stale[3].done = true; stale[3].by = 'Fake Name'; stale[3].at = 5;
  r = await luis('PATCH', `/records/${job.id}`, { values: { [cf.id]: { items: stale } } });
  list = await items();
  ok(list[0].by === 'Jamie Park' && list[0].at > t, 'a whole-list save keeps who ticked a step and when');
  ok(list[3].done && list[3].by !== 'Fake Name' && list[3].at !== 5, 'and a new tick in it doesn’t take the name or time it sent');

  // Who may tick, and who may change the list.
  ok((await go(kim, { op: 'tick', itemId: step(4) })).status === 403, 'Kim, not on this job, can’t tick');
  ok((await go(kim, { op: 'add', text: 'Kim’s step' })).status === 403, 'or add a step');
  ok((await go(kim, { op: 'remove', itemId: step(4) })).status === 403, 'or remove one');
  ok((await go(jamie, { op: 'add', text: 'Clear the drain line' })).status === 403, 'Jamie, helping on the visit, can tick but not add a step');
  ok((await go(jamie, { op: 'remove', itemId: step(4) })).status === 403, 'or remove one');
  r = await go(luis, { op: 'add', text: 'Clear the condensate drain line' });
  list = await items();
  ok(r.status === 200 && list.at(-1)?.text === 'Clear the condensate drain line' && !list.at(-1).done, 'Luis, assigned to the job, adds a step');
  const n = list.length, gone = step(4);
  r = await go(luis, { op: 'remove', itemId: gone });
  list = await items();
  ok(r.status === 200 && list.length === n - 1 && !list.some((x) => x.id === gone), 'and removes one');
  r = await go(dana, { op: 'add', text: 'Owner’s step' });
  ok(r.status === 200, 'an owner can change any job’s list');
  ok((await go(dana, { op: 'tick', itemId: 'nope' })).status === 404, 'a step that isn’t there: 404');
  ok((await go(dana, { op: 'zap', itemId: step(0) })).status === 400, 'an unknown change: 400');
  ok((await go(dana, { op: 'add', text: '   ' })).status === 400, 'a blank step: 400');
  ok((await dana('POST', `/records/${job.id}/checklist/${crewF.id}`, { op: 'tick', itemId: step(0) })).status === 404, 'a field that isn’t a checklist: 404');

  // The timeline names the step and who.
  const log = (await dana('GET', `/records/${job.id}/log`)).body;
  const entries = Array.isArray(log) ? log : log?.log || log?.timeline || [];
  ok(entries.some((e) => e.by === 'Jamie Park' && JSON.stringify(e).includes(list[0].text)), 'the timeline says which step Jamie ticked');
  ok(entries.some((e) => e.by === 'Luis Ortega' && JSON.stringify(e).includes('Clear the condensate drain line')), 'and which step Luis added');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  if (fails) console.log(srv.log.slice(-1500));
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
