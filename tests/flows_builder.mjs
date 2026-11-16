// The automation builder's server side: "Test it" walks an automation as it's being built, on the last real event
// of its kind (or a made-up one), and says the way it would go and what each step would do, without doing anything.
// It never uses something private or for owners only. Each run keeps the way it went (its path), for the builder.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_builder';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4977, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Build ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Build ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  const items = async () => (await rico('GET', '/state')).body.items.filter((x) => x.type === 'message').length;
  const flow = {
    name: 'Sort leads', trigger: { kind: 'contact.created' },
    actions: [
      { kind: 'if', when: [{ field: 'stage', op: 'is', value: 'Lead' }], then: [{ kind: 'post', text: 'New lead: {contact}', channelId: 'general' }], else: [{ kind: 'notify', text: '{contact} is in', to: ['owners'] }] },
      { kind: 'wait', amount: 2, unit: 'days' },
      { kind: 'task', text: 'Call {contact}', assignee: '', dueIn: 1, campaign: '' },
    ],
  };

  ok((await mo('POST', '/automations/test', flow)).status === 403, 'members can’t test automations');
  ok((await rico('POST', '/automations/test', { ...flow, actions: [] })).status === 400, 'one with no steps is refused, as saving it would be');

  // Nothing has happened yet: a made-up example.
  r = await rico('POST', '/automations/test', flow);
  ok(r.status === 200 && r.body.sample === true && /made-up example/.test(r.body.about), `with nothing to go on, it’s a made-up example (${r.body?.about})`);
  ok(r.body.path.join() === '0,0.else.0,1,2', `the way it would go: if → otherwise → wait → task (${r.body.path?.join()})`);
  const said = Object.fromEntries(r.body.steps.map((x) => [x.at, x.said]));
  ok(/^No: \{stage\} is Lead$/.test(said['0']) && r.body.steps[0].yes === false, 'the “only if” says no, and why');
  ok(said['0.else.0'] === 'Notify the owners: “Sample customer is in”' && said['1'] === 'Wait 2 days, then go on' && said['2'] === 'Make the task “Call Sample customer”', 'each step says what it would do, with the words filled in');

  // A real lead comes in: the test uses it.
  const before = await items();
  await rico('POST', '/contacts', { name: 'Ana Lead', stage: 'lead' });
  r = await rico('POST', '/automations/test', flow);
  ok(r.body.sample === false && /Ana Lead/.test(r.body.about), `now it’s about the last real one (${r.body.about})`);
  ok(r.body.path.join() === '0,0.then.0,1,2' && r.body.steps.find((x) => x.at === '0.then.0').said === 'Post “New lead: Ana Lead” in #general', 'which goes the other way: a lead, posted');
  await sleep(300);
  ok((await items()) === before && !(await rico('GET', '/automations')).body.length, 'testing did nothing: no post, nothing saved');

  // Something for owners only (the business's money) isn't used, and an event that doesn't match isn't either.
  await rico('POST', '/money', { kind: 'out', amount: 500, day: new Date().toISOString().slice(0, 10), scope: 'business', note: 'Ladder' });
  r = await rico('POST', '/automations/test', { name: 'Spend', trigger: { kind: 'money.added' }, actions: [{ kind: 'notify', text: '{amount} on {note}', to: ['owners'] }] });
  ok(r.body.sample === true && !JSON.stringify(r.body).includes('Ladder'), 'the business’s money (owners only) is never used to test');
  r = await rico('POST', '/automations/test', { ...flow, trigger: { kind: 'contact.created', stage: 'customer' } });
  ok(r.body.sample === true, 'an event that doesn’t match what it’s narrowed to isn’t used');

  // Saved and run: the run keeps its path.
  r = await rico('POST', '/automations', flow);
  await rico('POST', '/contacts', { name: 'Bo Other', stage: 'customer' });
  ok(await until(async () => (await rico('GET', '/automations')).body[0].runs?.[0]?.path?.join() === '0,0.else.0,1'), 'a run keeps the way it went (up to the wait)');
  const run = (await rico('GET', '/automations')).body[0].runs[0];
  ok(run.ok && /waits 2 days/.test(run.note), 'and its note as before');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
