// The workspace profile (the owner, 2026-11-19): Insurance & licenses aren't a tab on every trades board any more.
// They're kept once, in the workspace profile. New trades boards don't get the list; boards made before keep their
// records (kind, expiry and all) and their automations, moved into the profile when the server starts (a private
// board's list stays put); running the move again changes nothing; the profile can't be deleted, archived, made
// private or lose its list, on any path.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/ws_profile';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4945, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv = null;
async function start() {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
}
async function stop() {
  const gone = new Promise((r) => srv.once('exit', r));
  srv.kill('SIGTERM');
  await gone;
}
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
await start();
try {
  const team = 'Profile ' + t;
  let r = await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const joTok = r.body.token, code = r.body.workspace.inviteCode;
  let jo = call(joTok);
  r = await call()('POST', '/auth', { mode: 'join', workspace: team, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  let sam = call(r.body.token);
  const samTok = r.body.token;
  await jo('PATCH', '/workspace', { tools: { projects: true } });

  // A new trades board: its trade and companions, no Licenses & insurance.
  const fresh = (await jo('POST', '/projects', { template: 'trades', trades: ['handyman'] })).body;
  ok(fresh?.types?.length > 0 && !fresh.types.some((x) => x.key === 'licenses'), `a new handyman board has no Licenses & insurance tab (${fresh?.types?.map((x) => x.name).join(', ')})`);

  // A board from before: the list added the way old boards had it, with a record and an automation on it.
  const old = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  r = await jo('POST', `/projects/${old.id}/schema`, { op: 'addTypeFrom', key: 'licenses' });
  const oldP = r.body.project, lt = oldP.types.find((x) => x.key === 'licenses');
  ok(!!lt, '(setup) an older board with its own Licenses & insurance list');
  const F = (k) => lt.fields.find((f) => f.key === k);
  const gl = F('kind').choices.find((c) => c.label === 'General liability insurance');
  r = await jo('POST', `/projects/${old.id}/records`, { typeId: lt.id, values: { [F('name').id]: 'GL policy', [F('kind').id]: gl.id, [F('number').id]: 'GL-123', [F('expires').id]: '2027-03-01' } });
  const lic = r.body;
  ok(!!lic?.id, '(setup) a GL policy on it');
  r = await jo('POST', '/automations', { name: 'License expiring', trigger: { kind: 'record.date', projectId: old.id, typeId: lt.id, fieldId: F('expires').id, days: -30, time: '08:00' }, actions: [{ kind: 'notify', text: '{record} expires {date}', to: ['owners'] }] });
  const auto = r.body;
  ok(!!auto?.id, `(setup) the expiring automation on it (${r.status} ${JSON.stringify(r.body).slice(0, 120)})`);
  // A private board's list stays where it is.
  const priv = (await jo('POST', '/projects', { template: 'trades', trades: ['plumbing'], private: true })).body;
  const privP = (await jo('POST', `/projects/${priv.id}/schema`, { op: 'addTypeFrom', key: 'licenses' })).body.project;
  const plt = privP.types.find((x) => x.key === 'licenses');
  await jo('POST', `/projects/${priv.id}/records`, { typeId: plt.id, values: { [plt.fields.find((f) => f.key === 'name').id]: 'Jo’s own cert' } });

  // Restarted: the move runs.
  await stop();
  await start();
  jo = call(joTok); sam = call(samTok);
  const after = (await jo('GET', '/projects')).body;
  const oldNow = after.find((x) => x.id === old.id);
  ok(oldNow && !oldNow.types.some((x) => x.key === 'licenses') && oldNow.types.length === oldP.types.length - 1, 'the older board no longer has the tab, and keeps its other lists');
  ok(after.find((x) => x.id === priv.id)?.types.some((x) => x.key === 'licenses'), 'a private board’s list stays where it is');
  r = await sam('GET', '/profile');
  ok(r.status === 200 && r.body.project.template === 'profile', 'Sam (a member) opens the workspace profile');
  const pp = r.body.project, pt = pp.types.find((x) => x.key === 'licenses');
  const PF = (k) => pt.fields.find((f) => f.key === k);
  const moved = r.body.records.find((x) => x.id === lic.id);
  ok(moved && moved.typeId === pt.id && moved.values[PF('name').id] === 'GL policy' && moved.values[PF('number').id] === 'GL-123' && moved.values[PF('expires').id] === '2027-03-01', 'the GL policy moved into it, same record, its values kept');
  ok(moved && PF('kind').choices.find((c) => c.id === moved.values[PF('kind').id])?.label === 'General liability insurance', 'its kind still reads General liability insurance');
  ok(!r.body.records.some((x) => x.values[PF('name').id] === 'Jo’s own cert'), 'the private board’s record didn’t move into the team’s profile');
  const autos = (await jo('GET', '/automations')).body;
  const a2 = autos.find((x) => x.id === auto.id);
  ok(a2?.trigger.projectId === pp.id && a2.trigger.typeId === pt.id && a2.trigger.fieldId === PF('expires').id, 'the expiring automation now watches the profile’s Expires');

  // Again: nothing changes.
  await stop();
  await start();
  jo = call(joTok); sam = call(samTok);
  r = await jo('GET', '/profile');
  ok(r.body.project.id === pp.id && r.body.records.length === 1 && r.body.project.types[0].fields.length === pt.fields.length, 'started again: the same one profile, one record, no fields added twice');
  ok((await jo('GET', '/projects')).body.filter((x) => x.template === 'profile').length === 1, 'one profile per workspace');

  // It stays the team's, on every path.
  ok((await jo('DELETE', `/projects/${pp.id}`)).status === 400, 'the owner can’t delete the profile');
  ok((await jo('PATCH', `/projects/${pp.id}`, { private: true })).status === 400, 'or make it private');
  ok((await jo('PATCH', `/projects/${pp.id}`, { archived: true })).status === 400, 'or archive it');
  r = await jo('POST', `/projects/${pp.id}/schema`, { op: 'removeType', typeId: pt.id });
  ok(r.status === 400, `or remove its Insurance & licenses list (${r.status})`);
  r = await sam('POST', `/projects/${pp.id}/records`, { typeId: pt.id, values: { [PF('name').id]: 'Workers’ comp' } });
  ok(r.status === 200, 'a member adds one');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
