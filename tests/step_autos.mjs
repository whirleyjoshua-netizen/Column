// Automations for one campaign step (2026-11-20): narrowed to a step by its name; a new "a task opens" event (what it
// waited for is done); Notify "whoever the task is for"; {done} (yes/no) for "only if it isn't done yet". A step's
// automation doesn't fire for another step's tasks.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/stepautos';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4943, B = `http://127.0.0.1:${PORT}`;
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
  let r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Aut ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r0.body.token);
  const code = (await maria('GET', '/state')).body.workspace.inviteCode;
  r0 = await call()('POST', '/auth', { mode: 'join', workspace: 'Aut ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r0.body.token);
  r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r0.body.token);

  const samId = (await sam('GET', '/state')).body.me.memberId;
  const camp = (await maria('POST', '/campaigns', { name: 'Window install' })).body;
  const quote = (await maria('POST', '/goals', { campaignId: camp.id, title: 'Quote' })).body;
  const install = (await maria('POST', '/goals', { campaignId: camp.id, title: 'Install' })).body;
  const a1 = (await maria('POST', '/tasks', { goalId: quote.id, text: 'Send the quote' })).body;
  const b1 = (await maria('POST', '/tasks', { goalId: install.id, text: 'Hang the blinds', assigneeId: samId, blockedBy: [a1.id] })).body;
  const mk = (name, trigger, actions) => maria('POST', '/automations', { name, on: true, trigger, actions });
  let r = await mk('Install: tell them when it opens', { kind: 'task.opened', campaignId: camp.id, step: 'install' }, [{ kind: 'notify', text: 'Your turn: {task} ({step})', to: ['doers'] }]);
  ok(r.status === 200 && r.body.trigger.step === 'install' && r.body.trigger.kind === 'task.opened', 'an automation can start when a task opens, narrowed to one step');
  const opens = r.body;
  r = await mk('Install: still open?', { kind: 'task.opened', campaignId: camp.id, step: 'Install' }, [{ kind: 'if', when: [{ field: 'done', op: 'is', value: 'no' }], then: [{ kind: 'notify', text: 'Still open: {task}', to: ['owners'] }], else: [] }]);
  ok(r.status === 200, '“only if {done} is no” is accepted');
  const ifNot = r.body;
  const wrong = (await mk('Install done: tell owners', { kind: 'task.done', campaignId: camp.id, step: 'Install' }, [{ kind: 'notify', text: '{task} done', to: ['owners'] }])).body;
  const quoteDone = (await mk('Quote done: tell owners', { kind: 'task.done', step: 'Quote' }, [{ kind: 'notify', text: '{who} finished {task} ({step})', to: ['owners'] }])).body;
  const stepDone = (await mk('Quote finished: post', { kind: 'step.done', step: 'Quote' }, [{ kind: 'post', text: '✅ {step} is finished', channelId: 'same' }])).body;
  ok((await mk('Bad step on a contact', { kind: 'contact.created', step: 'Quote' }, [{ kind: 'notify', text: 'x', to: ['owners'] }])).body?.trigger?.step == null, 'a step filter is dropped on events that aren’t about steps');
  // Maria finishes the quote: Sam's install task opens.
  ok((await maria('PATCH', '/tasks/' + a1.id, { done: true })).status === 200, 'Maria sends the quote');
  const runsOf = async (id) => { for (let i = 0; i < 30; i++) { const x = (await maria('GET', '/automations')).body.find((y) => y.id === id); if (x?.runs?.length) return x.runs; await sleep(100); } return []; };
  let runs = await runsOf(opens.id);
  ok(runs[0]?.ok && /Notified 1 person/.test(runs[0].did?.join(' ') || runs[0].log?.join(' ') || JSON.stringify(runs[0])), 'when Sam’s task opens, the Install automation notifies whoever it’s for: ' + JSON.stringify(runs[0]?.did || runs[0]?.log || runs[0]));
  const samBell = (await sam('GET', '/notices')).body;
  ok(samBell.some((n) => n.text === 'Your turn: Hang the blinds (Install)'), 'Sam gets “Your turn: Hang the blinds (Install)”');
  runs = await runsOf(ifNot.id);
  ok(JSON.stringify(runs[0] || {}).includes('Yes: {done} is no'), '{done} is “no” for a task that just opened: ' + JSON.stringify(runs[0]?.log || runs[0]));
  ok((await runsOf(quoteDone.id))[0]?.ok, 'the Quote step’s automation ran when its task was done');
  ok((await runsOf(stepDone.id))[0]?.ok, 'and its “step is finished” one too');
  const w = (await maria('GET', '/automations')).body.find((y) => y.id === wrong.id);
  ok(!w.runs?.length, 'the Install step’s “task done” automation didn’t fire for the Quote step’s task');
} catch (e) { ok(false, e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
