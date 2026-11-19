// Apps & Integrations: one registry of every app Kloomie connects to (docs/INTEGRATIONS-MAP.md §1, INTEGRATIONS-PLAN.md
// §3.1–3.2). Each integration registers how it's connected and where its state lives; GET /api/integrations answers
// for all of them in one call, for this person:
// - team ones (owners and admins connect them) show members only on/off, and only for tools switched on for them;
//   the account, who connected it, its last sync and its error go to owners and admins (visibility travels with the data).
// - person ones (each person their own) show that person's own connection, never anyone else's.
// Health: each status says lastSync, error and needsReconnect (a sign-in expired or was revoked). The tile then says
// Needs attention. When a connection goes bad, the person who connected it gets one notice for that spell, and
// a connection that's lost (needsReconnect) sets off the connection.lost automation trigger once. db.connHealth keeps
// what was last seen, so a restart doesn't tell anyone twice.
// "Want this?" on the apps that aren't built yet: db.appRequests, one per person per app; owners see the counts.
// Automations: a step that acts through a team connection needs its maker to be an owner or admin, when it's saved and
// again when it runs (map §1.3); teamStep() says which steps those are.

// Steps that act through a team connection, by kind -> the integration. Builders of new actions (slack, teams) add theirs.
export const TEAM_STEPS = { text: 'twilio', webhook: 'api', slack: 'slack', teams: 'teams' };
const WANT_IDS = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NOTICE_GAP = 6 * 3600_000; // a connection that goes bad again within 6 hours of being fixed isn't told twice

export function integrationsModule({ db, save, send, readJson, rid, cleanText, isAdmin, isAdminId, memberMay, toolOn, notify, automate, memberName }) {
  db.connHealth ||= {}; // `${wsId}:${id}[:${memberId}]` -> { bad, lost, since, toldAt, error } (a deleted team's go with it)
  db.appRequests ||= {}; // id -> { id, wsId, app, memberId, by, at }
  const REG = new Map();

  // d: { id, name, scope: 'team'|'person', auth: 'oauth'|'key'|'webhook'|'none', tool?, ready?, configured(), status(ws, memberId) }
  // ready: nothing to connect, it's there to use (Notion's import, the file pickers).
  // status returns null when not connected, else { account?, byId?, by?, lastSync?, error?, needsReconnect?, setup? }.
  // A module's own `describe` object registers as-is.
  function register(d) {
    if (!d?.id || REG.has(d.id)) throw new Error('integration ' + (d?.id || '?') + ' is missing or registered twice');
    REG.set(d.id, { scope: 'team', auth: 'none', configured: () => true, ...d });
    return d;
  }
  const safe = (f, dflt) => { try { return f(); } catch { return dflt; } };
  const statusOf = (d, ws, memberId) => safe(() => d.status(ws, memberId), null);
  const stateOf = (d, st) => (!st ? (safe(() => d.configured(), false) ? (d.ready ? 'ready' : 'off') : 'na') : st.needsReconnect || st.error ? 'error' : st.setup ? 'setup' : 'on');

  // What this person sees of every integration.
  function list(ws, auth) {
    const admin = isAdmin(auth);
    const out = [];
    for (const d of REG.values()) {
      if (d.tool && (!toolOn(ws, d.tool) || !memberMay(ws, auth, d.tool))) continue;
      const st = statusOf(d, ws, auth.memberId);
      const state = stateOf(d, st);
      const row = { id: d.id, name: d.name, scope: d.scope, auth: d.auth, state, configured: !!safe(() => d.configured(), false) };
      // Members see a team connection as on or off; what's wrong with it, and whose it is, is for owners and admins.
      if (d.scope === 'person' || admin) {
        if (st) Object.assign(row, { account: st.account || null, by: st.by || null, lastSync: st.lastSync || null, error: st.error || null, needsReconnect: !!st.needsReconnect, ...(st.setup ? { setup: String(st.setup) } : {}) });
      } else if (state === 'error' || state === 'setup') row.state = 'on';
      out.push(row);
    }
    const wants = Object.values(db.appRequests).filter((r) => r.wsId === ws.id);
    const mine = wants.filter((r) => r.memberId === auth.memberId).map((r) => r.app);
    const counts = {};
    for (const r of wants) counts[r.app] = (counts[r.app] || 0) + 1;
    return { apps: out, wanted: mine, ...(admin ? { wants: counts } : {}) };
  }

  // ---------- health: tell once when a connection goes bad ----------
  const key = (d, wsId, memberId) => `${wsId}:${d.id}${d.scope === 'person' ? ':' + memberId : ''}`;
  function watchOne(d, ws, memberId, st) {
    const k = key(d, ws.id, memberId);
    const was = db.connHealth[k];
    const bad = !!(st && (st.error || st.needsReconnect));
    if (!bad) {
      if (was?.bad) { was.bad = false; was.lost = false; was.fixedAt = Date.now(); save(); }
      return;
    }
    if (was?.bad && (!st.needsReconnect || was.lost)) return; // already told about this spell
    const h = db.connHealth[k] = { ...(was || {}), bad: true, lost: !!st.needsReconnect, since: was?.bad ? was.since : Date.now(), error: String(st.error || '').slice(0, 300) };
    const who = st.byId && ws.members.some((m) => m.id === st.byId) ? st.byId : d.scope === 'person' ? memberId : null;
    const firstTime = !was?.bad && !(was?.toldAt && Date.now() - was.toldAt < NOTICE_GAP && was.fixedAt && Date.now() - was.fixedAt < NOTICE_GAP);
    if (firstTime || (st.needsReconnect && !was?.lost)) {
      const text = st.needsReconnect ? `${d.name} needs to be connected again. ${h.error || 'Its sign-in expired or was removed.'}` : `${d.name} has a problem: ${h.error}`;
      const to = who ? [who] : ws.members.filter((m) => isAdminId(ws.id, m.id)).map((m) => m.id);
      for (const id of to) notify(ws.id, id, { title: `${d.name} needs attention`, text, kind: 'connection', go: 'app:' + d.id, key: 'conn:' + d.id });
      h.toldAt = Date.now();
    }
    if (st.needsReconnect && !was?.lost) automate(ws.id, 'connection.lost', { app: d.name, error: h.error, who: memberName(ws, who) || '', whoId: who, ownersOnly: d.scope === 'team' });
    save();
  }
  // Every team's team connections, and each member's own. Cheap: statuses are read from what's stored, no outside calls.
  function watch() {
    for (const ws of Object.values(db.workspaces)) {
      if (!ws || ws.deleteAt) continue;
      for (const d of REG.values()) {
        if (d.scope === 'team') watchOne(d, ws, null, statusOf(d, ws, null));
        else for (const m of ws.members || []) watchOne(d, ws, m.id, statusOf(d, ws, m.id));
      }
    }
  }

  // ---------- automations: team connections need an owner or admin, saved and run ----------
  const teamStep = (kind) => TEAM_STEPS[kind] || null;
  // Throws (with a message for the person) when this maker can't have this step.
  function stepAllowed(ws, makerId, kind, when = 'save') {
    const app = teamStep(kind);
    if (!app || isAdminId(ws.id, makerId)) return;
    const name = REG.get(app)?.name || 'a team connection';
    throw Object.assign(new Error(when === 'save' ? `Only owners and admins can have an automation use ${name}, the team’s connection.` : `its maker isn’t an owner or admin any more, and this step uses ${name}, the team’s connection`), { status: 400 });
  }

  // ---------- routes: /api/integrations and /api/integrations/apps/:id/want ----------
  async function route(req, res, parts, auth, ws) {
    const [, b, c, d] = parts;
    const m = req.method;
    if (!b && m === 'GET') { watchFor(ws, auth); return send(res, 200, list(ws, auth)); }
    if (b === 'apps' && c && d === 'want') {
      if (!WANT_IDS.test(c) || REG.has(c)) return send(res, 400, { error: 'That app is already here.' });
      const mine = Object.values(db.appRequests).find((r) => r.wsId === ws.id && r.app === c && r.memberId === auth.memberId);
      if (m === 'POST') {
        if (!mine) {
          if (Object.values(db.appRequests).filter((r) => r.wsId === ws.id && r.memberId === auth.memberId).length >= 60) return send(res, 429, { error: 'That’s a lot of apps asked for. Thanks!' });
          const body = await readJson(req, 2_000).catch(() => ({}));
          const r = { id: rid(), wsId: ws.id, app: c, name: cleanText(body?.name, 60) || c, memberId: auth.memberId, by: auth.member, at: Date.now() };
          db.appRequests[r.id] = r;
          save();
        }
        return send(res, 200, list(ws, auth));
      }
      if (m === 'DELETE') { if (mine) { delete db.appRequests[mine.id]; save(); } return send(res, 200, list(ws, auth)); }
    }
    return null;
  }
  // Opening the page checks what the person is looking at, so a broken tile and its notice agree.
  function watchFor(ws, auth) {
    for (const d of REG.values()) {
      if (d.scope === 'team') watchOne(d, ws, null, statusOf(d, ws, null));
      else watchOne(d, ws, auth.memberId, statusOf(d, ws, auth.memberId));
    }
  }
  // A member leaves: their wants go (their personal connections are removed by each module).
  function forget(wsId, memberId) {
    let n = 0;
    for (const [k, r] of Object.entries(db.appRequests)) if (r.wsId === wsId && (!memberId || r.memberId === memberId)) { delete db.appRequests[k]; n++; }
    for (const k of Object.keys(db.connHealth)) if (k.startsWith(wsId + ':') && (!memberId || k.split(':')[2] === memberId)) { delete db.connHealth[k]; n++; }
    if (n) save();
  }
  // Which apps a team had connected, for its export (never a token).
  const connectedFor = (ws) => [...REG.values()].filter((d) => d.scope === 'team' && statusOf(d, ws, null)).map((d) => d.name);

  return { register, list, route, watch, teamStep, stepAllowed, forget, connectedFor, has: (id) => REG.has(id) };
}
