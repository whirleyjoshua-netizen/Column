// Invoices: billing a customer for a job, and getting paid. An invoice is made from a job (its price lines, or its
// value), numbered for the team (INV-1001, INV-1002…), and sent as a link of its own: /i/<token>. The customer
// reads it there and, when the team has connected its own Stripe account, pays by card. Cash and checks are
// recorded by hand. Sending moves the job to Invoiced; paying it in full moves it to Paid, and every payment is
// money in on the team's Finance. Only owners and admins see invoices and what a job cost.
//
// Card payments go to the team's own Stripe account, never Kloomie's: the team pastes a secret (or restricted) key,
// kept sealed, and each Pay now opens a Stripe Checkout page made with it. Coming back from Checkout records the
// payment; a check every few minutes catches anyone who paid and closed the tab.
import crypto from 'node:crypto';
import { isDay } from './dates.js';

const STATUSES = ['draft', 'sent', 'viewed', 'partial', 'paid', 'void'];
const METHODS = ['cash', 'check', 'card', 'bank', 'other'];
const DUE_DAYS = 14;
const CHECK_MS = Number(process.env.INVOICE_CHECK_MS) || 5 * 60_000;

export function invoicesModule({ onInvoice = () => {}, bindInvoice = () => {}, flowDueDays = () => null, proofUrl = () => null, stockCost = () => 0, jobMoney = () => ({ expenses: 0, income: 0, committed: 0, entries: [] }), jobBack = () => {}, onPaymentGone = () => {}, notifyAdmins = null, db, save, broadcast, rid, hold = null, cleanText, readJson, send, badRequest, escHtml, brandOf, logoUrl, teamDay, offline, seal, unseal, stripeCall, PJ, isAdmin, jobOfRecord, jobLabel, moveJob, addMoney, dropMoneyId, publicUrl, emit = () => {} }) {
  db.invoices ||= {};
  db.payKeys ||= {};
  const money = (c) => ((c || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const day = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  // ---------- the numbers ----------
  const totals = (inv) => {
    const t = PJ.itemsTotals(inv.lines);
    const paid = inv.payments.reduce((n, x) => n + x.amount, 0);
    return { subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total, paid, balance: Math.max(0, t.total - paid) };
  };
  const overdue = (inv) => !!inv.due && ['sent', 'viewed', 'partial'].includes(inv.status) && inv.due < teamDay(inv.wsId);
  const publicInvoice = ({ wsId, sessions, ...x }) => ({ ...x, ...totals({ ...x }), overdue: overdue({ wsId, ...x }), url: x.token ? `${publicUrl}/i/${x.token}` : null });
  const news = (inv) => {
    inv.updatedAt = Date.now();
    broadcast(inv.wsId, { type: 'invoice', invoice: publicInvoice(inv), projectId: inv.projectId, forAdmins: true });
    onInvoice(inv); // a job's flow steps that read invoices look again (Job Flows)
  };
  // An invoice as other apps see it (the API and webhooks): dollars, plain names, ISO times.
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  const d$ = (c) => Math.round(c || 0) / 100;
  function apiInvoice(inv) {
    const t = totals(inv);
    return { id: inv.id, number: inv.number, job_id: inv.recordId, title: inv.title, status: inv.status, overdue: overdue(inv), issued: inv.issued || null, due: inv.due || null,
      customer: { contact_id: inv.to.contactId || null, name: inv.to.name, email: inv.to.email, phone: inv.to.phone, address: inv.to.address },
      lines: inv.lines.rows.map((r) => ({ description: r.desc, qty: r.qty, unit: r.unit, price: d$(r.price), total: d$(Math.round(r.qty * r.price)), ...(r.taxable === false ? { taxable: false } : {}) })),
      tax_rate: inv.lines.taxRate || 0, subtotal: d$(t.subtotal), discount: d$(t.discount), tax: d$(t.tax), total: d$(t.total), paid: d$(t.paid), balance: d$(t.balance),
      payments: inv.payments.map((x) => ({ id: x.id, amount: d$(x.amount), method: x.method, note: x.note, date: x.day, by: x.by })),
      note: inv.note || '', url: inv.token ? `${publicUrl}/i/${inv.token}` : null,
      created_at: iso(inv.createdAt), updated_at: iso(inv.updatedAt || inv.createdAt), sent_at: iso(inv.sentAt), paid_at: iso(inv.paidAt) };
  }

  // Line items in the same shape as a job's price lines: { rows: [{ desc, qty, unit, price }], taxRate, discount }.
  function cleanLines(v) {
    const rows = (Array.isArray(v?.rows) ? v.rows : []).slice(0, 200).map((r) => {
      const qty = Number(String(r?.qty ?? 1).replace(/[,\s]/g, ''));
      const price = r?.price_cents != null ? Math.round(Number(r.price_cents)) : Math.round(Number(String(r?.price ?? 0).replace(/[$,\s]/g, '')) * 100);
      return { id: typeof r?.id === 'string' && /^[\w-]{1,24}$/.test(r.id) ? r.id : rid(6), desc: cleanText(r?.desc, 500), qty: Number.isFinite(qty) ? Math.max(-1e6, Math.min(1e6, qty)) : 1, unit: cleanText(r?.unit, 20),
        price: Number.isFinite(price) ? Math.max(-1e10, Math.min(1e10, price)) : 0, ...(r?.taxable === false ? { taxable: false } : {}) };
    }).filter((r) => r.desc || r.price);
    const tax = Number(v?.taxRate ?? 0);
    const out = { rows, taxRate: Number.isFinite(tax) ? Math.max(0, Math.min(100, tax)) : 0 };
    const d = v?.discount;
    const dv = Number(d?.value);
    if (d && Number.isFinite(dv) && dv > 0) out.discount = d.type === 'percent' ? { type: 'percent', value: Math.min(100, dv) } : { type: 'amount', value: Math.round(d.cents ? dv : dv * 100) };
    return out;
  }
  // Who it's to: the job's customer, as they were when it was made (the invoice keeps saying who it was sent to).
  function customerOf(rec, t) {
    const cf = t.fields.find((f) => f.type === 'contact' && rec.values[f.id]);
    const c = cf && db.contacts[rec.values[cf.id]];
    const af = t.fields.find((f) => f.key === 'address');
    return { contactId: c?.id || null, name: c?.name || c?.company || '', email: c?.email || '', phone: c?.phone || '', address: (af && rec.values[af.id]) || [c?.address, c?.city].filter(Boolean).join(', ') };
  }
  function newInvoice(ws, auth, rec, t, dueDays = null) {
    const items = t.fields.find((f) => f.type === 'items' && rec.values[f.id]?.rows?.length);
    const value = t.fields.find((f) => f.key === 'value' && f.type === 'money');
    const lines = items ? { rows: rec.values[items.id].rows.map(({ cost, from, ...r }) => ({ ...r, id: rid(6) })), taxRate: rec.values[items.id].taxRate || 0, ...(rec.values[items.id].discount ? { discount: rec.values[items.id].discount } : {}) }
      : { rows: [{ id: rid(6), desc: String(rec.values[t.primary] || t.singular || 'Job'), qty: 1, unit: '', price: (value && rec.values[value.id]) || 0 }], taxRate: 0 };
    ws.invoiceNext ||= 1001;
    const today = teamDay(ws.id);
    return { id: rid(), wsId: ws.id, recordId: rec.id, projectId: rec.projectId, number: `INV-${ws.invoiceNext++}`, title: jobLabel(rec), status: 'draft', lines, due: addDays(today, Number.isInteger(dueDays) ? dueDays : DUE_DAYS), issued: today, note: '',
      to: customerOf(rec, t), token: null, by: auth.member, createdAt: Date.now(), sentAt: null, viewedAt: null, paidAt: null, payments: [], sessions: [] };
  }
  // Where it stands after a payment comes or goes. Paid in full moves the job to Paid.
  function settle(inv, who) {
    if (inv.status === 'void') return;
    const { paid, balance, total } = totals(inv);
    const was = inv.status;
    inv.status = paid > 0 && balance <= 0 && total > 0 ? 'paid' : paid > 0 ? 'partial' : inv.viewedAt ? 'viewed' : inv.sentAt ? 'sent' : 'draft';
    inv.paidAt = inv.status === 'paid' ? inv.paidAt || Date.now() : null;
    const rec = db.records[inv.recordId];
    if (rec && was === 'paid' && inv.status !== 'paid') jobBack(rec); // G14
    if (inv.status === 'paid' && was !== 'paid') setImmediate(() => emit(inv.wsId, 'invoice.paid', apiInvoice(inv), who));
    if (rec && inv.status === 'paid' && was !== 'paid') {
      moveJob(rec, 'Paid');
      PJ.recordActivity(rec.id, { kind: 'quote', what: 'invoice paid', note: `${inv.number} · ${money(total)}`, by: who });
    }
    onInvoice(inv);
  }
  function removePayment(inv, p, by) {
    inv.payments = inv.payments.filter((x) => x !== p);
    if (p.moneyId) dropMoneyId(p.moneyId);
    settle(inv, by);
    save();
    news(inv);
  }
  function addPayment(inv, { amount, method, note, day: on, by, session = null }) {
    const ws = db.workspaces[inv.wsId];
    if (!session) closeSessions(inv).catch(() => {});
    const p = { id: rid(), amount, method, note: note || '', day: on || teamDay(inv.wsId), by, at: Date.now(), ...(session ? { session } : {}) };
    p.moneyId = addMoney(ws, { invoiceId: inv.id, amount, day: p.day, note: `${inv.number}${inv.to.name ? ' · ' + inv.to.name : ''}${method === 'card' ? ' (card)' : ''}` });
    inv.payments.push(p);
    settle(inv, by);
    save();
    news(inv);
    emit(inv.wsId, 'payment.received', { invoice_id: inv.id, invoice_number: inv.number, job_id: inv.recordId, payment: { id: p.id, amount: d$(p.amount), method: p.method, note: p.note, date: p.day, by: p.by }, invoice: apiInvoice(inv) }, by);
    return p;
  }

  const paying = new Set(); // invoices whose card page is being opened right now (one at a time)
  // ---------- the team's Stripe account ----------
  const keyOf = (wsId) => { const k = db.payKeys[wsId]; try { return k ? unseal(k.key).key : null; } catch { return null; } };
  const payInfo = (wsId) => { const k = db.payKeys[wsId]; return k ? { connected: true, account: k.account, live: k.live, at: k.at, by: k.by } : { connected: false }; };

  // Only one card page can be open for an invoice, for what's owed right now. When what's owed changes (a payment is
  // recorded, the lines change, it's voided) the open page is closed in Stripe, so an old one can't be paid as well.
  async function closeSessions(inv, keep = null) {
    const key = keyOf(inv.wsId);
    if (!key) return;
    for (const s of inv.sessions || []) {
      if (s.done || s.id === keep) continue;
      try {
        const cs = await stripeCall(key, 'POST', `/checkout/sessions/${encodeURIComponent(s.id)}/expire`, {});
        if (cs.status === 'expired') s.done = true;
      } catch {
        // Already paid or already closed: checking it records a payment if there was one.
        await checkSession(inv, s.id).catch(() => {});
        if (!s.done) s.done = true;
      }
    }
    save();
  }
  // A Checkout session that came back paid becomes a payment, once.
  async function checkSession(inv, sid) {
    const s = inv.sessions.find((x) => x.id === sid);
    const key = keyOf(inv.wsId);
    if (!s || s.done || !key) return false;
    const cs = await stripeCall(key, 'GET', `/checkout/sessions/${encodeURIComponent(sid)}`);
    if (cs.payment_status !== 'paid') {
      if (cs.status === 'expired') { s.done = true; save(); }
      return false;
    }
    s.done = true;
    if (!inv.payments.some((x) => x.session === sid)) {
      const amount = cs.amount_total ?? s.amount;
      const owed = totals(inv).balance;
      addPayment(inv, { amount, method: 'card', note: 'Paid online', by: inv.to.name ? `${inv.to.name} (customer)` : 'Customer', session: sid });
      // The card was charged more than was owed (it shouldn't happen any more, but if it does the team must know).
      if (amount > owed) {
        inv.overpaid = (inv.overpaid || 0) + (amount - owed);
        save();
        notifyAdmins?.(inv.wsId, { title: `${inv.number} was paid ${money(amount - owed)} too much`, text: 'Refund the difference in your Stripe dashboard.', kind: 'invoice', key: 'overpaid:' + inv.id + ':' + sid });
      }
    }
    broadcast(inv.wsId, { type: 'invoice:paid', invoiceId: inv.id, recordId: inv.recordId, projectId: inv.projectId, number: inv.number, amount: cs.amount_total ?? s.amount, name: inv.to.name, forAdmins: true });
    return true;
  }
  async function checkAll() {
    for (const inv of Object.values(db.invoices)) {
      if (offline(inv.wsId)) continue;
      for (const s of inv.sessions || []) {
        if (s.done) continue;
        if (Date.now() - s.at > 25 * 3600_000) { s.done = true; save(); continue; }
        await checkSession(inv, s.id).catch(() => {});
      }
    }
  }
  setInterval(() => checkAll().catch(() => {}), CHECK_MS).unref?.();

  // ---------- what a job cost: labor from its visits, materials, and what it's billed at ----------
  function costing(ws, rec) {
    const j = jobOfRecord(rec);
    if (!j) return null;
    const { t } = j;
    const invs = Object.values(db.invoices).filter((x) => x.recordId === rec.id && x.status !== 'void');
    const billed = invs.reduce((n, x) => n + totals(x).total, 0);
    const paid = invs.reduce((n, x) => n + totals(x).paid, 0);
    const items = t.fields.find((f) => f.type === 'items' && rec.values[f.id]?.rows?.length);
    const quoted = items ? PJ.itemsTotals(rec.values[items.id]) : null;
    const value = t.fields.find((f) => f.key === 'value' && f.type === 'money');
    const price = billed || quoted?.total || (value && rec.values[value.id]) || 0;
    const mf = t.fields.find((f) => f.type === 'materials');
    const mats = ((mf && rec.values[mf.id]?.rows) || []).reduce((n, r) => n + Math.round((r.qty || 0) * (r.cost || 0)), 0);
    // Stock used on the job from Inventory counts too (at what it cost when it was used).
    const stock = stockCost(rec.id) || 0;
    // Actual and estimated are kept apart (Finance step 4): what the price lines say things will cost is the
    // estimate; materials are only what was really used (the materials list and stock), never the estimate.
    const materials = mats + stock;
    const estimatedCost = quoted?.cost || 0;
    // Labor: each done visit's length, for each person on it, at their own rate (or the team's).
    const rates = ws.laborRates || {};
    const rate = ws.laborRate || 0;
    let minutes = 0, labor = 0, unpriced = 0;
    const seen = new Map();
    for (const e of Object.values(db.entries)) if (e.recordId === rec.id && e.visitId) (seen.get(e.visitId) || seen.set(e.visitId, []).get(e.visitId)).push(e);
    let visits = 0;
    for (const list of seen.values()) {
      if (!list.every((e) => e.done)) continue;
      visits++;
      const e = list[0];
      if (!(e.start != null && e.end != null && e.end > e.start)) continue;
      const len = e.end - e.start;
      for (const x of list) {
        minutes += len;
        const r = rates[x.memberId] || rate;
        if (r) labor += Math.round((len / 60) * r); else unpriced += len;
      }
    }
    // Money from Finance put on this job (receipts, fuel, a sub's bill…), and what's on order for it, not in yet.
    const fin = jobMoney(rec.id);
    const direct = materials + labor + fin.expenses;
    const overheadPct = ws.overheadPct || 0;
    const overhead = Math.round((direct * overheadPct) / 100);
    const cost = direct + overhead;
    const hasActual = direct > 0;
    const pct = (n) => (price ? Math.round((n / price) * 1000) / 10 : 0);
    return { expenses: fin.expenses, income: fin.income, received: paid + fin.income, committed: fin.committed, entries: fin.entries, price, billed, paid,
      quoted: quoted?.total || 0, materials, fromStock: stock, hours: Math.round((minutes / 60) * 100) / 100, unpricedHours: Math.round((unpriced / 60) * 100) / 100, visits, laborRate: rate, labor, overheadPct, overhead, cost,
      hasActual, margin: hasActual ? price - cost : null, marginPct: hasActual ? pct(price - cost) : null,
      estimatedCost, estimatedMargin: estimatedCost ? price - estimatedCost : null, estimatedMarginPct: estimatedCost ? pct(price - estimatedCost) : null,
      rates: { team: rate, people: rates, overheadPct } };
  }

  // ---------- the app's routes: /api/records/:id/invoices, /api/records/:id/costing, /api/invoices/…, /api/payments/stripe ----------
  // Making an invoice for a job (the app's button, and a Job Flow's automatic Invoice step): numbered, from the job's
  // lines, bound to the run's step when one is named, kept and told.
  function makeFor(ws, auth, rec, t, jobStep = null, dueDays = null) {
    const inv = newInvoice(ws, auth, rec, t, Number.isInteger(dueDays) ? dueDays : flowDueDays(rec));
    db.invoices[inv.id] = inv;
    // Made from a job's Invoice step: that step reads this invoice (Job Flows, CONTRACTS.md §1.5).
    if (jobStep) bindInvoice(rec, inv, jobStep);
    save();
    news(inv);
    emit(ws.id, 'invoice.created', apiInvoice(inv), auth.member);
    return inv;
  }
  // Sending: the customer's link, and the job moves to Invoiced. One path for the app, the API, an approval's replay
  // and a Job Flow's automatic Invoice step, so the rules' hold is the same for all of them. Answers { status, body }.
  function sendIt(ws, auth, inv) {
    if (inv.status === 'void') return { status: 400, body: { error: 'This invoice was voided.' } };
    if (totals(inv).total <= 0) return { status: 400, body: { error: 'Add what you’re billing for first: the total is $0.' } };
    if (!inv.sentAt) {
      const held = hold?.(ws, auth, 'invoice', { amount: totals(inv).total / 100, summary: `Send ${inv.number} for ${money(totals(inv).total)} to ${inv.to.name || 'the customer'}`, target: { invoiceId: inv.id, recordId: inv.recordId }, req: { method: 'POST', path: `/api/invoices/${inv.id}/send`, body: {} } });
      if (held) return held;
    }
    const rec = db.records[inv.recordId];
    inv.token ||= crypto.randomBytes(18).toString('base64url');
    const first = !inv.sentAt;
    if (!inv.sentAt) {
      inv.sentAt = Date.now();
      inv.issued = teamDay(ws.id);
      if (rec) {
        moveJob(rec, 'Invoiced');
        PJ.recordActivity(rec.id, { kind: 'quote', what: 'invoice sent', note: `${inv.number} · ${money(totals(inv).total)}${inv.due ? ' · due ' + day(inv.due) : ''}`, by: auth.member });
      }
    }
    settle(inv, auth.member);
    save();
    news(inv);
    if (first) emit(ws.id, 'invoice.sent', apiInvoice(inv), auth.member);
    return { status: 200, body: publicInvoice(inv) };
  }
  async function route(req, res, parts, auth, ws) {
    const [a, b, c, d] = parts;
    const m = req.method;
    const isOurs = (a === 'records' && (c === 'invoices' || c === 'costing')) || a === 'invoices' || (a === 'payments' && b === 'stripe');
    if (!isOurs) return null;
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins see invoices and what jobs cost.' });

    if (a === 'payments') {
      if (m === 'GET') return send(res, 200, payInfo(ws.id));
      if (m === 'DELETE') { delete db.payKeys[ws.id]; save(); broadcast(ws.id, { type: 'payments', payments: payInfo(ws.id), forAdmins: true }); return send(res, 200, payInfo(ws.id)); }
      if (m === 'PUT') {
        const body = await readJson(req, 5_000);
        const key = String(body.key || '').trim();
        if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(key)) return send(res, 400, { error: 'Paste a Stripe secret key: it starts with sk_live_ (or rk_live_ for a restricted key).' });
        let acct;
        try { acct = await stripeCall(key, 'GET', '/account'); } catch (e) { return send(res, 400, { error: 'Stripe didn’t accept that key: ' + e.message }); }
        const account = acct.settings?.dashboard?.display_name || acct.business_profile?.name || acct.email || acct.id || 'Stripe account';
        db.payKeys[ws.id] = { wsId: ws.id, key: seal({ key }), account: cleanText(account, 120), live: key.includes('_live_'), at: Date.now(), by: auth.member };
        save();
        broadcast(ws.id, { type: 'payments', payments: payInfo(ws.id), forAdmins: true });
        return send(res, 200, payInfo(ws.id));
      }
      return send(res, 405, { error: 'Method not allowed' });
    }

    if (a === 'records') {
      const at = PJ.recordAt(b, ws.id, auth.memberId);
      const j = at && jobOfRecord(at.rec);
      if (!j) return send(res, 404, { error: 'That job is gone.' });
      const rec = at.rec;
      if (c === 'costing' && m === 'GET') return send(res, 200, costing(ws, rec));
      if (m === 'GET') return send(res, 200, Object.values(db.invoices).filter((x) => x.recordId === rec.id).sort((x, y) => x.createdAt - y.createdAt).map(publicInvoice));
      if (m === 'POST') {
        const body = await readJson(req, 10_000).catch(() => ({}));
        return send(res, 200, publicInvoice(makeFor(ws, auth, rec, j.t, body?.jobStep ? String(body.jobStep) : null)));
      }
      return send(res, 405, { error: 'Method not allowed' });
    }

    // /invoices: every invoice the team has, newest first.
    if (!b) return m === 'GET' ? send(res, 200, Object.values(db.invoices).filter((x) => x.wsId === ws.id).sort((x, y) => y.createdAt - x.createdAt).map(publicInvoice)) : send(res, 405, { error: 'Method not allowed' });
    const inv = db.invoices[b];
    if (!inv || inv.wsId !== ws.id) return send(res, 404, { error: 'That invoice is gone.' });
    const rec = db.records[inv.recordId];
    if (m === 'GET' && !c) return send(res, 200, publicInvoice(inv));
    if (m === 'PATCH' && !c) {
      const body = await readJson(req, 200_000);
      if (inv.status === 'void') return send(res, 400, { error: 'This invoice was voided.' });
      if (body.lines !== undefined) {
        if (inv.payments.length) return send(res, 400, { error: 'This invoice has payments on it, so its lines can’t change. Void it and make a new one.' });
        const lines = cleanLines(body.lines);
        const was = totals(inv).total, next = totals({ ...inv, lines }).total;
        if (inv.sentAt && next > was) {
          const held = hold?.(ws, auth, 'invoice', { amount: next / 100, summary: `Change ${inv.number} (already sent) from ${money(was)} to ${money(next)} for ${inv.to.name || 'the customer'}`, target: { invoiceId: inv.id, recordId: inv.recordId }, req: { method: 'PATCH', path: req.url, body } });
          if (held) return send(res, held.status, held.body);
        }
        inv.lines = lines;
        closeSessions(inv).catch(() => {});
      }
      if (body.due !== undefined) inv.due = isDay(body.due) ? body.due : null;
      if (body.note !== undefined) inv.note = String(body.note || '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
      if (body.title !== undefined) inv.title = cleanText(body.title, 200) || inv.title;
      if (body.to && typeof body.to === 'object') for (const k of ['name', 'email', 'phone', 'address']) if (body.to[k] !== undefined) inv.to[k] = cleanText(body.to[k], k === 'address' ? 300 : 120);
      settle(inv, auth.member);
      save();
      news(inv);
      return send(res, 200, publicInvoice(inv));
    }
    // Sending: the customer's link, and the job moves to Invoiced.
    if (c === 'send' && m === 'POST') {
      const out = sendIt(ws, auth, inv);
      return send(res, out.status, out.body);
    }
    if (c === 'void' && m === 'POST') {
      if (inv.payments.length) return send(res, 400, { error: 'Remove its payments first: a paid invoice can’t be voided.' });
      inv.status = 'void';
      closeSessions(inv).catch(() => {});
      save();
      news(inv);
      emit(ws.id, 'invoice.voided', apiInvoice(inv), auth.member);
      return send(res, 200, publicInvoice(inv));
    }
    if (c === 'payments' && m === 'POST' && !d) {
      if (inv.status === 'void') return send(res, 400, { error: 'This invoice was voided.' });
      const body = await readJson(req, 5_000);
      const amount = Math.round(Number(String(body.amount ?? '').replace(/[$,\s]/g, '')) * 100);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e11) return send(res, 400, { error: 'Enter the amount paid, like 250.00' });
      if (amount > totals(inv).balance) return send(res, 400, { error: `That’s more than the ${money(totals(inv).balance)} still owed.` });
      const on = isDay(body.day) ? body.day : null;
      addPayment(inv, { amount, method: METHODS.includes(body.method) ? body.method : 'other', note: cleanText(body.note, 200), day: on, by: auth.member });
      return send(res, 200, publicInvoice(inv));
    }
    if (c === 'payments' && m === 'DELETE' && d) {
      const p = inv.payments.find((x) => x.id === d);
      if (!p) return send(res, 404, { error: 'That payment is gone.' });
      if (p.session) return send(res, 400, { error: 'A card payment is refunded in your Stripe dashboard, not removed here.' });
      if (p.ref?.startsWith('qbo:')) return send(res, 400, { error: 'This payment came from QuickBooks. Remove it there, and it goes from here too.' });
      removePayment(inv, p, auth.member);
      if (p.qbo) onPaymentGone(ws, inv, p);
      return send(res, 200, publicInvoice(inv));
    }
    if (m === 'DELETE' && !c) {
      if (inv.status !== 'draft') return send(res, 400, { error: 'Only a draft can be deleted. Void a sent invoice instead.' });
      delete db.invoices[inv.id];
      save();
      broadcast(ws.id, { type: 'invoice:remove', id: inv.id, recordId: inv.recordId, projectId: inv.projectId, forAdmins: true });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  // A job deleted takes its draft invoices; sent ones stay, as a record of what was billed.
  function dropFor(rec) {
    for (const inv of Object.values(db.invoices)) if (inv.recordId === rec.id && inv.status === 'draft') delete db.invoices[inv.id];
  }

  // ---------- the customer's page: /i/<token> ----------
  const invoiceFor = (token) => {
    if (!token || token.length < 20) return null;
    const inv = Object.values(db.invoices).find((x) => x.token === token);
    return inv && !offline(inv.wsId) && inv.status !== 'draft' ? inv : null;
  };
  async function page(req, res, url) {
    const [, token, act] = url.pathname.split('/').filter(Boolean);
    for (const [k, v] of Object.entries({ 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' })) res.setHeader(k, v);
    const inv = invoiceFor(token);
    if (!inv) return html(res, 404, null, '<h1>Invoice not available</h1><p class="muted">This link was turned off. Contact whoever sent it.</p>');
    const ws = db.workspaces[inv.wsId];
    const key = keyOf(inv.wsId);
    // Pay now: a Stripe Checkout page for what's still owed, in the team's own Stripe account.
    if (req.method === 'POST' && act === 'pay') {
      const { balance } = totals(inv);
      if (!key || balance <= 0 || inv.status === 'void') { res.writeHead(303, { Location: `/i/${token}` }); return res.end(); }
      const back = `${publicUrl}/i/${token}`;
      if (paying.has(inv.id)) { res.writeHead(303, { Location: `/i/${token}` }); return res.end(); }
      paying.add(inv.id);
      try {
        const open = (inv.sessions || []).filter((x) => !x.done);
        for (const s of open) {
          const cur = await stripeCall(key, 'GET', `/checkout/sessions/${encodeURIComponent(s.id)}`).catch(() => null);
          if (cur?.payment_status === 'paid') { await checkSession(inv, s.id); res.writeHead(303, { Location: `/i/${token}?paid=${encodeURIComponent(s.id)}` }); return res.end(); }
          if (cur?.status === 'open' && s.amount === balance && cur.url) { res.writeHead(303, { Location: cur.url }); return res.end(); }
        }
        await closeSessions(inv);
        if (totals(inv).balance !== balance || inv.status === 'void') { res.writeHead(303, { Location: `/i/${token}` }); return res.end(); }
        const cs = await stripeCall(key, 'POST', '/checkout/sessions', {
          mode: 'payment', success_url: `${back}?paid={CHECKOUT_SESSION_ID}`, cancel_url: back,
          'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(balance),
          'line_items[0][price_data][product_data][name]': `${inv.number} · ${ws.name}`.slice(0, 250),
          'metadata[kloomie_invoice]': inv.id, 'payment_intent_data[metadata][kloomie_invoice]': inv.id, 'payment_intent_data[description]': `${inv.number} · ${inv.title}`.slice(0, 500),
          ...(inv.to.email ? { customer_email: inv.to.email } : {}),
        });
        inv.sessions.push({ id: cs.id, amount: balance, at: Date.now() });
        inv.sessions = inv.sessions.slice(-20);
        save();
        res.writeHead(303, { Location: cs.url });
        return res.end();
      } catch (e) {
        return html(res, 502, ws, `<h1>Couldn’t start the payment</h1><p class="muted">The card payment page didn’t open (${escHtml(e.message)}). Try again in a minute, or contact ${escHtml(ws.name)}.</p><p><a href="/i/${token}">Back to the invoice</a></p>`);
      } finally {
        paying.delete(inv.id);
      }
    }
    if (act) return html(res, 404, null, '<h1>Not found</h1>');
    let thanks = false;
    const paidId = url.searchParams.get('paid');
    if (paidId) thanks = await checkSession(inv, paidId).catch(() => false) || inv.payments.some((x) => x.session === paidId);
    // Opening it marks a sent invoice viewed.
    if (inv.status === 'sent') {
      inv.viewedAt = Date.now();
      inv.status = 'viewed';
      save();
      news(inv);
    }
    return html(res, 200, ws, body(inv, ws, token, !!key, thanks));
  }
  function body(inv, ws, token, canPay, thanks) {
    const tot = totals(inv);
    const brand = brandOf(ws);
    const lines = inv.lines.rows.map((r) => `<tr><td>${escHtml(r.desc)}</td><td class="n">${escHtml(String(r.qty))}${r.unit ? ' ' + escHtml(r.unit) : ''}</td><td class="n">${money(r.price)}</td><td class="n">${money(Math.round(r.qty * r.price))}</td></tr>`).join('');
    const paidRows = inv.payments.map((p) => `<div><span>Paid ${day(p.day)}${p.method === 'card' ? ' by card' : p.method === 'check' ? ' by check' : p.method === 'cash' ? ' in cash' : ''}</span><span>−${money(p.amount)}</span></div>`).join('');
    const state = inv.status === 'void' ? '<div class="done">This invoice was cancelled. Nothing is owed on it.</div>'
      : tot.balance <= 0 ? `<div class="done ok">✓ Paid in full${inv.paidAt ? ' on ' + new Date(inv.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}. Thank you!</div>`
      : canPay ? `<form class="pay" method="post" action="/i/${token}/pay"><button>Pay ${money(tot.balance)} by card</button><small class="muted">You’ll pay on a secure Stripe page.</small></form>`
      : `<div class="done">${money(tot.balance)} due${inv.due ? ' by ' + day(inv.due) : ''}. Contact ${escHtml(ws.name)} to pay.</div>`;
    return `${thanks ? '<div class="done ok top">✓ Thank you, your payment went through.</div>' : ''}
      <header>${brand.logo ? `<img class="brand" src="${logoUrl(brand.logo)}" alt="">` : ''}<div><b>${escHtml(ws.name)}</b></div></header>
      <h1>Invoice ${escHtml(inv.number)}</h1>
      <div class="meta"><span>${escHtml(inv.title)}</span>${inv.issued ? `<span>Issued ${day(inv.issued)}</span>` : ''}${inv.due && tot.balance > 0 && inv.status !== 'void' ? `<span class="${overdue(inv) ? 'late' : ''}">Due ${day(inv.due)}</span>` : ''}</div>
      ${inv.to.name || inv.to.address ? `<div class="to"><small>Bill to</small><b>${escHtml(inv.to.name)}</b>${[inv.to.address, inv.to.email, inv.to.phone].filter(Boolean).map((x) => `<div>${escHtml(x)}</div>`).join('')}</div>` : ''}
      <table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${lines || '<tr><td colspan="4" class="muted">No lines.</td></tr>'}</tbody></table>
      <div class="sums"><div><span>Subtotal</span><span>${money(tot.subtotal)}</span></div>${tot.discount ? `<div><span>Discount</span><span>−${money(tot.discount)}</span></div>` : ''}${inv.lines.taxRate ? `<div><span>Tax (${inv.lines.taxRate}%)</span><span>${money(tot.tax)}</span></div>` : ''}<div class="total"><span>Total</span><span>${money(tot.total)}</span></div>${paidRows}${inv.payments.length ? `<div class="total"><span>Balance</span><span>${money(tot.balance)}</span></div>` : ''}</div>
      ${inv.note ? `<div class="terms"><small>Note</small><p>${escHtml(inv.note).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${state}${(() => { const u = proofUrl(ws); return u ? `<p class="proof" style="text-align:center;margin-top:22px;font-size:14px"><a href="${escHtml(u)}" rel="noopener">🪪 Our licenses &amp; insurance</a></p>` : ''; })()}`;
  }
  function html(res, code, ws, inner) {
    const accent = ws ? brandOf(ws).accent : null;
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self' https://checkout.stripe.com" });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice</title><style>
:root{color-scheme:light;--text:#16161a;--muted:#6b6b76;--line:#e4e4ea;--accent:${accent || '#5b4ee0'};--soft:#f6f6f8}
*{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px 14px}
main{background:#fff;max-width:760px;margin:0 auto;border-radius:14px;padding:36px 40px;box-shadow:0 10px 40px rgba(0,0,0,.08)}@media(max-width:600px){main{padding:22px 16px}}
header{display:flex;align-items:center;gap:12px;margin-bottom:22px}.brand{max-height:46px;max-width:160px;border-radius:6px}
h1{font-size:26px;margin:0 0 6px}.meta{display:flex;gap:16px;color:var(--muted);font-size:13.5px;margin-bottom:20px;flex-wrap:wrap}.late{color:#b42318;font-weight:600}
.to{background:var(--soft);border-radius:10px;padding:12px 14px;margin-bottom:20px;font-size:14px}.to small,.terms small{display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-size:11px;margin-bottom:2px}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;color:var(--muted);font-weight:600;font-size:12px;border-bottom:2px solid var(--line);padding:8px 6px}td{border-bottom:1px solid var(--line);padding:10px 6px;vertical-align:top}.n{text-align:right;white-space:nowrap}
.sums{margin:14px 0 0 auto;max-width:300px;font-size:14px}.sums div{display:flex;justify-content:space-between;padding:4px 6px}.sums .total{border-top:2px solid var(--text);margin-top:6px;padding-top:8px;font-size:18px;font-weight:700}
.terms{margin-top:26px;font-size:13.5px;color:#333}.terms p{margin:0}
.pay{margin-top:30px;display:flex;flex-direction:column;gap:8px;align-items:stretch;text-align:center}
button{font:inherit;font-size:17px;font-weight:700;background:var(--accent);color:#fff;border:0;border-radius:10px;padding:14px 18px;cursor:pointer}
.done{margin-top:28px;padding:16px;border-radius:12px;background:var(--soft);font-weight:600}.done.ok{background:#e7f8ef;color:#126b3d}.done.top{margin:0 0 22px}.muted{color:var(--muted)}
footer{text-align:center;color:var(--muted);font-size:12px;margin-top:16px}
</style></head><body><main>${inner}</main><footer>Sent with Kloomie</footer></body></html>`);
  }

  return { route, page, dropFor, costing, publicInvoice, apiInvoice, addPayment, removePayment, totals, payInfo, checkAll, makeFor, sendIt, STATUSES, METHODS };
}
