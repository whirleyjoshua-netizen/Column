// Leads from the team's website and other tools, straight into Contacts:
// - a lead form, a page of the team's own (/l/<key>) to link to or embed on its website, and
// - a lead webhook (/hooks/lead/<key>) that any site, form builder or lead service can POST to (JSON or a form).
// Someone already in Contacts with the same email or phone gets their empty details filled in and the message added to
// their note; anyone else is a new contact. Either way owners and admins are told, and it sets off the team's
// automations and webhooks like any new contact. One key per team (it can only add leads), replaced in Settings.
// Spam is kept out with a hidden field people never fill, a minimum time on the form, and limits per address and day.
import crypto from 'node:crypto';

const FIELD = { name: ['name', 'full_name', 'fullname', 'your_name', 'contact_name'], first: ['first_name', 'firstname', 'first', 'fname', 'given_name'], last: ['last_name', 'lastname', 'last', 'lname', 'family_name', 'surname'],
  email: ['email', 'email_address', 'e-mail', 'your_email', 'emailaddress'], phone: ['phone', 'phone_number', 'telephone', 'tel', 'mobile', 'cell', 'your_phone', 'phonenumber', 'mobile_phone'], company: ['company', 'business', 'company_name', 'organization', 'business_name'],
  address: ['address', 'street', 'street_address', 'address1', 'address_line_1'], city: ['city', 'town'], message: ['message', 'comments', 'comment', 'notes', 'note', 'details', 'description', 'question', 'your_message'], source: ['source', 'lead_source', 'utm_source'] };
// Field names in other words ("Your phone number", "q4_email", "Full Name"): matched by what they contain.
const FUZZY = [['email', /e-?mail/], ['phone', /phone|mobile|\bcell|\btel\b|telephone|whatsapp/], ['first', /first.?name|given.?name|\bfname\b/], ['last', /last.?name|surname|family.?name|\blname\b/],
  ['company', /company|business|organi[sz]ation/], ['address', /address|street/], ['city', /\bcity\b|\btown\b/], ['message', /message|comment|question|details|describe|tell us|how can we help|project|inquiry|enquiry/], ['name', /name/]];
// Where a field can go (Settings → Match fields).
export const TARGETS = ['name', 'first', 'last', 'email', 'phone', 'company', 'address', 'city', 'message', 'source', 'note', 'ignore'];
// Never kept, whatever a form sends: passwords, card numbers and the like.
const SECRET = /pass(word)?|card.?(num|no)|cc.?num|\bcvv|\bcvc|\bssn\b|social.?sec|routing|iban|account.?num|secret|\btoken\b|api.?key/i;
// Housekeeping fields that aren't worth putting in a note.
const JUNK = /^(_.*|utm_(medium|campaign|term|content)|g-recaptcha.*|recaptcha.*|h-captcha.*|cf-turnstile.*|captcha|csrf.*|nonce|authenticity_token|formid|form_id|form_name|submission_?id|submissionid|ip|type|formtitle|pretty|rawrequest|t|hp|honeypot|action|event|event_id|event_type|webhook|referer|referrer|timestamp|created_at|createdat|id|uuid|slug|lang|locale|consent|gdpr|terms|privacy|submit|gclid|fbclid)$/i;
const clean = (k) => String(k).trim().toLowerCase().replace(/[\s-]+/g, '_');
const str = (v) => (v == null ? '' : Array.isArray(v) ? v.map(str).filter(Boolean).join(', ') : typeof v === 'object' ? String(v.label ?? v.value ?? v.text ?? '') : String(v)).trim();

// Any shape a form tool sends, as a list of [field, value]: flat forms, nested JSON (data.contact.email), lists of
// { label, value } (Tally, Webflow), Typeform's answers, Jotform's rawRequest, first/last parts of a name.
export function flatten(raw) {
  const out = [];
  const seen = new Set();
  const put = (k, v) => {
    const key = String(k || '').trim().slice(0, 80);
    const val = str(v).slice(0, 2000);
    if (!key || !val || SECRET.test(key) || seen.has(key.toLowerCase())) return;
    seen.add(key.toLowerCase());
    out.push([key, val]);
  };
  const typeform = (fr) => {
    const titles = Object.fromEntries((fr.definition?.fields || []).map((f) => [f.id, f.title]));
    for (const a of fr.answers || []) {
      const v = a.type === 'choice' ? a.choice?.label : a.type === 'choices' ? (a.choices?.labels || []).join(', ') : a[a.type];
      const t = a.type === 'email' ? 'email' : a.type === 'phone_number' ? 'phone' : titles[a.field?.id] || a.field?.ref || a.type;
      put(t, v);
    }
  };
  // Inside something that isn't the person (a funnel, a form, a page), a plain "name" or "title" is that thing's.
  const PERSON = /^(data|contact|contacts|lead|person|customer|client|user|submitter|fields|payload|submission|attributes|properties|values|answers|body|record|entry|response|form_data|formdata|object)$/i;
  const walk = (o, depth, parent = '') => {
    if (depth > 5 || o == null) return;
    const own = (k) => (parent && !PERSON.test(parent) && /^(name|title|id|type|email|phone)$/i.test(k) ? `${parent} ${k}` : k);
    if (o.form_response && typeof o.form_response === 'object') typeform(o.form_response);
    for (const [k, v] of Object.entries(o)) {
      if (k === 'form_response') continue;
      if (k === 'rawRequest' && typeof v === 'string') { try { walk(JSON.parse(v), depth + 1, 'data'); } catch {} continue; }
      if (v == null || v === '') continue;
      if (Array.isArray(v)) {
        if (v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x) && ('value' in x || 'answer' in x) && (x.label || x.title || x.name || x.key || x.question))) {
          for (const x of v) put(x.label || x.title || x.name || x.key || x.question, x.value ?? x.answer);
        } else if (v.every((x) => x == null || typeof x !== 'object')) put(k, v);
        else for (const x of v) if (x && typeof x === 'object') walk(x, depth + 1, k);
      } else if (typeof v === 'object') {
        if (('first' in v || 'last' in v) && Object.keys(v).length <= 4) { put('first_name', v.first); put('last_name', v.last); }
        else if ('area' in v && 'phone' in v) put(k, `${v.area} ${v.phone}`);
        else if ('full' in v && typeof v.full === 'string') put(k, v.full);
        else walk(v, depth + 1, k);
      } else put(own(k), v);
    }
  };
  if (raw && typeof raw === 'object') walk(raw, 0);
  return out;
}

export function leadsModule({ db, save, readJson, send, isAdmin, cleanText, contactsOf, newContact, applyContact, emailKey, phoneKey, EMAIL_RE, contactNews, refreshLiveSoon, automate, hook, notifyAdmins, escHtml, brandOf, logoUrl, clientIp, CONTACT_MAX, publicUrl, offline, teamDay }) {
  const settings = (ws) => ({ on: false, key: null, stage: 'New', tags: [], title: '', thanks: '', count: 0, last: null, ...ws.leadCapture });
  const byKey = (key) => key && Object.values(db.workspaces).find((w) => w.leadCapture?.key === key && w.leadCapture.on && !w.deleteAt && !offline(w.id));
  const hits = new Map(); // `${wsId}:${ip}` → times, and `${wsId}:day` → count
  function allowed(ws, ip) {
    const now = Date.now();
    const k = `${ws.id}:${ip}`;
    const mine = (hits.get(k) || []).filter((t) => now - t < 3600_000);
    if (mine.length >= 10) return false;
    const day = `${ws.id}:${teamDay(ws.id)}`;
    if ((hits.get(day) || 0) >= 500) return false;
    mine.push(now);
    hits.set(k, mine);
    hits.set(day, (hits.get(day) || 0) + 1);
    return true;
  }
  // A lead from any form: the team's own matches first (Settings → Match fields), then the usual names, then names
  // that contain them. Fields left over go in the note as "Field: value", so nothing the person typed is lost.
  // Returns the lead and how each field was read (for the lead log).
  function normalize(raw, map = {}) {
    const pairs = flatten(raw);
    const lead = { name: '', first: '', last: '', email: '', phone: '', company: '', address: '', city: '', message: '', source: '' };
    const to = new Map(); // field → where it went
    const put = (k, v, target) => {
      if (target === 'ignore') return to.set(k, 'ignore');
      if (target === 'note' || target === 'message') { lead.message = [lead.message, target === 'note' ? `${k}: ${v}` : v].filter(Boolean).join('\n'); return to.set(k, target); }
      if (lead[target]) return false;
      lead[target] = v;
      to.set(k, target);
    };
    const mine = Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [clean(k), v]));
    for (const [k, v] of pairs) if (mine[clean(k)] && TARGETS.includes(mine[clean(k)])) put(k, v, mine[clean(k)]);
    const exact = Object.fromEntries(Object.entries(FIELD).flatMap(([t, names]) => names.map((n) => [clean(n), t])));
    for (const [k, v] of pairs) if (!to.has(k) && exact[clean(k)] && !lead[exact[clean(k)]]) put(k, v, exact[clean(k)]);
    if (!lead.name && (lead.first || lead.last)) lead.name = [lead.first, lead.last].filter(Boolean).join(' ');
    for (const [k, v] of pairs) {
      if (to.has(k) || JUNK.test(clean(k))) continue;
      const words = clean(k).replace(/_/g, ' ');
      const hit = FUZZY.find(([t, re]) => re.test(words) && !lead[t] && (t !== 'email' || EMAIL_RE.test(v)));
      if (hit) put(k, v, hit[0]);
    }
    // Still no email: a value that is plainly one.
    if (!lead.email) { const e = pairs.find(([k, v]) => !to.has(k) && EMAIL_RE.test(v)); if (e) put(e[0], e[1], 'email'); }
    for (const [k, v] of pairs) if (!to.has(k) && !JUNK.test(clean(k))) put(k, v, 'note');
    if (!lead.name) lead.name = [lead.first, lead.last].filter(Boolean).join(' ');
    const fields = pairs.map(([k, v]) => ({ k, v: v.slice(0, 200), to: to.get(k) || 'ignore' })).slice(0, 40);
    return { lead, fields };
  }
  // Adds or updates the contact. Returns { contact, added }.
  function take(ws, lead, via) {
    const s = settings(ws);
    const email = EMAIL_RE.test(lead.email) ? lead.email : '';
    if (!lead.name && !email && !lead.phone) throw Object.assign(new Error('Send at least a name and an email or phone number.'), { status: 400 });
    if (!email && !lead.phone) throw Object.assign(new Error('Send an email or a phone number, so the team can get back to you.'), { status: 400 });
    const label = { form: 'form', webhook: 'webhook', snippet: 'website' }[via] || via;
    const note = lead.message ? `${teamDay(ws.id)} (${label}): ${lead.message}`.slice(0, 1500) : '';
    const all = contactsOf(ws.id);
    const ek = emailKey(email), pk = phoneKey(lead.phone);
    let x = all.find((c) => (ek && emailKey(c.email) === ek) || (pk && phoneKey(c.phone) === pk));
    let added = false;
    if (x) {
      const fill = Object.fromEntries(['name', 'company', 'phone', 'address', 'city'].filter((k) => lead[k] && !x[k]).map((k) => [k, lead[k]]));
      if (email && !x.email) fill.email = email;
      // The same message twice (a site sending it to the webhook and through the snippet): kept once.
      const dupe = lead.message && (x.note || '').includes(lead.message.slice(0, 200));
      applyContact(x, { ...fill, tags: [...x.tags, ...s.tags], ...(note && !dupe ? { note: [x.note, note].filter(Boolean).join('\n') } : {}) });
    } else {
      if (all.length >= CONTACT_MAX) throw Object.assign(new Error('This team’s contact list is full.'), { status: 409 });
      const by = { form: 'Lead form', snippet: 'Website' }[via] || 'Lead webhook';
      x = applyContact(newContact(ws.id, by), { name: lead.name, company: lead.company, email, phone: lead.phone, address: lead.address, city: lead.city,
        source: lead.source || { form: 'Website form', snippet: lead.site ? `Website (${lead.site})` : 'Website' }[via] || 'Lead webhook', stage: s.stage || '', tags: s.tags, note });
      db.contacts[x.id] = x;
      added = true;
    }
    ws.leadCapture = { ...s, count: (s.count || 0) + 1, last: Date.now() };
    save();
    contactNews(ws.id, x);
    refreshLiveSoon(ws.id);
    if (added) {
      automate(ws.id, 'contact.added', { contact: x, stage: x.stage, who: { form: 'Lead form', snippet: 'Website' }[via] || 'Lead webhook' });
      hook(ws.id, 'contact.created', x);
    } else hook(ws.id, 'contact.updated', x);
    notifyAdmins(ws.id, { title: `${added ? 'New lead' : 'Lead again'}: ${x.name || x.email || x.phone}`, text: [x.email, x.phone, lead.message].filter(Boolean).join(' · ').slice(0, 300), kind: 'lead', go: 'contact:' + x.id, key: 'lead:' + x.id });
    return { contact: x, added };
  }

  // ---------- what came in (Settings → Recent leads), and the field names seen (Match fields) ----------
  const LOG_MAX = 30;
  function logIt(ws, entry, fields = []) {
    const s = settings(ws);
    const log = [{ id: crypto.randomBytes(6).toString('base64url'), at: Date.now(), ...entry, fields }, ...(s.log || [])].slice(0, LOG_MAX);
    const seenF = { ...(s.seen || {}) };
    for (const f of entry.via === 'test' ? [] : fields) {
      if (JUNK.test(clean(f.k))) continue;
      seenF[f.k] = { n: (seenF[f.k]?.n || 0) + 1, at: Date.now(), ex: f.v.slice(0, 60) };
    }
    const keys = Object.keys(seenF).sort((a, b) => seenF[b].at - seenF[a].at).slice(0, 60);
    ws.leadCapture = { ...settings(ws), log, seen: Object.fromEntries(keys.map((k) => [k, seenF[k]])) };
    save();
  }
  // One lead from anywhere, logged whatever happens.
  function receive(ws, raw, via, from) {
    const s = settings(ws);
    const { lead, fields } = normalize(raw, s.map);
    if (from?.site) lead.site = from.site;
    try {
      const r = take(ws, lead, via);
      logIt(ws, { via, from: from?.page || null, result: r.added ? 'added' : 'updated', contactId: r.contact.id, who: r.contact.name || r.contact.email || r.contact.phone }, fields);
      return r;
    } catch (e) {
      logIt(ws, { via, from: from?.page || null, result: 'refused', error: e.message, who: lead.name || lead.email || lead.phone || '' }, fields);
      throw e;
    }
  }

  // ---------- the form page ----------
  const page = (res, code, ws, body, { embed } = {}) => {
    const brand = ws ? brandOf(ws) : {};
    const accent = /^#[0-9a-f]{6}$/i.test(brand.accent || '') ? brand.accent : '#6b5cf0';
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors *`, ...(embed ? {} : {}) });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(ws ? settings(ws).title || 'Contact ' + ws.name : 'Not available')}</title>
<style>:root{color-scheme:light;--accent:${accent}}*{box-sizing:border-box}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:${embed ? 'transparent' : '#f5f5f8'};color:#16161a}
main{max-width:520px;margin:0 auto;padding:${embed ? '8px' : '40px 18px'}}.card{background:#fff;border:1px solid #e4e4ea;border-radius:14px;padding:24px}h1{font-size:22px;margin:0 0 6px}p.lead{color:#6b6b76;margin:0 0 18px}
label{display:block;font-size:14px;font-weight:600;margin:12px 0 4px}input,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid #d6d6de;border-radius:9px}textarea{min-height:100px;resize:vertical}
button{margin-top:18px;width:100%;font:inherit;font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:10px;padding:12px;cursor:pointer}.hp{position:absolute;left:-5000px}.logo{max-height:44px;margin-bottom:10px}.err{color:#b42318;font-weight:600}.muted{color:#6b6b76;font-size:13px;text-align:center;margin-top:14px}</style></head>
<body><main><div class="card">${body}</div>${embed ? '' : '<p class="muted">Sent with Kloomie</p>'}</main></body></html>`);
  };
  function formBody(ws, key, embed, err, v = {}) {
    const s = settings(ws);
    const brand = brandOf(ws);
    const f = (name, label, type = 'text', extra = '') => `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escHtml(v[name] || '')}" ${extra}>`;
    return `${brand.logo ? `<img class="logo" src="${escHtml(logoUrl(brand.logo))}" alt="">` : ''}<h1>${escHtml(s.title || `Contact ${ws.name}`)}</h1><p class="lead">Leave your details and we’ll get back to you.</p>
${err ? `<p class="err">${escHtml(err)}</p>` : ''}<form method="post" action="/l/${escHtml(key)}${embed ? '?embed=1' : ''}">
${f('name', 'Your name', 'text', 'required autocomplete="name"')}${f('phone', 'Phone', 'tel', 'autocomplete="tel"')}${f('email', 'Email', 'email', 'autocomplete="email"')}${f('address', 'Address (optional)', 'text', 'autocomplete="street-address"')}
<label for="message">How can we help?</label><textarea id="message" name="message">${escHtml(v.message || '')}</textarea>
<div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div><input type="hidden" name="t" value="${Date.now()}">
<button type="submit">Send</button></form>`;
  }
  async function readText(req) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 100_000) throw new Error('too big'); }
    try { return JSON.parse(body); } catch { return Object.fromEntries(new URLSearchParams(body)); }
  }
  // multipart/form-data (Jotform and others): the text fields; files are skipped.
  async function readMultipart(req, type) {
    const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
    if (!boundary) throw new Error('no boundary');
    const chunks = [];
    let n = 0;
    for await (const c of req) { n += c.length; if (n > 2_000_000) throw new Error('too big'); chunks.push(c); }
    const body = Buffer.concat(chunks).toString('latin1');
    const out = {};
    for (const part of body.split('--' + boundary)) {
      const m = /^\r\n([\s\S]*?)\r\n\r\n([\s\S]*?)\r\n$/.exec(part);
      if (!m) continue;
      const name = /name="([^"]*)"/i.exec(m[1])?.[1];
      if (!name || /filename=/i.test(m[1])) continue;
      out[name] = Buffer.from(m[2], 'latin1').toString('utf8');
    }
    return out;
  }
  async function readForm(req) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 30_000) break; }
    return Object.fromEntries(new URLSearchParams(body));
  }
  async function formPage(req, res, url) {
    const key = url.pathname.split('/')[2];
    const ws = byKey(key);
    const embed = url.searchParams.has('embed');
    if (!ws) return page(res, 404, null, '<h1>Not available</h1><p class="lead">This form isn’t taking requests right now.</p>', { embed });
    if (req.method === 'GET') return page(res, 200, ws, url.searchParams.has('sent') ? `<h1>Thank you!</h1><p class="lead">${escHtml(settings(ws).thanks || `${ws.name} has your message and will be in touch soon.`)}</p>` : formBody(ws, key, embed), { embed });
    const form = await readForm(req);
    // Bots: the hidden field filled in, or sent faster than a person could type. They're thanked and nothing is kept.
    const thanks = () => { res.writeHead(303, { Location: `/l/${key}?sent=1${embed ? '&embed=1' : ''}` }); res.end(); };
    if (form.website || (Number(form.t) && Date.now() - Number(form.t) < 2500)) return thanks();
    if (!allowed(ws, clientIp(req))) return page(res, 429, ws, formBody(ws, key, embed, 'That’s a lot of messages. Please wait a while and try again.', form), { embed });
    try {
      receive(ws, form, 'form', null);
    } catch (e) {
      return page(res, e.status || 400, ws, formBody(ws, key, embed, e.message, form), { embed });
    }
    return thanks();
  }
  // ---------- the webhook ----------
  async function webhook(req, res, url) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST a lead here.' }, cors);
    const ws = byKey(url.pathname.split('/')[3]);
    if (!ws) return send(res, 404, { error: 'This lead address isn’t taking leads. Check it in Kloomie → Settings → Connections.' }, cors);
    if (!allowed(ws, clientIp(req))) return send(res, 429, { error: 'Too many leads from here. Wait a while and try again.' }, cors);
    const type = String(req.headers['content-type'] || '');
    let raw;
    try {
      raw = type.includes('application/json') ? await readJson(req, 100_000) : type.includes('multipart/form-data') ? await readMultipart(req, type) : type.includes('text/plain') ? await readText(req) : await readForm(req);
    } catch {
      return send(res, 400, { error: 'Send the lead as JSON or a form.' }, cors);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return send(res, 400, { error: 'Send the lead as JSON or a form.' }, cors);
    // From the website snippet (k.js): the page it was sent from comes along. (A site's own "website" field isn't our
    // spam trap, so that check is only for leads sent another way.)
    const snippet = raw._via === 'snippet';
    if (raw.website && !snippet) { logIt(ws, { via: 'webhook', result: 'spam' }); return send(res, 200, { ok: true }, cors); }
    let from = null;
    if (raw._page) { try { const u = new URL(String(raw._page)); from = { page: (u.host + u.pathname).slice(0, 200), site: u.host.replace(/^www\./, '') }; } catch {} }
    try {
      const { contact, added } = receive(ws, raw, snippet ? 'snippet' : 'webhook', from);
      return send(res, added ? 201 : 200, { ok: true, contact_id: contact.id, added }, cors);
    } catch (e) {
      return send(res, e.status || 400, { error: e.message }, cors);
    }
  }
  // ---------- settings ----------
  const publicSettings = (ws) => {
    const s = settings(ws);
    return { ...s, log: s.log || [], seen: s.seen || {}, map: s.map || {}, targets: TARGETS, formUrl: s.key ? `${publicUrl}/l/${s.key}` : null, webhookUrl: s.key ? `${publicUrl}/hooks/lead/${s.key}` : null,
      snippet: s.key ? `<script src="${publicUrl}/k.js" data-key="${s.key}" async></script>` : null };
  };
  async function route(req, res, parts, auth, ws) {
    if (parts[0] !== 'lead-capture') return null;
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins set up lead capture.' });
    const m = req.method;
    if (m === 'GET') return send(res, 200, publicSettings(ws));
    if (m === 'PUT') {
      const body = await readJson(req, 10_000);
      const s = settings(ws);
      if (body.on !== undefined) s.on = !!body.on;
      if (s.on && !s.key) s.key = crypto.randomBytes(12).toString('base64url');
      if (body.stage !== undefined) s.stage = cleanText(body.stage, 40);
      if (body.tags !== undefined) s.tags = [...new Set((Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(/[;,]/)).map((t) => cleanText(t, 40)).filter(Boolean))].slice(0, 10);
      if (body.title !== undefined) s.title = cleanText(body.title, 100);
      if (body.thanks !== undefined) s.thanks = cleanText(body.thanks, 400);
      if (body.map !== undefined && body.map && typeof body.map === 'object') {
        s.map = Object.fromEntries(Object.entries(body.map).filter(([k, v]) => String(k).trim() && TARGETS.includes(v)).slice(0, 80).map(([k, v]) => [String(k).trim().slice(0, 80), v]));
      }
      ws.leadCapture = s;
      save();
      return send(res, 200, publicSettings(ws));
    }
    // A test lead through the same reading as a real one, not saved: shows what Kloomie would do with it.
    if (m === 'POST' && parts[1] === 'test') {
      const body = await readJson(req, 30_000);
      const sample = body.fields && typeof body.fields === 'object' ? body.fields : { first_name: 'Test', last_name: 'Lead', email: 'test.lead@example.com', phone: '555-0100', message: 'This is a test from Kloomie.' };
      const { lead, fields } = normalize(sample, settings(ws).map);
      const ok = !!(lead.email && EMAIL_RE.test(lead.email)) || !!lead.phone;
      logIt(ws, { via: 'test', result: ok ? 'test' : 'refused', error: ok ? null : 'No email or phone number found, so a real one would be refused.', who: lead.name || lead.email || lead.phone || '' }, fields);
      return send(res, 200, { lead, fields, ok, ...publicSettings(ws) });
    }
    if (m === 'DELETE' && parts[1] === 'log') {
      ws.leadCapture = { ...settings(ws), log: [] };
      save();
      return send(res, 200, publicSettings(ws));
    }
    // A new key: the old link and address stop working.
    if (m === 'POST' && parts[1] === 'new-key') {
      ws.leadCapture = { ...settings(ws), key: crypto.randomBytes(12).toString('base64url') };
      save();
      return send(res, 200, publicSettings(ws));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  // The website snippet: one line on a site, and every form people send there also lands in Kloomie (the site's own
  // form keeps working as before). Skips forms with a password, card numbers and the like; data-kloomie-ignore on a
  // form leaves it out; data-forms="<selector>" on the script limits it to those forms.
  function snippetJs(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' });
    res.end(SNIPPET);
  }
  return { route, formPage, webhook, normalize, snippetJs };
}

const SNIPPET = `/* Kloomie: copies what people send in this site's forms into the team's Kloomie Contacts. */
(function () {
  var s = document.currentScript; if (!s) return;
  var key = s.getAttribute('data-key'); if (!key) return;
  var url = s.src.replace(/\\/k\\.js(\\?.*)?$/, '') + '/hooks/lead/' + encodeURIComponent(key);
  var only = s.getAttribute('data-forms');
  var BAD = /pass|card|cc-?num|cvv|cvc|ssn|social|iban|routing|account.?num|secret|token|captcha|csrf|nonce/i;
  var KEEP_HIDDEN = /utm_|source|campaign|gclid|fbclid|service|product/i;
  function label(el) {
    var l = el.id && document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
    var t = (l && l.textContent) || (el.closest && el.closest('label') && el.closest('label').textContent) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    return t.replace(/[*:]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 60);
  }
  function nameOf(el) {
    var n = el.name || '';
    var words = n.replace(/[\\[\\]\\d_\\-.]+/g, ' ').replace(/\\b(input|field|fields|form|wpforms|item|entry|your|q|element|text|textarea|data)\\b/gi, ' ').replace(/\\s+/g, '');
    return words.length >= 3 ? n : (label(el) || n);
  }
  document.addEventListener('submit', function (e) {
    try {
      var f = e.target;
      if (!f || f.tagName !== 'FORM' || f.hasAttribute('data-kloomie-ignore') || (only && !f.matches(only))) return;
      if (f.querySelector('input[type=password]')) return;
      var d = new URLSearchParams(), any = false;
      for (var i = 0; i < f.elements.length; i++) {
        var el = f.elements[i], t = (el.type || '').toLowerCase();
        if (!el.name || el.disabled || /^(file|password|submit|button|reset|image)$/.test(t)) continue;
        if ((t === 'checkbox' || t === 'radio') && !el.checked) continue;
        if (BAD.test(el.name) || BAD.test(el.getAttribute('autocomplete') || '')) continue;
        if (t === 'hidden' && !KEEP_HIDDEN.test(el.name)) continue;
        var v = el.multiple && el.options ? Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; }).join(', ') : el.value;
        if (!v || !String(v).trim()) continue;
        d.append(nameOf(el), String(v).slice(0, 2000)); any = true;
      }
      if (!any) return;
      var q = new URLSearchParams(location.search);
      ['utm_source', 'utm_campaign', 'gclid', 'fbclid'].forEach(function (k) { if (q.get(k) && !d.has(k)) d.append(k, q.get(k)); });
      d.append('_page', location.href.slice(0, 500)); d.append('_title', document.title.slice(0, 200)); d.append('_via', 'snippet');
      if (navigator.sendBeacon && navigator.sendBeacon(url, d)) return;
      fetch(url, { method: 'POST', body: d, keepalive: true, mode: 'no-cors' });
    } catch (x) {}
  }, true);
})();
`;
