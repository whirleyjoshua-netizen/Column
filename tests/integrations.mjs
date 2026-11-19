// Apps & Integrations registry (docs/INTEGRATIONS-MAP.md §1, the owner 2026-11-19: "make sure the integrations make
// sense and completely map out how they are connected, who has access"): GET /api/integrations answers for every app
// in one call; members see team connections as on/off only; a connection that breaks shows Needs attention, its
// connector is told once and connection.lost runs once; "Want this?" counts; automations that act through a team
// connection need an owner or admin, saved and run.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/integrations';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5310, FPORT = 5311, B = `http://127.0.0.1:${PORT}`, F = `http://127.0.0.1:${FPORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// A stand-in Postiz: takes the key until told not to.
let accept = true;
const fake = http.createServer((req, res) => {
  if (!accept || req.headers.authorization !== 'pz-good-key-123') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"msg":"no"}'); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(req.url.endsWith('/integrations') ? [{ id: 'ch1', name: 'Shop page', identifier: 'facebook', picture: '' }] : {}));
}).listen(FPORT);

const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', ALLOW_LOCAL_WEBHOOKS: '1', POSTIZ_URL: F + '/pz/public/v1', QBO_CLIENT_ID: '', QBO_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const until = async (f, ms = 6000) => { for (let i = 0; i < ms / 150; i++) { if (await f()) return true; await sleep(150); } return false; };
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Int ' + t, name: 'Jo Park', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  let st = (await jo('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Int ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  const samId = (await sam('GET', '/state')).body.me.memberId || (await jo('GET', '/state')).body.workspace.members.find((m) => m.name === 'Sam Reed').id;
  const app = (list, id) => list.apps.find((a) => a.id === id);

  // One call, every app.
  r = await jo('GET', '/integrations');
  ok(r.status === 200 && r.body.apps.length >= 20, `one call answers for every app (${r.body.apps?.length})`);
  let L = r.body;
  ok(app(L, 'quickbooks').state === 'na' && app(L, 'postiz').state === 'off' && app(L, 'notion').state === 'ready' && app(L, 'claude').state === 'off' && app(L, 'google-calendar').scope === 'person', 'QuickBooks isn’t set up on this server, Postiz is off, Notion is ready, your own Claude key isn’t there');
  r = await sam('GET', '/integrations');
  ok(r.status === 200 && app(r.body, 'postiz')?.state === 'off' && r.body.wants === undefined, 'a member gets the list too (no Want this? counts)');

  // Connected: owners see whose and when; members just "on".
  ok((await jo('PUT', '/postiz', { key: 'pz-good-key-123' })).status === 200, 'Jo connects Postiz');
  L = (await jo('GET', '/integrations')).body;
  ok(app(L, 'postiz').state === 'on' && app(L, 'postiz').by === 'Jo Park', 'Postiz is on, connected by Jo');
  let M = (await sam('GET', '/integrations')).body;
  ok(app(M, 'postiz').state === 'on' && app(M, 'postiz').by === undefined && app(M, 'postiz').error === undefined, 'Sam sees it on, and nothing more');

  // An automation on connection.lost.
  r = await jo('POST', '/automations', { name: 'Tell the team', trigger: { kind: 'connection.lost' }, actions: [{ kind: 'post', text: 'Lost: {app}', channelId: 'general' }] });
  ok(r.status === 200, 'an automation can start from “A connection is lost” ' + (r.status === 200 ? '' : JSON.stringify(r.body)));

  // It breaks: Postiz stops taking the key.
  accept = false;
  await jo('POST', '/postiz/refresh');
  L = (await jo('GET', '/integrations')).body;
  ok(app(L, 'postiz').state === 'error' && app(L, 'postiz').needsReconnect === true && /didn’t accept/.test(app(L, 'postiz').error), `Needs attention, with what’s wrong (${app(L, 'postiz').error})`);
  M = (await sam('GET', '/integrations')).body;
  ok(app(M, 'postiz').state === 'on' && !('error' in app(M, 'postiz')), 'a member isn’t shown the team connection’s trouble');
  const told = async () => (await jo('GET', '/notices')).body.filter((n) => /Postiz needs attention/.test(n.title));
  ok(await until(async () => (await told()).length === 1), 'Jo, who connected it, gets a notice');
  ok(!(await sam('GET', '/notices')).body.some((n) => /Postiz/.test(n.title)), 'Sam doesn’t');
  const posts = async () => (await jo('GET', '/state')).body.items.filter((it) => it.type === 'message' && /Lost: Postiz/.test(it.text || '')).length;
  ok(await until(async () => (await posts()) === 1), 'and connection.lost ran: “Lost: Postiz” in #general');
  await jo('POST', '/postiz/refresh');
  await jo('GET', '/integrations');
  await sleep(500);
  ok((await told()).length === 1 && (await told())[0].count == null && (await posts()) === 1, 'still broken: not told again, not run again');

  // Fixed: back on.
  accept = true;
  await jo('POST', '/postiz/refresh');
  L = (await jo('GET', '/integrations')).body;
  ok(app(L, 'postiz').state === 'on' && !app(L, 'postiz').needsReconnect, 'fixed, it’s Connected again');

  // Want this?
  r = await sam('POST', '/integrations/apps/slack/want', { name: 'Slack' });
  ok(r.status === 200 && r.body.wanted.includes('slack'), 'Sam asks for Slack');
  await sam('POST', '/integrations/apps/slack/want', { name: 'Slack' });
  await jo('POST', '/integrations/apps/slack/want', { name: 'Slack' });
  L = (await jo('GET', '/integrations')).body;
  ok(L.wants.slack === 2, `the owner sees 2 asked for Slack (once each): ${L.wants.slack}`);
  ok((await sam('POST', '/integrations/apps/postiz/want')).status === 400 && (await sam('POST', '/integrations/apps/Bad Name/want')).status === 400, 'only apps that aren’t here, by a plain id');
  ok((await sam('DELETE', '/integrations/apps/slack/want')).body.wanted.length === 0, 'and Sam can take it back');

  // Automations that act through a team connection: the maker is an owner or admin, saved and run.
  r = await sam('POST', '/automations', { name: 'Sam texts', trigger: { kind: 'contact.created' }, actions: [{ kind: 'text', text: 'Hi {contact}' }] });
  ok(r.status >= 400 && /owners and admins/.test(r.body.error), `a member can’t make an automation that texts through the team’s Twilio: “${r.body?.error}”`);
  await jo('PATCH', `/members/${samId}`, { role: 'admin' });
  r = await sam('POST', '/automations', { name: 'Sam texts', trigger: { kind: 'contact.created' }, actions: [{ kind: 'text', text: 'Hi {contact}' }] });
  ok(r.status === 200, 'an admin can');
  await jo('PATCH', `/members/${samId}`, { role: 'member' });
  await jo('POST', '/contacts', { name: 'Dana Fox', phone: '602 555 0101' });
  const runs = async () => (await jo('GET', '/automations')).body.find((x) => x.name === 'Sam texts')?.runs || [];
  ok(await until(async () => (await runs()).length > 0), 'it ran');
  const run = (await runs())[0];
  ok(run && !run.ok && /isn’t an owner or admin any more/.test(run.note || ''), `back to member, it’s refused when it runs: ${run?.note}`);
  ok(!(await jo('GET', '/approvals')).body.approvals.some((x) => /Text Dana/.test(x.summary)), 'and nothing waits for an OK');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
fake.close();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
