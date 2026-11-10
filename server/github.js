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

export function githubModule({ db, save, broadcast, rid, cleanText, readJson, send, seal, unseal, sees, isAdmin, PJ, publicUrl }) {
  const conn = (p) => p.github || null;
  const hookUrl = (p) => `${publicUrl}/api/github/hook/${p.github.token}`;
  const state = (p, withSecret = false) => {
    const g = conn(p);
    if (!g) return { connected: false };
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
    if (m === 'PATCH' && conn(p)) {
      const body = await readJson(req);
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
  return { route, hook, itemsIn };
}
