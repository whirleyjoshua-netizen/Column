// The job board (job plan Phase 5, the owner 2026-11-18): every job with work on it, how far it is (steps done of
// all, its stage, the next step) and what's in its way: a step whose tasks are done but whose materials, gear, visit
// or field aren't, tasks overdue, a sign-off waiting, an automation held back from a stage. Plus, for owners and
// admins, automations whose last run failed and connections that need attention. Visibility travels with the data:
// a member only sees jobs and campaigns they can see, and no one else's automations.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobboard';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5224, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Shades ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Shades ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  const samId = st.workspace.members.find((m) => m.name === 'Sam Reed').id;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const [s0, s1, s2] = statusF.choices;
  const mk = async (name) => (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: name, [statusF.id]: s0.id } })).body;
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 1' })).body;
  const wire = (await rico('POST', '/inventory/items', { name: 'Copper line set', unit: 'ft' })).body;

  // Job A: Measure (done), Install (its task done, 25 ft of line set not used yet, 10 on order), Finish (a task overdue).
  const jobA = await mk('Bill Nye · new unit');
  const ca = (await rico('POST', '/campaigns', { name: 'Bill Nye install', recordId: jobA.id })).body;
  const gM = (await rico('POST', '/goals', { campaignId: ca.id, title: 'Measure', kind: 'tasks' })).body;
  const tM = (await rico('POST', '/tasks', { text: 'Measure the room', goalId: gM.id })).body;
  await rico('PATCH', `/tasks/${tM.id}`, { done: true });
  const gI = (await rico('POST', '/goals', { campaignId: ca.id, title: 'Install', kind: 'tasks', stage: s1.label })).body;
  const tI = (await rico('POST', '/tasks', { text: 'Set the unit', goalId: gI.id })).body;
  await rico('PATCH', `/goals/${gI.id}`, { needs: [{ kind: 'stock', itemId: wire.id, qty: 25 }] });
  await rico('PATCH', `/tasks/${tI.id}`, { done: true });
  await rico('POST', '/inventory/orders', { supplier: 'Coastal', lines: [{ itemId: wire.id, qty: 10 }], jobId: jobA.id, goalId: gI.id });
  const gF = (await rico('POST', '/goals', { campaignId: ca.id, title: 'Finish', kind: 'tasks' })).body;
  await rico('POST', '/tasks', { text: 'Clean up', goalId: gF.id, due: day(-2), assigneeId: samId });

  // Job B: a sign-off waiting.
  const jobB = await mk('Ann Lee · repair');
  const cb = (await rico('POST', '/campaigns', { name: 'Ann Lee repair', recordId: jobB.id })).body;
  const gB = (await rico('POST', '/goals', { campaignId: cb.id, title: 'Fix it', kind: 'tasks' })).body;
  const tB = (await rico('POST', '/tasks', { text: 'Swap the motor', goalId: gB.id, assigneeId: samId, signoff: { memberId: st.me.memberId } })).body;
  r = await sam('PATCH', `/tasks/${tB.id}`, { done: true });
  ok(r.status === 200 && !!r.body?.submitted, '(setup) Sam’s task is sent for sign-off: ' + r.status + ' ' + JSON.stringify(r.body?.submitted));

  // Job C: an automation tries to move it on and is held, and its run fails.
  const jobC = await mk('Cy Fox · install');
  const cc = (await rico('POST', '/campaigns', { name: 'Cy Fox work', recordId: jobC.id, private: true })).body;
  const gC = (await rico('POST', '/goals', { campaignId: cc.id, title: 'Order', kind: 'tasks', stage: s2.label })).body;
  await rico('POST', '/tasks', { text: 'Order the shades', goalId: gC.id });
  const push = (await rico('POST', '/automations', { name: 'Push on', trigger: { kind: 'record.stage', projectId: p.id, to: s1.label }, actions: [{ kind: 'record', projectId: p.id, typeId: tp.id, set: [{ field: statusF.id, value: s2.label }] }] })).body;
  ok(!!push?.id, '(setup) the automation “Push on”');
  await rico('PATCH', `/records/${jobC.id}`, { values: { [statusF.id]: s1.id } });
  await sleep(500);

  // A job with no campaign isn't on the board.
  const jobD = await mk('Dee Ross · quote only');

  r = await rico('GET', '/board');
  ok(r.status === 200 && Array.isArray(r.body?.jobs), 'the board answers: ' + r.status + ' ' + (r.body?.error || ''));
  const jobs = r.body.jobs || [];
  const A = jobs.find((x) => x.id === jobA.id), Bj = jobs.find((x) => x.id === jobB.id), C = jobs.find((x) => x.id === jobC.id);
  ok(!!A && !!Bj && !!C && !jobs.some((x) => x.id === jobD.id), 'it lists the jobs with campaigns on them, and not one without: ' + jobs.map((x) => x.name).join(' | '));
  ok(A?.name === 'Bill Nye · new unit' && A.projectId === p.id && A.stage === s0.label, 'each with its name, project and stage: ' + JSON.stringify({ n: A?.name, s: A?.stage }));
  ok(A?.steps?.done === 1 && A.steps.total === 3, 'and how far it is: 1 of 3 steps: ' + JSON.stringify(A?.steps));
  ok(A?.next?.goalId === gI.id && A.next.title === 'Install', 'and the next step: ' + JSON.stringify(A?.next));
  const why = (j, kind) => (j?.blocked || []).filter((b) => b.kind === kind);
  const needB = why(A, 'needs')[0];
  ok(needB?.goalId === gI.id && /25 ft Copper line set/.test(needB.text) && /10 on order/.test(needB.text), 'a step with its tasks done but its materials not used is in the way, saying what’s on order: ' + needB?.text);
  const lateB = why(A, 'overdue')[0];
  ok(lateB?.goalId === gF.id && lateB.taskId && /Clean up/.test(lateB.text) && /Sam Reed/.test(lateB.text), 'a task that’s overdue, with who it’s for: ' + lateB?.text);
  ok(!why(A, 'needs').some((b) => b.goalId === gM.id), 'a finished step isn’t');
  const signB = why(Bj, 'signoff')[0];
  ok(signB?.taskId === tB.id && /Swap the motor/.test(signB.text) && /Rico Vega/.test(signB.text), 'a sign-off waiting, with who’s to sign: ' + signB?.text);
  const heldB = why(C, 'held')[0];
  ok(heldB && /Push on/.test(heldB.text) && /Order/.test(heldB.text), 'an automation held back from a stage: ' + heldB?.text);
  ok(r.body.counts?.blocked === jobs.filter((x) => x.blocked.length).length && r.body.counts.jobs === jobs.length, 'with counts: ' + JSON.stringify(r.body.counts));

  // Owners and admins: automations whose last run failed, and connections.
  const fa = (r.body.automations || []).find((x) => x.id === push.id);
  ok(fa && fa.name === 'Push on' && /Order/.test(fa.note) && fa.at > 0, 'an automation whose last run failed is listed, with why: ' + JSON.stringify(fa));
  ok(Array.isArray(r.body.connections), 'and connections that need attention (none here): ' + JSON.stringify(r.body.connections));

  // Moving the work on clears it.
  await rico('PATCH', `/tasks/${tB.id}`, { done: true });
  r = await rico('GET', '/board');
  ok(!why(r.body.jobs.find((x) => x.id === jobB.id), 'signoff').length, 'signed off: no longer in the way ' + JSON.stringify(r.body.jobs.find((x) => x.id === jobB.id)?.blocked));

  // A member: only what they can see. Cy Fox's campaign is private, so Sam doesn't see its steps or why it's held;
  // nor anyone's automations or the team's connections.
  r = await sam('GET', '/board');
  ok(r.status === 200, 'a member sees the board too');
  const sC = r.body.jobs.find((x) => x.id === jobC.id);
  ok(!sC || (!sC.blocked.length && !sC.steps.total), 'a private campaign’s steps aren’t on a member’s board: ' + JSON.stringify(sC));
  ok(r.body.jobs.some((x) => x.id === jobA.id), 'the team’s other jobs are');
  ok(!r.body.automations?.length && !r.body.connections?.length, 'no automations or connections for a member: ' + JSON.stringify([r.body.automations, r.body.connections]));
  r = await call()('GET', '/board');
  ok(r.status === 401, 'signed out: no: ' + r.status);
} catch (e) { ok(false, 'threw ' + e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-30).join('\n'));
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
