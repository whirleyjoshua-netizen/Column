// Flows (docs/flows): what can set an automation off, from every tool, in one list. The server checks automations
// against it and the app draws the editor from it (GET /api/automations/catalog), so there's one source of truth.
// Each event says which tool it's from, what it's called, the words it fills in ({contact}, {amount}…) and the
// filters an automation can narrow it with. index.js fires them (automate) from the one place each thing happens.

export const TOOLS = { tasks: 'Tasks', contacts: 'Contacts', campaigns: 'Campaigns', projects: 'Projects', money: 'Invoices & Finance', files: 'Files & signatures', texts: 'Texts', docs: 'Docs', map: 'Map', time: 'Time' };

// filters: campaign (in a campaign), stage (a contact's stage), outcome (a call's), statuses (a check-in's),
// project (and list), to (a record's stage it moved to), over (an amount at least this, in dollars), date (a
// record's date field, and how many days before or after it).
export const EVENTS = [
  { type: 'task.created', tool: 'tasks', label: 'A task is made', words: ['task', 'campaign', 'who'], filters: ['campaign'] },
  { type: 'task.done', tool: 'tasks', label: 'A task or step is done', words: ['task', 'campaign', 'who'], filters: ['campaign'] },
  { type: 'contact.created', tool: 'contacts', label: 'A contact is added (by hand, a lead form, a card, a text…)', words: ['contact', 'stage', 'who'], filters: ['stage'] },
  { type: 'contact.stage', tool: 'contacts', label: 'A contact’s stage changes', words: ['contact', 'stage', 'who'], filters: ['stage'] },
  { type: 'attempt.logged', tool: 'campaigns', label: 'A call or email is logged', words: ['contact', 'outcome', 'note', 'campaign', 'who'], filters: ['campaign', 'outcome'] },
  { type: 'campaign.done', tool: 'campaigns', label: 'A campaign is marked finished', words: ['campaign', 'who'], filters: ['campaign'] },
  { type: 'campaign.checkin', tool: 'campaigns', label: 'Someone checks in on a campaign', words: ['campaign', 'note', 'who'], filters: ['campaign', 'statuses'] },
  { type: 'record.created', tool: 'projects', label: 'A job or record is added', words: ['record', 'project', 'list', 'who'], filters: ['project'] },
  { type: 'record.stage', tool: 'projects', label: 'A job or record moves to a stage', words: ['record', 'project', 'list', 'stage', 'from', 'who'], filters: ['project', 'to'] },
  { type: 'record.date', tool: 'projects', label: 'A date on a job or record comes up (days before, on or after it)', words: ['record', 'project', 'list', 'stage', 'date'], filters: ['project', 'date'] },
  { type: 'record.deleted', tool: 'projects', label: 'A job or record is deleted', words: ['record', 'project', 'list', 'who'], filters: ['project'] },
  { type: 'quote.accepted', tool: 'projects', label: 'A customer accepts a quote', words: ['record', 'project', 'customer', 'amount'], filters: ['project'] },
  { type: 'quote.declined', tool: 'projects', label: 'A customer declines a quote', words: ['record', 'project', 'customer'], filters: ['project'] },
  { type: 'visit.scheduled', tool: 'projects', label: 'A visit is scheduled', words: ['record', 'date', 'time', 'crew', 'who'], filters: [] },
  { type: 'visit.done', tool: 'projects', label: 'A visit is done', words: ['record', 'date', 'crew', 'who'], filters: [] },
  { type: 'visit.cancelled', tool: 'projects', label: 'A visit is cancelled', words: ['record', 'date', 'who'], filters: [] },
  { type: 'invoice.sent', tool: 'money', label: 'An invoice is sent', words: ['invoice', 'customer', 'amount', 'who'], filters: ['over'] },
  { type: 'invoice.paid', tool: 'money', label: 'An invoice is paid in full', words: ['invoice', 'customer', 'amount'], filters: ['over'] },
  { type: 'payment.received', tool: 'money', label: 'A payment comes in', words: ['invoice', 'customer', 'amount'], filters: ['over'] },
  { type: 'money.added', tool: 'money', label: 'Money in or out is added to the business’s Finance', words: ['amount', 'category', 'note', 'who'], filters: ['over', 'direction'] },
  { type: 'file.received', tool: 'files', label: 'Files come in on a request link', words: ['file', 'from', 'campaign'], filters: ['campaign'] },
  { type: 'document.signed', tool: 'files', label: 'A document is signed', words: ['document', 'from', 'campaign', 'who'], filters: ['campaign'] },
  { type: 'text.received', tool: 'texts', label: 'A text comes in', words: ['contact', 'phone', 'text'], filters: [] },
  { type: 'doc.created', tool: 'docs', label: 'A doc is made', words: ['doc', 'who'], filters: [] },
  { type: 'pin.dropped', tool: 'map', label: 'A pin is dropped on the Map (a door knocked, a flyer left)', words: ['pin', 'note', 'campaign', 'who'], filters: ['campaign'] },
  { type: 'schedule', tool: 'time', label: 'On a schedule', words: ['date'], filters: [] },
];
export const EVENT = Object.fromEntries(EVENTS.map((e) => [e.type, e]));
// The names automations used before Flows (kept so old ones keep working: they're renamed once at start).
export const LEGACY = { 'file.arrived': 'file.received', 'sign.signed': 'document.signed', 'contact.added': 'contact.created' };
export const catalog = () => ({ tools: TOOLS, events: EVENTS });
