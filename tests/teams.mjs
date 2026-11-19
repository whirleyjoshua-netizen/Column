// Microsoft Teams (teams.js): a team pastes a Teams Workflows address; Kloomie posts there. Checked against a stand-in
// Teams (never the real one): only owners/admins connect, test and disconnect; the address is sealed and never sent
// back; a real hello post checks it; automations made by owners/admins post with {words} filled in (a member's can't);
// people post (their AI team's yes) through /api/teams/post; words can't become a link; Teams refusing the address
// means Needs attention, cleared by the next good post; at most 60 posts an hour; the agents have a draft tool that
// waits for a yes; only real Teams addresses are taken.
import fs from 'node:fs';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { checkTeamsUrl } from '../server/teams.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/teams';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const FAKE = 5320, PORT = 5321, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };

// The stand-in Teams: takes posts at /workflows/good, answers what `mode` says.
const got = [];
let mode = 202;
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    if (req.url.startsWith('/workflows/good')) { if (mode < 300) got.push(JSON.parse(raw)); res.writeHead(mode); return res.end(); }
    res.writeHead(404); res.end();
  });
}).listen(FAKE);
const HOOK = `http://127.0.0.1:${FAKE}/workflows/good/triggers/manual/paths/invoke?sig=SECRETSIG123`;
const textOf = (p) => p?.attachments?.[0]?.content?.body?.map((b) => b.text).join(' | ') || '';

const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', ALLOW_LOCAL_WEBHOOKS: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  // Only real Teams addresses (the server here takes local ones, for the stand-in).
  const takes = (u) => { try { checkTeamsUrl(u); return true; } catch { return false; } };
  ok(takes('https://prod-12.westus.logic.azure.com:443/workflows/a/triggers/manual/paths/invoke?sig=x') && takes('https://default1.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/a'), 'a Teams Workflows address is taken (Logic Apps or Power Automate)');
  ok(!takes('https://evil.example/hook') && !takes('https://logic.azure.com.evil.example/x') && !takes('http://prod-1.westus.logic.azure.com/x') && !takes('not a url'), 'anything else isn’t (another site, a look-alike, plain http)');

  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Teams ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const joTok = r.body.token, jo = call(joTok), code = r.body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Teams ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);

  ok((await sam('PUT', '/teams', { url: HOOK })).status === 403, 'a member can’t connect Teams');
  r = await jo('PUT', '/teams', { url: `http://127.0.0.1:${FAKE}/workflows/missing`, channel: 'Office › Jobs' });
  ok(r.status === 400 && /refused/.test(r.body.error), 'an address Teams refuses isn’t kept: ' + r.body?.error);
  ok(!(await jo('GET', '/teams')).body.connected, '(so it isn’t connected)');
  r = await jo('PUT', '/teams', { url: HOOK, channel: 'Office › Jobs' });
  ok(r.status === 200 && r.body.connected && r.body.channel === 'Office › Jobs', 'an owner connects it');
  ok(/Kloomie is connected to Office › Jobs/.test(textOf(got[0])) && got[0].attachments[0].contentType === 'application/vnd.microsoft.card.adaptive', 'and a hello goes to the channel first, as an Adaptive Card');
  await sleep(2500);
  ok(!fs.readFileSync(DIR + '/db.json', 'utf8').includes('SECRETSIG123'), 'the address (its signature) is stored sealed');
  ok(!JSON.stringify((await jo('GET', '/teams')).body).includes('SECRETSIG') && !JSON.stringify((await jo('GET', '/integrations')).body).includes('SECRETSIG'), 'and never sent back, not even to the owner');
  r = await sam('GET', '/teams');
  ok(r.body.connected && r.body.by === undefined && r.body.posts === undefined, 'a member sees only that it’s connected');
  ok((await sam('POST', '/teams/test')).status === 403 && (await sam('DELETE', '/teams')).status === 403, 'and can’t test or disconnect it');
  r = await jo('POST', '/teams/test');
  ok(r.status === 200 && /Test from Kloomie/.test(textOf(got.at(-1))) && /Sent by Jo/.test(textOf(got.at(-1))), 'Send a test posts, saying who sent it');

  // Automations: owners and admins only; {words} filled in; words can't become a link.
  r = await sam('POST', '/automations', { name: 'Lead to Teams', trigger: { kind: 'contact.created' }, actions: [{ kind: 'teams', op: 'post', text: 'New lead: {contact}' }] });
  ok([400, 403].includes(r.status) && /owners and admins/i.test(r.body.error), 'a member’s automation can’t post to Teams: ' + r.body?.error);
  r = await jo('POST', '/automations', { name: 'Lead to Teams', trigger: { kind: 'contact.created' }, actions: [{ kind: 'teams', op: 'post', text: 'New lead: {contact}' }] });
  ok(r.status === 200 && r.body.actions[0].kind === 'teams' && r.body.actions[0].op === 'post', 'an owner’s can');
  const n0 = got.length;
  await jo('POST', '/contacts', { name: 'Ana [click](https://evil.example)' });
  ok(await until(() => got.length > n0 && /New lead: Ana/.test(textOf(got.at(-1)))), 'a new contact posts “New lead: …” to Teams');
  ok(!textOf(got.at(-1)).includes('](https://evil'), 'and a name can’t become a link: ' + textOf(got.at(-1)));
  ok(/Automation: Lead to Teams/.test(textOf(got.at(-1))), 'the post says which automation sent it');

  // Made by an admin who's then made a member: it doesn't post any more (checked when it runs).
  const samId = (await sam('GET', '/state')).body.me?.memberId || (await jo('GET', '/state')).body.workspace.members.find((m) => m.name === 'Sam').id;
  await jo('PATCH', '/members/' + samId, { role: 'admin' });
  r = await sam('POST', '/automations', { name: 'Sam to Teams', trigger: { kind: 'task.created' }, actions: [{ kind: 'teams', op: 'post', text: 'Task: {task}' }] });
  ok(r.status === 200, '(setup) Sam, an admin, makes a Teams automation');
  const samAuto = r.body.id;
  await jo('PATCH', '/members/' + samId, { role: 'member' });
  const n1 = got.length;
  await jo('POST', '/tasks', { text: 'Order shingles' });
  await sleep(1500);
  const runs = (await jo('GET', '/automations')).body.find((x) => x.id === samAuto)?.runs || [];
  ok(got.length === n1 || !got.slice(n1).some((p) => /Order shingles/.test(textOf(p))), 'once Sam is a member again, it doesn’t post' + (runs[0] ? ` (${runs[0].note || runs[0].error || JSON.stringify(runs[0]).slice(0, 120)})` : ''));

  // A person's post (what their AI team drafted and they said yes to).
  // By hand (and through their AI team, which runs as them): owners and admins, unless an admin lets everyone.
  r = await sam('POST', '/teams/post', { text: 'Anything I like' });
  ok(r.status === 403 && !got.some((p) => /Anything I like/.test(textOf(p))), 'a member can’t post to the shared channel by default');
  ok((await sam('GET', '/teams')).body.canPost === false, '(their tile says so)');
  ok((await sam('PATCH', '/teams', { who: 'everyone' })).status === 403, 'and can’t change who may');
  r = await jo('PATCH', '/teams', { who: 'everyone' });
  ok(r.status === 200 && r.body.who === 'everyone', 'an owner lets everyone post');
  r = await sam('POST', '/teams/post', { text: 'Truck 2 is back at the shop.' });
  ok(r.status === 200 && /Truck 2/.test(textOf(got.at(-1))) && /From Sam in Kloomie/.test(textOf(got.at(-1))), 'then a member’s yes posts, saying it’s from them');
  ok((await sam('POST', '/teams/post', { text: '   ' })).status === 400, 'an empty post isn’t sent');
  const mineCodes = [];
  for (let i = 0; i < 11; i++) mineCodes.push((await sam('POST', '/teams/post', { text: 'm' + i })).status);
  ok(mineCodes.filter((c) => c === 200).length <= 10 && mineCodes.at(-1) === 429, `one person posts at most 10 an hour (${mineCodes.slice(-2).join(',')})`);

  // A filled-in word can't take over a post.
  r = await jo('POST', '/automations', { name: 'Task to Teams', trigger: { kind: 'task.created' }, actions: [{ kind: 'teams', op: 'post', text: 'Task: {task}' }] });
  const n2 = got.length;
  await jo('POST', '/tasks', { text: 'X'.repeat(900) });
  ok(await until(() => got.slice(n2).some((p) => /^Task: X/.test(textOf(p)))), '(setup) a task posts');
  const long = got.slice(n2).map(textOf).find((x) => /^Task: X/.test(x)) || '';
  ok((long.match(/X/g) || []).length <= 200, `each filled-in word is cut to 200 characters (${(long.match(/X/g) || []).length})`);
  await jo('DELETE', '/automations/' + r.body.id);

  // Teams refusing the address: Needs attention, then fixed by the next good post.
  mode = 404;
  r = await jo('POST', '/teams/test');
  ok(r.status === 400, 'when Teams refuses the address, the test says so');
  r = await jo('GET', '/teams');
  ok(r.body.needsReconnect === true, 'and the tile says it needs connecting again');
  let reg = (await jo('GET', '/integrations')).body.apps.find((x) => x.id === 'teams');
  ok(reg?.state === 'error' && reg.needsReconnect === true, 'the registry shows Needs attention: ' + JSON.stringify(reg));
  mode = 202;
  await jo('POST', '/teams/test');
  reg = (await jo('GET', '/integrations')).body.apps.find((x) => x.id === 'teams');
  ok(reg?.state === 'on' && !reg.needsReconnect && (await jo('GET', '/teams')).body.needsReconnect === false, 'the next good post clears it');

  // The agents' draft tool, which waits for a yes.
  const ag = (await sam('GET', '/agents')).body.agents;
  ok(Object.values(ag).every((a) => a.tools.some((x) => x.key === 'draft_teams_post' && x.important)), 'every agent can draft a Teams post, and it waits for a yes');

  // The team's export says Teams was connected, never its address.
  r = await jo('POST', '/exports', { kind: 'team' });
  let ex = null;
  for (let i = 0; i < 60 && !(ex && ex.status !== 'building'); i++) { await sleep(250); ex = (await jo('GET', '/exports')).body.exports.find((y) => y.kind === 'team'); }
  const zip = DIR + '/team.zip';
  fs.writeFileSync(zip, Buffer.from(await (await fetch(`${B}/api/exports/${ex.id}/file`, { headers: { authorization: 'Bearer ' + joTok } })).arrayBuffer()));
  const all = execFileSync('unzip', ['-p', zip]).toString();
  ok(/"app":\s*"teams"/.test(all) && !all.includes('SECRETSIG'), 'the team export lists Teams as connected, without its address');

  // At most 60 posts an hour for the team (automations, tests and people together).
  const codes = [];
  for (let i = 0; i < 60; i++) codes.push((await jo('POST', '/teams/test')).status);
  ok(codes.includes(429), `at most 60 posts an hour a team (${codes.filter((c) => c === 200).length} more went, then ${codes.at(-1)})`);

  ok((await jo('DELETE', '/teams')).status === 200 && !(await jo('GET', '/teams')).body.connected, 'an owner disconnects it');
  r = await jo('POST', '/automations', { name: 'x', trigger: { kind: 'contact.created' }, actions: [{ kind: 'teams', op: 'post', text: 'hi' }] });
  ok(r.status === 400 && /Connect Microsoft Teams/.test(r.body.error), 'with Teams off, a Teams step asks to connect it first');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
