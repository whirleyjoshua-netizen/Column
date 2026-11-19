// GitHub for software projects, through a repository webhook: the team pastes a Kloomie address and secret into
// the repo's Settings → Webhooks, and GitHub tells Kloomie about pull requests, pushes and releases. Every delivery
// is checked against the secret (X-Hub-Signature-256), so nobody else can move cards. A work item's key (AM-12) in
// a branch name, a pull request's title or body, or a commit message ties the code to it:
//   - a pull request shows on the work item, and opening it moves the item to Code review;
//   - merging it moves the item to Testing;
//   - commits that mention the key show on the item's timeline;
//   - a published release marks the release with the same version Released.
// A card only moves forward, never back, and the team can switch the moving off.
import crypto from 'node:crypto';

const MAX_BODY = 5_000_000;
const KEEP_PRS = 20;
const KEEP_COMMITS = 15;

export function githubModule({ db, save, broadcast, rid, cleanText, readJson, send, seal, unseal, sees, isAdmin, PJ, publicUrl, bind, automate = () => {}, alarm = () => {} }) {
  const conn = (p) => p.github || null;
  const hookUrl = (p) => `${publicUrl}/api/github/hook/${p.github.token}`;
  const state = (p, withSecret = false) => {
    const g = conn(p);
    if (!g) return { connected: false, ...(p.githubRepo ? { repo: p.githubRepo, viaApp: true } : {}) };
    return { connected: true, url: hookUrl(p), ...(withSecret ? { secret: unseal(g.secret).secret } : {}), repo: g.repo || null, move: g.move !== false, at: g.at, lastEventAt: g.lastEventAt || null, lastEvent: g.lastEvent || null, events: g.events || 0 };
  };
  const workType = (p) => p.types.find((t) => t.key === 'work' && t.fields.some((f) => f.type === 'autonumber'));
  const keyField = (t) => t.fields.find((f) => f.type === 'autonumber');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Work items whose key shows up in these words: "AM-12", "am-12-login-fix", "Fixes AM-12 and AM-14".
  function itemsIn(p, ...texts) {
    const t = workType(p);
    if (!t) return [];
    const kf = keyField(t);
    const prefix = (kf.prefix || '').replace(/-$/, '');
    if (!prefix) return [];
    const re = new RegExp(`(?:^|[^A-Za-z0-9])(${esc(prefix)})[-_ ]?(\\d+)(?![0-9])`, 'gi');
    const keys = new Set();
    for (const s of texts) for (const m of String(s || '').matchAll(re)) keys.add(`${prefix.toUpperCase()}-${Number(m[2])}`);
    if (!keys.size) return [];
    return Object.values(db.records).filter((r) => r.projectId === p.id && r.typeId === t.id && keys.has(String(r.values[kf.id] || '').toUpperCase()));
  }
  // Forward only: a merged item already in Done isn't pulled back to Testing.
  function moveTo(ws, p, t, rec, label, by) {
    if (p.github?.move === false) return false;
    const st = t.fields.find((f) => f.key === 'status' && f.type === 'select');
    const to = st?.choices.find((c) => c.label === label);
    if (!st || !to) return false;
    const at = st.choices.findIndex((c) => c.id === rec.values[st.id]);
    if (at >= st.choices.indexOf(to)) return false;
    PJ.updateRecord(ws, p, t, rec, { [st.id]: to.id }, by);
    return true;
  }
  const note = (rec, text, by) => PJ.recordActivity(rec.id, { kind: 'note', note: text, by, memberId: null });

  function onPull(ws, p, body) {
    const pr = body.pull_request;
    if (!pr) return 0;
    const t = workType(p);
    const items = itemsIn(p, pr.title, pr.body, pr.head?.ref);
    const state = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open';
    const by = `GitHub · ${pr.user?.login || 'someone'}`;
    for (const rec of items) {
      const was = (rec.github?.prs || []).find((x) => x.number === pr.number && x.repo === body.repository?.full_name);
      const entry = { number: pr.number, repo: body.repository?.full_name || '', title: cleanText(pr.title, 200), url: pr.html_url, state, branch: cleanText(pr.head?.ref, 120), author: cleanText(pr.user?.login, 60), updatedAt: Date.now() };
      rec.github = { ...(rec.github || {}), prs: [entry, ...(rec.github?.prs || []).filter((x) => x !== was)].slice(0, KEEP_PRS) };
      const pf = t.fields.find((f) => f.key === 'pr' && f.type === 'url');
      if (pf && !rec.values[pf.id]) PJ.updateRecord(ws, p, t, rec, { [pf.id]: pr.html_url }, by);
      if (!was || was.state !== state) note(rec, `Pull request #${pr.number} ${state === 'merged' ? 'merged' : state === 'closed' ? 'closed without merging' : state === 'draft' ? 'opened as a draft' : was ? 'reopened' : 'opened'}: ${entry.title}`, by);
      if (state === 'open') moveTo(ws, p, t, rec, 'Code review', by);
      if (state === 'merged') moveTo(ws, p, t, rec, 'Testing', by);
      PJ.recordNews(rec, 'record.updated', by);
    }
    return items.length;
  }
  function onPush(ws, p, body) {
    let n = 0;
    const branch = String(body.ref || '').replace(/^refs\/heads\//, '');
    for (const c of (body.commits || []).slice(0, 50)) {
      for (const rec of itemsIn(p, c.message, branch)) {
        if ((rec.github?.commits || []).some((x) => x.id === c.id)) continue;
        const entry = { id: c.id, short: String(c.id).slice(0, 7), message: cleanText(String(c.message).split('\n')[0], 200), url: c.url, author: cleanText(c.author?.username || c.author?.name, 60), branch: cleanText(branch, 120), at: Date.now() };
        rec.github = { ...(rec.github || {}), commits: [entry, ...(rec.github?.commits || [])].slice(0, KEEP_COMMITS) };
        note(rec, `Commit ${entry.short} on ${entry.branch}: ${entry.message}`, `GitHub · ${entry.author || 'someone'}`);
        PJ.recordNews(rec, 'record.updated', 'GitHub');
        n++;
      }
    }
    return n;
  }
  // A published release marks the release record with the same version (v1.2.0 matches "1.2.0" or "v1.2.0").
  function onRelease(ws, p, body) {
    if (body.action !== 'published' || !body.release) return 0;
    const t = p.types.find((x) => x.key === 'releases');
    if (!t) return 0;
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/^v/, '');
    const tag = norm(body.release.tag_name), name = norm(body.release.name);
    const rec = Object.values(db.records).find((r) => r.projectId === p.id && r.typeId === t.id && [tag, name].includes(norm(r.values[t.primary])));
    if (!rec) return 0;
    const st = t.fields.find((f) => f.key === 'status' && f.type === 'select');
    const done = st?.choices.find((c) => c.label === 'Released');
    const date = t.fields.find((f) => f.key === 'date');
    PJ.updateRecord(ws, p, t, rec, { ...(done ? { [st.id]: done.id } : {}), ...(date ? { [date.id]: (body.release.published_at || new Date().toISOString()).slice(0, 10) } : {}) }, `GitHub · ${body.release.author?.login || 'someone'}`);
    note(rec, `Released on GitHub: ${body.release.name || body.release.tag_name}`, 'GitHub');
    return 1;
  }

  // POST /api/github/hook/<token>: from GitHub, no sign-in; the signature is the proof.
  async function hook(req, res, token) {
    const p = Object.values(db.projects).find((x) => x.github?.token && x.github.token === token);
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) return send(res, 413, { error: 'Too large' });
      chunks.push(c);
    }
    if (!p) return send(res, 404, { error: 'Unknown hook' });
    const raw = Buffer.concat(chunks);
    const sig = String(req.headers['x-hub-signature-256'] || '');
    const want = 'sha256=' + crypto.createHmac('sha256', unseal(p.github.secret).secret).update(raw).digest('hex');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return send(res, 401, { error: 'Bad signature' });
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'Bad JSON' }); }
    const ws = db.workspaces[p.wsId];
    if (!ws) return send(res, 404, { error: 'Unknown hook' });
    const event = String(req.headers['x-github-event'] || '');
    let touched = 0;
    if (event === 'pull_request') touched = onPull(ws, p, body);
    else if (event === 'push') touched = onPush(ws, p, body);
    else if (event === 'release') touched = onRelease(ws, p, body);
    Object.assign(p.github, { lastEventAt: Date.now(), lastEvent: event, events: (p.github.events || 0) + 1, ...(body.repository?.full_name ? { repo: body.repository.full_name } : {}) });
    save();
    broadcast(p.wsId, { type: 'github', projectId: p.id });
    return send(res, 200, { ok: true, event, touched });
  }

  // /api/projects/:id/github: connect (a new address and secret), see how it's going, switch moving cards, disconnect.
  async function route(req, res, parts, auth, ws) {
    const [a, b, c] = parts;
    if (a !== 'projects' || c !== 'github') return null;
    const p = db.projects[b];
    if (!p || p.wsId !== ws.id || !sees(p, auth.memberId)) return send(res, 404, { error: 'That project is gone.' });
    const m = req.method;
    const can = isAdmin(auth) || p.memberId === auth.memberId;
    if (m === 'GET') return send(res, 200, state(p, can));
    if (!can) return send(res, 403, { error: 'Only whoever made the project, or an owner or admin, can connect GitHub.' });
    if (m === 'POST') {
      p.github = { token: crypto.randomBytes(18).toString('base64url'), secret: seal({ secret: crypto.randomBytes(24).toString('hex') }), at: Date.now(), by: auth.member, move: p.github?.move ?? true, repo: p.github?.repo || null };
      save();
      return send(res, 200, state(p, true));
    }
    if (m === 'PATCH') {
      const body = await readJson(req);
      // Follow a repository through the team's GitHub connection instead of a webhook of its own.
      if (body.repo !== undefined) {
        if (body.repo && !followsRepo(ws.id, body.repo)) return send(res, 400, { error: 'Pick one of the repositories your team connected.' });
        if (body.repo) p.githubRepo = String(body.repo); else delete p.githubRepo;
        save();
        broadcast(ws.id, { type: 'github', projectId: p.id });
        return send(res, 200, state(p, true));
      }
      if (!conn(p)) return send(res, 400, { error: 'Connect GitHub first.' });
      if (body.move !== undefined) p.github.move = !!body.move;
      save();
      return send(res, 200, state(p, true));
    }
    if (m === 'DELETE') {
      delete p.github;
      save();
      return send(res, 200, state(p));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // ---------- GitHub for the whole team: the Kloomie GitHub App (owner, 2026-11-19) ----------
  // An owner installs the app on their GitHub account or organisation and picks repositories; GitHub sends Kloomie
  // pushes, pull requests and releases for those, signed with the app's webhook secret. The callback proves the
  // installation is one this person can reach on GitHub (their own sign-in lists it), so nobody can attach somebody
  // else's. No GitHub token is kept: Kloomie asks for a short one as the app when it needs to list repositories.
  // Kloomie only reads; it never changes code.
  const env = (k) => process.env[k] || '';
  const API = () => (env('GITHUB_API') || 'https://api.github.com').replace(/\/$/, '');
  const WEB = () => (env('GITHUB_WEB') || 'https://github.com').replace(/\/$/, '');
  const APP_KEYS = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_WEBHOOK_SECRET'];
  const configured = () => APP_KEYS.every((k) => env(k));
  const KEEP_LOG = 300;
  db.githubApp ||= {}; // wsId -> { installationId, account, accountType, repos, memberId, by, at, who, lastEventAt }
  db.codeLog ||= {}; // wsId -> [{ id, kind, repo, branch, by, text, url, n, commits, number, version, at }]
  const appPending = new Map(); // state -> { wsId, memberId, browser, exp }
  const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
  function appJwt() {
    const now = Math.floor(Date.now() / 1000);
    const head = b64u({ alg: 'RS256', typ: 'JWT' }) + '.' + b64u({ iat: now - 60, exp: now + 540, iss: env('GITHUB_APP_ID') });
    const key = env('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n');
    return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url');
  }
  async function gh(path, token, { method = 'GET', body } = {}) {
    const r = await fetch(API() + path, { method, signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Kloomie', Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`GitHub said ${r.status}${j.message ? ': ' + String(j.message).slice(0, 120) : ''}`);
    return j;
  }
  const instTokens = new Map(); // installationId -> { token, exp }, in memory only
  async function instToken(id) {
    const c = instTokens.get(id);
    if (c && c.exp > Date.now() + 60_000) return c.token;
    const j = await gh(`/app/installations/${encodeURIComponent(id)}/access_tokens`, appJwt(), { method: 'POST' });
    instTokens.set(id, { token: j.token, exp: Date.parse(j.expires_at) || Date.now() + 30 * 60_000 });
    return j.token;
  }
  async function listRepos(id) {
    const tok = await instToken(id);
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const j = await gh(`/installation/repositories?per_page=100&page=${page}`, tok);
      out.push(...(j.repositories || []).map((x) => cleanText(x.full_name, 140)));
      if (out.length >= (j.total_count || 0) || !(j.repositories || []).length) break;
    }
    return out;
  }
  const appOf = (wsId) => db.githubApp[wsId] || null;
  const roleOf = (ws, memberId) => ws.members.find((x) => x.id === memberId)?.role;
  // Who reads the code log: owners and admins always; then everyone, or people who can see a software board.
  function codeOk(ws, memberId) {
    const c = appOf(ws.id);
    if (!c) return false;
    if (['owner', 'admin'].includes(roleOf(ws, memberId))) return true;
    if (c.who === 'all') return true;
    if (c.who === 'admins') return false;
    return Object.values(db.projects).some((p) => p.wsId === ws.id && p.template === 'tech' && sees(p, memberId));
  }
  function appState(ws, memberId) {
    const c = appOf(ws.id);
    const admin = ['owner', 'admin'].includes(roleOf(ws, memberId));
    if (!c) return { configured: configured(), connected: false };
    const see = codeOk(ws, memberId);
    return { configured: configured(), connected: true, canSee: see, ...(see ? { account: c.account, accountType: c.accountType, repos: c.repos } : {}),
      ...(admin ? { who: c.who || 'tech', by: c.by, at: c.at, lastEventAt: c.lastEventAt || null, error: c.error || null, manage: `${WEB()}/apps/${env('GITHUB_APP_SLUG')}/installations/new` } : {}) };
  }
  function logEntry(event, body) {
    const repo = cleanText(body.repository?.full_name, 140);
    if (!repo) return null;
    const line = (m) => cleanText(String(m || '').split('\n')[0], 200);
    const web = (u) => (/^https:\/\//.test(String(u || '')) ? cleanText(u, 400) : ''); // links go into pages: web addresses only
    if (event === 'push') {
      const commits = body.commits || [];
      if (body.deleted || !commits.length) return null;
      return { id: 'push:' + repo + ':' + cleanText(body.after, 64), kind: 'push', repo, branch: cleanText(String(body.ref || '').replace(/^refs\/heads\//, ''), 120), by: cleanText(body.pusher?.name || body.sender?.login, 60),
        n: commits.length, text: line(body.head_commit?.message || commits.at(-1)?.message), url: web(body.compare),
        commits: commits.slice(-5).reverse().map((c) => ({ short: String(c.id).slice(0, 7), message: line(c.message), url: web(c.url), by: cleanText(c.author?.username || c.author?.name, 60) })) };
    }
    if (event === 'pull_request') {
      const pr = body.pull_request;
      if (!pr) return null;
      const kind = ['opened', 'reopened', 'ready_for_review'].includes(body.action) && !pr.draft ? 'pr_opened' : body.action === 'closed' ? (pr.merged ? 'merged' : 'pr_closed') : null;
      if (!kind) return null;
      return { id: `pr:${repo}#${pr.number}:${kind}`, kind, repo, branch: cleanText(pr.head?.ref, 120), by: cleanText((kind === 'merged' ? pr.merged_by?.login : null) || pr.user?.login, 60), number: pr.number, text: cleanText(pr.title, 200), url: web(pr.html_url) };
    }
    if (event === 'release' && body.action === 'published' && body.release) {
      const r = body.release;
      return { id: `rel:${repo}:${cleanText(r.tag_name, 80)}`, kind: 'released', repo, by: cleanText(r.author?.login || body.sender?.login, 60), version: cleanText(r.tag_name, 80), text: cleanText(r.name || r.tag_name, 200), url: web(r.html_url) };
    }
    return null;
  }
  const EVENT_OF = { push: 'github.pushed', pr_opened: 'github.pr_opened', merged: 'github.merged', released: 'github.released' };

  // POST /api/github/app/hook: every delivery for every team that installed the app, signed with its secret.
  async function appHook(req, res) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) return send(res, 413, { error: 'Too large' });
      chunks.push(c);
    }
    if (!configured()) return send(res, 404, { error: 'Not set up' });
    const raw = Buffer.concat(chunks);
    const sig = String(req.headers['x-hub-signature-256'] || '');
    const want = 'sha256=' + crypto.createHmac('sha256', env('GITHUB_APP_WEBHOOK_SECRET')).update(raw).digest('hex');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return send(res, 401, { error: 'Bad signature' });
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'Bad JSON' }); }
    const event = String(req.headers['x-github-event'] || '');
    const inst = String(body.installation?.id || '');
    const teams = Object.keys(db.githubApp).filter((wsId) => db.githubApp[wsId].installationId === inst && db.workspaces[wsId]);
    let logged = 0;
    for (const wsId of teams) {
      const c = db.githubApp[wsId];
      const ws = db.workspaces[wsId];
      c.lastEventAt = Date.now();
      if (event === 'installation' && ['deleted', 'suspend'].includes(body.action)) {
        delete db.githubApp[wsId];
        delete db.codeLog[wsId];
        broadcast(wsId, { type: 'githubapp' });
        continue;
      }
      if (event === 'installation_repositories') {
        const gone = new Set((body.repositories_removed || []).map((x) => x.full_name));
        c.repos = [...c.repos.filter((x) => !gone.has(x)), ...(body.repositories_added || []).map((x) => cleanText(x.full_name, 140)).filter((x) => !c.repos.includes(x))];
        broadcast(wsId, { type: 'githubapp' });
        continue;
      }
      const repoName = body.repository?.full_name;
      if (repoName && !c.repos.includes(repoName)) continue;
      // Software boards that follow this repository through the team's connection (not their own webhook).
      for (const p of Object.values(db.projects)) {
        if (p.wsId !== wsId || p.githubRepo !== repoName || p.github?.token) continue;
        const n = event === 'pull_request' ? onPull(ws, p, body) : event === 'push' ? onPush(ws, p, body) : event === 'release' ? onRelease(ws, p, body) : 0;
        if (n) broadcast(wsId, { type: 'github', projectId: p.id });
      }
      const e = logEntry(event, body);
      if (!e) continue;
      const log = (db.codeLog[wsId] ||= []);
      if (log.some((x) => x.id === e.id)) continue; // GitHub retries a delivery: once
      e.at = Date.now();
      log.unshift(e);
      if (log.length > KEEP_LOG) log.length = KEEP_LOG;
      logged++;
      broadcast(wsId, { type: 'code' });
      // Members' automations only when everyone may see code activity; otherwise owners' and admins'.
      if (EVENT_OF[e.kind]) automate(wsId, EVENT_OF[e.kind], { repo: e.repo, branch: e.branch || '', text: e.text, url: e.url, version: e.version || '', who: e.by, qty: e.n, ownersOnly: c.who !== 'all' });
    }
    save();
    return send(res, 200, { ok: true, event, logged });
  }

  const APP_DONE = {
    connected: ['GitHub connected', 'Pushes, pull requests and releases from the repositories you picked now show in Kloomie. You can close this window.'],
    expired: ['Link expired', 'Start again from Kloomie → Apps & Integrations → GitHub.'],
    denied: ['Not connected', 'GitHub access wasn’t granted. You can close this window.'],
    role: ['Not connected', 'Only team owners and admins can connect GitHub.'],
    notyours: ['Not connected', 'That GitHub installation isn’t one your GitHub account can reach. Install Kloomie on your own account or an organisation you belong to.'],
    requested: ['Waiting for an organisation owner', 'GitHub sent the request to an owner of that organisation. Once they approve it, connect again from Kloomie.'],
    failed: ['Not connected', 'Something went wrong talking to GitHub. Try again in a minute.'],
  };
  const esc2 = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  function appDonePage(req, res, url) {
    const r = url.searchParams.get('r');
    const [title, msg] = Object.hasOwn(APP_DONE, r || '') ? APP_DONE[r] : APP_DONE.failed;
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc2(title)}</title><body style="font:15px system-ui;background:#f6f6f8;color:#17171c;display:grid;place-items:center;min-height:90vh;margin:0;padding:0 16px"><div style="max-width:440px"><h2>${esc2(title)}</h2><p>${esc2(msg)}</p></div></body>`);
  }
  const appDone = (res, how) => { res.writeHead(302, { Location: `/github/done?r=${how}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); };
  // GitHub comes back here after the install page (with "request user authorization" on): a code, the installation
  // id and our state.
  async function appCallback(req, res, url) {
    const st = url.searchParams.get('state') || '';
    const pend = appPending.get(st);
    if (!pend || pend.exp < Date.now()) { appPending.delete(st); return send(res, 400, '<!doctype html><meta charset="utf-8"><title>Link expired</title><p>This link expired. Start again from Kloomie → Apps &amp; Integrations → GitHub.</p>'); }
    const ws = db.workspaces[pend.wsId];
    const who = ws?.members.find((x) => x.id === pend.memberId);
    if (who && bind.gate(req, res, url, pend, { what: 'GitHub', team: ws.name, person: who.name })) return;
    appPending.delete(st);
    if (url.searchParams.get('error')) return appDone(res, 'denied');
    if (!who || !['owner', 'admin'].includes(who.role)) return appDone(res, 'role');
    if (url.searchParams.get('setup_action') === 'request') return appDone(res, 'requested');
    const inst = String(url.searchParams.get('installation_id') || '');
    const code = url.searchParams.get('code') || '';
    if (!/^\d{1,20}$/.test(inst) || !code) return appDone(res, 'failed');
    try {
      const r = await fetch(WEB() + '/login/oauth/access_token', { method: 'POST', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Kloomie' }, body: JSON.stringify({ client_id: env('GITHUB_APP_CLIENT_ID'), client_secret: env('GITHUB_APP_CLIENT_SECRET'), code }) });
      const tok = (await r.json().catch(() => ({}))).access_token;
      if (!tok) return appDone(res, 'denied');
      const mine = await gh('/user/installations?per_page=100', tok);
      const found = (mine.installations || []).find((x) => String(x.id) === inst);
      if (!found) return appDone(res, 'notyours');
      const repos = await listRepos(inst);
      const old = appOf(ws.id);
      db.githubApp[ws.id] = { installationId: inst, account: cleanText(found.account?.login, 80), accountType: found.account?.type === 'Organization' ? 'org' : 'user', repos, memberId: who.id, by: who.name, at: Date.now(), who: old?.who || 'tech', lastEventAt: old?.installationId === inst ? old.lastEventAt : null };
      if (old?.installationId !== inst) delete db.codeLog[ws.id];
      save();
      broadcast(ws.id, { type: 'githubapp' });
      return appDone(res, 'connected');
    } catch (e) {
      alarm('Connecting GitHub failed', e);
      return appDone(res, 'failed');
    }
  }
  // /api/github/app (state, connect, who sees it, refresh, disconnect) and /api/github/code (the log).
  async function appRoute(req, res, parts, auth, ws) {
    const [a, b, c] = parts;
    if (a !== 'github' || !['app', 'code'].includes(b)) return null;
    const m = req.method;
    if (b === 'code') {
      if (m !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      if (!codeOk(ws, auth.memberId)) return send(res, 403, { error: 'Code activity is for the people your owners chose.' });
      const url = new URL(req.url, 'http://x');
      const since = Date.now() - Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7)) * 864e5;
      const repo = url.searchParams.get('repo');
      return send(res, 200, { events: (db.codeLog[ws.id] || []).filter((e) => e.at >= since && (!repo || e.repo === repo)).slice(0, 200) });
    }
    if (m === 'GET' && !c) return send(res, 200, appState(ws, auth.memberId));
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins connect GitHub.' });
    if (m === 'POST' && c === 'connect') {
      if (!configured()) return send(res, 400, { error: 'GitHub isn’t set up on this Kloomie server yet.' });
      const st = crypto.randomBytes(18).toString('base64url');
      for (const [k, v] of appPending) if (v.exp < Date.now()) appPending.delete(k);
      appPending.set(st, { wsId: ws.id, memberId: auth.memberId, browser: bind.start(req, res), exp: Date.now() + 30 * 60_000 });
      return send(res, 200, { url: `${WEB()}/apps/${encodeURIComponent(env('GITHUB_APP_SLUG'))}/installations/new?` + new URLSearchParams({ state: st }) });
    }
    const conn = appOf(ws.id);
    if (!conn) return send(res, 400, { error: 'Connect GitHub first.' });
    if (m === 'PATCH' && !c) {
      const body = await readJson(req);
      if (body.who !== undefined) {
        if (!['tech', 'all', 'admins'].includes(body.who)) return send(res, 400, { error: 'Pick who sees code activity.' });
        conn.who = body.who;
      }
      save();
      broadcast(ws.id, { type: 'githubapp' });
      return send(res, 200, appState(ws, auth.memberId));
    }
    if (m === 'POST' && c === 'refresh') {
      try { conn.repos = await listRepos(conn.installationId); conn.error = null; } catch (e) { conn.error = e.message; }
      save();
      return send(res, 200, appState(ws, auth.memberId));
    }
    if (m === 'DELETE' && !c) {
      delete db.githubApp[ws.id];
      delete db.codeLog[ws.id];
      save();
      broadcast(ws.id, { type: 'githubapp' });
      return send(res, 200, appState(ws, auth.memberId));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  const followsRepo = (wsId, repo) => !!appOf(wsId)?.repos.includes(repo);
  return { route, hook, itemsIn, appHook, appCallback, appDonePage, appRoute, codeOk, followsRepo, appConfigured: configured };
}
