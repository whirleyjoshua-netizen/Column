// Job Flows, a job running on a flow (docs/jobflows/CONTRACTS.md §1.4–2.3, the owner 2026-11-24): starting a job
// makes the job and its run; each step finishes only when what it stands for really happened (a client on the job,
// fields filled, a visit booked, the checklist ticked, the customer's signature, an invoice sent, the invoice paid,
// a Done button); the run shows where the job is and what to do next; steps reopen when the truth changes; a step
// finishes once per cycle; versions don't change running jobs; an invoice from before the run never counts.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflow_run';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5241, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const ENV = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' };
let srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
const up = async () => { for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); } };
await up();
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Bins ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Bins ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  const samId = st.workspace.members.find((m) => m.name === 'Sam Reed').id;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const tp = p.types[0];
  const fid = (k) => tp.fields.find((f) => f.key === k).id;
  const stageOf = async (id) => { const rec = (await rico('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === id); return tp.fields.find((f) => f.key === 'status').choices.find((c) => c.id === rec?.values[fid('status')])?.label; };
  const dana = (await rico('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '555-0100', address: '10 A St' })).body;
  const danaId = dana.id ?? dana.contact?.id;
  const posts = async () => (await rico('GET', '/state')).body.items.filter((it) => it.type === 'message').map((it) => it.text);
  const auto = async (name, trigger, text) => { const x = await rico('POST', '/automations', { name, trigger, actions: [{ kind: 'post', text, channelId: 'general' }] }); ok(x.status === 200, `(setup) automation “${name}” ${x.body?.error || ''}`); };
  await auto('Step done', { kind: 'step.done', projectId: p.id }, 'STEP {step} done on {record}');
  await auto('Flow done', { kind: 'job.flow.done', projectId: p.id }, 'FLOW done on {record}');

  const steps = [
    { kind: 'client', name: 'Add client info' },
    { kind: 'details', name: 'Add job info', settings: { fields: ['address'] } },
    { kind: 'book', name: 'Book on schedule', stage: 'Scheduled' },
    { kind: 'work', name: 'Clean the cans' },
    { kind: 'signoff', name: 'Customer signs' },
    { kind: 'invoice', name: 'Send invoice', stage: 'Invoiced' },
    { kind: 'payment', name: 'Collect payment', stage: 'Paid' },
    { kind: 'custom', name: 'Bins back', who: { type: 'admins' }, canSkip: false, settings: { text: 'Put them by the house.', checklist: ['Bins back', 'Lids shut'] } },
  ];
  const flow = (await rico('POST', '/job-flows', { name: 'Trash can cleaning, individual', icon: '🗑️', list: { projectId: p.id, typeId: tp.id }, steps })).body;
  r = await rico('POST', `/job-flows/${flow?.id}/publish`);
  ok(r.status === 200, '(setup) the flow is published: ' + r.status + ' ' + (r.body?.error || ''));
  const sid = (kind) => r.body?.version?.body?.steps.find((s) => s.kind === kind)?.id;

  // Start a job.
  r = await rico('POST', '/jobs', { flowId: flow?.id, values: { job: 'Dana · 3 cans', price: { rows: [{ desc: 'Can clean', qty: 3, price: '25' }] } }, key: 'k-dana-1' });
  ok(r.status === 200 && r.body?.job?.id && r.body?.run?.steps?.length === 8, 'starting a job makes the job and its run of 8 steps: ' + r.status + ' ' + (r.body?.error || ''));
  const job = r.body?.job || {};
  r = await rico('POST', '/jobs', { flowId: flow?.id, values: { job: 'Dana · 3 cans', price: { rows: [{ desc: 'Can clean', qty: 3, price: '25' }] } }, key: 'k-dana-1' });
  ok(r.status === 200 && r.body?.job?.id === job.id, 'the same key again gives back the same job (a retry makes no second job)');
  r = await rico('POST', '/jobs', { flowId: flow?.id, values: { job: 'Someone else' }, key: 'k-dana-1' });
  ok(r.status === 409, 'the same key with a different job is refused: ' + r.status);
  ok((await rico('GET', `/projects/${p.id}/records`)).body.filter((x) => x.values[fid('job')] === 'Dana · 3 cans').length === 1, 'only one job was made');

  const run = async () => (await rico('GET', `/jobs/${job.id}/run`)).body?.run;
  const at = async (kind) => until(async () => (await run())?.current?.kind === kind);
  let x = await run();
  ok(x?.current?.kind === 'client' && x.next?.action === 'pick-client', 'it starts on Add client info; Next picks the client');
  r = await rico('POST', `/jobs/${job.id}/steps/${sid('client')}/done`);
  ok(r.status === 409, 'Add client info has no Done button: it finishes when a client is on the job: ' + r.status);

  await rico('PATCH', '/records/' + job.id, { values: { customer: danaId } });
  ok(await at('details'), 'a client on the job finishes the first step');
  await rico('PATCH', '/records/' + job.id, { values: { address: '10 A St' } });
  ok(await at('book'), 'filling its address finishes Add job info; next: book it');
  ok((await run())?.next?.action === 'book-visit', 'Next opens the visit sheet');
  await rico('POST', `/records/${job.id}/visits`, { kind: 'Clean', date: tomorrow, start: 540, end: 600, memberIds: [samId] });
  ok(await at('work'), 'a visit booked finishes Book on schedule');
  ok((await stageOf(job.id)) === 'Scheduled', 'and the job is Scheduled');
  const cl = (await rico('GET', `/projects/${p.id}/records`)).body.find((y) => y.id === job.id).values[fid('checklist')];
  await rico('PATCH', '/records/' + job.id, { values: { checklist: { ...cl, items: cl.items.map((i) => ({ ...i, done: true })) } } });
  ok(await at('signoff'), 'the checklist all ticked finishes the work step');
  await rico('PATCH', '/records/' + job.id, { values: { signoff: { name: 'Dana Ruiz', image: 'data:image/png;base64,iVBORw0KGgo=' } } });
  ok(await at('invoice'), 'the customer’s signature finishes the sign-off step');

  // Unticking an item reopens the work step (live), and ticking it again finishes it again.
  await rico('PATCH', '/records/' + job.id, { values: { checklist: { ...cl, items: cl.items.map((i, n) => ({ ...i, done: n > 0 })) } } });
  ok(await at('work'), 'unticking a checklist item reopens the work step');
  await rico('PATCH', '/records/' + job.id, { values: { checklist: { ...cl, items: cl.items.map((i) => ({ ...i, done: true })) } } });
  ok(await at('invoice'), 'ticking it again finishes it again');

  // Invoice and payment, from the real invoice.
  r = await rico('POST', `/records/${job.id}/invoices`, { jobStep: sid('invoice') });
  const inv = r.body?.invoice || r.body;
  ok(r.status === 200 && inv?.id, 'an invoice made from the Invoice step');
  ok((await run())?.current?.kind === 'invoice', 'a draft invoice doesn’t finish the step');
  await rico('POST', `/invoices/${inv.id}/send`);
  ok(await at('payment'), 'sending it finishes Send invoice');
  ok((await stageOf(job.id)) === 'Invoiced', 'the job is Invoiced');
  r = await rico('POST', `/invoices/${inv.id}/payments`, { amount: '75', method: 'cash' });
  ok(await at('custom'), 'paid in full finishes Collect payment');
  const payId = (r.body?.payments || r.body?.invoice?.payments || []).at(-1)?.id;
  const stepPosts = async (name) => (await posts()).filter((s) => s.startsWith(`STEP ${name} done`)).length;
  ok(await until(async () => (await stepPosts('Collect payment')) === 1), 'step.done went off once for Collect payment');
  await rico('DELETE', `/invoices/${inv.id}/payments/${payId}`);
  ok(await at('payment'), 'taking the payment off reopens Collect payment');
  await rico('POST', `/invoices/${inv.id}/payments`, { amount: '75', method: 'cash' });
  ok(await at('custom'), 'paid again finishes it again');
  ok(await until(async () => (await stepPosts('Collect payment')) === 2), 'a genuine second completion fires step.done a second time (a new cycle)');
  x = await run();
  ok(x?.steps?.find((s) => s.kind === 'payment')?.cycle === 2, 'the run says it’s the second time: cycle 2');

  // A custom step: Done records the mark, its checklist still has to be ticked; admins only here.
  ok((await sam('POST', `/jobs/${job.id}/steps/${sid('custom')}/done`)).status === 403, 'a member can’t do a step that’s for owners and admins');
  r = await rico('POST', `/jobs/${job.id}/steps/${sid('custom')}/done`);
  ok(r.status === 200 && (await run())?.current?.kind === 'custom', 'Done on a custom step with its checklist unticked: still open');
  r = await rico('POST', `/jobs/${job.id}/steps/${sid('custom')}/done`);
  ok(r.status === 200, 'Done again is fine (nothing changes)');
  await rico('POST', `/jobs/${job.id}/steps/${sid('custom')}/check`, { item: 0, done: true });
  await rico('POST', `/jobs/${job.id}/steps/${sid('custom')}/check`, { item: 1, done: true });
  ok(await until(async () => (await run())?.status === 'done'), 'its checklist ticked: the run is done');
  ok(await until(async () => (await posts()).filter((s) => s.startsWith('FLOW done')).length === 1), 'job.flow.done went off once');
  ok((await stepPosts('Bins back')) === 1, 'step.done went off once for the custom step');

  // Skips.
  r = await rico('POST', '/jobs', { flowId: flow.id, values: { job: 'Lee · 1 can' } });
  const job2 = r.body?.job || {};
  ok((await rico('POST', `/jobs/${job2.id}/steps/${sid('client')}/skip`, {})).status === 400, 'a skip needs a reason');
  ok((await sam('POST', `/jobs/${job2.id}/steps/${sid('custom')}/skip`, { reason: 'no' })).status === 403, 'a member can’t skip a step that can’t be skipped');
  r = await rico('POST', `/jobs/${job2.id}/steps/${sid('client')}/skip`, { reason: 'Walk-in, no details' });
  x = (await rico('GET', `/jobs/${job2.id}/run`)).body?.run;
  ok(r.status === 200 && x?.steps?.[0]?.state === 'skipped' && x.steps[0].skipReason === 'Walk-in, no details' && x.current?.kind === 'details', 'an owner skips it with a reason; the run moves to the next step');
  r = await rico('POST', `/jobs/${job2.id}/steps/${sid('client')}/reopen`);
  ok(r.status === 200 && (await rico('GET', `/jobs/${job2.id}/run`)).body?.run?.current?.kind === 'client', 'an owner reopens it');
  ok((await sam('POST', `/jobs/${job2.id}/steps/${sid('client')}/reopen`)).status === 403, 'a member can’t reopen steps');

  // An invoice from before the run never counts.
  const old = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Old job', customer: danaId, address: '10 A St', price: { rows: [{ desc: 'Can clean', qty: 1, price: '25' }] } } })).body;
  const oldInv = (await rico('POST', `/records/${old.id}/invoices`)).body;
  const oi = oldInv?.invoice || oldInv;
  await rico('POST', `/invoices/${oi.id}/send`);
  await rico('POST', `/invoices/${oi.id}/payments`, { amount: '25', method: 'cash' });
  r = await rico('POST', `/jobs/${old.id}/flow`, { flowId: flow.id });
  ok(r.status === 200, 'a flow attached to an existing job: ' + r.status + ' ' + (r.body?.error || ''));
  await sleep(400);
  x = (await rico('GET', `/jobs/${old.id}/run`)).body?.run;
  ok(x?.steps?.find((s) => s.kind === 'invoice')?.state !== 'done' && x?.steps?.find((s) => s.kind === 'payment')?.state !== 'done', 'an invoice paid before the run doesn’t finish its invoice or payment step');
  ok((await rico('POST', `/jobs/${old.id}/flow`, { flowId: flow.id })).status === 409, 'a second flow on a job with one going is refused');
  r = await rico('POST', `/jobs/${old.id}/flow`, { flowId: flow.id, replace: true });
  ok(r.status === 200, 'an owner replaces it explicitly');
  ok((await sam('POST', `/jobs/${job2.id}/flow`, { flowId: flow.id, replace: true })).status === 403, 'a member can’t attach or replace flows');

  // Versions: publishing v2 doesn't change a running job.
  await rico('PATCH', `/job-flows/${flow.id}`, { steps: [...steps.slice(0, 7), { kind: 'custom', name: 'Photo of the bins', settings: { text: 'Take one photo.' } }] });
  await rico('POST', `/job-flows/${flow.id}/publish`);
  x = (await rico('GET', `/jobs/${job2.id}/run`)).body?.run;
  ok(x?.versionN === 1 && x.steps.at(-1).name === 'Bins back', 'a job started on version 1 keeps version 1’s steps');
  r = await rico('POST', '/jobs', { flowId: flow.id, values: { job: 'New · 2 cans' } });
  ok(r.body?.run?.versionN === 2 && r.body.run.steps.at(-1).name === 'Photo of the bins', 'a new job gets version 2');

  // Archived: no new jobs; running ones go on.
  await rico('POST', `/job-flows/${flow.id}/archive`, { archived: true });
  ok((await rico('POST', '/jobs', { flowId: flow.id, values: { job: 'Too late' } })).status === 400, 'no new jobs on an archived flow');
  ok((await rico('GET', `/jobs/${job2.id}/run`)).body?.run?.status === 'active', 'a job already running on it carries on');

  // After a restart the runs are as they were, and nothing re-fires.
  const before = (await posts()).length;
  srv.kill(); await sleep(400);
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: ENV, stdio: 'ignore' });
  srv.log = '';
  await up();
  x = (await rico('GET', `/jobs/${job.id}/run`)).body?.run;
  ok(x?.status === 'done' && x.steps.find((s) => s.kind === 'payment')?.state === 'done', 'after a restart the finished run is still finished');
  await sleep(600);
  ok((await posts()).length === before, 'and a restart fires no step.done again');
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
}
if (fails) console.log((srv.log || '').slice(-3000));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
