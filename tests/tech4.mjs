// Technology & software, step 4: GitHub through a repository webhook. Only signed deliveries count; a work item's key
// in a branch, pull request or commit ties it to the item; opening a pull request moves it to Code review and
// merging moves it to Testing (forward only, and the team can switch that off); commits show on the item; a
// published release marks the matching release Released; the address and secret never leave the server.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/tech4';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4727, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Atlas ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const ben = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Atlas ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  const p = (await ada('POST', '/projects', { template: 'tech', name: 'Atlas Mobile' })).body;
  const T = (k) => p.types.find((x) => x.key === k);
  const work = T('work'), rel = T('releases');
  const F = (tp, k) => tp.fields.find((x) => x.key === k);
  const C = (tp, k, l) => F(tp, k).choices.find((x) => x.label === l).id;
  const item = async (title, status) => (await ada('POST', `/projects/${p.id}/records`, { typeId: work.id, values: { title, status: C(work, 'status', status) } })).body;
  const a1 = await item('Login button does nothing', 'In progress'); // AM-1
  const a2 = await item('Password reset', 'Ready'); // AM-2
  const a3 = await item('Old work', 'Done'); // AM-3
  const v1 = (await ada('POST', `/projects/${p.id}/records`, { typeId: rel.id, values: { name: 'v1.0' } })).body;

  ok((await ben('POST', `/projects/${p.id}/github`)).status === 403, 'only whoever made the project (or an admin) connects GitHub');
  r = await ada('POST', `/projects/${p.id}/github`);
  const { url, secret } = r.body;
  ok(r.status === 200 && url.startsWith(B + '/api/github/hook/') && /^[0-9a-f]{48}$/.test(secret), 'Ada gets a webhook address and secret to paste into GitHub');
  ok(!(await ben('GET', `/projects/${p.id}/github`)).body.secret, 'Ben can see it’s connected, not the secret');
  const proj = (await ada('GET', '/projects')).body.find((x) => x.id === p.id);
  ok(proj.github?.connected && !JSON.stringify(proj).includes(url.split('/').pop()), 'the project itself never carries the address or secret');

  const send = async (event, body, key = secret) => {
    const raw = JSON.stringify(body);
    const sig = 'sha256=' + crypto.createHmac('sha256', key).update(raw).digest('hex');
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': sig }, body: raw });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const repo = { full_name: 'atlas/app' };
  ok((await send('ping', { zen: 'Keep it logically awesome.', repository: repo }, 'wrong-secret')).status === 401, 'a delivery with the wrong signature is refused');
  ok((await fetch(B + '/api/github/hook/nope', { method: 'POST', body: '{}' })).status === 404, 'and an unknown address');
  r = await send('ping', { zen: 'hi', repository: repo });
  ok(r.status === 200 && (await ada('GET', `/projects/${p.id}/github`)).body.repo === 'atlas/app', 'GitHub’s test delivery connects it to atlas/app');

  const recs = async () => (await ada('GET', `/projects/${p.id}/records`)).body;
  const by = async (id) => (await recs()).find((x) => x.id === id);
  const pr = (n, extra) => ({ action: 'opened', number: n, repository: repo, pull_request: { number: n, title: 'Fix the login button', body: '', html_url: `https://github.com/atlas/app/pull/${n}`, state: 'open', draft: false, merged: false, user: { login: 'octo' }, head: { ref: 'am-1-login-button' }, ...extra } });
  r = await send('pull_request', pr(12));
  let x = await by(a1.id);
  ok(r.body.touched === 1 && x.values[F(work, 'status').id] === C(work, 'status', 'Code review'), 'a pull request from branch am-1-login-button moves AM-1 to Code review');
  ok(x.github?.prs?.[0]?.number === 12 && x.github.prs[0].state === 'open' && x.values[F(work, 'pr').id] === 'https://github.com/atlas/app/pull/12', 'the pull request shows on the item, and fills its link');
  ok(JSON.stringify((await ada('GET', `/records/${a1.id}/log`)).body).includes('Pull request #12 opened'), 'and on its timeline');
  r = await send('pull_request', pr(12, { state: 'closed', merged: true }));
  x = await by(a1.id);
  ok(x.values[F(work, 'status').id] === C(work, 'status', 'Testing') && x.github.prs.length === 1 && x.github.prs[0].state === 'merged', 'merging it moves AM-1 to Testing');
  r = await send('pull_request', pr(13, { title: 'Clean up AM-3 leftovers', head: { ref: 'cleanup' }, state: 'closed', merged: true }));
  ok((await by(a3.id)).values[F(work, 'status').id] === C(work, 'status', 'Done'), 'a card already Done isn’t pulled back');
  ok((await send('pull_request', pr(14, { title: 'Nothing to do with work', head: { ref: 'misc' } }))).body.touched === 0, 'a pull request without a key touches nothing');

  r = await send('push', { ref: 'refs/heads/main', repository: repo, commits: [{ id: 'abc1234def', message: 'Send the reset email (AM-2)\n\nlonger text', url: 'https://github.com/atlas/app/commit/abc1234', author: { username: 'octo' } }] });
  x = await by(a2.id);
  ok(r.body.touched === 1 && x.github?.commits?.[0]?.short === 'abc1234' && x.github.commits[0].message === 'Send the reset email (AM-2)', 'a commit mentioning AM-2 shows on it');
  await send('push', { ref: 'refs/heads/main', repository: repo, commits: [{ id: 'abc1234def', message: 'Send the reset email (AM-2)', url: '', author: {} }] });
  ok((await by(a2.id)).github.commits.length === 1, 'the same commit twice shows once');

  r = await send('release', { action: 'published', repository: repo, release: { tag_name: 'v1.0', name: 'Version 1.0', published_at: '2026-11-20T10:00:00Z', author: { login: 'octo' } } });
  x = await by(v1.id);
  ok(x.values[F(rel, 'status').id] === C(rel, 'status', 'Released') && x.values[F(rel, 'date').id] === '2026-11-20', 'publishing v1.0 on GitHub marks the v1.0 release Released, with its date');

  await ada('PATCH', `/projects/${p.id}/github`, { move: false });
  await send('pull_request', pr(15, { title: 'AM-2 reset email', head: { ref: 'x' } }));
  ok((await by(a2.id)).values[F(work, 'status').id] === C(work, 'status', 'Ready') && (await by(a2.id)).github.prs[0].number === 15, 'with moving switched off, the pull request still shows but the card stays put');
  const old = url;
  r = await ada('POST', `/projects/${p.id}/github`);
  ok(r.body.url !== old && (await send('ping', {}, r.body.secret)).status === 404, 'a new address and secret: the old address stops working');
  ok((await ada('DELETE', `/projects/${p.id}/github`)).body.connected === false, 'disconnect');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
