// Who changes or deletes a job (column-fe's crew test, 2026-11-28: an apprentice deleted a $7,400 job, and a tech
// deleted a step on a job he wasn't on): owners and admins, whoever made the job, and whoever its person fields name
// (Assigned to, Crew lead). Everyone else who sees it works it: notes on its timeline, its chat. One rule on every
// path: the app's edit and delete, a spreadsheet import that matches it, and the public API (a key acts as its member).
// Other lists (contacts, a sales pipeline) are unchanged.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/joblock';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5496, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', SKIP_SETUP: '1', DATABASE_URL: '', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok, pre = '/api') => async (m, p, body) => {
  const r = await fetch(B + pre + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  const team = 'Jobs ' + t;
  let r = await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Rico', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  const code = st.workspace.inviteCode;
  const join = async (name, n) => (await call()('POST', '/auth', { mode: 'join', workspace: team, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token;
  const ana = call(await join('Ana', 2)), sam = call(await join('Sam', 3)), lee = call(await join('Lee', 4));
  st = (await rico('GET', '/state')).body;
  const idOf = (n) => st.workspace.members.find((m) => m.name === n).id;
  const anaId = idOf('Ana'), samId = idOf('Sam'), leeId = idOf('Lee');
  await rico('PATCH', '/members/' + leeId, { role: 'admin' });
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, column: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['roofing'] })).body;
  const tp = p.types[0];
  const nameF = tp.fields.find((f) => f.id === tp.primary);
  const crewF = tp.fields.find((f) => f.type === 'person');
  ok(!!crewF, `the job list has a person field (${crewF?.name})`);
  const add = (C, values) => C('POST', `/projects/${p.id}/records`, { typeId: tp.id, values }).then((y) => y.body);
  // Rico's job, Ana on it as crew lead; Sam isn't on it.
  const job = await add(rico, { [nameF.id]: 'Dee roof', [crewF.id]: anaId });
  const job2 = await add(rico, { [nameF.id]: 'Kim gutters' });
  const no = async (what, x, who = 'Sam') => { const y = await x; ok(y.status === 403 && /assigned|made it|admins/i.test(y.body?.error || ''), `${who} can’t ${what} (${y.status} ${y.body?.error || ''})`); };

  // ---- the app ----
  await no('rename a job he isn’t on', sam('PATCH', '/records/' + job.id, { values: { [nameF.id]: 'Mine' } }));
  await no('delete a job he isn’t on', sam('DELETE', '/records/' + job.id));
  await no('delete an unassigned job someone else made', sam('DELETE', '/records/' + job2.id));
  await no('put himself on it', sam('PATCH', '/records/' + job2.id, { values: { [crewF.id]: samId } }));
  r = await sam('POST', `/records/${job.id}/log`, { kind: 'note', note: 'Saw the roof' });
  ok(r.status === 200, 'but he logs a note on it (that’s work, not editing)');

  // ---- import that matches an existing job ----
  r = await sam('POST', `/projects/${p.id}/import`, { typeId: tp.id, match: nameF.id, rows: [{ [nameF.id]: 'Dee roof', [crewF.id]: samId }] });
  ok(r.status === 200 && (r.body.updated || 0) === 0 && r.body.skipped?.length === 1, `an import of his can’t change it either (${JSON.stringify(r.body).slice(0, 160)})`);

  // ---- the public API: a key acts as its member. Lee makes one as an admin, then is made a member again ----
  r = await lee('POST', '/integrations/keys', { name: 'Lee key', write: true });
  const api = call(r.body.token, '/api/v1');
  await rico('PATCH', '/members/' + leeId, { role: 'member' });
  r = await api('GET', `/projects/${p.id}/${tp.key}/records/${job.id}`);
  if (r.status === 200) {
    await no('change it through his key once he’s a member', api('PATCH', `/projects/${p.id}/${tp.key}/records/${job.id}`, { fields: { [nameF.key]: 'API' } }), 'Lee');
    await no('delete it through the key', api('DELETE', `/projects/${p.id}/${tp.key}/records/${job.id}`), 'Lee');
  } else ok(r.status === 401 || r.status === 403 || r.status === 404, `a demoted admin’s key stops reaching the job (${r.status})`);
  await rico('PATCH', '/members/' + leeId, { role: 'admin' });

  st = (await rico('GET', '/state')).body;
  r = await rico('GET', `/projects/${p.id}/records`);
  const recs = Array.isArray(r.body) ? r.body : r.body?.records || [];
  const j1 = recs.find((x) => x.id === job.id);
  ok(j1 && j1.values[nameF.id] === 'Dee roof' && j1.values[crewF.id] === anaId, 'nothing he tried changed the job');
  ok(recs.some((x) => x.id === job2.id), 'and the other job is still there');
  r = await rico('POST', `/jobs/${job.id}/chat`);
  ok(r.status === 200 && r.body?.feed, 'the job’s chat is still there for it');

  // ---- who can ----
  r = await ana('PATCH', '/records/' + job.id, { values: { [nameF.id]: 'Dee roof, back slope' } });
  ok(r.status === 200, 'Ana (its crew lead) changes it');
  r = await lee('PATCH', '/records/' + job2.id, { values: { [crewF.id]: samId } });
  ok(r.status === 200, 'Lee (an admin) puts Sam on the other job');
  r = await sam('PATCH', '/records/' + job2.id, { values: { [nameF.id]: 'Kim gutters, front' } });
  ok(r.status === 200, 'and now Sam changes it (he’s assigned)');
  const mine = await add(sam, { [nameF.id]: 'Sam’s own' });
  r = await sam('PATCH', '/records/' + mine.id, { values: { [nameF.id]: 'Sam’s own job' } });
  ok(r.status === 200, 'Sam changes a job he made');
  r = await sam('DELETE', '/records/' + mine.id);
  ok(r.status === 200, 'and deletes it');
  r = await ana('DELETE', '/records/' + job.id);
  ok(r.status === 200, 'Ana deletes the job she leads');

  // ---- other lists are unchanged ----
  const crm = (await rico('POST', '/projects', { template: 'crm' })).body;
  const ct = crm.types[0];
  const deal = await rico('POST', `/projects/${crm.id}/records`, { typeId: ct.id, values: { [ct.primary]: 'Acme' } }).then((y) => y.body);
  r = await sam('PATCH', '/records/' + deal.id, { values: { [ct.primary]: 'Acme Co' } });
  ok(r.status === 200, 'a record in a list that isn’t jobs is still anyone’s to change');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  if (fails) console.log(srv.log.slice(-1500));
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
