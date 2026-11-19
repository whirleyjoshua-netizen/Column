// CompanyCam (the integrations map, 2026-11-19/20): crews' job-site photos land on the job in Kloomie.
//
// CONNECT (team): an owner or admin pastes a CompanyCam API access token (CompanyCam → Settings → Integrations →
// Access tokens, or app.companycam.com/access_tokens). Kloomie checks it (GET /company), then registers its own webhook
// in CompanyCam with a secret only Kloomie knows. Both are kept sealed. Disconnecting deletes the webhook there.
// DATA: CompanyCam projects are matched to jobs by street address (house number and street, and city when both have
// one). One clear match links them; otherwise an owner or admin picks the job (or leaves it). Photos on a linked
// project are copied into the job's Photos (its files field), newest first, once each; linking a project brings in
// its latest photos. ACCESS: the token and webhook are the team's; status detail is for owners and admins; photos are
// seen like any other photo on the job. Agents' find_photos / look_at_photos read the job's Photos, so they see them.
// WORK: companycam.photo and companycam.project automation triggers.
//
// Built on CompanyCam's documented v2 API (supported until September 2027); COMPANYCAM_API points it elsewhere (a
// stand-in in tests, or the newer public_api when its webhooks are documented).
import crypto from 'node:crypto';

export function companycamModule({ db, save, broadcast, rid, cleanText, readJson, send, seal, unseal, isAdmin, safeFetch, publicUrl, jobsOf, addPhoto, automate = () => {}, alarm = () => {} }) {
  db.companycam ||= {}; // wsId -> { token, secret, webhookId, hookKey, account, memberId, by, at, projects: { id: { name, street, city, recordId, how } }, error, lastEventAt }
  db.ccPhotos ||= {}; // `${wsId}:${photoId}` -> itemId (each photo once)
  const API = () => (process.env.COMPANYCAM_API || 'https://api.companycam.com/v2').replace(/\/$/, '');
  const local = () => process.env.COMPANYCAM_LOCAL === '1'; // tests' stand-in on this machine
  const conn = (wsId) => db.companycam[wsId] || null;
  const PROJECTS_MAX = 2000, BACKFILL = 30, PHOTO_BYTES = 15_000_000;

  async function cc(token, method, path, body) {
    const r = await safeFetch(API() + path, {
      method, timeout: 15_000, maxBytes: 3_000_000, allowLocal: local(), httpsOnly: !local(),
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    }).catch((e) => { throw Object.assign(new Error(e.code === 'TIMEOUT' ? 'CompanyCam didn’t answer in time. Try again.' : 'Couldn’t reach CompanyCam.'), { status: 502 }); });
    const data = await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('CompanyCam didn’t accept that token. Make a new one in CompanyCam (Settings → Integrations → Access tokens) and paste it here.'), { status: 400, auth: true });
    if (!r.ok) throw Object.assign(new Error(`CompanyCam said no (${r.status}).`), { status: 502 });
    return data;
  }

  // ---------- matching CompanyCam projects to jobs by address ----------
  const SUFFIX = { street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', lane: 'ln', boulevard: 'blvd', court: 'ct', place: 'pl', circle: 'cir', highway: 'hwy', parkway: 'pkwy', terrace: 'ter', trail: 'trl', way: 'way', north: 'n', south: 's', east: 'e', west: 'w' };
  const norm = (s) => String(s || '').toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').map((w) => SUFFIX[w] || w).join(' ');
  const splitAddr = (s) => { const [street, city] = String(s || '').split(',').map((x) => x.trim()); return { street: norm(street), city: norm(city) }; };
  function matchJob(ws, pr) {
    if (!pr.street) return { recordId: null, candidates: [] };
    const jobs = jobsOf(ws).map((j) => ({ ...j, ...splitAddr(j.address) })).filter((j) => j.street);
    const same = jobs.filter((j) => j.street === pr.street && (!j.city || !pr.city || j.city === pr.city));
    if (same.length === 1) return { recordId: same[0].id, candidates: same };
    const num = pr.street.split(' ')[0];
    const near = same.length ? same : jobs.filter((j) => /^\d/.test(num) && j.street.split(' ')[0] === num);
    return { recordId: null, candidates: near.slice(0, 8) };
  }
  const projectOf = (x) => ({ name: cleanText(x.name, 160), street: norm(x.address?.street_address_1), city: norm(x.address?.city), address: [x.address?.street_address_1, x.address?.city].filter(Boolean).map((v) => cleanText(v, 120)).join(', ') });
  function upsertProject(ws, c, x) {
    const id = String(x.id || '');
    if (!/^\d{1,20}$/.test(id)) return null;
    const old = c.projects[id];
    const p = { ...(old || {}), ...projectOf(x) };
    if (!old && Object.keys(c.projects).length >= PROJECTS_MAX) return null;
    // A project that was linked by hand stays where it was put; an automatic match is checked again.
    if (!old || old.how !== 'hand') { const m = matchJob(ws, p); if (m.recordId) Object.assign(p, { recordId: m.recordId, how: 'auto' }); else if (old?.how === 'auto') Object.assign(p, { recordId: null, how: null }); }
    c.projects[id] = p;
    return p;
  }
  async function syncProjects(ws, c) {
    const tok = unseal(c.token).t;
    for (let page = 1; page <= 10; page++) {
      const list = await cc(tok, 'GET', `/projects?per_page=100&page=${page}&status=active`);
      const arr = Array.isArray(list) ? list : [];
      for (const x of arr) upsertProject(ws, c, x);
      if (arr.length < 100) break;
    }
    c.error = null;
  }

  // ---------- photos ----------
  const imageType = (buf) => (buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null);
  async function takePhoto(ws, c, photo) {
    const pid = String(photo?.id || ''), prId = String(photo?.project_id || '');
    if (!/^\d{1,20}$/.test(pid) || db.ccPhotos[`${ws.id}:${pid}`] || photo.status === 'deleted') return false;
    const pr = c.projects[prId];
    if (!pr?.recordId) return false;
    const uris = Array.isArray(photo.uris) ? photo.uris : [];
    const pick = uris.find((u) => u?.type === 'web') || uris.find((u) => u?.type === 'original') || uris[0];
    const src = String(pick?.uri || pick?.url || photo.photo_url || '');
    if (!/^https?:\/\//.test(src)) return false;
    const r = await safeFetch(src, { timeout: 20_000, maxBytes: PHOTO_BYTES, allowLocal: local(), httpsOnly: !local(), redirects: 3 }).catch(() => null);
    if (!r?.ok) return false;
    const buf = await r.buffer();
    const mime = imageType(buf);
    if (!mime) return false;
    const when = Number(photo.captured_at) ? new Date(Number(photo.captured_at) * 1000).toISOString().slice(0, 10) : '';
    const name = `CompanyCam ${when || pid}${mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg'}`;
    const it = addPhoto(ws, c, pr.recordId, { name, mime, buf, ccId: pid, by: cleanText(photo.creator_name, 60) || 'CompanyCam' });
    if (!it) return false;
    db.ccPhotos[`${ws.id}:${pid}`] = it.id;
    automate(ws.id, 'companycam.photo', { recordId: pr.recordId, who: cleanText(photo.creator_name, 60) || 'CompanyCam', note: cleanText(photo.description?.plain_text_content || (typeof photo.description === 'string' ? photo.description : ''), 300), text: pr.name });
    return true;
  }
  async function backfill(ws, c, prId) {
    const tok = unseal(c.token).t;
    const list = await cc(tok, 'GET', `/projects/${encodeURIComponent(prId)}/photos?per_page=${BACKFILL}`).catch(() => []);
    let n = 0;
    for (const ph of (Array.isArray(list) ? list : []).slice(0, BACKFILL).reverse()) if (await takePhoto(ws, c, { ...ph, project_id: ph.project_id || prId }).catch(() => false)) n++;
    return n;
  }

  // ---------- state ----------
  function state(ws, auth) {
    const c = conn(ws.id);
    if (!c) return { connected: false };
    if (!isAdmin(auth)) return { connected: true };
    const projects = Object.entries(c.projects).map(([id, p]) => ({ id, name: p.name, address: p.address, recordId: p.recordId || null, how: p.how || null }));
    const waiting = projects.filter((p) => !p.recordId).slice(0, 200).map((p) => ({ ...p, candidates: matchJob(ws, c.projects[p.id]).candidates.map((j) => ({ id: j.id, name: j.name, address: j.address })) }));
    return { jobs: jobsOf(ws).slice(0, 500).map((j) => ({ id: j.id, name: j.name, address: j.address })), connected: true, account: c.account, by: c.by, at: c.at, error: c.error || null, lastEventAt: c.lastEventAt || null, linked: projects.filter((p) => p.recordId).length, projects: projects.length, waiting, photos: Object.keys(db.ccPhotos).filter((k) => k.startsWith(ws.id + ':')).length };
  }

  // ---------- the app's routes: /api/companycam ----------
  async function route(req, res, parts, auth, ws) {
    const [a, b] = parts;
    if (a !== 'companycam' || b === 'hook') return null;
    const m = req.method;
    if (m === 'GET' && !b) return send(res, 200, state(ws, auth));
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins connect CompanyCam.' });
    try {
      if (m === 'PUT' && !b) {
        const { token } = await readJson(req, 5_000);
        const t = String(token || '').trim();
        if (!/^[\w.\-~+/=]{20,400}$/.test(t)) return send(res, 400, { error: 'Paste the access token from CompanyCam (Settings → Integrations → Access tokens).' });
        const company = await cc(t, 'GET', '/company');
        const old = conn(ws.id);
        if (old?.webhookId) await cc(unseal(old.token).t, 'DELETE', `/webhooks/${encodeURIComponent(old.webhookId)}`).catch(() => {});
        const secret = crypto.randomBytes(24).toString('base64url'), hookKey = rid(24);
        const hook = await cc(t, 'POST', '/webhooks', { url: `${publicUrl}/api/companycam/hook/${hookKey}`, scopes: ['photo.created', 'project.created', 'project.updated'], enabled: true, token: secret });
        const c = { token: seal({ t }), secret: seal({ s: secret }), webhookId: String(hook?.id || ''), hookKey, account: cleanText(company?.name, 120) || 'CompanyCam', memberId: auth.memberId, by: auth.member, at: Date.now(), projects: old?.projects || {}, error: null };
        db.companycam[ws.id] = c;
        await syncProjects(ws, c).catch((e) => { c.error = e.message; });
        save();
        broadcast(ws.id, { type: 'companycam', forAdmins: true });
        return send(res, 200, state(ws, auth));
      }
      const c = conn(ws.id);
      if (!c) return send(res, 400, { error: 'Connect CompanyCam first.' });
      if (m === 'POST' && b === 'sync') {
        await syncProjects(ws, c).catch((e) => { c.error = e.message; });
        save();
        return send(res, 200, state(ws, auth));
      }
      // Link a CompanyCam project to a job by hand (recordId), or unlink it (null). Linking brings in its latest photos.
      if (m === 'POST' && b === 'link') {
        const body = await readJson(req, 5_000);
        const p = c.projects[String(body.projectId || '')];
        if (!p) return send(res, 404, { error: 'That CompanyCam project isn’t here. Refresh the list.' });
        if (body.recordId && !jobsOf(ws).some((j) => j.id === body.recordId)) return send(res, 404, { error: 'That job is gone.' });
        Object.assign(p, body.recordId ? { recordId: body.recordId, how: 'hand' } : { recordId: null, how: 'hand' });
        const brought = body.recordId ? await backfill(ws, c, String(body.projectId)) : 0;
        save();
        broadcast(ws.id, { type: 'companycam', forAdmins: true });
        return send(res, 200, { ...state(ws, auth), brought });
      }
      if (m === 'DELETE' && !b) {
        if (c.webhookId) await cc(unseal(c.token).t, 'DELETE', `/webhooks/${encodeURIComponent(c.webhookId)}`).catch(() => {});
        delete db.companycam[ws.id];
        save();
        broadcast(ws.id, { type: 'companycam', forAdmins: true });
        return send(res, 200, state(ws, auth));
      }
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // POST /api/companycam/hook/<key>: CompanyCam telling the team about a photo or project. Signed with the webhook's
  // secret (X-CompanyCam-Signature: base64 HMAC-SHA1 of the raw body); anything else is refused. Always a 200 once
  // the signature checks, so CompanyCam doesn't retry what Kloomie chose to skip.
  async function hook(req, res, key) {
    const chunks = [];
    let size = 0;
    for await (const ch of req) { size += ch.length; if (size > 2_000_000) return send(res, 413, { error: 'Too large' }); chunks.push(ch); }
    const wsId = Object.keys(db.companycam).find((id) => db.companycam[id].hookKey === key);
    const c = wsId && conn(wsId), ws = wsId && db.workspaces[wsId];
    if (!c || !ws || !/^[\w-]{10,64}$/.test(String(key))) return send(res, 404, { error: 'Not found' });
    const raw = Buffer.concat(chunks);
    const sig = String(req.headers['x-companycam-signature'] || '');
    const want = crypto.createHmac('sha1', unseal(c.secret).s).update(raw).digest('base64');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return send(res, 401, { error: 'Bad signature' });
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'Bad JSON' }); }
    c.lastEventAt = Date.now();
    const ev = String(body.event_type || ''), x = body.payload || {};
    try {
      if (ev === 'project.created' || ev === 'project.updated') {
        const p = upsertProject(ws, c, x);
        if (p) automate(ws.id, 'companycam.project', { recordId: p.recordId || null, text: p.name, note: p.address, who: cleanText(x.creator_name, 60) || 'CompanyCam', status: ev === 'project.created' ? 'created' : 'updated' });
        broadcast(ws.id, { type: 'companycam', forAdmins: true });
      } else if (ev === 'photo.created') {
        // A photo on a project Kloomie hasn't heard of yet: learn the project first.
        if (x.project_id && !c.projects[String(x.project_id)]) { const pr = await cc(unseal(c.token).t, 'GET', `/projects/${encodeURIComponent(x.project_id)}`).catch(() => null); if (pr) upsertProject(ws, c, pr); }
        await takePhoto(ws, c, x);
      }
    } catch (e) {
      alarm('CompanyCam delivery failed', e);
    }
    save();
    return send(res, 200, { ok: true });
  }

  // For the integrations registry (column-02's), the shape the integrations map asks for.
  const describe = { id: 'companycam', scope: 'team', auth: 'token', configured: () => true, status: (ws) => (conn(ws.id) ? (conn(ws.id).error ? 'attention' : 'on') : 'off') };
  // A team being erased: its webhook in CompanyCam goes too (Kloomie's own records go with the team's).
  async function forget(wsId) {
    const c = conn(wsId);
    if (c?.webhookId) await cc(unseal(c.token).t, 'DELETE', `/webhooks/${encodeURIComponent(c.webhookId)}`).catch(() => {});
  }
  return { route, hook, describe, state, forget };
}
