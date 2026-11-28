// Starting steps for each kind of job (the owner, 2026-11-28, from column-fe's crew test: a gutter job got the
// roofing tear-off list). A job list's checklist can have its own steps for each choice of its "Kind of job" field;
// a job starts with its kind's steps, or the list's own when its kind has none. Changing the kind swaps the steps
// only while nobody has touched them. The trades come with lists for kinds that work differently (gutters, pavers,
// tune-ups), and lists made before get them once at start, unless the team changed the steps already.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/kindsteps';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5503, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', SKIP_SETUP: '1', DATABASE_URL: '', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
};
const stop = () => new Promise((r) => { srv.once('exit', r); srv.kill('SIGTERM'); });
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
await start();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Kinds ' + t, name: 'Rico', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const tok = r.body.token;
  let rico = call(tok);
  const st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, column: true } });
  let p = (await rico('POST', '/projects', { template: 'trades', trades: ['roofing', 'garage'] })).body;
  const listOf = (key) => p.types.find((x) => x.key === 'trade_' + key);
  let tp = listOf('roofing');
  const nameF = tp.fields.find((f) => f.id === tp.primary);
  const kindF = tp.fields.find((f) => f.key === 'kind');
  let clF = tp.fields.find((f) => f.type === 'checklist');
  const choice = (label, f = kindF) => f.choices.find((c) => c.label === label).id;
  ok(clF.kinds?.field === kindF.id, `the roofing checklist's steps go by its Kind of job (${JSON.stringify(clF.kinds?.field)})`);
  ok(/gutter/i.test((clF.kinds?.lists?.[choice('Gutters')] || []).join(' ')), 'Gutters has its own steps');
  ok(!clF.kinds?.lists?.[choice('Replacement')], 'a Replacement uses the roofing list itself');
  const gF = listOf('garage').fields.find((f) => f.type === 'checklist');
  const gKind = listOf('garage').fields.find((f) => f.key === 'kind');
  ok(gF.kinds?.lists?.[choice('Tune-up', gKind)]?.length > 3, 'a garage door Tune-up has its own steps');

  const add = (values) => rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values }).then((y) => y.body);
  const texts = (rec) => (rec.values[clF.id]?.items || []).map((x) => x.text);
  const get = async (id) => (await rico('GET', `/projects/${p.id}/records`)).body.records.find((x) => x.id === id);
  const gutters = clF.kinds.lists[choice('Gutters')];

  // A new job starts with its kind's steps.
  let job = await add({ [nameF.id]: 'Kim gutters', [kindF.id]: choice('Gutters') });
  ok(JSON.stringify(texts(job)) === JSON.stringify(gutters), `a gutter job starts with the gutter steps (${texts(job)[0]})`);
  const roof = await add({ [nameF.id]: 'Dee roof', [kindF.id]: choice('Replacement') });
  ok(JSON.stringify(texts(roof)) === JSON.stringify(clF.list), 'a replacement starts with the roofing list');
  const none = await add({ [nameF.id]: 'No kind yet' });
  ok(JSON.stringify(texts(none)) === JSON.stringify(clF.list), 'a job with no kind starts with the roofing list');

  // Its Checklist (the job card's steps) follows.
  r = await rico('GET', `/records/${job.id}/steps`);
  ok(r.status === 200 && r.body.tasks.map((x) => x.text).join('|') === gutters.join('|'), `the job's Checklist has the gutter steps (${r.body?.tasks?.length})`);

  // Picking the kind later swaps the steps while nobody has touched them.
  r = await rico('PATCH', '/records/' + none.id, { values: { [kindF.id]: choice('Gutters') } });
  ok(JSON.stringify(texts(r.body)) === JSON.stringify(gutters), 'giving a job its kind later gives it that kind’s steps');
  r = await rico('GET', `/records/${none.id}/steps`);
  ok(r.body.tasks.map((x) => x.text).join('|') === gutters.join('|'), 'and its Checklist follows');
  r = await rico('PATCH', '/records/' + none.id, { values: { [kindF.id]: choice('Replacement') } });
  ok(JSON.stringify(texts(r.body)) === JSON.stringify(clF.list), 'and back to the roofing list when changed again');

  // Once a step is ticked, the kind no longer changes them.
  const first = job.values[clF.id].items[0];
  r = await rico('POST', `/records/${job.id}/checklist/${clF.id}`, { op: 'tick', itemId: first.id });
  ok(r.status === 200, 'Rico ticks the first gutter step');
  r = await rico('PATCH', '/records/' + job.id, { values: { [kindF.id]: choice('Repair') } });
  ok(JSON.stringify(texts(r.body)) === JSON.stringify(gutters) && r.body.values[clF.id].items[0].done, 'changing the kind of a job with a ticked step keeps its steps and the tick');
  // Or once a step was added.
  const j2 = await add({ [nameF.id]: 'Lou gutters', [kindF.id]: choice('Gutters') });
  await rico('POST', `/records/${j2.id}/checklist/${clF.id}`, { op: 'add', text: 'Leaf guards' });
  r = await rico('PATCH', '/records/' + j2.id, { values: { [kindF.id]: choice('Inspection') } });
  ok(texts(r.body).includes('Leaf guards'), 'nor one with a step someone added');
  // Steps sent with the job are kept.
  const j3 = await add({ [nameF.id]: 'Own steps', [kindF.id]: choice('Gutters'), [clF.id]: { items: [{ text: 'Just this', done: false }] } });
  ok(texts(j3).join('|') === 'Just this', 'a job made with its own steps keeps them');

  // The team sets a kind's steps, or clears them back to the list's own.
  const schema = (body) => rico('POST', `/projects/${p.id}/schema`, { typeId: tp.id, fieldId: clF.id, op: 'updateField', ...body });
  r = await schema({ kinds: { field: kindF.id, lists: { ...clF.kinds.lists, [choice('Inspection')]: ['Walk the roof', '', 'Drone photos', '  '], [choice('Gutters')]: [] } } });
  ok(r.status === 200, `the team sets an Inspection's steps (${r.status} ${r.body?.error || ''})`);
  p = r.body.project || p;
  tp = listOf('roofing'); clF = tp.fields.find((f) => f.type === 'checklist');
  ok(clF.kinds.lists[choice('Inspection')].join('|') === 'Walk the roof|Drone photos', 'blank lines are dropped');
  ok(!clF.kinds.lists[choice('Gutters')], 'an empty list is taken out');
  const insp = await add({ [nameF.id]: 'Look', [kindF.id]: choice('Inspection') });
  ok(texts(insp).join('|') === 'Walk the roof|Drone photos', 'a new inspection starts with them');
  const g2 = await add({ [nameF.id]: 'Gutters now', [kindF.id]: choice('Gutters') });
  ok(JSON.stringify(texts(g2)) === JSON.stringify(clF.list), 'a kind with no steps of its own uses the list’s');
  r = await schema({ kinds: { field: nameF.id, lists: {} } });
  ok(r.status === 400, `steps go by a pick-one field of the same list (${r.status} ${r.body?.error || ''})`);
  r = await schema({ kinds: { field: kindF.id, lists: { nope: ['x'] } } });
  p = r.body?.project || p; tp = listOf('roofing'); clF = tp.fields.find((f) => f.type === 'checklist');
  ok(r.status === 200 && !clF.kinds.lists.nope, 'steps for a choice that isn’t there are dropped');
  r = await schema({ kinds: null });
  p = r.body?.project || p; tp = listOf('roofing'); clF = tp.fields.find((f) => f.type === 'checklist');
  ok(r.status === 200 && !clF.kinds, 'and the team can turn steps by kind off');
  const plain = await add({ [nameF.id]: 'Plain', [kindF.id]: choice('Gutters') });
  ok(JSON.stringify(texts(plain)) === JSON.stringify(clF.list), 'then every job starts with the list’s own steps');

  // Lists made before this get the trade's lists once at start, unless the team changed the steps.
  const gl = listOf('garage');
  await stop();
  const dbf = DIR + '/db.json';
  const data = JSON.parse(fs.readFileSync(dbf, 'utf8'));
  const sp = data.projects[p.id];
  for (const x of sp.types) for (const f of x.fields) if (f.type === 'checklist') delete f.kinds;
  sp.types.find((x) => x.key === 'trade_roofing').fields.find((f) => f.type === 'checklist').list.push('Our own last step');
  fs.writeFileSync(dbf, JSON.stringify(data));
  await start();
  rico = call(tok);
  p = (await rico('GET', '/state')).body.projects.find((x) => x.id === p.id);
  const gf2 = listOf('garage').fields.find((f) => f.type === 'checklist');
  ok(gf2.kinds?.lists?.[choice('Tune-up', gKind)]?.length > 3, 'a garage door list from before gets its kinds’ steps at start');
  ok(!listOf('roofing').fields.find((f) => f.type === 'checklist').kinds, 'a list whose steps the team changed is left alone');
  ok(gl.id === listOf('garage').id, 'same list');
} catch (e) { ok(false, 'threw: ' + e.stack); console.log(srv.log.slice(-2000)); }
await stop();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
