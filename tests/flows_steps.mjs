// Flows, step 2: steps that decide and wait. "Only if" (with "otherwise") reads the words an event fills in; a wait
// is kept in the database and goes on later, after a restart too, reading what it's about fresh (a contact renamed
// while it waited is named as it is now; one deleted isn't there to change). Changing the steps drops what was waiting
// in the old ones; a waiting run can be stopped; one that would go on while the automation is off is dropped and
// logged; something that became private while it waited isn't acted on. Limits: 20 steps, "only if" 3 deep, waits
// up to 90 days. Still no loops. (Waits run 1000× faster here: FLOW_TIME_SCALE, SCHEDULE_TICK_MS, tests only.)
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_steps';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4896, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
let srv;
const start = async (scale = '0.001') => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', FLOW_TIME_SCALE: scale, SCHEDULE_TICK_MS: '150' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
};
const stop = async () => { const p = new Promise((r) => srv.on('exit', r)); srv.kill(); await p; };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  await start();
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Steps ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const feed = async (name) => { const w = (await rico('POST', '/channels', { name })).body; return (w.channels || w.workspace?.channels || []).find((c) => c.name === name)?.id; };
  const posts = async (f) => (await rico('GET', '/state')).body.items.filter((x) => x.type === 'message' && x.channelId === f).map((x) => x.text);
  const post = (text, ch) => ({ kind: 'post', text, channelId: ch });
  const make = (name, trigger, actions) => rico('POST', '/automations', { name, trigger, actions });

  // Only if / otherwise.
  const f1 = await feed('decide');
  r = await make('Leads or not', { kind: 'contact.created' }, [{ kind: 'if', when: [{ field: 'stage', op: 'is', value: 'Lead' }], then: [post('Lead: {contact}', f1)], else: [post('Not a lead: {contact} ({stage})', f1)] }, post('Either way: {contact}', f1)]);
  ok(r.status === 200 && r.body.actions[0].kind === 'if', 'an automation with “only if” and “otherwise” is saved');
  await rico('POST', '/contacts', { name: 'Ana Lead', stage: 'lead' });
  await rico('POST', '/contacts', { name: 'Bo Customer', stage: 'customer' });
  ok(await until(async () => { const p = await posts(f1); return p.includes('Lead: Ana Lead') && p.includes('Not a lead: Bo Customer (Customer)') && p.filter((x) => x.startsWith('Either way')).length === 2; }), 'each contact goes the right way, and both go on to the step after');
  ok(!(await posts(f1)).includes('Lead: Bo Customer') && !(await posts(f1)).includes('Not a lead: Ana Lead (Lead)'), 'and never both ways');
  const log = (await rico('GET', '/automations')).body.find((x) => x.name === 'Leads or not').runs[0].note;
  ok(/^No: \{stage\} is Lead · Posted/.test(log) || /^Yes: \{stage\} is Lead · Posted/.test(log), `the run log says how it decided (${log})`);

  // A wait: it goes on later, about the contact as it is then.
  const f2 = await feed('wait');
  await make('Follow up', { kind: 'contact.created' }, [post('Hello {contact}', f2), { kind: 'wait', amount: 3, unit: 'minutes' }, post('Still there, {contact}?', f2)]);
  const c = (await rico('POST', '/contacts', { name: 'Cy Wait' })).body;
  ok(await until(async () => (await posts(f2)).includes('Hello Cy Wait')), 'the steps before a wait run at once');
  const a2 = (await rico('GET', '/automations')).body.find((x) => x.name === 'Follow up');
  ok(a2.waiting === 1 && (await rico('GET', `/automations/${a2.id}/waits`)).body[0]?.about === 'Cy Wait', 'one run is waiting, about Cy');
  await rico('PATCH', `/contacts/${c.id}`, { name: 'Cyrus Wait' });
  ok(await until(async () => (await posts(f2)).includes('Still there, Cyrus Wait?'), 10000), 'after the wait it goes on, with the contact’s name as it is now');
  ok((await rico('GET', '/automations')).body.find((x) => x.name === 'Follow up').runs[0].note.startsWith('After waiting: Posted'), 'and logs it');

  // A wait across a restart (waits at real speed here, so it's still waiting when the server stops).
  await stop();
  await start('0.0005');
  await rico('POST', '/contacts', { name: 'Di Restart' });
  ok(await until(async () => (await posts(f2)).includes('Hello Di Restart')), '(setup) another one waiting');
  await stop();
  await start('0.0005');
  ok(await until(async () => (await posts(f2)).includes('Still there, Di Restart?'), 10000), 'a wait goes on after a restart');

  // Gone while it waited.
  const f3 = await feed('gone');
  await make('Tag later', { kind: 'contact.created' }, [{ kind: 'wait', amount: 5, unit: 'minutes' }, { kind: 'contact', tag: 'followed-up' }, post('Tagged {contact}', f3)]);
  const g = (await rico('POST', '/contacts', { name: 'Ed Gone' })).body;
  await rico('DELETE', `/contacts/${g.id}`);
  ok(await until(async () => (await rico('GET', '/automations')).body.find((x) => x.name === 'Tag later').runs?.[0]?.note.includes('No contact to change')), 'a contact deleted while it waited isn’t there to change (and it says so)');

  // Changing the steps drops what was waiting; stopping one; off when it would go on.
  const f4 = await feed('drop');
  const a4 = (await make('Long wait', { kind: 'contact.created' }, [{ kind: 'wait', amount: 60, unit: 'days' }, post('never {contact}', f4)])).body;
  await rico('POST', '/contacts', { name: 'Fay One' });
  await rico('POST', '/contacts', { name: 'Gus Two' });
  ok(await until(async () => (await rico('GET', `/automations/${a4.id}/waits`)).body.length === 2), '(setup) two runs waiting 60 days');
  const w = (await rico('GET', `/automations/${a4.id}/waits`)).body[0];
  ok((await rico('DELETE', `/automations/${a4.id}/waits/${w.id}`)).status === 200 && (await rico('GET', `/automations/${a4.id}/waits`)).body.length === 1, 'a waiting run can be stopped');
  await rico('PATCH', `/automations/${a4.id}`, { actions: [{ kind: 'wait', amount: 30, unit: 'days' }, post('changed {contact}', f4)] });
  const a4b = (await rico('GET', '/automations')).body.find((x) => x.id === a4.id);
  ok(a4b.waiting === 0 && /1 waiting run was dropped: the steps changed/.test(a4b.runs[0].note), 'changing the steps drops what was waiting in the old ones, and says so');
  const f5 = await feed('off');
  const a5 = (await make('Turned off', { kind: 'contact.created' }, [{ kind: 'wait', amount: 2, unit: 'minutes' }, post('should not {contact}', f5)])).body;
  await rico('POST', '/contacts', { name: 'Hal Off' });
  await rico('PATCH', `/automations/${a5.id}`, { on: false });
  ok(await until(async () => /dropped: it was off/.test((await rico('GET', '/automations')).body.find((x) => x.id === a5.id).runs?.[0]?.note || '')) && !(await posts(f5)).length, 'a run due while it’s off is dropped and logged, nothing done');

  // Private by the time it would go on.
  const f6 = await feed('privnow');
  const camp = (await rico('POST', '/campaigns', { name: 'Open job' })).body;
  const goal = (await rico('POST', '/goals', { campaignId: camp.id, title: 'Steps', kind: 'tasks' })).body;
  await make('Later post', { kind: 'task.done' }, [{ kind: 'wait', amount: 3, unit: 'minutes' }, post('LEAK {task}', f6)]);
  const tk = (await rico('POST', '/tasks', { goalId: goal.id, text: 'Secret step' })).body;
  await rico('PATCH', `/tasks/${tk.id}`, { done: true });
  await rico('PATCH', `/campaigns/${camp.id}`, { private: true });
  ok(await until(async () => /private now/.test((await rico('GET', '/automations')).body.find((x) => x.name === 'Later post').runs?.[0]?.note || '')) && !(await posts(f6)).length, 'something made private while it waited isn’t acted on');

  // Limits.
  const many = Array.from({ length: 21 }, () => post('x', f1));
  ok((await make('Too many', { kind: 'contact.created' }, many)).status === 400, 'at most 20 steps');
  const deep = { kind: 'if', when: [{ field: 'stage', op: 'set' }], then: [{ kind: 'if', when: [{ field: 'stage', op: 'set' }], then: [{ kind: 'if', when: [{ field: 'stage', op: 'set' }], then: [{ kind: 'if', when: [{ field: 'stage', op: 'set' }], then: [post('x', f1)] }] }] }] };
  ok((await make('Too deep', { kind: 'contact.created' }, [deep])).status === 400, '“only if” 3 deep at most');
  ok((await make('Too long', { kind: 'contact.created' }, [{ kind: 'wait', amount: 91, unit: 'days' }, post('x', f1)])).status === 400, 'a wait of 91 days is refused');
  ok((await make('Only waits', { kind: 'contact.created' }, [{ kind: 'wait', amount: 1, unit: 'days' }])).status === 400, 'an automation must do something');

  // Still no loops: a task it makes after a wait doesn't set off "task made" automations.
  const f7 = await feed('loops');
  await make('Makes tasks', { kind: 'task.created' }, [{ kind: 'wait', amount: 1, unit: 'minutes' }, { kind: 'task', text: 'Follow-up for {task}', assignee: '' }]);
  await make('Counts tasks', { kind: 'task.created' }, [post('made {task}', f7)]);
  await rico('POST', '/tasks', { text: 'Start' });
  await sleep(2500);
  const made = (await rico('GET', '/state')).body.tasks.filter((x) => x.text.startsWith('Follow-up for'));
  ok(made.length === 1 && JSON.stringify(await posts(f7)) === JSON.stringify(['made Start']), 'what it does after a wait sets nothing off (no loops)');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log('Server log:\n' + srv?.log.slice(-3000));
  srv?.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
