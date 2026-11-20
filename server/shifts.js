// Work shifts (Team plan step 2, the owner 2026-11-20): "a work schedule builder to build and send out actual work
// shift hours", next to each person's usual hours and time off.
//
// - A shift is one person's hours on one day (start and end in minutes from midnight; an end past 24:00 runs
//   overnight), with an unpaid break, a label ("Morning", "Shop") and a note.
// - Owners and admins build the week as a draft. Nothing reaches anyone until Send: then each person whose shifts
//   changed is told once (the bell and a push), and from then on sees what they were sent. Changing or removing a
//   sent shift is a draft again until the next Send, and the person keeps seeing the version they were sent.
// - Each person keeps their usual hours (by weekday) and time off; they and owners and admins can change them. The
//   builder warns about a shift on time off, outside someone's usual hours, overlapping another, or a week over 40
//   hours. Warnings never block: the owner decides.
// - Who sees what: owners and admins everything, drafts included; members their own sent shifts, and everyone's sent
//   shifts when an admin lets them see the team's schedule. Usual hours and time off: the person and owners and
//   admins (time off can say why).
// Every change goes through this module (the app's routes are its only door today); a new door (the public API, an
// agent tool) calls the same functions.
export const SHIFT_LIMITS = { perTeam: 20_000, copy: 500, presets: 20, off: 100, windows: 4, label: 60, note: 300, weekMin: 40 * 60 };
const DAY_MIN = 1440;

export function shiftsModule(deps) {
  const { db, save, broadcast, readJson, send, isAdmin, rid, cleanText, notify = () => null, memberMay, memberOff, isDay, addDays, teamDay } = deps;
  db.shifts ||= {};
  db.availability ||= {};
  const L = SHIFT_LIMITS;
  const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const memberOf = (ws, id) => ws.members.find((m) => m.id === id) || null;
  const weekOf = (k) => addDays(k, -new Date(k + 'T12:00:00Z').getUTCDay());
  const daysOf = (week) => Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const teamShifts = (wsId) => Object.values(db.shifts).filter((s) => s.wsId === wsId);
  const paid = (x) => Math.max(0, x.end - x.start - (x.breakMin || 0));
  const FIELDS = ['memberId', 'date', 'start', 'end', 'breakMin', 'label', 'note'];
  const pick = (s) => Object.fromEntries(FIELDS.map((k) => [k, s[k]]));
  const same = (a, b) => FIELDS.every((k) => (a[k] ?? null) === (b[k] ?? null));
  // A shift's state for the people building it: new (never sent), changed (sent, then edited), gone (sent, then
  // removed: goes at the next Send) or sent.
  const stateOf = (s) => (!s.pub ? 'new' : s.gone ? 'gone' : same(s, s.pub) ? 'sent' : 'changed');

  // ----- checking what comes in -----
  const minute = (v, what, max = DAY_MIN) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw fail(`Pick a ${what} time.`);
    return n;
  };
  function cleanShift(ws, body, base = {}) {
    const x = { ...base };
    if ('memberId' in body) { if (!memberOf(ws, body.memberId)) throw fail('Pick someone on the team.'); x.memberId = body.memberId; }
    if ('date' in body) { if (!isDay(String(body.date || ''))) throw fail('Pick a day.'); x.date = body.date; }
    if ('start' in body) x.start = minute(body.start, 'start', DAY_MIN - 1);
    if ('end' in body) x.end = minute(body.end, 'finish', DAY_MIN * 2);
    if (x.end != null && x.start != null && x.end <= x.start) x.end += DAY_MIN; // 22:00–06:00 runs overnight
    if (x.start == null || x.end == null || x.end > x.start + DAY_MIN) throw fail('A shift is up to 24 hours.');
    if ('breakMin' in body) { const b = Number(body.breakMin || 0); if (!Number.isInteger(b) || b < 0 || b > 600) throw fail('A break is 0 to 10 hours, in minutes.'); x.breakMin = b; }
    x.breakMin ||= 0;
    if (x.breakMin >= x.end - x.start) throw fail('The break is longer than the shift.');
    if ('label' in body) x.label = cleanText(body.label, L.label) || null;
    if ('note' in body) x.note = cleanText(body.note, L.note) || null;
    if (!x.memberId || !x.date) throw fail('A shift needs a person and a day.');
    return x;
  }
  function cleanWeekHours(v) {
    if (!Array.isArray(v) || v.length !== 7) throw fail('Usual hours are seven days, Sunday first.');
    return v.map((day) => {
      if (!Array.isArray(day)) throw fail('Usual hours are a list of times for each day.');
      if (day.length > L.windows) throw fail(`Up to ${L.windows} stretches a day.`);
      const out = day.map((w) => {
        const s = minute(w?.[0], 'start', DAY_MIN - 1), e = minute(w?.[1], 'finish', DAY_MIN);
        if (e <= s) throw fail('Each stretch ends after it starts.');
        return [s, e];
      }).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < out.length; i++) if (out[i][0] < out[i - 1][1]) throw fail('Two stretches on one day overlap.');
      return out;
    });
  }
  function cleanOff(v) {
    if (!Array.isArray(v)) throw fail('Time off is a list.');
    if (v.length > L.off) throw fail(`Up to ${L.off} stretches of time off.`);
    return v.map((o) => {
      const from = String(o?.from || ''), to = String(o?.to || o?.from || '');
      if (!isDay(from) || !isDay(to) || to < from) throw fail('Time off needs a first and last day.');
      return { id: typeof o.id === 'string' && /^[\w-]{1,24}$/.test(o.id) ? o.id : rid(6), from, to, note: cleanText(o.note, 120) || null };
    }).sort((a, b) => (a.from < b.from ? -1 : 1));
  }

  // ----- usual hours and time off -----
  const availKey = (wsId, memberId) => wsId + ':' + memberId;
  const availOf = (wsId, memberId) => db.availability[availKey(wsId, memberId)] || null;
  const mayAvail = (auth, memberId) => isAdmin(auth) || auth.memberId === memberId;
  const pubAvail = (a, memberId) => ({ memberId, week: a?.week || null, off: a?.off || [], at: a?.at || null, by: a?.by || null });

  // ----- what the builder warns about -----
  function warnings(ws, list) {
    const out = {}, add = (s, w) => (out[s.id] ||= []).push(w);
    const live = list.filter((s) => !s.gone);
    const by = new Map();
    for (const s of live) (by.get(s.memberId) || by.set(s.memberId, []).get(s.memberId)).push(s);
    for (const [mid, mine] of by) {
      const av = availOf(ws.id, mid);
      for (const s of mine) {
        if (av?.off?.some((o) => s.date >= o.from && s.date <= o.to)) add(s, 'off');
        if (av?.week?.some((d) => d.length)) {
          const wins = av.week[new Date(s.date + 'T12:00:00Z').getUTCDay()] || [];
          if (!wins.some(([a, b]) => s.start >= a && Math.min(s.end, DAY_MIN) <= b)) add(s, 'outside');
        }
      }
      const abs = mine.map((s) => ({ s, a: Date.parse(s.date + 'T00:00:00Z') / 60_000 + s.start, b: Date.parse(s.date + 'T00:00:00Z') / 60_000 + s.end })).sort((x, y) => x.a - y.a);
      for (let i = 0; i < abs.length; i++) for (let j = i + 1; j < abs.length && abs[j].a < abs[i].b; j++) { add(abs[i].s, 'overlap'); add(abs[j].s, 'overlap'); }
    }
    for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
    return out;
  }

  // ----- the week, as the person asking may see it -----
  const forBuilder = (s) => ({ id: s.id, ...pick(s), state: stateOf(s), pub: s.pub || null, by: s.by || null, at: s.at || 0, sentAt: s.sentAt || null });
  const asSent = (s) => ({ id: s.id, ...s.pub, sentAt: s.sentAt || null });
  function week(ws, auth, k) {
    const wk = weekOf(k), days = daysOf(wk), last = days[6];
    const editor = isAdmin(auth), team = memberMay(ws, auth, 'teamSchedule');
    const inWeek = (d) => d >= wk && d <= last;
    let shifts;
    if (editor) shifts = teamShifts(ws.id).filter((s) => inWeek(s.date) || (s.pub && inWeek(s.pub.date))).map(forBuilder);
    else shifts = teamShifts(ws.id).filter((s) => s.pub && inWeek(s.pub.date) && (team || s.pub.memberId === auth.memberId)).map(asSent);
    // The builder shows each shift where it is now; one moved to another week shows there.
    if (editor) shifts = shifts.filter((s) => inWeek(s.date));
    const people = (editor || team ? ws.members : ws.members.filter((m) => m.id === auth.memberId)).map((m) => ({ id: m.id, name: m.name, role: m.role }));
    const totals = {};
    for (const s of shifts) if (s.state !== 'gone') totals[s.memberId] = (totals[s.memberId] || 0) + paid(s);
    const out = { week: wk, days, today: teamDay(ws.id), canEdit: editor, people, shifts, totals, weekMax: L.weekMin, presets: ws.shiftPresets || [] };
    if (editor) {
      out.warnings = warnings(ws, teamShifts(ws.id).filter((s) => inWeek(s.date)));
      out.over = Object.keys(totals).filter((id) => totals[id] > L.weekMin);
      out.unsent = shifts.filter((s) => s.state !== 'sent').length;
      out.avail = Object.fromEntries(ws.members.map((m) => {
        const a = availOf(ws.id, m.id);
        return [m.id, { week: a?.week || null, off: (a?.off || []).filter((o) => o.to >= wk && o.from <= last) }];
      }));
    }
    return out;
  }
  // One's own sent shifts from today on (My shifts).
  function mine(ws, auth, days = 28) {
    const from = teamDay(ws.id), to = addDays(from, Math.max(1, Math.min(90, days)) - 1);
    const list = teamShifts(ws.id).filter((s) => s.pub && s.pub.memberId === auth.memberId && s.pub.date >= from && s.pub.date <= to)
      .map(asSent).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
    return { from, to, shifts: list, total: list.reduce((n, s) => n + paid(s), 0), avail: pubAvail(availOf(ws.id, auth.memberId), auth.memberId) };
  }

  // ----- changes (owners and admins) -----
  const changed = (ws) => { save(); broadcast(ws.id, { type: 'shifts' }); };
  function addShift(ws, auth, body) {
    if (teamShifts(ws.id).length >= L.perTeam) throw fail(`A team keeps up to ${L.perTeam.toLocaleString('en-US')} shifts. Remove old ones first.`, 409);
    const s = { id: rid(), wsId: ws.id, ...cleanShift(ws, body), pub: null, by: auth.memberId, at: Date.now() };
    db.shifts[s.id] = s;
    return s;
  }
  function editShift(ws, auth, s, body) {
    Object.assign(s, cleanShift(ws, body, pick(s)), { by: auth.memberId, at: Date.now() });
    if (s.gone && 'gone' in body && !body.gone) delete s.gone; // brought back before the Send
    return s;
  }
  function dropShift(ws, s) {
    if (!s.pub) delete db.shifts[s.id];
    else s.gone = true; // the person still has it until the next Send tells them it's off
  }
  function copyWeek(ws, auth, from, to) {
    const src = weekOf(from), dst = weekOf(to);
    if (src === dst) throw fail('Pick another week to copy into.');
    const shift = Math.round((Date.parse(dst) - Date.parse(src)) / 864e5);
    const have = teamShifts(ws.id).filter((s) => !s.gone);
    const list = have.filter((s) => s.date >= src && s.date <= addDays(src, 6));
    if (list.length > L.copy) throw fail(`Up to ${L.copy} shifts are copied at once.`);
    if (have.length + list.length > L.perTeam) throw fail(`A team keeps up to ${L.perTeam.toLocaleString('en-US')} shifts.`, 409);
    let n = 0;
    for (const s of list) {
      const date = addDays(s.date, shift);
      if (!memberOf(ws, s.memberId) || have.some((o) => o.memberId === s.memberId && o.date === date && o.start === s.start && o.end === s.end)) continue;
      const c = { id: rid(), wsId: ws.id, ...pick(s), date, pub: null, by: auth.memberId, at: Date.now() };
      db.shifts[c.id] = c;
      n++;
    }
    return n;
  }
  // Send: every change in the week reaches its person, once. Returns who was told.
  const hm = (m) => { const h24 = Math.floor(m / 60) % 24, mm = m % 60; return `${h24 % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h24 < 12 ? 'am' : 'pm'}`; };
  const dayShort = (k) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const line = (x) => `${dayShort(x.date)} ${hm(x.start)}–${hm(x.end)}${x.label ? ' ' + x.label : ''}`;
  function sendWeek(ws, auth, k) {
    const wk = weekOf(k), last = addDays(wk, 6);
    const inWeek = (s) => (s.date >= wk && s.date <= last) || (s.pub && s.pub.date >= wk && s.pub.date <= last);
    const touched = new Map(); // memberId → { added, changed, removed }
    const tally = (id, what) => { const t = touched.get(id) || touched.set(id, { added: 0, changed: 0, removed: 0 }).get(id); t[what]++; };
    const now = Date.now();
    for (const s of teamShifts(ws.id).filter(inWeek)) {
      const st = stateOf(s);
      if (st === 'sent') continue;
      if (st === 'gone') { tally(s.pub.memberId, 'removed'); delete db.shifts[s.id]; continue; }
      if (st === 'changed' && s.pub.memberId !== s.memberId) { tally(s.pub.memberId, 'removed'); tally(s.memberId, 'added'); }
      else tally(s.memberId, st === 'new' ? 'added' : 'changed');
      s.pub = pick(s);
      s.sentAt = now;
      s.sentBy = auth.memberId;
    }
    const sender = memberOf(ws, auth.memberId)?.name || 'Your team';
    const wkName = new Date(wk + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    for (const [mid, t] of touched) {
      if (!memberOf(ws, mid)) continue;
      const theirs = teamShifts(ws.id).filter((s) => s.pub && s.pub.memberId === mid && s.pub.date >= wk && s.pub.date <= last).map((s) => s.pub).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
      const fresh = t.added && !t.changed && !t.removed && theirs.length === t.added;
      const title = fresh ? `Your shifts for the week of ${wkName}` : `Your shifts changed for the week of ${wkName}`;
      const total = theirs.reduce((n, x) => n + paid(x), 0);
      const text = theirs.length ? `${theirs.map(line).join(' · ')} · ${Math.round(total / 6) / 10} h in all, from ${sender}.` : `No shifts that week any more, from ${sender}.`;
      notify(ws.id, mid, { kind: 'shifts', title, text, go: 'shifts:' + wk, key: 'shifts:' + wk });
    }
    return { week: wk, people: touched.size, removed: [...touched.values()].reduce((n, t) => n + t.removed, 0) };
  }

  // ----- the routes: /api/shifts…, /api/availability/:memberId -----
  async function route(req, res, parts, auth, ws) {
    const [a, b, c] = parts, m = req.method;
    const url = new URL(req.url, 'http://x');
    try {
      if (a === 'availability') {
        const id = b === 'me' || !b ? auth.memberId : b;
        if (!memberOf(ws, id)) return send(res, 404, { error: 'Nobody by that name on the team.' });
        if (!mayAvail(auth, id)) return send(res, 403, { error: 'Only they, or an owner or admin, can see someone’s hours and time off.' });
        if (m === 'GET') return send(res, 200, pubAvail(availOf(ws.id, id), id));
        if (m === 'PUT') {
          const body = await readJson(req, 100_000);
          const cur = availOf(ws.id, id) || { wsId: ws.id, memberId: id, week: null, off: [] };
          const next = { ...cur, week: 'week' in body ? (body.week == null ? null : cleanWeekHours(body.week)) : cur.week, off: 'off' in body ? cleanOff(body.off) : cur.off, at: Date.now(), by: auth.memberId };
          db.availability[availKey(ws.id, id)] = next;
          changed(ws);
          return send(res, 200, pubAvail(next, id));
        }
        return send(res, 405, { error: 'Not here.' });
      }
      // a === 'shifts'
      if (m === 'GET' && !b) {
        const k = url.searchParams.get('week') || teamDay(ws.id);
        if (!isDay(k)) return send(res, 400, { error: 'Pick a week.' });
        return send(res, 200, week(ws, auth, k));
      }
      if (m === 'GET' && b === 'mine') return send(res, 200, mine(ws, auth, Number(url.searchParams.get('days')) || 28));
      if (!isAdmin(auth)) return send(res, 403, { error: 'Owners and admins build the team’s shifts.' });
      if (m === 'POST' && !b) {
        const s = addShift(ws, auth, await readJson(req, 20_000));
        changed(ws);
        return send(res, 200, forBuilder(s));
      }
      if (m === 'POST' && b === 'copy') {
        const body = await readJson(req, 2_000);
        if (!isDay(String(body.from || '')) || !isDay(String(body.to || ''))) return send(res, 400, { error: 'Pick the weeks to copy from and to.' });
        const n = copyWeek(ws, auth, body.from, body.to);
        changed(ws);
        return send(res, 200, { copied: n });
      }
      if (m === 'POST' && b === 'send') {
        const body = await readJson(req, 2_000);
        if (!isDay(String(body.week || ''))) return send(res, 400, { error: 'Pick a week.' });
        const out = sendWeek(ws, auth, body.week);
        changed(ws);
        return send(res, 200, out);
      }
      if (m === 'PUT' && b === 'presets') {
        const body = await readJson(req, 20_000);
        if (!Array.isArray(body.presets) || body.presets.length > L.presets) return send(res, 400, { error: `Up to ${L.presets} saved shifts.` });
        ws.shiftPresets = body.presets.map((p) => {
          const x = cleanShift(ws, { memberId: ws.members[0].id, date: '2000-01-02', start: p.start, end: p.end, breakMin: p.breakMin, label: p.label });
          if (!x.label) throw fail('Give each saved shift a name.');
          return { id: typeof p.id === 'string' && /^[\w-]{1,24}$/.test(p.id) ? p.id : rid(6), label: x.label, start: x.start, end: x.end, breakMin: x.breakMin };
        });
        changed(ws);
        return send(res, 200, { presets: ws.shiftPresets });
      }
      const s = b && db.shifts[b];
      if (!s || s.wsId !== ws.id || c) return send(res, 404, { error: 'That shift is gone.' });
      if (m === 'PATCH') {
        editShift(ws, auth, s, await readJson(req, 20_000));
        changed(ws);
        return send(res, 200, forBuilder(s));
      }
      if (m === 'DELETE') {
        dropShift(ws, s);
        changed(ws);
        return send(res, 200, { ok: true, gone: !!db.shifts[s.id] });
      }
      return send(res, 405, { error: 'Not here.' });
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message });
      throw e;
    }
  }

  // Someone leaves the team: their shifts and their hours go with them.
  function memberGone(wsId, memberId) {
    for (const s of Object.values(db.shifts)) if (s.wsId === wsId && (s.memberId === memberId || s.pub?.memberId === memberId)) delete db.shifts[s.id];
    delete db.availability[availKey(wsId, memberId)];
  }
  // Paid minutes each person is down for on each day (for the hours calculator and the forecast, step 3): sent
  // shifts only, as their people know them.
  function sentMinutes(wsId, from, to) {
    const out = new Map();
    for (const s of Object.values(db.shifts)) {
      if (s.wsId !== wsId || !s.pub || s.pub.date < from || s.pub.date > to) continue;
      const k = s.pub.memberId + '|' + s.pub.date;
      out.set(k, (out.get(k) || 0) + paid(s.pub));
    }
    return out;
  }
  return { route, memberGone, sentMinutes, week, mine, warnings, availOf };
}
