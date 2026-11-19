// What a campaign step hands its people (2026-11-20): a call script or note written on the step, a doc, a file, a saved
// template, a link. Only the campaign's owner or an admin changes them; everyone with a task in the step sees them; bad
// links and another team's docs and templates are left off; a saved campaign keeps them when it runs again.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/stepres';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4917, B = `http://127.0.0.1:${PORT}`;
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
  let r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Res ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r0.body.token);
  const code = (await maria('GET', '/state')).body.workspace.inviteCode;
  r0 = await call()('POST', '/auth', { mode: 'join', workspace: 'Res ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r0.body.token);
  r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r0.body.token);

  const camp = (await maria('POST', '/campaigns', { name: 'Fall calls' })).body;
  let r = await maria('POST', '/goals', { campaignId: camp.id, title: 'Call last year’s customers' });
  const g = r.body;
  ok(r.status === 200 && !g.resources, 'a step starts with nothing to hand over');
  const doc = (await maria('POST', '/items', { type: 'text', doc: { title: 'Pricing sheet', blocks: [] } })).body;
  const tpl = (await maria('POST', '/msg-templates', { kind: 'email', name: 'Thanks for your time', subject: 'Thanks', body: 'Hi {customer}' })).body;
  const theirs = (await olga('POST', '/items', { type: 'text', doc: { title: 'Not yours', blocks: [] } })).body;
  r = await maria('PATCH', '/goals/' + g.id, { resources: [
    { kind: 'note', title: 'Call script', text: 'Hi, this is Maria from the shop.\r\nAsk about the windows.' },
    { kind: 'doc', itemId: doc.id }, { kind: 'template', tplId: tpl.id }, { kind: 'link', url: 'https://example.com/faq', title: 'FAQ' },
    { kind: 'link', url: 'javascript:alert(1)' }, { kind: 'doc', itemId: theirs.id }, { kind: 'bogus' } ] });
  const rs = r.body.resources || [];
  ok(r.status === 200 && rs.map((x) => x.kind).join() === 'note,doc,template,link', 'the owner adds a script, a doc, a template and a link (a bad link, another team’s doc and nonsense are left off): ' + rs.map((x) => x.kind).join());
  ok(rs[0].title === 'Call script' && rs[0].text === 'Hi, this is Maria from the shop.\nAsk about the windows.' && rs.every((x) => x.id), 'the script keeps its words (line breaks tidied), and each has an id');
  ok((await sam('PATCH', '/goals/' + g.id, { resources: [] })).status === 403, 'a member can’t change what a step hands over');
  ok((await sam('PATCH', '/goals/' + g.id, { title: 'Call last year’s customers' })).status === 200, '(a member still edits the step as before)');
  const seen = (await sam('GET', '/state')).body.goals?.find((x) => x.id === g.id);
  ok(seen && seen.resources?.length === 4, 'a member sees the step’s resources');
  // Saved, then run again: the resources come too.
  const tp = (await maria('POST', '/templates', { campaignId: camp.id, name: 'Fall calls', tz: 'America/Los_Angeles' })).body;
  r = await maria('POST', `/templates/${tp.id}/run`, { date: '2026-12-01' });
  ok(r.status === 200, 'the saved campaign runs again');
  const g2 = (await maria('GET', '/state')).body.goals.find((x) => x.campaignId === r.body.id);
  ok(g2 && g2.resources?.map((x) => x.kind).join() === 'note,doc,template,link' && g2.resources[0].text.startsWith('Hi, this is Maria'), 'and its step has the script, doc, template and link');
  // Taking one off.
  r = await maria('PATCH', '/goals/' + g.id, { resources: rs.filter((x) => x.kind !== 'link') });
  ok(r.body.resources.length === 3, 'the owner takes one off');
} catch (e) { ok(false, e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
