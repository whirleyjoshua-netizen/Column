// Analytics v1 (Team plan step 4, the owner 2026-11-20): the business's numbers from Kloomie's own data. For any dates
// (up to three years), each number against the same length of time just before, a trend by week (or by month over
// longer dates), and the records behind it (GET /api/analytics/drill). Four sections:
// - business (owners and admins): money in and out and profit (the business's money only), invoiced, collected, owed
//   and overdue now, quotes sent and won;
// - team (owners and admins; members when an admin turns on teamKpis): tasks done, on time, overdue now, visits done,
//   days to finish, reopened, and each person's line;
// - customers (owners and admins): new contacts, leads (a contact that came with a source), by source;
// - marketing (owners and admins): calls and emails logged, interested or booked, sales from them, active campaigns.
// Visibility travels with the data: behind a number, a member sees only their own records (others are counted in
// `hidden`), and an owner sees only the tasks they could open anyway.
export const ANALYTICS_LIMITS = { days: 1096, rows: 200, buckets: 60, watches: 30 };
// Goals and alerts (step 5): a goal is a number to reach in a week, month or quarter (money in $20,000 a month), shown
// on its card with how far along it is; an alert is a number going above or below a line (overdue tasks above 5).
// When a goal is reached or an alert goes off, owners and admins are told (the bell) once a period, and the Flows
// events analytics.goal and analytics.alert fire, for automations made by an owner or admin only.

export function analyticsModule({ db, save = () => {}, rid = () => Math.random().toString(36).slice(2), readJson, cleanText = (x) => String(x || ''), notifyAdmins = () => {}, automate = () => {}, offline = () => false, send, isAdmin, isDay, addDays, teamDay, memberMay, memberOff, taskDoers, canSee, INV, PJ }) {
  db.kpiWatches ||= {};
  const dayMs = 864e5;
  const span = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / dayMs) + 1;
  const weekDay = (k) => new Date(k + 'T12:00:00Z').getUTCDay();
  // Buckets for the trend: weeks (Sunday first, the ends clipped to the dates) up to about two months, else months.
  function bucketsOf(from, to) {
    const out = [];
    const monthly = span(from, to) > 62;
    let k = from;
    while (k <= to && out.length < ANALYTICS_LIMITS.buckets) {
      let end;
      if (monthly) { const d = new Date(k + 'T12:00:00Z'); end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); }
      else end = addDays(k, 6 - weekDay(k));
      if (end > to) end = to;
      out.push({ from: k, to: end });
      k = addDays(end, 1);
    }
    if (out.length) out[out.length - 1].to = to;
    return out;
  }
  const inRange = (k, from, to) => !!k && k >= from && k <= to;

  // Everything the numbers are made of, as [day, value, record] facts per metric, for one team.
  function facts(ws, from, to) {
    const W = ws.id, today = teamDay(W);
    const day = (ms) => (ms ? teamDay(W, ms) : null);
    const F = {}; // metric → [{ day, v, row }]
    const add = (k, d, v, row) => (F[k] ||= []).push({ d, v, row });
    const nameOf = (id) => ws.members.find((x) => x.id === id)?.name || '';
    const now = {}; // metrics as of today: metric → [{ v, row }]
    const addNow = (k, v, row) => (now[k] ||= []).push({ v, row });
    const people = new Map(ws.members.map((m) => [m.id, { id: m.id, name: m.name, role: m.role, done: 0, withDue: 0, onTimeN: 0, overdue: 0, visits: 0, reopened: 0, days: 0 }]));

    // Money: the business's only.
    for (const x of Object.values(db.money)) {
      if (x.wsId !== W || x.scope !== 'business' || !isDay(x.day)) continue;
      const row = { label: x.note || x.category || (x.kind === 'in' ? 'Money in' : 'Spending'), sub: [x.category, x.day].filter(Boolean).join(' · '), amount: x.amount, go: 'money:' + x.id };
      if (x.kind === 'in') add('income', x.day, x.amount, row);
      else if (x.kind === 'out') add('expenses', x.day, x.amount, row);
      add('profit', x.day, x.kind === 'in' ? x.amount : -x.amount, null);
    }
    // Invoices: issued (not drafts or void), payments, and what's owed and overdue now.
    for (const inv of Object.values(db.invoices || {})) {
      if (inv.wsId !== W || inv.status === 'draft' || inv.status === 'void') continue;
      const t = INV.totals(inv);
      const label = `${inv.number || 'Invoice'} · ${inv.to?.name || inv.title || ''}`.trim();
      const go = inv.recordId ? 'rec:' + inv.recordId : null;
      if (isDay(inv.issued)) add('invoiced', inv.issued, t.total, { label, sub: 'Issued ' + inv.issued, amount: t.total, go });
      for (const p of inv.payments || []) if (isDay(p.day)) add('collected', p.day, p.amount, { label, sub: `Paid ${p.day}${p.method ? ' · ' + p.method : ''}`, amount: p.amount, go });
      if (t.balance > 0) {
        addNow('owed', t.balance, { label, sub: inv.due ? 'Due ' + inv.due : '', amount: t.balance, go });
        if (inv.due && inv.due < today) addNow('overdueInvoices', t.balance, { label, sub: 'Was due ' + inv.due, amount: t.balance, go });
      }
    }
    // Quotes sent and answered.
    for (const rec of Object.values(db.records || {})) {
      if (rec.wsId !== W || (!rec.share && !rec.answer)) continue;
      const q = PJ.quoteOf(rec);
      if (!q) continue;
      const row = { label: `${q.number ? q.number + ' · ' : ''}${q.title}`, sub: [q.customer?.name, q.status].filter(Boolean).join(' · '), go: 'rec:' + rec.id };
      if (q.sentAt) add('quotesSent', day(q.sentAt), 1, row);
      if (q.answeredOn && (q.status === 'accepted' || q.status === 'declined')) {
        add('quotesAnswered', q.answeredOn, 1, null);
        if (q.status === 'accepted') add('quotesWon', q.answeredOn, 1, row);
      }
    }
    // Tasks: who finished what, when, against its due date; open ones past due now; reopened.
    for (const t of Object.values(db.tasks)) {
      if (t.wsId !== W || t.skipped) continue;
      const doers = taskDoers(ws, t);
      const row = { label: t.text || 'Task', task: t, go: 'task:' + t.id };
      if (t.done && t.doneAt) {
        const d = day(t.doneAt);
        const by = t.doneById || doers[0] || t.memberId || null;
        const due = t.doneDue ?? t.due ?? null;
        const late = due ? d > due : null;
        const took = Math.max(0, (t.doneAt - (t.assignedAt || t.createdAt || t.doneAt)) / dayMs);
        const r = { ...row, sub: [nameOf(by), due ? (late ? `done ${d}, due ${due}` : `done ${d}, on time`) : `done ${d}`].filter(Boolean).join(' · '), memberIds: by ? [by] : [] };
        add('tasksDone', d, 1, r);
        if (due) { add('withDue', d, 1, null); if (!late) add('onTimeN', d, 1, r); else add('late', d, 1, r); }
        add('took', d, took, null);
        if (inRange(d, from, to)) {
          const p = people.get(by);
          if (p) { p.done++; p.days += took; if (due) { p.withDue++; if (!late) p.onTimeN++; } }
        }
      } else if (!t.done && t.due && t.due < today) {
        addNow('overdueNow', 1, { ...row, sub: [doers.map(nameOf).filter(Boolean).join(', '), 'due ' + t.due].filter(Boolean).join(' · '), memberIds: doers });
        for (const id of doers) { const p = people.get(id); if (p) p.overdue++; }
      }
      // Reopened, on the day it was reopened (the work history keeps when).
      for (const ev of t.hist || []) if (ev.k === 'reopen' || ev.k === 'reopened') {
        const d = day(ev.at), by = doers[0] || t.memberId;
        add('reopened', d, 1, { ...row, sub: [doers.map(nameOf).filter(Boolean).join(', '), 'reopened ' + d].filter(Boolean).join(' · '), memberIds: doers });
        if (inRange(d, from, to)) for (const id of doers.length ? doers : [by]) { const p = people.get(id); if (p) p.reopened++; }
      }
    }
    // Visits done (a visit is one or more people's entries; counted once).
    const seen = new Set();
    for (const e of Object.values(db.entries)) {
      if (e.wsId !== W || !e.visitId || !e.done || !e.doneAt) continue;
      const d = day(e.doneAt);
      if (inRange(d, from, to)) { const p = people.get(e.memberId); if (p) p.visits++; }
      if (seen.has(e.visitId)) continue;
      seen.add(e.visitId);
      add('visitsDone', d, 1, { label: `${e.visit || 'Visit'}${e.text ? ': ' + e.text : ''}`, sub: `${nameOf(e.memberId)} · ${d}`, memberIds: [e.memberId], go: e.recordId ? 'rec:' + e.recordId : null, entry: e });
    }
    // Contacts and leads.
    for (const c of Object.values(db.contacts || {})) {
      if (c.wsId !== W || !c.createdAt) continue;
      const d = day(c.createdAt);
      const row = { label: c.name || c.company || c.email || c.phone || 'Contact', sub: [c.source || c.by, d].filter(Boolean).join(' · '), go: 'contact:' + c.id, source: c.source || '' };
      add('newContacts', d, 1, row);
      if (c.source) add('leads', d, 1, row);
    }
    // Campaigns (not a job's): calls and emails logged, interested or booked, sales.
    const campName = (id) => db.campaigns[id]?.name || '';
    for (const x of Object.values(db.attempts || {})) {
      if (x.wsId !== W || !x.at) continue;
      const c = db.campaigns[x.campaignId];
      if (!c || c.recordId) continue;
      const d = day(x.at);
      const row = { label: x.contact || '(no name)', sub: [x.outcome, campName(x.campaignId), x.by, d].filter(Boolean).join(' · '), go: 'camp:' + x.campaignId, campaignId: x.campaignId, amount: x.amount || undefined };
      add('attempts', d, 1, row);
      if (['Interested', 'Booked'].includes(x.outcome)) add('interested', d, 1, row);
      if (x.amount) add('sales', d, x.amount, row);
    }
    for (const c of Object.values(db.campaigns)) {
      if (c.wsId !== W || c.recordId) continue;
      if (c.status === 'active') addNow('campaigns', 1, { label: c.name || 'Campaign', sub: [c.start, c.end].filter(Boolean).join(' – '), go: 'camp:' + c.id });
      if (c.createdAt) add('campaignsStarted', day(c.createdAt), 1, null);
    }
    return { F, now, people };
  }

  // The catalog: each number, its section, how it's shown, and how it's made from the facts.
  const sumOf = (k) => (F, a, b) => (F[k] || []).reduce((n, x) => n + (inRange(x.d, a, b) ? x.v : 0), 0);
  const pctOf = (top, bot) => (F, a, b) => { const d = sumOf(bot)(F, a, b); return d ? Math.round((100 * sumOf(top)(F, a, b)) / d) : null; };
  const avgOf = (k, n) => (F, a, b) => { const c = sumOf(n)(F, a, b); return c ? Math.round((10 * sumOf(k)(F, a, b)) / c) / 10 : null; };
  const CATALOG = [
    { key: 'income', sec: 'business', label: 'Money in', unit: 'money', calc: sumOf('income'), rows: 'income' },
    { key: 'expenses', sec: 'business', label: 'Spending', unit: 'money', calc: sumOf('expenses'), rows: 'expenses', lowGood: true },
    { key: 'profit', sec: 'business', label: 'Profit', unit: 'money', calc: sumOf('profit') },
    { key: 'invoiced', sec: 'business', label: 'Invoiced', unit: 'money', calc: sumOf('invoiced'), rows: 'invoiced' },
    { key: 'collected', sec: 'business', label: 'Collected', unit: 'money', calc: sumOf('collected'), rows: 'collected' },
    { key: 'owed', sec: 'business', label: 'Owed to you now', unit: 'money', now: true, rows: 'owed' },
    { key: 'overdueInvoices', sec: 'business', label: 'Overdue now', unit: 'money', now: true, rows: 'overdueInvoices', lowGood: true },
    { key: 'quotesSent', sec: 'business', label: 'Quotes sent', unit: 'count', calc: sumOf('quotesSent'), rows: 'quotesSent' },
    { key: 'quotesWon', sec: 'business', label: 'Quotes won', unit: 'count', calc: sumOf('quotesWon'), rows: 'quotesWon' },
    { key: 'winRate', sec: 'business', label: 'Win rate', unit: 'pct', calc: pctOf('quotesWon', 'quotesAnswered'), rows: 'quotesWon', hint: 'Of the quotes answered' },
    { key: 'tasksDone', sec: 'team', label: 'Tasks done', unit: 'count', calc: sumOf('tasksDone'), rows: 'tasksDone' },
    { key: 'onTime', sec: 'team', label: 'On time', unit: 'pct', calc: pctOf('onTimeN', 'withDue'), rows: 'late', hint: 'Of the tasks done that had a due date' },
    { key: 'overdueNow', sec: 'team', label: 'Overdue now', unit: 'count', now: true, rows: 'overdueNow', lowGood: true },
    { key: 'visitsDone', sec: 'team', label: 'Visits done', unit: 'count', calc: sumOf('visitsDone'), rows: 'visitsDone' },
    { key: 'daysToFinish', sec: 'team', label: 'Days to finish', unit: 'days', calc: avgOf('took', 'tasksDone'), rows: 'tasksDone', lowGood: true, hint: 'From given to done, on average' },
    { key: 'reopened', sec: 'team', label: 'Reopened', unit: 'count', calc: sumOf('reopened'), rows: 'reopened', lowGood: true },
    { key: 'newContacts', sec: 'customers', label: 'New contacts', unit: 'count', calc: sumOf('newContacts'), rows: 'newContacts' },
    { key: 'leads', sec: 'customers', label: 'Leads', unit: 'count', calc: sumOf('leads'), rows: 'leads', hint: 'New contacts that came with a source' },
    { key: 'attempts', sec: 'marketing', label: 'Calls & emails logged', unit: 'count', calc: sumOf('attempts'), rows: 'attempts' },
    { key: 'interested', sec: 'marketing', label: 'Interested or booked', unit: 'count', calc: sumOf('interested'), rows: 'interested' },
    { key: 'sales', sec: 'marketing', label: 'Sales from campaigns', unit: 'money', calc: sumOf('sales'), rows: 'sales' },
    { key: 'campaigns', sec: 'marketing', label: 'Active campaigns', unit: 'count', now: true, rows: 'campaigns' },
  ];
  const BY_KEY = Object.fromEntries(CATALOG.map((x) => [x.key, x]));
  const SECTIONS = { business: 'Business', team: 'Team & operations', customers: 'Customers', marketing: 'Marketing' };
  const sectionsFor = (ws, auth) => (isAdmin(auth) ? Object.keys(SECTIONS) : memberMay(ws, auth, 'teamKpis') ? ['team'] : []);

  function datesOf(req) {
    const q = new URL(req.url, 'http://x').searchParams;
    const from = q.get('from'), to = q.get('to');
    if (!isDay(from) || !isDay(to) || from > to) return { error: 'Pick the dates to look at.' };
    if (span(from, to) > ANALYTICS_LIMITS.days) return { error: 'Pick at most three years at a time.' };
    const n = span(from, to);
    return { from, to, prevFrom: addDays(from, -n), prevTo: addDays(from, -1), q };
  }

  function report(ws, auth, D) {
    const { from, to, prevFrom, prevTo } = D;
    const { F, now, people } = facts(ws, prevFrom, to);
    const P = facts(ws, from, to).people; // each person's line over the dates themselves
    const buckets = bucketsOf(from, to);
    const out = { from, to, prevFrom, prevTo, buckets, sections: {} };
    for (const sec of sectionsFor(ws, auth)) {
      const metrics = CATALOG.filter((m) => m.sec === sec).map((m) => {
        if (m.now) return { key: m.key, label: m.label, unit: m.unit, now: true, value: (now[m.key] || []).reduce((n, x) => n + x.v, 0), n: (now[m.key] || []).length, lowGood: !!m.lowGood, hint: m.hint || null };
        return { key: m.key, label: m.label, unit: m.unit, value: m.calc(F, from, to), prev: m.calc(F, prevFrom, prevTo), series: buckets.map((b) => m.calc(F, b.from, b.to)), lowGood: !!m.lowGood, hint: m.hint || null };
      });
      const s = { key: sec, label: SECTIONS[sec], metrics };
      if (sec === 'team') s.people = [...P.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, done: p.done, onTime: p.withDue ? Math.round((100 * p.onTimeN) / p.withDue) : null, overdue: p.overdue, visits: p.visits, reopened: p.reopened, daysToFinish: p.done ? Math.round((10 * p.days) / p.done) / 10 : null }));
      if (sec === 'customers') {
        const m = new Map();
        for (const x of F.newContacts || []) if (inRange(x.d, from, to)) { const k = x.row.source || 'Added in Kloomie'; m.set(k, (m.get(k) || 0) + 1); }
        s.sources = [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
      }
      if (sec === 'marketing') {
        const m = new Map();
        for (const x of F.attempts || []) if (inRange(x.d, from, to)) {
          const c = m.get(x.row.campaignId) || { id: x.row.campaignId, name: db.campaigns[x.row.campaignId]?.name || '', attempts: 0, interested: 0, sales: 0 };
          c.attempts++;
          m.set(c.id, c);
        }
        for (const x of F.interested || []) if (inRange(x.d, from, to) && m.get(x.row.campaignId)) m.get(x.row.campaignId).interested++;
        for (const x of F.sales || []) if (inRange(x.d, from, to) && m.get(x.row.campaignId)) m.get(x.row.campaignId).sales += x.v;
        s.campaigns = [...m.values()].sort((a, b) => b.attempts - a.attempts);
      }
      out.sections[sec] = s;
    }
    void people;
    out.watches = watchesOf(ws).filter((w) => out.sections[BY_KEY[w.metric].sec]).map((w) => statusOf(ws, w));
    return out;
  }

  // The records behind one number: only what this person could open anyway; a member, only their own.
  function drill(ws, auth, D, key, member) {
    const m = BY_KEY[key];
    const { from, to } = D;
    const { F, now } = facts(ws, from, to);
    const list = m.now ? now[m.rows] || [] : (F[m.rows] || []).filter((x) => inRange(x.d, from, to));
    const admin = isAdmin(auth);
    let hidden = 0;
    const rows = [];
    for (const x of list) {
      const r = x.row;
      if (!r) continue;
      if (member && !(r.memberIds || []).includes(member)) continue;
      const mine = (r.memberIds || []).includes(auth.memberId);
      const may = r.task ? canSee(auth, 'task', r.task) && (admin || mine) : r.entry ? admin || mine : admin;
      if (!may) { hidden++; continue; }
      if (rows.length < ANALYTICS_LIMITS.rows) rows.push({ label: r.label, sub: r.sub || '', ...(r.amount !== undefined ? { amount: r.amount } : {}), go: r.go || null, day: x.d || null });
    }
    rows.sort((a, b) => String(b.day || '').localeCompare(String(a.day || '')));
    return { key, label: m.label, unit: m.unit, from, to, rows, hidden, more: Math.max(0, list.length - hidden - rows.length) };
  }

  // ----- goals and alerts -----
  const PERIODS = { week: 'this week', month: 'this month', quarter: 'this quarter' };
  const watchesOf = (ws) => Object.values(db.kpiWatches).filter((w) => w.wsId === ws.id && BY_KEY[w.metric]).sort((a, b) => a.at - b.at);
  function periodOf(ws, period) {
    const t = teamDay(ws.id);
    if (period === 'week') return [addDays(t, -weekDay(t)), t];
    const [y, m] = t.split('-').map(Number);
    const first = period === 'quarter' ? m - ((m - 1) % 3) : m;
    return [`${y}-${String(first).padStart(2, '0')}-01`, t];
  }
  const fmt = (v, unit) => (v === null || v === undefined ? '—' : unit === 'money' ? '$' + Math.round(v / 100).toLocaleString('en-US') : unit === 'pct' ? v + '%' : unit === 'days' ? v + ' days' : String(v));
  function statusOf(ws, w) {
    const m = BY_KEY[w.metric];
    let from = null, to = null, current;
    if (m.now) current = (facts(ws, teamDay(ws.id), teamDay(ws.id)).now[m.rows] || []).reduce((n, x) => n + x.v, 0);
    else { [from, to] = periodOf(ws, w.period); current = m.calc(facts(ws, from, to).F, from, to); }
    const met = current === null ? false : w.kind === 'goal' ? (m.lowGood ? current <= w.value : current >= w.value) : w.op === 'above' ? current > w.value : current < w.value;
    const pct = w.kind === 'goal' && !m.lowGood && w.value > 0 && current !== null ? Math.min(100, Math.round((100 * current) / w.value)) : null;
    return { id: w.id, metric: w.metric, label: m.label, unit: m.unit, sec: m.sec, kind: w.kind, op: w.op || null, value: w.value, period: m.now ? null : w.period, from, to, current, pct, met, lowGood: !!m.lowGood,
      text: w.kind === 'goal' ? `${m.label}: ${m.lowGood ? 'at most' : ''} ${fmt(w.value, m.unit)}${m.now ? '' : ' ' + PERIODS[w.period]}`.replace(':  ', ': ') : `${m.label} ${w.op} ${fmt(w.value, m.unit)}${m.now ? '' : ' ' + PERIODS[w.period]}` };
  }
  // Goes off once a period (a number "as of today": once each time it crosses), never for a goal to stay low.
  function check(ws) {
    if (offline(ws.id)) return;
    let changed = false;
    for (const w of watchesOf(ws)) {
      const st = statusOf(ws, w), m = BY_KEY[w.metric];
      const key = m.now ? 'on' : st.from;
      if (!st.met) { if (m.now && w.fired) { w.fired = null; changed = true; } continue; }
      if (w.fired === key || (w.kind === 'goal' && m.lowGood)) continue;
      w.fired = key;
      changed = true;
      const now = fmt(st.current, m.unit), target = fmt(w.value, m.unit), period = m.now ? '' : PERIODS[w.period];
      const title = w.kind === 'goal' ? `Goal reached: ${m.label}` : `${m.label} is ${w.op} ${target}`;
      const text = w.kind === 'goal' ? `${now} ${period}, against a goal of ${target}.` : `It’s ${now}${period ? ' ' + period : ''}.`;
      notifyAdmins(ws.id, { kind: 'analytics', title, text, go: 'analytics:' + m.sec, key: 'kpi:' + w.id });
      automate(ws.id, w.kind === 'goal' ? 'analytics.goal' : 'analytics.alert', { ownersOnly: true, metric: m.label, value: now, target, period, note: `${title}. ${text}`, date: teamDay(ws.id) });
    }
    if (changed) save();
  }
  function checkAll() { const seen = new Set(); for (const w of Object.values(db.kpiWatches)) if (!seen.has(w.wsId) && db.workspaces[w.wsId]) { seen.add(w.wsId); try { check(db.workspaces[w.wsId]); } catch {} } }
  function cleanWatch(body, w = {}) {
    const metric = body.metric ?? w.metric, m = BY_KEY[metric];
    if (!m) return { error: 'Pick a number from Analytics.' };
    const kind = body.kind ?? w.kind;
    if (!['goal', 'alert'].includes(kind)) return { error: 'A goal or an alert.' };
    const op = kind === 'alert' ? body.op ?? w.op : null;
    if (kind === 'alert' && !['above', 'below'].includes(op)) return { error: 'Above or below?' };
    const raw = body.value !== undefined ? Number(body.value) : null;
    if (body.value !== undefined && (!Number.isFinite(raw) || raw < 0 || raw > 1e9)) return { error: 'The number to watch for.' };
    const value = body.value !== undefined ? (m.unit === 'money' ? Math.round(raw * 100) : m.unit === 'days' ? Math.round(raw * 10) / 10 : Math.round(raw)) : w.value;
    if (value === undefined || value === null) return { error: 'The number to watch for.' };
    if (m.unit === 'pct' && value > 100) return { error: 'A share is at most 100%.' };
    const period = m.now ? null : body.period ?? w.period ?? 'month';
    if (!m.now && !PERIODS[period]) return { error: 'A week, a month or a quarter.' };
    return { metric, kind, op, value, period };
  }
  async function watchRoute(req, res, parts, auth, ws, secs) {
    const id = parts[2], m = req.method;
    if (m === 'GET' && !id) return send(res, 200, watchesOf(ws).filter((w) => secs.includes(BY_KEY[w.metric].sec)).map((w) => statusOf(ws, w)));
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins set goals and alerts.' });
    if (m === 'POST' && !id) {
      if (watchesOf(ws).length >= ANALYTICS_LIMITS.watches) return send(res, 409, { error: `A team can have up to ${ANALYTICS_LIMITS.watches} goals and alerts.` });
      const v = cleanWatch(await readJson(req));
      if (v.error) return send(res, 400, v);
      const w = { id: rid(), wsId: ws.id, ...v, fired: null, by: auth.member, byId: auth.memberId, at: Date.now() };
      db.kpiWatches[w.id] = w;
      save();
      check(ws);
      return send(res, 200, statusOf(ws, w));
    }
    const w = db.kpiWatches[id];
    if (!w || w.wsId !== ws.id) return send(res, 404, { error: 'That goal or alert is gone.' });
    if (m === 'PATCH') {
      const v = cleanWatch(await readJson(req), w);
      if (v.error) return send(res, 400, v);
      Object.assign(w, v, { fired: null });
      save();
      check(ws);
      return send(res, 200, statusOf(ws, w));
    }
    if (m === 'DELETE') { delete db.kpiWatches[id]; save(); return send(res, 200, { ok: true }); }
    return send(res, 405, { error: 'Not here.' });
  }

  function route(req, res, parts, auth, ws) {
    const [, b] = parts;
    const secs = sectionsFor(ws, auth);
    if (!secs.length) return send(res, 403, { error: memberOff('teamKpis') });
    if (b === 'watches') return watchRoute(req, res, parts, auth, ws, secs);
    if (req.method !== 'GET') return send(res, 405, { error: 'Not here.' });
    const D = datesOf(req);
    if (D.error) return send(res, 400, { error: D.error });
    if (!b) return send(res, 200, report(ws, auth, D));
    if (b === 'drill') {
      const key = D.q.get('metric'), m = BY_KEY[key];
      if (!m) return send(res, 400, { error: 'There’s no such number.' });
      if (!secs.includes(m.sec)) return send(res, 403, { error: 'Only team owners and admins see that.' });
      const member = D.q.get('member') || null;
      return send(res, 200, drill(ws, auth, D, key, member && ws.members.some((x) => x.id === member) ? member : null));
    }
    return send(res, 404, { error: 'Not here.' });
  }
  return { route, report, drill, CATALOG, bucketsOf, check, checkAll };
}
