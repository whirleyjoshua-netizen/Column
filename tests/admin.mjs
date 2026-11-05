// Admins: between owner and member. They run the team day to day (people, Contacts, settings) but only
// owners delete the team, make owners, change other admins, export it all and keep the business's money.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/admin';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4788, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', ALLOW_LOCAL_WEBHOOKS: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  srv.exited = new Promise((r) => srv.on('exit', r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); }
  console.log(srv.log); process.exit(1);
};
const stop = async () => { srv.kill('SIGTERM'); await srv.exited; };
const call = (tok) => async (m, p, body, raw) => {
  const r = await fetch(B + p, { method: m, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const mails = () => { const o = DIR + '/outbox'; return fs.existsSync(o) ? fs.readdirSync(o).sort().map((f) => JSON.parse(fs.readFileSync(o + '/' + f, 'utf8'))) : []; };
const t = Date.now();
await start();
try {
  let r = await call()('POST', '/api/auth', { mode: 'create', workspace: 'Admins ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const J = call(r.body.token);
  const code = (await J('GET', '/api/state')).body.workspace.inviteCode;
  const join = async (name, n) => (await call()('POST', '/api/auth', { mode: 'join', workspace: 'Admins ' + t, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd' + n })).body;
  const kb = await join('Ken', 2), lb = await join('Lee', 3), mb = await join('Mo', 4);
  const K = call(kb.token), L = call(lb.token);
  const members = async () => (await J('GET', '/api/state')).body.workspace.members;
  const idOf = async (name) => (await members()).find((m) => m.name === name).id;
  const [ken, lee, mo, jo] = [await idOf('Ken'), await idOf('Lee'), await idOf('Mo'), await idOf('Jo')];

  // tools: a new team starts simple
  let tools = (await J('GET', '/api/state')).body.workspace.tools;
  ok(tools.docs && tools.contacts && tools.email && tools.signs && tools.folders && tools.sidekick && !tools.bills && !tools.map && !tools.vault && !tools.meetings && !tools.projects, 'a new team starts with a simple set of tools: ' + Object.keys(tools).filter((k) => tools[k]).join(', '));
  ok((await K('PATCH', '/api/workspace', { tools: { map: true } })).status === 403, 'a member can’t switch tools');
  r = await J('PATCH', '/api/workspace', { tools: { map: true, docs: false, nonsense: true } });
  ok(r.body.tools.map === true && r.body.tools.docs === false && r.body.tools.contacts === true && !('nonsense' in r.body.tools), 'an owner switches tools on and off; the rest stay as they were');
  await J('PATCH', '/api/workspace', { tools: { docs: true } });
  ok((await K('GET', '/api/contacts')).status === 403, 'a member can’t see Contacts');
  r = await J('PATCH', '/api/members/' + ken, { role: 'admin' });
  ok(r.status === 200 && r.body.members.find((m) => m.id === ken).role === 'admin', 'an owner makes someone an admin');
  ok((await J('PATCH', '/api/members/' + ken, { role: 'boss' })).status === 400, 'only owner, admin or member');

  // what an admin can do
  ok((await K('GET', '/api/contacts')).status === 200, 'an admin sees Contacts, straight away');
  ok((await K('POST', '/api/contacts', { name: 'Pat' })).status === 200, 'and adds to them');
  ok((await K('POST', '/api/invite')).status === 200, 'makes a new invite code');
  ok((await K('PATCH', '/api/brand', { mission: 'Shade for everyone' })).status === 200, 'changes the brand');
  ok((await K('PATCH', '/api/workspace', { tz: 'America/Chicago' })).status === 200, 'sets the time zone');
  ok((await K('PATCH', '/api/workspace', { memberEmail: true })).status === 200, 'lets members send campaign email');
  ok((await K('POST', '/api/roles', { name: 'Sales' })).status === 200, 'sets up roles (kinds of work)');
  r = await K('PATCH', '/api/members/' + lee, { role: 'admin' });
  ok(r.status === 200, 'makes a member an admin');
  ok((await K('PATCH', '/api/members/' + mo, { role: 'member' })).status === 200, 'looks after members');

  ok((await K('PATCH', '/api/workspace', { tools: { vault: true } })).body?.tools?.vault === true, 'switches tools on and off');

  // what an admin can't do
  ok((await K('PATCH', '/api/members/' + mo, { role: 'owner' })).status === 403, 'an admin can’t make an owner');
  ok((await K('PATCH', '/api/members/' + lee, { role: 'member' })).status === 403, 'or change another admin');
  ok((await K('DELETE', '/api/members/' + jo)).status === 403, 'or remove an owner');
  ok((await K('PATCH', '/api/members/' + ken, { role: 'owner' })).status === 400, 'or change themselves');
  ok((await K('POST', '/api/exports', { kind: 'team' })).status === 403, 'or export the whole team');
  ok((await K('POST', '/api/exports', { kind: 'mine' })).status === 200, 'but can export their own things');
  r = await K('POST', '/api/bills', { name: 'Rent', amount: 1000, due: '2026-12-01', scope: 'business' });
  ok(r.body?.scope === 'personal', 'or keep the business’s bills (theirs stays personal)');
  ok((await K('POST', '/api/workspace/delete', { name: 'Admins ' + t, password: 'longenough1' })).status === 403, 'or delete the team');

  // owners
  ok((await J('PATCH', '/api/members/' + lee, { role: 'member' })).status === 200, 'an owner changes admins back');
  r = await J('PATCH', '/api/members/' + mo, { role: 'owner' });
  ok(r.status === 200, 'and makes owners');
  ok((await J('PATCH', '/api/members/' + mo, { role: 'admin' })).status === 200, 'and can step another owner down while one is left');
  ok((await L('GET', '/api/contacts')).status === 403, 'a member again can’t see Contacts');
  ok((await J('DELETE', '/api/members/' + lee)).status === 200, 'owners remove people');
  ok((await K('DELETE', '/api/members/' + mo)).status === 403, 'an admin can’t remove another admin');
} finally {
  await stop().catch(() => {});
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
