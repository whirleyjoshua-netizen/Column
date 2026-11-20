// A campaign's test run (2026-11-20, the sandbox): its tasks go only to the testers (matched person by person), only
// testers are told about it, its automations' emails (and other outside work) and job moves are logged instead of
// done, Skip ahead finishes a phase, and Go live puts its tasks back as they were (who they were for, unticked,
// the test's comments gone), keeps tasks people added, and deletes the ones its automations made.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/testrun';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4965, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Tr ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r0.body.token);
  const code = (await maria('GET', '/state')).body.workspace.inviteCode;
  r0 = await call()('POST', '/auth', { mode: 'join', workspace: 'Tr ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r0.body.token);
  r0 = await call()('POST', '/auth', { mode: 'join', workspace: 'Tr ' + t, code, name: 'Tess', email: `tess${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const tess = call(r0.body.token);
  const samId = (await sam('GET', '/state')).body.me.memberId, tessId = (await tess('GET', '/state')).body.me.memberId;
  const camp = (await maria('POST', '/campaigns', { name: 'Install SOP' })).body;
  const prep = (await maria('POST', '/goals', { campaignId: camp.id, title: 'Prep', order: 0 })).body;
  const inst = (await maria('POST', '/goals', { campaignId: camp.id, title: 'Install', order: 1 })).body;
  const order = (await maria('POST', '/tasks', { goalId: prep.id, text: 'Order parts', assigneeId: samId })).body;
  const hang = (await maria('POST', '/tasks', { goalId: inst.id, text: 'Hang the blinds', assigneeId: samId, checklist: [{ text: 'Level' }, { text: 'Drill' }] })).body;
  let r = await maria('POST', '/automations', { name: 'Parts ordered', on: true, trigger: { kind: 'task.done', campaignId: camp.id }, actions: [
    { kind: 'email', subject: 'Parts ordered', text: '{task} is done' }, { kind: 'task', text: 'Check the parts came', assignee: samId, campaign: 'same' }, { kind: 'notify', text: 'Done: {task}', to: [samId] }] });
  ok(r.status === 200, 'an automation on this campaign: an email, a task and a note to Sam' + (r.status !== 200 ? ' ' + JSON.stringify(r.body) : ''));

  ok((await sam('POST', `/campaigns/${camp.id}/test`, { testers: [samId] })).status === 403, 'someone who doesn’t run it can’t test it');
  r = await maria('POST', `/campaigns/${camp.id}/test`, { testers: [tessId] });
  ok(r.status === 200 && r.body.test?.testers?.join() === tessId && r.body.test.log[0]?.kind === 'start' && !r.body.test.tasks && !r.body.test.map, 'Maria starts a test run with Tess (the saved copy stays on the server)');
  ok((await maria('POST', `/campaigns/${camp.id}/test`, {})).status === 409, 'not twice');
  let st = (await maria('GET', '/state')).body;
  const T = (id) => st.tasks.find((x) => x.id === id);
  ok(T(order.id).assigneeId === tessId && T(hang.id).assigneeId === tessId && T(order.id).test === true, 'its tasks go to Tess, marked as a test');

  r = await tess('PATCH', '/tasks/' + hang.id, { checklist: hang.checklist.map((x) => ({ ...x, done: true })) });
  await tess('POST', `/tasks/${hang.id}/comments`, { text: 'Testing a comment' });
  ok(!(await sam('GET', '/notices')).body.some((n) => n.campaignId === camp.id || n.taskId === hang.id), 'Sam isn’t told anything about the test');
  ok(!(await maria('GET', '/notices')).body.some((n) => n.text === 'Testing a comment'), 'nor is Maria, who isn’t a tester');
  const handMade = (await maria('POST', '/tasks', { goalId: inst.id, text: 'Check it’s level' })).body;

  r = await tess('PATCH', '/tasks/' + order.id, { done: true });
  ok(r.status === 200 && r.body.done, 'Tess finishes Order parts');
  let c = null;
  for (let i = 0; i < 40; i++) { c = (await maria('GET', '/state')).body.campaigns.find((x) => x.id === camp.id); if (c.test.log.some((x) => x.kind === 'email')) break; await sleep(150); }
  const mail = c.test.log.find((x) => x.kind === 'email');
  ok(mail && mail.text.includes('Parts ordered') && mail.text.includes('Order parts is done') && mail.by.includes('Parts ordered'), 'the automation’s email is in the test log, not sent: ' + (mail?.text || JSON.stringify(c.test.log)));
  st = (await maria('GET', '/state')).body;
  const made = st.tasks.find((x) => x.text === 'Check the parts came');
  ok(made && made.assigneeId === tessId && made.test, 'the task it made (for Sam) goes to Tess too');
  ok(!(await sam('GET', '/notices')).body.some((n) => n.text?.startsWith('Done:')), 'its note to Sam isn’t sent');
  const runs = (await maria('GET', '/automations')).body;
  const auto = (Array.isArray(runs) ? runs : runs.automations || []).find((x) => x.name === 'Parts ordered');
  ok((auto?.runs || []).some((y) => y.note.includes('Test run, logged and not done: Email')), 'its run says what was held back: ' + auto?.runs?.[0]?.note);
  ok((auto?.runs || []).some((y) => y.note.includes('Notified 0 people (1 not told: it’s a test run)')), 'and that Sam wasn’t told');

  r = await maria('POST', `/campaigns/${camp.id}/test/skip`, { goalId: inst.id });
  st = (await maria('GET', '/state')).body;
  ok(r.status === 200 && T(hang.id).done && T(handMade.id).done && r.body.test.log.at(-1).kind === 'skip', 'Skip ahead finishes the Install phase: ' + r.body.test?.log.at(-1)?.text);
  ok((await maria('POST', `/campaigns/${camp.id}/test/skip`, { goalId: 'nope' })).status === 404, 'only its own phases');

  r = await maria('POST', `/campaigns/${camp.id}/test/end`, {});
  ok(r.status === 200 && r.body.removed === 3 && r.body.test === null, 'Go live: the test is over, and the 3 tasks its automation made (one for each task finished) are deleted: ' + r.body.removed);
  st = (await maria('GET', '/state')).body;
  const o = T(order.id), hb = T(hang.id), hm = T(handMade.id);
  ok(o.assigneeId === samId && hb.assigneeId === samId && !o.test, 'its tasks are Sam’s again');
  ok(!o.done && !hb.done && !o.doneBy && hb.checklist.every((x) => !x.done) && hb.checklist.length === 2, 'unticked, the checklist too');
  ok(!(hb.comments || []).length, 'the test’s comments are gone');
  ok(hm && !hm.done, 'the task Maria added in the test stays, not done');
  ok(!st.tasks.some((x) => x.text === 'Check the parts came'), 'the automation’s task is gone');
  const h = (await maria('GET', `/tasks/${order.id}/history`)).body;
  const hl = Array.isArray(h) ? h : h.history;
  ok(Array.isArray(hl) && !hl.some((x) => x.k === 'done'), 'its history doesn’t show the test: ' + JSON.stringify(hl?.map((x) => x.k)));
  const cc = st.campaigns.find((x) => x.id === camp.id);
  ok(cc.status === 'active' && !cc.test, 'the campaign is live');
  ok((await maria('POST', `/campaigns/${camp.id}/test/end`, {})).status === 409, 'Go live only during a test');
  // Live now: the automation sends for real again (no contact here, so it says so instead of logging).
  await sam('PATCH', '/tasks/' + order.id, { done: true });
  await sleep(800);
  ok((await sam('GET', '/notices')).body.some((n) => n.text === 'Done: Order parts'), 'live, the note reaches Sam');
} catch (e) { ok(false, 'threw: ' + e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-8).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
