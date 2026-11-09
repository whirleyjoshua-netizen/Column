// Routes: a person's job visits for a day, in order, on real roads; how long the driving takes; and a better order.
// Mapbox does the map work (MAPBOX_TOKEN): finding each address, drive times between every pair of stops, and the
// road route to draw. Kloomie does the ordering itself, because it knows what Mapbox doesn't: which visits are at a
// time the customer was promised (they stay put) and which can be any time that day (they're fitted in around them).
// Addresses are looked up when a route is asked for and never stored (Mapbox's free geocoding doesn't allow keeping
// results); a route is kept in memory for a few minutes so looking at it again doesn't look everything up again.

const API = () => (process.env.MAPBOX_API || 'https://api.mapbox.com').replace(/\/$/, '');
const TOKEN = () => process.env.MAPBOX_TOKEN || '';
export const routesOn = () => !!TOKEN();

async function get(path, params) {
  const u = new URL(API() + path);
  for (const [k, v] of Object.entries({ ...params, access_token: TOKEN() })) if (v != null) u.searchParams.set(k, v);
  const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Maps: ${j.message || r.status}`);
  return j;
}

// An address to [lng, lat], near the team's base when there is one, or null when it can't be found.
async function geocode(address, near) {
  const j = await get('/search/geocode/v6/forward', { q: address, limit: 1, country: 'us,ca', ...(near ? { proximity: near.join(',') } : {}) });
  const c = j.features?.[0]?.geometry?.coordinates;
  return Array.isArray(c) && c.length === 2 ? c : null;
}
// Drive times (seconds) and distances (meters) between every pair of points: up to 25.
async function matrix(points) {
  const j = await get(`/directions-matrix/v1/mapbox/driving/${points.map((p) => p.join(',')).join(';')}`, { annotations: 'duration,distance' });
  return { secs: j.durations, meters: j.distances };
}
// The road route through points in this order: its line, and each leg's time and distance.
async function directions(points) {
  if (points.length < 2) return { line: points.map(([lng, lat]) => [lat, lng]), legs: [] };
  const j = await get(`/directions/v5/mapbox/driving/${points.map((p) => p.join(',')).join(';')}`, { geometries: 'geojson', overview: 'full' });
  const r = j.routes?.[0];
  if (!r) throw new Error('Maps: no route between those stops.');
  return { line: r.geometry.coordinates.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]), legs: r.legs.map((l) => ({ secs: Math.round(l.duration), meters: Math.round(l.distance) })) };
}

// ---------- ordering ----------
// stops: { id, start, end, flex } in minutes; secs[i][j] the drive from stop i to j (index 0 is the base when
// there is one). A plan is an order; walking it gives each stop its time: a promised (fixed) stop starts at its
// time and you wait if early, but arriving late is not allowed; a flexible one starts when you get there.
const DAY_START = 8 * 60;
function walk(order, stops, secs, base) {
  let t = null;
  let prev = base ? 0 : null;
  let drive = 0;
  const times = [];
  for (const i of order) {
    const s = stops[i - (base ? 1 : 0)];
    const leg = prev == null ? 0 : Math.round((secs[prev][i] || 0) / 60);
    drive += leg;
    const len = Math.max(15, (s.end ?? s.start + 60) - s.start || 60);
    if (t == null) t = s.flex ? DAY_START : s.start - leg;
    const arrive = t + leg;
    let begin;
    if (s.flex) begin = Math.ceil(arrive / 15) * 15; // people book on the quarter hour
    else {
      if (arrive > s.start + 5) return null; // can't make a promised time
      begin = s.start;
    }
    times.push({ id: s.id, start: begin, end: begin + len });
    t = begin + len;
    prev = i;
  }
  return { drive, times };
}
// The best order Kloomie can find: promised visits in time order, each flexible one put where it adds least
// driving, then moves tried one at a time while any of them helps. `all` treats every visit as flexible.
export function bestOrder(stops, secs, base, { all = false } = {}) {
  const S = all ? stops.map((s) => ({ ...s, flex: true })) : stops;
  const off = base ? 1 : 0;
  const idx = S.map((_, i) => i + off);
  let order = idx.filter((i) => !S[i - off].flex).sort((a, b) => S[a - off].start - S[b - off].start);
  const flex = idx.filter((i) => S[i - off].flex).sort((a, b) => (S[a - off].start ?? 0) - (S[b - off].start ?? 0));
  for (const i of flex) {
    let best = null;
    for (let at = 0; at <= order.length; at++) {
      const tryOrder = [...order.slice(0, at), i, ...order.slice(at)];
      const w = walk(tryOrder, S, secs, base);
      if (w && (!best || w.drive < best.w.drive)) best = { order: tryOrder, w };
    }
    order = best ? best.order : [...order, i];
  }
  let cur = walk(order, S, secs, base);
  for (let improved = true, rounds = 0; improved && cur && rounds < 50; rounds++) {
    improved = false;
    for (let a = 0; a < order.length && !improved; a++) {
      for (let b = 0; b < order.length && !improved; b++) {
        if (a === b) continue;
        const o = [...order];
        const [x] = o.splice(a, 1);
        o.splice(b, 0, x);
        const w = walk(o, S, secs, base);
        if (w && w.drive < cur.drive) { order = o; cur = w; improved = true; }
      }
    }
  }
  return cur ? { order: order.map((i) => S[i - off].id), drive: cur.drive, times: cur.times } : null;
}

// ---------- a day's route ----------
const cache = new Map(); // key → { at, route }
const KEEP = 10 * 60_000;
// visits: { id, label, address, start, end, flex, done }; base: an address or ''.
export async function dayRoute(key, visits, base) {
  const sig = key + '|' + base + '|' + visits.map((v) => [v.id, v.address, v.start, v.end, v.flex].join(',')).join(';');
  const hit = cache.get(sig);
  if (hit && Date.now() - hit.at < KEEP) return hit.route;
  for (const [k, v] of cache) if (Date.now() - v.at > KEEP) cache.delete(k);

  const homeAt = base ? await geocode(base).catch(() => null) : null;
  const found = [];
  const missing = [];
  for (const v of visits.slice(0, 24)) {
    const at = v.address ? await geocode(v.address, homeAt).catch(() => null) : null;
    if (at) found.push({ ...v, at });
    else missing.push({ id: v.id, label: v.label, why: v.address ? 'Couldn’t find that address' : 'No address on the job' });
  }
  // In the day's order: by time, untimed last.
  found.sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9));
  const points = [...(homeAt ? [homeAt] : []), ...found.map((v) => v.at)];
  const route = { base: homeAt ? { address: base, lat: homeAt[1], lng: homeAt[0] } : null, stops: [], legs: [], line: [], drive: 0, meters: 0, tight: [], missing, better: null, reorder: null };
  if (!found.length) return route;
  // Out from the base and back to it at the end of the day.
  const dir = await directions(homeAt ? [...points, homeAt] : points);
  route.line = dir.line;
  route.legs = dir.legs;
  route.drive = Math.round(dir.legs.reduce((n, l) => n + l.secs, 0) / 60);
  route.meters = dir.legs.reduce((n, l) => n + l.meters, 0);
  route.stops = found.map((v, i) => ({ id: v.id, label: v.label, address: v.address, lat: v.at[1], lng: v.at[0], start: v.start, end: v.end, flex: !!v.flex, done: !!v.done, n: i + 1 }));
  // Too tight: the drive from one visit is longer than the gap before the next.
  const legOff = homeAt ? 1 : 0;
  for (let i = 1; i < found.length; i++) {
    const a = found[i - 1], b = found[i];
    const leg = Math.round((dir.legs[i - 1 + legOff]?.secs || 0) / 60);
    if (a.end != null && b.start != null && !b.flex && a.end + leg > b.start) route.tight.push({ from: a.id, to: b.id, drive: leg, gap: b.start - a.end });
  }
  // A better order, when there's anything to move.
  if (found.length > 1) {
    const { secs } = await matrix(points);
    const stops = found.map((v) => ({ id: v.id, start: v.start ?? DAY_START, end: v.end ?? (v.start ?? DAY_START) + 60, flex: !!v.flex || v.start == null }));
    const now = walk(stops.map((_, i) => i + legOff), stops, secs, !!homeAt) || { drive: route.drive };
    const keep = bestOrder(stops, secs, !!homeAt);
    if (keep && keep.drive < now.drive - 2 && keep.order.join() !== found.map((v) => v.id).join()) route.better = { ...keep, saves: now.drive - keep.drive };
    const all = bestOrder(stops, secs, !!homeAt, { all: true });
    if (all && all.drive < Math.min(now.drive, keep?.drive ?? Infinity) - 9) route.reorder = { ...all, saves: now.drive - all.drive };
  }
  cache.set(sig, { at: Date.now(), route });
  return route;
}
