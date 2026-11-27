// Whiteboard (the owner, 2026-11-19, via column-91): a visual planning board in Tools. Not a drawing app: stickies,
// text, shapes, frames that hold things, pictures and files the team already uploaded, and cards that are live links
// to a real task, campaign step, record, contact or doc; arrows between them, with a label.
// Shared: everyone who can see a board edits it, and changes reach the others over the socket within a second. Last
// write wins, per item (a change only sends the fields it changes). Who's looking is shown; no live cursors.
// Who sees a board: a campaign's board follows the campaign (seesCampaign); others are the team's, or private to
// whoever made it. When the team has members see only what's theirs, a member sees the team boards they made.
// Limits: 2,000 items and 4,000 arrows a board, 500 changes in one go, 300 boards a team. Text is kept as text.
// A deleted board waits 30 days in Deleted (its maker or an admin restores it), then it's gone.
const KINDS = ['sticky', 'text', 'shape', 'frame', 'file', 'card'];
const SHAPES = ['rect', 'ellipse', 'diamond'];
const REF_KINDS = ['task', 'goal', 'record', 'contact', 'doc'];
const COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange', 'gray', 'white'];
const TEMPLATES = ['blank', 'phases', 'workflow', 'brainstorm', 'mindmap'];
const MAX_ITEMS = 2000, MAX_LINKS = 4000, MAX_OPS = 500, MAX_BOARDS = 300, TEXT_MAX = 4000;
const TRASH_DAYS = 30;
const SPAN = 200_000; // how far from the middle anything can sit
const ID = /^[\w-]{4,40}$/;
// Who a message about a board goes to is worked out from the board as it was when it was sent (a symbol, so it's
// never put in the message itself): a board just deleted or made private still tells the people who could see it.
const SEEN = Symbol('board');

export function whiteboardModule({ db, save, send, readJson, cleanText, rid, broadcast, sockets, isAdmin, isAdminId, seesCampaign, ownOnly, toolsOf, memberMay }) {
  db.boards ||= {};
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
  const text = (v) => String(v ?? '').replace(/\r\n?/g, '\n').slice(0, TEXT_MAX);

  // ----- who sees what -----
  function sees(b, memberId) {
    if (!b || b.trashedAt) return false;
    if (!db.workspaces[b.wsId]?.members.some((m) => m.id === memberId)) return false;
    if (b.campaignId) return !!db.campaigns[b.campaignId] && seesCampaign(b.campaignId, memberId);
    if (b.private) return b.memberId === memberId;
    if (ownOnly(b.wsId, memberId)) return b.memberId === memberId;
    return true;
  }
  const mayManage = (b, auth) => b.memberId === auth.memberId || isAdmin(auth);

  // ----- what's kept -----
  // A thing a card points at, if it's this team's (what it says comes from the viewer's own app, so a card never
  // shows anyone something they couldn't already see).
  function refOk(wsId, ref) {
    if (!ref || !REF_KINDS.includes(ref.kind) || !ID.test(ref.id || '')) return null;
    const x = ref.kind === 'task' ? db.tasks[ref.id] : ref.kind === 'goal' ? db.goals[ref.id] : ref.kind === 'record' ? db.records[ref.id] : ref.kind === 'contact' ? db.contacts[ref.id] : db.items[ref.id];
    if (!x || x.wsId !== wsId || (ref.kind === 'doc' && x.type !== 'text')) return null;
    return { kind: ref.kind, id: ref.id };
  }
  const fileOk = (wsId, id) => (ID.test(id || '') && db.items[id]?.wsId === wsId && db.items[id].type === 'file' ? id : null);
  // An item as sent: only the fields given change (so two people moving and retyping the same sticky don't undo each
  // other). A new one needs its kind.
  function cleanItem(b, raw, by) {
    if (!raw || typeof raw !== 'object' || !ID.test(raw.id || '')) return null;
    const had = b.items[raw.id];
    const kind = had ? had.kind : raw.kind;
    if (!KINDS.includes(kind)) return null;
    const x = had ? { ...had } : { id: raw.id, kind, x: 0, y: 0, w: kind === 'frame' ? 640 : kind === 'text' ? 240 : 200, h: kind === 'frame' ? 420 : kind === 'text' ? 60 : kind === 'card' ? 90 : 200, text: '', color: kind === 'sticky' ? 'yellow' : kind === 'frame' ? 'gray' : 'white', z: 0 };
    if ('x' in raw) x.x = num(raw.x, -SPAN, SPAN, x.x);
    if ('y' in raw) x.y = num(raw.y, -SPAN, SPAN, x.y);
    if ('w' in raw) x.w = num(raw.w, 20, 20_000, x.w);
    if ('h' in raw) x.h = num(raw.h, 20, 20_000, x.h);
    if ('z' in raw) x.z = num(raw.z, -1e9, 1e9, x.z);
    if ('text' in raw) x.text = text(raw.text);
    if ('color' in raw && COLORS.includes(raw.color)) x.color = raw.color;
    if (kind === 'shape') x.shape = SHAPES.includes(raw.shape) ? raw.shape : x.shape || 'rect';
    if ('parentId' in raw) x.parentId = raw.parentId && raw.parentId !== x.id && b.items[raw.parentId]?.kind === 'frame' ? raw.parentId : null;
    if (kind === 'card' && ('ref' in raw || !had)) { x.ref = refOk(b.wsId, raw.ref); if (!x.ref) return null; }
    if (kind === 'file' && ('fileId' in raw || !had)) { x.fileId = fileOk(b.wsId, raw.fileId); if (!x.fileId) return null; }
    if (kind === 'frame' && x.parentId) x.parentId = null; // frames don't nest
    x.by = by;
    x.at = Date.now();
    return x;
  }
  function cleanLink(b, raw) {
    if (!raw || typeof raw !== 'object' || !ID.test(raw.id || '')) return null;
    const had = b.links[raw.id];
    const from = had ? had.from : raw.from, to = had ? had.to : raw.to;
    if (!b.items[from] || !b.items[to] || from === to) return null;
    const l = had ? { ...had } : { id: raw.id, from, to, label: '' };
    if ('label' in raw) l.label = cleanText(raw.label, 120);
    l.at = Date.now();
    return l;
  }
  // A batch of changes, in order; what was taken back comes back so everyone shows the same.
  function applyOps(b, ops, auth) {
    const done = [];
    for (const o of ops.slice(0, MAX_OPS)) {
      if (!o || typeof o !== 'object') continue;
      if (o.op === 'put' && o.item) {
        if (!b.items[o.item.id] && Object.keys(b.items).length >= MAX_ITEMS) throw Object.assign(new Error(`A board holds up to ${MAX_ITEMS.toLocaleString()} things. Make another board for the rest.`), { status: 400 });
        const x = cleanItem(b, o.item, auth.member);
        if (x) { b.items[x.id] = x; done.push({ op: 'put', item: x }); }
      } else if (o.op === 'del' && typeof o.item === 'string' && b.items[o.item]) {
        delete b.items[o.item];
        done.push({ op: 'del', item: o.item });
        for (const l of Object.values(b.links)) if (l.from === o.item || l.to === o.item) { delete b.links[l.id]; done.push({ op: 'del', link: l.id }); }
        for (const y of Object.values(b.items)) if (y.parentId === o.item) { y.parentId = null; done.push({ op: 'put', item: y }); }
      } else if (o.op === 'put' && o.link) {
        if (!b.links[o.link.id] && Object.keys(b.links).length >= MAX_LINKS) throw Object.assign(new Error('That’s as many arrows as a board holds.'), { status: 400 });
        const l = cleanLink(b, o.link);
        if (l) { b.links[l.id] = l; done.push({ op: 'put', link: l }); }
      } else if (o.op === 'del' && typeof o.link === 'string' && b.links[o.link]) {
        delete b.links[o.link];
        done.push({ op: 'del', link: o.link });
      }
    }
    return done;
  }

  // ----- templates: a start, made of ordinary items -----
  function seed(b, tpl, by) {
    const ops = [];
    let n = 0;
    const id = () => rid() + (n++).toString(36);
    const put = (item) => { const x = { id: id(), ...item }; ops.push({ op: 'put', item: x }); return x.id; };
    const link = (from, to, label = '') => ops.push({ op: 'put', link: { id: id(), from, to, label } });
    if (tpl === 'phases' && b.campaignId) {
      // Phases & tasks (2026-11-25, campaign Sketch): the campaign's phases as live cards in a row, each one's top-level
      // tasks as live cards under it (12 at most), and an arrow for each "waits for". An empty campaign gets three boxes
      // to name. Cards only point at things; each viewer's app shows what they may see.
      const byOrder = (a, b2) => (a.order ?? 0) - (b2.order ?? 0) || (a.createdAt || 0) - (b2.createdAt || 0);
      // 60 phases at most (13 items each stays well inside a board's MAX_ITEMS); tasks grouped once, not per phase.
      const phases = Object.values(db.goals).filter((g) => g.campaignId === b.campaignId && !['count', 'money'].includes(g.kind)).sort(byOrder).slice(0, 60);
      if (phases.length) {
        const ids = new Set(phases.map((g) => g.id)), tasksOf = new Map();
        for (const t of Object.values(db.tasks)) if (ids.has(t.goalId) && !t.parentId) (tasksOf.get(t.goalId) || tasksOf.set(t.goalId, []).get(t.goalId)).push(t);
        const cardOf = new Map();
        phases.forEach((g, i) => {
          cardOf.set(g.id, put({ kind: 'card', x: i * 300, y: 0, w: 240, h: 90, ref: { kind: 'goal', id: g.id }, z: 1 }));
          (tasksOf.get(g.id) || []).sort(byOrder).slice(0, 12)
            .forEach((t, j) => put({ kind: 'card', x: i * 300, y: 130 + j * 100, w: 240, h: 80, ref: { kind: 'task', id: t.id }, z: 1 }));
        });
        for (const g of phases) for (const w of g.blockedBy || []) if (cardOf.has(w) && w !== g.id) link(cardOf.get(w), cardOf.get(g.id));
      } else {
        let prev = null;
        for (let i = 0; i < 3; i++) {
          const k = put({ kind: 'shape', shape: 'rect', x: i * 300, y: 0, w: 240, h: 90, text: `Phase ${i + 1}`, color: 'white', z: 1 });
          if (prev) link(prev, k);
          prev = k;
        }
        put({ kind: 'text', x: -320, y: 0, w: 260, h: 120, text: 'Name each phase in its box. Put a sticky under a phase for each task, then Update plan.', z: 1 });
      }
    } else if (tpl === 'workflow') {
      const f = put({ kind: 'frame', x: -80, y: -120, w: 1400, h: 420, text: 'How the work flows', z: 0 });
      const steps = ['Lead comes in', 'Quote it', 'Book the job', 'Do the work', 'Get paid'];
      let prev = null;
      steps.forEach((s, i) => {
        const k = put({ kind: 'shape', shape: i === 2 ? 'diamond' : 'rect', x: i * 260, y: 0, w: 200, h: 120, text: s, color: i === 4 ? 'green' : 'white', parentId: f, z: 1 });
        if (prev) link(prev, k, i === 3 ? 'when booked' : '');
        prev = k;
      });
      put({ kind: 'sticky', x: 0, y: 340, w: 200, h: 160, text: 'Who does each step?', color: 'yellow', z: 2 });
      put({ kind: 'sticky', x: 260, y: 340, w: 200, h: 160, text: 'Where does it get stuck?', color: 'pink', z: 2 });
    } else if (tpl === 'brainstorm') {
      const cols = [['Goal', 'blue', 'What should this campaign get us?'], ['Who we’re reaching', 'purple', 'Who are they, and where are they?'], ['Ideas', 'yellow', 'Any idea, big or small'], ['Next steps', 'green', 'What we’ll do first']];
      cols.forEach(([title, color, hint], i) => {
        const f = put({ kind: 'frame', x: i * 420, y: 0, w: 380, h: 640, text: title, z: 0 });
        put({ kind: 'sticky', x: i * 420 + 30, y: 70, w: 200, h: 160, text: hint, color, parentId: f, z: 1 });
      });
    } else if (tpl === 'mindmap') {
      const mid = put({ kind: 'shape', shape: 'ellipse', x: 0, y: 0, w: 260, h: 140, text: 'The big idea', color: 'blue', z: 1 });
      const at = [[-420, -240], [420, -240], [-420, 240], [420, 240]];
      at.forEach(([x, y], i) => {
        const k = put({ kind: 'sticky', x: x + 30, y: y - 10, w: 200, h: 160, text: `Branch ${i + 1}`, color: ['yellow', 'green', 'pink', 'orange'][i], z: 1 });
        link(mid, k);
      });
    }
    // In batches: one batch takes at most MAX_OPS changes, and a big campaign's start has more.
    for (let i = 0; i < ops.length; i += MAX_OPS) applyOps(b, ops.slice(i, i + MAX_OPS), { member: by });
  }

  // ----- what goes to the app -----
  const summary = (b) => ({ id: b.id, name: b.name, campaignId: b.campaignId || null, memberId: b.memberId, by: b.by, private: !!b.private, items: Object.keys(b.items).length, createdAt: b.createdAt, updatedAt: b.updatedAt, trashedAt: b.trashedAt || null });
  const full = (b) => ({ ...summary(b), items: Object.values(b.items), links: Object.values(b.links), rev: b.rev || 0 });
  const tell = (b, msg) => broadcast(b.wsId, { ...msg, boardId: b.id, [SEEN]: b });
  // broadcast()'s check, for each person.
  const seesMsg = (msg, memberId) => !msg.boardId || (msg.notFor !== memberId && sees(msg[SEEN] || db.boards[msg.boardId], memberId));

  // Who has a board open (each window says so over its socket), like a doc's "who's here".
  function here(wsId, boardId) {
    if (!boardId) return;
    const b = db.boards[boardId];
    const people = new Map();
    for (const s of sockets.get(wsId) || []) {
      const w = s.meta.board;
      if (w?.id !== boardId || s.readyState !== 1 || !sees(b, s.meta.memberId)) continue;
      people.set(s.meta.memberId, { memberId: s.meta.memberId, name: s.meta.member, at: w.at });
    }
    if (b) tell(b, { type: 'board:here', id: boardId, people: [...people.values()] });
  }
  // A window opening or leaving a board.
  function onSocket(s, msg, wsId) {
    const was = s.meta.board?.id;
    const b = typeof msg.id === 'string' && db.boards[msg.id];
    const id = b && b.wsId === wsId && sees(b, s.meta.memberId) ? b.id : null;
    s.meta.board = id ? { id, at: Date.now() } : null;
    if (was && was !== id) here(wsId, was);
    here(wsId, id);
  }

  // Deleted ones go for good after 30 days.
  function sweep(now = Date.now()) {
    let gone = 0;
    for (const b of Object.values(db.boards)) if (b.trashedAt && b.trashedAt < now - TRASH_DAYS * 864e5) { delete db.boards[b.id]; gone++; }
    if (gone) save();
    return gone;
  }

  async function route(req, res, parts, auth, ws) {
    const [, id, act] = parts;
    const m = req.method;
    if (!toolsOf(ws).whiteboard) return send(res, 403, { error: 'Whiteboard is switched off for this team (Apps & Integrations → Kloomie apps).' });
    if (!memberMay(ws, auth, 'whiteboard')) return send(res, 403, { error: 'Your team’s owners and admins have turned Whiteboard off for members.' });
    const mine = () => Object.values(db.boards).filter((b) => b.wsId === ws.id);
    if (!id && m === 'GET') {
      const url = new URL(req.url, 'http://x');
      const camp = url.searchParams.get('campaign');
      const list = mine().filter((b) => sees(b, auth.memberId) && (!camp || b.campaignId === camp)).sort((a, b) => b.updatedAt - a.updatedAt).map(summary);
      const trash = mine().filter((b) => b.trashedAt && mayManage(b, auth) && (!b.campaignId || seesCampaign(b.campaignId, auth.memberId)) && (!b.private || b.memberId === auth.memberId)).map(summary);
      return send(res, 200, { boards: list, trash });
    }
    if (!id && m === 'POST') {
      const body = await readJson(req, 10_000);
      if (mine().length >= MAX_BOARDS) return send(res, 400, { error: `A team can have up to ${MAX_BOARDS} whiteboards. Delete some you’re done with first.` });
      const campaignId = body.campaignId ? String(body.campaignId) : null;
      if (campaignId && (db.campaigns[campaignId]?.wsId !== ws.id || !seesCampaign(campaignId, auth.memberId))) return send(res, 404, { error: 'That campaign isn’t here.' });
      const tpl = TEMPLATES.includes(body.template) ? body.template : 'blank';
      const now = Date.now();
      const b = { id: rid(), wsId: ws.id, name: cleanText(body.name, 120) || (campaignId ? `${db.campaigns[campaignId].name} board` : 'Untitled board'), campaignId, memberId: auth.memberId, by: auth.member, private: !campaignId && body.private === true, items: {}, links: {}, createdAt: now, updatedAt: now, rev: 0 };
      seed(b, tpl, auth.member);
      db.boards[b.id] = b;
      save();
      tell(b, { type: 'board:list', board: summary(b) });
      return send(res, 200, full(b));
    }
    const b = db.boards[id];
    if (!b || b.wsId !== ws.id) return send(res, 404, { error: 'That board is gone.' });
    if (act === 'restore' && m === 'POST') {
      if (!b.trashedAt || !mayManage(b, auth) || (b.private && b.memberId !== auth.memberId)) return send(res, 404, { error: 'That board is gone.' });
      b.trashedAt = null;
      b.updatedAt = Date.now();
      save();
      tell(b, { type: 'board:list', board: summary(b) });
      return send(res, 200, full(b));
    }
    if (!sees(b, auth.memberId)) return send(res, 404, { error: 'That board is gone.' });
    if (!act && m === 'GET') return send(res, 200, full(b));
    if (!act && m === 'PATCH') {
      const body = await readJson(req, 4_000);
      if (body.name !== undefined) b.name = cleanText(body.name, 120) || b.name;
      if (body.private !== undefined) {
        if (!mayManage(b, auth)) return send(res, 403, { error: 'Only whoever made the board and team admins can change who sees it.' });
        if (b.campaignId) return send(res, 400, { error: 'A campaign’s board is seen by whoever sees the campaign.' });
        if (body.private === true && b.memberId !== auth.memberId) return send(res, 400, { error: 'Only whoever made the board can make it private.' });
        const was = !!b.private;
        b.private = body.private === true;
        if (was !== b.private && b.private) tell({ ...b, private: false }, { type: 'board:gone', id: b.id, why: 'private', notFor: b.memberId });
      }
      b.updatedAt = Date.now();
      save();
      tell(b, { type: 'board:list', board: summary(b) });
      return send(res, 200, summary(b));
    }
    if (!act && m === 'DELETE') {
      if (!mayManage(b, auth)) return send(res, 403, { error: 'Only whoever made the board and team admins can delete it.' });
      const was = { ...b };
      b.trashedAt = Date.now();
      save();
      tell({ ...was, trashedAt: null }, { type: 'board:gone', id: b.id });
      return send(res, 200, summary(b));
    }
    if (act === 'ops' && m === 'POST') {
      const body = await readJson(req, 2_000_000);
      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (ops.length > MAX_OPS) return send(res, 400, { error: `At most ${MAX_OPS} changes at once.` });
      let done;
      try { done = applyOps(b, ops, auth); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
      if (done.length) {
        b.updatedAt = Date.now();
        b.rev = (b.rev || 0) + 1;
        save();
        tell(b, { type: 'board', id: b.id, ops: done, by: auth.member, memberId: auth.memberId, sid: typeof body.sid === 'string' ? body.sid.slice(0, 40) : null, rev: b.rev });
      }
      return send(res, 200, { ok: true, ops: done, rev: b.rev || 0 });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // Someone leaves: their private boards go; the team's they made pass to an owner (heir), as with projects.
  function memberGone(wsId, memberId, heirId) {
    for (const b of Object.values(db.boards)) {
      if (b.wsId !== wsId || b.memberId !== memberId) continue;
      if (b.private) delete db.boards[b.id];
      else b.memberId = heirId || null;
    }
  }
  // For an owner's team export: the boards as they are (not the deleted ones).
  const exported = (wsId) => Object.values(db.boards).filter((b) => b.wsId === wsId && !b.trashedAt).map(full);
  return { route, sees, seesMsg, memberGone, here, onSocket, sweep, exported, applyOps, KINDS, COLORS, TEMPLATES };
}
