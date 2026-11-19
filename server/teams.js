// Microsoft Teams (docs/INTEGRATIONS-MAP.md §2, the owner via column-14, 2026-11-19): post to a channel.
// The team pastes the address of a Teams Workflows flow ("Post to a channel when a webhook request is received"):
// no Microsoft app, no sign-in, no review. Owners and admins connect it; the address is a secret (it carries the
// flow's signature), so it's sealed and never sent back to anyone. Kloomie only ever posts; nothing comes back in.
// Who posts: automations made by owners/admins (TEAM_STEPS 'teams', checked when saved and when run), and people
// (their AI team drafts, they say yes) through POST /api/teams/post. At most 60 posts an hour a team.
// Health: Teams answering 401/403/404 means the flow was deleted, turned off or its address changed: needsReconnect,
// cleared by the next good post.

// Where Teams Workflows addresses live: Power Automate (newer) and Logic Apps (older); the retired Office 365
// connectors (webhook.office.com) still accepted while some keep working.
const HOSTS = [/\.logic\.azure\.com$/i, /\.api\.powerplatform\.com$/i, /\.webhook\.office\.com$/i];
const HOUR_MAX = 60;
const TEXT_MAX = 4000;

// A Teams Workflows address, or why it isn't one (exported for its test).
export function checkTeamsUrl(raw, allowLocal = false) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw Object.assign(new Error('Paste the whole address Teams gave you (it starts with https://).'), { status: 400 }); }
  if (u.protocol !== 'https:' && !(allowLocal && u.protocol === 'http:')) throw Object.assign(new Error('The address has to start with https://'), { status: 400 });
  if (!allowLocal && !HOSTS.some((re) => re.test(u.hostname))) throw Object.assign(new Error('That isn’t a Teams Workflows address. In Teams, copy the address the “Post to a channel when a webhook request is received” workflow shows (it has logic.azure.com or powerplatform.com in it).'), { status: 400 });
  if (u.username || u.password || u.href.length > 2000) throw Object.assign(new Error('That address doesn’t look right.'), { status: 400 });
  return u;
}

export function teamsModule({ db, save, send, readJson, cleanText, seal, unseal, isAdmin, safeFetch, broadcast, allowLocal = false }) {
  db.teams ||= {}; // wsId -> { url: sealed, host, channel, memberId, by, at, lastPostAt, posts, error, needsReconnect, recent: [times] }
  const conn = (wsId) => db.teams[wsId] || null;

  // What a Teams channel shows: an Adaptive Card with the words, as the Workflows template expects. The words are
  // data: a markdown link can't be made out of them ("](" is broken up), so a lead's name can't become a link.
  const card = (text, by) => ({
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [{ type: 'TextBlock', text: String(text).replace(/\]\(/g, '] ('), wrap: true }, ...(by ? [{ type: 'TextBlock', text: by, isSubtle: true, size: 'Small', wrap: true, spacing: 'Small' }] : [])],
    } }],
  });
  async function deliver(url, text, by) {
    let r;
    try {
      r = await safeFetch(url, { method: 'POST', allowLocal, httpsOnly: !allowLocal, timeout: 10_000, maxBytes: 8_000, truncate: true, headers: { 'Content-Type': 'application/json', 'User-Agent': 'Kloomie/1' }, body: JSON.stringify(card(text, by)) });
    } catch (e) {
      throw Object.assign(new Error(`Teams couldn’t be reached (${e.code === 'BLOCKED' ? 'that address isn’t allowed' : String(e.message || '').slice(0, 80)})`), { retry: e.code !== 'BLOCKED' });
    }
    if (r.status === 401 || r.status === 403 || r.status === 404) throw Object.assign(new Error('Teams refused the address: the workflow was deleted, turned off or changed. Make it again in Teams and paste the new address.'), { lost: true });
    if (r.status >= 300) throw Object.assign(new Error(`Teams said ${r.status}${r.status === 429 ? ' (too many posts just now)' : ''}`), { retry: r.status >= 500 || r.status === 429 });
  }
  // Posts for the team (an automation, or someone's yes): counted, health kept.
  async function post(ws, text, { by = '' } = {}) {
    const c = conn(ws.id);
    if (!c) throw Object.assign(new Error('Microsoft Teams isn’t connected. An owner or admin connects it in Apps & Integrations.'), { status: 400 });
    const words = String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, TEXT_MAX);
    if (!words) throw Object.assign(new Error('Nothing to post.'), { status: 400 });
    const now = Date.now();
    c.recent = (c.recent || []).filter((t) => t > now - 3600_000);
    if (c.recent.length >= HOUR_MAX) throw Object.assign(new Error(`That’s ${HOUR_MAX} posts to Teams this hour. The rest wait for the next hour.`), { status: 429, retry: true });
    try {
      await deliver(unseal(c.url).u, words, by);
    } catch (e) {
      c.error = e.message;
      if (e.lost) c.needsReconnect = true;
      save();
      broadcast(ws.id, { type: 'teams' });
      throw e;
    }
    c.recent.push(now);
    Object.assign(c, { lastPostAt: now, posts: (c.posts || 0) + 1, error: null, needsReconnect: false });
    save();
    return { ok: true };
  }
  // What the tile shows: owners and admins see whose it is and what's wrong; members only whether it's on.
  function state(ws, auth) {
    const c = conn(ws.id);
    if (!c) return { connected: false };
    if (!isAdmin(auth)) return { connected: true, channel: c.channel || '' };
    return { connected: true, channel: c.channel || '', host: c.host, by: c.by, at: c.at, lastPostAt: c.lastPostAt || null, posts: c.posts || 0, error: c.error || null, needsReconnect: !!c.needsReconnect };
  }

  async function route(req, res, parts, auth, ws) {
    const [, b] = parts;
    const m = req.method;
    const fail = (e) => send(res, e.status || (e.lost ? 400 : 502), { error: e.message });
    if (!b && m === 'GET') return send(res, 200, state(ws, auth));
    // Anyone on the team, when it's connected: what their AI team drafted and they said yes to.
    if (b === 'post' && m === 'POST') {
      const body = await readJson(req, 20_000);
      try { await post(ws, body.text, { by: `From ${auth.member} in Kloomie` }); } catch (e) { return fail(e); }
      return send(res, 200, { ok: true });
    }
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only owners and admins can connect Microsoft Teams.' });
    if (!b && m === 'PUT') {
      const body = await readJson(req, 10_000);
      let u;
      try { u = checkTeamsUrl(body.url, allowLocal); } catch (e) { return fail(e); }
      const channel = cleanText(body.channel, 80);
      // A real, harmless post first: if Teams takes it, the address works.
      try { await deliver(u.href, `✓ Kloomie is connected${channel ? ` to ${channel}` : ''}. Automations (and your AI team, after a yes) can post here.`, `Connected by ${auth.member}`); } catch (e) { return fail(e); }
      db.teams[ws.id] = { url: seal({ u: u.href }), host: u.hostname, channel, memberId: auth.memberId, by: auth.member, at: Date.now(), lastPostAt: Date.now(), posts: 1, error: null, needsReconnect: false, recent: [Date.now()] };
      save();
      broadcast(ws.id, { type: 'teams' });
      return send(res, 200, state(ws, auth));
    }
    if (b === 'test' && m === 'POST') {
      try { await post(ws, 'Test from Kloomie ✓', { by: `Sent by ${auth.member}` }); } catch (e) { return fail(e); }
      return send(res, 200, state(ws, auth));
    }
    if (!b && m === 'DELETE') {
      delete db.teams[ws.id];
      save();
      broadcast(ws.id, { type: 'teams' });
      return send(res, 200, { connected: false });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // For the registry (integrations.js): from what's stored, no outside calls.
  const describe = { id: 'teams', name: 'Microsoft Teams', scope: 'team', auth: 'webhook',
    status: (ws) => { const c = conn(ws.id); return c && { account: c.channel || c.host, by: c.by, byId: ws.members.some((x) => x.id === c.memberId) ? c.memberId : null, lastSync: c.lastPostAt || null, error: c.error || null, needsReconnect: !!c.needsReconnect }; } };
  return { route, post, state, describe, connected: (ws) => !!conn(ws.id) };
}
