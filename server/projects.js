// Projects: the long-lived things a business keeps track of (customers, deals, jobs, vendors), as records with
// fields the team chooses, seen as a table or a board. A project has record types ("Contacts", "Deals"), each
// with fields and views; a record is one row of a type. Templates set a project up in one go; CRM is the first.
//
// Built to be integrated with from day one:
// - Every type and field has a key (contacts, close_date) that never changes when it's renamed, so outside
//   tools can rely on it.
// - The public API (/api/v1) takes an API key made in Settings, reads and writes records by those keys, and
//   matches records by an outside system's id (external_id) so a sync updates instead of duplicating.
// - Webhooks tell other systems when a record is created, changed or deleted, signed so they can check it
//   came from Column, retried when the other end is down.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

export const FIELD_TYPES = ['text', 'number', 'money', 'date', 'select', 'multi', 'person', 'email', 'phone', 'url', 'checkbox', 'link'];
const COLORS = ['gray', 'blue', 'green', 'amber', 'rose', 'violet', 'teal'];
const MAX_RECORDS = 50_000; // per team
const MAX_TYPES = 20;
const MAX_FIELDS = 60;
const MAX_VIEWS = 20;
const EVENTS = ['record.created', 'record.updated', 'record.deleted'];

const keyOf = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s-]+/g, '_').replace(/^(\d)/, '_$1').slice(0, 40) || 'field';
// A key not used yet among these: "stage", then "stage_2"…
const freeKey = (want, used) => {
  let k = keyOf(want);
  for (let n = 2; used.has(k); n++) k = `${keyOf(want)}_${n}`;
  return k;
};

// ---------- templates ----------
// A template is types with fields and views; ids are made fresh each time it's used. Fields refer to each
// other (links, the primary field, a board's column) by key here, and by id once made.
const choice = (label, color) => ({ label, color });
export const TEMPLATES = {
  crm: {
    name: 'CRM', icon: '🤝', about: 'Contacts, companies and deals, with a pipeline board',
    types: [
      { key: 'contacts', name: 'Contacts', singular: 'Contact', icon: '👤', primary: 'name', fields: [
        { key: 'name', name: 'Name', type: 'text' },
        { key: 'email', name: 'Email', type: 'email' },
        { key: 'phone', name: 'Phone', type: 'phone' },
        { key: 'company', name: 'Company', type: 'link', target: 'companies' },
        { key: 'title', name: 'Title', type: 'text' },
        { key: 'stage', name: 'Stage', type: 'select', choices: [choice('Lead', 'gray'), choice('Contacted', 'blue'), choice('Qualified', 'violet'), choice('Customer', 'green'), choice('Lost', 'rose')] },
        { key: 'source', name: 'Source', type: 'select', choices: [choice('Website', 'blue'), choice('Referral', 'green'), choice('Cold call', 'amber'), choice('Event', 'violet'), choice('Other', 'gray')] },
        { key: 'owner', name: 'Owner', type: 'person' },
        { key: 'city', name: 'City', type: 'text' },
        { key: 'last_contacted', name: 'Last contacted', type: 'date' },
      ], views: [{ name: 'All contacts', kind: 'table' }, { name: 'By stage', kind: 'board', groupBy: 'stage' }] },
      { key: 'deals', name: 'Deals', singular: 'Deal', icon: '💰', primary: 'name', fields: [
        { key: 'name', name: 'Deal', type: 'text' },
        { key: 'value', name: 'Value', type: 'money' },
        { key: 'stage', name: 'Stage', type: 'select', choices: [choice('New', 'gray'), choice('Qualified', 'blue'), choice('Proposal', 'violet'), choice('Negotiation', 'amber'), choice('Won', 'green'), choice('Lost', 'rose')] },
        { key: 'close_date', name: 'Close date', type: 'date' },
        { key: 'contact', name: 'Contact', type: 'link', target: 'contacts' },
        { key: 'company', name: 'Company', type: 'link', target: 'companies' },
        { key: 'owner', name: 'Owner', type: 'person' },
      ], views: [{ name: 'Pipeline', kind: 'board', groupBy: 'stage' }, { name: 'All deals', kind: 'table' }] },
      { key: 'companies', name: 'Companies', singular: 'Company', icon: '🏢', primary: 'name', fields: [
        { key: 'name', name: 'Name', type: 'text' },
        { key: 'website', name: 'Website', type: 'url' },
        { key: 'phone', name: 'Phone', type: 'phone' },
        { key: 'industry', name: 'Industry', type: 'select', choices: [] },
        { key: 'city', name: 'City', type: 'text' },
        { key: 'owner', name: 'Owner', type: 'person' },
      ], views: [{ name: 'All companies', kind: 'table' }] },
    ],
  },
  blank: {
    name: 'Blank', icon: '📁', about: 'One list to shape as you like',
    types: [{ key: 'items', name: 'Items', singular: 'Item', icon: '📄', primary: 'name', fields: [{ key: 'name', name: 'Name', type: 'text' }, { key: 'status', name: 'Status', type: 'select', choices: [choice('To do', 'gray'), choice('Doing', 'blue'), choice('Done', 'green')] }], views: [{ name: 'All', kind: 'table' }, { name: 'Board', kind: 'board', groupBy: 'status' }] }],
  },
};

export function projectsModule({ db, save, broadcast, rid, cleanText, isDay, readJson, send, badRequest, isOwnerId, allowLocalHooks = false }) {
  const bad = (msg) => badRequest(msg);
  db.projects ||= {};
  db.records ||= {};
  db.apiKeys ||= {};
  db.webhooks ||= {};

  // ---------- seeing a project ----------
  // A private project is seen by whoever made it and its members; the rest by the whole team.
  const sees = (p, memberId) => !!p && (!p.private || p.memberId === memberId || (p.memberIds || []).includes(memberId));
  const canManage = (p, auth) => p.memberId === auth.memberId || auth.role === 'owner';
  // For broadcast: a message about a project or its records reaches only those who see the project.
  const seesMsg = (msg, memberId) => {
    const id = msg.projectId || msg.project?.id || msg.record?.projectId;
    return !id || sees(db.projects[id], memberId);
  };

  const publicProject = ({ wsId, ...p }) => p;
  const publicRecord = ({ wsId, ...r }) => r;
  const typeOf = (p, typeId) => p.types.find((t) => t.id === typeId || t.key === typeId);
  const fieldOf = (t, id) => t.fields.find((f) => f.id === id || f.key === id);

  // ---------- making projects from templates ----------
  function fromTemplate(key) {
    const tpl = TEMPLATES[key] || TEMPLATES.blank;
    const types = tpl.types.map((t) => ({ id: rid(8), key: t.key, name: t.name, singular: t.singular, icon: t.icon, src: t }));
    const typeIdOf = (k) => types.find((x) => x.key === k)?.id;
    for (const t of types) {
      const src = t.src;
      t.fields = src.fields.map((f) => ({ id: rid(8), key: f.key, name: f.name, type: f.type, ...(f.choices ? { choices: f.choices.map((c) => ({ id: rid(6), label: c.label, color: c.color })) } : {}), ...(f.type === 'link' ? { target: typeIdOf(f.target), many: false } : {}) }));
      t.primary = t.fields.find((f) => f.key === src.primary)?.id || t.fields[0].id;
      t.views = src.views.map((v) => ({ id: rid(8), name: v.name, kind: v.kind, ...(v.groupBy ? { groupBy: t.fields.find((f) => f.key === v.groupBy)?.id } : {}), sort: null }));
      delete t.src;
    }
    return { types, template: tpl === TEMPLATES[key] ? key : 'blank' };
  }

  // ---------- values ----------
  // A value made to fit its field, or undefined to clear it. Unknown choices are added when allowed (imports
  // and the API), so a sync never fails on a new stage name.
  function cleanValue(ws, p, t, f, v, { addChoices = false } = {}) {
    if (v === null || v === undefined || v === '') return undefined;
    const str = (n) => cleanText(v, n);
    switch (f.type) {
      case 'text': return str(2000) || undefined;
      case 'email': {
        const e = str(200).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad(`${f.name}: “${str(60)}” isn’t an email address.`);
        return e;
      }
      case 'phone': return str(40) || undefined;
      case 'url': {
        let u = str(2000);
        if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
        try {
          return new URL(u).protocol.startsWith('http') ? u : undefined;
        } catch {
          throw bad(`${f.name}: “${str(60)}” isn’t a web address.`);
        }
      }
      case 'number': {
        const n = Number(String(v).replace(/[,\s]/g, ''));
        if (!Number.isFinite(n)) throw bad(`${f.name}: “${str(40)}” isn’t a number.`);
        return Math.max(-1e12, Math.min(1e12, n));
      }
      // Money is kept in cents; it comes in as dollars ("1,250.50" or 1250.5).
      case 'money': {
        const n = Number(String(v).replace(/[$,\s]/g, ''));
        if (!Number.isFinite(n)) throw bad(`${f.name}: “${str(40)}” isn’t an amount.`);
        return Math.round(Math.max(-1e10, Math.min(1e10, n)) * 100);
      }
      case 'date': {
        const d = String(v).slice(0, 10);
        if (isDay(d)) return d;
        const t2 = Date.parse(String(v));
        if (Number.isFinite(t2)) return new Date(t2).toISOString().slice(0, 10);
        throw bad(`${f.name}: “${str(40)}” isn’t a date.`);
      }
      case 'checkbox': return v === true || v === 'true' || v === 1 || v === '1' || /^(yes|y|x|✓)$/i.test(String(v)) ? true : undefined;
      case 'person': {
        const id = String(v);
        const m = ws.members.find((x) => x.id === id) || ws.members.find((x) => x.name.toLowerCase() === id.trim().toLowerCase());
        if (!m) throw bad(`${f.name}: nobody on the team called “${str(40)}”.`);
        return m.id;
      }
      case 'select': return choiceFor(f, v, addChoices);
      case 'multi': {
        const list = (Array.isArray(v) ? v : String(v).split(/\s*[,;]\s*/)).filter((x) => x !== '' && x != null);
        const ids = [...new Set(list.slice(0, 50).map((x) => choiceFor(f, x, addChoices)).filter(Boolean))];
        return ids.length ? ids : undefined;
      }
      case 'link': {
        const ids = [...new Set((Array.isArray(v) ? v : [v]).map(String))].filter((id) => {
          const r = db.records[id];
          return r && r.projectId === p.id && r.typeId === f.target;
        });
        return ids.length ? ids.slice(0, f.many ? 200 : 1) : undefined;
      }
    }
    return undefined;
  }
  // A choice by id or label (any case); a new label becomes a new choice when allowed.
  function choiceFor(f, v, add) {
    const s = String(v).trim();
    if (!s) return undefined;
    const c = f.choices.find((x) => x.id === s) || f.choices.find((x) => x.label.toLowerCase() === s.toLowerCase());
    if (c) return c.id;
    if (!add) throw bad(`${f.name}: “${s.slice(0, 40)}” isn’t one of its options.`);
    if (f.choices.length >= 100) throw bad(`${f.name} has too many options.`);
    const n = { id: rid(6), label: s.slice(0, 60), color: COLORS[f.choices.length % COLORS.length] };
    f.choices.push(n);
    return n.id;
  }
  // Values given by field id or key, merged into a record's.
  function applyValues(ws, p, t, rec, values, opts) {
    if (!values || typeof values !== 'object') return rec;
    const before = JSON.stringify(t.fields.map((f) => f.choices?.length || 0));
    for (const [k, v] of Object.entries(values)) {
      const f = fieldOf(t, k);
      if (!f) continue;
      const val = cleanValue(ws, p, t, f, v, opts);
      if (val === undefined) delete rec.values[f.id];
      else rec.values[f.id] = val;
    }
    // New choices change the project too.
    if (JSON.stringify(t.fields.map((f) => f.choices?.length || 0)) !== before) projectNews(p);
    return rec;
  }

  // ---------- news ----------
  function projectNews(p) {
    p.updatedAt = Date.now();
    save();
    broadcast(p.wsId, { type: 'project', project: publicProject(p), projectId: p.id });
  }
  function recordNews(rec, event, by) {
    save();
    broadcast(rec.wsId, { type: 'record', record: publicRecord(rec), projectId: rec.projectId });
    hooksFire(rec, event, by);
  }
  function recordGone(rec, by) {
    delete db.records[rec.id];
    // Links to it go too.
    for (const r of Object.values(db.records)) {
      if (r.projectId !== rec.projectId) continue;
      let changed = false;
      for (const [k, v] of Object.entries(r.values)) {
        if (Array.isArray(v) && v.includes(rec.id)) {
          const rest = v.filter((x) => x !== rec.id);
          if (rest.length) r.values[k] = rest;
          else delete r.values[k];
          changed = true;
        }
      }
      if (changed) {
        r.updatedAt = Date.now();
        broadcast(r.wsId, { type: 'record', record: publicRecord(r), projectId: r.projectId });
      }
    }
    save();
    broadcast(rec.wsId, { type: 'record:remove', id: rec.id, projectId: rec.projectId });
    hooksFire(rec, 'record.deleted', by);
  }
  const teamRecords = (wsId) => Object.values(db.records).filter((r) => r.wsId === wsId).length;
  function newRecord(ws, p, t, auth, values, extId, opts) {
    if (teamRecords(ws.id) >= MAX_RECORDS) throw bad(`A team can keep ${MAX_RECORDS.toLocaleString()} records. Delete some first.`);
    const rec = { id: rid(), wsId: ws.id, projectId: p.id, typeId: t.id, values: {}, extId: extId ? cleanText(extId, 200) : null, by: auth.member, memberId: auth.memberId, createdAt: Date.now(), updatedAt: Date.now() };
    applyValues(ws, p, t, rec, values, opts);
    db.records[rec.id] = rec;
    return rec;
  }

  // ---------- schema changes ----------
  // One change at a time, so two people editing fields don't overwrite each other's.
  function schemaOp(p, body) {
    const t = body.typeId ? typeOf(p, body.typeId) : null;
    const name = (n) => cleanText(body.name, n);
    switch (body.op) {
      case 'addType': {
        if (p.types.length >= MAX_TYPES) throw bad(`A project can have ${MAX_TYPES} kinds of records.`);
        const nm = name(60) || 'New list';
        const f = { id: rid(8), key: 'name', name: 'Name', type: 'text' };
        const nt = { id: rid(8), key: freeKey(nm, new Set(p.types.map((x) => x.key))), name: nm, singular: cleanText(body.singular, 60) || nm.replace(/s$/, ''), icon: cleanText(body.icon, 8) || '📄', primary: f.id, fields: [f], views: [{ id: rid(8), name: 'All', kind: 'table', sort: null }] };
        p.types.push(nt);
        return nt;
      }
      case 'updateType': {
        if (!t) throw bad('That list is gone.');
        if (body.name !== undefined) t.name = name(60) || t.name;
        if (body.singular !== undefined) t.singular = cleanText(body.singular, 60) || t.singular;
        if (body.icon !== undefined) t.icon = cleanText(body.icon, 8) || t.icon;
        if (body.primary !== undefined && t.fields.some((f) => f.id === body.primary && f.type === 'text')) t.primary = body.primary;
        return t;
      }
      case 'removeType': {
        if (!t) throw bad('That list is gone.');
        if (p.types.length === 1) throw bad('A project needs at least one list.');
        p.types = p.types.filter((x) => x !== t);
        for (const r of Object.values(db.records)) if (r.projectId === p.id && r.typeId === t.id) delete db.records[r.id];
        // Link fields pointing at it go.
        for (const o of p.types) o.fields = o.fields.filter((f) => !(f.type === 'link' && f.target === t.id));
        return null;
      }
      case 'addField': {
        if (!t) throw bad('That list is gone.');
        if (t.fields.length >= MAX_FIELDS) throw bad(`A list can have ${MAX_FIELDS} fields.`);
        const type = FIELD_TYPES.includes(body.type) ? body.type : 'text';
        const nm = name(60) || 'Field';
        const f = { id: rid(8), key: freeKey(nm, new Set(t.fields.map((x) => x.key))), name: nm, type };
        if (type === 'select' || type === 'multi') f.choices = (Array.isArray(body.choices) ? body.choices : []).slice(0, 100).map((c, i) => ({ id: rid(6), label: cleanText(c?.label ?? c, 60), color: COLORS.includes(c?.color) ? c.color : COLORS[i % COLORS.length] })).filter((c) => c.label);
        if (type === 'link') {
          const to = typeOf(p, body.target);
          if (!to) throw bad('Pick which list it links to.');
          f.target = to.id;
          f.many = !!body.many;
        }
        t.fields.push(f);
        return f;
      }
      case 'updateField': {
        const f = t && fieldOf(t, body.fieldId);
        if (!f) throw bad('That field is gone.');
        if (body.name !== undefined) f.name = name(60) || f.name;
        if (body.hidden !== undefined) f.hidden = !!body.hidden;
        if (Array.isArray(body.choices) && f.choices) {
          // Choices keep their ids, so records keep their values when a label or color changes.
          f.choices = body.choices.slice(0, 100).map((c, i) => ({ id: f.choices.some((x) => x.id === c?.id) ? c.id : rid(6), label: cleanText(c?.label, 60), color: COLORS.includes(c?.color) ? c.color : COLORS[i % COLORS.length] })).filter((c) => c.label);
          const ids = new Set(f.choices.map((c) => c.id));
          for (const r of Object.values(db.records)) {
            if (r.projectId !== p.id || r.typeId !== t.id || r.values[f.id] == null) continue;
            if (f.type === 'select' && !ids.has(r.values[f.id])) delete r.values[f.id];
            if (f.type === 'multi') { const keep = r.values[f.id].filter((x) => ids.has(x)); if (keep.length) r.values[f.id] = keep; else delete r.values[f.id]; }
          }
        }
        if (body.many !== undefined && f.type === 'link') f.many = !!body.many;
        return f;
      }
      case 'moveField': {
        const f = t && fieldOf(t, body.fieldId);
        if (!f) throw bad('That field is gone.');
        const to = Math.max(0, Math.min(t.fields.length - 1, Math.round(Number(body.to) || 0)));
        t.fields = t.fields.filter((x) => x !== f);
        t.fields.splice(to, 0, f);
        return f;
      }
      case 'removeField': {
        const f = t && fieldOf(t, body.fieldId);
        if (!f) throw bad('That field is gone.');
        if (f.id === t.primary) throw bad('That’s the name of each record. Rename it instead.');
        t.fields = t.fields.filter((x) => x !== f);
        for (const v of t.views) if (v.groupBy === f.id) { v.kind = 'table'; delete v.groupBy; }
        for (const r of Object.values(db.records)) if (r.projectId === p.id && r.typeId === t.id) delete r.values[f.id];
        return null;
      }
      case 'addView':
      case 'updateView': {
        if (!t) throw bad('That list is gone.');
        let v = body.op === 'updateView' ? t.views.find((x) => x.id === body.viewId) : null;
        if (body.op === 'updateView' && !v) throw bad('That view is gone.');
        if (!v) {
          if (t.views.length >= MAX_VIEWS) throw bad(`A list can have ${MAX_VIEWS} views.`);
          v = { id: rid(8), name: 'View', kind: 'table', sort: null };
          t.views.push(v);
        }
        if (body.name !== undefined) v.name = name(60) || v.name;
        if (body.kind !== undefined) v.kind = body.kind === 'board' ? 'board' : 'table';
        if (body.groupBy !== undefined) v.groupBy = t.fields.some((f) => f.id === body.groupBy && f.type === 'select') ? body.groupBy : v.groupBy;
        if (v.kind === 'board' && !v.groupBy) {
          const sel = t.fields.find((f) => f.type === 'select');
          if (!sel) throw bad('A board needs a field with options, like Stage, to make its columns.');
          v.groupBy = sel.id;
        }
        if (body.sort !== undefined) v.sort = body.sort && t.fields.some((f) => f.id === body.sort.field) ? { field: body.sort.field, dir: body.sort.dir === 'desc' ? 'desc' : 'asc' } : null;
        if (body.filter !== undefined) v.filter = cleanFilter(t, body.filter);
        return v;
      }
      case 'removeView': {
        if (!t) throw bad('That list is gone.');
        if (t.views.length === 1) throw bad('A list needs at least one view.');
        t.views = t.views.filter((x) => x.id !== body.viewId);
        return null;
      }
    }
    throw bad('Unknown change.');
  }
  // A view's filter: a field and the values it can have (choices, a person, empty or not).
  function cleanFilter(t, f) {
    if (!f || typeof f !== 'object') return null;
    const field = fieldOf(t, f.field);
    if (!field) return null;
    return { field: field.id, is: (Array.isArray(f.is) ? f.is : []).slice(0, 50).map(String) };
  }

  // ---------- the app's routes: /api/projects… and /api/records… ----------
  async function route(req, res, parts, auth, ws) {
    const [a, b, c, d] = parts;
    const m = req.method;
    if (a === 'projects') {
      if (m === 'GET' && !b) return send(res, 200, Object.values(db.projects).filter((p) => p.wsId === ws.id && sees(p, auth.memberId)).map(publicProject));
      if (m === 'POST' && !b) {
        const body = await readJson(req, 50_000);
        const { types, template } = fromTemplate(body.template);
        const p = { id: rid(), wsId: ws.id, name: cleanText(body.name, 80) || TEMPLATES[template].name, icon: cleanText(body.icon, 8) || TEMPLATES[template].icon, template, types, private: !!body.private, memberIds: [], memberId: auth.memberId, by: auth.member, createdAt: Date.now(), updatedAt: Date.now() };
        db.projects[p.id] = p;
        projectNews(p);
        return send(res, 200, publicProject(p));
      }
      const p = b && db.projects[b];
      if (!p || p.wsId !== ws.id || !sees(p, auth.memberId)) return send(res, 404, { error: 'That project is gone.' });
      if (m === 'GET' && c === 'records') return send(res, 200, Object.values(db.records).filter((r) => r.projectId === p.id).map(publicRecord));
      if (m === 'POST' && c === 'schema') {
        const body = await readJson(req, 200_000);
        const out = schemaOp(p, body);
        projectNews(p);
        return send(res, 200, { project: publicProject(p), made: out });
      }
      if (m === 'POST' && c === 'records') {
        const body = await readJson(req, 200_000);
        const t = typeOf(p, body.typeId);
        if (!t) return send(res, 400, { error: 'Pick which list it goes in.' });
        const rec = newRecord(ws, p, t, auth, body.values, body.extId, { addChoices: false });
        recordNews(rec, 'record.created', auth.member);
        return send(res, 200, publicRecord(rec));
      }
      // Rows from a spreadsheet: each matched to a record by external id or a field (email, say), else added.
      if (m === 'POST' && c === 'import') {
        const body = await readJson(req, 20_000_000);
        const t = typeOf(p, body.typeId);
        if (!t) return send(res, 400, { error: 'Pick which list to import into.' });
        const rows = Array.isArray(body.rows) ? body.rows.slice(0, 20_000) : [];
        const match = body.match && fieldOf(t, body.match);
        let added = 0, updated = 0;
        const skipped = [];
        const index = new Map();
        if (match) for (const r of Object.values(db.records)) if (r.projectId === p.id && r.typeId === t.id && r.values[match.id] != null) index.set(String(r.values[match.id]).toLowerCase(), r);
        rows.forEach((row, i) => {
          try {
            let rec = null;
            if (match && row[match.id] != null) {
              const key = cleanValue(ws, p, t, match, row[match.id], { addChoices: true });
              rec = key != null ? index.get(String(key).toLowerCase()) : null;
            }
            if (rec) {
              applyValues(ws, p, t, rec, row, { addChoices: true });
              rec.updatedAt = Date.now();
              broadcast(rec.wsId, { type: 'record', record: publicRecord(rec), projectId: p.id });
              hooksFire(rec, 'record.updated', auth.member);
              updated++;
            } else {
              rec = newRecord(ws, p, t, auth, row, null, { addChoices: true });
              if (match && rec.values[match.id] != null) index.set(String(rec.values[match.id]).toLowerCase(), rec);
              broadcast(rec.wsId, { type: 'record', record: publicRecord(rec), projectId: p.id });
              hooksFire(rec, 'record.created', auth.member);
              added++;
            }
          } catch (e) {
            if (skipped.length < 50) skipped.push({ row: i + 1, error: e.message });
          }
        });
        projectNews(p);
        return send(res, 200, { added, updated, skipped });
      }
      if (m === 'PATCH' && !c) {
        const body = await readJson(req, 50_000);
        if (body.name !== undefined) p.name = cleanText(body.name, 80) || p.name;
        if (body.icon !== undefined) p.icon = cleanText(body.icon, 8) || p.icon;
        if (body.private !== undefined || body.memberIds !== undefined) {
          if (!canManage(p, auth)) return send(res, 403, { error: 'Only whoever made the project and team owners can change who sees it.' });
          if (body.private !== undefined) p.private = !!body.private;
          if (Array.isArray(body.memberIds)) p.memberIds = body.memberIds.filter((id) => ws.members.some((x) => x.id === id));
        }
        projectNews(p);
        // Everyone gets told; those who can't see it any more drop it.
        broadcast(ws.id, { type: 'project:access', id: p.id });
        return send(res, 200, publicProject(p));
      }
      if (m === 'DELETE' && !c) {
        if (!canManage(p, auth)) return send(res, 403, { error: 'Only whoever made the project and team owners can delete it.' });
        for (const r of Object.values(db.records)) if (r.projectId === p.id) delete db.records[r.id];
        delete db.projects[p.id];
        for (const h of Object.values(db.webhooks)) if (h.projectId === p.id) delete db.webhooks[h.id];
        save();
        broadcast(ws.id, { type: 'project:remove', id: p.id });
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'Method not allowed' });
    }
    if (a === 'records' && b) {
      const rec = db.records[b];
      const p = rec && db.projects[rec.projectId];
      if (!rec || rec.wsId !== ws.id || !sees(p, auth.memberId)) return send(res, 404, { error: 'That record is gone.' });
      const t = typeOf(p, rec.typeId);
      if (m === 'PATCH') {
        const body = await readJson(req, 200_000);
        applyValues(ws, p, t, rec, body.values, { addChoices: false });
        if (body.docId !== undefined) rec.docId = db.items[body.docId]?.wsId === ws.id && db.items[body.docId].type === 'text' ? body.docId : null;
        rec.updatedAt = Date.now();
        recordNews(rec, 'record.updated', auth.member);
        return send(res, 200, publicRecord(rec));
      }
      if (m === 'DELETE') {
        recordGone(rec, auth.member);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'Method not allowed' });
    }
    // API keys and webhooks: team owners only.
    if (a === 'integrations') {
      if (auth.role !== 'owner') return send(res, 403, { error: 'Only team owners manage integrations.' });
      if (b === 'keys') {
        if (m === 'GET' && !c) return send(res, 200, Object.values(db.apiKeys).filter((k) => k.wsId === ws.id).map(publicKey));
        if (m === 'POST' && !c) {
          const body = await readJson(req, 10_000);
          const token = 'col_' + crypto.randomBytes(24).toString('base64url');
          const k = { id: rid(), wsId: ws.id, name: cleanText(body.name, 60) || 'API key', hash: sha(token), prefix: token.slice(0, 10), write: body.write !== false, memberId: auth.memberId, by: auth.member, createdAt: Date.now(), lastUsedAt: null };
          db.apiKeys[k.id] = k;
          save();
          // The only time the key itself is shown.
          return send(res, 200, { ...publicKey(k), token });
        }
        const k = c && db.apiKeys[c];
        if (!k || k.wsId !== ws.id) return send(res, 404, { error: 'That key is gone.' });
        if (m === 'DELETE') {
          delete db.apiKeys[k.id];
          save();
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { error: 'Method not allowed' });
      }
      if (b === 'webhooks') {
        if (m === 'GET' && !c) return send(res, 200, Object.values(db.webhooks).filter((h) => h.wsId === ws.id).map(publicHook));
        if (m === 'POST' && !c) {
          const body = await readJson(req, 10_000);
          const url = await hookUrl(body.url);
          const p = body.projectId ? db.projects[body.projectId] : null;
          if (body.projectId && (!p || p.wsId !== ws.id)) return send(res, 404, { error: 'That project is gone.' });
          if (p?.private) return send(res, 400, { error: 'Private projects don’t send webhooks.' });
          const h = { id: rid(), wsId: ws.id, url, projectId: p?.id || null, events: (Array.isArray(body.events) ? body.events : EVENTS).filter((e) => EVENTS.includes(e)), secret: 'whsec_' + crypto.randomBytes(24).toString('base64url'), active: true, failures: 0, log: [], by: auth.member, createdAt: Date.now() };
          if (!h.events.length) h.events = [...EVENTS];
          db.webhooks[h.id] = h;
          save();
          return send(res, 200, { ...publicHook(h), secret: h.secret });
        }
        const h = c && db.webhooks[c];
        if (!h || h.wsId !== ws.id) return send(res, 404, { error: 'That webhook is gone.' });
        if (m === 'POST' && d === 'test') {
          deliver(h, { id: 'evt_' + rid(), type: 'ping', created_at: new Date().toISOString(), data: { message: 'Hello from Column' } });
          return send(res, 200, { ok: true });
        }
        if (m === 'PATCH' && !d) {
          const body = await readJson(req, 10_000);
          if (body.active !== undefined) { h.active = !!body.active; if (h.active) h.failures = 0; }
          if (body.url !== undefined) h.url = await hookUrl(body.url);
          if (Array.isArray(body.events)) h.events = body.events.filter((e) => EVENTS.includes(e));
          save();
          return send(res, 200, publicHook(h));
        }
        if (m === 'DELETE' && !d) {
          delete db.webhooks[h.id];
          save();
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { error: 'Method not allowed' });
      }
    }
    return null;
  }

  // ---------- the public API: /api/v1 ----------
  // Records in and out by type and field keys, values as an outside system would write them: options by their
  // label, people by name or id, money in dollars, links as record ids.
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const publicKey = ({ hash, wsId, ...k }) => k;
  const publicHook = ({ secret, wsId, ...h }) => ({ ...h, log: (h.log || []).slice(0, 20) });
  const rate = new Map();
  function keyAuth(req) {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
    if (!token.startsWith('col_')) return null;
    const k = Object.values(db.apiKeys).find((x) => x.hash === sha(token));
    if (!k) return null;
    const ws = db.workspaces[k.wsId];
    if (!ws) return null;
    // 300 requests a minute per key.
    const now = Date.now();
    const r = rate.get(k.id) || { at: now, n: 0 };
    if (now - r.at > 60_000) { r.at = now; r.n = 0; }
    r.n++;
    rate.set(k.id, r);
    if (r.n > 300) return { limited: true };
    if (now - (k.lastUsedAt || 0) > 60_000) { k.lastUsedAt = now; save(); }
    const mb = ws.members.find((x) => x.id === k.memberId);
    return { key: k, ws, auth: { wsId: ws.id, memberId: k.memberId, member: `${k.name} (API)`, role: mb?.role || 'member' } };
  }
  function outValue(ws, f, v) {
    if (v == null) return null;
    if (f.type === 'money') return v / 100;
    if (f.type === 'select') return f.choices.find((c) => c.id === v)?.label ?? null;
    if (f.type === 'multi') return v.map((id) => f.choices.find((c) => c.id === id)?.label).filter(Boolean);
    if (f.type === 'person') { const m = ws.members.find((x) => x.id === v); return m ? { id: m.id, name: m.name } : null; }
    if (f.type === 'link') return f.many ? v : v[0] ?? null;
    return v;
  }
  function outRecord(ws, p, t, r) {
    return { id: r.id, external_id: r.extId || null, type: t.key, created_at: new Date(r.createdAt).toISOString(), updated_at: new Date(r.updatedAt).toISOString(),
      fields: Object.fromEntries(t.fields.map((f) => [f.key, outValue(ws, f, r.values[f.id])])) };
  }
  const outSchema = (p) => ({ id: p.id, name: p.name, template: p.template, types: p.types.map((t) => ({ key: t.key, name: t.name, singular: t.singular,
    fields: t.fields.map((f) => ({ key: f.key, name: f.name, type: f.type, ...(f.choices ? { options: f.choices.map((c) => c.label) } : {}), ...(f.type === 'link' ? { links_to: p.types.find((x) => x.id === f.target)?.key, many: !!f.many } : {}), ...(f.id === t.primary ? { primary: true } : {}) })) })) });
  // Fields from outside, by key.
  const inFields = (t, fields) => {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw bad('Send fields as an object of field keys and values.');
    const unknown = Object.keys(fields).filter((k) => !t.fields.some((f) => f.key === k));
    if (unknown.length) throw bad(`Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.slice(0, 5).join(', ')}. This list has: ${t.fields.map((f) => f.key).join(', ')}.`);
    return fields;
  };
  async function v1(req, res, parts) {
    const a = keyAuth(req);
    if (!a) return send(res, 401, { error: 'Send a valid API key: Authorization: Bearer col_…' });
    if (a.limited) return send(res, 429, { error: 'Too many requests. The limit is 300 a minute per key.' });
    const { ws, auth, key } = a;
    const m = req.method;
    if (parts[0] !== 'projects') {
      if (parts[0] === 'me' && m === 'GET') return send(res, 200, { team: ws.name, key: key.name, write: key.write });
      return send(res, 404, { error: 'Not found. Start at GET /api/v1/projects.' });
    }
    const [, p_, t_, sub_, rid_, extra_] = parts;
    // A key is the team's, so it reaches the team's projects, never anyone's private ones.
    if (m === 'GET' && !p_) return send(res, 200, { projects: Object.values(db.projects).filter((p) => p.wsId === ws.id && !p.private).map(outSchema) });
    const p = db.projects[p_];
    if (!p || p.wsId !== ws.id || p.private) return send(res, 404, { error: 'No project with that id.' });
    if (m === 'GET' && !t_) return send(res, 200, outSchema(p));
    const t = p.types.find((x) => x.key === t_);
    if (!t) return send(res, 404, { error: `No list “${t_}” in this project. It has: ${p.types.map((x) => x.key).join(', ')}.` });
    if (sub_ !== 'records') return send(res, 404, { error: `Use /api/v1/projects/${p.id}/${t.key}/records` });
    const write = () => {
      if (!key.write) throw Object.assign(new Error('This key can only read.'), { status: 403 });
    };
    if (m === 'GET' && !rid_) {
      // Newest changes last, paged with a cursor; updated_since for syncing.
      const since = Date.parse(new URL(req.url, 'http://x').searchParams.get('updated_since') || '') || 0;
      const qs = new URL(req.url, 'http://x').searchParams;
      const limit = Math.max(1, Math.min(500, Number(qs.get('limit')) || 100));
      const after = qs.get('cursor') || '';
      const all = Object.values(db.records).filter((r) => r.projectId === p.id && r.typeId === t.id && r.updatedAt > since).sort((x, y) => x.updatedAt - y.updatedAt || (x.id < y.id ? -1 : 1));
      const start = after ? all.findIndex((r) => `${r.updatedAt}.${r.id}` === after) + 1 : 0;
      const page = all.slice(start, start + limit);
      const last = page.at(-1);
      return send(res, 200, { records: page.map((r) => outRecord(ws, p, t, r)), next_cursor: start + limit < all.length && last ? `${last.updatedAt}.${last.id}` : null });
    }
    if (m === 'POST' && !rid_) {
      write();
      const body = await readJson(req, 200_000);
      if (body.external_id && Object.values(db.records).some((r) => r.projectId === p.id && r.typeId === t.id && r.extId === String(body.external_id))) return send(res, 409, { error: 'A record with that external_id is already here. Use PUT …/records/external/:id to update it.' });
      const rec = newRecord(ws, p, t, auth, inFields(t, body.fields), body.external_id, { addChoices: true });
      recordNews(rec, 'record.created', auth.member);
      return send(res, 201, outRecord(ws, p, t, rec));
    }
    // Upsert by the outside system's id.
    if (rid_ === 'external' && extra_) {
      const ext = decodeURIComponent(extra_);
      let rec = Object.values(db.records).find((r) => r.projectId === p.id && r.typeId === t.id && r.extId === ext);
      if (m === 'GET') return rec ? send(res, 200, outRecord(ws, p, t, rec)) : send(res, 404, { error: 'No record with that external_id.' });
      if (m === 'PUT') {
        write();
        const body = await readJson(req, 200_000);
        const fields = inFields(t, body.fields);
        if (rec) {
          applyValues(ws, p, t, rec, fields, { addChoices: true });
          rec.updatedAt = Date.now();
          recordNews(rec, 'record.updated', auth.member);
          return send(res, 200, outRecord(ws, p, t, rec));
        }
        rec = newRecord(ws, p, t, auth, fields, ext, { addChoices: true });
        recordNews(rec, 'record.created', auth.member);
        return send(res, 201, outRecord(ws, p, t, rec));
      }
      return send(res, 405, { error: 'Use GET or PUT.' });
    }
    const rec = rid_ && db.records[rid_];
    if (!rec || rec.projectId !== p.id || rec.typeId !== t.id) return send(res, 404, { error: 'No record with that id in this list.' });
    if (m === 'GET') return send(res, 200, outRecord(ws, p, t, rec));
    if (m === 'PATCH') {
      write();
      const body = await readJson(req, 200_000);
      applyValues(ws, p, t, rec, inFields(t, body.fields), { addChoices: true });
      if (body.external_id !== undefined) rec.extId = body.external_id ? cleanText(body.external_id, 200) : null;
      rec.updatedAt = Date.now();
      recordNews(rec, 'record.updated', auth.member);
      return send(res, 200, outRecord(ws, p, t, rec));
    }
    if (m === 'DELETE') {
      write();
      recordGone(rec, auth.member);
      return send(res, 200, { deleted: true, id: rec.id });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // ---------- webhooks ----------
  // Only public web addresses: a webhook can't be pointed at the server's own network.
  const privateIp = (ip) => {
    if (net.isIPv4(ip)) {
      const [a1, b1] = ip.split('.').map(Number);
      return a1 === 10 || a1 === 127 || a1 === 0 || (a1 === 169 && b1 === 254) || (a1 === 172 && b1 >= 16 && b1 <= 31) || (a1 === 192 && b1 === 168) || (a1 === 100 && b1 >= 64 && b1 <= 127);
    }
    const s = ip.toLowerCase();
    return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s.startsWith('::ffff:127.') || s.startsWith('::ffff:10.') || s.startsWith('::ffff:192.168.');
  };
  async function hookUrl(v) {
    let u;
    try {
      u = new URL(String(v || '').trim());
    } catch {
      throw bad('Enter the full web address, like https://example.com/hooks/column');
    }
    if (!/^https?:$/.test(u.protocol)) throw bad('Webhook addresses start with https://');
    if (!allowLocalHooks) {
      if (u.protocol !== 'https:') throw bad('Webhook addresses need https://');
      const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
      if (!addrs.length) throw bad(`Couldn’t find ${u.hostname}.`);
      if (addrs.some((x) => privateIp(x.address))) throw bad('That address is on a private network. Use a public https:// address.');
    }
    return u.toString();
  }
  function hooksFire(rec, type, by) {
    const hooks = Object.values(db.webhooks).filter((h) => h.wsId === rec.wsId && h.active && h.events.includes(type) && (!h.projectId || h.projectId === rec.projectId));
    if (!hooks.length) return;
    const p = db.projects[rec.projectId];
    const ws = db.workspaces[rec.wsId];
    const t = p && typeOf(p, rec.typeId);
    if (!p || !t || !ws || p.private) return; // private projects stay in Column
    const event = { id: 'evt_' + rid(), type, created_at: new Date().toISOString(), by, project: { id: p.id, name: p.name }, list: t.key, data: outRecord(ws, p, t, rec) };
    for (const h of hooks) deliver(h, event);
  }
  // Signed like Stripe: X-Column-Signature: t=<seconds>,v1=<hmac of "t.body">. Tried 4 times over ~10 minutes.
  const DELAYS = [0, 30_000, 120_000, 480_000];
  async function deliver(h, event, attempt = 0) {
    const body = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', h.secret).update(`${ts}.${body}`).digest('hex');
    const started = Date.now();
    let status = 0, error = null;
    try {
      if (!allowLocalHooks) await hookUrl(h.url); // the address could point somewhere private by now
      const r = await fetch(h.url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Column-Webhooks/1', 'X-Column-Event': event.type, 'X-Column-Delivery': event.id, 'X-Column-Signature': `t=${ts},v1=${sig}` }, body, signal: AbortSignal.timeout(10_000) });
      status = r.status;
    } catch (e) {
      error = e.message;
    }
    const ok = status >= 200 && status < 300;
    h.log = [{ at: Date.now(), event: event.type, id: event.id, status, ok, ms: Date.now() - started, error, attempt: attempt + 1 }, ...(h.log || [])].slice(0, 20);
    if (ok) h.failures = 0;
    else {
      h.failures = (h.failures || 0) + 1;
      // Turned off after 20 failures in a row, so a dead address doesn't pile up.
      if (h.failures >= 20) h.active = false;
      else if (attempt + 1 < DELAYS.length && db.webhooks[h.id]) setTimeout(() => db.webhooks[h.id]?.active && deliver(db.webhooks[h.id], event, attempt + 1), DELAYS[attempt + 1]);
    }
    save();
  }

  // What the app needs at sign-in: the projects this person sees (records load when a project opens).
  const stateFor = (ws, auth) => Object.values(db.projects).filter((p) => p.wsId === ws.id && sees(p, auth.memberId)).map(publicProject);

  return { route, v1, seesMsg, stateFor, sees, TEMPLATES: Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, { name: t.name, icon: t.icon, about: t.about }])) };
}
