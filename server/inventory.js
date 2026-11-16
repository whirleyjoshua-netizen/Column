// Inventory (Tools → Inventory): what the business keeps, where it is, and every time it moves.
//
// Items are the things (a part, a box of screws, a roll of wire), with a SKU, a category, a unit, a cost and a price,
// and a reorder point. Places are where stock sits: a warehouse, a truck, a job site. Each item keeps how many are at
// each place (item.stock[placeId]), and every change is a movement in the ledger (db.invMoves): received, moved, used
// on a job, returned, adjusted, counted, with who, when, and what it was for (a job, a task). Stock never goes below
// zero by a move; an adjustment or a count is how a correction is made, and it says why.
//
// Everyone on the team can see what's where and record what they move, use or bring back (crews pull stock). Owners
// and admins also manage the items and places, receive and adjust stock, and see costs, prices and the stock's value.
const ITEMS_MAX = 5000, PLACES_MAX = 200, MOVES_KEEP = 20_000;
const PLACE_KINDS = ['warehouse', 'truck', 'site', 'other'];
const MOVE_KINDS = ['receive', 'move', 'use', 'return', 'adjust', 'count'];
const MEMBER_MOVES = ['move', 'use', 'return'];
const QTY_MAX = 1e7;

export function inventoryModule({ db, save, broadcast, rid, cleanText, readJson, send, isAdmin, recordAt = () => null, taskOk = () => false, onMove = () => {} }) {
  db.invItems ||= {};
  db.invPlaces ||= {};
  db.invMoves ||= {};
  const itemsOf = (wsId) => Object.values(db.invItems).filter((x) => x.wsId === wsId && !x.archived);
  const placesOf = (wsId) => Object.values(db.invPlaces).filter((x) => x.wsId === wsId && !x.archived).sort((a, b) => a.createdAt - b.createdAt);
  const qty = (v) => Math.round(Number(String(v ?? '').replace(/[,\s]/g, '')) * 1000) / 1000;
  const cents = (v) => (v === '' || v == null ? null : Number.isFinite(Number(String(v).replace(/[$,\s]/g, ''))) ? Math.max(0, Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100)) : undefined);
  const total = (x) => Math.round(Object.values(x.stock || {}).reduce((n, v) => n + v, 0) * 1000) / 1000;
  const low = (x) => x.reorderAt != null && total(x) <= x.reorderAt;
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const news = (wsId) => broadcast(wsId, { type: 'inventory' });

  // What a person sees: costs, prices and value only for owners and admins.
  const publicItem = (x, admin) => {
    const { wsId, cost, price, ...rest } = x;
    return { ...rest, onHand: total(x), low: low(x), ...(admin ? { cost, price, value: x.cost != null ? Math.round(total(x) * x.cost) : null } : {}) };
  };
  const publicPlace = ({ wsId, ...x }) => x;
  const publicMove = ({ wsId, cost, ...x }, admin) => ({ ...x, ...(admin ? { cost } : {}) });

  function applyItem(x, b) {
    if (b.name !== undefined) x.name = cleanText(b.name, 120) || x.name || '';
    if (!x.name) throw err('Name the item.');
    if (b.sku !== undefined) x.sku = cleanText(b.sku, 60);
    if (b.category !== undefined) x.category = cleanText(b.category, 60);
    if (b.unit !== undefined) x.unit = cleanText(b.unit, 20) || 'each';
    if (b.supplier !== undefined) x.supplier = cleanText(b.supplier, 120);
    if (b.notes !== undefined) x.notes = String(b.notes ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
    for (const k of ['cost', 'price']) if (b[k] !== undefined) { const c = cents(b[k]); if (c === undefined) throw err(`The ${k} is a number of dollars, like 12.50.`); x[k] = c; }
    for (const k of ['reorderAt', 'reorderQty']) if (b[k] !== undefined) { if (b[k] === '' || b[k] == null) x[k] = null; else { const n = qty(b[k]); if (!(n >= 0 && n <= QTY_MAX)) throw err('Reorder numbers are 0 or more.'); x[k] = n; } }
    return x;
  }
  function applyPlace(p, b, ws) {
    if (b.name !== undefined) p.name = cleanText(b.name, 80) || p.name || '';
    if (!p.name) throw err('Name the place.');
    if (b.kind !== undefined) p.kind = PLACE_KINDS.includes(b.kind) ? b.kind : 'other';
    if (b.address !== undefined) p.address = cleanText(b.address, 200);
    if (b.memberId !== undefined) p.memberId = ws.members.some((m) => m.id === b.memberId) ? b.memberId : null;
    return p;
  }
  // The first place a team gets, made the first time it needs one.
  function firstPlace(ws, by) {
    const have = placesOf(ws.id)[0];
    if (have) return have;
    const p = { id: rid(), wsId: ws.id, name: 'Main storage', kind: 'warehouse', address: '', memberId: null, createdAt: Date.now(), by };
    db.invPlaces[p.id] = p;
    return p;
  }
  const placeOf = (ws, id) => { const p = id && db.invPlaces[id]; return p && p.wsId === ws.id && !p.archived ? p : null; };

  // One movement: checked, applied to the stock, written in the ledger. Returns the move.
  function move(ws, auth, b) {
    const kind = MOVE_KINDS.includes(b.kind) ? b.kind : null;
    if (!kind) throw err('Say what happened: received, moved, used, returned, adjusted or counted.');
    if (!isAdmin(auth) && !MEMBER_MOVES.includes(kind)) throw err('Only owners and admins can receive, adjust or count stock.', 403);
    const x = b.itemId && db.invItems[b.itemId];
    if (!x || x.wsId !== ws.id || x.archived) throw err('That item is gone.', 404);
    const wasLow = low(x);
    const n = qty(b.qty);
    const from = placeOf(ws, b.from), to = placeOf(ws, b.to);
    const at = (p) => x.stock[p.id] || 0;
    if (kind === 'adjust' ? !(Number.isFinite(n) && n !== 0 && Math.abs(n) <= QTY_MAX) : kind === 'count' ? !(n >= 0 && n <= QTY_MAX) : !(n > 0 && n <= QTY_MAX)) throw err(kind === 'adjust' ? 'Adjust by a number, like -2 or 5.' : kind === 'count' ? 'Enter how many you counted.' : 'Enter how many.');
    const note = cleanText(b.note, 300);
    if ((kind === 'adjust') && !note) throw err('Say why (damaged, found, a mistake…).');
    // What it was for: a job you can see, a task you can see.
    const job = b.jobId ? recordAt(String(b.jobId), ws.id, auth.memberId) : null;
    if (b.jobId && !job) throw err('That job is gone, or you can’t see it.', 404);
    const task = b.taskId && taskOk(auth, b.taskId) ? b.taskId : null;
    if (b.taskId && !task) throw err('That task is gone, or you can’t see it.', 404);
    let delta = 0, place = null, counted = null;
    if (kind === 'receive' || kind === 'return') { place = to || firstPlace(ws, auth.member); x.stock[place.id] = at(place) + n; delta = n; }
    else if (kind === 'use') { place = from; if (!place) throw err('Pick where it came from.'); if (at(place) < n) throw err(`Only ${at(place)} ${x.unit} at ${place.name}.`); x.stock[place.id] = at(place) - n; delta = -n; }
    else if (kind === 'move') {
      if (!from || !to) throw err('Pick where it’s moving from and to.');
      if (from.id === to.id) throw err('That’s the same place.');
      if (at(from) < n) throw err(`Only ${at(from)} ${x.unit} at ${from.name}.`);
      x.stock[from.id] = at(from) - n;
      x.stock[to.id] = at(to) + n;
    } else if (kind === 'adjust') { place = from || to; if (!place) throw err('Pick which place.'); if (at(place) + n < 0) throw err(`There are only ${at(place)} ${x.unit} at ${place.name}.`); x.stock[place.id] = at(place) + n; delta = n; }
    else if (kind === 'count') { place = from || to; if (!place) throw err('Pick which place you counted.'); counted = n; delta = n - at(place); x.stock[place.id] = n; }
    for (const [k, v] of Object.entries(x.stock)) x.stock[k] = Math.round(v * 1000) / 1000;
    if (kind === 'receive') { const c = cents(b.cost); if (c != null && c !== undefined) x.cost = c; }
    x.updatedAt = Date.now();
    const m = {
      id: rid(), wsId: ws.id, at: Date.now(), by: auth.member, byId: auth.memberId, itemId: x.id, kind, qty: kind === 'move' ? n : delta, ...(counted != null ? { counted } : {}),
      from: kind === 'move' ? from.id : kind === 'use' ? place.id : (kind === 'adjust' || kind === 'count') ? place.id : null,
      to: kind === 'move' ? to.id : (kind === 'receive' || kind === 'return') ? place.id : null,
      jobId: job ? job.rec.id : null, taskId: task, note, cost: x.cost ?? null,
    };
    db.invMoves[m.id] = m;
    trim(ws.id);
    save();
    news(ws.id);
    onMove(ws, m, x, { wasLow, low: low(x) });
    return m;
  }
  function trim(wsId) {
    const mine = Object.values(db.invMoves).filter((m) => m.wsId === wsId);
    if (mine.length <= MOVES_KEEP) return;
    mine.sort((a, b) => a.at - b.at);
    for (const m of mine.slice(0, mine.length - MOVES_KEEP)) delete db.invMoves[m.id];
  }

  async function route(req, res, parts, auth, ws) {
    const [a, b, c] = parts;
    if (a !== 'inventory') return null;
    const m = req.method;
    const admin = isAdmin(auth);
    try {
      if (m === 'GET' && !b) {
        const items = itemsOf(ws.id).sort((p, q) => p.name.localeCompare(q.name));
        return send(res, 200, { items: items.map((x) => publicItem(x, admin)), places: placesOf(ws.id).map(publicPlace), canManage: admin, low: items.filter(low).map((x) => x.id), value: admin ? items.reduce((n, x) => n + (x.cost != null ? Math.round(total(x) * x.cost) : 0), 0) : null });
      }
      if (b === 'items') {
        if (m === 'POST' && !c) {
          if (!admin) throw err('Only owners and admins add items.', 403);
          if (itemsOf(ws.id).length >= ITEMS_MAX) throw err(`A team can keep ${ITEMS_MAX.toLocaleString()} items.`);
          const body = await readJson(req, 20_000);
          const x = applyItem({ id: rid(), wsId: ws.id, name: '', sku: '', category: '', unit: 'each', supplier: '', notes: '', cost: null, price: null, reorderAt: null, reorderQty: null, stock: {}, createdAt: Date.now(), updatedAt: Date.now(), by: auth.member }, body);
          if (x.sku && itemsOf(ws.id).some((y) => y.sku && y.sku.toLowerCase() === x.sku.toLowerCase())) throw err(`Another item already has the SKU ${x.sku}.`);
          db.invItems[x.id] = x;
          // Starting stock, if it came with some: received into a place.
          const start = qty(body.onHand);
          if (start > 0) move(ws, auth, { kind: 'receive', itemId: x.id, qty: start, to: body.placeId, note: 'Starting stock' });
          else { save(); news(ws.id); }
          return send(res, 200, publicItem(x, admin));
        }
        const x = c && db.invItems[c];
        if (!x || x.wsId !== ws.id || x.archived) throw err('That item is gone.', 404);
        if (m === 'GET') return send(res, 200, { item: publicItem(x, admin), moves: Object.values(db.invMoves).filter((y) => y.itemId === x.id).sort((p, q) => q.at - p.at).slice(0, 200).map((y) => publicMove(y, admin)) });
        if (!admin) throw err('Only owners and admins change items.', 403);
        if (m === 'PATCH') {
          const body = await readJson(req, 20_000);
          applyItem(x, body);
          if (x.sku && itemsOf(ws.id).some((y) => y.id !== x.id && y.sku && y.sku.toLowerCase() === x.sku.toLowerCase())) throw err(`Another item already has the SKU ${x.sku}.`);
          x.updatedAt = Date.now();
          save(); news(ws.id);
          return send(res, 200, publicItem(x, admin));
        }
        // Deleting: an item with history is archived (its history stays); one never moved goes.
        if (m === 'DELETE') {
          if (total(x) > 0) throw err('It still has stock. Use it up, or count it to 0, first.');
          if (Object.values(db.invMoves).some((y) => y.itemId === x.id)) x.archived = true; else delete db.invItems[x.id];
          save(); news(ws.id);
          return send(res, 200, { ok: true });
        }
      }
      if (b === 'places') {
        if (m === 'POST' && !c) {
          if (!admin) throw err('Only owners and admins add places.', 403);
          if (placesOf(ws.id).length >= PLACES_MAX) throw err(`A team can have ${PLACES_MAX} places.`);
          const p = applyPlace({ id: rid(), wsId: ws.id, name: '', kind: 'warehouse', address: '', memberId: null, createdAt: Date.now(), by: auth.member }, await readJson(req, 10_000), ws);
          db.invPlaces[p.id] = p;
          save(); news(ws.id);
          return send(res, 200, publicPlace(p));
        }
        const p = placeOf(ws, c);
        if (!p) throw err('That place is gone.', 404);
        if (!admin) throw err('Only owners and admins change places.', 403);
        if (m === 'PATCH') { applyPlace(p, await readJson(req, 10_000), ws); save(); news(ws.id); return send(res, 200, publicPlace(p)); }
        if (m === 'DELETE') {
          if (itemsOf(ws.id).some((x) => (x.stock[p.id] || 0) > 0)) throw err(`There’s still stock at ${p.name}. Move it first.`);
          if (Object.values(db.invMoves).some((y) => y.from === p.id || y.to === p.id)) p.archived = true; else delete db.invPlaces[p.id];
          save(); news(ws.id);
          return send(res, 200, { ok: true });
        }
      }
      if (b === 'moves') {
        if (m === 'POST' && !c) return send(res, 200, publicMove(move(ws, auth, await readJson(req, 10_000)), admin));
        if (m === 'GET' && !c) {
          const u = new URL(req.url, 'http://x');
          const f = Object.fromEntries(['item', 'place', 'job', 'task'].map((k) => [k, u.searchParams.get(k)]));
          const list = Object.values(db.invMoves).filter((y) => y.wsId === ws.id && (!f.item || y.itemId === f.item) && (!f.place || y.from === f.place || y.to === f.place) && (!f.job || y.jobId === f.job) && (!f.task || y.taskId === f.task));
          return send(res, 200, list.sort((p, q) => q.at - p.at).slice(0, Math.min(500, Number(u.searchParams.get('limit')) || 200)).map((y) => publicMove(y, admin)));
        }
      }
      return send(res, 405, { error: 'Method not allowed' });
    } catch (e) {
      if (!e.status) throw e;
      return send(res, e.status, { error: e.message });
    }
  }

  return { route, move, itemsOf, placesOf, total, low, publicItem };
}
