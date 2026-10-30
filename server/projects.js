// Projects: the long-lived things a business keeps track of (customers, deals, jobs, bids, quotes), as records
// with fields the team chooses, seen as a table or a board. A record with line items can go to a customer as a
// quote: a page of its own they open from a link, and accept or decline. A project has record types ("Contacts", "Deals"), each
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

export const FIELD_TYPES = ['text', 'number', 'money', 'date', 'select', 'multi', 'person', 'email', 'phone', 'url', 'checkbox', 'link', 'items', 'autonumber', 'files'];
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
// A job to do once a quote is won: when, who, where, and how far along.
const JOBS_TYPE = { key: 'jobs', name: 'Jobs', singular: 'Job', icon: '🛠️', primary: 'job', fields: [
  { key: 'job', name: 'Job', type: 'text' },
  { key: 'client', name: 'Client', type: 'link', target: 'clients' },
  { key: 'status', name: 'Status', type: 'select', choices: [{ label: 'Scheduled', color: 'gray' }, { label: 'Measured', color: 'blue' }, { label: 'Ordered', color: 'violet' }, { label: 'Installing', color: 'amber' }, { label: 'Installed', color: 'teal' }, { label: 'Invoiced', color: 'rose' }, { label: 'Paid', color: 'green' }] },
  { key: 'install_date', name: 'Install date', type: 'date' },
  { key: 'crew', name: 'Crew lead', type: 'person' },
  { key: 'address', name: 'Address', type: 'text' },
  { key: 'value', name: 'Value', type: 'money' },
  { key: 'quote', name: 'Quote', type: 'link', target: 'quotes' },
  { key: 'materials', name: 'Materials', type: 'text' },
  { key: 'photos', name: 'Photos', type: 'files' },
], views: [{ name: 'Board', kind: 'board', groupBy: 'status' }, { name: 'Schedule', kind: 'table', sortBy: 'install_date' }] };
const CLIENTS_TYPE = { key: 'clients', name: 'Clients', singular: 'Client', icon: '🏢', primary: 'name', fields: [
  { key: 'name', name: 'Name', type: 'text' },
  { key: 'kind', name: 'Kind', type: 'select', choices: [{ label: 'Homeowner', color: 'blue' }, { label: 'Business', color: 'violet' }, { label: 'General contractor', color: 'amber' }, { label: 'Property manager', color: 'teal' }] },
  { key: 'contact', name: 'Contact person', type: 'text' },
  { key: 'email', name: 'Email', type: 'email' },
  { key: 'phone', name: 'Phone', type: 'phone' },
  { key: 'address', name: 'Address', type: 'text' },
], views: [{ name: 'All clients', kind: 'table' }] };
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
  bids: {
    name: 'Bids & Quotes', icon: '📐', about: 'Jobs you bid on, quotes you send, clients and a price list',
    types: [
      { key: 'quotes', name: 'Quotes', singular: 'Quote', icon: '🧾', primary: 'title', fields: [
        { key: 'title', name: 'Quote', type: 'text' },
        { key: 'number', name: 'Number', type: 'autonumber', prefix: 'Q-', start: 1001 },
        { key: 'client', name: 'Client', type: 'link', target: 'clients' },
        { key: 'status', name: 'Status', type: 'select', choices: [choice('Draft', 'gray'), choice('Sent', 'blue'), choice('Viewed', 'violet'), choice('Accepted', 'green'), choice('Declined', 'rose'), choice('Expired', 'amber')] },
        { key: 'items', name: 'Line items', type: 'items' },
        { key: 'issued', name: 'Issued', type: 'date' },
        { key: 'valid_until', name: 'Valid until', type: 'date' },
        { key: 'bid', name: 'Bid', type: 'link', target: 'bids' },
        { key: 'terms', name: 'Terms', type: 'text' },
        { key: 'owner', name: 'Owner', type: 'person' },
        { key: 'accepted_by', name: 'Accepted by', type: 'text' },
        { key: 'accepted_on', name: 'Accepted on', type: 'date' },
      ], views: [{ name: 'By status', kind: 'board', groupBy: 'status' }, { name: 'All quotes', kind: 'table' }] },
      { key: 'bids', name: 'Bids', singular: 'Bid', icon: '📐', primary: 'job', fields: [
        { key: 'job', name: 'Job', type: 'text' },
        { key: 'client', name: 'Client', type: 'link', target: 'clients' },
        { key: 'status', name: 'Status', type: 'select', choices: [choice('Researching', 'gray'), choice('Estimating', 'blue'), choice('Submitted', 'violet'), choice('Won', 'green'), choice('Lost', 'rose'), choice('No bid', 'amber')] },
        { key: 'bid_due', name: 'Bid due', type: 'date' },
        { key: 'site_visit', name: 'Site visit', type: 'date' },
        { key: 'location', name: 'Location', type: 'text' },
        { key: 'estimate', name: 'Estimate', type: 'items' },
        { key: 'scope', name: 'Scope', type: 'text' },
        { key: 'plans', name: 'Plans & specs', type: 'files' },
        { key: 'chance', name: 'Win chance', type: 'select', choices: [choice('Low', 'rose'), choice('Medium', 'amber'), choice('High', 'green')] },
        { key: 'competitors', name: 'Competing', type: 'text' },
        { key: 'result', name: 'Why we won or lost', type: 'text' },
        { key: 'owner', name: 'Estimator', type: 'person' },
      ], views: [{ name: 'Pipeline', kind: 'board', groupBy: 'status' }, { name: 'All bids', kind: 'table', sortBy: 'bid_due' }] },
      JOBS_TYPE,
      CLIENTS_TYPE,
      { key: 'price_list', name: 'Price list', singular: 'Item', icon: '🏷️', primary: 'item', fields: [
        { key: 'item', name: 'Item', type: 'text' },
        { key: 'description', name: 'Description', type: 'text' },
        { key: 'unit', name: 'Unit', type: 'select', choices: [choice('each', 'gray'), choice('sq ft', 'blue'), choice('window', 'violet'), choice('hour', 'amber'), choice('job', 'green')] },
        { key: 'price', name: 'Price', type: 'money' },
        { key: 'cost', name: 'Our cost', type: 'money' },
        { key: 'category', name: 'Category', type: 'select', choices: [] },
      ], views: [{ name: 'All items', kind: 'table' }] },
    ],
  },
  jobs: {
    name: 'Jobs & Installs', icon: '🛠️', about: 'Jobs from scheduled to paid, with crews, dates and photos',
    types: [JOBS_TYPE, CLIENTS_TYPE],
  },
  blank: {
    name: 'Blank', icon: '📁', about: 'One list to shape as you like',
    types: [{ key: 'items', name: 'Items', singular: 'Item', icon: '📄', primary: 'name', fields: [{ key: 'name', name: 'Name', type: 'text' }, { key: 'status', name: 'Status', type: 'select', choices: [choice('To do', 'gray'), choice('Doing', 'blue'), choice('Done', 'green')] }], views: [{ name: 'All', kind: 'table' }, { name: 'Board', kind: 'board', groupBy: 'status' }] }],
  },
};

export function projectsModule({ db, save, broadcast, rid, cleanText, isDay, readJson, send, badRequest, isOwnerId, escHtml, brandOf, logoUrl, makeTask, onRecords, allowLocalHooks = false }) {
  const bad = (msg) => badRequest(msg);
  db.projects ||= {};
  db.records ||= {};
  db.apiKeys ||= {};
  db.webhooks ||= {};
  db.projectTemplates ||= {};

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
  const publicRecord = ({ wsId, log, ...r }) => r;
  const typeOf = (p, typeId) => p.types.find((t) => t.id === typeId || t.key === typeId);
  const fieldOf = (t, id) => t.fields.find((f) => f.id === id || f.key === id);

  // ---------- a record's timeline ----------
  // What happened to a record, newest first: made, fields changed, quotes sent and answered, calls and emails
  // (logged here or from a campaign's list), tasks, notes. Kept on the record, the newest 300.
  const ACTS = ['call', 'email', 'meeting', 'note'];
  const OUTCOMES = ['No answer', 'Not interested', 'Interested', 'Booked'];
  function logTo(rec, entry) {
    const e = { id: rid(6), at: Date.now(), ...entry };
    // Quick edits to the same field by the same person are one change.
    const last = rec.log?.[0];
    if (e.kind === 'change' && last?.kind === 'change' && last.field === e.field && last.by === e.by && e.at - last.at < 120_000) {
      last.to = e.to;
      last.at = e.at;
      if (last.from === last.to) rec.log.shift();
    } else rec.log = [e, ...(rec.log || [])].slice(0, 300);
    broadcast(rec.wsId, { type: 'record:log', recordId: rec.id, projectId: rec.projectId, log: (rec.log || []).slice(0, 50) });
    return e;
  }
  // A value as words, for the timeline.
  function words(ws, p, f, v) {
    if (v == null || v === '') return '';
    if (f.type === 'money') return '$' + (v / 100).toLocaleString('en-US', { minimumFractionDigits: v % 100 ? 2 : 0 });
    if (f.type === 'select') return f.choices.find((c) => c.id === v)?.label || '';
    if (f.type === 'multi') return v.map((id) => f.choices.find((c) => c.id === id)?.label).filter(Boolean).join(', ');
    if (f.type === 'person') return ws.members.find((m) => m.id === v)?.name || '';
    if (f.type === 'checkbox') return v ? 'yes' : '';
    if (f.type === 'link') { const to = p.types.find((t) => t.id === f.target); return v.map((id) => db.records[id] && to ? String(db.records[id].values[to.primary] ?? '') : '').filter(Boolean).join(', '); }
    if (f.type === 'items') return '$' + (itemsTotals(v).total / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
    if (f.type === 'files') return `${v.length} file${v.length === 1 ? '' : 's'}`;
    return String(v).slice(0, 120);
  }
  // Fields that changed between two sets of values, each logged.
  function logChanges(ws, p, t, rec, before, by) {
    for (const f of t.fields) {
      if (f.type === 'autonumber') continue;
      const a = JSON.stringify(before[f.id] ?? null), b = JSON.stringify(rec.values[f.id] ?? null);
      if (a === b) continue;
      const from = words(ws, p, f, before[f.id]), to = words(ws, p, f, rec.values[f.id]);
      if (from !== to) logTo(rec, { kind: 'change', field: f.name, from, to, by });
    }
  }
  // Activity from elsewhere: a call logged from a campaign's list, a task made or done.
  function recordActivity(recordId, entry) {
    const rec = db.records[recordId];
    if (!rec) return null;
    const e = logTo(rec, entry);
    // A call, email or meeting is contact: the record's "Last contacted" day moves up.
    if (['call', 'email', 'meeting'].includes(entry.kind)) {
      const p = db.projects[rec.projectId];
      const t = p && typeOf(p, rec.typeId);
      const lc = t && fieldOf(t, 'last_contacted');
      if (lc?.type === 'date') {
        rec.values[lc.id] = new Date().toISOString().slice(0, 10);
        rec.updatedAt = Date.now();
        broadcast(rec.wsId, { type: 'record', record: publicRecord(rec), projectId: rec.projectId });
      }
    }
    save();
    return e;
  }
  const recName = (p, rec) => { const t = typeOf(p, rec.typeId); return String(rec.values[t?.primary] ?? '').trim() || t?.singular || 'Record'; };
  // A campaign's call list made from a project's records: a row each, kept current as records change.
  function fillFromProject(l) {
    const src = l.fromProject;
    const p = db.projects[src?.projectId];
    const t = p && typeOf(p, src.typeId);
    if (!t) return l;
    const shown = [fieldOf(t, t.primary), ...t.fields.filter((f) => f.id !== t.primary && ['phone', 'email', 'text', 'select', 'link'].includes(f.type) && !f.hidden)].slice(0, 7);
    const ws = db.workspaces[l.wsId];
    const was = new Map((l.rows || []).map((r) => [r.id, r]));
    l.columns = shown.map((f) => f.name);
    l.rows = Object.values(db.records).filter((r) => r.projectId === p.id && r.typeId === t.id && (!src.filter?.field || !src.filter.is?.length || src.filter.is.includes(String(r.values[src.filter.field] ?? ''))))
      .sort((a, b) => a.createdAt - b.createdAt).slice(0, 5000).map((r) => {
        const row = { id: r.id, recordId: r.id, cells: shown.map((f) => words(ws, p, f, r.values[f.id])) };
        const old = was.get(row.id);
        for (const k of ['stage', 'note', 'by', 'at']) if (old?.[k] !== undefined) row[k] = old[k];
        return row;
      });
    l.syncedAt = Date.now();
    return l;
  }
  const fromProjectOk = (ws, auth, v) => {
    const p = db.projects[v?.projectId];
    const t = p && p.wsId === ws.id && sees(p, auth.memberId) && typeOf(p, v.typeId);
    if (!t) return null;
    const f = v.filter?.field && fieldOf(t, v.filter.field);
    return { projectId: p.id, typeId: t.id, ...(f ? { filter: { field: f.id, is: (Array.isArray(v.filter.is) ? v.filter.is : []).slice(0, 50).map(String) } } : {}) };
  };
  // Lists made from a project refill a moment after its records change.
  const refill = new Map();
  function recordsChanged(projectId) {
    clearTimeout(refill.get(projectId));
    refill.set(projectId, setTimeout(() => { refill.delete(projectId); onRecords?.(projectId); }, 400));
  }

  // ---------- making projects from templates ----------
  // A list from its definition. Links find their list by key among `others`; one with nowhere to point is left out.
  function typeFrom(src, typeIdOf) {
    const t = { id: rid(8), key: src.key, name: src.name, singular: src.singular, icon: src.icon };
    t.fields = src.fields.filter((f) => f.type !== 'link' || typeIdOf(f.target)).map((f) => ({ id: rid(8), key: f.key, name: f.name, type: f.type, ...(f.choices ? { choices: f.choices.map((c) => ({ id: rid(6), label: c.label, color: c.color })) } : {}), ...(f.type === 'link' ? { target: typeIdOf(f.target), many: false } : {}), ...(f.type === 'autonumber' ? { prefix: f.prefix || '', next: f.start || 1, start: f.start || 1 } : {}) }));
    t.primary = t.fields.find((f) => f.key === src.primary)?.id || t.fields[0].id;
    // A new record starts at the first stage, so it never sits in "No status".
    for (const f of t.fields) if ((f.key === 'stage' || f.key === 'status') && f.choices?.length) f.default = f.choices[0].id;
    t.views = src.views.map((v) => ({ id: rid(8), name: v.name, kind: v.kind, ...(v.groupBy ? { groupBy: t.fields.find((f) => f.key === v.groupBy)?.id } : {}), sort: v.sortBy ? { field: t.fields.find((f) => f.key === v.sortBy)?.id, dir: 'asc' } : null }));
    return t;
  }
  function fromTemplate(key, wsId) {
    // A team's own template: its lists, fields and views, with new ids throughout.
    if (String(key).startsWith('custom:')) {
      const own = db.projectTemplates[String(key).slice(7)];
      if (own && own.wsId === wsId) return { types: cloneTypes(own.types), template: 'custom', icon: own.icon };
    }
    const tpl = TEMPLATES[key] || TEMPLATES.blank;
    const ids = Object.fromEntries(tpl.types.map((t) => [t.key, rid(8)]));
    const types = tpl.types.map((src) => {
      const t = typeFrom(src, (k) => ids[k]);
      t.id = ids[src.key];
      return t;
    });
    return { types, template: tpl === TEMPLATES[key] ? key : 'blank' };
  }
  // Lists copied with every id made new, and everything that points at an id following it.
  function cloneTypes(types) {
    const map = new Map();
    const fresh = (old, n = 8) => { if (!map.has(old)) map.set(old, rid(n)); return map.get(old); };
    const out = JSON.parse(JSON.stringify(types));
    for (const t of out) {
      t.id = fresh(t.id);
      for (const f of t.fields) {
        f.id = fresh(f.id);
        if (f.choices) for (const c of f.choices) c.id = fresh(c.id, 6);
        if (f.type === 'autonumber') f.next = f.start || 1;
      }
    }
    for (const t of out) {
      t.primary = map.get(t.primary) || t.fields[0].id;
      for (const f of t.fields) {
        if (f.target) f.target = map.get(f.target);
        if (f.default) f.default = map.get(f.default);
      }
      t.fields = t.fields.filter((f) => f.type !== 'link' || f.target);
      for (const v of t.views) {
        v.id = fresh(v.id);
        if (v.groupBy) v.groupBy = map.get(v.groupBy);
        if (v.sort?.field) v.sort.field = map.get(v.sort.field);
        if (v.filter?.field) v.filter = { field: map.get(v.filter.field), is: (v.filter.is || []).map((x) => map.get(x) || x) };
      }
    }
    return out;
  }

  // ---------- values ----------
  // What line items add up to, in cents: subtotal, discount, tax (on taxable lines, after the discount), total,
  // and when costs are given, our cost and the margin.
  function itemsTotals(v) {
    const rows = v?.rows || [];
    const line = (r) => Math.round((r.qty || 0) * (r.price || 0));
    const subtotal = rows.reduce((n, r) => n + line(r), 0);
    const discount = !v?.discount ? 0 : v.discount.type === 'percent' ? Math.round((subtotal * v.discount.value) / 100) : Math.min(subtotal, v.discount.value);
    const taxable = rows.filter((r) => r.taxable !== false).reduce((n, r) => n + line(r), 0);
    const share = subtotal ? (subtotal - discount) / subtotal : 0;
    const tax = Math.round(taxable * share * ((v?.taxRate || 0) / 100));
    const total = subtotal - discount + tax;
    const costed = rows.some((r) => r.cost != null);
    const cost = rows.reduce((n, r) => n + Math.round((r.qty || 0) * (r.cost || 0)), 0);
    return { subtotal, discount, tax, total, ...(costed ? { cost, margin: subtotal - discount - cost, marginPct: subtotal - discount ? Math.round(((subtotal - discount - cost) / (subtotal - discount)) * 1000) / 10 : 0 } : {}) };
  }
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
      // Line items: what's being quoted, with quantity, unit and price (and what it costs us, for margin).
      // Prices come in as dollars and are kept in cents. Tax is a percent; a discount is an amount or a percent.
      case 'items': {
        if (typeof v !== 'object') throw bad(`${f.name}: send line items as { rows: [...] }.`);
        const cents = (x) => (x === '' || x == null ? null : Math.round(Number(String(x).replace(/[$,\s]/g, '')) * 100));
        const rows = (Array.isArray(v.rows) ? v.rows : Array.isArray(v) ? v : []).slice(0, 200).map((r) => {
          const qty = Number(String(r?.qty ?? 1).replace(/[,\s]/g, ''));
          const price = cents(r?.price_cents != null ? r.price_cents / 100 : r?.price);
          const cost = cents(r?.cost_cents != null ? r.cost_cents / 100 : r?.cost);
          return {
            id: typeof r?.id === 'string' && /^[\w-]{1,24}$/.test(r.id) ? r.id : rid(6),
            desc: cleanText(r?.desc ?? r?.description, 500),
            qty: Number.isFinite(qty) ? Math.max(-1e6, Math.min(1e6, qty)) : 1,
            unit: cleanText(r?.unit, 20),
            price: Number.isFinite(price) ? Math.max(-1e10, Math.min(1e10, price)) : 0,
            ...(Number.isFinite(cost) ? { cost: Math.max(0, Math.min(1e10, cost)) } : {}),
            ...(r?.taxable === false ? { taxable: false } : {}),
            ...(typeof r?.from === 'string' && db.records[r.from]?.projectId === p.id ? { from: r.from } : {}),
          };
        }).filter((r) => r.desc || r.price);
        const tax = Number(v.taxRate ?? v.tax_rate ?? 0);
        const disc = v.discount && typeof v.discount === 'object' ? v.discount : null;
        const dv = Number(String(disc?.value ?? 0).replace(/[$,%\s]/g, ''));
        const out = { rows, taxRate: Number.isFinite(tax) ? Math.max(0, Math.min(100, tax)) : 0 };
        if (disc && Number.isFinite(dv) && dv > 0) out.discount = disc.type === 'percent' ? { type: 'percent', value: Math.min(100, dv) } : { type: 'amount', value: Math.round(dv * (disc.cents ? 1 : 100)) };
        return rows.length || out.discount || out.taxRate ? out : undefined;
      }
      // A file in Column: plans, specs, photos.
      case 'files': {
        const ids = [...new Set((Array.isArray(v) ? v : [v]).map(String))].filter((id) => db.items[id]?.wsId === ws.id && db.items[id].type === 'file');
        for (const id of ids) db.items[id].pinned = true;
        return ids.length ? ids.slice(0, 50) : undefined;
      }
      // Numbered by Column; what's sent in is ignored.
      case 'autonumber': return undefined;
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
      if (!f || f.type === 'autonumber') continue;
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
    recordsChanged(rec.projectId);
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
    recordsChanged(rec.projectId);
    save();
    broadcast(rec.wsId, { type: 'record:remove', id: rec.id, projectId: rec.projectId });
    hooksFire(rec, 'record.deleted', by);
  }
  const teamRecords = (wsId) => Object.values(db.records).filter((r) => r.wsId === wsId).length;
  function newRecord(ws, p, t, auth, values, extId, opts) {
    if (teamRecords(ws.id) >= MAX_RECORDS) throw bad(`A team can keep ${MAX_RECORDS.toLocaleString()} records. Delete some first.`);
    const rec = { id: rid(), wsId: ws.id, projectId: p.id, typeId: t.id, values: {}, extId: extId ? cleanText(extId, 200) : null, by: auth.member, memberId: auth.memberId, createdAt: Date.now(), updatedAt: Date.now() };
    for (const f of t.fields) if (f.type === 'autonumber') rec.values[f.id] = `${f.prefix || ''}${(f.next = (f.next || 1) + 1) - 1}`;
    for (const f of t.fields) if (f.default && f.choices?.some((c) => c.id === f.default)) rec.values[f.id] = f.default;
    if (t.fields.some((f) => f.type === 'autonumber')) projectNews(p);
    applyValues(ws, p, t, rec, values, opts);
    db.records[rec.id] = rec;
    rec.log = [{ id: rid(6), at: rec.createdAt, kind: 'created', by: auth.member }];
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
      // A ready-made list (Jobs, Contacts, Price list…), its links pointing at this project's lists by key.
      case 'addTypeFrom': {
        if (p.types.length >= MAX_TYPES) throw bad(`A project can have ${MAX_TYPES} kinds of records.`);
        const src = Object.values(TEMPLATES).flatMap((x) => x.types).find((x) => x.key === body.key);
        if (!src) throw bad('That list isn’t one of the ready-made ones.');
        if (p.types.some((x) => x.key === src.key)) throw bad(`This project already has ${src.name}.`);
        const nt = typeFrom(src, (k) => p.types.find((x) => x.key === k)?.id);
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
        if (type === 'autonumber') {
          f.prefix = cleanText(body.prefix, 10);
          f.next = Math.max(1, Math.round(Number(body.start) || 1));
          // Records already here get numbers, oldest first.
          for (const r of Object.values(db.records).filter((x) => x.projectId === p.id && x.typeId === t.id).sort((a, b) => a.createdAt - b.createdAt)) r.values[f.id] = `${f.prefix}${f.next++}`;
        }
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
        const { types, template, icon } = fromTemplate(body.template, ws.id);
        const own = template === 'custom' && db.projectTemplates[String(body.template).slice(7)];
        const p = { id: rid(), wsId: ws.id, name: cleanText(body.name, 80) || own?.name || TEMPLATES[template].name, icon: cleanText(body.icon, 8) || icon || TEMPLATES[template].icon, template, types, private: !!body.private, memberIds: [], memberId: auth.memberId, by: auth.member, createdAt: Date.now(), updatedAt: Date.now() };
        db.projects[p.id] = p;
        projectNews(p);
        return send(res, 200, publicProject(p));
      }
      const p = b && db.projects[b];
      if (!p || p.wsId !== ws.id || !sees(p, auth.memberId)) return send(res, 404, { error: 'That project is gone.' });
      if (m === 'GET' && c === 'records') return send(res, 200, Object.values(db.records).filter((r) => r.projectId === p.id).map(publicRecord));
      if (m === 'POST' && c === 'template') {
        const body = await readJson(req, 10_000);
        if (Object.values(db.projectTemplates).filter((x) => x.wsId === ws.id).length >= 50) return send(res, 400, { error: 'A team can keep 50 templates. Delete one first.' });
        const x = { id: rid(), wsId: ws.id, name: cleanText(body.name, 80) || p.name, about: cleanText(body.about, 200) || p.types.map((t) => t.name).join(', '), icon: p.icon, types: JSON.parse(JSON.stringify(p.types)), memberId: auth.memberId, by: auth.member, createdAt: Date.now() };
        db.projectTemplates[x.id] = x;
        save();
        return send(res, 200, { id: x.id, name: x.name });
      }
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
              const before = { ...rec.values };
              applyValues(ws, p, t, rec, row, { addChoices: true });
              logChanges(ws, p, t, rec, before, auth.member);
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
    // A team's own templates: a project's lists, fields and views, without its records.
    if (a === 'project-templates') {
      if (m === 'GET' && !b) return send(res, 200, Object.values(db.projectTemplates).filter((x) => x.wsId === ws.id).map(({ wsId, types, ...x }) => ({ ...x, lists: types.map((t) => t.name) })));
      const x = b && db.projectTemplates[b];
      if (!x || x.wsId !== ws.id) return send(res, 404, { error: 'That template is gone.' });
      if (m === 'DELETE') {
        if (x.memberId !== auth.memberId && auth.role !== 'owner') return send(res, 403, { error: 'Only whoever saved it and team owners can delete it.' });
        delete db.projectTemplates[x.id];
        save();
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'Method not allowed' });
    }
    if (a === 'records' && b) {
      const rec = db.records[b];
      const p = rec && db.projects[rec.projectId];
      if (!rec || rec.wsId !== ws.id || !sees(p, auth.memberId)) return send(res, 404, { error: 'That record is gone.' });
      const t = typeOf(p, rec.typeId);
      if (m === 'PATCH' && !c) {
        const body = await readJson(req, 200_000);
        const before = { ...rec.values };
        applyValues(ws, p, t, rec, body.values, { addChoices: false });
        logChanges(ws, p, t, rec, before, auth.member);
        if (body.docId !== undefined) rec.docId = db.items[body.docId]?.wsId === ws.id && db.items[body.docId].type === 'text' ? body.docId : null;
        rec.updatedAt = Date.now();
        recordNews(rec, 'record.updated', auth.member);
        return send(res, 200, publicRecord(rec));
      }
      if (m === 'DELETE' && !c) {
        recordGone(rec, auth.member);
        return send(res, 200, { ok: true });
      }
      if (c === 'log' && m === 'GET') return send(res, 200, rec.log || []);
      // Logging a call, email, meeting or note on the record; a follow-up date makes a task.
      if (c === 'log' && m === 'POST') {
        const body = await readJson(req, 20_000);
        const kind = ACTS.includes(body.kind) ? body.kind : 'note';
        const note = cleanText(body.note, 4000);
        const outcome = kind === 'call' && OUTCOMES.includes(body.outcome) ? body.outcome : null;
        if (!note && !outcome) return send(res, 400, { error: 'Write what happened.' });
        const e = recordActivity(rec.id, { kind, outcome, note, by: auth.member, memberId: auth.memberId });
        if (isDay(body.followUp) && makeTask) {
          const task = makeTask(ws, auth, { text: `Follow up with ${recName(p, rec)}${outcome ? ` (${outcome.toLowerCase()})` : ''}`, due: body.followUp, recordId: rec.id });
          if (task) e.taskId = task.id;
        }
        save();
        return send(res, 200, rec.log);
      }
      if (c === 'log' && m === 'DELETE' && d) {
        const e = (rec.log || []).find((x) => x.id === d);
        if (!e || !ACTS.includes(e.kind) || (e.memberId !== auth.memberId && auth.role !== 'owner')) return send(res, 403, { error: 'You can only remove calls and notes you logged.' });
        rec.log = rec.log.filter((x) => x !== e);
        save();
        broadcast(rec.wsId, { type: 'record:log', recordId: rec.id, projectId: rec.projectId, log: rec.log.slice(0, 50) });
        return send(res, 200, rec.log);
      }
      // Sending a quote: a link of its own for the customer. Making it marks a draft as sent.
      if (c === 'share' && t.fields.some((f) => f.type === 'items')) {
        if (m === 'POST') {
          const body = await readJson(req, 10_000);
          const hours = Number(body.hours) > 0 ? Math.min(Number(body.hours), 24 * 365) : null;
          rec.share = { token: rec.share?.token || crypto.randomBytes(18).toString('base64url'), createdAt: Date.now(), expiresAt: hours ? Date.now() + hours * 3600_000 : null, by: auth.member };
          const st = quoteStatus(t, rec);
          if (!st || st === 'draft') setStatus(p, t, rec, 'Sent');
          logTo(rec, { kind: 'quote', what: 'sent', by: auth.member });
          const issued = fieldOf(t, 'issued');
          if (issued?.type === 'date' && !rec.values[issued.id]) rec.values[issued.id] = today();
        } else if (m === 'DELETE') rec.share = null;
        else return send(res, 405, { error: 'Method not allowed' });
        rec.updatedAt = Date.now();
        recordNews(rec, 'record.updated', auth.member);
        return send(res, 200, publicRecord(rec));
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

  // ---------- quotes: the page a customer opens from the link, to accept or decline ----------
  // It works on any list with line items; it finds its other parts by key: status, issued, valid_until, terms,
  // client, accepted_by, accepted_on (the Bids & Quotes template has them all).
  const today = () => new Date().toISOString().slice(0, 10);
  const statusField = (t) => { const f = fieldOf(t, 'status'); return f?.type === 'select' ? f : null; };
  const quoteStatus = (t, rec) => { const f = statusField(t); return f ? (f.choices.find((c) => c.id === rec.values[f.id])?.label || '').toLowerCase() : ''; };
  function setStatus(p, t, rec, label) {
    const f = statusField(t);
    if (!f) return;
    rec.values[f.id] = choiceFor(f, label, true);
  }
  const quoteFor = (token) => {
    const rec = token && Object.values(db.records).find((r) => r.share?.token === token);
    if (!rec || (rec.share.expiresAt && rec.share.expiresAt < Date.now())) return null;
    const p = db.projects[rec.projectId];
    const t = p && typeOf(p, rec.typeId);
    return p && t && db.workspaces[rec.wsId] ? { rec, p, t, ws: db.workspaces[rec.wsId] } : null;
  };
  const money = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const day = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
  async function readForm(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 20_000) break;
    }
    return Object.fromEntries(new URLSearchParams(body));
  }
  async function quotePage(req, res, url) {
    const [, token, act] = url.pathname.split('/').filter(Boolean);
    const q = quoteFor(token);
    const head = { 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
    for (const [k, v] of Object.entries(head)) res.setHeader(k, v);
    if (!q) return quoteHtml(res, 404, null, '<h1>Quote not available</h1><p class="muted">This link has expired or was turned off. Contact whoever sent it.</p>');
    const { rec, p, t, ws } = q;
    const status = quoteStatus(t, rec);
    const valid = fieldOf(t, 'valid_until');
    const expired = valid && rec.values[valid.id] && rec.values[valid.id] < today() && !['accepted', 'declined'].includes(status);
    // An answer, once: accepted (with the name they typed) or declined (with why, if they say).
    if (req.method === 'POST' && (act === 'accept' || act === 'decline')) {
      const form = await readForm(req);
      const name = cleanText(form.name, 120);
      if (!['accepted', 'declined'].includes(status) && !expired && (act === 'decline' || name)) {
        setStatus(p, t, rec, act === 'accept' ? 'Accepted' : 'Declined');
        const by = fieldOf(t, 'accepted_by');
        const on = fieldOf(t, 'accepted_on');
        if (by?.type === 'text') rec.values[by.id] = act === 'accept' ? name : `Declined${name ? ' by ' + name : ''}${form.reason ? ': ' + cleanText(form.reason, 500) : ''}`;
        if (on?.type === 'date') rec.values[on.id] = today();
        rec.answer = { act, name, reason: cleanText(form.reason, 500), at: Date.now() };
        logTo(rec, { kind: 'quote', what: act === 'accept' ? 'accepted' : 'declined', by: name || 'The customer', note: rec.answer.reason || '' });
        rec.updatedAt = Date.now();
        const items = t.fields.find((f) => f.type === 'items');
        broadcast(rec.wsId, { type: 'quote:answer', projectId: p.id, recordId: rec.id, act, name: name || 'The customer', title: quoteTitle(t, rec), total: items ? itemsTotals(rec.values[items.id]).total : 0 });
        recordNews(rec, 'record.updated', name ? `${name} (customer)` : 'Customer');
      }
      res.writeHead(303, { Location: `/q/${token}` });
      return res.end();
    }
    if (act) return quoteHtml(res, 404, null, '<h1>Not found</h1>');
    // Opening it marks a sent quote viewed.
    if (status === 'sent') {
      setStatus(p, t, rec, 'Viewed');
      logTo(rec, { kind: 'quote', what: 'viewed', by: 'The customer' });
      rec.updatedAt = Date.now();
      recordNews(rec, 'record.updated', 'Customer');
    }
    return quoteHtml(res, 200, ws, quoteBody(q, token, expired));
  }
  const quoteTitle = (t, rec) => {
    const num = t.fields.find((f) => f.type === 'autonumber');
    return [num && rec.values[num.id], rec.values[t.primary]].filter(Boolean).join(' · ') || t.singular || 'Quote';
  };
  function quoteBody({ rec, p, t, ws }, token, expired) {
    const v = (key) => { const f = fieldOf(t, key); return f ? rec.values[f.id] : undefined; };
    const items = t.fields.find((f) => f.type === 'items');
    const data = items ? rec.values[items.id] || { rows: [] } : { rows: [] };
    const tot = itemsTotals(data);
    // The client, from the linked record.
    const cf = fieldOf(t, 'client');
    const client = cf?.type === 'link' && rec.values[cf.id]?.[0] && db.records[rec.values[cf.id][0]];
    const ct = client && typeOf(p, client.typeId);
    const cv = (key) => { const f = ct && fieldOf(ct, key); return f && client.values[f.id] != null ? String(client.values[f.id]) : ''; };
    const status = quoteStatus(t, rec);
    const brand = brandOf(ws);
    const lines = data.rows.map((r) => `<tr><td>${escHtml(r.desc)}</td><td class="n">${escHtml(String(r.qty))}${r.unit ? ' ' + escHtml(r.unit) : ''}</td><td class="n">${money(r.price)}</td><td class="n">${money(Math.round(r.qty * r.price))}</td></tr>`).join('');
    const answer = status === 'accepted' ? `<div class="done ok">✓ Accepted${v('accepted_by') ? ' by ' + escHtml(v('accepted_by')) : ''}${v('accepted_on') ? ' on ' + day(v('accepted_on')) : ''}. Thank you!</div>`
      : status === 'declined' ? '<div class="done">This quote was declined. Thanks for letting us know.</div>'
      : expired ? `<div class="done">This quote expired on ${day(v('valid_until'))}. Contact us for an updated one.</div>`
      : `<form class="accept" method="post" action="/q/${token}/accept"><label>Type your full name to accept this quote<input name="name" required maxlength="120" autocomplete="name"></label><button>Accept quote · ${money(tot.total)}</button></form>
         <details class="decline"><summary>Decline</summary><form method="post" action="/q/${token}/decline"><label>Your name<input name="name" maxlength="120" autocomplete="name"></label><label>Anything we should know? (optional)<textarea name="reason" rows="3" maxlength="500"></textarea></label><button class="ghost">Decline quote</button></form></details>`;
    return `<header>${brand.logo ? `<img class="brand" src="${logoUrl(brand.logo)}" alt="">` : ''}<div><b>${escHtml(ws.name)}</b></div></header>
      <h1>${escHtml(quoteTitle(t, rec))}</h1>
      <div class="meta">${v('issued') ? `<span>Issued ${day(v('issued'))}</span>` : ''}${v('valid_until') ? `<span>Valid until ${day(v('valid_until'))}</span>` : ''}</div>
      ${client ? `<div class="to"><small>Prepared for</small><b>${escHtml(cv('name') || cv(ct.fields.find((f) => f.id === ct.primary)?.key))}</b>${[cv('contact'), cv('address'), cv('email'), cv('phone')].filter(Boolean).map((x) => `<div>${escHtml(x)}</div>`).join('')}</div>` : ''}
      <table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${lines || '<tr><td colspan="4" class="muted">No items yet.</td></tr>'}</tbody></table>
      <div class="sums"><div><span>Subtotal</span><span>${money(tot.subtotal)}</span></div>${tot.discount ? `<div><span>Discount${data.discount?.type === 'percent' ? ` (${data.discount.value}%)` : ''}</span><span>−${money(tot.discount)}</span></div>` : ''}${data.taxRate ? `<div><span>Tax (${data.taxRate}%)</span><span>${money(tot.tax)}</span></div>` : ''}<div class="total"><span>Total</span><span>${money(tot.total)}</span></div></div>
      ${v('terms') ? `<div class="terms"><small>Terms</small><p>${escHtml(v('terms')).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${answer}`;
  }
  function quoteHtml(res, code, ws, body) {
    const accent = ws ? brandOf(ws).accent : null;
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'" });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quote</title><style>
:root{color-scheme:light;--text:#16161a;--muted:#6b6b76;--line:#e4e4ea;--accent:${accent || '#5b4ee0'};--soft:#f6f6f8}
*{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px 14px}
main{background:#fff;max-width:760px;margin:0 auto;border-radius:14px;padding:36px 40px;box-shadow:0 10px 40px rgba(0,0,0,.08)}@media(max-width:600px){main{padding:22px 16px}}
header{display:flex;align-items:center;gap:12px;margin-bottom:22px}.brand{max-height:46px;max-width:160px;border-radius:6px}
h1{font-size:26px;margin:0 0 6px}.meta{display:flex;gap:16px;color:var(--muted);font-size:13.5px;margin-bottom:20px;flex-wrap:wrap}
.to{background:var(--soft);border-radius:10px;padding:12px 14px;margin-bottom:20px;font-size:14px}.to small,.terms small{display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-size:11px;margin-bottom:2px}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;color:var(--muted);font-weight:600;font-size:12px;border-bottom:2px solid var(--line);padding:8px 6px}td{border-bottom:1px solid var(--line);padding:10px 6px;vertical-align:top}.n{text-align:right;white-space:nowrap}
.sums{margin:14px 0 0 auto;max-width:300px;font-size:14px}.sums div{display:flex;justify-content:space-between;padding:4px 6px}.sums .total{border-top:2px solid var(--text);margin-top:6px;padding-top:8px;font-size:18px;font-weight:700}
.terms{margin-top:26px;font-size:13.5px;color:#333}.terms p{margin:0}
.accept{margin-top:30px;padding:18px;border:2px solid var(--accent);border-radius:12px;display:flex;flex-direction:column;gap:10px}
label{display:flex;flex-direction:column;gap:6px;font-size:13.5px;color:var(--muted)}input,textarea{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;color:var(--text)}
button{font:inherit;font-weight:700;background:var(--accent);color:#fff;border:0;border-radius:10px;padding:12px 18px;cursor:pointer}button.ghost{background:none;color:var(--text);border:1px solid var(--line);font-weight:500}
.decline{margin-top:12px;color:var(--muted);font-size:13.5px}.decline form{display:flex;flex-direction:column;gap:10px;margin-top:10px}.decline summary{cursor:pointer}
.done{margin-top:28px;padding:16px;border-radius:12px;background:var(--soft);font-weight:600}.done.ok{background:#e7f8ef;color:#126b3d}.muted{color:var(--muted)}
footer{text-align:center;color:var(--muted);font-size:12px;margin-top:16px}
</style></head><body><main>${body}</main><footer>Sent with Column</footer></body></html>`);
  }
  // Quotes still waiting past their valid-until day become Expired.
  function expireQuotes() {
    const now = today();
    for (const rec of Object.values(db.records)) {
      const p = db.projects[rec.projectId];
      const t = p && typeOf(p, rec.typeId);
      const valid = t && fieldOf(t, 'valid_until');
      if (!valid || !rec.values[valid.id] || rec.values[valid.id] >= now || !['sent', 'viewed'].includes(quoteStatus(t, rec))) continue;
      setStatus(p, t, rec, 'Expired');
      rec.updatedAt = Date.now();
      recordNews(rec, 'record.updated', 'Column');
    }
  }
  setInterval(expireQuotes, 3600_000).unref?.();
  setTimeout(expireQuotes, 5_000).unref?.();

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
    if (f.type === 'items') {
      const t2 = itemsTotals(v);
      const d = (c) => c / 100;
      return { rows: v.rows.map((r) => ({ id: r.id, description: r.desc, qty: r.qty, unit: r.unit, price: d(r.price), ...(r.cost != null ? { cost: d(r.cost) } : {}), total: d(Math.round(r.qty * r.price)), ...(r.taxable === false ? { taxable: false } : {}) })),
        tax_rate: v.taxRate, ...(v.discount ? { discount: v.discount.type === 'percent' ? { percent: v.discount.value } : { amount: d(v.discount.value) } } : {}),
        subtotal: d(t2.subtotal), discount_total: d(t2.discount), tax: d(t2.tax), total: d(t2.total), ...(t2.cost != null ? { cost: d(t2.cost), margin: d(t2.margin), margin_percent: t2.marginPct } : {}) };
    }
    return v;
  }
  function outRecord(ws, p, t, r) {
    return { id: r.id, external_id: r.extId || null, type: t.key, created_at: new Date(r.createdAt).toISOString(), updated_at: new Date(r.updatedAt).toISOString(),
      fields: Object.fromEntries(t.fields.map((f) => [f.key, outValue(ws, f, r.values[f.id])])) };
  }
  const outSchema = (p) => ({ id: p.id, name: p.name, template: p.template, types: p.types.map((t) => ({ key: t.key, name: t.name, singular: t.singular,
    fields: t.fields.map((f) => ({ key: f.key, name: f.name, type: f.type, ...(f.type === 'autonumber' ? { read_only: true } : {}), ...(f.choices ? { options: f.choices.map((c) => c.label) } : {}), ...(f.type === 'link' ? { links_to: p.types.find((x) => x.id === f.target)?.key, many: !!f.many } : {}), ...(f.id === t.primary ? { primary: true } : {}) })) })) });
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
    const sub2 = rid_ && rid_ !== 'external' ? extra_ : null;
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
          const before = { ...rec.values };
          applyValues(ws, p, t, rec, fields, { addChoices: true });
          logChanges(ws, p, t, rec, before, auth.member);
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
    if (sub2 === 'timeline') {
      if (m === 'GET') return send(res, 200, { timeline: (rec.log || []).map(({ memberId, ...e }) => ({ ...e, at: new Date(e.at).toISOString() })) });
      if (m === 'POST') {
        write();
        const body = await readJson(req, 20_000);
        const kind = ACTS.includes(body.kind) ? body.kind : 'note';
        const note = cleanText(body.note, 4000);
        const outcome = kind === 'call' && OUTCOMES.includes(body.outcome) ? body.outcome : null;
        if (!note && !outcome) return send(res, 400, { error: 'Send a note, or an outcome for a call.' });
        const e = recordActivity(rec.id, { kind, outcome, note, by: auth.member });
        return send(res, 201, { ...e, at: new Date(e.at).toISOString() });
      }
      return send(res, 405, { error: 'Use GET or POST.' });
    }
    if (m === 'GET') return send(res, 200, outRecord(ws, p, t, rec));
    if (m === 'PATCH') {
      write();
      const body = await readJson(req, 200_000);
      const before = { ...rec.values };
      applyValues(ws, p, t, rec, inFields(t, body.fields), { addChoices: true });
      logChanges(ws, p, t, rec, before, auth.member);
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

  // A record told in words, for the AI: its fields, what links to it, its timeline and open tasks.
  function recordStory(rec, ws) {
    const p = db.projects[rec.projectId];
    const t = p && typeOf(p, rec.typeId);
    if (!t) return '';
    const lines = [`A ${t.singular || t.name} in the project “${p.name}”: ${recName(p, rec)}.`];
    for (const f of t.fields) {
      if (f.id === t.primary || rec.values[f.id] == null) continue;
      if (f.type === 'items') {
        const v = rec.values[f.id];
        const tt = itemsTotals(v);
        lines.push(`${f.name}: ${v.rows.map((r) => `${r.qty} ${r.unit || ''} ${r.desc} at $${(r.price / 100).toFixed(2)}`).join('; ')}. Total $${(tt.total / 100).toFixed(2)}${tt.cost != null ? `, margin ${tt.marginPct}%` : ''}.`);
      } else lines.push(`${f.name}: ${words(ws, p, f, rec.values[f.id])}`);
    }
    for (const o of p.types) for (const f of o.fields) if (f.type === 'link' && f.target === t.id) {
      const from = Object.values(db.records).filter((x) => x.typeId === o.id && (x.values[f.id] || []).includes(rec.id));
      if (from.length) lines.push(`${o.name} linked to it: ${from.slice(0, 10).map((x) => `${recName(p, x)} (${o.fields.filter((y) => ['select', 'money', 'date', 'items'].includes(y.type) && x.values[y.id] != null).map((y) => `${y.name.toLowerCase()} ${words(ws, p, y, x.values[y.id])}`).join(', ')})`).join('; ')}`);
    }
    const log = (rec.log || []).slice(0, 30).map((e) => `- ${new Date(e.at).toISOString().slice(0, 10)} ${e.by || ''}: ${e.kind}${e.outcome ? ' (' + e.outcome + ')' : ''}${e.what ? ' ' + e.what : ''}${e.field ? ` ${e.field} ${e.from || 'empty'} → ${e.to || 'empty'}` : ''}${e.note ? ': ' + e.note.slice(0, 300) : ''}${e.campaign ? ` [campaign ${e.campaign}]` : ''}`);
    if (log.length) lines.push(`Timeline, newest first:\n${log.join('\n')}`);
    const tasks = Object.values(db.tasks).filter((x) => x.recordId === rec.id && !x.done);
    if (tasks.length) lines.push(`Open tasks: ${tasks.map((x) => x.text + (x.due ? ` (due ${x.due})` : '')).join('; ')}`);
    return lines.join('\n');
  }
  // The price list a quote or bid can draw from: a list keyed price_list in the same project.
  function priceList(p) {
    const t = p.types.find((x) => x.key === 'price_list');
    if (!t) return [];
    const f = (k) => fieldOf(t, k);
    return Object.values(db.records).filter((r) => r.projectId === p.id && r.typeId === t.id).slice(0, 300).map((r) => ({ id: r.id, item: String(r.values[t.primary] ?? ''), description: f('description') ? String(r.values[f('description').id] ?? '') : '', unit: f('unit') ? words(db.workspaces[r.wsId], p, f('unit'), r.values[f('unit').id]) : '', price: f('price') ? r.values[f('price').id] ?? null : null, cost: f('cost') ? r.values[f('cost').id] ?? null : null }));
  }
  const recordAt = (id, wsId, memberId) => {
    const rec = db.records[id];
    const p = rec && db.projects[rec.projectId];
    return rec && rec.wsId === wsId && sees(p, memberId) ? { rec, p, t: typeOf(p, rec.typeId) } : null;
  };

  return { route, v1, quotePage, seesMsg, stateFor, sees, recordActivity, fillFromProject, fromProjectOk, recordStory, priceList, recordAt, itemsTotals, TEMPLATES: Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, { name: t.name, icon: t.icon, about: t.about }])) };
}
