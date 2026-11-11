// Text messages through the team's own Twilio account. An owner or admin pastes the Account SID, auth token and the
// Twilio phone number; Kloomie checks them with Twilio and points that number's incoming texts at Kloomie. Texts the
// team sends (on my way, visit reminders, review requests, or typed on a contact) go out from that number, and
// replies come back onto the contact they're from (a number Kloomie doesn't know becomes a new contact, a lead).
// STOP and the like mark the contact do not contact; START undoes it. Nothing is ever texted to someone marked do not
// contact. The auth token is kept encrypted, and every incoming request's X-Twilio-Signature is checked with it.
//
// Twilio bills the team directly (its number, each text, and US carrier registration, A2P 10DLC), never Kloomie.
import crypto from 'node:crypto';

const env = (k) => process.env[k] || '';
const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|revoke)\s*$/i;
const START = /^\s*(start|unstop|yes|subscribe)\s*$/i;

// A phone number as Twilio wants it (E.164). Ten digits are taken as US/Canada.
export function e164(v) {
  const s = String(v || '').trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 8 && digits.length <= 15) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}
// Twilio's request signature: HMAC-SHA1 of the full URL plus each POST parameter (sorted by name) as name+value.
export function twilioSignature(token, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', token).update(data).digest('base64');
}

export function twilioModule({ db, save, broadcast, seal, unseal, readJson, send, isAdmin, rid, cleanText, publicUrl, contactsOf, phoneKey, noContact, newContact, contactNews, notifyAdmins, hook, alarm, offline, teamDay }) {
  db.twilio ||= {};
  db.texts ||= {};
  const api = () => env('TWILIO_API') || 'https://api.twilio.com';
  const conn = (wsId) => db.twilio[wsId] || null;
  const on = (wsId) => !!conn(wsId) && !offline(wsId);
  const creds = (c) => unseal(c.token).t;
  async function call(sid, token, method, path, form) {
    const r = await fetch(`${api()}/2010-04-01/Accounts/${encodeURIComponent(sid)}${path}`, {
      method,
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), Accept: 'application/json', ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message || `Twilio said ${r.status}`), { status: r.status, code: j.code });
    return j;
  }
  const smsUrl = (c) => `${publicUrl}/twilio/sms/${c.hook}`;
  const statusUrl = (c) => `${publicUrl}/twilio/status/${c.hook}`;
  const publicText = ({ wsId, ...t }) => t;
  const state = (wsId) => {
    const c = conn(wsId);
    return c ? { connected: true, number: c.from, account: c.account, by: c.by, at: c.at, trial: !!c.trial, error: c.error || null, sent: Object.values(db.texts).filter((t) => t.wsId === wsId && t.dir === 'out').length } : { connected: false };
  };

  // ---------- sending ----------
  // One text from the team's number. Throws with Twilio's reason when it's refused.
  async function sendText(wsId, contact, body, by, extra = {}) {
    const c = conn(wsId);
    if (!c || offline(wsId)) throw Object.assign(new Error('Connect Twilio first, in Settings → Connections.'), { status: 400 });
    if (contact && noContact(contact)) throw Object.assign(new Error(`${contact.name || 'They'} is marked do not contact.`), { status: 400 });
    const to = e164(contact?.phone || extra.to);
    if (!to) throw Object.assign(new Error('There’s no phone number Kloomie can text.'), { status: 400 });
    const text = cleanText(body, 1500).replace(/\s+\n/g, '\n');
    if (!text) throw Object.assign(new Error('Write the message first.'), { status: 400 });
    const t = { id: rid(), wsId, contactId: contact?.id || null, dir: 'out', to, from: c.from, body: text, by, status: 'sending', sid: null, error: null, at: Date.now(), recordId: extra.recordId || null, what: extra.what || null };
    db.texts[t.id] = t;
    try {
      const m = await call(c.sid, creds(c), 'POST', '/Messages.json', { To: to, From: c.from, Body: text, StatusCallback: statusUrl(c) });
      Object.assign(t, { sid: m.sid, status: m.status || 'queued' });
    } catch (e) {
      Object.assign(t, { status: 'failed', error: String(e.message).slice(0, 300) });
      save();
      news(t);
      throw Object.assign(new Error(`Twilio didn’t send it: ${e.message}`), { status: 502 });
    }
    save();
    news(t);
    return t;
  }
  const news = (t) => broadcast(t.wsId, { type: 'text', text: publicText(t), forAdmins: true });

  // ---------- coming in from Twilio ----------
  async function readForm(req) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 50_000) break; }
    return Object.fromEntries(new URLSearchParams(body));
  }
  // Twilio signs with the address it was given; behind a proxy, that's PUBLIC_URL plus the path.
  function trusted(req, c, path, params) {
    const sig = String(req.headers['x-twilio-signature'] || '');
    const want = twilioSignature(creds(c), `${publicUrl}${path}`, params);
    return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  }
  const twiml = (res) => { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); };
  async function incoming(req, res, url) {
    const [, , kind, hookId] = url.pathname.split('/');
    const entry = Object.entries(db.twilio).find(([, c]) => c.hook === hookId);
    if (!entry || req.method !== 'POST') return send(res, 404, 'Not found');
    const [wsId, c] = entry;
    const p = await readForm(req);
    if (!trusted(req, c, url.pathname, p)) return send(res, 403, 'Bad signature');
    if (offline(wsId)) return twiml(res);
    if (kind === 'status') {
      const t = Object.values(db.texts).find((x) => x.wsId === wsId && x.sid === p.MessageSid);
      if (t) {
        const RANK = { queued: 0, accepted: 0, sending: 1, sent: 2, delivered: 3, undelivered: 3, failed: 3, read: 4 };
        if (p.MessageStatus && (RANK[p.MessageStatus] ?? 0) >= (RANK[t.status] ?? 0)) t.status = p.MessageStatus;
        if (p.ErrorCode) t.error = `Error ${p.ErrorCode}${p.ErrorCode === '30034' ? ': the number isn’t registered for US texting yet (A2P 10DLC)' : ''}`;
        save();
        news(t);
      }
      return twiml(res);
    }
    // A text from a customer.
    if (Object.values(db.texts).some((x) => x.wsId === wsId && x.sid === p.MessageSid)) return twiml(res);
    const from = e164(p.From) || String(p.From || '').slice(0, 20);
    const body = String(p.Body || '').slice(0, 1600);
    const key = phoneKey(from);
    let contact = key && contactsOf(wsId).find((x) => phoneKey(x.phone) === key);
    if (!contact) {
      contact = newContact(wsId, 'Text');
      Object.assign(contact, { name: '', phone: from, source: 'Text message' });
      db.contacts[contact.id] = contact;
      contactNews(wsId, contact);
      hook(wsId, 'contact.created', contact);
    }
    if (STOP.test(body)) { contact.dne = true; contact.updatedAt = Date.now(); contactNews(wsId, contact); }
    else if (START.test(body) && contact.dne) { contact.dne = false; contact.updatedAt = Date.now(); contactNews(wsId, contact); }
    const t = { id: rid(), wsId, contactId: contact.id, dir: 'in', from, to: p.To || c.from, body, by: contact.name || from, status: 'received', sid: p.MessageSid || null, error: null, at: Date.now() };
    db.texts[t.id] = t;
    save();
    news(t);
    notifyAdmins(wsId, { title: `Text from ${contact.name || from}`, text: body.slice(0, 200), kind: 'text', go: 'contact:' + contact.id, key: 'text:' + contact.id });
    hook(wsId, 'text.received', { id: t.id, from, body, contact_id: contact.id, contact_name: contact.name || null, received_at: new Date(t.at).toISOString() });
    return twiml(res);
  }

  // ---------- connecting ----------
  async function route(req, res, parts, auth, ws) {
    const [a, b, c2, d] = parts;
    // The texts with one contact, and sending one.
    if (a === 'contacts' && b && c2 === 'texts') {
      if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins can see Contacts.' });
      const contact = db.contacts[b];
      if (!contact || contact.wsId !== ws.id) return send(res, 404, { error: 'Not found' });
      if (req.method === 'GET') return send(res, 200, Object.values(db.texts).filter((t) => t.wsId === ws.id && t.contactId === contact.id).sort((x, y) => x.at - y.at).slice(-200).map(publicText));
      if (req.method === 'POST') {
        const body = await readJson(req, 10_000);
        return send(res, 200, publicText(await sendText(ws.id, contact, body.body, auth.member, { what: 'text' })));
      }
      return send(res, 405, { error: 'Method not allowed' });
    }
    if (a !== 'texting') return null;
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins connect Twilio.' });
    const m = req.method;
    if (m === 'GET' && !b) return send(res, 200, state(ws.id));
    if (m === 'PUT' && !b) {
      const body = await readJson(req, 5_000);
      const sid = String(body.sid || '').trim();
      const token = String(body.token || '').trim();
      const from = e164(body.number);
      if (!/^AC[0-9a-f]{32}$/i.test(sid)) return send(res, 400, { error: 'The Account SID starts with AC and is 34 characters. It’s on your Twilio Console home page.' });
      if (!/^[0-9a-f]{32}$/i.test(token)) return send(res, 400, { error: 'The auth token is 32 letters and numbers, under Account SID on the Twilio Console.' });
      if (!from) return send(res, 400, { error: 'Enter your Twilio phone number, like +1 702 555 0142.' });
      let account, nums;
      try {
        account = await call(sid, token, 'GET', '.json');
        nums = await call(sid, token, 'GET', `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`);
      } catch (e) {
        return send(res, 400, { error: e.status === 401 ? 'Twilio didn’t accept that Account SID and auth token.' : `Couldn’t reach Twilio: ${e.message}` });
      }
      const num = (nums.incoming_phone_numbers || [])[0];
      if (!num) return send(res, 400, { error: `${from} isn’t a number in that Twilio account. Buy one in Twilio (Phone Numbers → Buy a number), or check it.` });
      const old = conn(ws.id);
      const cnx = { sid, token: seal({ t: token }), from, numberSid: num.sid, account: account.friendly_name || 'Twilio', trial: account.type === 'Trial', hook: old?.hook || crypto.randomBytes(18).toString('base64url'), by: auth.member, at: Date.now(), error: null };
      // Texts to the number come to Kloomie.
      try {
        await call(sid, token, 'POST', `/IncomingPhoneNumbers/${num.sid}.json`, { SmsUrl: smsUrl(cnx), SmsMethod: 'POST' });
      } catch (e) {
        cnx.error = `Replies won’t reach Kloomie: Twilio wouldn’t set the number’s messaging address (${e.message}).`;
      }
      db.twilio[ws.id] = cnx;
      save();
      broadcast(ws.id, { type: 'texting', forAdmins: true });
      return send(res, 200, state(ws.id));
    }
    if (m === 'POST' && b === 'test') {
      const body = await readJson(req, 2_000);
      const t = await sendText(ws.id, null, `Kloomie test from ${ws.name}: texting works.`, auth.member, { to: body.to, what: 'test' });
      return send(res, 200, publicText(t));
    }
    if (m === 'DELETE' && !b) {
      await disconnect(ws.id);
      return send(res, 200, state(ws.id));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  // Stops using the account: the number's messaging address is cleared if it's still Kloomie's.
  async function disconnect(wsId) {
    const c = conn(wsId);
    if (!c) return;
    try {
      const num = await call(c.sid, creds(c), 'GET', `/IncomingPhoneNumbers/${c.numberSid}.json`);
      if (num.sms_url === smsUrl(c)) await call(c.sid, creds(c), 'POST', `/IncomingPhoneNumbers/${c.numberSid}.json`, { SmsUrl: '' });
    } catch {}
    delete db.twilio[wsId];
    save();
    broadcast(wsId, { type: 'texting', forAdmins: true });
  }
  return { route, incoming, sendText, on, state, disconnect, e164 };
}
