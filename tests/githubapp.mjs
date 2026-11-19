// GitHub for the whole team (the owner, 2026-11-19: "why can't we have a general connection to GitHub, and see the
// latest pushes and commits in the daily Home report?"). An owner connects once: GitHub's install page, pick the
// repositories, back to Kloomie. Kloomie checks the installation really is one the person can reach (so nobody can
// attach someone else's), lists its repositories, and from then on GitHub's signed deliveries for those repositories
// fill the team's code log: pushes, pull requests opened and merged, releases. Who sees the log is the owners' choice
// (people who can see a software board, or everyone); members who can't, can't read it. Automations can start from
// it, a software board can follow a repository without its own webhook, and an agent can read it.
import './cookiejar.mjs';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/githubapp';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5300, B = `http://127.0.0.1:${PORT}`, F_PORT = 5301, F = `http://127.0.0.1:${F_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(120); } return false; };

// ---------- a stand-in for GitHub (the website and the API) ----------
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const HOOK_SECRET = 'whsec-test-123';
const G = { installs: { 77: { account: { login: 'atlas', type: 'Organization' }, repos: ['atlas/web', 'atlas/api'] }, 88: { account: { login: 'someone-else', type: 'User' }, repos: ['else/secret'] } }, userSees: [77], jwtOk: 0, jwtBad: 0 };
const b64u = (s) => Buffer.from(s, 'base64url');
const fake = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const u = new URL(req.url, F);
  const out = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (u.pathname === '/login/oauth/access_token' && req.method === 'POST') {
    const f = JSON.parse(raw || '{}');
    if (f.client_id !== 'Iv1.test' || f.client_secret !== 'csecret') return out(401, { error: 'bad_client' });
    return out(200, f.code === 'good' ? { access_token: 'user-tok', token_type: 'bearer' } : { error: 'bad_verification_code' });
  }
  if (u.pathname === '/user/installations') {
    if (bearer !== 'user-tok') return out(401, {});
    return out(200, { total_count: G.userSees.length, installations: G.userSees.map((id) => ({ id, account: G.installs[id].account })) });
  }
  const at = u.pathname.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
  if (at && req.method === 'POST') {
    const [h, p, s] = bearer.split('.');
    const good = !!s && crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), publicKey, b64u(s)) && JSON.parse(b64u(p)).iss === '12345';
    if (!good) { G.jwtBad++; return out(401, { message: 'bad jwt' }); }
    G.jwtOk++;
    return out(201, { token: 'inst-' + at[1], expires_at: new Date(Date.now() + 3600e3).toISOString() });
  }
  if (u.pathname === '/installation/repositories') {
    const id = bearer.replace(/^inst-/, '');
    if (!G.installs[id]) return out(401, {});
    return out(200, { total_count: G.installs[id].repos.length, repositories: G.installs[id].repos.map((full_name, i) => ({ id: i + 1, full_name, private: true })) });
  }
  return out(404, {});
});
await new Promise((r) => fake.listen(F_PORT, '127.0.0.1', r));

const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', GITHUB_API: F, GITHUB_WEB: F,
  GITHUB_APP_ID: '12345', GITHUB_APP_SLUG: 'kloomie-test', GITHUB_APP_CLIENT_ID: 'Iv1.test', GITHUB_APP_CLIENT_SECRET: 'csecret', GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, '\\n'), GITHUB_APP_WEBHOOK_SECRET: HOOK_SECRET };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sign = (raw, secret = HOOK_SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
const deliver = async (event, body, secret) => {
  const raw = JSON.stringify(body);
  const r = await fetch(B + '/api/github/app/hook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': crypto.randomUUID(), 'x-hub-signature-256': sign(raw, secret) }, body: raw });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Atlas ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Atlas ' + t, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token);
  const ben = await join('Ben', 2);

  // ---------- connecting ----------
  r = await ada('GET', '/github/app');
  ok(r.status === 200 && r.body.configured === true && r.body.connected === false, 'GitHub shows as ready to connect');
  ok((await ben('POST', '/github/app/connect')).status === 403, 'members can’t connect it');
  r = await ada('POST', '/github/app/connect');
  const go = new URL(r.body.url);
  const st = go.searchParams.get('state');
  ok(go.origin + go.pathname === F + '/apps/kloomie-test/installations/new' && st, 'Connect sends the owner to GitHub’s install page for Kloomie');
  ok(/expired/i.test(await (await fetch(`${B}/oauth/github/callback?code=good&installation_id=77&setup_action=install&state=made-up`)).text()), 'a made-up state is refused');
  // Someone tries to attach an installation they can't reach (another account's): refused.
  r = await ada('POST', '/github/app/connect');
  const st2 = new URL(r.body.url).searchParams.get('state');
  let cb = await fetch(`${B}/oauth/github/callback?code=good&installation_id=88&setup_action=install&state=${st2}`, { redirect: 'manual' });
  ok(cb.status === 302 && /r=notyours/.test(cb.headers.get('location')), 'an installation the person can’t reach on GitHub is refused');
  ok((await ada('GET', '/github/app')).body.connected === false, 'and nothing is connected');
  cb = await fetch(`${B}/oauth/github/callback?code=good&installation_id=77&setup_action=install&state=${st}`, { redirect: 'manual' });
  ok(cb.status === 302 && /r=connected/.test(cb.headers.get('location')), 'GitHub comes back and it’s connected: ' + cb.headers.get('location'));
  ok(/expired/i.test(await (await fetch(`${B}/oauth/github/callback?code=good&installation_id=77&setup_action=install&state=${st}`)).text()), 'the same link can’t be used twice');
  ok(/connected/i.test(await (await fetch(B + cb.headers.get('location'))).text()), 'the done page says it’s connected');
  r = await ada('GET', '/github/app');
  ok(r.body.connected && r.body.account === 'atlas' && r.body.repos.join() === 'atlas/web,atlas/api', 'Ada sees the account and its repositories: ' + JSON.stringify(r.body));
  ok(G.jwtOk >= 1 && G.jwtBad === 0, 'Kloomie asked GitHub as the app, with a signed token');
  await until(() => { try { return fs.readFileSync(DIR + '/db.json', 'utf8').includes('atlas/api'); } catch { return false; } });
  const saved = fs.readFileSync(DIR + '/db.json', 'utf8');
  ok(saved.includes('atlas/api') && !saved.includes('user-tok') && !saved.includes('inst-77'), 'no GitHub token is written down');

  // ---------- deliveries ----------
  const repo = { full_name: 'atlas/web', html_url: 'https://github.com/atlas/web' };
  const push = { ref: 'refs/heads/main', after: 'c0ffee1234', compare: 'https://github.com/atlas/web/compare/a...b', installation: { id: 77 }, repository: repo, pusher: { name: 'ada-dev' }, sender: { login: 'ada-dev' },
    commits: [{ id: 'aaa1111', message: 'Add the back bar\n\nmore', url: 'https://github.com/atlas/web/commit/aaa1111', author: { username: 'ada-dev' } }, { id: 'bbb2222', message: 'Esc goes back', url: 'https://github.com/atlas/web/commit/bbb2222', author: { username: 'ada-dev' } }],
    head_commit: { id: 'bbb2222', message: 'Esc goes back' } };
  ok((await deliver('push', push, 'wrong')).status === 401, 'a delivery without GitHub’s signature is refused');
  r = await deliver('push', push);
  ok(r.status === 200, 'a signed push is taken');
  await deliver('push', push); // GitHub retries: still once
  r = await ada('GET', '/github/code?days=7');
  const ev = r.body.events || [];
  ok(ev.length === 1 && ev[0].kind === 'push' && ev[0].repo === 'atlas/web' && ev[0].branch === 'main' && ev[0].n === 2 && ev[0].text === 'Esc goes back' && ev[0].commits.length === 2, 'the push is in the code log, once: ' + JSON.stringify(ev[0]));
  const pr = (action, merged) => ({ action, installation: { id: 77 }, repository: repo, sender: { login: 'ben-dev' }, pull_request: { number: 9, title: 'Apps back bar', html_url: 'https://github.com/atlas/web/pull/9', user: { login: 'ben-dev' }, merged: !!merged, merged_by: merged ? { login: 'ada-dev' } : null, state: action === 'closed' ? 'closed' : 'open', head: { ref: 'back-bar' } } });
  await deliver('pull_request', pr('opened'));
  await deliver('pull_request', pr('closed', true));
  await deliver('release', { action: 'published', installation: { id: 77 }, repository: repo, sender: { login: 'ada-dev' }, release: { tag_name: 'v2.4.0', name: 'Spring', html_url: 'https://github.com/atlas/web/releases/v2.4.0', author: { login: 'ada-dev' } } });
  await deliver('push', { ...push, installation: { id: 88 }, repository: { full_name: 'else/secret' }, after: 'zzz' });
  r = await ada('GET', '/github/code?days=7');
  const kinds = r.body.events.map((e) => e.kind).join();
  ok(kinds === 'released,merged,pr_opened,push', 'pull request opened, merged, and the release are logged, newest first: ' + kinds);
  ok(!JSON.stringify(r.body).includes('else/secret'), 'another installation’s deliveries don’t reach this team');

  // ---------- who sees it ----------
  ok((await ben('GET', '/github/code?days=7')).status === 403, 'Ben (no software board) can’t read the code log');
  ok((await ben('GET', '/github/app')).body.canSee === false && !(await ben('GET', '/github/app')).body.repos, 'and doesn’t get the repositories');
  const p = (await ada('POST', '/projects', { template: 'tech', name: 'Atlas Web' })).body;
  ok((await ben('GET', '/github/code?days=7')).status === 200, 'once he can see a software board, he can');
  await ada('PATCH', '/github/app', { who: 'admins' });
  ok((await ben('GET', '/github/code?days=7')).status === 403, 'owners can keep it to owners and admins');
  ok((await ben('PATCH', '/github/app', { who: 'all' })).status === 403, 'members can’t change who sees it');
  await ada('PATCH', '/github/app', { who: 'all' });
  ok((await ben('GET', '/github/code?days=7')).status === 200, 'or open it to everyone');

  // ---------- a software board follows a repository ----------
  const work = p.types.find((x) => x.key === 'work');
  const F2 = (k) => work.fields.find((x) => x.key === k);
  const rec = (await ada('POST', `/projects/${p.id}/records`, { typeId: work.id, values: { title: 'Back bar', status: F2('status').choices.find((c) => c.label === 'In progress').id } })).body;
  const key = rec.values[F2('key')?.id] || rec.values[work.fields.find((f) => f.type === 'autonumber').id];
  ok((await ada('PATCH', `/projects/${p.id}/github`, { repo: 'else/secret' })).status === 400, 'a board can only follow one of the connected repositories');
  r = await ada('PATCH', `/projects/${p.id}/github`, { repo: 'atlas/web' });
  ok(r.status === 200 && r.body.repo === 'atlas/web' && r.body.viaApp === true, 'the board follows atlas/web through the team’s connection, no webhook to paste');
  await deliver('pull_request', { ...pr('opened'), pull_request: { ...pr('opened').pull_request, number: 10, title: `${key} back bar`, html_url: 'https://github.com/atlas/web/pull/10' } });
  ok(await until(async () => ((await ada('GET', `/projects/${p.id}/records`)).body || []).find((x) => x.id === rec.id)?.github?.prs?.[0]?.number === 10), `a pull request naming ${key} shows on the item and moves it, as with a webhook`);

  // ---------- automations and agents ----------
  const cat = (await ada('GET', '/automations/catalog')).body;
  ok(['github.pushed', 'github.merged', 'github.released', 'github.pr_opened'].every((k) => cat.events.some((e) => e.type === k)) && cat.tools.github === 'GitHub', 'automations can start from GitHub');
  r = await ada('POST', '/automations', { name: 'Merged', on: true, trigger: { kind: 'github.merged' }, actions: [{ kind: 'task', text: 'Check {text} in {repo}' }] });
  ok(r.status === 200, 'an automation on a merge saves: ' + JSON.stringify(r.body).slice(0, 200));
  await deliver('pull_request', { ...pr('closed', true), pull_request: { ...pr('closed', true).pull_request, number: 11, title: 'Search box' } });
  ok(await until(async () => (await ada('GET', '/state')).body.tasks.some((x) => x.text === 'Check Search box in atlas/web')), 'a merge starts it, with the words filled in');

  // ---------- repositories change, uninstall ----------
  await deliver('installation_repositories', { action: 'added', installation: { id: 77 }, repositories_added: [{ full_name: 'atlas/docs' }], repositories_removed: [{ full_name: 'atlas/api' }] });
  ok((await ada('GET', '/github/app')).body.repos.join() === 'atlas/web,atlas/docs', 'repositories added or removed on GitHub follow');
  r = await ada('DELETE', '/github/app');
  ok(r.status === 200 && r.body.connected === false, 'disconnect');
  ok((await deliver('push', { ...push, after: 'later1' })).status === 200 && !(await ada('GET', '/github/code?days=7')).body?.events?.some((e) => e.id?.includes('later1')), 'after disconnecting, deliveries are ignored');
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e.message));
} finally {
  srv.kill();
  fake.close();
  if (fails) console.log(srv.log.slice(-3000));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
