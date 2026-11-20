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
//
// Equipment (step 2): an item can be tracked one by one instead of by count (track 'units'): each unit is its own
// thing with a serial number, a QR label (/a/<tag>, the same labels Equipment & assets used), a status (available,
// out, in repair, lost, retired), where it is (a place, or out with someone or at a job), where it was last scanned,
// and a lock combo kept sealed (shown on request, every look logged). Its count at each place is worked out from its
// units. Checking out, returning, moving, reporting a problem and every scan are in the same ledger.
const ITEMS_MAX = 5000, PLACES_MAX = 200, MOVES_KEEP = 20_000;
const PLACE_KINDS = ['warehouse', 'truck', 'site', 'other'];
// What a place's label says it is.
const PLACE_WORD = { warehouse: 'Warehouse', truck: 'Truck', site: 'Job site', other: 'Place' };
const MOVE_KINDS = ['receive', 'move', 'use', 'return', 'adjust', 'count'];
const MEMBER_MOVES = ['move', 'use', 'return'];
const UNIT_STATUS = ['available', 'out', 'repair', 'lost', 'retired'];
const UNITS_PER_ITEM = 2000, REVEALS_AN_HOUR = 30;
const QTY_MAX = 1e7;

export function inventoryModule({ db, save, broadcast, rid, cleanText, readJson, send, isAdmin, recordAt = () => null, onRequest = () => {}, onPrice = () => {}, feedOk = () => false, memberOk = () => false, taskOk = () => false, onMove = () => {}, onUnit = () => {}, seal = (x) => x, unseal = (x) => x, newTag = () => null, labelUrl = (t) => '/a/' + t, labelQr = () => null, projectFor = () => null }) {
  db.invItems ||= {};
  db.invPlaces ||= {};
  db.invMoves ||= {};
  db.invUnits ||= {};
  db.invOrders ||= {};
  db.invRequests ||= {};
  // Moves made in the same millisecond keep their order: each gets the next number.
  let seq = Object.values(db.invMoves).reduce((n, m) => Math.max(n, m.n || 0), 0);
  const newest = (p, q) => q.at - p.at || (q.n || 0) - (p.n || 0);
  const looks = new Map();
  const unitsOf = (itemId) => Object.values(db.invUnits).filter((u) => u.itemId === itemId);
  const live = (u) => u.status !== 'lost' && u.status !== 'retired';
  // A unit-tracked item's count at each place: its units there (available or in repair).
  const unitStock = (x) => { const out = {}; for (const u of unitsOf(x.id)) if (u.placeId && (u.status === 'available' || u.status === 'repair')) out[u.placeId] = (out[u.placeId] || 0) + 1; return out; };
  const unitCounts = (x) => { const c = { available: 0, out: 0, repair: 0, lost: 0, retired: 0 }; for (const u of unitsOf(x.id)) c[u.status]++; return c; };
  const itemsOf = (wsId) => Object.values(db.invItems).filter((x) => x.wsId === wsId && !x.archived);
  const placesOf = (wsId) => Object.values(db.invPlaces).filter((x) => x.wsId === wsId && !x.archived).sort((a, b) => a.createdAt - b.createdAt);
  const qty = (v) => Math.round(Number(String(v ?? '').replace(/[,\s]/g, '')) * 1000) / 1000;
  const cents = (v) => (v === '' || v == null ? null : Number.isFinite(Number(String(v).replace(/[$,\s]/g, ''))) ? Math.max(0, Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100)) : undefined);
  const total = (x) => (x.track === 'units' ? unitCounts(x).available : Math.round(Object.values(x.stock || {}).reduce((n, v) => n + v, 0) * 1000) / 1000);
  const owned = (x) => (x.track === 'units' ? unitsOf(x.id).filter(live).length : total(x));
  const low = (x) => x.reorderAt != null && total(x) <= x.reorderAt;
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const news = (wsId) => broadcast(wsId, { type: 'inventory' });
  // How many of an item are on order: what's still to come on its open orders.
  const onOrder = (itemId) => { let n = 0; for (const o of Object.values(db.invOrders)) if (o.status === 'open') for (const l of o.lines) if (l.itemId === itemId) n += l.qty - l.got; return Math.round(n * 1000) / 1000; };

  // What a person sees: costs, prices and value only for owners and admins.
  const publicItem = (x, admin) => {
    const { wsId, cost, price, ...rest } = x;
    const units = x.track === 'units' ? { stock: unitStock(x), units: unitCounts(x) } : {};
    return { ...rest, track: x.track || 'stock', ...units, onHand: total(x), low: low(x), onOrder: x.track === 'units' ? 0 : onOrder(x.id), ...(admin ? { cost, price, value: x.cost != null ? Math.round(owned(x) * x.cost) : null } : {}) };
  };
  const publicUnit = ({ wsId, secret, ...u }) => ({ ...u, hasCombo: !!secret, url: u.tag ? labelUrl(u.tag) : null });
  const publicPlace = ({ wsId, ...x }) => x;
  const publicMove = ({ wsId, cost, ...x }, admin) => ({ ...x, ...(admin ? { cost } : {}) });
  const publicOrder = ({ wsId, ...o }, admin) => ({ ...o, lines: o.lines.map((l) => ({ ...l, name: db.invItems[l.itemId]?.name || '', unit: db.invItems[l.itemId]?.unit || '', ...(admin ? {} : { cost: undefined }) })) });

  // ---------- asking for stock (2026-11-20): anyone asks; owners and admins decide, hand it out or order it ----------
  // A line is an item in Inventory (itemId) or something that isn't (a name). Where requests go is the admin's pick
  // (ws.settings.inventory: requestTo, people; requestFeed, a feed); onRequest tells them, and tells whoever asked.
  const REQ_STATUS = ['open', 'approved', 'declined', 'handed', 'cancelled'];
  const REQ_KEEP = 300;
  const reqLine = (l) => { const x = l.itemId && db.invItems[l.itemId]; return { ...l, name: x ? x.name : l.name, unit: x ? x.unit : l.unit || 'each' }; };
  const publicRequest = ({ wsId, ...r }) => ({ ...r, lines: r.lines.map(reqLine) });
  const invSettings = (ws) => ({ requestTo: [], requestFeed: null, ...(ws.settings?.inventory || {}) });
  function askFor(ws, auth, b) {
    const lines = [];
    for (const l of Array.isArray(b.lines) ? b.lines.slice(0, 50) : []) {
      const n = qty(l?.qty);
      if (!(n > 0 && n <= QTY_MAX)) continue;
      if (l.itemId) {
        const x = db.invItems[l.itemId];
        if (!x || x.wsId !== ws.id || x.archived) throw err('Something on the request is gone.', 404);
        lines.push({ itemId: x.id, qty: n });
      } else {
        const name = cleanText(l.name, 120);
        if (name) lines.push({ itemId: null, name, unit: cleanText(l.unit, 20) || 'each', qty: n });
      }
    }
    if (!lines.length) throw err('Say what you need, and how many.');
    const job = b.jobId ? recordAt(String(b.jobId), ws.id, auth.memberId) : null;
    const needBy = /^\d{4}-\d{2}-\d{2}$/.test(String(b.needBy || '')) ? b.needBy : null;
    const number = Object.values(db.invRequests).reduce((n, r) => (r.wsId === ws.id ? Math.max(n, r.number || 0) : n), 0) + 1;
    const r = { id: rid(), wsId: ws.id, number, by: auth.member, byId: auth.memberId, at: Date.now(), status: 'open', lines, note: cleanText(b.note, 500), jobId: job ? job.rec.id : null, jobName: job ? String(job.rec.values[job.t?.primary] ?? '') : '', needBy };
    db.invRequests[r.id] = r;
    const done = Object.values(db.invRequests).filter((y) => y.wsId === ws.id && !['open', 'approved'].includes(y.status)).sort((p, q) => p.at - q.at);
    for (const y of done.slice(0, Math.max(0, done.length - REQ_KEEP))) delete db.invRequests[y.id];
    save(); news(ws.id);
    onRequest(ws, auth, r, 'new');
    return r;
  }
  function handOut(ws, auth, r, b) {
    if (!isAdmin(auth)) throw err('Only owners and admins hand out stock.', 403);
    if (!['open', 'approved'].includes(r.status)) throw err(r.status === 'handed' ? 'That was handed out already.' : 'That request is closed.');
    const from = placeOf(ws, b.placeId), to = b.to ? placeOf(ws, b.to) : null;
    if (!from) throw err('Pick where it comes from.');
    if (to && to.id === from.id) throw err('That’s the same place.');
    const moves = [];
    for (const l of r.lines) {
      const x = l.itemId && db.invItems[l.itemId];
      if (!x || x.archived || x.track === 'units') continue; // equipment goes out one by one (check it out); the rest isn't in Inventory
      const m = move(ws, auth, { kind: to ? 'move' : 'use', itemId: x.id, qty: l.qty, from: from.id, to: to?.id, jobId: !to && r.jobId ? r.jobId : undefined, note: `Request ${r.number} for ${r.by}` });
      m.requestId = r.id;
      moves.push(m.id);
    }
    Object.assign(r, { status: 'handed', handedAt: Date.now(), handedBy: auth.member, moves, to: to ? to.name : null, from: from.name });
    save(); news(ws.id);
    onRequest(ws, auth, r, 'handed');
    return r;
  }

  // ---------- supplier orders: placed, received (all at once or as it comes), or cancelled ----------
  // Each receive is a 'receive' move linked to the order (orderId), at the order's cost when it has one.
  const ORDERS_KEEP = 300;
  function placeOrder(ws, auth, b) {
    if (!isAdmin(auth)) throw err('Only owners and admins place orders.', 403);
    const lines = [];
    for (const l of Array.isArray(b.lines) ? b.lines.slice(0, 200) : []) {
      const x = l && db.invItems[l.itemId];
      if (!x || x.wsId !== ws.id || x.archived) throw err('Something on the order is gone.', 404);
      if (x.track === 'units') throw err(`${x.name} is tracked one by one: add each one when it comes in.`);
      const n = qty(l.qty);
      if (!n) continue;
      if (!(n > 0 && n <= QTY_MAX)) throw err(`Enter how many ${x.name}.`);
      const c = cents(l.cost);
      if (c === undefined) throw err('A cost is a number of dollars, like 12.50.');
      lines.push({ itemId: x.id, qty: n, got: 0, cost: c ?? x.cost ?? null });
    }
    if (!lines.length) throw err('Put something on the order.');
    const job = b.jobId ? recordAt(String(b.jobId), ws.id, auth.memberId) : null;
    const number = Object.values(db.invOrders).reduce((n, o) => (o.wsId === ws.id ? Math.max(n, o.number || 0) : n), 0) + 1;
    const o = { id: rid(), wsId: ws.id, number, supplier: cleanText(b.supplier, 120) || '', note: cleanText(b.note, 300), status: 'open', lines, by: auth.member, byId: auth.memberId, at: Date.now(), jobId: job ? job.rec.id : null, ...(job && stepOf(ws, job.rec.id, b.goalId) ? { goalId: b.goalId } : {}) };
    db.invOrders[o.id] = o;
    const mine = Object.values(db.invOrders).filter((y) => y.wsId === ws.id && y.status !== 'open').sort((p, q) => p.at - q.at);
    for (const y of mine.slice(0, Math.max(0, mine.length - ORDERS_KEEP))) delete db.invOrders[y.id];
    save(); news(ws.id);
    return o;
  }
  function receiveOrder(ws, auth, o, b) {
    if (!isAdmin(auth)) throw err('Only owners and admins receive orders.', 403);
    if (o.status !== 'open') throw err(o.status === 'cancelled' ? 'That order was cancelled.' : 'That order is already in.');
    const place = placeOf(ws, b.placeId) || firstPlace(ws, auth.member);
    const want = b.all ? o.lines.map((l) => ({ itemId: l.itemId, qty: l.qty - l.got })) : Array.isArray(b.lines) ? b.lines : [];
    const plan = [];
    for (const w of want) {
      const l = o.lines.find((y) => y.itemId === w?.itemId);
      const n = qty(w?.qty);
      if (!l || !n) continue;
      if (!(n > 0) || n > Math.round((l.qty - l.got) * 1000) / 1000) throw err(`Only ${Math.round((l.qty - l.got) * 1000) / 1000} of ${db.invItems[l.itemId]?.name || 'that'} are still to come.`);
      plan.push([l, n]);
    }
    if (!plan.length) throw err('Say how many came in.');
    for (const [l, n] of plan) {
      const mv = move(ws, auth, { kind: 'receive', itemId: l.itemId, qty: n, to: place.id, cost: l.cost != null ? (l.cost / 100).toFixed(2) : undefined, note: `Order ${o.number}${o.supplier ? ' from ' + o.supplier : ''}` });
      mv.orderId = o.id;
      l.got = Math.round((l.got + n) * 1000) / 1000;
    }
    if (o.lines.every((l) => l.got >= l.qty)) Object.assign(o, { status: 'received', receivedAt: Date.now() });
    save(); news(ws.id);
    return o;
  }

  // Changes are made on a copy and kept only if all of them are good (a refused change leaves the item as it was).
  function applyItem(item, b) {
    const x = { ...item };
    if (b.name !== undefined) x.name = cleanText(b.name, 120) || x.name || '';
    if (!x.name) throw err('Name the item.');
    if (b.sku !== undefined) x.sku = cleanText(b.sku, 60);
    if (b.category !== undefined) x.category = cleanText(b.category, 60);
    if (b.unit !== undefined) x.unit = cleanText(b.unit, 20) || 'each';
    if (b.supplier !== undefined) x.supplier = cleanText(b.supplier, 120);
    if (b.notes !== undefined) x.notes = String(b.notes ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
    for (const k of ['cost', 'price']) if (b[k] !== undefined) { const c = cents(b[k]); if (c === undefined) throw err(`The ${k} is a number of dollars, like 12.50.`); x[k] = c; }
    for (const k of ['reorderAt', 'reorderQty']) if (b[k] !== undefined) { if (b[k] === '' || b[k] == null) x[k] = null; else { const n = qty(b[k]); if (!(n >= 0 && n <= QTY_MAX)) throw err('Reorder numbers are 0 or more.'); x[k] = n; } }
    if (x.sku && itemsOf(x.wsId).some((y) => y.id !== x.id && y.sku && y.sku.toLowerCase() === x.sku.toLowerCase())) throw err(`Another item already has the SKU ${x.sku}.`);
    return Object.assign(item, x);
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

  // Which step of a job's work a move was for (with column-a9's job steps, 2026-11-18): its task's step, or one
  // named on it, only when that step is on a campaign for this same job. Anything else is dropped, never trusted.
  function stepOf(ws, recId, goalId) {
    const g = goalId && db.goals?.[goalId];
    const c = g && db.campaigns?.[g.campaignId];
    return g && g.wsId === ws.id && c && c.wsId === ws.id && c.recordId === recId ? g.id : null;
  }
  // One movement: checked, applied to the stock, written in the ledger. Returns the move.
  function move(ws, auth, b) {
    const kind = MOVE_KINDS.includes(b.kind) ? b.kind : null;
    if (!kind) throw err('Say what happened: received, moved, used, returned, adjusted or counted.');
    if (!isAdmin(auth) && !MEMBER_MOVES.includes(kind)) throw err('Only owners and admins can receive, adjust or count stock.', 403);
    const x = b.itemId && db.invItems[b.itemId];
    if (!x || x.wsId !== ws.id || x.archived) throw err('That item is gone.', 404);
    if (x.track === 'units') throw err(`${x.name} is tracked one by one: check its units out and back in instead.`);
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
    const goal = job ? stepOf(ws, job.rec.id, task ? db.tasks[task]?.goalId : b.goalId) : null;
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
      id: rid(), n: ++seq, wsId: ws.id, at: Date.now(), by: auth.member, byId: auth.memberId, itemId: x.id, kind, qty: kind === 'move' ? n : delta, ...(counted != null ? { counted } : {}),
      from: kind === 'move' ? from.id : kind === 'use' ? place.id : (kind === 'adjust' || kind === 'count') ? place.id : null,
      to: kind === 'move' ? to.id : (kind === 'receive' || kind === 'return') ? place.id : null,
      jobId: job ? job.rec.id : null, taskId: task, ...(goal ? { goalId: goal } : {}), note, cost: x.cost ?? null,
    };
    db.invMoves[m.id] = m;
    trim(ws.id);
    save();
    news(ws.id);
    onMove(ws, m, x, { wasLow, low: low(x) });
    return m;
  }
  // ---------- equipment: units one by one ----------
  function unitOf(ws, id) { const u = id && db.invUnits[id]; return u && u.wsId === ws.id ? u : null; }
  function logUnit(ws, auth, u, kind, more = {}) {
    const m = { id: rid(), n: ++seq, wsId: ws.id, at: Date.now(), by: auth.member, byId: auth.memberId, itemId: u.itemId, unitId: u.id, kind, qty: 1, from: null, to: null, jobId: null, taskId: null, note: '', cost: null, ...more };
    db.invMoves[m.id] = m;
    trim(ws.id);
    return m;
  }
  function addUnit(ws, auth, x, b, by = auth) {
    if (unitsOf(x.id).length >= UNITS_PER_ITEM) throw err(`An item can have ${UNITS_PER_ITEM.toLocaleString()} units.`);
    const place = placeOf(ws, b.placeId) || firstPlace(ws, auth.member);
    const n = unitsOf(x.id).length + 1;
    const u = { id: rid(), wsId: ws.id, itemId: x.id, name: cleanText(b.name, 120) || `${x.name} ${n}`, serial: cleanText(b.serial, 80), status: 'available', placeId: place.id, jobId: null, memberId: null, location: null, notes: cleanText(b.notes, 1000), tag: b.tag || newTag(), secret: null, seenAt: null, seenBy: null, createdAt: Date.now() };
    if (b.combo) u.secret = seal({ s: cleanText(b.combo, 200) });
    db.invUnits[u.id] = u;
    logUnit(ws, by, u, 'add', { to: place.id });
    return u;
  }
  // What a person does with a unit: check it out (to someone, a job), bring it back (to a place), move it, note where
  // it is now (a phone's location), report a problem or that it's fixed; owners and admins mark it lost or retired.
  function unitAct(ws, auth, u, b) {
    const act = String(b.act || '');
    const admin = isAdmin(auth);
    const note = cleanText(b.note, 300);
    const was = u.status;
    if (['lost', 'retire', 'found'].includes(act) && !admin) throw err('Only owners and admins mark equipment lost, found or retired.', 403);
    if (u.status === 'retired' && act !== 'found') throw err('It’s retired.');
    const job = b.jobId ? recordAt(String(b.jobId), ws.id, auth.memberId) : null;
    if (b.jobId && !job) throw err('That job is gone, or you can’t see it.', 404);
    if (act === 'checkout') {
      if (u.status !== 'available') throw err(u.status === 'out' ? 'It’s already out. Bring it back first.' : `It’s ${u.status === 'repair' ? 'in repair' : u.status}.`);
      const who = b.memberId ? ws.members.find((m) => m.id === b.memberId) : ws.members.find((m) => m.id === auth.memberId);
      if (!who) throw err('Pick who’s taking it.');
      const from = u.placeId;
      Object.assign(u, { status: 'out', placeId: null, memberId: who.id, jobId: job ? job.rec.id : null });
      return logUnit(ws, auth, u, 'checkout', { from, jobId: u.jobId, note: note || (who.id !== auth.memberId ? 'to ' + who.name : '') , toMember: who.id });
    }
    if (act === 'return' || act === 'move' || act === 'found') {
      const place = placeOf(ws, b.placeId);
      if (!place) throw err('Pick where it’s going.');
      if (act === 'move' && u.status === 'out') throw err('It’s out. Bring it back to a place instead.');
      const from = u.placeId;
      Object.assign(u, { status: act === 'move' && u.status === 'repair' ? 'repair' : 'available', placeId: place.id, memberId: null, jobId: null });
      return logUnit(ws, auth, u, act === 'found' ? 'found' : act, { from, to: place.id, note });
    }
    if (act === 'repair') { if (u.status === 'repair') throw err('It’s already in repair.'); u.status = 'repair'; return logUnit(ws, auth, u, 'repair', { note: note || 'Problem reported', jobId: u.jobId }); }
    if (act === 'fixed') { if (u.status !== 'repair') throw err('It isn’t in repair.'); u.status = u.placeId ? 'available' : 'out'; return logUnit(ws, auth, u, 'fixed', { note }); }
    if (act === 'lost') { Object.assign(u, { status: 'lost' }); return logUnit(ws, auth, u, 'lost', { note, from: u.placeId }); }
    if (act === 'retire') { Object.assign(u, { status: 'retired', placeId: null, memberId: null, jobId: null }); return logUnit(ws, auth, u, 'retire', { note }); }
    // Where it is right now, from the phone that scanned it (an address the person can see, and the point).
    if (act === 'here') {
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw err('That location doesn’t look right.');
      u.location = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, address: cleanText(b.address, 200), at: Date.now(), by: auth.member };
      return logUnit(ws, auth, u, 'here', { note: u.location.address || `${u.location.lat}, ${u.location.lng}` });
    }
    void was;
    throw err('Say what happened: check out, bring back, move, here, problem, fixed, lost or retire.');
  }
  // Bringing an Equipment & assets project's items in: one unit-tracked item per kind of equipment, each record a unit
  // with its name, serial or number, status, where it is, the job it's at, who has it, its combo (still sealed), and
  // its label (so the stickers already on the gear keep working, now opening it here). The project stays as it was.
  function importProject(ws, auth, pid) {
    const at = projectFor(pid, ws.id, auth.memberId);
    if (!at) throw err('That project is gone, or you can’t see it.', 404);
    const { p, records } = at;
    const t = p.types.find((y) => y.scan) || p.types[0];
    const f = (k, type) => t.fields.find((y) => y.key === k) || (type && t.fields.find((y) => y.type === type));
    const fKind = f('kind'), fStatus = f('status'), fSerial = f('serial'), fNum = f('number', 'autonumber'), fLoc = f('location', 'location'), fJob = f('job', 'job'), fWho = f('holder', 'person'), fCombo = f('combo', 'secret'), fDetails = f('details');
    const label = (fd, v) => fd?.choices?.find((c) => c.id === v)?.label || '';
    const STATUS = { 'at the yard': 'available', deployed: 'out', 'in repair': 'repair', lost: 'lost', retired: 'retired' };
    let made = 0, items = 0, skipped = 0;
    const byKind = new Map(itemsOf(ws.id).filter((x) => x.track === 'units').map((x) => [x.name.toLowerCase(), x]));
    for (const rec of records.filter((r) => r.typeId === t.id)) {
      if (Object.values(db.invUnits).some((u) => u.fromRecord === rec.id)) { skipped++; continue; }
      const kind = label(fKind, rec.values[fKind?.id]) || t.singular || 'Equipment';
      let x = byKind.get(kind.toLowerCase());
      if (!x) {
        x = { id: rid(), wsId: ws.id, name: kind, sku: '', category: p.name, unit: 'each', supplier: '', notes: '', cost: null, price: null, reorderAt: null, reorderQty: null, stock: {}, track: 'units', createdAt: Date.now(), updatedAt: Date.now(), by: auth.member };
        db.invItems[x.id] = x;
        byKind.set(kind.toLowerCase(), x);
        items++;
      }
      const name = String(rec.values[t.primary] ?? '').trim() || kind;
      const u = addUnit(ws, auth, x, { name, serial: String(rec.values[fSerial?.id] ?? '') || String(rec.values[fNum?.id] ?? ''), notes: String(rec.values[fDetails?.id] ?? ''), tag: rec.tag || null });
      if (rec.tag) rec.tag = null; // the label opens the unit now
      if (fCombo && rec.secrets?.[fCombo.id]) u.secret = rec.secrets[fCombo.id];
      const st = STATUS[label(fStatus, rec.values[fStatus?.id]).toLowerCase()] || 'available';
      const loc = fLoc && rec.values[fLoc.id];
      if (loc && Number.isFinite(loc.lat)) u.location = { lat: loc.lat, lng: loc.lng, address: loc.address || '', at: loc.at || Date.now(), by: '' };
      const holder = fWho && rec.values[fWho.id];
      if (st === 'out') Object.assign(u, { status: 'out', placeId: null, memberId: ws.members.some((m) => m.id === holder) ? holder : null, jobId: fJob && rec.values[fJob.id] ? rec.values[fJob.id] : null });
      else if (st !== 'available') Object.assign(u, { status: st, ...(st === 'retired' ? { placeId: null } : {}) });
      u.fromRecord = rec.id;
      made++;
    }
    save();
    news(ws.id);
    return { made, items, skipped, project: p.name };
  }

  // What a job used and has on site: stock used there (net of what came back), with its cost, and the equipment out
  // at it. Costs only for owners and admins.
  function jobView(ws, auth, recId) {
    const admin = isAdmin(auth);
    const used = new Map(), steps = new Map();
    for (const m of Object.values(db.invMoves)) {
      if (m.wsId !== ws.id || m.jobId !== recId || m.unitId || (m.kind !== 'use' && m.kind !== 'return')) continue;
      const x = db.invItems[m.itemId];
      if (!x) continue;
      const g = (m.goalId && db.goals?.[m.goalId]) || null; // a step deleted since counts as not for a step
      const sk = g ? g.id : null;
      steps.set(sk, (steps.get(sk) || 0) + Math.round(-m.qty * (m.cost || 0)));
      const row = used.get(x.id) || { itemId: x.id, name: x.name, unit: x.unit, qty: 0, cost: 0 };
      row.qty = Math.round((row.qty - m.qty) * 1000) / 1000;
      row.cost += Math.round(-m.qty * (m.cost || 0));
      used.set(x.id, row);
    }
    const materials = [...used.values()].filter((r) => r.qty !== 0).map((r) => (admin ? r : { ...r, cost: undefined }));
    const equipment = Object.values(db.invUnits).filter((u) => u.wsId === ws.id && u.jobId === recId && u.status !== 'retired').map((u) => ({ ...publicUnit(u), item: db.invItems[u.itemId]?.name || '' }));
    // What each step of the job's work cost in stock (not for a step: goalId null).
    const bySteps = [...steps.entries()].map(([goalId, cost]) => ({ goalId, title: goalId ? db.goals[goalId].title || '' : '', ...(admin ? { cost } : {}) }));
    return { materials, equipment, bySteps, ...(admin ? { cost: materials.reduce((n, r) => n + r.cost, 0) } : {}) };
  }
  const stockCost = (recId) => { let n = 0; for (const m of Object.values(db.invMoves)) if (m.jobId === recId && !m.unitId && (m.kind === 'use' || m.kind === 'return')) n += Math.round(-m.qty * (m.cost || 0)); return n; };

  function trim(wsId) {
    const mine = Object.values(db.invMoves).filter((m) => m.wsId === wsId);
    if (mine.length <= MOVES_KEEP) return;
    mine.sort((a, b) => newest(b, a));
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
        return send(res, 200, { items: items.map((x) => publicItem(x, admin)), places: placesOf(ws.id).map(publicPlace), canManage: admin, low: items.filter(low).map((x) => x.id), requests: Object.values(db.invRequests).filter((r) => r.wsId === ws.id && (admin || r.byId === auth.memberId)).sort((p, q) => (['open', 'approved'].includes(p.status) === ['open', 'approved'].includes(q.status) ? q.at - p.at : ['open', 'approved'].includes(p.status) ? -1 : 1)).slice(0, 80).map(publicRequest), ...(admin ? { requestSettings: invSettings(ws) } : {}), orders: Object.values(db.invOrders).filter((o) => o.wsId === ws.id).sort((p, q) => (p.status === 'open') === (q.status === 'open') ? q.at - p.at : p.status === 'open' ? -1 : 1).slice(0, 60).map((o) => publicOrder(o, admin)), movedIn: [...new Set(Object.values(db.invUnits).filter((u) => u.wsId === ws.id && u.fromRecord).map((u) => db.records[u.fromRecord]?.projectId).filter(Boolean))], value: admin ? items.reduce((n, x) => n + (x.cost != null ? Math.round(total(x) * x.cost) : 0), 0) : null });
      }
      // A scanned label: a unit (marked seen, by whom and when), an item or a place. Anyone else's label: not found.
      if (b === 'scan' && c && m === 'POST') {
        const ok = /^[A-Za-z0-9]{10}$/.test(c);
        const u = ok ? Object.values(db.invUnits).find((y) => y.tag === c && y.wsId === ws.id) : null;
        if (u) {
          Object.assign(u, { seenAt: Date.now(), seenBy: auth.member });
          save();
          return send(res, 200, { kind: 'unit', unitId: u.id, itemId: u.itemId });
        }
        const x = ok ? itemsOf(ws.id).find((y) => y.tag === c) : null;
        if (x) return send(res, 200, { kind: 'item', itemId: x.id });
        const p = ok ? placesOf(ws.id).find((y) => y.tag === c) : null;
        if (p) return send(res, 200, { kind: 'place', placeId: p.id });
        throw err('That label isn’t one of your team’s.', 404);
      }
      // Labels for items and places (2026-11-19): the same tag each time, made the first time it's asked for.
      if (b === 'labels' && !c && m === 'GET') {
        const u = new URL(req.url, 'http://x');
        const ids = (k) => String(u.searchParams.get(k) || '').split(',').filter(Boolean).slice(0, 500);
        const want = { items: ids('items'), places: ids('places') };
        if (!want.items.length && !want.places.length) throw err('Pick what to label.');
        const labels = [];
        let made = false;
        const tagOf = (y) => { if (!y.tag) { y.tag = newTag(); made = true; } return y.tag; };
        for (const id of want.items) { const x = db.invItems[id]; if (!x || x.wsId !== ws.id || x.archived) continue; const tag = tagOf(x); labels.push({ kind: 'item', id: x.id, name: x.name, number: x.sku || '', tag, url: labelUrl(tag), qr: labelQr(tag) }); }
        for (const id of want.places) { const p = db.invPlaces[id]; if (!p || p.wsId !== ws.id || p.archived) continue; const tag = tagOf(p); labels.push({ kind: 'place', id: p.id, name: p.name, number: PLACE_WORD[p.kind] || 'Place', tag, url: labelUrl(tag), qr: labelQr(tag) }); }
        if (made) save();
        return send(res, 200, { labels });
      }
      // A stock-take at one place: every count given sets that item there; only differences are logged.
      if (b === 'count' && !c && m === 'POST') {
        if (!admin) throw err('Only owners and admins count stock.', 403);
        const body = await readJson(req, 500_000);
        const place = placeOf(ws, body.placeId);
        if (!place) throw err('Pick the place you counted.');
        let changed = 0, same = 0;
        for (const row of (Array.isArray(body.counts) ? body.counts : []).slice(0, ITEMS_MAX)) {
          const x = row?.itemId && db.invItems[row.itemId];
          if (!x || x.wsId !== ws.id || x.archived || x.track === 'units') continue;
          const n = qty(row.qty);
          if (!(n >= 0)) continue;
          if (n === (x.stock[place.id] || 0)) { same++; continue; }
          move(ws, auth, { kind: 'count', itemId: x.id, qty: n, from: place.id, note: cleanText(body.note, 200) || 'Stock-take' });
          changed++;
        }
        return send(res, 200, { changed, same });
      }
      // A spreadsheet of items: matched by SKU, then by name; new ones added; "on hand" counted in at a place (by
      // name, made if it's new). Equipment tracked one by one isn't counted this way.
      if (b === 'import' && !c && m === 'POST') {
        if (!admin) throw err('Only owners and admins import items.', 403);
        const body = await readJson(req, 5_000_000);
        const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, ITEMS_MAX);
        let added = 0, updated = 0, counted = 0, skipped = 0;
        const placeByName = (name) => {
          const nm = cleanText(name, 80);
          if (!nm) return firstPlace(ws, auth.member);
          let p = placesOf(ws.id).find((y) => y.name.toLowerCase() === nm.toLowerCase());
          if (!p && placesOf(ws.id).length < PLACES_MAX) { p = { id: rid(), wsId: ws.id, name: nm, kind: /truck|van/i.test(nm) ? 'truck' : 'warehouse', address: '', memberId: null, createdAt: Date.now(), by: auth.member }; db.invPlaces[p.id] = p; }
          return p || firstPlace(ws, auth.member);
        };
        const priced = []; // items whose price this file changed, for price.changed (one event each, the first 50)
        for (const r of rows) {
          if (!r || typeof r !== 'object' || !cleanText(r.name, 120)) { skipped++; continue; }
          const sku = cleanText(r.sku, 60).toLowerCase();
          let x = (sku && itemsOf(ws.id).find((y) => y.sku && y.sku.toLowerCase() === sku)) || itemsOf(ws.id).find((y) => y.name.toLowerCase() === cleanText(r.name, 120).toLowerCase());
          const fields = Object.fromEntries(['name', 'sku', 'category', 'unit', 'supplier', 'notes', 'cost', 'price', 'reorderAt', 'reorderQty'].filter((k) => r[k] !== undefined && String(r[k]).trim() !== '').map((k) => [k, r[k]]));
          try {
            if (x) { const was = x.price ?? null; applyItem(x, fields); x.updatedAt = Date.now(); updated++; if ((x.price ?? null) !== was) priced.push({ id: 'inv:' + x.id, name: x.name, was, now: x.price ?? null }); }
            else {
              if (itemsOf(ws.id).length >= ITEMS_MAX) { skipped++; continue; }
              x = applyItem({ id: rid(), wsId: ws.id, name: '', sku: '', category: '', unit: 'each', supplier: '', notes: '', cost: null, price: null, reorderAt: null, reorderQty: null, stock: {}, track: 'stock', createdAt: Date.now(), updatedAt: Date.now(), by: auth.member }, fields);
              db.invItems[x.id] = x;
              added++;
            }
          } catch { skipped++; continue; }
          if (r.onHand !== undefined && String(r.onHand).trim() !== '' && x.track !== 'units') {
            const n = qty(r.onHand);
            const p = placeByName(r.place);
            if (n >= 0 && n !== (x.stock[p.id] || 0)) { move(ws, auth, { kind: 'count', itemId: x.id, qty: n, from: p.id, note: 'From a spreadsheet' }); counted++; }
          }
        }
        save(); news(ws.id);
        for (const c of priced.slice(0, 50)) onPrice(ws, auth, c);
        return send(res, 200, { added, updated, counted, skipped });
      }
      if (b === 'job' && c && m === 'GET') {
        if (!recordAt(String(c), ws.id, auth.memberId)) throw err('That job is gone, or you can’t see it.', 404);
        return send(res, 200, jobView(ws, auth, c));
      }
      if (b === 'import-project' && c && m === 'POST') {
        if (!admin) throw err('Only owners and admins can do that.', 403);
        return send(res, 200, importProject(ws, auth, c));
      }
      if (b === 'units' && c) {
        const u = unitOf(ws, c);
        if (!u) throw err('That unit is gone.', 404);
        const x = db.invItems[u.itemId];
        if (m === 'GET' && !parts[3]) return send(res, 200, { unit: publicUnit(u), item: publicItem(x, admin), moves: Object.values(db.invMoves).filter((y) => y.unitId === u.id).sort(newest).slice(0, 200).map((y) => publicMove(y, admin)) });
        if (m === 'POST' && parts[3] === 'act') {
          const mv = unitAct(ws, auth, u, await readJson(req, 10_000));
          save(); news(ws.id);
          onUnit(ws, mv, u, x);
          return send(res, 200, { unit: publicUnit(u), move: publicMove(mv, admin) });
        }
        // The combo: for anyone on the team, every look logged (who and when, never what), 30 looks an hour each.
        if (m === 'POST' && parts[3] === 'reveal') {
          if (!u.secret) throw err('No combo is saved for it.', 404);
          const now = Date.now();
          const mine = (looks.get(auth.memberId) || []).filter((t) => now - t < 3600_000);
          if (mine.length >= REVEALS_AN_HOUR) throw err('That’s a lot of looks in an hour. Try again later.', 429);
          looks.set(auth.memberId, [...mine, now]);
          let value;
          try { value = unseal(u.secret).s; } catch { throw err('That couldn’t be opened. Save it again.', 500); }
          logUnit(ws, auth, u, 'reveal', { note: 'Looked at the combo' });
          save();
          return send(res, 200, { value });
        }
        if (!admin) throw err('Only owners and admins change equipment details.', 403);
        if (m === 'POST' && parts[3] === 'tag') { u.tag = newTag(); save(); news(ws.id); return send(res, 200, publicUnit(u)); }
        if (m === 'PATCH' && !parts[3]) {
          const body = await readJson(req, 10_000);
          if (body.name !== undefined) u.name = cleanText(body.name, 120) || u.name;
          if (body.serial !== undefined) u.serial = cleanText(body.serial, 80);
          if (body.notes !== undefined) u.notes = cleanText(body.notes, 1000);
          if (body.combo !== undefined) u.secret = body.combo ? seal({ s: cleanText(body.combo, 200) }) : null;
          save(); news(ws.id);
          return send(res, 200, publicUnit(u));
        }
        if (m === 'DELETE' && !parts[3]) {
          if (Object.values(db.invMoves).some((y) => y.unitId === u.id && y.kind !== 'add')) throw err('It has history: retire it instead.');
          delete db.invUnits[u.id];
          for (const y of Object.values(db.invMoves)) if (y.unitId === u.id) delete db.invMoves[y.id];
          save(); news(ws.id);
          return send(res, 200, { ok: true });
        }
      }
      if (b === 'items') {
        if (m === 'POST' && !c) {
          if (!admin) throw err('Only owners and admins add items.', 403);
          if (itemsOf(ws.id).length >= ITEMS_MAX) throw err(`A team can keep ${ITEMS_MAX.toLocaleString()} items.`);
          const body = await readJson(req, 20_000);
          const x = applyItem({ id: rid(), wsId: ws.id, name: '', sku: '', category: '', unit: 'each', supplier: '', notes: '', cost: null, price: null, reorderAt: null, reorderQty: null, stock: {}, track: body.track === 'units' ? 'units' : 'stock', createdAt: Date.now(), updatedAt: Date.now(), by: auth.member }, body);
          db.invItems[x.id] = x;
          // Starting stock, if it came with some: received into a place.
          const start = qty(body.onHand);
          if (x.track === 'units') { for (let i = 0; i < Math.min(Math.floor(start) || 0, 200); i++) addUnit(ws, auth, x, { placeId: body.placeId }); save(); news(ws.id); }
          else if (start > 0) move(ws, auth, { kind: 'receive', itemId: x.id, qty: start, to: body.placeId, note: 'Starting stock' });
          else { save(); news(ws.id); }
          return send(res, 200, publicItem(x, admin));
        }
        const x = c && db.invItems[c];
        if (!x || x.wsId !== ws.id || x.archived) throw err('That item is gone.', 404);
        if (m === 'GET' && !parts[3]) return send(res, 200, { item: publicItem(x, admin), units: x.track === 'units' ? unitsOf(x.id).sort((p, q) => p.createdAt - q.createdAt).map(publicUnit) : [], moves: Object.values(db.invMoves).filter((y) => y.itemId === x.id).sort(newest).slice(0, 200).map((y) => publicMove(y, admin)) });
        // Labels to print: every unit's QR code.
        if (m === 'GET' && parts[3] === 'labels') return send(res, 200, { labels: unitsOf(x.id).filter(live).sort((p, q) => p.createdAt - q.createdAt).map((u) => { if (!u.tag) u.tag = newTag(); return { id: u.id, name: u.name, number: u.serial, tag: u.tag, url: labelUrl(u.tag), qr: labelQr(u.tag) }; }) });
        if (m === 'POST' && parts[3] === 'units') {
          if (!admin) throw err('Only owners and admins add equipment.', 403);
          if (x.track !== 'units') throw err(`${x.name} is counted, not tracked one by one.`);
          const u = addUnit(ws, auth, x, await readJson(req, 10_000));
          save(); news(ws.id);
          return send(res, 200, publicUnit(u));
        }
        if (!admin) throw err('Only owners and admins change items.', 403);
        if (m === 'PATCH') {
          const body = await readJson(req, 20_000);
          const was = x.price ?? null;
          applyItem(x, body);
          x.updatedAt = Date.now();
          save(); news(ws.id);
          // Its price changed (not its cost): automations hear it (price.changed), once per change.
          if ((x.price ?? null) !== was) onPrice(ws, auth, { id: 'inv:' + x.id, name: x.name, was, now: x.price ?? null });
          return send(res, 200, publicItem(x, admin));
        }
        // Deleting: an item with history is archived (its history stays); one never moved goes.
        if (m === 'DELETE') {
          if (x.track === 'units' ? unitsOf(x.id).some(live) : total(x) > 0) throw err(x.track === 'units' ? 'It still has equipment. Retire each one first.' : 'It still has stock. Use it up, or count it to 0, first.');
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
          if (itemsOf(ws.id).some((x) => (x.stock[p.id] || 0) > 0) || Object.values(db.invUnits).some((u) => u.placeId === p.id && live(u))) throw err(`There’s still stock at ${p.name}. Move it first.`);
          if (Object.values(db.invMoves).some((y) => y.from === p.id || y.to === p.id)) p.archived = true; else delete db.invPlaces[p.id];
          save(); news(ws.id);
          return send(res, 200, { ok: true });
        }
      }
      if (b === 'requests') {
        if (m === 'POST' && !c) return send(res, 200, publicRequest(askFor(ws, auth, await readJson(req, 50_000))));
        const r = c && db.invRequests[c];
        // Someone else's request isn't there for a member (it's theirs, or owners' and admins').
        if (!r || r.wsId !== ws.id || (!admin && r.byId !== auth.memberId)) throw err('That request is gone.', 404);
        const act = parts[3];
        const body = m === 'POST' ? await readJson(req, 10_000) : {};
        if (m === 'POST' && act === 'decide') {
          if (!admin) throw err('Only owners and admins decide requests.', 403);
          if (r.status !== 'open') throw err('That request was decided already.');
          if (!['approved', 'declined'].includes(body.status)) throw err('Approve it or decline it.');
          Object.assign(r, { status: body.status, decidedBy: auth.member, decidedAt: Date.now(), decision: cleanText(body.note, 300) });
          save(); news(ws.id);
          onRequest(ws, auth, r, body.status);
          return send(res, 200, publicRequest(r));
        }
        if (m === 'POST' && act === 'fulfill') return send(res, 200, publicRequest(handOut(ws, auth, r, body)));
        if (m === 'POST' && act === 'cancel') {
          if (!['open', 'approved'].includes(r.status)) throw err('That request is closed already.');
          Object.assign(r, { status: 'cancelled', cancelledBy: auth.member, cancelledAt: Date.now() });
          save(); news(ws.id);
          if (r.byId !== auth.memberId) onRequest(ws, auth, r, 'cancelled');
          return send(res, 200, publicRequest(r));
        }
      }
      // Where requests go (owners and admins): the people who hear them (none picked: owners and admins), and a feed.
      if (b === 'settings' && !c && m === 'PATCH') {
        if (!admin) throw err('Only owners and admins choose where requests go.', 403);
        const body = await readJson(req, 10_000);
        const next = invSettings(ws);
        if (body.requestTo !== undefined) next.requestTo = (Array.isArray(body.requestTo) ? body.requestTo : []).filter((id) => memberOk(ws, id)).slice(0, 50);
        if (body.requestFeed !== undefined) {
          if (body.requestFeed && !feedOk(ws, body.requestFeed)) throw err('That feed is gone.');
          next.requestFeed = body.requestFeed || null;
        }
        ws.settings.inventory = next;
        save(); news(ws.id);
        return send(res, 200, next);
      }
      if (b === 'orders') {
        if (m === 'POST' && !c) return send(res, 200, publicOrder(placeOrder(ws, auth, await readJson(req, 100_000)), admin));
        const o = c && db.invOrders[c];
        if (!o || o.wsId !== ws.id) throw err('That order is gone.', 404);
        const act = parts[3];
        if (m === 'POST' && act === 'receive') return send(res, 200, publicOrder(receiveOrder(ws, auth, o, await readJson(req, 100_000)), admin));
        if (m === 'POST' && act === 'cancel') {
          if (!admin) throw err('Only owners and admins cancel orders.', 403);
          if (o.status !== 'open') throw err('Only an open order can be cancelled.');
          Object.assign(o, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: auth.member });
          save(); news(ws.id);
          return send(res, 200, publicOrder(o, admin));
        }
      }
      if (b === 'moves') {
        if (m === 'POST' && !c) return send(res, 200, publicMove(move(ws, auth, await readJson(req, 10_000)), admin));
        if (m === 'GET' && !c) {
          const u = new URL(req.url, 'http://x');
          const f = Object.fromEntries(['item', 'place', 'job', 'task'].map((k) => [k, u.searchParams.get(k)]));
          const list = Object.values(db.invMoves).filter((y) => y.wsId === ws.id && (!f.item || y.itemId === f.item) && (!f.place || y.from === f.place || y.to === f.place) && (!f.job || y.jobId === f.job) && (!f.task || y.taskId === f.task));
          return send(res, 200, list.sort(newest).slice(0, Math.min(500, Number(u.searchParams.get('limit')) || 200)).map((y) => publicMove(y, admin)));
        }
      }
      return send(res, 405, { error: 'Method not allowed' });
    } catch (e) {
      if (!e.status) throw e;
      return send(res, e.status, { error: e.message });
    }
  }

  return { route, move, itemsOf, placesOf, total, low, publicItem, unitAct, unitsOf, stockCost, jobView, onOrder };
}
