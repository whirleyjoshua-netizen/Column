// Leads from the team's website and other tools, straight into Contacts:
// - a lead form, a page of the team's own (/l/<key>) to link to or embed on its website, and
// - a lead webhook (/hooks/lead/<key>) that any site, form builder or lead service can POST to (JSON or a form).
// Someone already in Contacts with the same email or phone gets their empty details filled in and the message added to
// their note; anyone else is a new contact. Either way owners and admins are told, and it sets off the team's
// automations and webhooks like any new contact. One key per team (it can only add leads), replaced in Settings.
// Spam is kept out with a hidden field people never fill, a minimum time on the form, and limits per address and day.
import crypto from 'node:crypto';

const FIELD = { name: ['name', 'full_name', 'fullname', 'your_name', 'contact_name'], first: ['first_name', 'firstname', 'first'], last: ['last_name', 'lastname', 'last'],
  email: ['email', 'email_address', 'e-mail', 'your_email'], phone: ['phone', 'phone_number', 'telephone', 'tel', 'mobile', 'cell', 'your_phone'], company: ['company', 'business', 'company_name', 'organization'],
  address: ['address', 'street', 'street_address'], city: ['city', 'town'], message: ['message', 'comments', 'comment', 'notes', 'note', 'details', 'description', 'question'], source: ['source', 'lead_source', 'utm_source'] };

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
  const pick = (src, keys) => { for (const k of keys) { const v = src[k] ?? src[k.toUpperCase()] ?? src[k.replace(/_/g, ' ')]; if (v != null && String(v).trim()) return String(v).trim(); } return ''; };
  // A lead from any shape of form: the usual field names, in any case.
  function normalize(raw) {
    const src = Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [String(k).trim().toLowerCase(), Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : v]));
    const name = pick(src, FIELD.name) || [pick(src, FIELD.first), pick(src, FIELD.last)].filter(Boolean).join(' ');
    return { name, email: pick(src, FIELD.email), phone: pick(src, FIELD.phone), company: pick(src, FIELD.company), address: pick(src, FIELD.address), city: pick(src, FIELD.city), message: pick(src, FIELD.message), source: pick(src, FIELD.source) };
  }
  // Adds or updates the contact. Returns { contact, added }.
  function take(ws, lead, via) {
    const s = settings(ws);
    const email = EMAIL_RE.test(lead.email) ? lead.email : '';
    if (!lead.name && !email && !lead.phone) throw Object.assign(new Error('Send at least a name and an email or phone number.'), { status: 400 });
    if (!email && !lead.phone) throw Object.assign(new Error('Send an email or a phone number, so the team can get back to you.'), { status: 400 });
    const note = lead.message ? `${teamDay(ws.id)} (${via}): ${lead.message}`.slice(0, 1500) : '';
    const all = contactsOf(ws.id);
    const ek = emailKey(email), pk = phoneKey(lead.phone);
    let x = all.find((c) => (ek && emailKey(c.email) === ek) || (pk && phoneKey(c.phone) === pk));
    let added = false;
    if (x) {
      const fill = Object.fromEntries(['name', 'company', 'phone', 'address', 'city'].filter((k) => lead[k] && !x[k]).map((k) => [k, lead[k]]));
      if (email && !x.email) fill.email = email;
      applyContact(x, { ...fill, tags: [...x.tags, ...s.tags], ...(note ? { note: [x.note, note].filter(Boolean).join('\n') } : {}) });
    } else {
      if (all.length >= CONTACT_MAX) throw Object.assign(new Error('This team’s contact list is full.'), { status: 409 });
      x = applyContact(newContact(ws.id, via === 'form' ? 'Lead form' : 'Lead webhook'), { name: lead.name, company: lead.company, email, phone: lead.phone, address: lead.address, city: lead.city,
        source: lead.source || (via === 'form' ? 'Website form' : 'Lead webhook'), stage: s.stage || '', tags: s.tags, note });
      db.contacts[x.id] = x;
      added = true;
    }
    ws.leadCapture = { ...s, count: (s.count || 0) + 1, last: Date.now() };
    save();
    contactNews(ws.id, x);
    refreshLiveSoon(ws.id);
    if (added) {
      automate(ws.id, 'contact.added', { contact: x, stage: x.stage, who: via === 'form' ? 'Lead form' : 'Lead webhook' });
      hook(ws.id, 'contact.created', x);
    } else hook(ws.id, 'contact.updated', x);
    notifyAdmins(ws.id, { title: `${added ? 'New lead' : 'Lead again'}: ${x.name || x.email || x.phone}`, text: [x.email, x.phone, lead.message].filter(Boolean).join(' · ').slice(0, 300), kind: 'lead', go: 'contact:' + x.id, key: 'lead:' + x.id });
    return { contact: x, added };
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
      take(ws, normalize(form), 'form');
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
      raw = type.includes('application/json') ? await readJson(req, 30_000) : await readForm(req);
    } catch {
      return send(res, 400, { error: 'Send the lead as JSON or a form.' }, cors);
    }
    if (raw.website) return send(res, 200, { ok: true }, cors);
    try {
      const { contact, added } = take(ws, normalize(raw), 'webhook');
      return send(res, added ? 201 : 200, { ok: true, contact_id: contact.id, added }, cors);
    } catch (e) {
      return send(res, e.status || 400, { error: e.message }, cors);
    }
  }
  // ---------- settings ----------
  const publicSettings = (ws) => {
    const s = settings(ws);
    return { ...s, formUrl: s.key ? `${publicUrl}/l/${s.key}` : null, webhookUrl: s.key ? `${publicUrl}/hooks/lead/${s.key}` : null };
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
      ws.leadCapture = s;
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
  return { route, formPage, webhook, normalize };
}
