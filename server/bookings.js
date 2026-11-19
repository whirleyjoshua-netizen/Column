// Calendly and Cal.com: bookings come into Kloomie by themselves (docs/INTEGRATIONS-MAP.md, the owner 2026-11-20).
//
// CONNECT, two scopes (map §1.1), never mixed:
// - team: an owner or admin connects the team's booking page (Calendly: Connect, sign in; Cal.com: paste an API key);
// - person: anyone connects their own; only they can act through it, and it's deleted when they leave.
// Kloomie makes the webhook itself (Calendly: a webhook subscription; Cal.com: a webhook), so nothing is pasted back.
//
// DATA (map §1.2): a booking lands on a contact (matched by email, then phone; ext.<app> keeps the outside id), and
// on the calendar: a visit on the contact's job when they have one, else an entry on the host's day. A cancel takes it
// off; a reschedule moves it. What the app sends is data, never instructions: the invitee's answers are kept as text.
//
// WORK (map §1.4): Flows events booking.created / booking.cancelled / booking.rescheduled; the host hears it in the
// bell; GET /api/bookings is what Home, Sidekick's brief and the agents (find_bookings) read.
//
// Calendly (developer.calendly.com): OAuth 2 with PKCE (auth.calendly.com), scopes users:read scheduled_events:read
// webhooks:write; webhooks signed with the OAuth app's own signing key (made once, with the app: CALENDLY_WEBHOOK_KEY),
// header Calendly-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">. A reschedule is invitee.canceled
// (rescheduled: true) and then invitee.created with old_invitee.
// Cal.com (cal.com/docs, API v2): Bearer cal_live_… key; POST /v2/webhooks; X-Cal-Signature-256 is the hex
// HMAC-SHA256 of the body with the webhook's secret; BOOKING_RESCHEDULED has uid (new) and rescheduleUid (old).
import crypto from 'node:crypto';
import { safeFetch } from './safefetch.js';

const TIMEOUT = 15_000;
const STATE_MS = 10 * 60_000;
const SKEW_S = 10 * 60; // how old a Calendly signature may be (it retries for a while)
const KEEP_DAYS = 400, PER_TEAM = 5000;
const APPS = { calendly: 'Calendly', calcom: 'Cal.com' };
const CAL_TRIGGERS = ['BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED'];
const CALENDLY = {
  id: () => process.env.CALENDLY_CLIENT_ID || '',
  secret: () => process.env.CALENDLY_CLIENT_SECRET || '',
  hookKey: () => process.env.CALENDLY_WEBHOOK_KEY || '',
  auth: () => (process.env.CALENDLY_AUTH_URL || 'https://auth.calendly.com').replace(/\/$/, ''),
  api: () => (process.env.CALENDLY_API_URL || 'https://api.calendly.com').replace(/\/$/, ''),
  scope: 'users:read scheduled_events:read webhooks:write',
};
const CALCOM_API = () => (process.env.CALCOM_API_URL || 'https://api.cal.com/v2').replace(/\/$/, '');
const fail = (msg, status = 400, more = {}) => Object.assign(new Error(msg), { status, ...more });
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const eqStr = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function bookingsModule(deps) {
  const { bind, db, save, broadcast, cleanText, readJson, send, seal, unseal, isAdmin, rid, alarm = () => {}, allowLocal = false, publicUrl = '',
    contactsOf, newContact, applyContact, emailKey, phoneKey, contactNews, CONTACT_MAX = 50_000, automate = () => {}, notify = () => {}, userOf, tzOf, localNow,
    jobFor = () => null, recCtx = () => null, bookVisit = () => null, moveVisit = () => null, cancelVisit = () => {}, addEntry, moveEntry, dropEntry, privateRecord = () => false } = deps;
  db.bookingConns ||= {};
  db.bookings ||= {};
  const pending = new Map(); // state → { wsId, memberId, scope, verifier, browser, exp }
  const calendlyOn = () => !!(CALENDLY.id() && CALENDLY.secret() && CALENDLY.hookKey());

  // ----- connections -----
  const connsOf = (wsId) => Object.values(db.bookingConns).filter((c) => c.wsId === wsId);
  const connFor = (wsId, app, scope, memberId) => connsOf(wsId).find((c) => c.app === app && c.scope === scope && (scope === 'team' || c.memberId === memberId)) || null;
  // What the app shows: the team's connection's details only to owners and admins (map §1.1); one's own in full.
  const pubConn = (c, full) => (!c ? null : full
    ? { id: c.id, app: c.app, scope: c.scope, toContacts: shares(c), account: c.account, by: c.by, at: c.at, hook: !!c.hook?.id, error: c.error || null, lastAt: c.lastAt || null, count: c.count || 0, ...(c.app === 'calcom' ? { last4: c.last4 } : {}) }
    : { app: c.app, scope: c.scope, connected: true });
  const status = (app, ws, auth) => ({
    app, name: APPS[app], configured: app === 'calendly' ? calendlyOn() : true,
    team: pubConn(connFor(ws.id, app, 'team'), isAdmin(auth)),
    mine: pubConn(connFor(ws.id, app, 'person', auth.memberId), true),
    canTeam: isAdmin(auth),
  });

  // ----- Calendly: calls, refreshed when the hour-long token runs out -----
  async function calendlyToken(body) {
    const r = await safeFetch(CALENDLY.auth() + '/oauth/token', { method: 'POST', timeout: TIMEOUT, allowLocal, httpsOnly: !allowLocal, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CALENDLY.id(), client_secret: CALENDLY.secret(), ...body }).toString() })
      .catch((e) => { throw fail(e.code === 'TIMEOUT' ? 'Calendly didn’t answer in time. Try again.' : 'Couldn’t reach Calendly.', 502); });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.access_token) throw fail(`Calendly didn’t sign in (${r.status}).`, r.status === 400 || r.status === 401 ? 400 : 502, { auth: r.status === 400 || r.status === 401 });
    return { access: j.access_token, refresh: j.refresh_token || null, expires: Date.now() + Math.max(60, Number(j.expires_in) || 7200) * 1000 - 60_000, owner: j.owner || null, organization: j.organization || null };
  }
  async function calendlyCall(c, method, path, body) {
    let tok = unseal(c.tokens);
    if (!tok.access || Date.now() > tok.expires) {
      if (!tok.refresh) throw fail('Calendly’s sign-in ran out. Connect it again.', 409, { auth: true });
      tok = { ...tok, ...(await calendlyToken({ grant_type: 'refresh_token', refresh_token: tok.refresh }).catch((e) => { if (e.auth) { c.error = 'Calendly’s sign-in ran out. Connect it again.'; c.needsReconnect = true; save(); } throw e; })) };
      c.tokens = seal(tok);
      save();
    }
    const url = /^https?:\/\//.test(path) ? path : CALENDLY.api() + path;
    const r = await safeFetch(url, { method, timeout: TIMEOUT, allowLocal, httpsOnly: !allowLocal, headers: { Authorization: 'Bearer ' + tok.access, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
      .catch((e) => { throw fail(e.code === 'TIMEOUT' ? 'Calendly didn’t answer in time. Try again.' : 'Couldn’t reach Calendly.', 502); });
    const j = r.status === 204 ? {} : await r.json().catch(() => null);
    if (r.status === 401) { c.error = 'Calendly’s sign-in ran out. Connect it again.'; c.needsReconnect = true; save(); throw fail(c.error, 409, { auth: true }); }
    if (!r.ok) throw fail(`Calendly said no: ${cleanText(j?.message || j?.title || r.statusText, 300)}`, r.status === 403 ? 403 : 502, { calendly: j, http: r.status });
    if (c.needsReconnect) { c.needsReconnect = false; save(); }
    return j;
  }
  // The webhook: organization-wide for a team's Calendly (every booking page in it) when the person who connected may
  // do that, else their own; a person's is always their own.
  async function calendlyHook(c) {
    const tok = unseal(c.tokens);
    const url = `${publicUrl}/api/calendly/hook/${c.hookToken}`;
    const make = (scope) => calendlyCall(c, 'POST', '/webhook_subscriptions', { url, events: ['invitee.created', 'invitee.canceled'], organization: tok.organization, ...(scope === 'user' ? { user: tok.owner } : {}), scope });
    let j;
    try { j = await make(c.scope === 'team' ? 'organization' : 'user'); } catch (e) {
      if (c.scope === 'team' && e.http === 403 && !/upgrade/i.test(e.message)) j = await make('user');
      else throw e;
    }
    c.hook = { id: j?.resource?.uri || null, scope: j?.resource?.scope || null };
  }
  async function calendlyUnhook(c) {
    if (c.hook?.id) await calendlyCall(c, 'DELETE', c.hook.id).catch(() => {});
    const tok = (() => { try { return unseal(c.tokens); } catch { return {}; } })();
    if (tok.access) await safeFetch(CALENDLY.auth() + '/oauth/revoke', { method: 'POST', timeout: TIMEOUT, allowLocal, httpsOnly: !allowLocal, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CALENDLY.id(), client_secret: CALENDLY.secret(), token: tok.access }).toString() }).catch(() => {});
  }

  // ----- Cal.com: an API key -----
  async function calcomCall(key, method, path, body) {
    const r = await safeFetch(CALCOM_API() + path, { method, timeout: TIMEOUT, allowLocal, httpsOnly: !allowLocal,
      headers: { Authorization: 'Bearer ' + key, 'cal-api-version': '2024-08-13', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
      .catch((e) => { throw fail(e.code === 'TIMEOUT' ? 'Cal.com didn’t answer in time. Try again.' : 'Couldn’t reach Cal.com.', 502); });
    const j = r.status === 204 ? {} : await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) throw fail('Cal.com didn’t accept that API key. Make a new one in Cal.com → Settings → Developer → API keys and paste it again.', 400, { auth: true });
    if (!r.ok) throw fail(`Cal.com said no: ${cleanText(j?.error?.message || j?.message || r.statusText, 300)}`, 502);
    return j;
  }
  const calKey = (c) => { try { return unseal(c.tokens).key; } catch { return ''; } };

  // ----- the bookings -----
  const memberByEmail = (ws, email) => { const k = emailKey(email); return k ? ws.members.find((m) => emailKey(userOf(m)?.email) === k) || null : null; };
  const when = (ws, ms) => localNow(tzOf(ws), ms);
  // Kloomie's own words for it (never the app's text as anything but text).
  const clip = (v, n) => cleanText(String(v ?? ''), n);
  function normalizeCalendly(body) {
    const p = body?.payload || {};
    const ev = p.scheduled_event || {};
    const hostEmail = ev.event_memberships?.[0]?.user_email || '';
    const base = {
      app: 'calendly', extId: String(p.uri || ''), title: clip(ev.name || 'Meeting', 120), start: Date.parse(ev.start_time), end: Date.parse(ev.end_time),
      invitee: { name: clip(p.name || [p.first_name, p.last_name].filter(Boolean).join(' '), 120), email: clip(p.email, 200), phone: clip(p.text_reminder_number || (p.questions_and_answers || []).find((q) => /phone/i.test(q.question))?.answer || '', 40) },
      hostEmail, location: clip(ev.location?.location || ev.location?.join_url || ev.location?.type || '', 200),
      answers: (p.questions_and_answers || []).slice(0, 10).map((q) => ({ q: clip(q.question, 200), a: clip(q.answer, 500) })),
    };
    if (body.event === 'invitee.created') return { ...base, kind: p.old_invitee ? 'rescheduled' : 'created', oldExtId: p.old_invitee ? String(p.old_invitee) : null };
    if (body.event === 'invitee.canceled') return p.rescheduled ? { ...base, kind: 'moving' } : { ...base, kind: 'cancelled', reason: clip(p.cancellation?.reason || '', 300) };
    return null;
  }
  function normalizeCalcom(body) {
    const p = body?.payload || {};
    const at = (p.attendees || [])[0] || {};
    const r = p.responses || {};
    const val = (k) => (r[k] && typeof r[k] === 'object' ? r[k].value : r[k]);
    const kind = { BOOKING_CREATED: 'created', BOOKING_CANCELLED: 'cancelled', BOOKING_RESCHEDULED: 'rescheduled' }[body.triggerEvent];
    if (!kind) return null;
    return {
      app: 'calcom', kind, extId: String(p.uid || ''), oldExtId: kind === 'rescheduled' ? String(p.rescheduleUid || p.fromReschedule || '') || null : null,
      title: clip(p.title || p.eventTitle || p.type || 'Meeting', 120), start: Date.parse(p.startTime), end: Date.parse(p.endTime),
      invitee: { name: clip(at.name || val('name'), 120), email: clip(at.email || val('email'), 200), phone: clip(at.phoneNumber || val('attendeePhoneNumber') || val('phone') || '', 40) },
      hostEmail: p.organizer?.email || '', location: clip(typeof p.location === 'string' ? p.location : p.location?.value || '', 200),
      answers: Object.entries(r).filter(([k]) => !['name', 'email', 'location', 'guests', 'rescheduleReason'].includes(k)).slice(0, 10).map(([k, v]) => ({ q: clip(v?.label || k, 200), a: clip(typeof v === 'object' ? v?.value : v, 500) })).filter((x) => x.a),
      reason: clip(p.cancellationReason || '', 300),
    };
  }
  // The contact the booking is from: the same email, then the same phone, else a new one.
  function contactFor(ws, b, appName) {
    const all = contactsOf(ws.id);
    const ek = emailKey(b.invitee.email), pk = phoneKey(b.invitee.phone);
    let x = all.find((c) => (ek && emailKey(c.email) === ek) || (pk && phoneKey(c.phone) === pk));
    let added = false;
    if (x) {
      const fill = {};
      if (b.invitee.name && !x.name) fill.name = b.invitee.name;
      if (b.invitee.email && !x.email) fill.email = b.invitee.email;
      if (b.invitee.phone && !x.phone) fill.phone = b.invitee.phone;
      if (Object.keys(fill).length) applyContact(x, fill);
    } else {
      if (!ek && !pk && !b.invitee.name) return { contact: null, added };
      if (all.length >= CONTACT_MAX) return { contact: null, added };
      x = applyContact(newContact(ws.id, appName), { name: b.invitee.name, email: b.invitee.email, phone: b.invitee.phone, source: appName });
      db.contacts[x.id] = x;
      added = true;
    }
    x.ext = { ...(x.ext || {}), [b.app]: b.extId };
    return { contact: x, added };
  }
  const noteOn = (x, line) => { if (x) applyContact(x, { note: [x.note, line].filter(Boolean).join('\n').slice(-4000) }); };
  const whenText = (ws, ms) => { const l = when(ws, ms); return `${l.date} ${String(Math.floor(l.min / 60)).padStart(2, '0')}:${String(l.min % 60).padStart(2, '0')}`; };
  function prune(wsId) {
    const mine = Object.values(db.bookings).filter((x) => x.wsId === wsId);
    const old = Date.now() - KEEP_DAYS * 864e5;
    for (const x of mine) if ((x.end || x.at) < old) delete db.bookings[x.id];
    const left = mine.filter((x) => db.bookings[x.id]).sort((a, b) => a.at - b.at);
    for (const x of left.slice(0, Math.max(0, left.length - PER_TEAM))) delete db.bookings[x.id];
  }
  const ctxOf = (ws, x, contact, rec) => (x.shared === false ? { booking: x.title, date: when(ws, x.start).date, time: whenText(ws, x.start).slice(11), who: x.invitee.name || x.invitee.email || APPS[x.app], private: true } : { contact: contact || { name: x.invitee.name, email: x.invitee.email }, booking: x.title, date: when(ws, x.start).date,
    time: whenText(ws, x.start).slice(11), who: x.invitee.name || x.invitee.email || APPS[x.app], ...(rec ? rec : {}), private: !!(rec?.record && privateRecord(rec.record.id)) });
  // Where it goes on the calendar: a visit on the contact's job, else an entry on the host's day.
  function place(ws, x, contact) {
    const l = when(ws, x.start), e = when(ws, x.end || x.start + 30 * 60_000);
    const slot = { date: l.date, start: l.min, end: e.date === l.date ? Math.max(l.min + 5, e.min) : 1440 };
    const job = contact && jobFor(ws, contact.id, x.memberId);
    if (job) {
      const v = bookVisit(ws, job, { ...slot, title: x.title, memberId: x.memberId, note: `${APPS[x.app]}: ${x.title}${x.invitee.name ? ' with ' + x.invitee.name : ''}` });
      if (v) { x.recordId = job.id; x.visitId = v.id; return job; }
    }
    const en = addEntry(ws, x.memberId, { ...slot, text: `${x.title}${x.invitee.name ? ' · ' + x.invitee.name : ''} (${APPS[x.app]})`, booking: x.id });
    x.entryId = en?.id || null;
    return null;
  }
  function unplace(ws, x) {
    if (x.visitId && x.recordId) cancelVisit(ws, x.recordId, x.visitId, APPS[x.app]);
    else if (x.entryId) dropEntry(x.entryId);
    x.visitId = null; x.entryId = null;
  }
  function take(ws, c, b) {
    if (!b || !b.extId) return 'ignored';
    const find = (id) => Object.values(db.bookings).find((x) => x.wsId === ws.id && x.app === b.app && x.extId === id) || null;
    const appName = APPS[b.app];
    if (b.kind === 'moving') { const x = find(b.extId); if (x && x.status === 'booked') { x.status = 'moving'; x.updatedAt = Date.now(); } return 'moving'; }
    if (b.kind === 'cancelled') {
      const x = find(b.extId);
      if (!x || x.status === 'cancelled') return 'ignored';
      unplace(ws, x);
      Object.assign(x, { status: 'cancelled', reason: b.reason || '', updatedAt: Date.now() });
      const contact = x.contactId && db.contacts[x.contactId];
      noteOn(contact, `${when(ws, Date.now()).date} (${appName}): cancelled “${x.title}” on ${whenText(ws, x.start)}${b.reason ? ' · ' + b.reason : ''}`);
      if (contact) contactNews(ws.id, contact);
      notify(ws.id, x.memberId, { title: `Cancelled: ${x.title}`, text: `${x.invitee.name || x.invitee.email || 'Someone'} cancelled ${whenText(ws, x.start)}${b.reason ? ` · ${b.reason}` : ''}`, go: contact ? 'contact:' + contact.id : null, key: 'booking:' + x.id });
      automate(ws.id, 'booking.cancelled', { ...ctxOf(ws, x, contact, x.recordId ? recCtx(x.recordId) : null), note: b.reason || '' });
      broadcast(ws.id, { type: 'bookings' });
      return 'cancelled';
    }
    if (!Number.isFinite(b.start)) return 'ignored';
    const old = b.kind === 'rescheduled' && b.oldExtId ? find(b.oldExtId) : null;
    if (find(b.extId)) return 'seen'; // sent again
    const memberId = c.scope === 'person' ? c.memberId : memberByEmail(ws, b.hostEmail)?.id || c.memberId;
    if (old) {
      const from = old.start;
      Object.assign(old, { extId: b.extId, start: b.start, end: b.end, title: b.title || old.title, status: 'booked', moves: (old.moves || 0) + 1, updatedAt: Date.now() });
      const l = when(ws, b.start), e = when(ws, b.end || b.start + 30 * 60_000);
      const slot = { date: l.date, start: l.min, end: e.date === l.date ? Math.max(l.min + 5, e.min) : 1440 };
      if (old.visitId && old.recordId) { if (!moveVisit(ws, old.recordId, old.visitId, slot)) { old.visitId = null; place(ws, old, db.contacts[old.contactId]); } }
      else if (old.entryId) { if (!moveEntry(old.entryId, slot)) place(ws, old, db.contacts[old.contactId]); }
      else place(ws, old, db.contacts[old.contactId]);
      const contact = old.contactId && db.contacts[old.contactId];
      noteOn(contact, `${when(ws, Date.now()).date} (${appName}): moved “${old.title}” from ${whenText(ws, from)} to ${whenText(ws, b.start)}`);
      if (contact) contactNews(ws.id, contact);
      notify(ws.id, old.memberId, { title: `Moved: ${old.title}`, text: `${old.invitee.name || 'They'} moved it to ${whenText(ws, b.start)}`, go: contact ? 'contact:' + contact.id : null, key: 'booking:' + old.id });
      automate(ws.id, 'booking.rescheduled', ctxOf(ws, old, contact, old.recordId ? recCtx(old.recordId) : null));
      broadcast(ws.id, { type: 'bookings' });
      save();
      return 'rescheduled';
    }
    const shared = shares(c);
    const { contact, added } = shared ? contactFor(ws, b, appName) : { contact: null, added: false };
    const x = { id: rid(), wsId: ws.id, app: b.app, scope: c.scope, shared, connId: c.id, memberId, extId: b.extId, title: b.title, start: b.start, end: Number.isFinite(b.end) ? b.end : b.start + 30 * 60_000,
      invitee: b.invitee, location: b.location, answers: b.answers, contactId: contact?.id || null, recordId: null, visitId: null, entryId: null, status: 'booked', at: Date.now(), updatedAt: Date.now() };
    db.bookings[x.id] = x;
    const job = place(ws, x, contact);
    noteOn(contact, `${when(ws, Date.now()).date} (${appName}): booked “${x.title}” for ${whenText(ws, x.start)}${x.location ? ' · ' + x.location : ''}`);
    if (contact) contactNews(ws.id, contact);
    c.count = (c.count || 0) + 1;
    c.lastAt = Date.now();
    prune(ws.id);
    save();
    notify(ws.id, memberId, { title: `New booking: ${x.title}`, text: `${x.invitee.name || x.invitee.email || 'Someone'} booked ${whenText(ws, x.start)}${job ? ' · on their job' : ''}`, go: contact ? 'contact:' + contact.id : null, key: 'booking:' + x.id });
    if (added && shared) automate(ws.id, 'contact.created', { contact, stage: contact.stage, who: appName });
    automate(ws.id, 'booking.created', ctxOf(ws, x, contact, job ? recCtx(job.id) : null));
    broadcast(ws.id, { type: 'bookings' });
    return 'booked';
  }

  // ----- incoming webhooks: no sign-in; the signature is the proof -----
  async function rawBody(req) {
    const chunks = [];
    let size = 0;
    for await (const ch of req) { size += ch.length; if (size > 512_000) throw fail('Too large', 413); chunks.push(ch); }
    return Buffer.concat(chunks);
  }
  async function hook(req, res, app, token) {
    let raw;
    try { raw = await rawBody(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    const c = token && Object.values(db.bookingConns).find((x) => x.app === app && x.hookToken && eqStr(x.hookToken, token));
    if (!c) return send(res, 404, { error: 'Unknown hook' });
    const ws = db.workspaces[c.wsId];
    if (!ws || ws.deleteAt) return send(res, 404, { error: 'Unknown hook' });
    if (app === 'calendly') {
      const h = Object.fromEntries(String(req.headers['calendly-webhook-signature'] || '').split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2));
      const key = CALENDLY.hookKey();
      const want = key && h.t ? crypto.createHmac('sha256', key).update(`${h.t}.${raw.toString('utf8')}`).digest('hex') : '';
      if (!want || !eqStr(String(h.v1 || ''), want)) return send(res, 401, { error: 'Bad signature' });
      if (Math.abs(Date.now() / 1000 - Number(h.t)) > SKEW_S) return send(res, 401, { error: 'Too old' });
    } else {
      const sig = String(req.headers['x-cal-signature-256'] || '');
      const want = crypto.createHmac('sha256', unseal(c.hook.secret).secret).update(raw).digest('hex');
      if (!eqStr(sig, want)) return send(res, 401, { error: 'Bad signature' });
    }
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 200, { ok: true, did: 'ignored' }); } // signed but not JSON: nothing to take, and not worth sending again
    try {
      const out = take(ws, c, app === 'calendly' ? normalizeCalendly(body) : normalizeCalcom(body));
      if (c.error && !/plan|sign-in/i.test(c.error)) c.error = null;
      save();
      return send(res, 200, { ok: true, did: out });
    } catch (e) {
      alarm(`A ${APPS[app]} booking couldn’t be taken in`, e);
      return send(res, 500, { error: 'Couldn’t take it in' });
    }
  }

  // ----- connecting -----
  // A person's own: who books goes into the team's Contacts only when they turn it on (column-f9's review): their own
  // calendar may hold things that aren't the team's business. The team's booking page always does.
  const newConn = (ws, auth, app, scope) => ({ id: rid(), wsId: ws.id, app, scope, memberId: auth.memberId, by: auth.member, at: Date.now(), hookToken: rid(24), hook: null, error: null, count: 0, toContacts: scope === 'team' });
  const shares = (c) => c.scope === 'team' || !!c.toContacts;
  function replace(c) {
    const old = connFor(c.wsId, c.app, c.scope, c.memberId);
    if (old && old.id !== c.id) { delete db.bookingConns[old.id]; (old.app === 'calendly' ? calendlyUnhook(old) : unhookCalcom(old)).catch(() => {}); }
    db.bookingConns[c.id] = c;
  }
  async function unhookCalcom(c) { if (c.hook?.id) await calcomCall(calKey(c), 'DELETE', `/webhooks/${encodeURIComponent(c.hook.id)}`).catch(() => {}); }
  const DONE = {
    connected: ['Calendly connected', 'New bookings come into Kloomie by themselves now. You can close this window.'],
    plan: ['Calendly connected, one more step', 'Calendly wouldn’t let Kloomie hear about new bookings on this plan. Check Apps & Integrations → Calendly.'],
    expired: ['Link expired', 'Start again from Kloomie → Apps & Integrations → Calendly.'],
    denied: ['Not connected', 'Calendly access wasn’t given. You can close this window.'],
    role: ['Not connected', 'Only team owners and admins can connect the team’s Calendly. You can connect your own instead.'],
    failed: ['Not connected', 'Something went wrong talking to Calendly. Try again in a minute.'],
  };
  const done = (res, how) => { res.writeHead(302, { Location: `/calendly/done?r=${how}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); };
  function donePage(req, res, url) {
    const r = url.searchParams.get('r');
    const [title, msg] = Object.hasOwn(DONE, r || '') ? DONE[r] : DONE.failed;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:15px system-ui;background:#f6f6f8;color:#17171c;display:grid;place-items:center;min-height:90vh;margin:0;padding:0 16px"><div style="max-width:440px"><h2>${title}</h2><p>${msg}</p></div></body>`);
  }
  async function callback(req, res, url) {
    const st = url.searchParams.get('state') || '';
    const pend = pending.get(st);
    if (!pend || pend.exp < Date.now()) { pending.delete(st); return done(res, 'expired'); }
    const ws = db.workspaces[pend.wsId];
    const who = ws?.members.find((x) => x.id === pend.memberId);
    if (who && bind.gate(req, res, url, pend, { what: 'Calendly', team: ws.name, person: who.name })) return;
    pending.delete(st);
    if (url.searchParams.get('error')) return done(res, 'denied');
    if (!who) return done(res, 'failed');
    if (pend.scope === 'team' && !['owner', 'admin'].includes(who.role)) return done(res, 'role');
    const code = url.searchParams.get('code') || '';
    if (!code) return done(res, 'failed');
    try {
      const tok = await calendlyToken({ grant_type: 'authorization_code', code, redirect_uri: `${publicUrl}/oauth/calendly/callback`, code_verifier: pend.verifier });
      const c = newConn(ws, { memberId: who.id, member: who.name }, 'calendly', pend.scope);
      c.tokens = seal(tok);
      const me = await calendlyCall(c, 'GET', '/users/me');
      const u = me?.resource || {};
      c.account = { name: clip(u.name, 120), email: clip(u.email, 200), url: /^https:\/\//.test(u.scheduling_url || '') ? clip(u.scheduling_url, 300) : null };
      if (!tok.organization && u.current_organization) c.tokens = seal({ ...tok, organization: u.current_organization });
      if (!tok.owner && u.uri) c.tokens = seal({ ...unseal(c.tokens), owner: u.uri });
      let how = 'connected';
      try { await calendlyHook(c); } catch (e) {
        c.error = /upgrade|paid/i.test(e.message) ? 'Calendly says your plan doesn’t include webhooks, so Kloomie can’t hear about new bookings yet. Upgrade in Calendly, then press Check again here.' : e.message;
        how = 'plan';
      }
      replace(c);
      save();
      broadcast(ws.id, { type: 'bookingConns' });
      return done(res, how);
    } catch (e) {
      alarm('Connecting Calendly failed', e);
      return done(res, 'failed');
    }
  }

  // /api/calendly and /api/calcom: status, connect (team or your own), check again, disconnect.
  async function route(req, res, parts, auth, ws) {
    const [a, b] = parts;
    const app = a === 'calendly' ? 'calendly' : 'calcom';
    const m = req.method;
    if (m === 'GET' && !b) return send(res, 200, status(app, ws, auth));
    const body = m === 'POST' || m === 'DELETE' ? await readJson(req, 10_000).catch(() => ({})) : {};
    const scope = (body.scope || new URL(req.url, 'http://x').searchParams.get('scope')) === 'team' ? 'team' : 'person';
    if (scope === 'team' && !isAdmin(auth)) return send(res, 403, { error: `Only team owners and admins can connect the team’s ${APPS[app]}. You can connect your own.` });
    const c = connFor(ws.id, app, scope, auth.memberId);
    try {
      if (m === 'POST' && b === 'connect' && app === 'calendly') {
        if (!calendlyOn()) return send(res, 400, { error: 'Calendly isn’t set up on this server yet.' });
        const state = rid(24), verifier = b64u(crypto.randomBytes(48));
        for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
        pending.set(state, { wsId: ws.id, memberId: auth.memberId, scope, verifier, browser: bind.start(req, res), exp: Date.now() + STATE_MS });
        const q = new URLSearchParams({ client_id: CALENDLY.id(), response_type: 'code', redirect_uri: `${publicUrl}/oauth/calendly/callback`, scope: CALENDLY.scope, state,
          code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });
        return send(res, 200, { url: `${CALENDLY.auth()}/oauth/authorize?${q}` });
      }
      if (m === 'POST' && b === 'connect' && app === 'calcom') {
        const key = String(body.key || '').trim();
        if (!/^cal_(live|test)_[A-Za-z0-9]{16,}$/.test(key)) return send(res, 400, { error: 'Paste the API key from Cal.com → Settings → Developer → API keys. It starts with cal_live_.' });
        const me = (await calcomCall(key, 'GET', '/me'))?.data || {};
        const n = newConn(ws, auth, 'calcom', scope);
        n.tokens = seal({ key });
        n.last4 = key.slice(-4);
        n.account = { name: clip(me.name || me.username, 120), email: clip(me.email, 200), url: me.username ? `https://cal.com/${clip(me.username, 80)}` : null };
        const secret = b64u(crypto.randomBytes(24));
        const hk = await calcomCall(key, 'POST', '/webhooks', { active: true, subscriberUrl: `${publicUrl}/api/calcom/hook/${n.hookToken}`, triggers: CAL_TRIGGERS, secret });
        n.hook = { id: String(hk?.data?.id ?? ''), secret: seal({ secret }) };
        replace(n);
        save();
        broadcast(ws.id, { type: 'bookingConns' });
        return send(res, 200, status(app, ws, auth));
      }
      if (!c) return send(res, 404, { error: `${APPS[app]} isn’t connected${scope === 'team' ? ' for the team' : ' for you'}.` });
      if (m === 'POST' && b === 'settings') {
        if (scope === 'person' && body.toContacts !== undefined) c.toContacts = !!body.toContacts;
        save();
        broadcast(ws.id, { type: 'bookingConns' });
        return send(res, 200, status(app, ws, auth));
      }
      if (m === 'POST' && b === 'test') {
        if (app === 'calendly') {
          await calendlyCall(c, 'GET', '/users/me');
          if (!c.hook?.id) { try { await calendlyHook(c); c.error = null; } catch (e) { c.error = /upgrade|paid/i.test(e.message) ? 'Calendly says your plan doesn’t include webhooks, so Kloomie can’t hear about new bookings yet. Upgrade in Calendly, then press Check again here.' : e.message; } }
          else c.error = null;
        } else { await calcomCall(calKey(c), 'GET', '/me'); c.error = null; c.needsReconnect = false; }
        save();
        broadcast(ws.id, { type: 'bookingConns' });
        return send(res, 200, { ...status(app, ws, auth), ok: !c.error });
      }
      if (m === 'DELETE' && !b) {
        await gone(c);
        broadcast(ws.id, { type: 'bookingConns' });
        return send(res, 200, status(app, ws, auth));
      }
    } catch (e) {
      if (c && e.auth) { c.error = e.message; c.needsReconnect = true; save(); }
      return send(res, e.status || 502, { error: e.message });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  async function gone(c) {
    delete db.bookingConns[c.id];
    save();
    await (c.app === 'calendly' ? calendlyUnhook(c) : unhookCalcom(c)).catch(() => {});
  }
  // Someone leaves the team: their own connections go (map §1.1). A team deleted: all of them.
  const memberGone = (wsId, memberId) => Promise.all(connsOf(wsId).filter((c) => c.scope === 'person' && c.memberId === memberId).map(gone));
  const teamGone = async (wsId) => { await Promise.all(connsOf(wsId).map(gone)); for (const x of Object.values(db.bookings)) if (x.wsId === wsId) delete db.bookings[x.id]; };

  // GET /api/bookings: the bookings a person may see: their own, and for owners and admins every team booking.
  // since: made after (ms); days: starting from today on, this many days ahead (default 14).
  function list(ws, auth, q = {}) {
    const admin = isAdmin(auth);
    const from = Date.now() - 864e5, to = Date.now() + Math.min(90, Math.max(1, Number(q.days) || 14)) * 864e5;
    const since = Number(q.since) || 0;
    return Object.values(db.bookings).filter((x) => x.wsId === ws.id && (x.memberId === auth.memberId || (admin && x.scope === 'team')) && (since ? x.at >= since : x.start >= from && x.start <= to))
      .sort((p, r) => p.start - r.start).slice(0, 200)
      .map((x) => ({ id: x.id, app: x.app, appName: APPS[x.app], scope: x.scope, title: x.title, start: x.start, end: x.end, when: whenText(ws, x.start), status: x.status, invitee: x.invitee,
        contactId: x.contactId, recordId: x.recordId, visitId: x.visitId, entryId: x.entryId, memberId: x.memberId, location: x.location, answers: x.answers, reason: x.reason || null, moves: x.moves || 0, at: x.at }));
  }
  // For the registry (column-02's server/integrations.js, APPS_REG.register): how a connection stands, from what's kept
  // here only (it's asked every few minutes for every team, so it never calls out). scope 'team' or 'person'.
  const regStatus = (app, scope) => (ws, memberId) => {
    const c = connFor(ws.id, app, scope, memberId);
    if (!c) return null;
    return { account: c.account?.name || c.account?.email || null, by: c.by, byId: c.memberId, lastSync: c.lastAt || c.at, error: c.error || null, needsReconnect: !!c.needsReconnect,
      ...(app === 'calendly' && !c.hook?.id && !c.error ? { setup: 'Press Check again on the tile so Kloomie can hear about new bookings.' } : {}) };
  };
  // Older shape, kept for anything still reading it.
  const describe = {
    calendly: { id: 'calendly', scope: 'team+person', auth: 'oauth', configured: calendlyOn, status: (ws, memberId) => { const c = connFor(ws.id, 'calendly', 'team') || connFor(ws.id, 'calendly', 'person', memberId); return !c ? 'off' : c.error ? 'attention' : c.hook?.id ? 'on' : 'setup'; } },
    caldotcom: { id: 'caldotcom', scope: 'team+person', auth: 'key', configured: () => true, status: (ws, memberId) => { const c = connFor(ws.id, 'calcom', 'team') || connFor(ws.id, 'calcom', 'person', memberId); return !c ? 'off' : c.error ? 'attention' : 'on'; } },
  };
  return { route, hook, callback, donePage, list, memberGone, teamGone, describe, regStatus, calendlyOn, connsOf, take, normalizeCalendly, normalizeCalcom };
}
