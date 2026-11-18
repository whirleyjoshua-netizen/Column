// Automations know the job (the owner, 2026-11-17: Phase 3 of the job → campaign → step → task → automation work).
// A task's or campaign's events carry its job ({record}, filtered by project) and its step ({step}), but only to an
// automation whose maker can see the job. New events: a step is finished, a task is reopened, a campaign is started,
// a job is held back from a stage. What an automation changes on a job is marked as the automation's on its timeline,
// and a hold on one goes there too. A step that fails on an outside call (another app down) is tried again from that
// step, up to 3 times, never repeating the steps before it, with the same Idempotency-Key; when it stops for good
// its maker is told.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflows';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5214, HPORT = 5215, B = `http://127.0.0.1:${PORT}`, H = `http://127.0.0.1:${HPORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
// Another app: /flaky says 500 the first time, then 200; /down always 500; /bad always 400.
const got = [];
const hook = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  got.push({ path: req.url, key: req.headers['idempotency-key'] || null, body: JSON.parse(raw || '{}') });
  const n = got.filter((x) => x.path === req.url).length;
  res.writeHead(req.url === '/flaky' || req.url === '/flaky2' ? (n === 1 ? 500 : 200) : req.url === '/down' ? 503 : req.url === '/bad' ? 400 : 200); res.end('{}');
});
await new Promise((r) => hook.listen(HPORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', ALLOW_LOCAL_WEBHOOKS: '1', FLOW_TIME_SCALE: '0.001', SCHEDULE_TICK_MS: '150' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
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
  st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const posts = async () => (await rico('GET', '/state')).body.items.filter((it) => it.type === 'message' && !it.channelId).map((it) => it.text);
  const posted = (re) => until(async () => (await posts()).some((x) => re.test(x)));

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const [s0, s1, s2] = statusF.choices;
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bill Nye', [statusF.id]: s0.id } })).body;
  const auto = async (who, name, trigger, actions) => { const x = await who('POST', '/automations', { name, trigger, actions }); ok(x.status === 200, `(setup) the automation “${name}” ${x.body?.error || ''}`); return x.body; };
  const post = (text) => ({ kind: 'post', text, channelId: 'general' });

  // New events, with the job and the step.
  await auto(rico, 'Started', { kind: 'campaign.started', projectId: p.id }, [post('Started {campaign} for {record}')]);
  await auto(rico, 'Task done', { kind: 'task.done', projectId: p.id }, [post('Done: {task} on {record} ({step})')]);
  await auto(rico, 'Step done', { kind: 'step.done', projectId: p.id }, [post('Step: {step} finished for {record} in {campaign}')]);
  await auto(rico, 'Reopened', { kind: 'task.reopened' }, [post('Reopened: {task} on {record}')]);
  await auto(rico, 'Held', { kind: 'record.held', projectId: p.id }, [post('Held: {record} at {stage}, waiting on {step}')]);

  const camp = (await rico('POST', '/campaigns', { name: 'Bill Nye work', recordId: job.id })).body;
  ok(await posted(/^Started Bill Nye work for Bill Nye$/), 'a campaign started for a job sets off “a campaign is started”, with the job: ' + JSON.stringify(await posts()));
  const g = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Measure', kind: 'tasks', stage: s1.label })).body;
  const a1 = (await rico('POST', '/tasks', { text: 'Measure six windows', goalId: g.id })).body;
  const a2 = (await rico('POST', '/tasks', { text: 'Upload measurements', goalId: g.id })).body;

  r = await sam('PATCH', `/records/${job.id}`, { values: { [statusF.id]: s2.id } });
  ok(r.status === 409, '(setup) the job is held');
  ok(await posted(/^Held: Bill Nye at .+, waiting on Measure$/), '“a job is held back from a stage” goes off, with the stage and the step: ' + JSON.stringify(await posts()));

  await sam('PATCH', `/tasks/${a1.id}`, { done: true });
  ok(await posted(/^Done: Measure six windows on Bill Nye \(Measure\)$/), 'a task done in a job’s campaign carries the job and the step, and a project filter catches it');
  await sleep(400);
  ok(!(await posts()).some((x) => x.startsWith('Step:')), 'the step isn’t finished with one of its two tasks done');
  await sam('PATCH', `/tasks/${a2.id}`, { done: true });
  ok(await posted(/^Step: Measure finished for Bill Nye in Bill Nye work$/), '“a step is finished” goes off when its last task is done');
  await sleep(300);
  ok((await posts()).filter((x) => x.startsWith('Step:')).length === 1, 'once');
  await sam('PATCH', `/tasks/${a2.id}`, { done: false });
  ok(await posted(/^Reopened: Upload measurements on Bill Nye$/), '“a task is reopened” goes off');

  // The job only goes to makers who can see it.
  const priv = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'], private: true })).body;
  if (!priv.private) await rico('PATCH', `/projects/${priv.id}`, { private: true });
  const pt = priv.types[0];
  const secret = (await rico('POST', `/projects/${priv.id}/records`, { typeId: pt.id, values: { job: 'Secret client' } })).body;
  const c2 = (await rico('POST', '/campaigns', { name: 'Open campaign', recordId: secret.id })).body;
  const g2 = (await rico('POST', '/goals', { campaignId: c2.id, title: 'Prep', kind: 'tasks' })).body;
  const x2 = (await rico('POST', '/tasks', { text: 'Prep the van', goalId: g2.id })).body;
  const samId = (await rico('GET', '/state')).body.workspace.members.find((m) => m.name === 'Sam Reed').id;
  await rico('PATCH', '/members/' + samId, { role: 'admin' });
  await auto(sam, 'Sam hears tasks', { kind: 'task.done' }, [post('Sam: {task} [{record}]')]);
  await rico('PATCH', `/tasks/${x2.id}`, { done: true });
  await sleep(800);
  ok(!(await posts()).some((x) => x.includes('Secret client')), 'a job its maker can’t see never reaches an automation: ' + JSON.stringify((await posts()).filter((x) => x.startsWith('Sam'))));

  // An automation's changes to a job are marked as its own on the timeline; a hold on it goes there too.
  const job2 = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Ann Lee', [statusF.id]: s0.id } })).body;
  const c3 = (await rico('POST', '/campaigns', { name: 'Ann work', recordId: job2.id })).body;
  const g3 = (await rico('POST', '/goals', { campaignId: c3.id, title: 'Order', kind: 'tasks', stage: s2.label })).body;
  await rico('POST', '/tasks', { text: 'Order the shades', goalId: g3.id });
  await auto(rico, 'Push on', { kind: 'record.stage', projectId: p.id, to: s1.label }, [{ kind: 'record', projectId: p.id, typeId: tp.id, set: [{ field: statusF.id, value: s2.label }] }]);
  await rico('PATCH', `/records/${job2.id}`, { values: { [statusF.id]: s1.id } });
  const logOf = async (id) => (await rico('GET', `/records/${id}/log`)).body || [];
  ok(await until(async () => (await logOf(job2.id)).some((e) => e.kind === 'held' && e.auto && e.by === 'Push on' && /Order/.test(e.note))), 'an automation held back from a stage says so on the job’s timeline, as the automation: ' + JSON.stringify((await logOf(job2.id)).slice(0, 3)));
  const job3 = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Cy Fox', [statusF.id]: s0.id } })).body;
  await rico('PATCH', `/records/${job3.id}`, { values: { [statusF.id]: s1.id } });
  ok(await until(async () => (await logOf(job3.id)).some((e) => e.kind === 'change' && e.auto && e.by === 'Push on' && e.to === s2.label)), 'what an automation changes on a job is marked as the automation’s: ' + JSON.stringify((await logOf(job3.id)).slice(0, 3)));
  ok((await logOf(job3.id)).some((e) => e.kind === 'change' && !e.auto && e.by === 'Rico Vega'), 'and a person’s change isn’t');

  // Retries: another app down is tried again from the step that failed, never the ones before it.
  const runsOf = async (name) => (await rico('GET', '/automations')).body.find((x) => x.name === name)?.runs || [];
  const before = (await posts()).length;
  await auto(rico, 'Flaky', { kind: 'campaign.started', projectId: p.id }, [post('Before the app: {campaign}'), { kind: 'webhook', url: H + '/flaky' }]);
  await rico('POST', '/campaigns', { name: 'Flaky run', recordId: job.id });
  ok(await until(async () => got.filter((x) => x.path === '/flaky').length === 2, 6000), 'a step whose app was down is tried again: ' + got.filter((x) => x.path === '/flaky').length);
  const fl = got.filter((x) => x.path === '/flaky');
  ok(fl[0].key && fl[0].key === fl[1].key, 'with the same Idempotency-Key, so the app can tell: ' + fl.map((x) => x.key).join(' / '));
  ok(await until(async () => (await runsOf('Flaky'))[0]?.ok), 'and the run goes on to finish');
  const fr = await runsOf('Flaky');
  ok(fr.length === 1 && /try again/i.test(fr[0].note) && /Sent to/.test(fr[0].note), 'as one run, its note saying it tried again: ' + JSON.stringify(fr));
  ok((await posts()).filter((x) => x === 'Before the app: Flaky run').length === 1, 'the step before it isn’t done twice');
  ok((await posts()).length >= before + 1, '(posted)');

  const noticesBefore = (await rico('GET', '/notices')).body.length;
  await auto(rico, 'Down', { kind: 'campaign.started', projectId: p.id }, [{ kind: 'webhook', url: H + '/down' }]);
  await rico('POST', '/campaigns', { name: 'Down run', recordId: job.id });
  ok(await until(async () => got.filter((x) => x.path === '/down').length === 4, 8000), 'an app that stays down is tried 4 times in all (3 more): ' + got.filter((x) => x.path === '/down').length);
  ok(await until(async () => (await rico('GET', '/notices')).body.some((n) => n.title === 'Down' && /stopped/i.test(n.text))), 'then its maker is told it stopped: ' + JSON.stringify((await rico('GET', '/notices')).body.slice(0, 2)));
  await sleep(1500);
  ok(got.filter((x) => x.path === '/down').length === 4, 'and it’s not tried again after that');
  ok((await runsOf('Down')).length === 1 && !(await runsOf('Down'))[0].ok, 'one run, failed: ' + JSON.stringify(await runsOf('Down')));

  // A run that waited first, then hits an app that's down, is tried again too.
  await auto(rico, 'Waited', { kind: 'campaign.started', projectId: p.id }, [{ kind: 'wait', amount: 1, unit: 'minutes' }, { kind: 'webhook', url: H + '/flaky2' }]);
  await rico('POST', '/campaigns', { name: 'Waited run', recordId: job.id });
  ok(await until(async () => got.filter((x) => x.path === '/flaky2').length === 2, 8000), 'a run that waited, then found its app down, is tried again: ' + got.filter((x) => x.path === '/flaky2').length);
  ok(await until(async () => (await runsOf('Waited'))[0]?.ok), 'and finishes: ' + JSON.stringify(await runsOf('Waited')));

  await auto(rico, 'Bad', { kind: 'campaign.started', projectId: p.id }, [{ kind: 'webhook', url: H + '/bad' }]);
  await rico('POST', '/campaigns', { name: 'Bad run', recordId: job.id });
  ok(await until(async () => (await rico('GET', '/notices')).body.some((n) => n.title === 'Bad')), 'an app that says no (400) isn’t tried again, and its maker is told');
  await sleep(1500);
  ok(got.filter((x) => x.path === '/bad').length === 1, 'tried once: ' + got.filter((x) => x.path === '/bad').length);
  ok((await rico('GET', '/notices')).body.length > noticesBefore, '(noticed)');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  hook.close();
  if (fails) console.log(srv.log.slice(-3000));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
