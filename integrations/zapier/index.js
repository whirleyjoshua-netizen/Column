// Kloomie for Zapier. Built on Kloomie's public API (/api/v1, see https://app.kloomie.com/developers):
// - Sign-in is a Kloomie API key, made in Kloomie → Settings → Connections → Connect other apps.
// - Triggers are instant: each Zap subscribes its own webhook with the key (REST hooks), and every delivery's
//   X-Kloomie-Signature is checked against that webhook's secret before the Zap runs.
// - Actions and searches call the same API. Repeats are safe: contacts can match an existing person, and a payment's
//   reference is only counted once.
const crypto = require('crypto');

const base = (bundle) => `${String((bundle.authData && bundle.authData.server) || 'https://app.kloomie.com').trim().replace(/\/+$/, '')}/api/v1`;
const dataOf = (res) => (res.data !== undefined ? res.data : res.json);

// ---------- sign-in ----------
const authentication = {
  type: 'custom',
  fields: [
    { key: 'api_key', label: 'API key', type: 'password', required: true, helpText: 'In Kloomie, go to **Settings → Connections → Connect other apps** and click **New API key** ([how](https://app.kloomie.com/developers#auth)). An owner or admin makes it, and it’s shown once. Choose **Read and write** so actions work.' },
    { key: 'server', label: 'Kloomie address', type: 'string', required: false, default: 'https://app.kloomie.com', helpText: 'Leave this as it is unless your team runs Kloomie at its own address ([more](https://app.kloomie.com/developers#auth)). It must start with https://.' },
  ],
  test: async (z, bundle) => {
    const server = String(bundle.authData.server || '').trim();
    if (server && !/^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?\/?$/i.test(server)) throw new z.errors.Error('The Kloomie address should look like https://app.kloomie.com, with nothing after it.', 'InvalidData', 400);
    return dataOf(await z.request({ url: `${base(bundle)}/me` }));
  },
  connectionLabel: '{{bundle.inputData.team}} ({{bundle.inputData.key}})',
};

const addKey = (request, z, bundle) => {
  if (bundle.authData && bundle.authData.api_key) request.headers.Authorization = `Bearer ${bundle.authData.api_key}`;
  request.headers.Accept = 'application/json';
  return request;
};
// Kloomie's errors are plain sentences ({"error": "…"}): pass them on as they are.
const handleErrors = (response, z) => {
  if (response.status < 400) return response;
  const body = dataOf(response) || {};
  const msg = (body && body.error) || `Kloomie answered ${response.status}.`;
  if (response.status === 401) throw new z.errors.Error(`${msg} Check the API key in this connection, or make a new one in Kloomie.`, 'AuthenticationError', 401);
  if (response.status === 429) throw new z.errors.ThrottledError(msg, 60);
  throw new z.errors.Error(msg, 'KloomieError', response.status);
};

// ---------- triggers ----------
// A webhook delivery is only trusted when it's signed with the secret Kloomie gave this Zap's subscription.
function signedByKloomie(bundle) {
  const raw = bundle.rawRequest;
  const secret = bundle.subscribeData && bundle.subscribeData.secret;
  if (!raw || !secret) return true; // Zapier's editor and tests run perform without a delivery
  const headers = raw.headers || {};
  const key = Object.keys(headers).find((k) => /kloomie-signature$/i.test(k));
  const header = key && String(headers[key]);
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const want = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw.content || ''}`).digest('hex');
  return want.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(parts.v1));
}
// What a Zap gets: the thing itself, plus when and who. The id is the event's, so two changes to the same contact
// are two runs, not one.
const fromEvent = (e) => ({ ...e.data, id: e.id, kloomie_id: e.data && e.data.id, event: e.type, happened_at: e.created_at, by: e.by });
const asSample = (x, type) => ({ ...x, id: x.id, kloomie_id: x.id, event: type, happened_at: x.updated_at || x.created_at, by: x.created_by || x.booked_by || null });

function hookTrigger({ key, noun, label, description, event, list, sample }) {
  return {
    key,
    noun,
    display: { label, description },
    operation: {
      type: 'hook',
      performSubscribe: async (z, bundle) => dataOf(await z.request({ url: `${base(bundle)}/webhooks`, method: 'POST', body: { url: bundle.targetUrl, events: [event] } })),
      performUnsubscribe: async (z, bundle) => dataOf(await z.request({ url: `${base(bundle)}/webhooks/${encodeURIComponent(bundle.subscribeData.id)}`, method: 'DELETE' })),
      perform: async (z, bundle) => {
        const e = bundle.cleanedRequest;
        if (!e || e.type !== event || !e.data) return [];
        if (!signedByKloomie(bundle)) throw new z.errors.Error('This delivery wasn’t signed by Kloomie, so it was ignored.', 'BadSignature', 401);
        return [fromEvent(e)];
      },
      performList: async (z, bundle) => {
        const items = list ? await list(z, bundle) : [];
        return (items.length ? items : [sample]).map((x) => (x === sample ? x : asSample(x, event)));
      },
      sample,
    },
  };
}
const get = async (z, bundle, path, params) => {
  const d = dataOf(await z.request({ url: `${base(bundle)}${path}`, params }));
  return Array.isArray(d) ? d : (d && d.data) || [];
};

const sampleContact = { id: 'evt_sample', kloomie_id: 'c9AbCdEfGh', event: 'contact.created', happened_at: '2026-11-10T17:04:11.000Z', by: 'Jo', external_id: null, name: 'Dana Ruiz', company: 'Ruiz Home', email: 'dana@example.com', phone: '555-010-0100', address: '10 A St', city: 'Austin', source: 'Website', stage: 'New', note: '', tags: ['lead'], do_not_contact: false, assigned_to: null, synced_from: null, created_at: '2026-11-10T17:04:11.000Z', updated_at: '2026-11-10T17:04:11.000Z' };
const sampleTask = { id: 'evt_sample', kloomie_id: 't4AbCdEfGh', event: 'task.created', happened_at: '2026-11-10T17:04:11.000Z', by: 'Jo', text: 'Call Dana back', due: '2026-12-01', done: false, done_at: null, done_by: null, assignee: { id: 'm2AbCdEf', name: 'Sam' }, job_id: null, campaign: null, priority: 0, created_by: 'Jo', created_at: '2026-11-10T17:04:11.000Z', updated_at: '2026-11-10T17:04:11.000Z' };
const sampleVisit = { id: 'evt_sample', kloomie_id: 'v3AbCdEfGh', event: 'visit.scheduled', happened_at: '2026-11-10T17:04:11.000Z', by: 'Jo', job_id: 'r8AbCdEfGh', job: 'AC tune-up · Dana Ruiz', kind: 'Service', date: '2026-12-02', start: '09:30', end: '11:00', all_day: false, flexible: false, done: false, note: '', crew: [{ id: 'm2AbCdEf', name: 'Sam' }], customer: { contact_id: 'c9AbCdEfGh', name: 'Dana Ruiz', email: 'dana@example.com', phone: '555-010-0100', address: '10 A St' }, booked_by: 'Jo' };
const sampleInvoice = { id: 'evt_sample', kloomie_id: 'i1AbCdEfGh', event: 'invoice.paid', happened_at: '2026-11-10T17:04:11.000Z', by: 'Jo', number: 'INV-1001', job_id: 'r8AbCdEfGh', title: 'AC tune-up · Dana Ruiz', status: 'paid', overdue: false, issued: '2026-11-10', due: '2026-11-24', customer: { contact_id: 'c9AbCdEfGh', name: 'Dana Ruiz', email: 'dana@example.com', phone: '555-010-0100', address: '10 A St' }, lines: [{ description: 'Tune-up', qty: 1, unit: '', price: 300, total: 300 }], tax_rate: 0, subtotal: 300, discount: 0, tax: 0, total: 300, paid: 300, balance: 0, payments: [{ id: 'p1AbCd', amount: 300, method: 'card', note: 'Paid online', date: '2026-11-12', by: 'Dana Ruiz (customer)' }], note: '', url: 'https://app.kloomie.com/i/abc', created_at: '2026-11-10T17:04:11.000Z', updated_at: '2026-11-12T10:00:00.000Z', sent_at: '2026-11-10T17:05:00.000Z', paid_at: '2026-11-12T10:00:00.000Z' };
const samplePayment = { id: 'evt_sample', event: 'payment.received', happened_at: '2026-11-12T10:00:00.000Z', by: 'Dana Ruiz (customer)', invoice_id: 'i1AbCdEfGh', invoice_number: 'INV-1001', job_id: 'r8AbCdEfGh', payment: { id: 'p1AbCd', amount: 300, method: 'card', note: 'Paid online', date: '2026-11-12', by: 'Dana Ruiz (customer)' }, invoice: { ...sampleInvoice, id: 'i1AbCdEfGh' } };
const sampleFile = { id: 'evt_sample', event: 'file.received', happened_at: '2026-11-10T17:04:11.000Z', by: 'Dana', file: { id: 'f1AbCdEf', name: 'photos.zip', size: 120345, type: 'application/zip' }, from: 'Dana', stack: { id: 's1AbCd', name: 'Ruiz job' }, request_id: 'rq1AbCd' };
const sampleText = { id: 'evt_sample', event: 'text.received', happened_at: '2026-11-10T17:04:11.000Z', by: 'Text message', from: '+17025550142', body: 'Running 10 minutes late, sorry!', contact_id: 'c9AbCdEfGh', contact_name: 'Dana Ruiz', received_at: '2026-11-10T17:04:11.000Z' };
const sampleSigned = { id: 'evt_sample', event: 'document.signed', happened_at: '2026-11-10T17:04:11.000Z', by: 'Dana Ruiz', document: 'Install agreement.pdf', signer: { name: 'Dana Ruiz', email: 'dana@example.com' }, signed_name: 'Dana Ruiz', signed_at: '2026-11-10T17:04:11.000Z', file: { id: 'f2AbCdEf', name: 'Install agreement (signed).pdf' } };

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const triggers = [
  hookTrigger({ key: 'new_contact', noun: 'Contact', label: 'New Contact', description: 'Triggers when a contact is added in Kloomie (typed in, imported, through the API, or synced in).', event: 'contact.created', sample: sampleContact, list: (z, b) => get(z, b, '/contacts', { order: 'newest', limit: 10 }) }),
  hookTrigger({ key: 'updated_contact', noun: 'Contact', label: 'Updated Contact', description: 'Triggers when a contact’s details or stage change.', event: 'contact.updated', sample: { ...sampleContact, event: 'contact.updated' }, list: (z, b) => get(z, b, '/contacts', { order: 'newest', limit: 10 }) }),
  hookTrigger({ key: 'new_task', noun: 'Task', label: 'New Task', description: 'Triggers when a task is added.', event: 'task.created', sample: sampleTask, list: (z, b) => get(z, b, '/tasks', { order: 'newest', limit: 10 }) }),
  hookTrigger({ key: 'task_done', noun: 'Task', label: 'Task Completed', description: 'Triggers when a task is ticked off.', event: 'task.done', sample: { ...sampleTask, event: 'task.done', done: true, done_at: '2026-11-11T09:00:00.000Z', done_by: 'Sam' }, list: (z, b) => get(z, b, '/tasks', { order: 'newest', done: 'true', limit: 10 }) }),
  hookTrigger({ key: 'visit_scheduled', noun: 'Visit', label: 'Visit Booked', description: 'Triggers when a visit to a job is booked.', event: 'visit.scheduled', sample: sampleVisit, list: async (z, b) => (await get(z, b, '/visits', { from: today() })).slice(0, 10) }),
  hookTrigger({ key: 'visit_changed', noun: 'Visit', label: 'Visit Moved or Changed', description: 'Triggers when a visit’s day, time, crew or details change.', event: 'visit.changed', sample: { ...sampleVisit, event: 'visit.changed' }, list: async (z, b) => (await get(z, b, '/visits', { from: today() })).slice(0, 10) }),
  hookTrigger({ key: 'visit_done', noun: 'Visit', label: 'Visit Done', description: 'Triggers when a visit is marked done.', event: 'visit.done', sample: { ...sampleVisit, event: 'visit.done', done: true }, list: async (z, b) => (await get(z, b, '/visits', { from: daysAgo(60), to: today() })).filter((v) => v.done).slice(-10).reverse() }),
  hookTrigger({ key: 'visit_cancelled', noun: 'Visit', label: 'Visit Called Off', description: 'Triggers when a visit is called off.', event: 'visit.cancelled', sample: { ...sampleVisit, event: 'visit.cancelled' } }),
  hookTrigger({ key: 'invoice_sent', noun: 'Invoice', label: 'Invoice Sent', description: 'Triggers when an invoice is first sent to a customer.', event: 'invoice.sent', sample: { ...sampleInvoice, event: 'invoice.sent', status: 'sent', paid: 0, balance: 300, payments: [], paid_at: null }, list: async (z, b) => (await get(z, b, '/invoices', { order: 'newest', limit: 25 })).filter((x) => x.status !== 'draft').slice(0, 10) }),
  hookTrigger({ key: 'invoice_paid', noun: 'Invoice', label: 'Invoice Paid', description: 'Triggers when an invoice is paid in full.', event: 'invoice.paid', sample: sampleInvoice, list: (z, b) => get(z, b, '/invoices', { order: 'newest', status: 'paid', limit: 10 }) }),
  hookTrigger({ key: 'payment_received', noun: 'Payment', label: 'Payment Received', description: 'Triggers on every payment on an invoice: card, cash, check, or one recorded in your books.', event: 'payment.received', sample: samplePayment, list: async (z, b) => (await get(z, b, '/invoices', { order: 'newest', limit: 25 })).flatMap((inv) => inv.payments.map((p) => ({ id: p.id, invoice_id: inv.id, invoice_number: inv.number, job_id: inv.job_id, payment: p, invoice: inv, created_at: p.date }))).slice(0, 10) }),
  hookTrigger({ key: 'file_received', noun: 'File', label: 'Files Received', description: 'Triggers when a customer sends files through a Kloomie file request link.', event: 'file.received', sample: sampleFile }),
  hookTrigger({ key: 'text_received', noun: 'Text', label: 'New Text Message', description: 'Triggers when a customer texts your team’s Twilio number in Kloomie.', event: 'text.received', sample: sampleText }),
  hookTrigger({ key: 'document_signed', noun: 'Document', label: 'Document Signed', description: 'Triggers when someone signs a document you sent for signature.', event: 'document.signed', sample: sampleSigned }),
  // For dropdowns: recent contacts, open tasks, unpaid invoices, jobs.
  {
    key: 'contact_list', noun: 'Contact', display: { label: 'Recent Contacts', description: 'Lists recent contacts, for choosing one.', hidden: true },
    operation: { perform: async (z, b) => (await get(z, b, '/contacts', { order: 'newest', limit: 100 })).map((c) => ({ id: c.id, name: [c.name || c.company, c.email || c.phone].filter(Boolean).join(' · ') })), sample: { id: 'c9AbCdEfGh', name: 'Dana Ruiz · dana@example.com' } },
  },
  {
    key: 'open_tasks', noun: 'Task', display: { label: 'Open Tasks', description: 'Lists tasks not done yet, for choosing one.', hidden: true },
    operation: { perform: async (z, b) => (await get(z, b, '/tasks', { order: 'newest', done: 'false', limit: 100 })).filter((t) => !t.campaign).map((t) => ({ id: t.id, name: `${t.text}${t.assignee ? ' · ' + t.assignee.name : ''}${t.due ? ' · due ' + t.due : ''}` })), sample: { id: 't4AbCdEfGh', name: 'Call Dana back · Sam · due 2026-12-01' } },
  },
  {
    key: 'unpaid_invoices', noun: 'Invoice', display: { label: 'Unpaid Invoices', description: 'Lists sent invoices with money still owed, for choosing one.', hidden: true },
    operation: { perform: async (z, b) => (await get(z, b, '/invoices', { order: 'newest', limit: 100 })).filter((x) => ['sent', 'viewed', 'partial'].includes(x.status)).map((x) => ({ id: x.id, name: `${x.number} · ${x.customer.name || x.title} · $${x.balance} owed` })), sample: { id: 'i1AbCdEfGh', name: 'INV-1001 · Dana Ruiz · $300 owed' } },
  },
  {
    key: 'jobs', noun: 'Job', display: { label: 'Jobs', description: 'Lists jobs from the team’s Jobs lists, for choosing one.', hidden: true },
    operation: {
      perform: async (z, b) => {
        const d = dataOf(await z.request({ url: `${base(b)}/projects` }));
        const out = [];
        for (const p of (d && d.projects) || []) {
          for (const t of p.types.filter((x) => x.key.startsWith('trade_') || /job/i.test(x.name))) {
            const r = dataOf(await z.request({ url: `${base(b)}/projects/${p.id}/${t.key}/records`, params: { limit: 500 } }));
            const name = t.fields.find((f) => f.primary);
            for (const rec of (r && r.records) || []) out.push({ id: rec.id, name: `${(name && rec.fields[name.key]) || t.singular || 'Job'}${p.name ? ' · ' + p.name : ''}`, updated: rec.updated_at });
          }
        }
        return out.sort((x, y) => (x.updated < y.updated ? 1 : -1)).slice(0, 200).map(({ id, name }) => ({ id, name }));
      },
      sample: { id: 'r8AbCdEfGh', name: 'AC tune-up · Jobs' },
    },
  },
  // For dropdowns: the team's people.
  {
    key: 'members', noun: 'Person', display: { label: 'Team Members', description: 'Lists the people on the team, for choosing who a task or visit is for.', hidden: true },
    operation: { perform: async (z, bundle) => get(z, bundle, '/members'), sample: { id: 'm2AbCdEf', name: 'Sam', role: 'member' } },
  },
];

// ---------- actions ----------
const contactFields = [
  { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' }, { key: 'city', label: 'City' }, { key: 'source', label: 'Source', helpText: 'Where they came from, like Website or Angi.' },
  { key: 'stage', label: 'Stage' }, { key: 'note', label: 'Note', type: 'text' }, { key: 'tags', label: 'Tags', list: true },
  { key: 'external_id', label: 'Your ID for them', helpText: 'Their id in the other app. Running the Zap again with the same id updates them instead of adding a copy.' },
];
const pick = (input, keys) => Object.fromEntries(keys.filter((k) => input[k] !== undefined && input[k] !== null && input[k] !== '').map((k) => [k, input[k]]));
const send = async (z, bundle, method, path, body) => dataOf(await z.request({ url: `${base(bundle)}${path}`, method, body }));

const creates = [
  {
    key: 'create_contact', noun: 'Contact',
    display: { label: 'Create or Update Contact', description: 'Adds a contact. Someone already in Kloomie with the same email or phone gets their empty details filled in instead.' },
    operation: {
      inputFields: [...contactFields, { key: 'do_not_contact', label: 'Do not contact', type: 'boolean' }, { key: 'match_existing', label: 'Match someone already there', type: 'boolean', default: 'true', helpText: 'Yes: a person with the same email or phone is updated instead of added twice.' }],
      perform: async (z, b) => {
        const i = b.inputData;
        const body = { ...pick(i, contactFields.map((f) => f.key)), match_existing: i.match_existing !== false && i.match_existing !== 'false', ...(i.do_not_contact !== undefined ? { do_not_contact: i.do_not_contact === true || i.do_not_contact === 'true' } : {}) };
        if (!body.name && !body.email && !body.phone && !body.company) throw new z.errors.Error('Give the contact a name, company, email or phone.', 'InvalidData', 400);
        return send(z, b, 'POST', '/contacts', body);
      },
      sample: { ...sampleContact, id: 'c9AbCdEfGh', matched: false },
    },
  },
  {
    key: 'update_contact', noun: 'Contact',
    display: { label: 'Update Contact', description: 'Changes a contact’s details. Find the contact first with Find Contact.' },
    operation: {
      inputFields: [{ key: 'contact_id', label: 'Contact', required: true, dynamic: 'contact_list.id.name', search: 'find_contact.id', helpText: 'Pick a recent contact, or use Find Contact.' }, ...contactFields.filter((f) => f.key !== 'external_id'), { key: 'do_not_contact', label: 'Do not contact', type: 'boolean' }],
      perform: async (z, b) => {
        const i = b.inputData;
        const body = { ...pick(i, contactFields.map((f) => f.key)), ...(i.do_not_contact !== undefined && i.do_not_contact !== '' ? { do_not_contact: i.do_not_contact === true || i.do_not_contact === 'true' } : {}) };
        return send(z, b, 'PATCH', `/contacts/${encodeURIComponent(i.contact_id)}`, body);
      },
      sample: { ...sampleContact, id: 'c9AbCdEfGh' },
    },
  },
  {
    key: 'create_task', noun: 'Task',
    display: { label: 'Create Task', description: 'Adds a task, for someone on the team if you choose.' },
    operation: {
      inputFields: [
        { key: 'text', label: 'Task', required: true },
        { key: 'due', label: 'Due', type: 'datetime' },
        { key: 'assignee_id', label: 'For', dynamic: 'members.id.name' },
        { key: 'job_id', label: 'Job', dynamic: 'jobs.id.name', helpText: 'Put the task on a job (optional).' },
        { key: 'priority', label: 'Priority', choices: { 0: 'Normal', 1: 'Low', 2: 'Medium', 3: 'High' } },
      ],
      perform: async (z, b) => {
        const i = b.inputData;
        return send(z, b, 'POST', '/tasks', { text: i.text, ...(i.due ? { due: String(i.due).slice(0, 10) } : {}), ...(i.assignee_id ? { assignee_id: i.assignee_id } : {}), ...(i.job_id ? { job_id: i.job_id } : {}), ...(i.priority !== undefined && i.priority !== '' ? { priority: Number(i.priority) } : {}) });
      },
      sample: { ...sampleTask, id: 't4AbCdEfGh' },
    },
  },
  {
    key: 'complete_task', noun: 'Task',
    display: { label: 'Complete Task', description: 'Ticks off a task (not a campaign step, which is worked in Kloomie).' },
    operation: {
      inputFields: [{ key: 'task_id', label: 'Task', required: true, dynamic: 'open_tasks.id.name' }],
      perform: async (z, b) => send(z, b, 'PATCH', `/tasks/${encodeURIComponent(b.inputData.task_id)}`, { done: true }),
      sample: { ...sampleTask, id: 't4AbCdEfGh', done: true, done_by: 'Zapier (API)' },
    },
  },
  {
    key: 'book_visit', noun: 'Visit',
    display: { label: 'Book Visit', description: 'Books a visit to a job, for one person or a crew. Good for booking tools like Calendly.' },
    operation: {
      inputFields: [
        { key: 'job_id', label: 'Job', required: true, dynamic: 'jobs.id.name' },
        { key: 'date', label: 'Day', type: 'datetime', required: true },
        { key: 'start', label: 'Starts at', helpText: 'A time like 09:30 or 2:15pm. Leave empty for any time that day.' },
        { key: 'end', label: 'Ends at', helpText: 'A time like 11:00.' },
        { key: 'kind', label: 'Kind', choices: ['Estimate', 'Measure', 'Install', 'Service', 'Repair', 'Maintenance', 'Inspection', 'Follow-up', 'Delivery', 'Cleaning', 'Visit'], default: 'Visit' },
        { key: 'crew_ids', label: 'Who’s going', dynamic: 'members.id.name', list: true, required: true },
        { key: 'note', label: 'Note', type: 'text' },
        { key: 'flexible', label: 'Any time that day is fine', type: 'boolean' },
      ],
      perform: async (z, b) => {
        const i = b.inputData;
        return send(z, b, 'POST', '/visits', { job_id: i.job_id, date: String(i.date).slice(0, 10), ...(i.start ? { start: i.start } : {}), ...(i.end ? { end: i.end } : {}), kind: i.kind || 'Visit', crew_ids: [].concat(i.crew_ids || []), ...(i.note ? { note: i.note } : {}), ...(i.flexible !== undefined ? { flexible: i.flexible === true || i.flexible === 'true' } : {}) });
      },
      sample: { ...sampleVisit, id: 'v3AbCdEfGh' },
    },
  },
  {
    key: 'record_payment', noun: 'Payment',
    display: { label: 'Record Payment', description: 'Records a payment taken somewhere else (your books, a bank transfer, cash) on a sent invoice.' },
    operation: {
      inputFields: [
        { key: 'invoice_id', label: 'Invoice', required: true, dynamic: 'unpaid_invoices.id.name', search: 'find_invoice.id', helpText: 'Pick an unpaid invoice, or use Find Invoice.' },
        { key: 'amount', label: 'Amount (dollars)', type: 'number', required: true },
        { key: 'method', label: 'How', choices: { cash: 'Cash', check: 'Check', card: 'Card', bank: 'Bank transfer', other: 'Other' }, default: 'other' },
        { key: 'date', label: 'Day', type: 'datetime' },
        { key: 'note', label: 'Note' },
        { key: 'reference', label: 'Reference', helpText: 'The payment’s id in the other app. The same reference is only counted once, so a Zap that runs twice can’t pay twice.' },
      ],
      perform: async (z, b) => {
        const i = b.inputData;
        return send(z, b, 'POST', `/invoices/${encodeURIComponent(i.invoice_id)}/payments`, { amount: i.amount, method: i.method || 'other', ...(i.date ? { date: String(i.date).slice(0, 10) } : {}), ...(i.note ? { note: i.note } : {}), ...(i.reference ? { reference: String(i.reference) } : {}) });
      },
      sample: { ...sampleInvoice, id: 'i1AbCdEfGh' },
    },
  },
];

// ---------- searches ----------
const searches = [
  {
    key: 'find_contact', noun: 'Contact',
    display: { label: 'Find Contact', description: 'Finds a contact by email or phone.' },
    operation: {
      inputFields: [{ key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }],
      perform: async (z, b) => {
        const { email, phone } = b.inputData;
        if (!email && !phone) throw new z.errors.Error('Give an email or a phone number to look for.', 'InvalidData', 400);
        return get(z, b, '/contacts', { ...(email ? { email } : { phone }), limit: 5 });
      },
      sample: { ...sampleContact, id: 'c9AbCdEfGh' },
    },
  },
  {
    key: 'find_invoice', noun: 'Invoice',
    display: { label: 'Find Invoice', description: 'Finds an invoice by its number, like INV-1001.' },
    operation: {
      inputFields: [{ key: 'number', label: 'Invoice number', required: true }],
      perform: async (z, b) => get(z, b, '/invoices', { number: b.inputData.number }),
      sample: { ...sampleInvoice, id: 'i1AbCdEfGh' },
    },
  },
];

const byKey = (list) => Object.fromEntries(list.map((x) => [x.key, x]));
module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  beforeRequest: [addKey],
  afterResponse: [handleErrors],
  triggers: byKey(triggers),
  creates: byKey(creates),
  searches: byKey(searches),
  searchOrCreates: {
    find_contact: { key: 'find_contact', display: { label: 'Find or Create Contact', description: 'Finds a contact by email or phone, or adds them.' }, search: 'find_contact', create: 'create_contact' },
  },
};
