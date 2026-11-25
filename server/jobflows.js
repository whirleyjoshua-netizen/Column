// Job Flows (the owner, 2026-11-24; docs/jobflows/CONTRACTS.md): a team names the way a kind of job goes (a flow,
// steps from a fixed menu) and every job runs on one. A flow is a draft its owners and admins edit and publish as
// versions that never change. A job's run is a campaign of kind 'job' whose steps are goals of kind 'step'; the
// one sweep that moves every job (jobSteps in index.js) finishes them, and each step is finished only by what it
// stands for really being true on the job (a client, its fields, a visit, the checklist, the signature, an invoice
// sent or paid, its tasks, a Done button). A run is never a campaign to anyone: it lives behind the job.
import crypto from 'node:crypto';

export const STEP_KINDS = ['client', 'details', 'book', 'remind', 'omw', 'work', 'signoff', 'quote', 'invoice', 'payment', 'review', 'tasks', 'custom'];
// Steps Kloomie does by itself (PHASE3.md §1): who they're for doesn't matter.
const AUTO_KINDS = ['remind', 'review'];
// Money steps: for owners and admins whatever a flow says (docs/jobflows/PHASE2.md §1.2, §4).
const MONEY_KINDS = ['quote', 'invoice', 'payment'];
const BILLING = ['hand', 'quote', 'auto'];
const MAX_DEFAULT_ITEMS = 50, MAX_ITEMS = 2000;
// What a customer sees and pays on a set of price lines, and nothing else: each row's description, quantity, unit,
// price and whether it's taxed, in order, plus the tax rate and discount. Row ids, cost and where a row came from
// are left out, so a job's lines and an invoice made from them (new row ids, no cost) compare equal
// (docs/jobflows/PHASE2.md §1.3).
export function priceKey(lines) {
  const rows = (Array.isArray(lines?.rows) ? lines.rows : []).map((r) => [String(r?.desc ?? ''), Number(r?.qty) || 0, String(r?.unit ?? ''), Number(r?.price) || 0, r?.taxable === false ? 0 : 1]);
  const d = lines?.discount ? [lines.discount.type === 'percent' ? 'percent' : 'amount', Number(lines.discount.value) || 0] : null;
  return crypto.createHash('sha256').update(JSON.stringify([rows, Number(lines?.taxRate) || 0, d])).digest('hex').slice(0, 32);
}
const KIND_NAME = { remind: 'Visit reminder', omw: 'On my way', review: 'Review request', client: 'Add client info', details: 'Add job info', book: 'Book a visit', work: 'Do the work', signoff: 'Customer signs off', quote: 'Send the quote', invoice: 'Send the invoice', payment: 'Collect payment', tasks: 'Tasks', custom: 'Step' };
const HOW = { remind: 'auto', omw: 'tap', review: 'auto', client: 'tap', details: 'tap', book: 'tap', work: 'tap', signoff: 'tap', quote: 'tap', invoice: 'hand', payment: 'auto', tasks: 'tap', custom: 'hand' };
const ACTION = { remind: 'auto', omw: 'on-my-way', review: 'auto', client: 'pick-client', details: 'edit-fields', book: 'book-visit', work: 'checklist', signoff: 'sign', quote: 'quote', invoice: 'invoice', payment: 'payment', tasks: 'tasks', custom: 'done' };
const WHO = ['anyone', 'admins', 'role', 'member'];
const SENT = ['sent', 'viewed', 'partial', 'paid'];
const WAITING = { held: 'approval', zero: 'zero', owner: 'owner', refused: 'refused' };
const MAX_FLOWS = 50, MAX_STEPS = 30, KEY_MS = 10 * 60 * 1000;

export const isJobRun = (c) => c?.kind === 'job';
export const isJobList = (t) => !!t && (t.key === 'jobs' || String(t.key || '').startsWith('trade_'));

export function jobFlowsModule(ctx) {
  const { db, save, broadcast, rid, cleanText, readJson, send, isAdmin, PJ, toolsOf, goalsInOrder, tasksInOrder, applyTask, publicTask, canSeeTask, stepsSoon, sweepNow = (wsId) => stepsSoon(wsId), visitsOf, needsMet, noteWork = () => {}, invoiceTotals = () => ({ balance: 0, total: 0 }), invoiceUrl = () => null, flowTell = null, flowReach = () => 'No way to reach them', flowMsg = {}, customerOf = () => null, teamClock = () => ({}), teamReviewUrl = () => '', saveNow = async () => {}, sendable = () => true, shareRecord = null, quoteUrlOf = () => null, sendGate = null, custPreview = null, custDigest = null, notifyAdmins = () => {}, notify = () => {}, makeInvoice = null, sendInvoice = null, itemsTotals = () => ({ total: 0 }), priceChanged = () => {}, publicUrl = '' } = ctx;
  // Test only: a step with this name makes building a run throw, so the failure path can be tested from outside.
  const FAIL_STEP = process.env.NODE_ENV !== 'production' ? process.env.JOBFLOWS_FAIL_STEP || '' : '';
  // Test only: the automatic invoice's send fails after the invoice is made (a crash between the two).
  const FAIL_SEND = process.env.NODE_ENV !== 'production' && process.env.JOBFLOWS_FAIL_SEND === '1';
  // Test only: a shorter day (follow-ups, review delays); the process dies right after a customer message is handed
  // over (before it's marked sent); a route that removes a job's runs from the data.
  const TESTING = process.env.NODE_ENV !== 'production';
  const DAY_MS = (TESTING && Number(process.env.JOBFLOWS_DAY_MS)) || 864e5;
  const CRASH_AFTER_SEND = TESTING && process.env.JOBFLOWS_CRASH_AFTER_SEND === '1';
  const TEST_DROP = TESTING && process.env.JOBFLOWS_TEST_DROP_RUN === '1';
  db.jobFlows ||= {};
  db.jobItems ||= {};
  db.jobFlowVersions ||= {};
  const SEND_KINDS = ['remind', 'review', 'quote', 'invoice', 'payment'];
  const keys = new Map(); // `${wsId}:${memberId}:${key}` → { sig, recordId, at }

  const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const memberOf = (ws, id) => ws.members.find((m) => m.id === id);
  const fieldBy = (t, pred) => t?.fields.find(pred) || null;
  const filled = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

  // ---------- definitions ----------
  function listOf(ws, auth, list) {
    const p = list && db.projects[list.projectId];
    const t = p && p.types.find((x) => x.id === list.typeId);
    if (!p || p.wsId !== ws.id || !PJ.sees(p, auth.memberId) || !isJobList(t)) throw bad('Pick a job list for this flow.');
    return { p, t };
  }
  function stageLabels(t) {
    const f = fieldBy(t, (x) => x.type === 'select' && ['status', 'stage'].includes(x.key)) || fieldBy(t, (x) => x.type === 'select');
    return f ? f.choices.map((c) => c.label) : [];
  }
  // A flow's steps, cleaned. Ids stay as they were for steps the flow already had (versions keep their step ids);
  // `fresh` gives every step a new id (a copy).
  function cleanSteps(ws, t, steps, known, fresh = false) {
    if (!Array.isArray(steps) || !steps.length) throw bad('Give the flow at least one step.');
    if (steps.length > MAX_STEPS) throw bad(`A flow can have ${MAX_STEPS} steps.`);
    const stages = stageLabels(t);
    const seen = new Set();
    return steps.map((s) => {
      if (!s || !STEP_KINDS.includes(s.kind)) throw bad(`“${cleanText(s?.kind, 30) || 'That'}” isn’t a step you can add yet.`);
      let id = !fresh && typeof s.id === 'string' && known.has(s.id) && !seen.has(s.id) ? s.id : rid(8);
      seen.add(id);
      const name = cleanText(s.name, 80).trim() || KIND_NAME[s.kind];
      // A money step that names nobody is for owners and admins; one that names anyone else is refused at publish.
      const w = s.who && typeof s.who === 'object' ? s.who : { type: MONEY_KINDS.includes(s.kind) ? 'admins' : 'anyone' };
      if (!WHO.includes(w.type)) throw bad('Pick who does each step.');
      const who = { type: w.type };
      if (w.type === 'role') {
        if (!(ws.roles || []).some((r) => r.id === w.id)) throw bad(`The role for “${name}” isn’t one of your team’s roles.`);
        who.id = w.id;
      }
      if (w.type === 'member') {
        if (!memberOf(ws, w.id)) throw bad(`The person for “${name}” isn’t on your team.`);
        who.id = w.id;
      }
      let stage = null;
      if (s.stage) {
        stage = stages.find((l) => l.toLowerCase() === String(s.stage).trim().toLowerCase()) || null;
        if (!stage) throw bad(`“${cleanText(s.stage, 40)}” isn’t a stage on this job list.`);
      }
      const st = s.settings && typeof s.settings === 'object' ? s.settings : {};
      const settings = {};
      if (s.kind === 'details' && Array.isArray(st.fields)) settings.fields = st.fields.map(String).filter((k) => t.fields.some((f) => f.key === k)).slice(0, 20);
      if (s.kind === 'book' && st.visitKind) settings.visitKind = cleanText(st.visitKind, 40);
      if (s.kind === 'work' && st.photos) settings.photos = true;
      if (s.kind === 'tasks') {
        settings.tasks = (Array.isArray(st.tasks) ? st.tasks : []).map((x) => cleanText(x, 200).trim()).filter(Boolean).slice(0, 20);
        if (!settings.tasks.length) throw bad(`Give “${name}” at least one task.`);
      }
      // Phase 3 settings are kept as given on a draft and checked at publish (checkPublish).
      const raw = (k) => (st[k] === undefined ? undefined : typeof st[k] === 'string' ? cleanText(st[k], 300) : Array.isArray(st[k]) ? st[k].slice(0, 10).map(Number) : st[k]);
      if (s.kind === 'remind' || s.kind === 'omw') { if (st.visitKind) settings.visitKind = cleanText(st.visitKind, 40); }
      if (s.kind === 'review') { if (st.delayHours !== undefined) settings.delayHours = Number(st.delayHours); if (st.url) settings.url = raw('url'); }
      if (s.kind === 'quote') { if (st.email !== undefined) settings.email = st.email !== false; if (st.followUpDays !== undefined) settings.followUpDays = Number(st.followUpDays); }
      if (s.kind === 'invoice' && st.email !== undefined) settings.email = st.email !== false;
      if (s.kind === 'payment' && st.reminders !== undefined) settings.reminders = Array.isArray(st.reminders) ? st.reminders.slice(0, 10).map(Number) : [];
      // PHASE3B.md §2: each message an automatic step sends is 'auto' or 'ask'; left out (every version before) = ask.
      if (SEND_KINDS.includes(s.kind) && st.send !== undefined) settings.send = typeof st.send === 'string' ? st.send.slice(0, 10) : 'bad';
      if (s.kind === 'custom') {
        settings.text = cleanText(st.text, 2000);
        settings.checklist = (Array.isArray(st.checklist) ? st.checklist : []).map((x) => cleanText(x, 120).trim()).filter(Boolean).slice(0, 20);
      }
      return { id, kind: s.kind, name, who, how: HOW[s.kind], canSkip: s.canSkip === true, stage, settings };
    });
  }
  const knownIds = (flow) => new Set([...(flow?.draft?.steps || []), ...Object.values(db.jobFlowVersions).filter((v) => v.flowId === flow?.id).flatMap((v) => v.body.steps)].map((s) => s.id));
  function cleanBody(ws, auth, input, flow) {
    const prev = flow?.draft || {};
    const list = input.list !== undefined ? input.list : prev.list;
    const { t } = listOf(ws, auth, list);
    const pick = (k, dflt) => (input[k] !== undefined ? input[k] : prev[k] !== undefined ? prev[k] : dflt);
    // Billing, default items and due days are kept as given on a draft (within size limits) and checked at publish.
    const billing = cleanText(String(pick('billing', 'hand') ?? 'hand'), 20) || 'hand';
    const items = (Array.isArray(pick('items', [])) ? pick('items', []) : []).slice(0, MAX_DEFAULT_ITEMS + 50).map((x) => ({ itemId: cleanText(String(x?.itemId ?? ''), 40), qty: Number(x?.qty) }));
    const dd = pick('dueDays', null);
    const body = {
      list: { projectId: list.projectId, typeId: list.typeId },
      whoCreates: pick('whoCreates', 'admins') === 'everyone' ? 'everyone' : 'admins',
      billing, items, dueDays: dd === null || dd === '' ? null : Number(dd),
      steps: cleanSteps(ws, t, input.steps !== undefined ? input.steps : prev.steps, knownIds(flow)),
    };
    // With automatic billing the (one) Invoice step runs by itself.
    for (const st of body.steps) if (st.kind === 'invoice') st.how = billing === 'auto' ? 'auto' : HOW.invoice;
    return body;
  }
  const billingOf = (body) => body?.billing || 'hand';
  // The checks a draft must pass to be published (PHASE2.md §1.2).
  function checkPublish(ws, body) {
    const b = body.billing;
    if (!BILLING.includes(b)) throw bad('Pick how jobs on this flow are billed: by hand, quote first, or automatically.');
    const kinds = body.steps.map((x) => x.kind);
    const quotes = kinds.filter((k) => k === 'quote').length, invoices = kinds.filter((k) => k === 'invoice').length;
    if (b === 'quote') {
      if (quotes !== 1) throw bad('A quote-first flow has one Send the quote step.');
      if (!invoices) throw bad('A quote-first flow needs an invoice step after the quote.');
      if (kinds.indexOf('quote') > kinds.indexOf('invoice')) throw bad('The quote comes before the invoice.');
    } else if (quotes) throw bad('Only a quote-first flow has a quote step. Change its billing to Quote first.');
    if (b === 'auto' && invoices !== 1) throw bad('An automatic-billing flow has exactly one invoice step.');
    for (const st of body.steps) if (MONEY_KINDS.includes(st.kind) && st.who?.type !== 'admins') throw bad(`“${st.name}” is for owners and admins: money steps can’t go to anyone else.`);
    if (body.items.length > MAX_DEFAULT_ITEMS) throw bad(`A flow can have ${MAX_DEFAULT_ITEMS} default items.`);
    const seen = new Set();
    for (const x of body.items) {
      const it = db.jobItems[x.itemId];
      if (!it || it.wsId !== ws.id) throw bad('One of the default items isn’t on your Items list.');
      if (it.archived) throw bad(`“${it.name}” was archived. Take it off the default items or restore it.`);
      if (seen.has(x.itemId)) throw bad(`“${it.name}” is in the default items twice. Change its quantity instead.`);
      seen.add(x.itemId);
      if (!(Number.isFinite(x.qty) && x.qty > 0 && x.qty <= 1e6)) throw bad(`Give “${it.name}” a quantity above 0.`);
    }
    if (body.dueDays !== null && !(Number.isInteger(body.dueDays) && body.dueDays >= 0 && body.dueDays <= 120)) throw bad('Invoices are due 0 to 120 days after they’re made.');
    for (const st of body.steps) {
      const x = st.settings || {};
      if (x.send !== undefined && !['auto', 'ask'].includes(x.send)) throw bad(`“${st.name}”: send by itself, or ask first.`);
      if (st.kind === 'review') {
        if (x.delayHours !== undefined && !(Number.isInteger(x.delayHours) && x.delayHours >= 0 && x.delayHours <= 168)) throw bad(`“${st.name}” waits 0 to 168 hours.`);
        if (x.url !== undefined && !/^https:\/\/[^\s]+$/i.test(String(x.url))) throw bad(`“${st.name}”: the review link must start with https://`);
      }
      if (st.kind === 'quote' && x.followUpDays !== undefined && !(Number.isInteger(x.followUpDays) && x.followUpDays >= 0 && x.followUpDays <= 30)) throw bad(`“${st.name}” follows up after 0 to 30 days.`);
      if (st.kind === 'payment' && x.reminders !== undefined) {
        const r = x.reminders;
        if (r.length > 3 || !r.every((d, i) => Number.isInteger(d) && d >= 1 && d <= 60 && (i === 0 || d > r[i - 1]))) throw bad(`“${st.name}”: up to 3 reminders, each 1 to 60 days past due, in order.`);
      }
    }
  }
  const versionsOf = (flow) => Object.values(db.jobFlowVersions).filter((v) => v.flowId === flow.id).sort((a, b) => a.n - b.n);
  const activeVersion = (flow) => (flow?.activeVersionId ? db.jobFlowVersions[flow.activeVersionId] : null);
  const publicVersion = (v) => v && { id: v.id, n: v.n, body: v.body, publishedAt: v.publishedAt, publishedBy: v.publishedBy };
  const publicFlow = (flow, admin) => ({ id: flow.id, name: flow.name, icon: flow.icon, archived: !!flow.archived, activeVersionId: flow.activeVersionId, version: publicVersion(activeVersion(flow)), ...(admin ? { draft: flow.draft, createdAt: flow.createdAt, updatedAt: flow.updatedAt } : {}) });
  // Who's named on a step now: a person who left or a role that's gone leaves it to owners and admins.
  function whoNow(ws, step) {
    const w = step.who || { type: 'anyone' };
    if (w.type === 'member') { const m = memberOf(ws, w.id); return m ? { type: 'member', id: m.id, name: m.name } : { type: 'member', id: w.id, fallback: 'admins' }; }
    if (w.type === 'role') { const r = (ws.roles || []).find((x) => x.id === w.id); return r ? { type: 'role', id: r.id, name: r.name } : { type: 'role', id: w.id, fallback: 'admins' }; }
    return { type: w.type };
  }
  function mayAct(ws, auth, step) {
    if (isAdmin(auth)) return true;
    const w = whoNow(ws, step);
    if (w.fallback || w.type === 'admins') return false;
    if (w.type === 'member') return w.id === auth.memberId;
    if (w.type === 'role') return (memberOf(ws, auth.memberId)?.roleIds || []).includes(w.id);
    return true; // anyone who may edit the job: the route has already checked the job, its project and the members switch
  }

  // ---------- runs ----------
  const runsOf = (recordId) => Object.values(db.campaigns).filter((c) => isJobRun(c) && c.recordId === recordId).sort((a, b) => a.createdAt - b.createdAt);
  const activeRun = (recordId) => runsOf(recordId).find((c) => c.status === 'active') || null;
  // The run a job shows: the one going, else the last one that wasn't cancelled, else the last.
  const shownRun = (recordId) => { const all = runsOf(recordId); return all.find((c) => c.status === 'active') || all.filter((c) => c.status !== 'cancelled').at(-1) || all.at(-1) || null; };
  const stepGoals = (c) => goalsInOrder(c).filter((g) => g.kind === 'step');
  const recOf = (c) => { const r = c && db.records[c.recordId]; return r && r.wsId === c.wsId ? r : null; };
  const typeOfRec = (rec) => { const p = db.projects[rec.projectId]; return p && p.types.find((x) => x.id === rec.typeId); };
  const runInvoices = (c, rec) => Object.values(db.invoices || {}).filter((i) => i.recordId === rec.id && i.status !== 'void' && (i.createdAt || 0) >= c.createdAt);
  const itemsField = (t) => fieldBy(t, (f) => f.type === 'items');
  const versionOf = (c) => db.jobFlowVersions[c?.versionId] || null;
  // The invoices a run's payment step is about: its invoice step's bound one, else every non-void invoice of the run.
  function payInvoices(c, rec) {
    const ig = stepGoals(c).find((x) => x.step?.kind === 'invoice' && x.invoiceId && db.invoices?.[x.invoiceId]?.status !== 'void');
    return ig ? [db.invoices[ig.invoiceId]] : runInvoices(c, rec).sort((a, b) => a.createdAt - b.createdAt);
  }
  // The quote on a run's job, as the Quote step reads it: the accepted quote is the price (PHASE2.md §1.3).
  function quoteNow(c, rec) {
    const t = typeOfRec(rec);
    const lines = itemsField(t) ? rec.values[itemsField(t).id] : null;
    const a = rec.answer;
    const fresh = a && (a.at || 0) >= c.createdAt;
    let status = rec.share ? (rec.share.viewedAt ? 'viewed' : 'sent') : 'draft';
    let met = false;
    if (a && !fresh) status = 'stale';
    else if (a?.act === 'decline') status = 'declined';
    else if (a?.act === 'accept') {
      const k = priceKey(a.lines);
      met = priceKey(lines) === k || runInvoices(c, rec).some((i) => (i.createdAt || 0) >= a.at && priceKey(i.lines) === k);
      status = met ? 'accepted' : 'changed';
    }
    return { status, met, lines, answer: fresh ? a : null };
  }

  // What a step stands for, true or not, from the job as it is now. Changes nothing.
  function stepCondition(g, rec) {
    const c = db.campaigns[g.campaignId];
    const t = typeOfRec(rec);
    if (!c || !t) return false;
    const v = (f) => (f ? rec.values[f.id] : undefined);
    const s = g.step || {};
    switch (s.kind) {
      case 'client': {
        const id = v(fieldBy(t, (f) => f.type === 'contact'));
        return !!id && db.contacts?.[id]?.wsId === rec.wsId;
      }
      case 'details': {
        const keys = s.settings?.fields || [];
        if (!keys.length) return !!g.marked;
        return keys.every((k) => filled(v(fieldBy(t, (f) => f.key === k))));
      }
      case 'book': {
        const kind = (s.settings?.visitKind || '').toLowerCase();
        return visitsOf(rec.id).some((x) => !kind || String(x.kind || '').toLowerCase() === kind);
      }
      case 'work': {
        const cl = v(fieldBy(t, (f) => f.type === 'checklist'));
        const items = cl?.items || [];
        const ticked = fieldBy(t, (f) => f.type === 'checklist') ? items.length > 0 && items.every((i) => i.done) : !!g.marked;
        const photos = !s.settings?.photos || filled(v(fieldBy(t, (f) => f.key === 'after') || fieldBy(t, (f) => f.type === 'files')));
        return ticked && photos;
      }
      case 'signoff': {
        const sig = v(fieldBy(t, (f) => f.type === 'signature'));
        return !!(sig && sig.name && sig.image);
      }
      case 'quote': return quoteNow(c, rec).met;
      case 'remind': case 'review': return ['sent', 'unsure'].includes(g.msg?.state);
      case 'omw': {
        const kind = (s.settings?.visitKind || '').toLowerCase();
        return Object.values(db.entries || {}).some((e) => e.recordId === rec.id && e.visitId && (e.omw || 0) >= c.createdAt && (!kind || String(e.visit || '').toLowerCase() === kind));
      }
      case 'invoice': {
        const bound = g.invoiceId && db.invoices?.[g.invoiceId];
        if (bound && bound.status !== 'void') return SENT.includes(bound.status);
        return runInvoices(c, rec).some((i) => SENT.includes(i.status));
      }
      case 'payment': {
        const ig = stepGoals(c).find((x) => x.step?.kind === 'invoice' && x.invoiceId && db.invoices?.[x.invoiceId]?.status !== 'void');
        if (ig) return db.invoices[ig.invoiceId].status === 'paid';
        const all = runInvoices(c, rec); // non-void, made since the run started; a draft is still owed
        return all.length > 0 && all.every((i) => i.status === 'paid');
      }
      case 'tasks': return tasksInOrder(g).length > 0;
      case 'custom': return !!g.marked && (s.settings?.checklist || []).every((_, i) => !!g.checks?.[i]);
      default: return false;
    }
  }
  // goalMet for a step goal: its condition, its tasks and its needs. No job → not met (never true by default).
  function stepMet(g) {
    const c = db.campaigns[g.campaignId];
    const rec = recOf(c);
    if (!rec) return false;
    return stepCondition(g, rec) && tasksInOrder(g).every((t) => t.done || t.skipped) && needsMet(g);
  }
  const metNow = (g) => !!g.skipped || stepMet(g);
  function missing(g, rec) {
    const s = g.step || {};
    const t = typeOfRec(rec);
    switch (s.kind) {
      case 'client': return 'No client on the job yet';
      case 'details': { const names = (s.settings?.fields || []).map((k) => fieldBy(t, (f) => f.key === k)).filter((f) => f && !filled(rec.values[f.id])).map((f) => f.name); return names.length ? 'Still to fill in: ' + names.join(', ') : 'Waiting for Done'; }
      case 'book': return s.settings?.visitKind ? `No ${s.settings.visitKind} visit booked` : 'No visit booked';
      case 'work': return 'The checklist isn’t all ticked' + (s.settings?.photos ? ', or the after photos are missing' : '');
      case 'signoff': return 'The customer hasn’t signed';
      case 'remind': case 'review': return g.waitReason || 'Kloomie sends it by itself';
      case 'omw': return 'Nobody has tapped On my way yet';
      case 'quote': { const q = quoteNow(db.campaigns[g.campaignId], rec); return q.status === 'declined' ? 'The customer declined: send a new quote' : q.status === 'changed' ? 'The lines changed after it was accepted: send a new quote' : q.status === 'viewed' ? 'The customer opened it: waiting for them to accept' : q.status === 'sent' ? 'Waiting for the customer to accept' : 'Quote not sent yet'; }
      case 'invoice': return 'No invoice sent';
      case 'payment': return 'Not paid yet';
      case 'tasks': { const left = tasksInOrder(g).filter((x) => !x.done && !x.skipped).length; return `${left} task${left === 1 ? '' : 's'} left`; }
      case 'custom': { const left = (s.settings?.checklist || []).filter((_, i) => !g.checks?.[i]).length; return !g.marked ? 'Waiting for Done' : `${left} checklist item${left === 1 ? '' : 's'} left`; }
      default: return 'Not done';
    }
  }
  // The run as the job's page shows it, for this person: no invoice numbers or money, only the tasks they may see.
  function runView(ws, auth, c) {
    if (!c) return null;
    const rec = recOf(c);
    const flow = db.jobFlows[c.flowId];
    const goals = stepGoals(c);
    let current = null;
    const steps = goals.map((g) => {
      const met = rec ? metNow(g) : false;
      const state = g.skipped ? 'skipped' : met ? 'done' : !current ? 'current' : 'waiting';
      if (state === 'current') current = g;
      const s = g.step;
      const out = { id: s.id, goalId: g.id, name: s.name, kind: s.kind, how: s.how, state, who: whoNow(ws, s), mayAct: mayAct(ws, auth, s), canSkip: !!s.canSkip, stage: s.stage || null, cycle: (g.reopens || 0) + (g.finished ? 1 : 0) };
      if (g.skipped) Object.assign(out, { skipReason: g.skipReason || '', skippedAt: g.skippedAt || null });
      if (s.kind === 'custom') Object.assign(out, { text: s.settings?.text || '', checklist: (s.settings?.checklist || []).map((text, i) => ({ text, done: !!g.checks?.[i] })), marked: !!g.marked });
      if (s.kind === 'details') out.fields = s.settings?.fields || [];
      if (['book', 'remind', 'omw'].includes(s.kind) && s.settings?.visitKind) out.visitKind = s.settings.visitKind; // which visit it's about
      if (s.kind === 'quote' && rec) {
        const q = quoteNow(c, rec);
        out.quote = !isAdmin(auth) ? { status: q.status } : {
          status: q.status, total: itemsTotals(q.lines).total || 0, answeredBy: q.answer?.name || null, reason: q.answer?.reason || '',
          url: rec.share?.token ? `${publicUrl}/q/${rec.share.token}` : null, mayRequote: c.status !== 'cancelled' && !runInvoices(c, rec).length,
          ...(rec.quoteLook ? { number: rec.quoteLook.number } : {}),
        };
        // How the customer answered (owners and admins): what they accepted, when, and how (PHASE3B.md §3).
        if (isAdmin(auth) && rec.answer) out.answer = { act: rec.answer.act, method: rec.answer.method || null, name: rec.answer.name || '', at: rec.answer.at, reason: rec.answer.reason || '', ...(rec.answer.lines ? { lines: rec.answer.lines, total: rec.answer.total } : {}), ...(rec.answer.signature ? { signature: true } : {}) };
      }
      if (AUTO_KINDS.includes(s.kind)) {
        out.auto = true;
        out.sent = ['sent', 'unsure'].includes(g.msg?.state) ? { at: g.msg.at, ...(g.msg.state === 'unsure' ? { unsure: true } : {}) } : null;
        if (g.msg?.state === 'unsure') out.note = `May not have gone: ${g.msg.reason || 'the email service failed'}`;
        out.waiting = state === 'current' ? g.waitReason || null : null;
        if (isAdmin(auth) && g.msg?.via) out.sentTo = g.msg.via;
      }
      if (g.skippedBy === 'kloomie') out.skippedBy = 'kloomie';
      if (g.pending && isAdmin(auth)) out.pending = pendingOut(g.pending);
      if (s.kind === 'quote' && (s.settings?.followUpDays || 0) > 0) out.followUp = { days: s.settings.followUpDays, sentAt: ['sent', 'unsure'].includes(g.followed?.state) ? g.followed.at : null };
      if (s.kind === 'quote' && isAdmin(auth) && rec?.share) {
        const tk = rec.share.token;
        if (g.quoteTold?.token === tk) out.told = { state: g.quoteTold.state, ...(g.quoteTold.via ? { via: g.quoteTold.via } : {}), ...(g.quoteTold.reason ? { reason: g.quoteTold.reason } : {}) };
        else if (g.quoteBlocked?.token === tk) out.told = { state: 'blocked', reason: g.quoteBlocked.reason };
      }
      if (s.kind === 'payment' && (s.settings?.reminders || []).length) {
        const inv = rec && payInvoices(c, rec)[0];
        const hist = (inv && g.reminded?.[inv.id]) || {};
        out.reminders = s.settings.reminders.map((d) => ({ days: d, sentAt: ['sent', 'unsure'].includes(hist[d]?.state) ? hist[d].at : null, ...(hist[d]?.state === 'passed' ? { passed: true } : {}) }));
      }
      if (s.kind === 'invoice' && s.how === 'auto') {
        out.auto = true;
        if (isAdmin(auth)) {
          const inv = g.invoiceId && db.invoices?.[g.invoiceId];
          out.waiting = state === 'done' ? null : WAITING[g.auto?.state] || null;
          out.invoice = inv && inv.status !== 'void' ? inv.number : null;
          if (g.auto?.reason) out.reason = g.auto.reason;
        }
      }
      if (s.kind === 'tasks') {
        const all = tasksInOrder(g);
        const seen = all.filter((x) => canSeeTask(auth, x));
        Object.assign(out, { tasks: seen.map((x) => ({ id: x.id, text: x.text, done: !!x.done, skipped: !!x.skipped, assigneeId: x.assigneeId || null })), more: all.length - seen.length });
      }
      return out;
    });
    const cur = current && steps.find((x) => x.goalId === current.id);
    return {
      id: c.id, recordId: c.recordId, flowId: c.flowId, flowName: flow?.name || c.flowName || 'Flow', icon: flow?.icon || '', versionId: c.versionId, versionN: c.versionN,
      status: c.status, startedAt: c.createdAt, done: steps.filter((x) => x.state === 'done' || x.state === 'skipped').length, total: steps.length, steps,
      current: cur ? { stepId: cur.id, name: cur.name, kind: cur.kind, action: ACTION[cur.kind], missing: rec ? missing(current, rec) : '' } : null,
      next: cur ? { stepId: cur.id, action: ACTION[cur.kind] } : null,
    };
  }
  const summary = (ws, auth, c) => { const v = runView(ws, auth, c); return v && { id: v.id, flowId: v.flowId, flowName: v.flowName, versionN: v.versionN, status: v.status, done: v.done, total: v.total, current: v.current && { stepId: v.current.stepId, name: v.current.name, kind: v.current.kind, action: v.current.action, mayAct: !!v.steps.find((x) => x.id === v.current.stepId)?.mayAct } }; };
  const tell = (c) => broadcast(c.wsId, { type: 'jobrun', recordId: c.recordId, runId: c.id, campaignId: c.id });

  // A run of a flow's version on a job: the campaign and its step goals (a Tasks step's tasks too). buildRun writes
  // nothing, so a throw leaves nothing behind; commitRun only puts what was built in place.
  function buildRun(ws, auth, rec, flow, version) {
    const now = Date.now();
    const c = {
      id: rid(), wsId: ws.id, kind: 'job', recordId: rec.id, flowId: flow.id, flowName: flow.name, versionId: version.id, versionN: version.n,
      ownerId: auth.memberId, by: auth.member, createdAt: now, name: `${flow.name} · ${PJ.recName(db.projects[rec.projectId], rec) || 'job'}`.slice(0, 80),
      brief: '', start: null, end: null, color: 'teal', status: 'active', private: false, memberIds: [], assigneeId: null, outcomes: [], methods: [], cast: [], inOrder: false, channelId: null, stackId: null, lastReportAt: null,
    };
    const goals = [], tasks = [];
    // The flow's default items: refused if one was archived or is gone; put on the job only if its lines are empty,
    // when the run is kept (commitRun), never with cost (PHASE2.md §2.2).
    let lines = null;
    const defaults = version.body.items || [];
    if (defaults.length) {
      const rows = defaults.map((x) => {
        const it = db.jobItems[x.itemId];
        if (!it || it.wsId !== ws.id || it.archived) throw bad(`“${flow.name}” uses ${it && it.wsId === ws.id ? `“${it.name}”, which was archived` : 'an item that was deleted'}. Update the flow and publish it again.`);
        return { id: rid(6), desc: it.name, qty: x.qty, unit: it.unit || '', price: it.price, ...(it.taxable === false ? { taxable: false } : {}), from: 'item:' + it.id };
      });
      const f = itemsField(typeOfRec(rec));
      if (f && linesEmpty(rec.values[f.id])) lines = { fieldId: f.id, value: { rows, taxRate: 0 } };
    }
    version.body.steps.forEach((step, i) => {
      if (FAIL_STEP && step.name === FAIL_STEP) throw new Error('Job Flows test: the run failed to build');
      const g = { id: rid(), wsId: ws.id, campaignId: c.id, by: auth.member, createdAt: now, title: step.name, due: null, kind: 'step', target: 1, counts: null, order: i + 1, stage: step.stage || null, staged: false, step: copy(step), marked: null, checks: [], needs: [] };
      goals.push(g);
      for (const text of step.kind === 'tasks' ? step.settings?.tasks || [] : []) {
        tasks.push(applyTask({ id: rid(), wsId: ws.id, by: auth.member, memberId: auth.memberId, createdAt: now, text: '', done: false, doneAt: null, due: null, priority: 0, goalId: g.id, assigneeId: null, recordId: rec.id }, { text }));
      }
    });
    return { c, goals, tasks, lines, recordId: rec.id };
  }
  const linesEmpty = (v) => !v || typeof v !== 'object' || !Array.isArray(v.rows) || !v.rows.some((r) => r && (r.desc || r.price));
  function commitRun(run) {
    const rec = db.records[run.recordId];
    if (rec && !rec.onFlowSince) rec.onFlowSince = run.c.createdAt; // never cleared: the team-wide messages stay off (PHASE3.md §4)
    if (run.lines && rec) { rec.values[run.lines.fieldId] = run.lines.value; rec.updatedAt = Date.now(); }
    db.campaigns[run.c.id] = run.c;
    for (const g of run.goals) db.goals[g.id] = g;
    for (const t of run.tasks) db.tasks[t.id] = t;
  }
  // The sweep before the answer, so what a step action answers is what's kept (status, stage, events), as the person.
  const settle = (ws, auth) => sweepNow(ws.id, auth.member, auth.memberId);
  function afterStart(ws, auth, c, tasks) {
    for (const t of tasks) noteWork(t, null);
    save();
    for (const t of tasks) broadcast(ws.id, { type: 'task', task: publicTask(t) });
    tell(c);
    settle(ws, auth);
  }
  // A job a person may see and act on (its project, the members switch is the route's): null if not.
  function jobAt(ws, auth, id) {
    const at = PJ.recordAt(String(id || ''), ws.id, auth.memberId);
    return at && isJobList(at.t) ? at : null;
  }
  // The step a Done/skip names, in the job's going run.
  function stepAt(c, stepId) { return stepGoals(c).find((g) => g.step?.id === stepId) || null; }
  const currentGoal = (c) => stepGoals(c).find((g) => !metNow(g)) || null;
  function note(rec, text, by) { PJ.recordActivity(rec.id, { kind: 'note', note: text, by }); }

  // ---------- the Jobs list ----------
  function jobsList(ws, auth, q = {}) {
    const out = [];
    for (const p of Object.values(db.projects)) {
      if (p.wsId !== ws.id || !PJ.sees(p, auth.memberId)) continue;
      const lists = p.types.filter(isJobList);
      if (!lists.length) continue;
      for (const rec of Object.values(db.records)) {
        if (rec.projectId !== p.id) continue;
        const t = lists.find((x) => x.id === rec.typeId);
        if (!t) continue;
        const run = shownRun(rec.id);
        if (q.flow && run?.flowId !== q.flow) continue;
        const cf = fieldBy(t, (f) => f.type === 'contact');
        const contact = cf && db.contacts?.[rec.values[cf.id]];
        const sf = fieldBy(t, (f) => f.type === 'select' && ['status', 'stage'].includes(f.key));
        const df = fieldBy(t, (f) => f.key === 'scheduled');
        const name = PJ.recName(p, rec) || '';
        if (q.q && !name.toLowerCase().includes(String(q.q).toLowerCase())) continue;
        out.push({
          id: rec.id, projectId: p.id, typeId: t.id, list: t.name, name,
          client: contact && contact.wsId === ws.id ? { name: contact.name || '' } : null,
          stage: sf ? sf.choices.find((c) => c.id === rec.values[sf.id])?.label || '' : '',
          scheduled: df ? rec.values[df.id] || null : null,
          run: run ? summary(ws, auth, run) : null,
          ...(isAdmin(auth) && itemsField(t) ? { total: itemsTotals(rec.values[itemsField(t).id]).total || 0 } : {}),
          legacy: !activeRun(rec.id) && Object.values(db.campaigns).some((c) => !isJobRun(c) && c.recordId === rec.id),
          updatedAt: rec.updatedAt,
        });
        if (out.length >= 2000) break;
      }
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  // A flow a person may read: admins every one; a member only a published, unarchived flow they may start, on a job
  // list they can see.
  function mayRead(ws, auth, admin, f) {
    if (admin) return true;
    const v = !f.archived && activeVersion(f);
    if (!v || v.body.whoCreates !== 'everyone') return false;
    const pr = db.projects[v.body.list?.projectId];
    return !!(pr && pr.wsId === ws.id && PJ.sees(pr, auth.memberId) && pr.types.some((x) => x.id === v.body.list.typeId));
  }
  // ---------- the business's Items (PHASE2.md §1.1, §2.1) ----------
  const publicItem = ({ wsId, ...x }) => x;
  const cents = (v, what, nullable = false) => {
    if (nullable && (v === null || v === '')) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 1e10) throw bad(`${what} is a whole number of cents, from 0 to 100,000,000 dollars.`);
    return n;
  };
  // An item's fields from a request, checked; `x` is the item being changed (or a blank one).
  function itemFields(ws, body, x) {
    const out = {};
    if (body.name !== undefined || !x.id) { out.name = cleanText(String(body.name ?? ''), 200).trim(); if (!out.name) throw bad('Give the item a name.'); if (out.name.length > 120) throw bad('An item’s name is up to 120 characters.'); }
    if (body.description !== undefined) { out.description = cleanText(String(body.description ?? ''), 1000); if (out.description.length > 500) throw bad('A description is up to 500 characters.'); }
    if (body.unit !== undefined) { out.unit = cleanText(String(body.unit ?? ''), 40).trim(); if (out.unit.length > 20) throw bad('A unit is up to 20 characters, like each, hour or sq ft.'); }
    if (body.price !== undefined || !x.id) out.price = cents(body.price ?? 0, 'The price');
    if (body.cost !== undefined) out.cost = cents(body.cost, 'The cost', true);
    if (body.taxable !== undefined) out.taxable = body.taxable !== false;
    if (body.invItemId !== undefined) {
      const id = body.invItemId ? String(body.invItemId) : null;
      if (id && db.invItems?.[id]?.wsId !== ws.id) throw bad('That Inventory item isn’t one of your team’s.');
      out.invItemId = id;
    }
    return out;
  }
  async function itemsRoute(req, res, parts, auth, ws, admin) {
    const [, b, c] = parts;
    const m = req.method;
    if (!admin) return send(res, 403, { error: 'Only owners and admins see and change Items.' });
    const mine = () => Object.values(db.jobItems).filter((x) => x.wsId === ws.id);
    if (m === 'GET' && !b) return send(res, 200, { items: mine().sort((x, y) => x.name.localeCompare(y.name)).map(publicItem) });
    if (m === 'POST' && !b) {
      if (mine().length >= MAX_ITEMS) return send(res, 400, { error: `A team can have ${MAX_ITEMS} items.` });
      const body = await readJson(req, 20_000);
      const x = { id: rid(), wsId: ws.id, description: '', unit: '', cost: null, taxable: true, invItemId: null, archived: false, fromRecordId: null, createdBy: auth.memberId, createdAt: Date.now(), updatedAt: Date.now() };
      Object.assign(x, itemFields(ws, body, {}));
      db.jobItems[x.id] = x;
      save();
      return send(res, 200, { item: publicItem(x) });
    }
    if (m === 'POST' && b === 'import' && !c) {
      const body = await readJson(req, 5_000);
      const p = db.projects[body.projectId];
      if (!p || p.wsId !== ws.id || !PJ.sees(p, auth.memberId)) return send(res, 404, { error: 'That board is gone.' });
      const have = new Set(mine().map((x) => x.fromRecordId).filter(Boolean));
      let added = 0, skipped = 0, noName = 0;
      for (const r of PJ.priceList(p)) {
        if (have.has(r.id)) { skipped++; continue; }
        const name = String(r.item || '').trim().slice(0, 120);
        if (!name) { noName++; continue; }
        if (mine().length >= MAX_ITEMS) { skipped++; continue; }
        const ok = (v) => Number.isInteger(v) && v >= 0 && v <= 1e10;
        const x = { id: rid(), wsId: ws.id, name, description: String(r.description || '').slice(0, 500), unit: String(r.unit || '').slice(0, 20), price: ok(r.price) ? r.price : 0, cost: ok(r.cost) ? r.cost : null, taxable: true, invItemId: null, archived: false, fromRecordId: r.id, createdBy: auth.memberId, createdAt: Date.now(), updatedAt: Date.now() };
        db.jobItems[x.id] = x;
        added++;
      }
      save();
      return send(res, 200, { added, skipped, noName });
    }
    const x = b && db.jobItems[b];
    if (!x || x.wsId !== ws.id) return send(res, 404, { error: 'That item is gone.' });
    if (m === 'PATCH' && !c) {
      const body = await readJson(req, 20_000);
      const was = x.price;
      Object.assign(x, itemFields(ws, body, x), { updatedAt: Date.now() });
      save();
      if (x.price !== was) priceChanged(ws, auth, { id: 'item:' + x.id, name: x.name, was, now: x.price });
      return send(res, 200, { item: publicItem(x) });
    }
    if (m === 'POST' && (c === 'archive' || c === 'restore')) {
      x.archived = c === 'archive';
      x.updatedAt = Date.now();
      save();
      return send(res, 200, { item: publicItem(x) });
    }
    return send(res, 404, { error: 'Unknown endpoint' });
  }
  // Live Items for the team's price list (owners and admins only; PHASE2.md §2.1).
  const priceListItems = (ws) => Object.values(db.jobItems).filter((x) => x.wsId === ws.id && !x.archived).sort((x, y) => x.name.localeCompare(y.name))
    .map((x) => ({ id: 'item:' + x.id, source: 'items', board: 'Items', name: x.name, description: x.description || '', unit: x.unit || '', price: x.price, cost: x.cost ?? null, ...(x.taxable === false ? { taxable: false } : {}) }));
  const itemPrice = (id, wsId) => { const x = db.jobItems[id]; return x && x.wsId === wsId ? { price: x.price, cost: x.cost ?? null } : null; };

  // ---------- routes ----------
  async function route(req, res, parts, auth, ws) {
    const [a, b, c, d, e] = parts;
    if (a !== 'jobs' && a !== 'job-flows' && a !== 'job-items') return null;
    if (!toolsOf(ws).projects) return send(res, 403, { error: 'Boards are switched off for this team (Apps & Integrations → Tools).' });
    const m = req.method;
    const admin = isAdmin(auth);
    try {
      if (a === 'job-items') return await itemsRoute(req, res, parts, auth, ws, admin);
      if (a === 'job-flows') {
        if (m === 'GET' && !b) {
          const flows = Object.values(db.jobFlows).filter((f) => f.wsId === ws.id && mayRead(ws, auth, admin, f)).sort((x, y) => x.createdAt - y.createdAt);
          return send(res, 200, { flows: flows.map((f) => publicFlow(f, admin)) });
        }
        if (m === 'POST' && !b) {
          if (!admin) return send(res, 403, { error: 'Only owners and admins build job flows.' });
          if (Object.values(db.jobFlows).filter((f) => f.wsId === ws.id).length >= MAX_FLOWS) return send(res, 400, { error: `A team can have ${MAX_FLOWS} job flows.` });
          const body = await readJson(req, 100_000);
          const name = cleanText(body.name, 80).trim();
          if (!name) return send(res, 400, { error: 'Give the flow a name.' });
          const flow = { id: rid(), wsId: ws.id, name, icon: cleanText(body.icon, 8) || '🧰', draft: cleanBody(ws, auth, body, null), activeVersionId: null, archived: false, createdBy: auth.memberId, createdAt: Date.now(), updatedAt: Date.now() };
          db.jobFlows[flow.id] = flow;
          save();
          return send(res, 200, publicFlow(flow, true));
        }
        const flow = b && db.jobFlows[b];
        if (!flow || flow.wsId !== ws.id || !mayRead(ws, auth, admin, flow)) return send(res, 404, { error: 'That flow is gone.' });
        if (m === 'GET' && !c) return send(res, 200, publicFlow(flow, admin));
        if (c === 'versions') {
          if (!admin) return send(res, 403, { error: 'Only owners and admins see a flow’s versions.' });
          if (m === 'GET' && !d) return send(res, 200, { versions: versionsOf(flow).map(publicVersion) });
          return send(res, 404, { error: 'A published version doesn’t change. Edit the draft and publish again.' });
        }
        if (!admin) return send(res, 403, { error: 'Only owners and admins change job flows.' });
        if (m === 'PATCH' && !c) {
          const body = await readJson(req, 100_000);
          // Everything checked first; a request that fails changes nothing.
          const n = body.name !== undefined ? cleanText(body.name, 80).trim() : flow.name;
          if (!n) return send(res, 400, { error: 'Give the flow a name.' });
          const draft = ['list', 'steps', 'whoCreates', 'billing', 'items', 'dueDays'].some((k) => body[k] !== undefined) ? cleanBody(ws, auth, body, flow) : flow.draft;
          Object.assign(flow, { name: n, icon: body.icon !== undefined ? cleanText(body.icon, 8) || '🧰' : flow.icon, draft, updatedAt: Date.now() });
          save();
          return send(res, 200, publicFlow(flow, true));
        }
        if (m === 'POST' && c === 'publish') {
          const body = cleanBody(ws, auth, {}, flow); // checked again: the people and roles it names may have changed
          checkPublish(ws, body);
          const v = { id: rid(), flowId: flow.id, wsId: ws.id, n: versionsOf(flow).length + 1, body: copy(body), publishedAt: Date.now(), publishedBy: auth.memberId };
          db.jobFlowVersions[v.id] = v;
          Object.assign(flow, { draft: body, activeVersionId: v.id, updatedAt: Date.now() });
          save();
          return send(res, 200, publicFlow(flow, true));
        }
        if (m === 'POST' && c === 'copy') {
          if (Object.values(db.jobFlows).filter((f) => f.wsId === ws.id).length >= MAX_FLOWS) return send(res, 400, { error: `A team can have ${MAX_FLOWS} job flows.` });
          const src = activeVersion(flow)?.body || flow.draft;
          const { t } = listOf(ws, auth, src.list);
          const draft = { ...copy(src), steps: cleanSteps(ws, t, src.steps, new Set(), true) };
          const nf = { id: rid(), wsId: ws.id, name: `${flow.name} (copy)`.slice(0, 80), icon: flow.icon, draft, activeVersionId: null, archived: false, createdBy: auth.memberId, createdAt: Date.now(), updatedAt: Date.now() };
          db.jobFlows[nf.id] = nf;
          save();
          return send(res, 200, publicFlow(nf, true));
        }
        if (m === 'POST' && c === 'archive') {
          const body = await readJson(req, 1_000).catch(() => ({}));
          flow.archived = body.archived !== false;
          flow.updatedAt = Date.now();
          save();
          return send(res, 200, publicFlow(flow, true));
        }
        return send(res, 404, { error: 'Unknown endpoint' });
      }

      // a === 'jobs'
      if (m === 'GET' && !b) { const sp = new URL(req.url, 'http://x').searchParams; return send(res, 200, { jobs: jobsList(ws, auth, { flow: sp.get('flow'), q: sp.get('q') }) }); }
      if (m === 'POST' && !b) {
        const body = await readJson(req, 200_000);
        const flow = db.jobFlows[body.flowId];
        if (!flow || flow.wsId !== ws.id || !flow.activeVersionId) return send(res, 404, { error: 'That flow is gone.' });
        if (flow.archived) return send(res, 400, { error: 'That flow is archived, so new jobs can’t start on it.' });
        const version = activeVersion(flow);
        if (version.body.whoCreates !== 'everyone' && !admin) return send(res, 403, { error: 'Only owners and admins start jobs on this flow.' });
        const p = db.projects[version.body.list.projectId];
        const t = p && p.types.find((x) => x.id === version.body.list.typeId);
        if (!p || p.wsId !== ws.id || !PJ.sees(p, auth.memberId) || !t) return send(res, 404, { error: 'That flow’s job list is gone.' });
        const values = body.values && typeof body.values === 'object' ? { ...body.values } : {};
        if (body.contactId) { const cf = fieldBy(t, (f) => f.type === 'contact'); if (cf) values[cf.key] = String(body.contactId); }
        // A retry with the same key gives back the same job; the same key for another job is refused.
        const key = body.key ? `${ws.id}:${auth.memberId}:${cleanText(body.key, 100)}` : null;
        const sig = JSON.stringify({ f: flow.id, v: values });
        for (const [k, x] of keys) if (Date.now() - x.at > KEY_MS) keys.delete(k);
        if (key && keys.has(key)) {
          const x = keys.get(key);
          if (x.sig !== sig) return send(res, 409, { error: 'That request key was used for another job.' });
          const rec = db.records[x.recordId];
          if (rec) return send(res, 200, { job: PJ.publicRecordOf(rec), run: runView(ws, auth, shownRun(rec.id)) });
        }
        // The run is built against the job before either is kept: a throw keeps neither (nor uses up a job number).
        let run;
        const made = PJ.jobRecord(ws, p, t, auth, values, req, body, (rec) => { run = buildRun(ws, auth, rec, flow, version); });
        if (made.held) return send(res, made.held.status, made.held.body);
        const rec = made.rec;
        commitRun(run);
        if (key) keys.set(key, { sig, recordId: rec.id, at: Date.now() });
        PJ.announceRecord(rec, auth.member);
        afterStart(ws, auth, run.c, run.tasks);
        return send(res, 200, { job: PJ.publicRecordOf(rec), run: runView(ws, auth, run.c) });
      }
      const at = jobAt(ws, auth, b);
      if (!at) return send(res, 404, { error: 'That job is gone.' });
      const { rec } = at;
      if (c === 'run' && m === 'GET') return send(res, 200, { run: runView(ws, auth, shownRun(rec.id)) });
      if (c === 'flow' && m === 'POST' && !d) {
        if (!admin) return send(res, 403, { error: 'Only owners and admins put a job on a flow.' });
        const body = await readJson(req, 10_000);
        const flow = db.jobFlows[body.flowId];
        if (!flow || flow.wsId !== ws.id || !flow.activeVersionId) return send(res, 404, { error: 'That flow is gone.' });
        if (flow.archived) return send(res, 400, { error: 'That flow is archived.' });
        const version = activeVersion(flow);
        if (version.body.list?.projectId !== rec.projectId || version.body.list?.typeId !== rec.typeId) return send(res, 400, { error: `“${flow.name}” is for another job list, so it can’t go on this job.` });
        const going = activeRun(rec.id);
        if (going && body.replace !== true) return send(res, 409, { error: `This job is already on “${going.flowName}”. Replace it to start over on another flow.` });
        const run = buildRun(ws, auth, rec, flow, version);
        commitRun(run);
        if (run.lines) PJ.recordNews(rec, 'record.updated', auth.member);
        if (going) { Object.assign(going, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: auth.memberId }); tell(going); note(rec, `Moved from the flow “${going.flowName}” to “${flow.name}”`, auth.member); }
        else note(rec, `Put on the flow “${flow.name}”`, auth.member);
        afterStart(ws, auth, run.c, run.tasks);
        return send(res, 200, { run: runView(ws, auth, run.c) });
      }
      if (c === 'flow' && d === 'cancel' && m === 'POST') {
        if (!admin) return send(res, 403, { error: 'Only owners and admins take a job off its flow.' });
        const going = activeRun(rec.id);
        if (!going) return send(res, 404, { error: 'This job isn’t on a flow.' });
        const body = await readJson(req, 10_000).catch(() => ({}));
        const why = cleanText(body.reason, 300).trim();
        if (!why) return send(res, 400, { error: 'Say why it’s coming off its flow.' });
        Object.assign(going, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: auth.memberId });
        note(rec, `Taken off the flow “${going.flowName}”: ${why}`, auth.member);
        save();
        tell(going);
        settle(ws, auth);
        return send(res, 200, { run: runView(ws, auth, going) });
      }
      // Send the quote (PHASE3.md §3.3): the link (made, or the live one), and the customer told once per link.
      if (c === 'quote' && d === 'send' && m === 'POST') {
        if (!admin) return send(res, 403, { error: 'Only owners and admins send the quote.' });
        const run = activeRun(rec.id);
        const g = run && stepGoals(run).find((x) => x.step?.kind === 'quote');
        if (!g) return send(res, 404, { error: 'This job’s flow has no quote step.' });
        if (rec.answer) return send(res, 409, { error: 'The customer has answered this quote. Send a new quote to change it.' });
        const live = rec.share && !(rec.share.expiresAt && rec.share.expiresAt < Date.now());
        // Asks first when Kloomie would email or text it (PHASE3B.md §1). Until then no link is made and nothing is
        // marked sent; the preview shows where the link will go.
        {
          const body = await readJson(req, 5_000).catch(() => ({}));
          const cust = customerOf(rec);
          const willTell = g.step.settings?.email !== false && !flowReach(cust) && !(live && g.quoteTold?.token === rec.share.token && ['sending', 'sent', 'unsure'].includes(g.quoteTold.state));
          if (willTell && sendGate) {
            const msg = flowMsg.quote(ws, rec, cust, live ? quoteUrlOf(rec) : '(the quote link)', itemsTotals(rec.values[itemsField(typeOfRec(rec))?.id])?.total || 0);
            const gate = sendGate(ws, auth, 'quote', rec.id, custPreview(cust, msg, { admin: true }), custDigest(cust, { ...msg, button: null, lines: msg.lines, text: '' }), body.confirm);
            if (gate) return send(res, gate.status, gate.body);
          }
        }
        if (!live) { shareRecord(rec, auth); save(); PJ.recordNews(rec, 'record.updated', auth.member); }
        const token = rec.share.token;
        let told = null;
        if (g.step.settings?.email !== false) {
          if (g.quoteTold?.token === token && ['sending', 'sent', 'unsure'].includes(g.quoteTold.state)) told = { emailed: g.quoteTold.via === 'email' || g.quoteTold.via === 'both', texted: g.quoteTold.via === 'text' || g.quoteTold.via === 'both', already: true };
          else {
            const cust = customerOf(rec);
            const why = flowReach(cust);
            if (why) { told = { emailed: false, texted: false, reason: why }; g.quoteBlocked = { token, reason: why, at: Date.now() }; save(); }
            else {
              const out = await sendOnce(g, 'quoteTold', { token }, () => flowTell(ws, rec, cust, flowMsg.quote(ws, rec, cust, quoteUrlOf(rec), itemsTotals(rec.values[itemsField(typeOfRec(rec))?.id])?.total || 0), auth.member));
              told = { emailed: out.via === 'email' || out.via === 'both', texted: out.via === 'text' || out.via === 'both', ...(out.outcome !== 'sent' ? { reason: out.reason } : {}) };
              // Not sent for sure: the reason is kept apart from the once-only marker (which is gone, so a later tap
              // may try again), for the job's quote step to show "Not emailed".
              if (out.outcome === 'blocked') g.quoteBlocked = { token, reason: out.reason, at: Date.now() }; else delete g.quoteBlocked;
              save();
            }
          }
        }
        tell(run);
        settle(ws, auth);
        return send(res, 200, { run: runView(ws, auth, run), url: quoteUrlOf(rec), told });
      }
      if (TEST_DROP && c === 'flow' && d === 'test-drop' && m === 'POST') { dropFor(rec); save(); return send(res, 200, { ok: true }); }
      // New quote (PHASE2.md §1.3): the last answer goes to the timeline, the old link is turned off, and the quote
      // step is open again, until the run has an invoice.
      if (c === 'requote' && m === 'POST' && !d) {
        if (!admin) return send(res, 403, { error: 'Only owners and admins send a new quote.' });
        const run = activeRun(rec.id);
        const g = run && stepGoals(run).find((x) => x.step?.kind === 'quote');
        if (!g) return send(res, 404, { error: 'This job’s flow has no quote step.' });
        if (runInvoices(run, rec).length) return send(res, 409, { error: 'This job has an invoice. Void the invoice first to send a new quote.' });
        const a = rec.answer;
        if (a) note(rec, `New quote. The last one was ${a.act === 'accept' ? 'accepted' : 'declined'} by ${a.name || 'the customer'}${a.reason ? ': ' + a.reason : ''}`, auth.member);
        else note(rec, 'New quote', auth.member);
        rec.answer = null;
        rec.share = null;
        rec.quoteLook = null; // a New quote takes the settings as they are now (PHASE3B.md §3)
        if (g.skipped) Object.assign(g, { skipped: false, skipReason: null, skippedById: null, skippedAt: null });
        rec.updatedAt = Date.now();
        save();
        PJ.recordNews(rec, 'record.updated', auth.member);
        tell(run);
        settle(ws, auth);
        return send(res, 200, { run: runView(ws, auth, run) });
      }
      if (c === 'steps' && d && m === 'POST') {
        // The going run, or a finished one (reopening a step puts it back to going); never a cancelled one.
        const run = activeRun(rec.id) || runsOf(rec.id).filter((x) => x.status === 'done').at(-1) || null;
        if (!run) return send(res, 404, { error: 'This job isn’t on a flow.' });
        const g = stepAt(run, d);
        if (!g) return send(res, 404, { error: 'That step isn’t on this job’s flow.' });
        const s = g.step;
        const body = await readJson(req, 10_000).catch(() => ({}));
        // A waiting message (PHASE3B.md §2): Send, or Don't send. Owners and admins; the key must be the one shown.
        if (e === 'message') {
          if (!admin) return send(res, 403, { error: 'Only owners and admins send or hold back messages to customers.' });
          const p = g.pending;
          if (!p || typeof body.key !== 'string' || body.key !== p.key) return send(res, 409, { error: 'That message changed or was already handled. Look at it again.', run: runView(ws, auth, run) });
          const n = pendingNow(run, g, p);
          const what = `${PENDING_WHAT[p.kind]} for ${n.cust?.name || 'the customer'}`;
          if (body.action === 'skip') {
            delete g.pending;
            if (n.holder && n.mkey) n.holder[n.mkey] = { ...n.extra, state: 'declined', at: Date.now(), byId: auth.memberId };
            note(rec, `Not sent: ${what} (${auth.member} chose not to send it)`, auth.member);
            if (p.kind === 'remind' || p.kind === 'review') Object.assign(g, { skipped: true, skipReason: 'Not sent', skippedBy: null, skippedById: auth.memberId, skippedAt: Date.now(), waitReason: null });
            save();
            tell(run);
            settle(ws, auth);
            return send(res, 200, { run: runView(ws, auth, run), outcome: 'declined' });
          }
          if (body.action !== 'send') return send(res, 400, { error: 'Send it, or don’t.' });
          if (run.status !== 'active' && p.kind !== 'invoice') n.late ||= 'the job’s flow is finished';
          if (n.late) {
            dropPending(run, g, n.late);
            return send(res, 409, { error: `Too late: ${n.late}. It wasn’t sent.`, outcome: 'dropped', run: runView(ws, auth, run) });
          }
          const dg = custDigest(n.cust, n.msg);
          if (dg !== p.digest) {
            Object.assign(p, { key: rid(), preview: custPreview(n.cust, n.msg, { admin: true }), digest: dg });
            save();
            tell(run);
            return send(res, 409, { error: 'It changed since you saw it. Look at it again.', pending: pendingOut(p), run: runView(ws, auth, run) });
          }
          // Checked, and handed over, with no wait in between: a second press finds the marker.
          if (n.holder[n.mkey] && n.holder[n.mkey].state !== 'dropped') return send(res, 409, { error: 'That already went.', run: runView(ws, auth, run) });
          if (p.kind === 'remind') g.msgFor = { visitId: p.visitId, date: visitsOf(rec.id).find((x) => x.id === p.visitId)?.date || null };
          const out = await sendOnce(n.holder, n.mkey, n.extra, () => flowTell(ws, rec, n.cust, n.msg, auth.member));
          if (out.outcome === 'blocked') { if (g.pending) g.pending.lastTry = { at: Date.now(), reason: String(out.reason || 'Nothing could be sent.').slice(0, 200) }; }
          else { if (g.pending?.key === p.key) delete g.pending; g.waitReason = null; }
          save();
          tell(run);
          settle(ws, auth);
          return send(res, 200, { run: runView(ws, auth, run), outcome: out.outcome, ...(out.reason ? { reason: out.reason } : {}) });
        }
        if (e === 'done') {
          if (s.kind === 'quote') return send(res, 400, { error: `“${s.name}” finishes when the customer accepts the quote. Skip it with a reason if it was agreed another way.` });
          if (!(s.kind === 'custom' || (s.kind === 'details' && !(s.settings?.fields || []).length))) return send(res, 409, { error: `“${s.name}” finishes by itself when it’s done on the job.` });
          if (!mayAct(ws, auth, s)) return send(res, 403, { error: `“${s.name}” is for ${whoNow(ws, s).name || 'owners and admins'}.` });
          if (!g.marked) {
            if (currentGoal(run)?.id !== g.id) return send(res, 409, { error: 'Finish the steps before this one first.' });
            g.marked = { byId: auth.memberId, at: Date.now() };
            save();
          }
          tell(run);
          settle(ws, auth);
          return send(res, 200, { run: runView(ws, auth, run) });
        }
        if (e === 'check') {
          if (s.kind !== 'custom') return send(res, 409, { error: 'Only your own steps have a checklist here.' });
          if (!mayAct(ws, auth, s)) return send(res, 403, { error: `“${s.name}” is for ${whoNow(ws, s).name || 'owners and admins'}.` });
          const i = Number(body.item);
          if (!Number.isInteger(i) || i < 0 || i >= (s.settings?.checklist || []).length) return send(res, 400, { error: 'That checklist item isn’t there.' });
          // Unticking an item of a finished step reopens it (and a finished run): that's a reopen, so admins only.
          if (body.done === false && g.finished && !admin) return send(res, 403, { error: `“${s.name}” is finished. Only owners and admins reopen it.` });
          g.checks = [...(g.checks || [])];
          g.checks[i] = body.done !== false;
          save();
          tell(run);
          settle(ws, auth);
          return send(res, 200, { run: runView(ws, auth, run) });
        }
        if (e === 'skip') {
          if (!admin && (MONEY_KINDS.includes(s.kind) || AUTO_KINDS.includes(s.kind) || !(s.canSkip && mayAct(ws, auth, s)))) return send(res, 403, { error: `Only owners and admins can skip “${s.name}”.` });
          const why = cleanText(body.reason, 300).trim();
          if (!why) return send(res, 400, { error: 'Say why it’s being skipped.' });
          if (!g.skipped) {
            Object.assign(g, { skipped: true, skipReason: why, skippedById: auth.memberId, skippedAt: Date.now() });
            note(rec, `Skipped “${s.name}”: ${why}`, auth.member);
            save();
          }
          tell(run);
          settle(ws, auth);
          return send(res, 200, { run: runView(ws, auth, run) });
        }
        if (e === 'reopen') {
          if (!admin) return send(res, 403, { error: 'Only owners and admins reopen steps.' });
          Object.assign(g, { skipped: false, skipReason: null, skippedById: null, skippedAt: null, skippedBy: null, marked: null, ...(AUTO_KINDS.includes(s.kind) ? { msg: null, waitReason: null } : {}) });
          note(rec, `Reopened “${s.name}”`, auth.member);
          save();
          tell(run);
          settle(ws, auth);
          return send(res, 200, { run: runView(ws, auth, run) });
        }
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      if (err.status) return send(res, err.status, { error: err.message });
      throw err;
    }
  }

  // An invoice made from a run's Invoice step: that step reads it (a voided one is replaced by the next).
  function bindInvoice(rec, inv, stepId) {
    const run = activeRun(rec.id);
    const g = run && stepAt(run, stepId);
    if (!g || g.step.kind !== 'invoice') return;
    const was = g.invoiceId && db.invoices?.[g.invoiceId];
    if (!was || was.status === 'void') g.invoiceId = inv.id;
  }
  // ---------- customer messages (PHASE3.md §3) ----------
  // Every message: the marker saved (and written to disk) before anything goes; sent, or removed when nothing left
  // Kloomie (blocked: tried again later), or unsure when it may have gone (never sent again by itself).
  async function sendOnce(holder, key, extra, fn) {
    holder[key] = { ...extra, state: 'sending', at: Date.now() };
    save();
    await saveNow();
    let out;
    try { out = await fn(); } catch (e) { out = { outcome: 'unsure', reason: String(e?.message || e).slice(0, 200) }; }
    if (out.outcome === 'sent' && CRASH_AFTER_SEND) process.exit(1); // test only: died before "sent" was kept
    if (out.outcome === 'sent') holder[key] = { ...extra, state: 'sent', at: Date.now(), via: out.via };
    else if (out.outcome === 'unsure') holder[key] = { ...extra, state: 'unsure', at: Date.now(), reason: out.reason };
    else delete holder[key];
    save();
    return out;
  }
  // A marker still "sending" at start: the server stopped mid-send. It may have gone: unsure, never sent again.
  {
    const fix = (m) => { if (m?.state === 'sending') { m.state = 'unsure'; m.reason = 'The server stopped while sending it'; return true; } return false; };
    let any = false;
    for (const g of Object.values(db.goals || {})) {
      if (g.kind !== 'step') continue;
      for (const k of ['msg', 'quoteTold', 'followed', 'invoiceTold']) any = fix(g[k]) || any;
      for (const per of Object.values(g.reminded || {})) for (const m of Object.values(per)) any = fix(m) || any;
    }
    if (any) save();
  }
  function skipByKloomie(c, g, rec, why) {
    Object.assign(g, { skipped: true, skipReason: why, skippedBy: 'kloomie', skippedById: null, skippedAt: Date.now(), waitReason: null });
    note(rec, `Kloomie skipped “${g.step.name}”: ${why}`, 'Kloomie');
    save();
    tell(c);
  }
  const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const NINE = 9 * 60;
  // ---------- Ask me first (PHASE3B.md §2) ----------
  // A message due on a step that isn't set to send by itself waits as g.pending (one per step at a time; a newer one
  // waits its turn) for an owner or admin to press Send or Don't send. Its words are rebuilt when it's sent and must be
  // what was shown; when it's too late (the visit day came, the quote was answered, the invoice paid or voided) it's
  // dropped and noted, never sent late.
  const askFirst = (step) => step?.settings?.send !== 'auto';
  const PENDING_WHAT = { remind: 'Day-before reminder', review: 'Review request', quoteFollow: 'Quote follow-up', invoice: 'Invoice email', payReminder: 'Payment reminder' };
  function pendingNow(c, g, p) {
    const ws = db.workspaces[c.wsId], rec = recOf(c);
    if (!ws || !rec) return { late: 'The job is gone' };
    const cust = customerOf(rec);
    const clock = teamClock(ws);
    let msg = null, holder = g, mkey = 'msg', extra = {}, late = null;
    if (p.kind === 'remind') {
      const v = visitsOf(rec.id).find((x) => x.id === p.visitId);
      if (currentGoal(c) !== g) late = 'The step isn’t up any more';
      else if (!v || v.done) late = 'The visit is gone';
      else if (v.date <= clock.today) late = v.date === clock.today ? 'the visit is today' : 'the visit has passed';
      else msg = flowMsg.remind(ws, rec, cust, v);
    } else if (p.kind === 'review') {
      if (currentGoal(c) !== g) late = 'The step isn’t up any more';
      else msg = flowMsg.review(ws, rec, cust, g.step.settings?.url || teamReviewUrl(ws));
    } else if (p.kind === 'quoteFollow') {
      mkey = 'followed'; extra = { token: p.token };
      if (rec.answer) late = 'the customer answered the quote';
      else if (!rec.share || rec.share.token !== p.token || (rec.share.expiresAt && rec.share.expiresAt < Date.now())) late = 'the quote link changed';
      else if (g.skipped) late = 'the quote step was skipped';
      else msg = flowMsg.quoteFollow(ws, rec, cust, quoteUrlOf(rec));
    } else if (p.kind === 'invoice') {
      mkey = 'invoiceTold'; extra = { invoiceId: p.invoiceId };
      const inv = db.invoices?.[p.invoiceId];
      if (!inv || inv.status === 'void') late = 'the invoice was voided';
      else if (inv.status === 'paid') late = 'the invoice is paid';
      else if (g.skipped) late = 'the invoice step was skipped';
      else msg = flowMsg.invoice(ws, rec, cust, inv, invoiceUrl(inv), invoiceTotals(inv).total);
    } else if (p.kind === 'payReminder') {
      g.reminded ||= {};
      holder = (g.reminded[p.invoiceId] ||= {}); mkey = String(p.day);
      const inv = db.invoices?.[p.invoiceId];
      if (!inv || inv.status === 'void') late = 'the invoice was voided';
      else if (!['sent', 'viewed', 'partial'].includes(inv.status) || !(invoiceTotals(inv).balance > 0)) late = 'the invoice is paid';
      else if (g.skipped) late = 'the payment step was skipped';
      else msg = flowMsg.payReminder(ws, rec, cust, inv, invoiceUrl(inv), invoiceTotals(inv).balance);
    }
    if (!late) late = flowReach(cust);
    return { ws, rec, cust, msg, holder, mkey, extra, late };
  }
  const pendingOut = (p) => ({ key: p.key, kind: p.kind, preview: p.preview, dueAt: p.dueAt, createdAt: p.createdAt, ...(p.day ? { day: p.day } : {}), ...(p.lastTry ? { lastTry: p.lastTry } : {}) });
  function makePending(c, g, p) {
    const n = pendingNow(c, g, p);
    if (n.late || !n.msg) return false;
    g.pending = { ...p, key: rid(), preview: custPreview(n.cust, n.msg, { admin: true }), digest: custDigest(n.cust, n.msg), dueAt: Date.now(), createdAt: Date.now() };
    g.waitReason = null;
    const ws = n.ws;
    const msg = { title: `${PENDING_WHAT[p.kind]} for ${n.cust?.name || 'the customer'} is ready to send`, text: `On ${PJ.recName(db.projects[n.rec.projectId], n.rec) || 'the job'}: Send it or don’t, from the job.`, kind: 'jobflow', key: `pending:${g.id}` };
    notifyAdmins(ws.id, msg);
    if (c.ownerId && !isAdmin({ memberId: c.ownerId, role: memberOf(ws, c.ownerId)?.role })) notify(ws.id, c.ownerId, msg);
    note(n.rec, `${PENDING_WHAT[p.kind]} ready to send: waiting for an OK`, 'Kloomie');
    save();
    tell(c);
    return true;
  }
  // Too late: dropped for good (its marker is kept as dropped, so it isn't asked again) and noted.
  function dropPending(c, g, why) {
    const p = g.pending;
    if (!p) return;
    const n = pendingNow(c, g, p);
    delete g.pending;
    const rec = recOf(c);
    if (n.holder && n.mkey && !n.holder[n.mkey]) n.holder[n.mkey] = { ...n.extra, state: 'dropped', at: Date.now(), reason: why };
    if (rec) note(rec, `Not sent: ${PENDING_WHAT[p.kind]}, ${why}`, 'Kloomie');
    if ((p.kind === 'remind' || p.kind === 'review') && currentGoal(c) === g && rec) skipByKloomie(c, g, rec, `Not sent: ${why}`);
    save();
    tell(c);
  }
  // Each waiting message checked: too late → dropped; its words changed → the new preview, and a new key.
  function checkPending(c) {
    for (const g of stepGoals(c)) {
      if (!g.pending) continue;
      const n = pendingNow(c, g, g.pending);
      if (n.late) { dropPending(c, g, n.late); continue; }
      const dg = custDigest(n.cust, n.msg);
      if (dg !== g.pending.digest) { Object.assign(g.pending, { key: rid(), preview: custPreview(n.cust, n.msg, { admin: true }), digest: dg }); save(); tell(c); }
    }
  }

  // The automatic invoice, emailed once per invoice, until it's paid or void. The email belongs to the invoice, not
  // the run: it still goes (or asks) after the run finishes, since a flow can end at its Invoice step.
  async function invoiceEmail(c, ws, rec) {
    const ig = stepGoals(c).find((x) => x.step?.kind === 'invoice');
    const inv = ig && !ig.skipped && ig.step.how === 'auto' && ig.step.settings?.email !== false && ig.invoiceId && db.invoices?.[ig.invoiceId];
    if (!inv || ig.pending || !inv.sentAt || ['paid', 'void'].includes(inv.status) || ig.invoiceTold?.invoiceId === inv.id) return;
    const cust = customerOf(rec);
    if (!flowReach(cust) && askFirst(ig.step)) makePending(c, ig, { kind: 'invoice', invoiceId: inv.id });
    else if (!flowReach(cust)) await sendOnce(ig, 'invoiceTold', { invoiceId: inv.id }, () => flowTell(ws, rec, cust, flowMsg.invoice(ws, rec, cust, inv, invoiceUrl(inv), invoiceTotals(inv).total), 'Kloomie'));
    tell(c);
  }

  let msgBusy = false;
  async function autoMessages() {
    if (msgBusy || !flowTell) return;
    msgBusy = true;
    try {
      for (const c of Object.values(db.campaigns)) {
        if (!isJobRun(c)) continue;
        // A cancelled run sends nothing more; a finished one sends nothing but its invoice's email (above). Anything
        // else still waiting is dropped.
        if (c.status !== 'active') {
          for (const g of stepGoals(c)) {
            if (!g.pending) continue;
            if (c.status === 'done' && g.pending.kind === 'invoice') checkPending(c);
            else dropPending(c, g, c.status === 'cancelled' ? 'the job came off its flow' : 'the job’s flow is finished');
          }
          const fws = db.workspaces[c.wsId], frec = recOf(c);
          if (c.status === 'done' && fws && frec && sendable(fws)) await invoiceEmail(c, fws, frec);
          continue;
        }
        const ws = db.workspaces[c.wsId];
        const rec = recOf(c);
        if (!ws || !rec || !sendable(ws)) continue;
        const clock = teamClock(ws);
        const cur = currentGoal(c);
        const wait = (g, why) => { if (g.waitReason !== why) { g.waitReason = why; save(); tell(c); } };
        checkPending(c);
        // The current step, when it's one Kloomie does.
        if (cur && AUTO_KINDS.includes(cur.step.kind) && !cur.msg && !cur.pending && !cur.skipped) {
          const cust = customerOf(rec);
          const why = flowReach(cust);
          if (why) { skipByKloomie(c, cur, rec, why); continue; }
          let msg = null;
          if (cur.step.kind === 'remind') {
            const kind = (cur.step.settings?.visitKind || '').toLowerCase();
            const v = visitsOf(rec.id).find((x) => !x.done && x.date >= clock.today && (!kind || String(x.kind || '').toLowerCase() === kind));
            if (!v) { wait(cur, 'No visit booked to remind about'); continue; }
            if (v.date === clock.today) { skipByKloomie(c, cur, rec, 'The visit is today, so there’s nothing to remind about'); continue; }
            if (v.date > clock.tomorrow || clock.min < NINE) {
              const day = addDays(v.date, -1);
              const when = day === clock.today ? 'today' : new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
              wait(cur, `Goes ${when === 'today' ? 'today' : 'on ' + when} at 9am, the day before the visit`);
              continue;
            }
            if (askFirst(cur.step)) { makePending(c, cur, { kind: 'remind', visitId: v.id }); continue; }
            msg = flowMsg.remind(ws, rec, cust, v);
            cur.msgFor = { visitId: v.id, date: v.date };
          } else {
            const url = cur.step.settings?.url || teamReviewUrl(ws);
            if (!url) { wait(cur, 'Add a review link (on the step, or in Settings → Customer messages)'); continue; }
            const due = (cur.currentSince || Date.now()) + (cur.step.settings?.delayHours ?? 1) * (DAY_MS / 24);
            if (Date.now() < due) { wait(cur, `Goes ${cur.step.settings?.delayHours ?? 1} hour(s) after it came up`); continue; }
            if (askFirst(cur.step)) { makePending(c, cur, { kind: 'review' }); continue; }
            msg = flowMsg.review(ws, rec, cust, url);
          }
          const out = await sendOnce(cur, 'msg', {}, () => flowTell(ws, rec, cust, msg, 'Kloomie'));
          if (out.outcome === 'blocked') wait(cur, out.reason); else { cur.waitReason = null; save(); }
          tell(c);
          sweepNow(c.wsId, 'Kloomie', null);
          continue;
        }
        // The quote's follow-up: once per live, unanswered link, while the quote step is open.
        const qg = stepGoals(c).find((x) => x.step?.kind === 'quote');
        const fu = qg?.step.settings?.followUpDays || 0;
        if (qg && fu > 0 && !qg.skipped && !qg.pending && rec.share && !rec.answer && !(rec.share.expiresAt && rec.share.expiresAt < Date.now()) && qg.followed?.token !== rec.share.token && Date.now() >= rec.share.createdAt + fu * DAY_MS) {
          const cust = customerOf(rec);
          if (!flowReach(cust) && askFirst(qg.step)) makePending(c, qg, { kind: 'quoteFollow', token: rec.share.token });
          else if (!flowReach(cust)) await sendOnce(qg, 'followed', { token: rec.share.token }, () => flowTell(ws, rec, cust, flowMsg.quoteFollow(ws, rec, cust, quoteUrlOf(rec)), 'Kloomie'));
          tell(c);
        }
        await invoiceEmail(c, ws, rec);
        // Payment reminders: calendar days past due on the team's clock, from 9am, while a balance remains.
        const pg = stepGoals(c).find((x) => x.step?.kind === 'payment');
        const days = pg?.step.settings?.reminders || [];
        if (pg && days.length && !pg.skipped && !pg.pending && clock.min >= NINE) {
          for (const pi of payInvoices(c, rec)) {
            if (!pi.due || !['sent', 'viewed', 'partial'].includes(pi.status) || !(invoiceTotals(pi).balance > 0)) continue;
            const reached = days.filter((d) => addDays(pi.due, d) <= clock.today);
            if (!reached.length) continue;
            pg.reminded ||= {};
            const hist = (pg.reminded[pi.id] ||= {});
            const last = reached.at(-1);
            if (hist[last]) continue;
            for (const d of reached.slice(0, -1)) hist[d] ||= { state: 'passed', at: Date.now() };
            const cust = customerOf(rec);
            if (flowReach(cust)) continue;
            if (askFirst(pg.step)) { makePending(c, pg, { kind: 'payReminder', invoiceId: pi.id, day: last }); break; }
            await sendOnce(hist, String(last), {}, () => flowTell(ws, rec, cust, flowMsg.payReminder(ws, rec, cust, pi, invoiceUrl(pi), invoiceTotals(pi).balance), 'Kloomie'));
            tell(c);
          }
        }
      }
    } finally { msgBusy = false; }
  }

  // ---------- automatic billing (PHASE2.md §1.4) ----------
  // Each going run on an automatic-billing flow whose Invoice step has come up: make its invoice once (as the run's
  // owner, kept before sending), then send it through the same path as the app, the rules' hold included. Waiting
  // states (held, $0, owner can't send, refused) never retry by themselves. Answers whether anything changed.
  function autoBill(wsId) {
    const ws = db.workspaces[wsId];
    if (!ws || !makeInvoice || !sendInvoice) return false;
    let changed = false;
    // When each run's current step came up in this cycle (a Review request's delay counts from then).
    for (const c of Object.values(db.campaigns)) {
      if (c.wsId !== wsId || !isJobRun(c) || c.status !== 'active') continue;
      const cur = currentGoal(c);
      if (cur && cur.currentCycle !== (cur.reopens || 0)) { cur.currentSince = Date.now(); cur.currentCycle = cur.reopens || 0; changed = true; }
    }
    const setAuto = (g, a) => { if (JSON.stringify(g.auto || null) !== JSON.stringify(a)) { g.auto = a; changed = true; } };
    for (const c of Object.values(db.campaigns)) {
      if (c.wsId !== wsId || !isJobRun(c) || c.status !== 'active' || billingOf(versionOf(c)?.body) !== 'auto') continue;
      const rec = recOf(c);
      const g = stepGoals(c).find((x) => x.step?.kind === 'invoice');
      if (!rec || !g || g.skipped || currentGoal(c)?.id !== g.id) continue;
      const owner = memberOf(ws, c.ownerId);
      const ownerOk = !!owner && isAdmin({ role: owner.role });
      const as = owner && { member: owner.name, memberId: owner.id, role: owner.role, wsId: ws.id };
      let inv = g.invoiceId && db.invoices?.[g.invoiceId];
      if (inv && inv.status === 'void') inv = null;
      if (!inv) {
        if (g.auto && g.auto.state !== 'owner') setAuto(g, null);
        if (!ownerOk) { setAuto(g, { state: 'owner', invoiceId: null, at: Date.now() }); continue; }
        inv = makeInvoice(ws, as, rec, typeOfRec(rec), g.step.id, versionOf(c)?.body?.dueDays ?? null);
        g.invoiceId = inv.id;
        setAuto(g, { state: 'made', invoiceId: inv.id, at: Date.now() });
        save(); // kept before the send: a crash or restart from here finds this invoice and sends it
      }
      if (inv.sentAt) { setAuto(g, { state: 'sent', invoiceId: inv.id, at: g.auto?.at || Date.now() }); continue; }
      if (g.auto?.state !== 'made' || g.auto.invoiceId !== inv.id) continue; // a draft made by hand, or one that waits
      if (!ownerOk) { setAuto(g, { state: 'owner', invoiceId: inv.id, at: Date.now() }); continue; }
      if (!(itemsTotals(inv.lines).total > 0)) { setAuto(g, { state: 'zero', invoiceId: inv.id, at: Date.now() }); continue; }
      if (FAIL_SEND) continue;
      const out = sendInvoice(ws, as, inv);
      if (out.status === 200) setAuto(g, { state: 'sent', invoiceId: inv.id, at: Date.now() });
      else if (out.status === 202) setAuto(g, { state: 'held', invoiceId: inv.id, at: Date.now(), approvalId: out.body?.approval?.id || null });
      else setAuto(g, { state: 'refused', invoiceId: inv.id, at: Date.now(), reason: String(out.body?.error || 'It couldn’t be sent.').slice(0, 300) });
      tell(c);
    }
    if (changed) save();
    return changed;
  }
  // An invoice changed: an automatic Invoice step follows its bound invoice, whatever sent it (the sweep, the app by
  // hand, an approval's replay); voiding it lets the next sweep make one replacement.
  function invoiceNews(inv) {
    for (const g of Object.values(db.goals)) {
      if (g.kind !== 'step' || g.step?.kind !== 'invoice' || g.wsId !== inv.wsId || (g.invoiceId !== inv.id && g.auto?.invoiceId !== inv.id)) continue;
      const c = db.campaigns[g.campaignId];
      if (!isJobRun(c) || billingOf(versionOf(c)?.body) !== 'auto') continue;
      if (inv.status === 'void') { g.auto = null; if (g.invoiceId === inv.id) g.invoiceId = null; }
      else if (inv.sentAt && g.auto?.state !== 'sent') g.auto = { state: 'sent', invoiceId: inv.id, at: Date.now() };
      else continue;
      save();
      tell(c);
    }
  }
  // The due days for an invoice made on a job: its going run's flow's, else none (the invoice's own default).
  const dueDaysFor = (rec) => { const v = versionOf(activeRun(rec.id))?.body; return Number.isInteger(v?.dueDays) ? v.dueDays : null; };
  // For the quote link on a job (projects.js): is it on a going run, and does that run have a quote step.
  const jobQuote = (rec) => { const c = rec && activeRun(rec.id); return c ? { onRun: true, quoteStep: stepGoals(c).some((g) => g.step?.kind === 'quote') } : null; };

  // Job deleted: its runs and their steps go; the steps' tasks stay as plain tasks.
  function dropFor(rec) {
    for (const c of runsOf(rec.id)) {
      for (const g of Object.values(db.goals)) if (g.campaignId === c.id) {
        for (const t of Object.values(db.tasks)) if (t.goalId === g.id) t.goalId = null;
        delete db.goals[g.id];
      }
      delete db.campaigns[c.id];
    }
  }

  return { route, stepMet, activeRun, isJobRun, isJobList, runsOf, bindInvoice, dropFor, tell, runView, autoBill, autoMessages, invoiceNews, dueDaysFor, jobQuote, priceListItems, itemPrice };
}
