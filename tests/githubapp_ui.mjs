// GitHub for the whole team, in the app (the owner, 2026-11-19): the GitHub tile says Connected with the account and
// repositories and who sees code activity; Home gets a Code card with the latest pushes, merges and releases, which
// updates when GitHub sends more; a software board follows a repository picked from the list.
import './cookiejar.mjs';
import * as FS from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/githubappui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5302, APP = `http://127.0.0.1:${PORT}/`, CDP = 9600, F_PORT = 5303, F = `http://127.0.0.1:${F_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
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


try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-ghui`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-ghui`, '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', GITHUB_API: F, GITHUB_WEB: F,
  GITHUB_APP_ID: '12345', GITHUB_APP_SLUG: 'kloomie-test', GITHUB_APP_CLIENT_ID: 'Iv1.test', GITHUB_APP_CLIENT_SECRET: 'csecret', GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, '\\n'), GITHUB_APP_WEBHOOK_SECRET: HOOK_SECRET }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  // SHOTS=<dir> saves a picture at each step, to look at the layout.
  const shot = async (name) => { if (!process.env.SHOTS) return; const r = await cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
  return { ev, until, cmd, errors, shot, close: () => ws.close() };
}
const deliver = (event, body) => { const raw = JSON.stringify(body); return fetch(APP + 'api/github/app/hook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', HOOK_SECRET).update(raw).digest('hex') }, body: raw }); };
const repo = { full_name: 'atlas/web' };
const push = (after, msgs) => ({ ref: 'refs/heads/main', after, compare: 'https://github.com/atlas/web/compare/x', installation: { id: 77 }, repository: repo, pusher: { name: 'ada-dev' }, commits: msgs.map((m, i) => ({ id: after + i, message: m, url: 'https://github.com/atlas/web/commit/' + after + i, author: { username: 'ada-dev' } })), head_commit: { message: msgs.at(-1) } });
let A;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Code ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  // Connect (GitHub's install page is a stand-in; the browser part of connecting is tested in githubapp.mjs).
  const st = new URL((await api('POST', '/github/app/connect')).url).searchParams.get('state');
  const cb = await fetch(`${APP}oauth/github/callback?code=good&installation_id=77&setup_action=install&state=${st}`, { redirect: 'manual' });
  ok(/r=connected/.test(cb.headers.get('location') || ''), 'connected');
  await deliver('push', push('aaa', ['Add the back bar', 'Esc goes back']));
  await deliver('pull_request', { action: 'closed', installation: { id: 77 }, repository: repo, pull_request: { number: 9, title: 'Apps back bar', html_url: 'https://github.com/atlas/web/pull/9', user: { login: 'ben-dev' }, merged: true, merged_by: { login: 'ada-dev' }, head: { ref: 'back-bar' } } });
  const board = await api('POST', '/projects', { template: 'tech', name: 'Atlas Web' });

  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=home]')`, 15000), 'Ada is in');
  await A.ev(`document.querySelector('#tabs [data-tab=home]').click(); true`);
  ok(await A.until(`!!document.querySelector('#home .home-card.code')`, 8000), 'Home has a Code card');
  ok(await A.ev(`(() => { const c = document.querySelector('#home .home-card.code'); return c.textContent.includes('Since yesterday: 2 commits · 1 merge') && c.querySelectorAll('.code-row').length === 2 && c.querySelector('.code-row[data-kind=push]').textContent.includes('atlas/web · main: 2 commits') && c.querySelector('.code-row[data-kind=push]').getAttribute('href').startsWith('https://github.com/'); })()`), 'with the push and the merge, linking to GitHub: ' + await A.ev(`document.querySelector('#home .home-card.code')?.textContent`));
  await deliver('release', { action: 'published', installation: { id: 77 }, repository: repo, release: { tag_name: 'v2.4.0', name: 'Spring', html_url: 'https://github.com/atlas/web/releases/v2.4.0', author: { login: 'ada-dev' } } });
  ok(await A.until(`!!document.querySelector('#home .home-card.code .code-row[data-kind=released]')`, 6000), 'a release GitHub sends shows right away');
  await A.shot('home-code');

  // The tile.
  await A.ev(`document.querySelector('#tabs [data-tab=apps]').click(); [...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === 'Integrations')?.click(); true`);
  ok(await A.until(`document.querySelector('#apps .app-tile[data-app=github]')?.dataset.state === 'on'`), 'the GitHub tile says Connected');
  await A.ev(`document.querySelector('#apps .app-tile[data-app=github]').click(); true`);
  ok(await A.until(`(() => { const d = document.querySelector('#apps .app-detail .gh-app'); return d && d.textContent.includes('Connected to atlas') && [...document.querySelectorAll('#apps .gh-repos .chip')].map((x) => x.textContent).join() === 'atlas/web,atlas/api'; })()`), 'its page shows the account and repositories');
  await A.ev(`document.querySelector('#apps .seg [data-who=all]').click(); true`);
  ok(await A.until(`document.querySelector('#apps .seg [data-who=all]')?.classList.contains('on')`) && (await api('GET', '/github/app')).who === 'all', 'Ada opens code activity to everyone');
  await A.shot('tile');
  // A board follows a repository from the list.
  await A.ev(`[...document.querySelectorAll('#apps .app-detail button')].find((b) => b.textContent === 'Atlas Web').click(); true`);
  ok(await A.until(`!!document.querySelector('#sheet .gh-follow')`), 'the board’s GitHub page offers the team’s repositories');
  await A.ev(`(() => { const s = document.querySelector('#sheet .gh-follow'); s.value = 'atlas/web'; s.dispatchEvent(new Event('change')); return true; })()`);
  ok(await (async () => { for (let i = 0; i < 30; i++) { if ((await api('GET', `/projects/${board.id}/github`)).repo === 'atlas/web') return true; await sleep(150); } return false; })(), 'picking atlas/web makes the board follow it');
  ok(await A.until(`document.querySelector('#sheet')?.textContent.includes('Following atlas/web')`), 'and it says so');
  await A.shot('board');
  ok(!A.errors.length, 'no errors in the page: ' + A.errors.join(' | '));
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e.message));
} finally {
  A?.close(); chrome.kill(); srv.kill(); fake.close();
  if (fails) console.log(srv.log.slice(-2500));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
