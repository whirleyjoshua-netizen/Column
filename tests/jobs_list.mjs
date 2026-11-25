// The Jobs list and who may do what (docs/jobflows/CONTRACTS.md §2, §3, §5, the owner 2026-11-24): every job the
// person may see, from every job list, with or without a campaign; a job an ordinary campaign drives is marked
// legacy and left as it is; starting a job takes exactly the checks making a record does (the project, the members
// switch, the rules' OK); a member sees no more of a client or of the money than they do today.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobs_list';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5247, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
if (!(await fetch(B + '/api/health').then((x) => x.ok, () => false))) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Shades ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Shades ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olive Park', email: `olive${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olive = call(r.body.token);
  { const os = (await olive('GET', '/state')).body; await olive('PATCH', '/workspace', { tools: { ...os.workspace.tools, projects: true } }); } // isolation, not the tool switch
  st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const dana = (await rico('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '555-0100', address: '10 A St' })).body;
  const danaId = dana.id ?? dana.contact?.id;

  const hv = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const ht = hv.types[0];
  const gen = (await rico('POST', '/projects', { template: 'jobs' })).body;
  const gt = gen.types.find((x) => x.key === 'jobs');
  const priv = (await rico('POST', '/projects', { template: 'trades', trades: ['blinds'], private: true })).body;
  const crm = (await rico('POST', '/projects', { template: 'crm' })).body;
  const mk = async (p, typeId, values) => (await rico('POST', `/projects/${p.id}/records`, { typeId, values })).body;
  const plain = await mk(hv, ht.id, { job: 'No campaign · AC check', customer: danaId });
  const legacy = await mk(hv, ht.id, { job: 'Campaign-driven · furnace' });
  const c = (await rico('POST', '/campaigns', { name: 'Furnace swap', recordId: legacy.id })).body;
  await rico('POST', '/goals', { campaignId: c.id, title: 'Order the unit', kind: 'tasks' });
  const generic = gt ? await mk(gen, gt.id, { job: 'Generic job' }) : null;
  const hidden = await mk(priv, priv.types[0].id, { job: 'Private · shutters' });
  const lead = crm.types?.[0] ? await mk(crm, crm.types[0].id, { [crm.types[0].fields[0].key]: 'A lead, not a job' }) : null;
  const flow = (await rico('POST', '/job-flows', { name: 'HVAC service', list: { projectId: hv.id, typeId: ht.id }, whoCreates: 'everyone', steps: [{ kind: 'client', name: 'Client' }, { kind: 'custom', name: 'Fix it', who: { type: 'anyone' } }] })).body;
  await rico('POST', `/job-flows/${flow?.id}/publish`);
  const run = (await rico('POST', '/jobs', { flowId: flow?.id, values: { job: 'On a flow · AC repair' } })).body?.job;

  // The owner's list.
  r = await rico('GET', '/jobs');
  const ids = (r.body?.jobs || []).map((j) => j.id);
  const one = (id) => (r.body?.jobs || []).find((j) => j.id === id);
  ok(r.status === 200 && ids.includes(plain.id), 'a job with no campaign is listed: ' + r.status);
  ok(ids.includes(legacy.id) && one(legacy.id)?.legacy === true && one(legacy.id)?.run === null, 'a job an ordinary campaign drives is listed, marked legacy, with no run');
  ok(!!run && one(run.id)?.run?.flowName === 'HVAC service' && one(run.id).run.total === 2 && one(run.id).run.current?.name === 'Client', 'a job on a flow shows its flow, steps and current step');
  ok(!generic || ids.includes(generic.id), 'jobs from the generic Jobs list are listed too');
  ok(ids.includes(hidden.id), 'the owner sees jobs in their private project');
  ok(!lead || !ids.includes(lead.id), 'a record in a list that isn’t a job list (CRM) isn’t a job');
  ok(one(plain.id)?.client?.name === 'Dana Ruiz', 'a job shows its client’s name');

  // A member.
  r = await sam('GET', '/jobs');
  const sids = (r.body?.jobs || []).map((j) => j.id);
  ok(r.status === 200 && sids.includes(plain.id) && !sids.includes(hidden.id), 'a member sees the team’s jobs but not a private project’s');
  ok(!JSON.stringify(r.body).includes('dana@x.test') && !JSON.stringify(r.body).includes('555-0100'), 'the list gives a member the client’s name, not their email or phone');
  ok((await sam('GET', `/jobs/${hidden.id}/run`)).status === 404, 'a member can’t open the run of a job they can’t see');
  r = await olive('GET', '/jobs');
  ok(!(r.body?.jobs || []).some((j) => j.id === plain.id), 'another team sees none of them');
  ok((await olive('GET', `/jobs/${run?.id}/run`)).status === 404, 'another team can’t open a run');

  // Starting a job: the same checks as making a record.
  r = await sam('POST', '/jobs', { flowId: flow.id, values: { job: 'Sam’s job' } });
  ok(r.status === 200, 'a member may start a job on a flow open to everyone: ' + r.status + ' ' + (r.body?.error || ''));
  r = await sam('POST', '/jobs', { flowId: flow.id, values: { job: 'Big discount', price: { rows: [{ desc: 'Unit', qty: 1, price: '500' }], discount: { type: 'percent', value: 50 } } } });
  await rico('PUT', '/rules', { discount: { level: 'approval', over: '10%' } });
  const asRecord = await sam('POST', `/projects/${hv.id}/records`, { typeId: ht.id, values: { job: 'Big discount R', price: { rows: [{ desc: 'Unit', qty: 1, price: '500' }], discount: { type: 'percent', value: 50 } } } });
  r = await sam('POST', '/jobs', { flowId: flow.id, values: { job: 'Big discount 2', price: { rows: [{ desc: 'Unit', qty: 1, price: '500' }], discount: { type: 'percent', value: 50 } } } });
  ok(asRecord.status !== 200 && r.status === asRecord.status && !!r.body?.error === !!asRecord.body?.error, `a discount over the rule’s limit is held here exactly as for a new record (${asRecord.status} → ${r.status})`);
  ok(!(await rico('GET', `/projects/${hv.id}/records`)).body.some((x) => x.values[ht.fields.find((f) => f.key === 'job').id] === 'Big discount 2'), 'and no job was made');
  const pflow = (await rico('POST', '/job-flows', { name: 'Shutters', list: { projectId: priv.id, typeId: priv.types[0].id }, whoCreates: 'everyone', steps: [{ kind: 'custom', name: 'Do it' }] })).body;
  await rico('POST', `/job-flows/${pflow?.id}/publish`);
  ok((await sam('POST', '/jobs', { flowId: pflow?.id, values: { job: 'Sneaky' } })).status >= 400, 'a member can’t start a job in a project they can’t see');
  const aflow = (await rico('POST', '/job-flows', { name: 'Admins only', list: { projectId: hv.id, typeId: ht.id }, steps: [{ kind: 'custom', name: 'Do it' }] })).body;
  await rico('POST', `/job-flows/${aflow?.id}/publish`);
  ok((await sam('POST', '/jobs', { flowId: aflow?.id, values: { job: 'Nope' } })).status === 403, 'a member can’t start a job on a flow for owners and admins');

  // A step's who: 'anyone' means anyone who may edit the job.
  const sr = (await sam('GET', `/jobs/${run.id}/run`)).body?.run;
  const fix = sr?.steps?.find((s) => s.name === 'Fix it');
  ok((await sam('POST', `/jobs/${run.id}/steps/${sr?.steps?.[0]?.id}/skip`, { reason: 'x' })).status === 403, 'a member can’t skip a step that isn’t skippable for them');
  await rico('POST', `/jobs/${run.id}/steps/${sr?.steps?.[0]?.id}/skip`, { reason: 'Walk-in' });
  r = await sam('POST', `/jobs/${run.id}/steps/${fix?.id}/done`);
  ok(r.status === 200, 'a member who may edit the job does a step that’s for anyone: ' + r.status + ' ' + (r.body?.error || ''));
  // A step for a role: someone in the role may, someone outside it may not.
  const st3 = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Shades ' + t, code: st3.workspace.inviteCode, name: 'Kim Lo', email: `kim${t}@t.test`, password: 'longenough4', device: 'Mac', deviceId: 'd4' });
  const kim = call(r.body.token);
  const samM = (await rico('GET', '/state')).body.workspace.members.find((m) => m.name === 'Sam Reed').id;
  const role = (await rico('POST', '/roles', { name: 'Installers', memberIds: [samM] })).body;
  const roleId = (role?.roles || []).find((x) => x.name === 'Installers')?.id; // POST /roles answers with the workspace
  const rflow = (await rico('POST', '/job-flows', { name: 'Install', list: { projectId: hv.id, typeId: ht.id }, steps: [{ kind: 'custom', name: 'Install it', who: { type: 'role', id: roleId } }] })).body;
  ok(!!rflow?.id, '(setup) a flow with a step for Installers');
  ok((await rico('POST', '/job-flows', { name: 'Bad role', list: { projectId: hv.id, typeId: ht.id }, steps: [{ kind: 'custom', name: 'X', who: { type: 'role', id: 'made-up' } }] })).status === 400, 'a step for a role the team doesn’t have is refused');
  await rico('POST', `/job-flows/${rflow?.id}/publish`);
  const rj = (await rico('POST', '/jobs', { flowId: rflow?.id, values: { job: 'Install job' } })).body?.job;
  const rs = (await rico('GET', `/jobs/${rj?.id}/run`)).body?.run?.steps?.[0]?.id;
  ok((await kim('POST', `/jobs/${rj?.id}/steps/${rs}/done`)).status === 403, 'Kim, not an Installer, can’t do it');
  ok((await sam('POST', `/jobs/${rj?.id}/steps/${rs}/done`)).status === 200, 'Sam, an Installer, can');
  const aj = (await rico('POST', '/jobs', { flowId: aflow?.id, values: { job: 'Admins job' } })).body?.job;
  const as = (await rico('GET', `/jobs/${aj?.id}/run`)).body?.run?.steps?.[0]?.id;
  ok((await sam('POST', `/jobs/${aj?.id}/steps/${as}/done`)).status === 200, 'a step with no who set is for anyone who may edit the job');
  await rico('PATCH', '/workspace', { memberAccess: { projects: false } });
  ok((await sam('GET', '/jobs')).status === 403, 'with Boards off for members, a member gets no jobs list');
  ok((await sam('POST', `/jobs/${run.id}/steps/${fix?.id}/done`)).status === 403, 'and can’t act on a step, even one for anyone');
  ok((await sam('POST', '/jobs', { flowId: flow.id, values: { job: 'Off' } })).status === 403, 'and can’t start jobs');
  await rico('PATCH', '/workspace', { memberAccess: { projects: true } });

  // A step for a member who has left falls back to owners and admins.
  const sid = (await rico('GET', '/state')).body.workspace.members.find((m) => m.name === 'Sam Reed').id;
  const sflow = (await rico('POST', '/job-flows', { name: 'Sam’s step', list: { projectId: hv.id, typeId: ht.id }, steps: [{ kind: 'custom', name: 'Sam does it', who: { type: 'member', id: sid } }] })).body;
  ok(!!sflow?.id, '(setup) a flow with a step for Sam');
  await rico('POST', `/job-flows/${sflow?.id}/publish`);
  const sj = (await rico('POST', '/jobs', { flowId: sflow?.id, values: { job: 'For Sam' } })).body?.job;
  await rico('DELETE', '/members/' + sid);
  const after = (await rico('GET', `/jobs/${sj?.id}/run`)).body?.run;
  ok(after?.steps?.[0]?.who?.fallback === 'admins', 'Sam left: the step says owners and admins now');
  ok((await rico('POST', `/jobs/${sj?.id}/steps/${after?.steps?.[0]?.id}/done`)).status === 200, 'and an owner can do it');
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
