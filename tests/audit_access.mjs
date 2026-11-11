// Audit (access inside a team, docs/audit/FINDINGS.md): each check states the safe behaviour.
// B2  "clear" follows the same rule as deleting one thing: a member can't wipe someone else's messages.
// E5  making a webhook through the API is a write (read-only keys can't), and keys whose maker isn't an owner or admin
//     don't hear about contacts, invoices, payments or texts.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_access';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4907, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', ALLOW_LOCAL_WEBHOOKS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Acc ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Acc ' + t, code, name: 'Bob', email: `bob${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const bob = call(r.body.token);
  const bobId = (await jo('GET', '/state')).body.workspace.members.find((x) => x.name === 'Bob').id;

  // B2
  const owners = (await jo('POST', '/items', { type: 'message', text: 'OWNER-MSG' })).body;
  await bob('POST', '/items', { type: 'message', text: 'BOB-MSG' });
  ok((await bob('DELETE', '/items/' + owners.id)).status === 403, 'B2 (setup) Bob can’t delete the owner’s message directly');
  await bob('POST', '/clear');
  const texts = (await jo('GET', '/state')).body.items.filter((x) => x.type === 'message').map((x) => x.text);
  ok(texts.includes('OWNER-MSG'), 'B2 and “clear” doesn’t delete it either');
  ok(!texts.includes('BOB-MSG'), 'B2 his own message is cleared as before');

  // E5
  const ro = (await jo('POST', '/integrations/keys', { name: 'read only', write: false })).body.token;
  r = await call(ro)('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/hook', events: ['task.created'] });
  ok(r.status === 403, 'E5 a read-only key can’t make a webhook (that’s a write)');
  await jo('PATCH', '/members/' + bobId, { role: 'admin' });
  const bobKey = (await bob('POST', '/integrations/keys', { name: 'bob' })).body.token;
  await jo('PATCH', '/members/' + bobId, { role: 'member' });
  r = await call(bobKey)('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/hook', events: ['contact.created', 'invoice.paid'] });
  ok(r.status === 403, 'E5 a key whose maker is now a member can’t subscribe to contact or invoice events');
  r = await call(bobKey)('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/hook', events: ['task.created', 'contact.created'] });
  ok(r.status === 201 && r.body.events.includes('task.created') && !r.body.events.includes('contact.created'), 'E5 mixed: it gets the events it may hear, not the contact ones');
  const adminKey = (await jo('POST', '/integrations/keys', { name: 'jo' })).body.token;
  r = await call(adminKey)('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/hook', events: ['contact.created'] });
  ok(r.status === 201 && r.body.events.includes('contact.created'), 'E5 an owner’s key still can');

  // B3: nobody can hide the team's folders or files (or delete them by leaving) by moving them into a private folder.
  const st = async () => (await jo('GET', '/state')).body;
  await jo('PATCH', '/members/' + bobId, { role: 'member' });
  const mine = (await bob('POST', '/dirs', { name: 'Mine', private: true })).body;
  const mineId = mine.id ?? (await bob('GET', '/state')).body.workspace.dirs.find((x) => x.name === 'Mine')?.id;
  await jo('POST', '/dirs', { name: 'Team stuff' });
  const teamId = (await st()).workspace.dirs.find((x) => x.name === 'Team stuff').id;
  const jodoc = (await jo('POST', '/items', { type: 'text', text: 'JO-DOC', dirId: teamId })).body;
  r = await bob('PATCH', '/dirs/' + teamId, { parentId: mineId });
  ok(r.status === 403 && (await st()).workspace.dirs.some((x) => x.id === teamId && !x.parentId), 'B3 a member can’t move a team folder into their private folder');
  r = await bob('PATCH', '/items/' + jodoc.id, { dirId: mineId });
  ok(r.status === 403, 'B3 or someone else’s file');
  const bobdoc = (await bob('POST', '/items', { type: 'text', text: 'BOB-DOC', dirId: teamId })).body;
  r = await bob('PATCH', '/items/' + bobdoc.id, { dirId: mineId });
  ok(r.status === 200, 'B3 their own file they can move where they like');

  // E4/B5: private campaigns' tasks don't come out through the API (lists, by id) or webhooks.
  const priv = (await jo('POST', '/campaigns', { name: 'SECRET-CAMPAIGN', private: true })).body;
  const goal = (await jo('POST', '/goals', { campaignId: priv.id, title: 'Steps', kind: 'tasks' })).body;
  const secretTask = (await jo('POST', '/tasks', { goalId: goal.id, text: 'SECRET-TASK' })).body;
  await jo('POST', '/tasks', { text: 'OPEN-TASK' });
  const list = (await call(adminKey)('GET', '/v1/tasks?limit=100')).body;
  const texts2 = (list.data || []).map((x) => x.text || x.title);
  ok(texts2.includes('OPEN-TASK') && !texts2.includes('SECRET-TASK'), 'E4 the API’s task list leaves out private campaigns’ tasks');
  ok((await call(adminKey)('GET', '/v1/tasks/' + secretTask.id)).status === 404, 'E4 and won’t give one by id');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails && process.env.SHOWLOG) console.log(srv.log.slice(-2000));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
