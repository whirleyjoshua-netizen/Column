// QuickBooks Online: a team's invoices and payments copied into its books, and payments recorded in QuickBooks
// coming back. An owner or admin signs in to their QuickBooks company once (Intuit OAuth); after that it runs by itself.
//
// What goes where:
// - An invoice, once it's sent, goes into QuickBooks under the same number (INV-1001), billed to a customer found
//   by name or added. Its lines go in on one service item ("Kloomie services"); sales tax goes in as its own line
//   on a "Sales tax (from Kloomie)" item, so the totals match Kloomie's exactly. Changing its lines before it's paid
//   updates it there; voiding it voids it there.
// - Each payment taken in Kloomie (card, cash, check…) is recorded against it in QuickBooks.
// - A payment recorded in QuickBooks against one of those invoices comes back into Kloomie, so the job moves to
//   Paid and the money shows in Finance.
// - A quote sent from a job (or a Bids & Quotes quote) goes in as an Estimate under its number, the same way. When
//   the customer accepts or declines it, the Estimate is marked Accepted or Rejected; an expired or withdrawn quote
//   is closed. The job's invoice is linked to its Estimate, as QuickBooks does when an estimate becomes an invoice.
// Only invoices made after connecting are copied, unless the team asks for earlier ones too.
//
// It works by looking, not by reacting: every few minutes (and right after an invoice changes) it compares what
// Kloomie has with what it has already copied, and does what's missing. A run that fails halfway just continues
// next time, and an invoice number already in QuickBooks is linked rather than added twice.
import crypto from 'node:crypto';

const env = (k) => process.env[k] || '';
const SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR = '75';
const TICK = Number(env('QBO_TICK_MS')) || 3 * 60_000;
// Asking QuickBooks what changed (payments recorded there) is a metered read for Intuit, so it's done every
// 20 minutes per company, or when someone presses Sync now. Sending Kloomie's own changes isn't metered and
// happens right away.
const PULL = Number(env('QBO_PULL_MS')) || 20 * 60_000;
const ITEM = 'Kloomie services';
const TAX_ITEM = 'Sales tax (from Kloomie)';

export function quickbooksModule({ db, save, broadcast, cleanText, readJson, send, seal, unseal, isAdmin, INV, PJ, publicUrl, alarm, offline, teamDay }) {
  db.qbo ||= {};
  // The company id is kept encrypted, like the tokens (Intuit's rule). Connections from before are moved over.
  const realmOf = (c) => (c.realm ? unseal(c.realm).id : c.realmId);
  for (const c of Object.values(db.qbo)) if (c.realmId) { c.realm = seal({ id: c.realmId }); delete c.realmId; save(); }
  const configured = () => !!(env('QBO_CLIENT_ID') && env('QBO_CLIENT_SECRET'));
  const sandbox = () => env('QBO_ENV') !== 'production';
  const apiBase = () => env('QBO_API') || (sandbox() ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com');
  // Intuit's sign-in addresses come from its discovery document (as Intuit asks), kept for a day; if Intuit can't be
  // reached, the last ones it gave, or these.
  const KNOWN = { auth: 'https://appcenter.intuit.com/connect/oauth2', token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', revoke: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke' };
  const discoveryUrl = () => env('QBO_DISCOVERY_URL') || `https://developer.api.intuit.com/.well-known/${sandbox() ? 'openid_sandbox_configuration' : 'openid_configuration'}`;
  let found = null, foundAt = 0;
  async function endpoints() {
    if (found && Date.now() - foundAt < 24 * 3600_000) return found;
    try {
      const d = await (await fetch(discoveryUrl(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })).json();
      if (d.authorization_endpoint && d.token_endpoint) {
        found = { auth: d.authorization_endpoint, token: d.token_endpoint, revoke: d.revocation_endpoint || KNOWN.revoke };
        foundAt = Date.now();
      }
    } catch (e) {
      console.error('Intuit discovery document unavailable:', e.message);
    }
    return found || KNOWN;
  }
  const authUrl = async () => env('QBO_AUTH_URL') || (await endpoints()).auth;
  const tokenUrl = async () => env('QBO_TOKEN_URL') || (await endpoints()).token;
  const revokeUrl = async () => env('QBO_REVOKE_URL') || (await endpoints()).revoke;
  const redirect = () => `${publicUrl}/oauth/quickbooks/callback`;
  const basic = () => 'Basic ' + Buffer.from(`${env('QBO_CLIENT_ID')}:${env('QBO_CLIENT_SECRET')}`).toString('base64');
  const pending = new Map(); // state -> { wsId, memberId, exp }
  const busy = new Map(); // wsId -> the run in progress
  const soonTimers = new Map();
  const cents = (d) => Math.round(Number(d || 0) * 100);
  const dollars = (c) => Math.round(c) / 100;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // ---------- Intuit sign-in ----------
  async function tokenCall(form) {
    const r = await fetch(await tokenUrl(), { method: 'POST', headers: { Authorization: basic(), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `Intuit said ${r.status}`), { auth: r.status === 400 || r.status === 401 });
    return { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, refreshExp: Date.now() + (j.x_refresh_token_expires_in || 8640000) * 1000 };
  }
  // The access token lasts an hour; refreshing it also hands back a new refresh token, which is kept.
  async function token(c) {
    const t = unseal(c.tokens);
    if (t.exp - Date.now() > 5 * 60_000) return t.access;
    const n = await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh });
    c.tokens = seal({ ...n, refresh: n.refresh || t.refresh });
    save();
    return n.access;
  }

  // ---------- the QuickBooks API ----------
  async function qb(c, method, path, body, retried = false) {
    const url = `${apiBase()}/v3/company/${encodeURIComponent(realmOf(c))}${path}${path.includes('?') ? '&' : '?'}minorversion=${MINOR}`;
    const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + (await token(c)), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    if (r.status === 401 && !retried) {
      const t = unseal(c.tokens);
      c.tokens = seal({ ...t, exp: 0 });
      return qb(c, method, path, body, true);
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.Fault) {
      const e = (j.Fault?.Error || [])[0] || {};
      // Intuit's id for this request, so their support can find it: logged, and shown with the error in Settings.
      const tid = r.headers.get('intuit_tid') || '';
      // Logged without QuickBooks' message, which can hold customers' names: the call, the status, the code, Intuit's ref.
      console.error(`QuickBooks ${method} ${path.split('?')[0].replace(/\/\d+$/, '/…')} → ${r.status}${e.code ? ' code ' + e.code : ''}${tid ? ' intuit_tid ' + tid : ''}`);
      throw Object.assign(new Error(`${e.Detail || e.Message || `QuickBooks said ${r.status}`}${tid ? ` (Intuit ref ${tid})` : ''}`), { code: e.code, status: r.status, tid, auth: r.status === 401 || r.status === 403 });
    }
    return j;
  }
  const query = async (c, sql) => (await qb(c, 'GET', '/query?query=' + encodeURIComponent(sql))).QueryResponse || {};

  // The item every line goes in on, and the one sales tax goes in on, made the first time they're needed.
  async function itemFor(c, tax) {
    const key = tax ? 'taxItemId' : 'itemId';
    if (c[key]) return c[key];
    const name = tax ? TAX_ITEM : ITEM;
    let item = (await query(c, `select * from Item where Name = '${esc(name)}'`)).Item?.[0];
    if (!item) {
      let acct;
      if (tax) {
        // Tax collected is owed to the state, so it goes to a liability account, not income.
        const list = (await query(c, "select * from Account where AccountType = 'Other Current Liability'")).Account || [];
        acct = list.find((a) => /sales tax/i.test(a.Name)) || list.find((a) => /tax/i.test(a.Name));
        if (!acct) acct = (await qb(c, 'POST', '/account', { Name: 'Sales tax from Kloomie', AccountType: 'Other Current Liability' })).Account;
      } else {
        const list = (await query(c, "select * from Account where AccountType = 'Income'")).Account || [];
        acct = list.find((a) => /^services$/i.test(a.Name)) || list.find((a) => /service/i.test(a.Name)) || list.find((a) => /sales/i.test(a.Name)) || list[0];
        if (!acct) acct = (await qb(c, 'POST', '/account', { Name: 'Services', AccountType: 'Income' })).Account;
      }
      item = (await qb(c, 'POST', '/item', { Name: name, Type: 'Service', Taxable: false, IncomeAccountRef: { value: acct.Id }, Description: tax ? 'Sales tax charged on Kloomie invoices' : 'Work invoiced from Kloomie' })).Item;
    }
    c[key] = item.Id;
    save();
    return item.Id;
  }
  // The customer an invoice is billed to: the one already used for that contact, one with the same name, or a new one.
  async function customerFor(c, to = {}) {
    const name = cleanText(to.name, 100) || 'Customer';
    const key = to.contactId || 'name:' + name.toLowerCase();
    c.customers ||= {};
    if (c.customers[key]) return c.customers[key];
    if (!to.name && !to.email) throw new Error('It has no customer. Pick who it’s for in Kloomie.');
    let cust = (await query(c, `select * from Customer where DisplayName = '${esc(name)}'`)).Customer?.[0];
    if (!cust) {
      const body = { DisplayName: name, ...(to.email ? { PrimaryEmailAddr: { Address: to.email } } : {}), ...(to.phone ? { PrimaryPhone: { FreeFormNumber: to.phone } } : {}), ...(to.address ? { BillAddr: { Line1: to.address.slice(0, 500) } } : {}) };
      try {
        cust = (await qb(c, 'POST', '/customer', body)).Customer;
      } catch (e) {
        // The name is taken by a vendor or employee: keep them apart.
        if (String(e.code) !== '6240') throw e;
        cust = (await qb(c, 'POST', '/customer', { ...body, DisplayName: `${name} (customer)` })).Customer;
      }
    }
    c.customers[key] = cust.Id;
    save();
    return cust.Id;
  }
  // Kloomie's price lines as QuickBooks lines: each line, the discount, and the tax as a line of its own.
  async function linesFor(c, lines) {
    const t = PJ.itemsTotals(lines);
    const item = await itemFor(c, false);
    const Line = lines.rows.map((r) => ({ DetailType: 'SalesItemLineDetail', Amount: dollars(Math.round(r.qty * r.price)), Description: [r.desc, r.unit && `(${r.unit})`].filter(Boolean).join(' ').slice(0, 4000) || 'Work',
      SalesItemLineDetail: { ItemRef: { value: item }, Qty: r.qty, UnitPrice: dollars(r.price) } }));
    if (t.discount > 0) Line.push({ DetailType: 'DiscountLineDetail', Amount: dollars(t.discount), DiscountLineDetail: { PercentBased: false } });
    if (t.tax > 0) Line.push({ DetailType: 'SalesItemLineDetail', Amount: dollars(t.tax), Description: `Sales tax (${lines.taxRate}%)`, SalesItemLineDetail: { ItemRef: { value: await itemFor(c, true) }, Qty: 1, UnitPrice: dollars(t.tax) } });
    return Line;
  }
  async function invoiceBody(c, inv) {
    const Line = await linesFor(c, inv.lines);
    return { CustomerRef: { value: await customerFor(c, inv.to) }, DocNumber: inv.number.slice(0, 21), TxnDate: inv.issued || undefined, DueDate: inv.due || undefined, Line,
      ...(inv.to?.email ? { BillEmail: { Address: inv.to.email } } : {}), ...(inv.note ? { CustomerMemo: { value: inv.note.slice(0, 1000) } } : {}), PrivateNote: `From Kloomie${inv.title ? ': ' + inv.title.slice(0, 200) : ''}` };
  }
  const linesHash = (inv) => crypto.createHash('sha256').update(JSON.stringify([inv.lines, inv.due, inv.note, inv.to?.name])).digest('base64url').slice(0, 16);

  // ---------- one run for a team ----------
  const toCopy = (c, inv) => inv.wsId === c.wsId && inv.status !== 'draft' && (inv.createdAt >= (c.from || 0) || inv.qbo?.id);
  async function run(ws, pull) {
    const c = db.qbo[ws.id];
    if (!c || offline(ws.id)) return;
    let did = 0;
    const fails = [];
    for (const rec of quotesOf(c)) {
      try {
        did += await copyQuote(c, rec);
      } catch (e) {
        if (e.auth) throw e;
        rec.qbo = { ...rec.qbo, error: String(e.message).slice(0, 300), tried: Date.now() };
        fails.push(`Quote ${PJ.quoteOf(rec)?.number || PJ.quoteOf(rec)?.title || ''}: ${e.message}`);
      }
    }
    const invs = Object.values(db.invoices).filter((x) => toCopy(c, x)).sort((a, b) => a.createdAt - b.createdAt);
    for (const inv of invs) {
      try {
        did += await copyInvoice(c, inv);
      } catch (e) {
        if (e.auth) throw e;
        inv.qbo = { ...inv.qbo, error: String(e.message).slice(0, 300), tried: Date.now() };
        fails.push(`${inv.number}: ${e.message}`);
      }
    }
    if (pull || Date.now() - (c.pulledAt || 0) >= PULL) did += await pullPayments(c, ws);
    c.syncedAt = Date.now();
    c.error = fails.length ? `${fails.length} thing${fails.length > 1 ? 's' : ''} didn’t copy. ${fails[0].slice(0, 300)}` : null;
    return did;
  }
  async function copyInvoice(c, inv) {
    let did = 0;
    const x = (inv.qbo ||= {});
    // Voided in Kloomie: voided there too (never copied, nothing to do).
    if (inv.status === 'void') {
      if (x.id && !x.voided) {
        const cur = (await qb(c, 'GET', `/invoice/${x.id}`)).Invoice;
        await qb(c, 'POST', '/invoice?operation=void', { Id: x.id, SyncToken: cur.SyncToken });
        x.voided = Date.now();
        did++;
      }
      return did;
    }
    if (!x.id) {
      // Already there under this number (an earlier run that didn't finish, or typed in by hand): link to it.
      const found = (await query(c, `select * from Invoice where DocNumber = '${esc(inv.number)}'`)).Invoice?.[0];
      if (found) Object.assign(x, { id: found.Id, linked: true, hash: linesHash(inv) });
      else {
        const body = await invoiceBody(c, inv);
        // Made from a job whose quote is an Estimate there: linked to it, so QuickBooks shows it was invoiced.
        const est = db.records[inv.recordId]?.qbo?.estId;
        if (est) body.LinkedTxn = [{ TxnId: est, TxnType: 'Estimate' }];
        const made = (await qb(c, 'POST', '/invoice', body)).Invoice;
        Object.assign(x, { id: made.Id, hash: linesHash(inv), total: cents(made.TotalAmt), ...(est ? { estimate: est } : {}) });
        did++;
      }
      x.at = Date.now();
    } else if (x.hash !== linesHash(inv) && !inv.payments.some((p) => p.qbo)) {
      const cur = (await qb(c, 'GET', `/invoice/${x.id}`)).Invoice;
      const made = (await qb(c, 'POST', '/invoice', { ...(await invoiceBody(c, inv)), Id: x.id, SyncToken: cur.SyncToken, sparse: false })).Invoice;
      Object.assign(x, { hash: linesHash(inv), total: cents(made.TotalAmt) });
      did++;
    }
    x.error = null;
    save();
    // Payments taken in Kloomie, recorded against it there (not the ones that came from QuickBooks).
    for (const p of inv.payments) {
      if (p.qbo || p.ref?.startsWith('qbo:')) continue;
      const made = (await qb(c, 'POST', '/payment', { CustomerRef: { value: await customerFor(c, inv.to) }, TotalAmt: dollars(p.amount), TxnDate: p.day, PaymentRefNum: p.id.slice(0, 21),
        PrivateNote: `From Kloomie: ${p.method}${p.note ? ' · ' + p.note.slice(0, 200) : ''}`, Line: [{ Amount: dollars(p.amount), LinkedTxn: [{ TxnId: x.id, TxnType: 'Invoice' }] }] })).Payment;
      p.qbo = made.Id;
      save();
      did++;
    }
    return did;
  }
  // ---------- quotes, as estimates ----------
  // Quotes sent since connecting (or earlier, when asked), and any already copied.
  const quotesOf = (c) => Object.values(db.records).filter((r) => r.wsId === c.wsId && (r.qbo?.estId || (r.share && (r.share.createdAt || 0) >= (c.from || 0)))).sort((a, b) => (a.share?.createdAt || 0) - (b.share?.createdAt || 0));
  const EST_STATUS = { pending: 'Pending', accepted: 'Accepted', declined: 'Rejected', expired: 'Closed', withdrawn: 'Closed' };
  const quoteHash = (q) => crypto.createHash('sha256').update(JSON.stringify([q.lines, q.validUntil, q.terms, q.customer?.name])).digest('base64url').slice(0, 16);
  // The quote's own number (Bids & Quotes has one); a job's quote gets the next KQ-1001, KQ-1002… for the team, kept.
  const quoteNumber = (q, rec) => {
    if (q.number) return String(q.number).slice(0, 21);
    if (!rec.qbo?.num) {
      const c = db.qbo[rec.wsId];
      c.quoteNext = (c.quoteNext || 1000) + 1;
      rec.qbo = { ...rec.qbo, num: 'KQ-' + c.quoteNext };
      save();
    }
    return rec.qbo.num;
  };
  async function estimateBody(c, q, rec) {
    return { CustomerRef: { value: await customerFor(c, q.customer || {}) }, DocNumber: quoteNumber(q, rec), TxnDate: q.issued || undefined, ExpirationDate: q.validUntil || undefined, Line: await linesFor(c, q.lines),
      ...(q.customer?.email ? { BillEmail: { Address: q.customer.email } } : {}), ...(q.terms ? { CustomerMemo: { value: q.terms.slice(0, 1000) } } : {}), PrivateNote: `From Kloomie: ${q.title.slice(0, 200)}`,
      TxnStatus: EST_STATUS[q.status], ...(q.status === 'accepted' ? { AcceptedBy: (q.acceptedBy || 'Customer').slice(0, 100), AcceptedDate: q.answeredOn || undefined } : {}) };
  }
  async function copyQuote(c, rec) {
    const q = PJ.quoteOf(rec);
    if (!q) return 0;
    if (!rec.qbo?.estId && (q.status === 'withdrawn' || q.status === 'expired')) return 0; // never copied, nothing to close
    const num = quoteNumber(q, rec);
    const x = (rec.qbo ||= {});
    const want = EST_STATUS[q.status];
    let did = 0;
    if (!x.estId) {
      const found = (await query(c, `select * from Estimate where DocNumber = '${esc(num)}'`)).Estimate?.[0];
      if (found) Object.assign(x, { estId: found.Id, linked: true, hash: quoteHash(q), status: found.TxnStatus });
      else {
        const made = (await qb(c, 'POST', '/estimate', await estimateBody(c, q, rec))).Estimate;
        Object.assign(x, { estId: made.Id, hash: quoteHash(q), status: made.TxnStatus || want, total: cents(made.TotalAmt) });
        did++;
      }
    }
    if (x.hash !== quoteHash(q) && q.status === 'pending') {
      const cur = (await qb(c, 'GET', `/estimate/${x.estId}`)).Estimate;
      if (cur.TxnStatus !== 'Closed') {
        const made = (await qb(c, 'POST', '/estimate', { ...(await estimateBody(c, q, rec)), Id: x.estId, SyncToken: cur.SyncToken })).Estimate;
        Object.assign(x, { hash: quoteHash(q), status: made.TxnStatus, total: cents(made.TotalAmt) });
        did++;
      } else x.hash = quoteHash(q);
    }
    if (x.status !== want) {
      const cur = (await qb(c, 'GET', `/estimate/${x.estId}`)).Estimate;
      // Closed there already (it became an invoice): leave it closed.
      if (cur.TxnStatus !== 'Closed' && cur.TxnStatus !== want) {
        await qb(c, 'POST', '/estimate', { Id: x.estId, SyncToken: cur.SyncToken, sparse: true, TxnStatus: want, ...(q.status === 'accepted' ? { AcceptedBy: (q.acceptedBy || 'Customer').slice(0, 100), AcceptedDate: q.answeredOn || undefined } : {}) });
        did++;
      }
      x.status = want;
    }
    x.error = null;
    save();
    return did;
  }

  // Payments recorded in QuickBooks since last time, against invoices that came from Kloomie.
  async function pullPayments(c, ws) {
    const byQbo = new Map(Object.values(db.invoices).filter((x) => x.wsId === ws.id && x.qbo?.id && x.status !== 'void').map((x) => [x.qbo.id, x]));
    if (!byQbo.size) { c.pulledAt = Date.now(); return 0; }
    const since = new Date(Math.max(c.pulledAt || c.at, Date.now() - 29 * 864e5) - 5 * 60_000).toISOString();
    const started = Date.now();
    const out = await qb(c, 'GET', `/cdc?entities=Payment&changedSince=${encodeURIComponent(since)}`);
    const pays = (out.CDCResponse?.[0]?.QueryResponse || []).flatMap((r) => r.Payment || []);
    let did = 0;
    for (const pay of pays) {
      if (pay.status === 'Deleted') continue;
      for (const line of pay.Line || []) {
        for (const lt of line.LinkedTxn || []) {
          const inv = lt.TxnType === 'Invoice' && byQbo.get(lt.TxnId);
          if (!inv) continue;
          // Ours going there, or already brought back.
          if (inv.payments.some((p) => p.qbo === pay.Id || p.ref === `qbo:${pay.Id}:${lt.TxnId}`)) continue;
          const amount = cents(line.Amount);
          if (amount <= 0 || INV.totals(inv).balance <= 0) continue;
          const p = INV.addPayment(inv, { amount: Math.min(amount, INV.totals(inv).balance), method: 'other', note: `Recorded in QuickBooks${pay.PaymentRefNum ? ' · ref ' + pay.PaymentRefNum : ''}`, day: pay.TxnDate || teamDay(ws.id), by: 'QuickBooks' });
          p.ref = `qbo:${pay.Id}:${lt.TxnId}`;
          p.qbo = pay.Id;
          did++;
        }
      }
    }
    c.pulledAt = started;
    save();
    return did;
  }
  // One run at a time for a team; asking while one runs waits for it.
  function sync(ws, pull = false) {
    if (busy.has(ws.id)) return busy.get(ws.id);
    const c = db.qbo[ws.id];
    if (!c) return Promise.resolve(0);
    const p = (async () => {
      try {
        return await run(ws, pull);
      } catch (e) {
        if (db.qbo[ws.id] === c) c.error = e.auth ? 'QuickBooks’ sign-in expired, or Kloomie was disconnected in QuickBooks. Connect it again.' : 'Couldn’t reach QuickBooks: ' + String(e.message).slice(0, 300);
        if (!e.auth) console.error('QuickBooks sync failed', e.code ? 'code ' + e.code : '', e.tid ? 'intuit_tid ' + e.tid : '');
        return 0;
      } finally {
        if (db.qbo[ws.id] === c) c.tried = Date.now();
        busy.delete(ws.id);
        save();
        broadcast(ws.id, { type: 'quickbooks', forAdmins: true });
      }
    })();
    busy.set(ws.id, p);
    return p;
  }
  // Something changed on an invoice: copy it over in a moment (a burst of changes is one run).
  function soon(wsId) {
    if (!db.qbo[wsId] || soonTimers.has(wsId)) return;
    soonTimers.set(wsId, setTimeout(() => {
      soonTimers.delete(wsId);
      const ws = db.workspaces[wsId];
      if (ws) sync(ws);
    }, Number(env('QBO_SOON_MS')) || 3_000));
  }
  setInterval(() => {
    for (const wsId of Object.keys(db.qbo)) {
      const ws = db.workspaces[wsId];
      if (!ws) { delete db.qbo[wsId]; continue; }
      if (!ws.deleteAt && !String(db.qbo[wsId].error || '').includes('sign-in expired')) sync(ws);
    }
  }, TICK).unref?.();

  // ---------- connecting ----------
  const state = (ws) => {
    const c = db.qbo[ws.id];
    if (!c) return { configured: configured(), connected: false };
    const invs = Object.values(db.invoices).filter((x) => toCopy(c, x));
    return { configured: configured(), connected: true, company: c.company, sandbox: c.sandbox, by: c.by, at: c.at, from: c.from || 0, syncedAt: c.syncedAt || null, error: c.error || null, busy: busy.has(ws.id),
      copied: invs.filter((x) => x.qbo?.id).length, quotes: quotesOf(c).filter((r) => r.qbo?.estId).length, waiting: invs.filter((x) => !x.qbo?.id && x.status !== 'void').length, failed: [...quotesOf(c).filter((r) => r.qbo?.error).map((r) => ({ id: r.id, number: PJ.quoteOf(r)?.number || 'A quote', error: r.qbo.error })), ...invs.filter((x) => x.qbo?.error).map((x) => ({ id: x.id, number: x.number, error: x.qbo.error }))].slice(0, 10) };
  };
  async function revoke(c) {
    try {
      const t = unseal(c.tokens);
      await fetch(await revokeUrl(), { method: 'POST', headers: { Authorization: basic(), Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t.refresh }) });
    } catch {}
  }
  async function disconnect(wsId) {
    const c = db.qbo[wsId];
    if (!c) return;
    await revoke(c);
    delete db.qbo[wsId];
    save();
    broadcast(wsId, { type: 'quickbooks', forAdmins: true });
  }
  async function route(req, res, parts, auth, ws) {
    const [a, b] = parts;
    if (a !== 'quickbooks') return null;
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins connect QuickBooks.' });
    const m = req.method;
    if (m === 'GET' && !b) return send(res, 200, state(ws));
    if (m === 'POST' && b === 'connect') {
      if (!configured()) return send(res, 400, { error: 'QuickBooks isn’t set up on this Kloomie server yet.' });
      const st = crypto.randomBytes(18).toString('base64url');
      pending.set(st, { wsId: ws.id, memberId: auth.memberId, exp: Date.now() + 15 * 60_000 });
      const url = `${await authUrl()}?` + new URLSearchParams({ client_id: env('QBO_CLIENT_ID'), response_type: 'code', scope: SCOPE, redirect_uri: redirect(), state: st });
      return send(res, 200, { url });
    }
    const c = db.qbo[ws.id];
    if (!c) return send(res, 400, { error: 'Connect QuickBooks first.' });
    if (m === 'POST' && b === 'sync') {
      if (busy.has(ws.id)) await busy.get(ws.id);
      await sync(ws, true);
      return send(res, 200, state(ws));
    }
    // Earlier invoices too: everything already sent, not just what's made from now on.
    if (m === 'POST' && b === 'earlier') {
      c.from = 0;
      save();
      sync(ws);
      return send(res, 200, state(ws));
    }
    if (m === 'DELETE' && !b) {
      await disconnect(ws.id);
      return send(res, 200, state(ws));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  const page = (res, title, msg) => send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:15px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh;text-align:center"><div><h2>${title}</h2><p>${msg}</p></div></body>`, { 'Content-Type': 'text/html; charset=utf-8' });
  // Intuit comes back here with the code and the company id in the address. Per Intuit's security rules this answers
  // with a redirect, never a page, so those never sit in a page that could pass them on; /quickbooks/done says how it went.
  const DONE = {
    connected: ['QuickBooks connected', 'Quotes and invoices you send from Kloomie now go into QuickBooks, with their payments. You can close this window.'],
    expired: ['Link expired', 'Start again from Kloomie → Settings → Connections.'],
    denied: ['Not connected', 'QuickBooks access wasn’t granted. You can close this window.'],
    role: ['Not connected', 'Only team owners and admins can connect QuickBooks.'],
    company: ['Not connected', 'QuickBooks didn’t say which company. Try again.'],
    failed: ['Not connected', 'Something went wrong talking to QuickBooks. Try again in a minute.'],
  };
  const done = (res, how) => { res.writeHead(302, { Location: `/quickbooks/done?r=${how}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); };
  function donePage(req, res, url) {
    const r = url.searchParams.get('r');
    const [title, msg] = Object.hasOwn(DONE, r || '') ? DONE[r] : DONE.failed;
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Cache-Control', 'no-store');
    return page(res, title, msg);
  }
  async function callback(req, res, url) {
    const st = url.searchParams.get('state') || '';
    const pend = pending.get(st);
    pending.delete(st);
    if (!pend || pend.exp < Date.now()) return done(res, 'expired');
    if (url.searchParams.get('error')) return done(res, 'denied');
    const ws = db.workspaces[pend.wsId];
    const who = ws?.members.find((x) => x.id === pend.memberId);
    if (!who || !['owner', 'admin'].includes(who.role)) return done(res, 'role');
    const realmId = url.searchParams.get('realmId');
    if (!realmId) return done(res, 'company');
    try {
      const tok = await tokenCall({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirect() });
      const old = db.qbo[ws.id];
      const c = { wsId: ws.id, realm: seal({ id: realmId }), company: '', sandbox: sandbox(), memberId: who.id, by: who.name, tokens: seal(tok), at: Date.now(), from: Date.now(), syncedAt: null, pulledAt: null, error: null, customers: {} };
      // The same company again keeps what it already copied; a different one starts over.
      if (old && realmOf(old) === realmId) Object.assign(c, { from: old.from, customers: old.customers || {}, itemId: old.itemId, taxItemId: old.taxItemId, pulledAt: old.pulledAt, quoteNext: old.quoteNext });
      else if (old) {
        await revoke(old);
        for (const inv of Object.values(db.invoices)) if (inv.wsId === ws.id) delete inv.qbo;
        for (const r of Object.values(db.records)) if (r.wsId === ws.id) delete r.qbo;
      }
      const info = await qb(c, 'GET', `/companyinfo/${encodeURIComponent(realmId)}`);
      c.company = info.CompanyInfo?.CompanyName || 'your company';
      db.qbo[ws.id] = c;
      save();
      broadcast(ws.id, { type: 'quickbooks', forAdmins: true });
      sync(ws, true);
      return done(res, 'connected');
    } catch (e) {
      alarm('Connecting QuickBooks failed', e);
      return done(res, 'failed');
    }
  }
  // Where Intuit sends someone who disconnects Kloomie from inside QuickBooks (the app's Disconnect URL). Nothing
  // here says which team, so it only explains; that team's next sync finds the access gone and says so in Settings.
  function disconnectedPage(req, res) {
    res.setHeader('X-Robots-Tag', 'noindex');
    return page(res, 'Kloomie is disconnected from QuickBooks', 'Kloomie can no longer reach that QuickBooks company. Quotes, invoices and payments already copied stay in both places. To connect again, open Kloomie → Settings → Connections → QuickBooks.');
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  return { route, callback, donePage, disconnectedPage, soon, sync, disconnect, state };
}
