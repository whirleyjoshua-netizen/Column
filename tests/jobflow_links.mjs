// Job Flows Phase 4 (docs/jobflows/PHASE4.md §1–5): Links. A stack per job whose files are seen by whoever sees the
// job and nobody else, on every path; jobs and clients on the map (a stand-in Mapbox, never stored); a Tasks step from
// a saved bundle and a Campaign step from a saved campaign, both snapshotted at publish; the job pinned to a chat;
// stock used off Inventory when the work is done (once, capped at what's there). Restarts right after the campaign is
// made and the stock is used.
//
// Shapes the tests fix (PHASE4.md §10):
//   flow body `stack: true`; a job's record carries `stackId`; POST /api/jobs/:id/stack → { stack: { id, name, recordId } }
//     (owners and admins; the same stack again if it has one). state.workspace.stacks lists it only for those who see the job.
//   GET /api/map/jobs?from&to&undated → { points: [{ kind, id, name, address, lat, lng, stage?, flow?, next?, scheduled? }], more, missing, off? }
//   tasks step settings.bundleId → the version's settings.tasks + settings.bundleFrom { id, name }
//   campaign step settings.templateId → the version's settings.template + settings.templateFrom { id, name };
//     the run view's step.campaign = { id, name, status } once made
//   chat pin { kind: 'job', id } → for those who see the job { label, icon, next }, a locked chip for others
//   work step settings { useStock: true, fromPlace } → the run view's step.stock = { used: [{ itemId, name, qty }], notes: [] };
//     Inventory moves of kind 'use' with jobId and key `${runId}:${goalId}:${cycle}`
// Search is the app's own filter over state (no search route), so state covers it. The public API has no item or
// stack endpoint (records only, which already follow the board's rules), so it can't reach a job's files.
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflow_links';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5255, M_PORT = 5254, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };

// A stand-in Mapbox: an address's longitude is its first number; "SLOW" takes 7 s, "FAIL" answers 500, "NOWHERE" finds nothing.
const geo = new Map();
const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.searchParams.get('access_token') !== 'tok') { res.writeHead(401); return res.end('{}'); }
  if (u.pathname === '/search/geocode/v6/forward') {
    const q = String(u.searchParams.get('q') || '');
    geo.set(q.toLowerCase(), (geo.get(q.toLowerCase()) || 0) + 1);
    if (/SLOW/i.test(q)) await sleep(7000);
    if (/FAIL/i.test(q)) { res.writeHead(500); return res.end('{}'); }
    const n = Number((q.match(/\d+/) || [])[0]);
    return res.end(JSON.stringify({ features: /NOWHERE/i.test(q) || !n ? [] : [{ geometry: { coordinates: [-(n % 180), 33.4] } }] }));
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => fake.listen(M_PORT, '127.0.0.1', r));
const geoCalls = () => [...geo.values()].reduce((n, v) => n + v, 0);

const base = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test', MAPBOX_API: `http://127.0.0.1:${M_PORT}`, MAPBOX_TOKEN: 'tok' };
let srv;
const start = async (extra = {}) => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...base, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return true; } catch {} await sleep(150); }
  return false;
};
const stop = async () => { await sleep(300); srv.kill(); await new Promise((r) => srv.once('exit', r)); };
if (!(await start())) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Links ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  let rico = call(ricoTok);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Links ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samTok = r.body.token;
  let sam = call(samTok);
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true, map: true } });
  st = (await rico('GET', '/state')).body;
  const samId = st.workspace.members.find((m) => m.name === 'Sam Reed').id;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Links ' + t, code: st.workspace.inviteCode, name: 'Ann Cole', email: `ann${t}@t.test`, password: 'longenough5', device: 'Mac', deviceId: 'd5' });
  const ann = call(r.body.token);
  await rico('PATCH', '/members/' + (await rico('GET', '/state')).body.workspace.members.find((m) => m.name === 'Ann Cole').id, { role: 'admin' });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const tp = p.types[0];
  const list = { projectId: p.id, typeId: tp.id };
  const fkey = (type) => tp.fields.find((f) => f.type === type)?.key;
  const statusF = tp.fields.find((f) => f.key === 'status');
  const recOf = async (id, who = rico) => (await who('GET', `/projects/${p.id}/records`)).body?.find?.((x) => x.id === id);
  const stageOf = async (id) => { const v = (await recOf(id))?.values[statusF.id]; return statusF.choices.find((c) => c.id === v)?.label || v; };
  // A private board Sam can't see, with the same kind of jobs.
  const pp = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'], private: true, name: 'Private jobs' })).body;
  const ptp = pp.types[0];
  const flowOf = async (name, body, plist = list) => {
    const f = (await rico('POST', '/job-flows', { name, list: plist, ...body })).body;
    const pub = await rico('POST', `/job-flows/${f?.id}/publish`);
    return { id: f?.id, status: pub.status, error: pub.body?.error || '', version: pub.body?.version, sid: (n) => pub.body?.version?.body?.steps?.find((s) => s.name === n)?.id, step: (n) => pub.body?.version?.body?.steps?.find((s) => s.name === n) };
  };
  const C = { kind: 'client', name: 'Client' };
  const D = (name) => ({ kind: 'custom', name, settings: { text: name } });
  const runOf = async (id, who = rico) => (await who('GET', `/jobs/${id}/run`)).body?.run;
  const stepOf = async (id, name, who = rico) => (await runOf(id, who))?.steps?.find((s) => s.name === name);
  const stateOf = async (id, name) => (await stepOf(id, name))?.state;
  const bareJob = async (name, values = {}, proj = p, type = tp) => (await rico('POST', `/projects/${proj.id}/records`, { typeId: type.id, values: { job: name, ...values } })).body;
  const stacksOf = async (who) => (await who('GET', '/state')).body?.workspace?.stacks || [];
  const itemsOf = async (who) => (await who('GET', '/state')).body?.items || [];

  // ---------- 1. A stack per job ----------
  const FS = await flowOf('With files', { stack: true, steps: [C, D('Work')] });
  ok(FS.status === 200 && FS.version?.body?.stack === true, 'a flow with stack: true publishes and keeps it in the version: ' + FS.error);
  let made = (await rico('POST', '/jobs', { flowId: FS.id, values: { job: 'Smith deck' } })).body;
  const js = made?.job;
  const sid1 = (await recOf(js?.id))?.stackId;
  const stk = (await stacksOf(rico)).find((x) => x.id === sid1);
  ok(!!sid1 && stk?.recordId === js?.id && stk?.name === 'Smith deck', 'a job started on it gets one stack named after it: ' + JSON.stringify(stk));
  r = await rico('POST', `/jobs/${js?.id}/stack`);
  ok(r.status === 200 && r.body?.stack?.id === sid1, 'asking for its stack again gives the same one');
  // Two attaches at once make one stack.
  const jb = await bareJob('Twin attach');
  const [a1, a2] = await Promise.all([rico('POST', `/jobs/${jb.id}/stack`), rico('POST', `/jobs/${jb.id}/stack`)]);
  ok(a1.status === 200 && a2.status === 200 && a1.body?.stack?.id === a2.body?.stack?.id && (await stacksOf(rico)).filter((x) => x.recordId === jb.id).length === 1, 'two requests at once make one stack');
  r = await rico('POST', `/jobs/${jb.id}/flow`, { flowId: FS.id });
  ok(r.status === 200 && (await stacksOf(rico)).filter((x) => x.recordId === jb.id).length === 1, 'attaching a stack flow to a job that has one keeps the one');
  const jn = await bareJob('Attach no stack');
  ok(!(await recOf(jn.id))?.stackId, '(setup) a bare job with no stack');
  r = await rico('POST', `/jobs/${jn.id}/flow`, { flowId: FS.id });
  const jnStacks = (await stacksOf(rico)).filter((x) => x.recordId === jn.id);
  ok(r.status === 200 && jnStacks.length === 1 && jnStacks[0].name === 'Attach no stack' && (await recOf(jn.id))?.stackId === jnStacks[0].id, 'attaching a stack flow to a job with none makes exactly one, named after it, on the record: ' + JSON.stringify(jnStacks));
  ok((await sam('POST', `/jobs/${jb.id}/stack`)).status === 403, 'members can’t make a job’s stack');
  const ja = await bareJob('Admin stack');
  r = await ann('POST', `/jobs/${ja.id}/stack`);
  ok(r.status === 200 && r.body?.stack?.recordId === ja.id, 'an admin can');
  // A file in it: Sam sees it (he sees the job); a private board's job stack he never reaches.
  const note = (await rico('POST', '/items', { type: 'text', text: 'JOBNOTE-SMITH gate code is on the fridge', stackId: sid1 })).body;
  ok(!!note?.id && note.stackId === sid1, '(setup) a note in the job’s stack');
  ok((await itemsOf(sam)).some((x) => x.id === note.id) && (await stacksOf(sam)).some((x) => x.id === sid1), 'Sam, who sees the job, sees its stack and the note');
  r = await sam('POST', '/items', { type: 'text', text: 'JOBNOTE-SAM before photos', stackId: sid1 });
  ok(r.status === 200 && r.body?.stackId === sid1, 'and can add to it');
  const pj = await bareJob('Secret job', {}, pp, ptp);
  const psid = (await rico('POST', `/jobs/${pj.id}/stack`)).body?.stack?.id;
  const pnote = (await rico('POST', '/items', { type: 'text', text: 'JOBNOTE-PRIVATE price is 9000', stackId: psid })).body;
  ok(!!psid && !!pnote?.id && pnote.stackId === psid, '(setup) a note in a private board’s job stack');
  let sst = (await sam('GET', '/state')).body;
  ok(!sst.workspace.stacks.some((x) => x.id === psid) && !JSON.stringify(sst).includes('JOBNOTE-PRIVATE') && !JSON.stringify(sst).includes(psid), 'state: Sam gets neither the private job’s stack nor its note (search reads state)');
  r = await sam('POST', '/items', { type: 'text', text: 'sneak', stackId: psid });
  ok(!!psid && (r.status !== 200 || r.body?.stackId !== psid), 'a stack id doesn’t get Sam past the job’s visibility: he can’t add to it');
  ok([403, 404].includes((await sam('POST', `/items/${pnote.id}/share`, {})).status), 'item routes: he can’t share its note');
  ok([403, 404].includes((await sam('PATCH', `/items/${pnote.id}`, { text: 'changed' })).status), 'or change it');
  // A share link made by the owner dies with the job.
  const shared = (await rico('POST', `/items/${pnote.id}/share`, {})).body?.share;
  ok(!!shared?.token, '(setup) the owner shares the private note');
  // Chat pins of the stack.
  const crew = (await rico('POST', '/channels', { name: 'crew', memberIds: [samId] })).body.channels.find((x) => x.name === 'crew');
  await rico('POST', `/channels/${crew.id}/pins`, { kind: 'stack', id: psid });
  const crewOf = async (who) => (await who('GET', '/state')).body.workspace.channels.find((x) => x.id === crew.id);
  let pins = (await crewOf(sam))?.pins || [];
  ok(pins.length === 1 && pins[0].locked && !pins[0].id, 'a chat pin of the private job’s stack is a locked chip for Sam');
  // Export: Sam's own export never has the private job's note (even one he made while he could see it).
  await rico('PATCH', `/projects/${pp.id}`, { memberIds: [samId] });
  const samPriv = (await sam('POST', '/items', { type: 'text', text: 'JOBNOTE-SAMPRIV while allowed', stackId: psid })).body;
  ok(samPriv?.stackId === psid, '(setup) Sam, let in, adds a note to the private job’s stack');
  await rico('PATCH', `/projects/${pp.id}`, { memberIds: [] });
  sst = (await sam('GET', '/state')).body;
  ok(!JSON.stringify(sst).includes('JOBNOTE-SAMPRIV') && !sst.workspace.stacks.some((x) => x.id === psid), 'let out again, Sam no longer sees even his own note there');
  r = await sam('POST', '/exports', { kind: 'mine' });
  let ex = null;
  await until(async () => { ex = (await sam('GET', '/exports')).body?.exports?.find((y) => y.kind === 'mine'); return ex?.status === 'ready'; }, 15000);
  if (ex?.status === 'ready') {
    const zr = await fetch(`${B}/api/exports/${ex.id}/file`, { headers: { authorization: 'Bearer ' + samTok } });
    const zp = DIR + '/sam.zip';
    fs.writeFileSync(zp, Buffer.from(await zr.arrayBuffer()));
    const raw = execFileSync('unzip', ['-p', zp]).toString();
    ok(!raw.includes('JOBNOTE-SAMPRIV') && !raw.includes('JOBNOTE-PRIVATE') && raw.includes('JOBNOTE-SAM before'), 'export: Sam’s own export has his note on the job he sees, not the private one');
  } else ok(false, 'Sam’s export got ready');
  // "Members see only theirs": a job-stack file is seen by a member who sees the job in Jobs.
  await rico('PATCH', '/workspace', { visibility: 'own' });
  const jobsSam = (await sam('GET', '/jobs')).body?.jobs || [];
  const seesSmith = jobsSam.some((x) => x.id === js.id);
  ok(((await itemsOf(sam)).some((x) => x.id === note.id)) === seesSmith, 'members-see-only-theirs: Sam sees the job’s note exactly when he sees the job in Jobs (' + seesSmith + ')');
  await rico('PATCH', '/workspace', { visibility: 'all' });
  // Deleting the job, its list (a type) and its board each trash the stack's items.
  const gone1 = await bareJob('Delete me');
  const gs1 = (await rico('POST', `/jobs/${gone1.id}/stack`)).body?.stack?.id;
  const gn1 = (await rico('POST', '/items', { type: 'text', text: 'JOBNOTE-GONE1', stackId: gs1 })).body;
  await rico('DELETE', `/records/${gone1.id}`);
  ok(!(await itemsOf(rico)).some((x) => x.id === gn1?.id) && !(await stacksOf(rico)).some((x) => x.id === gs1), 'deleting the job: its stack and note are gone from the team (to the trash)');
  const pt = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'], name: 'Type to delete' })).body;
  const gone2 = await bareJob('Type job', {}, pt, pt.types[0]);
  const gs2 = (await rico('POST', `/jobs/${gone2.id}/stack`)).body?.stack?.id;
  const gn2 = (await rico('POST', '/items', { type: 'text', text: 'JOBNOTE-GONE2', stackId: gs2 })).body;
  r = await rico('POST', `/projects/${pt.id}/schema`, { op: 'removeType', typeId: pt.types[0].id });
  ok(!!gs2 && !(await itemsOf(rico)).some((x) => x.id === gn2?.id) && !(await stacksOf(rico)).some((x) => x.id === gs2), 'deleting its list: the stack and its note go too (' + r.status + ')');
  const pd = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'], name: 'Board to delete' })).body;
  const gone3 = await bareJob('Board job', {}, pd, pd.types[0]);
  const gs3 = (await rico('POST', `/jobs/${gone3.id}/stack`)).body?.stack?.id;
  const gn3 = (await rico('POST', '/items', { type: 'text', text: 'JOBNOTE-GONE3', stackId: gs3 })).body;
  await rico('DELETE', `/projects/${pd.id}`);
  ok(!!gs3 && !(await itemsOf(rico)).some((x) => x.id === gn3?.id) && !(await stacksOf(rico)).some((x) => x.id === gs3), 'deleting its board: the stack and its note go too');
  await rico('DELETE', `/records/${pj.id}`);
  ok((await fetch(`${B}/s/${shared.token}`)).status >= 400, 'a share link to a deleted job’s file stops working');
  ok(!!psid && !((await crewOf(rico))?.pins || []).some((x) => x.id === psid), 'and its stack’s chat pin is gone');

  // ---------- 2. Clients and jobs on the map ----------
  const dana = (await rico('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '555-0100', address: '10 Client Way' })).body;
  const danaId = dana.id ?? dana.contact?.id;
  const lone = (await rico('POST', '/contacts', { name: 'Lone Client', email: 'lone@x.test', address: '11 Lonely Rd' })).body;
  const cf = fkey('contact');
  const m1 = await bareJob('Map job 1', { address: '21 Shared St', scheduled: day(2) });
  const m2 = await bareJob('Map job 2', { address: '  21  shared st ', scheduled: day(3) });
  const m3 = await bareJob('Map job client addr', { [cf]: danaId, scheduled: day(4) });
  const m4 = await bareJob('Map job far', { address: '24 Far Ave', scheduled: day(60) });
  const m5 = await bareJob('Map job undated', { address: '25 Undated Ln' });
  const m6 = await bareJob('Map job fails', { address: '26 FAIL Rd', scheduled: day(5) });
  const m7 = await bareJob('Map job private', { address: '27 Private Pl', scheduled: day(5) }, pp, ptp);
  // A client whose only job is outside the range: that job isn't on the map, so the client is.
  const farC = (await rico('POST', '/contacts', { name: 'Far Client', email: 'far@x.test', address: '12 Far Client Rd' })).body;
  const farId = farC.id ?? farC.contact?.id;
  await bareJob('Map job far client', { [cf]: farId, scheduled: day(90) });
  geo.clear();
  const map = (who, qs = '') => who('GET', '/map/jobs' + qs);
  r = await map(rico);
  const ids = (b) => (b?.points || []).map((x) => x.id);
  ok(r.status === 200 && ids(r.body).includes(m1.id) && ids(r.body).includes(m2.id) && ids(r.body).includes(m3.id), 'the map: jobs with an address (their own, or their client’s): ' + r.status + ' ' + JSON.stringify(ids(r.body)));
  ok(ids(r.body).length > 0 && !ids(r.body).includes(m4.id) && !ids(r.body).includes(m5.id), 'by default today to 30 days ahead, no undated jobs');
  const pt1 = (r.body?.points || []).find((x) => x.id === m1.id);
  ok(pt1?.kind === 'job' && pt1.name === 'Map job 1' && pt1.address === '21 Shared St' && typeof pt1.lat === 'number' && typeof pt1.lng === 'number' && pt1.scheduled === day(2) && 'stage' in pt1, 'a job point: kind, id, name, address, lat, lng, scheduled, stage: ' + JSON.stringify(pt1));
  ok((r.body?.points || []).find((x) => x.id === m3.id)?.address === '10 Client Way', 'a job with no address of its own is at its client’s');
  ok(typeof r.body?.more === 'number' && typeof r.body?.missing === 'number' && !r.body?.off, 'more and missing are counts; off only without a token');
  ok(!ids(r.body).includes(m6.id) && r.body?.missing >= 1, 'a failed lookup leaves the point out, counted as missing');
  ok((geo.get('21 shared st') || 0) === 1, 'a shared address (however it’s spaced) is looked up once: ' + JSON.stringify([...geo]));
  const cpt = (r.body?.points || []).find((x) => x.kind === 'client' && x.id === (lone.id ?? lone.contact?.id));
  ok(!!cpt && cpt.name === 'Lone Client' && cpt.address === '11 Lonely Rd' && typeof cpt.lat === 'number' && typeof cpt.lng === 'number' && !('scheduled' in cpt) && !('stage' in cpt) && !/lone@x/.test(JSON.stringify(cpt)), 'a client point: name, address, lat, lng, no job fields and no email: ' + JSON.stringify(cpt));
  ok((r.body?.points || []).some((x) => x.kind === 'client' && x.id === farId), 'a client whose only job is outside the range is a point of its own');
  ok((r.body?.points || []).some((x) => x.kind === 'client' && x.id === (lone.id ?? lone.contact?.id)) && !(r.body?.points || []).some((x) => x.kind === 'client' && x.id === danaId), 'owners see clients with an address and no job among the points');
  const before = geoCalls();
  await map(rico);
  ok(geoCalls() === before + 1, 'asked again within the window: only the failed one is looked up again (' + (geoCalls() - before) + ')');
  r = await map(rico, `?from=${day(50)}&to=${day(70)}`);
  ok(ids(r.body).includes(m4.id) && !ids(r.body).includes(m1.id), 'a range picks the jobs scheduled in it');
  ok(ids((await map(rico, '?undated=1')).body).includes(m5.id), 'undated=1 adds jobs with no day');
  ok((await map(rico, `?from=${day(0)}&to=${day(365)}`)).status === 200, '366 days (counting both ends) is allowed');
  ok((await map(rico, `?from=${day(0)}&to=${day(366)}`)).status === 400, '367 is refused');
  for (const [why, qs] of [['a bad day', '?from=2026-13-40'], ['from after to', `?from=${day(5)}&to=${day(1)}`], ['over 366 days', `?from=${day(0)}&to=${day(400)}`]]) ok((await map(rico, qs)).status === 400, 'the map refuses ' + why);
  r = await map(sam);
  ok(r.status === 200 && !ids(r.body).includes(m7.id) && ids(r.body).includes(m1.id), 'Sam sees only the jobs he can see');
  ok(r.status === 200 && !(r.body?.points || []).some((x) => x.kind === 'client') && !/dana@x\.test|555-0100|lone@x/.test(JSON.stringify(r.body)), 'members get no clients and no client email or phone');
  await bareJob('Map job concurrent', { address: '30 Concurrent St', scheduled: day(7) });
  const [c1, c2] = await Promise.all([map(rico), map(sam)]);
  ok(c1.status === 200 && c2.status === 200 && (geo.get('30 concurrent st') || 0) === 1, 'two requests at once share one lookup of a new address: ' + (geo.get('30 concurrent st') || 0));
  const slowJob = await bareJob('Map job slow', { address: '28 SLOW St', scheduled: day(6) });
  const t0 = Date.now();
  r = await map(rico);
  ok(r.status === 200 && !ids(r.body).includes(slowJob.id) && Date.now() - t0 < 6800, 'a slow lookup times out at 5 s and leaves its point out (' + (Date.now() - t0) + ' ms)');
  await rico('PATCH', `/records/${slowJob.id}`, { values: { address: '28 Fast St' } });
  // Nothing stored: a restart looks the addresses up again.
  const dataHas = () => fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).some((f) => /"lat"\s*:\s*33\.4|"lng"\s*:\s*-21\b/.test(fs.readFileSync(DIR + '/' + f, 'utf8')));
  await stop();
  ok(!dataHas(), 'no looked-up point is written to the data');
  ok(await start(), 'restarted');
  rico = call(ricoTok); sam = call(samTok);
  geo.clear();
  await map(rico);
  ok((geo.get('21 shared st') || 0) === 1, 'after a restart the address is looked up again (nothing kept)');
  await stop();
  ok(await start({ MAPBOX_TOKEN: '' }), 'restarted without a Mapbox token');
  rico = call(ricoTok); sam = call(samTok);
  r = await map(rico);
  ok(r.status === 200 && r.body?.off === true && (r.body?.points || []).length === 0, 'no token: an empty map that says it isn’t set up');
  await stop();
  ok(await start(), 'restarted with the token');
  rico = call(ricoTok); sam = call(samTok);
  // 200 points at most, in a fixed order, the rest counted; 200 distinct lookups at most.
  {
    r = await call()('POST', '/auth', { mode: 'create', workspace: 'Big map ' + t, name: 'Bo', email: `bo${t}@t.test`, password: 'longenough4', device: 'Mac', deviceId: 'd4' });
    const bo = call(r.body.token);
    const bst = (await bo('GET', '/state')).body;
    await bo('PATCH', '/workspace', { tools: { ...bst.workspace.tools, projects: true, map: true } });
    const bp = (await bo('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
    // Two jobs on the same day with the same name: the last tie-breaker is the id.
    const tw = [];
    for (let i = 0; i < 2; i++) tw.push((await bo('POST', `/projects/${bp.id}/records`, { typeId: bp.types[0].id, values: { job: 'Aaa twin', address: `${90 + i} Twin St`, scheduled: day(1) } })).body?.id);
    for (let i = 0; i < 203; i++) await bo('POST', `/projects/${bp.id}/records`, { typeId: bp.types[0].id, values: { job: 'Big ' + String(i).padStart(3, '0'), address: `${100 + i} Big St`, scheduled: day(1 + (i % 20)) } });
    geo.clear();
    const b1 = (await bo('GET', '/map/jobs')).body;
    const lookups = geoCalls();
    const b2 = (await bo('GET', '/map/jobs')).body;
    ok(b1?.points?.length === 200 && b1?.more === 5, 'at most 200 points, the rest counted in more: ' + b1?.points?.length + ' / ' + b1?.more);
    ok(b1?.points?.length === 200 && lookups <= 200, 'at most 200 addresses looked up in one request: ' + lookups);
    ok(ids(b1).length === 200 && JSON.stringify(ids(b1)) === JSON.stringify(ids(b2)), 'the same 200 every time (Scheduled day, then name)');
    const days = (b1?.points || []).map((x) => x.scheduled);
    ok(days.length === 200 && days.every((d, i) => !i || days[i - 1] <= d), 'in Scheduled-day order');
    const keyOf = (x) => x.scheduled + '|' + x.name;
    const keyId = (x) => keyOf(x) + '|' + x.id;
    ok(b1?.points?.length === 200 && b1.points.every((x, i, a) => !i || keyId(a[i - 1]) < keyId(x)), 'and by name, then id, within a day');
    const twins = (b1?.points || []).filter((x) => x.name === 'Aaa twin').map((x) => x.id);
    ok(twins.length === 2 && JSON.stringify(twins) === JSON.stringify([...tw].sort()) && b1.points[0].name === 'Aaa twin', 'same day and name: by id: ' + JSON.stringify(twins));
    const all = [{ scheduled: day(1), name: 'Aaa twin' }, { scheduled: day(1), name: 'Aaa twin' }, ...Array.from({ length: 203 }, (_, i) => ({ scheduled: day(1 + (i % 20)), name: 'Big ' + String(i).padStart(3, '0') }))].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)).slice(0, 200).map((x) => x.name);
    ok(JSON.stringify((b1?.points || []).map((x) => x.name)) === JSON.stringify(all), 'exactly the first 200 by Scheduled day then name (ties within a day broken by name)');
  }

  // ---------- 3. Tasks from a bundle; the Campaign step ----------
  const pre1 = (await rico('POST', '/task-presets', { text: 'Call to confirm' })).body;
  const pre2 = (await rico('POST', '/task-presets', { text: 'Load the truck' })).body;
  const bundle = (await rico('POST', '/task-presets', { kind: 'bundle', name: 'Prep', steps: [{ presetId: pre1.id }, { presetId: pre2.id }] })).body;
  const FT = await flowOf('From a bundle', { steps: [C, { kind: 'tasks', name: 'Prep tasks', settings: { bundleId: bundle.id } }] });
  ok(FT.status === 200 && JSON.stringify(FT.step('Prep tasks')?.settings?.tasks) === JSON.stringify(['Call to confirm', 'Load the truck']) && FT.step('Prep tasks')?.settings?.bundleFrom?.id === bundle.id && FT.step('Prep tasks')?.settings?.bundleFrom?.name === 'Prep', 'a Tasks step from a bundle copies its tasks into the version: ' + FT.error + ' ' + JSON.stringify(FT.step('Prep tasks')?.settings));
  await rico('PATCH', '/task-presets/' + pre2.id, { text: 'Load the van' });
  await rico('DELETE', '/task-presets/' + bundle.id);
  const jt = (await rico('POST', '/jobs', { flowId: FT.id, values: { job: 'Bundle job' } })).body?.job;
  const tsk = (await stepOf(jt?.id, 'Prep tasks'))?.tasks?.map((x) => x.text);
  ok(JSON.stringify(tsk) === JSON.stringify(['Call to confirm', 'Load the truck']), 'the bundle edited and deleted after publishing: the version (and a new job) unchanged: ' + JSON.stringify(tsk));
  ok((await flowOf('Bundle gone', { steps: [C, { kind: 'tasks', name: 'T', settings: { bundleId: bundle.id } }] })).status === 400, 'publishing with a bundle that’s gone is refused');
  // A saved campaign.
  const src = (await rico('POST', '/campaigns', { name: 'Deep clean playbook' })).body;
  await rico('POST', '/goals', { campaignId: src.id, title: 'Book the crew' });
  const tpl = (await rico('POST', '/templates', { campaignId: src.id, name: 'Deep clean' })).body;
  ok(!!tpl?.id, '(setup) a saved campaign');
  const FC = await flowOf('With a campaign', { steps: [C, { kind: 'campaign', name: 'Run playbook', settings: { templateId: tpl.id } }, D('After')] });
  ok(FC.status === 200 && FC.step('Run playbook')?.settings?.templateFrom?.id === tpl.id && FC.step('Run playbook')?.settings?.templateFrom?.name === 'Deep clean' && FC.step('Run playbook')?.settings?.template && FC.step('Run playbook')?.who?.type === 'admins', 'a Campaign step publishes with the saved campaign copied in, for owners and admins: ' + FC.error);
  ok((await flowOf('Campaign for anyone', { steps: [C, { kind: 'campaign', name: 'X', settings: { templateId: tpl.id }, who: { type: 'member', id: samId } }] })).status === 400, 'a Campaign step for a member is refused');
  ok((await flowOf('Campaign missing', { steps: [C, { kind: 'campaign', name: 'X', settings: { templateId: 'nope' } }] })).status === 400, 'a Campaign step with no saved campaign is refused');
  await rico('PATCH', '/templates/' + tpl.id, { name: 'Renamed playbook' });
  const jc = (await rico('POST', '/jobs', { flowId: FC.id, contactId: danaId, values: { job: 'Campaign job' } })).body?.job;
  ok(await until(async () => !!(await stepOf(jc?.id, 'Run playbook'))?.campaign?.id), 'when the step comes up a campaign is made');
  let sc = (await stepOf(jc?.id, 'Run playbook'))?.campaign;
  const camps = async () => Object.values((await rico('GET', '/state')).body.campaigns || []).filter((x) => !!jc?.id && x.recordId === jc.id && x.kind !== 'job');
  let cl = await camps();
  ok(cl.length === 1 && cl[0].id === sc?.id && /Deep clean · Campaign job/.test(cl[0].name), 'one campaign, linked to the job, named from the snapshot (not the rename): ' + JSON.stringify(cl.map((x) => x.name)));
  ok(Object.keys(sc || {}).sort().join() === 'id,name,status' && sc?.status === 'active' && sc?.name === cl[0]?.name && (await stateOf(jc?.id, 'Run playbook')) === 'current', 'the step shows the campaign (active) and waits for it');
  // A restart right after it was made: the marker and the campaign are both there, nothing repeats.
  await stop();
  ok(await start(), 'restarted after the campaign was made');
  rico = call(ricoTok); sam = call(samTok);
  await sleep(500);
  cl = await camps();
  ok(cl.length === 1 && (await stepOf(jc?.id, 'Run playbook'))?.campaign?.id === sc?.id, 'after the restart: the same one campaign, still the step’s');
  // The campaign doesn't move the job's stage through its own steps or automations.
  const stage0 = await stageOf(jc?.id);
  await rico('POST', '/automations', { name: 'stage mover', trigger: { kind: 'campaign.done' }, actions: [{ kind: 'post', text: 'CAMPDONE', channelId: 'general' }] });
  // Deleted: the step is open again and a new one is made.
  await rico('DELETE', '/campaigns/' + sc?.id);
  ok(await until(async () => { const x = (await stepOf(jc?.id, 'Run playbook'))?.campaign; return !!x?.id && x.id !== sc?.id; }), 'the campaign deleted: the step makes a new one');
  sc = (await stepOf(jc?.id, 'Run playbook'))?.campaign;
  ok((await camps()).length === 1, 'still one campaign on the job');
  await rico('PATCH', '/campaigns/' + sc?.id, { status: 'done' });
  ok(await until(async () => (await stateOf(jc?.id, 'Run playbook')) === 'done'), 'the campaign done: the step is done');
  ok(await until(async () => (await itemsOf(rico)).some((x) => x.type === 'message' && x.text === 'CAMPDONE')), 'it’s an ordinary campaign: its campaign.done automation ran');
  ok(!!stage0 && (await stageOf(jc?.id)) === stage0, 'completing the linked campaign (and its campaign.done event) doesn’t move the job’s stage: ' + stage0 + ' → ' + (await stageOf(jc?.id)));

  // ---------- 4. The job in chat ----------
  const FP = await flowOf('Pinnable', { steps: [C, D('Measure up')] });
  const jp = (await rico('POST', '/jobs', { flowId: FP.id, contactId: danaId, values: { job: 'Pinned job' } })).body?.job;
  r = await rico('POST', `/channels/${crew.id}/pins`, { kind: 'job', id: jp?.id });
  ok(r.status === 200, 'a job can be pinned to a chat: ' + r.status + ' ' + (r.body?.error || ''));
  await until(async () => (await stateOf(jp?.id, 'Measure up')) === 'current');
  pins = (await crewOf(sam))?.pins || [];
  const jpin = pins.find((x) => x.kind === 'job');
  ok(jpin?.icon === '🧰', 'with the flow’s icon: ' + jpin?.icon);
  const jnf = await bareJob('No flow job');
  await rico('POST', `/channels/${crew.id}/pins`, { kind: 'job', id: jnf.id });
  const nfpin = ((await crewOf(sam))?.pins || []).find((x) => x.id === jnf.id);
  ok(nfpin?.label === 'No flow job' && nfpin.icon === '🛠️' && nfpin.next == null, 'a job on no flow: 🛠️ and no next step: ' + JSON.stringify(nfpin));
  ok(jpin && !jpin.locked && jpin.id === jp?.id && jpin.label === 'Pinned job' && jpin.next === 'Measure up', 'Sam, who sees it, gets its name and next step: ' + JSON.stringify(jpin));
  r = await sam('POST', `/channels/${crew.id}/pins`, { kind: 'job', id: m7.id });
  ok(r.status === 404 || r.status === 403, 'pinning needs the pinner to see the job');
  const jpp = await bareJob('Private pinned', {}, pp, ptp);
  await rico('POST', `/channels/${crew.id}/pins`, { kind: 'job', id: jpp.id });
  pins = (await crewOf(sam))?.pins || [];
  ok(pins.some((x) => x.locked) && !JSON.stringify(pins).includes(jpp.id) && !JSON.stringify(pins).includes('Private pinned'), 'a job Sam can’t see is a locked chip');
  // Losing access shows the pin locked at once.
  await rico('PATCH', `/projects/${p.id}`, { private: true });
  pins = (await crewOf(sam))?.pins || [];
  ok(!pins.some((x) => x.id === jp?.id) && pins.filter((x) => x.locked).length >= 2, 'Sam loses access to the board: the job pin is locked at once');
  await rico('PATCH', `/projects/${p.id}`, { private: false });
  await rico('DELETE', `/records/${jp?.id}`);
  ok(!!jpin && !((await crewOf(rico))?.pins || []).some((x) => x.kind === 'job' && x.id === jp?.id), 'a deleted job’s pin disappears');

  // ---------- 5. Inventory use ----------
  const filter = (await rico('POST', '/inventory/items', { name: 'Filter', unit: 'each', cost: '5' })).body;
  const soap = (await rico('POST', '/inventory/items', { name: 'Soap', unit: 'box', cost: '9' })).body;
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 1', kind: 'vehicle' })).body;
  await rico('POST', '/inventory/moves', { kind: 'receive', itemId: filter.id, qty: 3, to: truck.id });
  await rico('POST', '/inventory/moves', { kind: 'receive', itemId: soap.id, qty: 10, to: truck.id });
  const fItem = (await rico('POST', '/job-items', { name: 'Filter swap', unit: 'each', price: 2000, invItemId: filter.id })).body?.item;
  const fItem2 = (await rico('POST', '/job-items', { name: 'Filter (extra)', unit: 'each', price: 1500, invItemId: filter.id })).body?.item;
  const sItem = (await rico('POST', '/job-items', { name: 'Soap', unit: 'each', price: 500, invItemId: soap.id })).body?.item;
  ok(!!fItem?.id && !!fItem2?.id && !!sItem?.id, '(setup) Items linked to Inventory');
  const W = { kind: 'work', name: 'Do it', settings: { useStock: true, fromPlace: truck.id } };
  ok((await flowOf('Bad place', { steps: [C, { ...W, settings: { useStock: true, fromPlace: 'nope' } }] })).status === 400, 'publishing a stock step with a place that isn’t there is refused');
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: false, map: true } });
  ok((await flowOf('Stock, tool off', { steps: [C, W] })).status === 400, 'publishing a stock step with the Inventory tool off is refused');
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true, map: true } });
  const FU = await flowOf('Uses stock', { items: [{ itemId: fItem.id, qty: 2 }, { itemId: fItem2.id, qty: 2 }, { itemId: sItem.id, qty: 1 }], steps: [C, W, D('Wrap up')] });
  ok(FU.status === 200, '(setup) a flow that uses stock: ' + FU.error);
  const ju = (await rico('POST', '/jobs', { flowId: FU.id, contactId: danaId, values: { job: 'Stock job' } })).body?.job;
  const ck = fkey('checklist');
  const tick = (id, done) => rico('PATCH', `/records/${id}`, { values: { [ck]: { items: [{ id: 'c1', text: 'All done', done }] } } });
  await tick(ju?.id, true);
  ok(await until(async () => (await stateOf(ju?.id, 'Do it')) === 'done'), 'the work is done');
  const stockAt = async (id) => (await rico('GET', '/inventory/items/' + id)).body?.item?.stock?.[truck.id];
  const usesOf = async () => ((await rico('GET', '/inventory/moves')).body || []).filter((m) => m.kind === 'use' && m.jobId === ju?.id);
  await until(async () => (await usesOf()).length > 0);
  let uses = await usesOf();
  ok(uses.length === 1 && uses[0].itemId === filter.id && Math.abs(uses[0].qty) === 3 && (await stockAt(filter.id)) === 0, 'two lines for one Filter (2 + 2) are one move, capped at the 3 there: ' + JSON.stringify(uses.map((m) => [m.itemId, m.qty])));
  const ur = await runOf(ju?.id);
  const ust = ur?.steps?.find((x) => x.name === 'Do it');
  ok(!!ur && uses[0]?.key === `${ur.id}:${ust?.goalId}:${ust?.cycle}`, 'the move carries the run:step:cycle key: ' + uses[0]?.key);
  ok(JSON.stringify(ust?.stock?.used) === JSON.stringify([{ itemId: filter.id, name: 'Filter', qty: 3 }]), 'the step shows what was used, added up and capped: ' + JSON.stringify(ust?.stock?.used));
  const stockStep = await stepOf(ju?.id, 'Do it');
  ok((stockStep?.stock?.notes || []).some((n) => /Short 1 × Filter at Truck 1/.test(n)) && (stockStep?.stock?.notes || []).some((n) => /Units differ: each vs box/.test(n)), 'the shortfall and the unit mismatch are noted, not blocking: ' + JSON.stringify(stockStep?.stock?.notes));
  ok((await stockAt(soap.id)) === 10, 'soap (box vs each) isn’t touched');
  const samStock = (await stepOf(ju?.id, 'Do it', sam))?.stock;
  ok(!!samStock && Object.keys(samStock).sort().join() === 'notes,used' && samStock.used.every((u) => Object.keys(u).sort().join() === 'itemId,name,qty') && !/cost|price|value/i.test(JSON.stringify(samStock)), 'members see what was used (itemId, name, qty) and the notes, no cost or price');
  // A restart right after: both halves are there, nothing repeats.
  await stop();
  ok(await start(), 'restarted after the stock was used');
  rico = call(ricoTok); sam = call(samTok);
  await sleep(500);
  ok((await usesOf()).length === 1 && (await stockAt(filter.id)) === 0, 'after the restart: still one use, the stock as it was');
  // Reopen and redo doesn't use it twice.
  await rico('POST', '/inventory/moves', { kind: 'receive', itemId: filter.id, qty: 5, to: truck.id });
  await tick(ju?.id, false);
  await rico('POST', `/jobs/${ju?.id}/steps/${FU.sid('Do it')}/reopen`);
  await tick(ju?.id, true);
  await sleep(800);
  ok((await usesOf()).length === 1 && (await stockAt(filter.id)) === 5, 'reopened and done again: no second use, stock not put back');
} catch (e) {
  ok(false, 'threw: ' + (e?.stack || e));
} finally {
  srv.kill();
  fake.close();
}
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
