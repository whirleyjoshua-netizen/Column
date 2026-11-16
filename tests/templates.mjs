// Templates (Workspace → Tools → Templates, 2026-11-16): the team's emails, texts, replies and social posts to reuse.
// Anyone on the team makes one; only its maker or an owner or admin changes or deletes it; {words} stay as written;
// a text is kept to 1600 characters; bad kinds and empty ones are refused; it's one team's, never another's.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/templates';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4867, B = `http://127.0.0.1:${PORT}`;
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Tpl ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r.body.token);
  const code = (await maria('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Tpl ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r.body.token);

  r = await sam('POST', '/msg-templates', { kind: 'email', name: 'Quote follow-up', when: 'Three days after a quote with no answer', subject: 'Your quote for {record}', body: 'Hi {customer},\r\n\r\nJust checking in on the quote for {record}.' });
  ok(r.status === 200 && r.body.kind === 'email' && r.body.subject === 'Your quote for {record}' && r.body.body.includes('Hi {customer},\n\nJust') && r.body.by === 'Sam', 'anyone on the team makes a template; {words} stay as written');
  const fu = r.body;
  r = await maria('POST', '/msg-templates', { kind: 'text', name: 'On my way', subject: 'ignored', body: 'x'.repeat(2000) });
  ok(r.status === 200 && r.body.body.length === 1600 && r.body.subject === undefined, 'a text is kept to 1600 characters, with no subject');
  ok((await maria('POST', '/msg-templates', { kind: 'fax', name: 'Nope', body: 'x' })).status === 400, 'an unknown kind is refused');
  ok((await maria('POST', '/msg-templates', { kind: 'reply', name: 'Empty', body: '  ' })).status === 400, 'an empty one is refused');
  ok((await maria('POST', '/msg-templates', { kind: 'post', body: 'No name' })).status === 400, 'one without a name is refused');
  r = await maria('GET', '/msg-templates');
  ok(r.status === 200 && r.body.length === 2 && r.body[0].kind === 'email', 'the team sees its templates, emails first');
  ok((await olga('GET', '/msg-templates')).body.length === 0 && (await olga('GET', '/msg-templates/' + fu.id)).status === 404, 'another team sees none of them');
  r = await maria('PATCH', '/msg-templates/' + fu.id, { when: 'After a quote goes quiet' });
  ok(r.status === 200 && r.body.when === 'After a quote goes quiet', 'an owner can change anyone’s template');
  const mine = (await maria('GET', '/msg-templates')).body.find((x) => x.kind === 'text');
  ok((await sam('PATCH', '/msg-templates/' + mine.id, { name: 'Mine now' })).status === 403 && (await sam('DELETE', '/msg-templates/' + mine.id)).status === 403, 'a member can’t change or delete someone else’s');
  ok((await sam('PATCH', '/msg-templates/' + fu.id, { kind: 'post' })).body?.subject === undefined, 'turning an email into a post drops its subject');
  ok((await sam('DELETE', '/msg-templates/' + fu.id)).status === 200 && (await maria('GET', '/msg-templates')).body.length === 1, 'its maker can delete it');
} catch (e) { ok(false, e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
