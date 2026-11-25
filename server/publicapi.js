// The public API beyond Projects: the team's Contacts, Tasks, Visits and Invoices, and webhooks an app subscribes
// to with its own key (how Zapier and Make hear about things the moment they happen). Projects records stay in
// projects.js; anything this file doesn't answer goes on to it.
//
// Everything here speaks the way an outside system writes: snake_case, dollars (not cents), ISO times, times of
// day as "09:30", people by id with their name alongside. Lists page the same way records do: oldest change
// first with updated_since and a cursor (for syncing), or order=newest for the latest few (for polling).

import { isDay } from './dates.js';

export function publicApiModule(deps) {
  const { db, save, broadcast, rid, cleanText, readJson, send, badRequest, PJ, INV, isAdmin, teamDay } = deps;
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  // A task the key's maker can see in Kloomie (their visibility rules), and not a private campaign's or project's.
  const apiSees = (auth, t) => (deps.canSee ? deps.canSee(auth, 'task', t) : true) && !deps.privateTask?.(t);
  const fail = (status, msg) => Object.assign(new Error(msg), { status });
  const memberOut = (ws, id) => { const m = id && ws.members.find((x) => x.id === id); return m ? { id: m.id, name: m.name } : null; };
  const memberIn = (ws, v) => {
    if (v == null || v === '') return null;
    const s = String(v).trim().toLowerCase();
    const m = ws.members.find((x) => x.id === v) || ws.members.find((x) => x.name.toLowerCase() === s) || ws.members.find((x) => ((x.userId && db.users?.[x.userId]?.email) || x.email || '').toLowerCase() === s);
    if (!m) throw badRequest(`No one on the team called “${String(v).slice(0, 60)}”. Use a member id or name.`);
    return m.id;
  };
  const hhmm = (n) => (n == null ? null : `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`);
  const minutesIn = (v, name) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Math.round(v);
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
    if (!m) throw badRequest(`Send ${name} as a time like "09:30" or "2:15pm".`);
    const hh = Number(m[1]), mm = Number(m[2]);
    if (mm > 59 || (m[3] ? hh < 1 || hh > 12 : hh > 23)) throw badRequest(`${name} isn’t a real time: ${String(v).trim()}.`);
    let h = hh % (m[3] ? 12 : 24);
    if (m[3]?.toLowerCase() === 'pm') h += 12;
    return h * 60 + mm;
  };
  const dayIn = (v, name) => {
    if (v == null || v === '') return null;
    const s = String(v).slice(0, 10);
    if (!isDay(s)) throw badRequest(`Send ${name} as a real date like 2026-11-20.`);
    return s;
  };

  // A page of a list. Default: oldest change first, from updated_since, continued with next_cursor.
  // order=newest: the most recent first (what a polling trigger wants), no cursor.
  function page(res, qs, all, changedAt, out) {
    const limit = Math.max(1, Math.min(500, Number(qs.get('limit')) || 100));
    if (qs.get('order') === 'newest') return send(res, 200, { data: all.sort((x, y) => changedAt(y) - changedAt(x) || (y.createdAt || 0) - (x.createdAt || 0)).slice(0, limit).map(out), next_cursor: null });
    const since = Date.parse(qs.get('updated_since') || '') || 0;
    const list = all.filter((x) => changedAt(x) > since).sort((x, y) => changedAt(x) - changedAt(y) || (x.id < y.id ? -1 : 1));
    const after = qs.get('cursor') || '';
    const start = after ? list.findIndex((x) => `${changedAt(x)}.${x.id}` === after) + 1 : 0;
    const rows = list.slice(start, start + limit);
    const last = rows.at(-1);
    return send(res, 200, { data: rows.map(out), next_cursor: start + limit < list.length && last ? `${changedAt(last)}.${last.id}` : null });
  }

  // ---------- contacts ----------
  function apiContact(x) {
    const p = deps.publicContact(x);
    return { id: p.id, external_id: x.ext?.api || null, name: p.name, company: p.company, email: p.email, phone: p.phone, address: p.address, city: p.city,
      source: p.source, stage: p.stage, note: p.note, tags: p.tags, do_not_contact: p.dne, assigned_to: p.assignedTo || null, synced_from: x.via || null,
      created_at: iso(x.createdAt), updated_at: iso(x.updatedAt || x.createdAt) };
  }
  const contactIn = (b) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw badRequest('Send the contact as a JSON object.');
    const v = {};
    for (const k of ['name', 'company', 'email', 'phone', 'address', 'city', 'source', 'stage', 'note', 'tags']) if (b[k] !== undefined) v[k] = b[k] ?? '';
    if (b.do_not_contact !== undefined) v.dne = !!b.do_not_contact;
    if (b.email !== undefined && b.email && !deps.EMAIL_RE.test(String(b.email).trim())) throw badRequest(`“${String(b.email).slice(0, 80)}” isn’t an email address.`);
    return v;
  };
  const hasSomeone = (x) => x.name || x.email || x.phone || x.company;
  function addContact(ws, auth, body, ext) {
    if (deps.contactsOf(ws.id).length >= deps.CONTACT_MAX) throw badRequest(`A team can keep up to ${deps.CONTACT_MAX.toLocaleString()} contacts.`);
    const x = deps.applyContact(deps.newContact(ws.id, auth.member), { source: 'API', ...contactIn(body) });
    if (!hasSomeone(x)) throw badRequest('Send a name, company, email or phone.');
    if (ext) x.ext = { ...x.ext, api: ext };
    db.contacts[x.id] = x;
    save();
    deps.contactNews(ws.id, x);
    deps.refreshLiveSoon(ws.id);
    deps.automate(ws.id, 'contact.added', { contact: x, stage: x.stage, who: auth.member, whoId: auth.memberId });
    PJ.emit(ws.id, 'contact.created', apiContact(x), auth.member);
    return x;
  }
  function changeContact(ws, auth, x, body, { fillOnly = false } = {}) {
    const wasStage = x.stage;
    let v = contactIn(body);
    // Matching an existing person: only the empty details are filled in, and tags are added to.
    if (fillOnly) v = { ...Object.fromEntries(Object.entries(v).filter(([k, val]) => k !== 'tags' && k !== 'dne' && !x[k] && val)), ...(v.tags ? { tags: [...x.tags, ...(Array.isArray(v.tags) ? v.tags : String(v.tags).split(/[;,]/))] } : {}) };
    const before = JSON.stringify(apiContact(x));
    const next = deps.applyContact({ ...x, tags: [...x.tags] }, v);
    if (!hasSomeone(next)) throw badRequest('Keep a name, company, email or phone.');
    Object.assign(x, next);
    if (body.external_id !== undefined) x.ext = { ...x.ext, api: body.external_id ? cleanText(body.external_id, 200) : undefined };
    if (JSON.stringify(apiContact(x)) === before) return x;
    save();
    deps.contactNews(ws.id, x);
    deps.refreshLiveSoon(ws.id);
    if (x.stage !== wasStage && x.stage) deps.automate(ws.id, 'contact.stage', { contact: x, stage: x.stage, who: auth.member, whoId: auth.memberId });
    PJ.emit(ws.id, 'contact.updated', apiContact(x), auth.member);
    return x;
  }
  async function contacts(req, res, ws, auth, write, qs, [id, ext]) {
    if (!isAdmin(auth)) throw fail(403, 'Only keys made by a team owner or admin can reach Contacts.');
    const m = req.method;
    const mine = () => deps.contactsOf(ws.id);
    if (!id) {
      if (m === 'GET') {
        let all = mine();
        const email = deps.emailKey(qs.get('email'));
        const phone = deps.phoneKey(qs.get('phone'));
        if (qs.get('email') != null) all = all.filter((x) => email && deps.emailKey(x.email) === email);
        if (qs.get('phone') != null) all = all.filter((x) => phone && deps.phoneKey(x.phone) === phone);
        if (qs.get('stage')) all = all.filter((x) => x.stage.toLowerCase() === qs.get('stage').toLowerCase());
        if (qs.get('tag')) all = all.filter((x) => x.tags.some((t) => t.toLowerCase() === qs.get('tag').toLowerCase()));
        return page(res, qs, all, (x) => x.updatedAt || x.createdAt, apiContact);
      }
      if (m === 'POST') {
        write();
        const body = await readJson(req, 50_000);
        const ext = body.external_id ? cleanText(body.external_id, 200) : null;
        if (ext && mine().some((x) => x.ext?.api === ext)) throw fail(409, 'A contact with that external_id is already here. Use PUT /contacts/external/:id to update it.');
        // match_existing: someone with the same email or phone is updated instead of added twice.
        if (body.match_existing) {
          const e = deps.emailKey(body.email), p = deps.phoneKey(body.phone);
          const x = mine().find((y) => (e && deps.emailKey(y.email) === e) || (p && deps.phoneKey(y.phone) === p));
          if (x) {
            changeContact(ws, auth, x, body, { fillOnly: true });
            if (ext && !x.ext?.api) { x.ext = { ...x.ext, api: ext }; save(); }
            return send(res, 200, { ...apiContact(x), matched: true });
          }
        }
        return send(res, 201, apiContact(addContact(ws, auth, body, ext)));
      }
      throw fail(405, 'Use GET or POST.');
    }
    if (id === 'external' && ext) {
      const key = decodeURIComponent(ext);
      const x = mine().find((y) => y.ext?.api === key);
      if (m === 'GET') return x ? send(res, 200, apiContact(x)) : send(res, 404, { error: 'No contact with that external_id.' });
      if (m === 'PUT') {
        write();
        const body = await readJson(req, 50_000);
        if (x) return send(res, 200, apiContact(changeContact(ws, auth, x, body)));
        return send(res, 201, apiContact(addContact(ws, auth, body, cleanText(key, 200))));
      }
      throw fail(405, 'Use GET or PUT.');
    }
    const x = db.contacts[id];
    if (!x || x.wsId !== ws.id) return send(res, 404, { error: 'No contact with that id.' });
    if (m === 'GET') return send(res, 200, apiContact(x));
    if (m === 'PATCH') {
      write();
      return send(res, 200, apiContact(changeContact(ws, auth, x, await readJson(req, 50_000))));
    }
    if (m === 'DELETE') {
      write();
      if (x.via) throw badRequest(`This contact comes from ${x.via === 'pss' ? 'PSS' : 'Google Contacts'}, so it would come back. Remove it there, or mark it do_not_contact.`);
      const out = apiContact(x);
      delete db.contacts[x.id];
      save();
      broadcast(ws.id, { type: 'contact:remove', id: x.id, forAdmins: true });
      deps.refreshLiveSoon(ws.id);
      PJ.emit(ws.id, 'contact.deleted', out, auth.member);
      return send(res, 200, { deleted: true, id: x.id });
    }
    throw fail(405, 'Use GET, PATCH or DELETE.');
  }

  // ---------- tasks ----------
  const taskChanged = (t) => t.updatedAt || t.doneAt || t.createdAt;
  function apiTask(t) {
    const ws = db.workspaces[t.wsId];
    const goal = t.goalId && db.goals[t.goalId];
    const c = goal && db.campaigns[goal.campaignId];
    const camp = c && c.kind !== 'job' ? c : null; // a Job Flow run is never a campaign here (CONTRACTS.md §4)
    return { id: t.id, text: t.text, due: t.due || null, done: !!t.done, done_at: iso(t.doneAt), done_by: t.done ? t.doneBy || null : null,
      assignee: memberOut(ws, t.assigneeId), job_id: t.recordId || null, campaign: camp ? { id: camp.id, name: camp.title || camp.name || '' } : null,
      priority: t.priority || 0, created_by: t.by || null, created_at: iso(t.createdAt), updated_at: iso(taskChanged(t)) };
  }
  async function tasks(req, res, ws, auth, write, qs, [id]) {
    const m = req.method;
    if (!id) {
      if (m === 'GET') {
        let all = Object.values(db.tasks).filter((t) => t.wsId === ws.id && apiSees(auth, t));
        if (qs.get('done') === 'true' || qs.get('done') === 'false') all = all.filter((t) => !!t.done === (qs.get('done') === 'true'));
        if (qs.get('assignee_id')) all = all.filter((t) => t.assigneeId === qs.get('assignee_id'));
        if (qs.get('job_id')) all = all.filter((t) => t.recordId === qs.get('job_id'));
        return page(res, qs, all, taskChanged, apiTask);
      }
      if (m === 'POST') {
        write();
        const body = await readJson(req, 50_000);
        const recordId = body.job_id || body.record_id || null;
        if (recordId && !PJ.recordAt(recordId, ws.id, auth.memberId)) throw fail(404, 'No job with that job_id.');
        const t = deps.applyTask({ id: rid(), wsId: ws.id, by: auth.member, memberId: auth.memberId, createdAt: Date.now(), text: '', done: false, doneAt: null, due: null, priority: 0, goalId: null, assigneeId: null },
          { text: body.text ?? body.title, due: dayIn(body.due, 'due'), assigneeId: memberIn(ws, body.assignee_id ?? body.assignee), recordId, ...(body.priority !== undefined ? { priority: body.priority } : {}) });
        if (t.assigneeId) t.assignedBy = auth.memberId;
        t.updatedAt = Date.now();
        deps.noteWork?.(t, null);
        db.tasks[t.id] = t;
        if (t.recordId) PJ.recordActivity(t.recordId, { kind: 'task', what: 'added', note: t.text, taskId: t.id, by: auth.member });
        save();
        broadcast(ws.id, { type: 'task', task: deps.publicTask(t) });
        if (!deps.privateTask?.(t)) PJ.emit(ws.id, 'task.created', apiTask(t), auth.member);
        return send(res, 201, apiTask(t));
      }
      throw fail(405, 'Use GET or POST.');
    }
    const t = db.tasks[id];
    if (!t || t.wsId !== ws.id || !apiSees(auth, t)) return send(res, 404, { error: 'No task with that id.' });
    if (m === 'GET') return send(res, 200, apiTask(t));
    if (m === 'PATCH') {
      write();
      // Campaign steps can wait on others and need sign-offs, so they're worked in Kloomie itself.
      if (t.goalId) throw badRequest('This is a step in a campaign. Campaign steps are changed in Kloomie.');
      const body = await readJson(req, 50_000);
      const v = {};
      if (body.text !== undefined || body.title !== undefined) v.text = body.text ?? body.title;
      if (body.due !== undefined) v.due = dayIn(body.due, 'due');
      if (body.assignee_id !== undefined || body.assignee !== undefined) v.assigneeId = memberIn(ws, body.assignee_id ?? body.assignee);
      if (body.priority !== undefined) v.priority = body.priority;
      if (body.done !== undefined && !!body.done !== !!t.done) v.done = !!body.done;
      const next = deps.applyTask({ ...t }, v);
      if (next.assigneeId !== t.assigneeId) next.assignedBy = next.assigneeId ? auth.memberId : null;
      const finished = next.done && !t.done;
      if (finished) next.doneBy = auth.member;
      next.updatedAt = Date.now();
      deps.noteWork?.(next, deps.workOf(t));
      db.tasks[t.id] = next;
      if (finished && next.recordId) PJ.recordActivity(next.recordId, { kind: 'task', what: 'done', note: next.text, taskId: next.id, by: auth.member });
      deps.syncEntries(next);
      save();
      broadcast(ws.id, { type: 'task', task: deps.publicTask(next) });
      if (finished) {
        setImmediate(() => db.tasks[next.id]?.done && deps.automate(ws.id, 'task.done', { task: next, campaign: null, who: auth.member, whoId: auth.memberId }));
        if (!deps.privateTask?.(next)) PJ.emit(ws.id, 'task.done', apiTask(next), auth.member);
      }
      return send(res, 200, apiTask(next));
    }
    throw fail(405, 'Use GET or PATCH.');
  }

  // ---------- visits ----------
  // A visit is someone (or a crew) going to a job on a day, maybe at a time.
  function apiVisit(v) {
    const rec = db.records[v.recordId];
    const ws = rec && db.workspaces[rec.wsId];
    const people = rec ? deps.jobCustomer(rec) : null;
    return { id: v.id, job_id: v.recordId, job: rec ? deps.jobLabel(rec) : null, kind: v.kind, date: v.date, start: hhmm(v.start), end: hhmm(v.end), all_day: v.start == null,
      flexible: !!v.flex, done: !!v.done, note: v.note || '', crew: ws ? v.memberIds.map((id) => memberOut(ws, id)).filter(Boolean) : [], customer: people, booked_by: v.by || null };
  }
  const visitsIn = (ws) => {
    const groups = new Map();
    for (const e of Object.values(db.entries)) if (e.wsId === ws.id && e.visitId && e.recordId) (groups.get(e.visitId) || groups.set(e.visitId, []).get(e.visitId)).push(e);
    return [...groups.values()];
  };
  const visitBody = (ws, b, old) => {
    const v = {};
    if (b.kind !== undefined) {
      const k = deps.VISIT_KINDS.find((x) => x.toLowerCase() === String(b.kind || '').toLowerCase());
      if (!k) throw badRequest(`kind is one of: ${deps.VISIT_KINDS.join(', ')}.`);
      v.kind = k;
    }
    if (b.date !== undefined) v.date = dayIn(b.date, 'date');
    if (b.start !== undefined) v.start = minutesIn(b.start, 'start');
    if (b.end !== undefined) v.end = minutesIn(b.end, 'end');
    if (b.note !== undefined) v.note = b.note;
    if (b.flexible !== undefined) v.flex = !!b.flexible;
    if (b.done !== undefined) v.done = !!b.done;
    const crew = b.crew_ids ?? b.crew;
    if (crew !== undefined) v.memberIds = (Array.isArray(crew) ? crew : String(crew).split(',')).map((x) => memberIn(ws, typeof x === 'object' ? x?.id : String(x).trim())).filter(Boolean);
    if (!old.length && !v.date) throw badRequest('Send the date of the visit.');
    return v;
  };
  async function visits(req, res, ws, auth, write, qs, [id]) {
    const m = req.method;
    if (!id) {
      if (m === 'GET') {
        const today = teamDay(ws.id);
        const from = dayIn(qs.get('from'), 'from') || today;
        const to = dayIn(qs.get('to'), 'to') || new Date(Date.parse(from + 'T12:00:00Z') + 30 * 864e5).toISOString().slice(0, 10);
        if (Date.parse(to) - Date.parse(from) > 366 * 864e5) throw badRequest('Ask for a year or less at a time.');
        let all = visitsIn(ws).map(deps.publicVisit).filter((v) => v.date >= from && v.date <= to && PJ.recordAt(v.recordId, ws.id, auth.memberId));
        if (qs.get('member_id')) all = all.filter((v) => v.memberIds.includes(qs.get('member_id')));
        if (qs.get('job_id')) all = all.filter((v) => v.recordId === qs.get('job_id'));
        all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start ?? -1) - (b.start ?? -1)));
        return send(res, 200, { data: all.slice(0, 2000).map(apiVisit) });
      }
      if (m === 'POST') {
        write();
        const body = await readJson(req, 20_000);
        const at = body.job_id && PJ.recordAt(body.job_id, ws.id, auth.memberId);
        if (!at || !deps.jobOfRecord(at.rec)) throw fail(404, 'Send the job_id of a job to book the visit on.');
        const v = visitBody(ws, body, []);
        if (!v.memberIds?.length) throw badRequest('Send crew_ids: who’s going (member ids or names).');
        const out = deps.setVisit(ws, auth, at.rec, rid(), v);
        PJ.recordActivity(at.rec.id, { kind: 'meeting', what: 'visit booked', note: `${out.kind} on ${out.date}${out.start != null ? ' at ' + deps.fmtMinutes(out.start) : ''}`, by: auth.member });
        return send(res, 201, apiVisit(out));
      }
      throw fail(405, 'Use GET or POST.');
    }
    const list = deps.visitEntries(id).filter((e) => e.wsId === ws.id);
    const rec = list[0] && db.records[list[0].recordId];
    if (!rec || !PJ.recordAt(rec.id, ws.id, auth.memberId)) return send(res, 404, { error: 'No visit with that id.' });
    if (m === 'GET') return send(res, 200, apiVisit(deps.publicVisit(list)));
    if (m === 'PATCH') {
      write();
      return send(res, 200, apiVisit(deps.setVisit(ws, auth, rec, id, visitBody(ws, await readJson(req, 20_000), list), list)));
    }
    if (m === 'DELETE') {
      write();
      deps.dropVisit(ws, rec, list, auth.member);
      return send(res, 200, { deleted: true, id });
    }
    throw fail(405, 'Use GET, PATCH or DELETE.');
  }

  // ---------- invoices ----------
  async function invoices(req, res, ws, auth, write, qs, [id, sub]) {
    if (!isAdmin(auth)) throw fail(403, 'Only keys made by a team owner or admin can reach invoices.');
    const m = req.method;
    if (!id) {
      if (m !== 'GET') throw fail(405, 'Invoices are made from a job in Kloomie. Use GET here.');
      let all = Object.values(db.invoices).filter((x) => x.wsId === ws.id);
      if (qs.get('status')) all = all.filter((x) => x.status === qs.get('status') || (qs.get('status') === 'overdue' && INV.apiInvoice(x).overdue));
      if (qs.get('job_id')) all = all.filter((x) => x.recordId === qs.get('job_id'));
      if (qs.get('contact_id')) all = all.filter((x) => x.to.contactId === qs.get('contact_id'));
      if (qs.get('number')) all = all.filter((x) => x.number.toLowerCase() === qs.get('number').trim().toLowerCase());
      return page(res, qs, all, (x) => x.updatedAt || x.createdAt, INV.apiInvoice);
    }
    const inv = db.invoices[id];
    if (!inv || inv.wsId !== ws.id) return send(res, 404, { error: 'No invoice with that id.' });
    if (m === 'GET' && !sub) return send(res, 200, INV.apiInvoice(inv));
    // A payment taken somewhere else (the books, a bank transfer, cash at the door).
    if (m === 'POST' && sub === 'payments') {
      write();
      if (inv.status === 'void') throw badRequest('This invoice was voided.');
      if (inv.status === 'draft') throw badRequest('This invoice hasn’t been sent yet.');
      const body = await readJson(req, 5_000);
      const amount = Math.round(Number(String(body.amount ?? '').replace(/[$,\s]/g, '')) * 100);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e11) throw badRequest('Send amount in dollars, like 250.00');
      const ref = body.reference ? cleanText(body.reference, 120) : null;
      if (amount > INV.totals(inv).balance && !(ref && inv.payments.some((p) => p.ref === ref))) throw badRequest('That’s more than is still owed on this invoice.');
      if (ref && inv.payments.some((p) => p.ref === ref)) return send(res, 200, { ...INV.apiInvoice(inv), duplicate: true });
      const p = INV.addPayment(inv, { amount, method: INV.METHODS.includes(body.method) ? body.method : 'other', note: cleanText(body.note, 200), day: dayIn(body.date, 'date'), by: auth.member });
      if (ref) { p.ref = ref; save(); }
      return send(res, 201, INV.apiInvoice(inv));
    }
    throw fail(405, 'Use GET, or POST …/payments.');
  }

  // ---------- webhooks an app subscribes to ----------
  async function webhooks(req, res, ws, auth, key, [id], write) {
    const m = req.method;
    if (m !== 'GET') write();
    if (!id && m === 'GET') return send(res, 200, { data: Object.values(db.webhooks).filter((h) => h.wsId === ws.id && h.keyId === key.id).map(PJ.publicHook) });
    if (!id && m === 'POST') {
      const body = await readJson(req, 10_000);
      let events = body.events ?? (body.event ? [body.event] : undefined);
      // Contacts, invoices, payments and texts are owners' and admins' to see, so only their keys hear about them.
      if (!isAdmin(auth)) {
        const adminOnly = (e) => /^(contact|invoice|payment|text)\./.test(e);
        const asked = Array.isArray(events) ? events : deps.EVENTS;
        events = asked.filter((e) => !adminOnly(e));
        if (Array.isArray(body.events ?? (body.event ? [body.event] : null)) && !events.length) return send(res, 403, { error: 'Only keys made by owners and admins can hear about contacts, invoices, payments and texts.' });
      }
      const h = await PJ.makeHook(ws, { url: body.url ?? body.target_url, events, projectId: body.project_id || null }, `${key.name} (API)`, key.id);
      return send(res, 201, { ...PJ.publicHook(h), secret: h.secret });
    }
    const h = id && db.webhooks[id];
    if (!h || h.wsId !== ws.id || h.keyId !== key.id) return send(res, 404, { error: 'No webhook with that id made by this key.' });
    if (m === 'DELETE') {
      delete db.webhooks[h.id];
      save();
      return send(res, 200, { deleted: true, id: h.id });
    }
    throw fail(405, 'Use DELETE.');
  }

  const PARTS = { contacts, tasks, visits, invoices };
  async function handle(req, res, parts) {
    const a = PJ.keyAuth(req);
    if (!a) return send(res, 401, { error: 'Send a valid API key: Authorization: Bearer col_…' });
    if (a.limited) return send(res, 429, { error: 'Too many requests. The limit is 300 a minute per key.' });
    const [what, ...rest] = parts;
    const { ws, auth, key } = a;
    // Who's acting, for the work history: the key's person, through the API.
    deps.actAs?.({ memberId: auth.memberId, api: true });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (ws.deleteAt) return send(res, 423, { error: 'This team is being deleted, so nothing can be changed.' });
      const locked = deps.readOnlyMsg?.(ws);
      if (locked) return send(res, 402, { error: locked });
    }
    const qs = new URL(req.url, 'http://x').searchParams;
    const write = () => { if (!key.write) throw fail(403, 'This key can only read.'); };
    if (what === 'me' && req.method === 'GET') return send(res, 200, { team: ws.name, key: key.name, write: key.write, role: auth.role, events: deps.EVENTS });
    if (what === 'members' && req.method === 'GET') return send(res, 200, { data: ws.members.map((x) => ({ id: x.id, name: x.name, role: x.role })) });
    if (what === 'webhooks') return webhooks(req, res, ws, auth, key, rest, write);
    if (PARTS[what]) return PARTS[what](req, res, ws, auth, write, qs, rest);
    return PJ.v1(req, res, parts, a);
  }

  return { handle, apiContact, apiTask, apiVisit };
}
