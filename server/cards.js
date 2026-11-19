// Business cards: each person's own card at /c/<handle>, a page anyone can open from a link, a QR code, a text or an
// NFC sticker. It has the person's photo, title and company (the team's logo and colour), buttons to call, text and
// email, their own links, "Save contact" (a vCard for the phone's contacts) and, when the team uses Contacts,
// "Share your info": what the visitor leaves lands in the team's Contacts as a lead from this card, and the card's
// owner is told. Views, saves and taps on each link are counted for the owner.
//
// What's public is only what the owner put on the card. A card is on only while its owner is in the team, the team
// isn't being deleted, the Business card tool is on and (when real email is on) the owner has confirmed their email.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const RESERVED = new Set(['admin', 'api', 'app', 'help', 'kloomie', 'column', 'support', 'login', 'signin', 'signup', 'settings', 'team', 'www', 'mail', 'billing', 'security', 'official', 'staff', 'new', 'edit', 'card', 'cards']);
const LEN = { name: 80, title: 80, company: 80, phone: 40, email: 120, about: 300, label: 40, url: 500 };
const LINKS_MAX = 8;
const PHOTO_MAX = 1_000_000;
const SAFE_URL = /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9 ()\-.]+|sms:\+?[0-9 ()\-.]+)$/i;

export function cardsModule({ db, save, readJson, send, rid, escHtml, brandOf, logoUrl, imageType, FILES_DIR, clientIp, publicUrl, offline, teamDay, toolOn, confirmed, memberIn, isAdminId,
  contactsOf, newContact, applyContact, emailKey, phoneKey, EMAIL_RE, contactNews, refreshLiveSoon, automate, hook, notify, CONTACT_MAX, qrSvg }) {
  db.cards ||= {};
  const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
  const photoPath = (p) => path.join(FILES_DIR, 'card-' + p.id);
  const mine = (wsId, memberId) => Object.values(db.cards).find((c) => c.wsId === wsId && c.memberId === memberId) || null;
  const memberOf = (c) => db.workspaces[c.wsId]?.members.find((m) => m.id === c.memberId) || null;
  // Why a card isn't showing, or null when it is.
  const offReason = (c) => {
    if (!c.on) return 'off';
    if (offline(c.wsId) || !memberIn(c.wsId, c.memberId)) return 'gone';
    if (!toolOn(db.workspaces[c.wsId], 'cards')) return 'tool';
    if (!confirmed(c.wsId, c.memberId)) return 'confirm';
    return null;
  };
  const byHandle = (h) => {
    const c = HANDLE_RE.test(h || '') && Object.values(db.cards).find((x) => x.handle === h);
    return c && !offReason(c) ? c : null;
  };
  const askOn = (c) => c.ask !== false && toolOn(db.workspaces[c.wsId], 'contacts');
  const link = (c) => `${publicUrl}/c/${c.handle}`;
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  function freeHandle(base) {
    let b = slug(base);
    if (b.length < 3) b = (b + '-card').replace(/^-/, '');
    if (RESERVED.has(b)) b += '-1';
    const taken = (h) => Object.values(db.cards).some((x) => x.handle === h);
    if (HANDLE_RE.test(b) && !taken(b)) return b;
    for (let i = 2; i < 1000; i++) { const h = `${b.slice(0, 26)}-${i}`; if (HANDLE_RE.test(h) && !taken(h)) return h; }
    return 'card-' + crypto.randomBytes(4).toString('hex');
  }
  // What the owner sees when they have no card yet: filled in from their account and team.
  function draft(ws, memberId, user) {
    const m = ws.members.find((x) => x.id === memberId);
    return { id: null, on: false, handle: freeHandle(m?.name || 'card'), name: m?.name || '', title: '', company: ws.name || '', phone: '', email: user?.email || '', about: '',
      links: [], photo: null, showLogo: true, ask: true, views: 0, saves: 0, taps: [], leads: 0, recent: [] };
  }
  const forOwner = (c) => ({
    id: c.id, on: c.on, handle: c.handle, url: link(c), name: c.name, title: c.title, company: c.company, phone: c.phone, email: c.email, about: c.about,
    links: c.links.map((l, i) => ({ ...l, taps: c.taps[i] || 0 })), photo: c.photo ? `/c/${c.handle}/photo/${c.photo.id}` : null, showLogo: c.showLogo, ask: c.ask !== false,
    views: c.views, saves: c.saves, leads: c.leads, recent: c.recent || [], off: offReason(c), askOn: askOn(c), updatedAt: c.updatedAt,
    qr: 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(link(c), { scale: 8 })).toString('base64'),
  });
  function applyCard(c, b) {
    for (const k of ['name', 'title', 'company', 'phone', 'email']) if (b[k] !== undefined) c[k] = clean(b[k], LEN[k]).replace(/\s+/g, ' ');
    // The about line keeps its line breaks.
    if (b.about !== undefined) c.about = String(b.about ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, LEN.about);
    if (c.email && !EMAIL_RE.test(c.email)) throw Object.assign(new Error('That email doesn’t look right.'), { status: 400 });
    if (b.links !== undefined) {
      if (!Array.isArray(b.links)) throw Object.assign(new Error('Links must be a list.'), { status: 400 });
      const old = c.links || [];
      const next = [];
      for (const l of b.links.slice(0, LINKS_MAX)) {
        let url = clean(l?.url, LEN.url);
        if (!url) continue;
        if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
        if (!SAFE_URL.test(url)) throw Object.assign(new Error(`“${url.slice(0, 60)}” isn’t a web address, email or phone link.`), { status: 400 });
        next.push({ label: clean(l?.label, LEN.label) || url.replace(/^(https?:\/\/(www\.)?|mailto:|tel:|sms:)/i, '').slice(0, LEN.label), url });
      }
      // A link keeps its tap count while it stays on the card.
      c.taps = next.map((l) => { const i = old.findIndex((o) => o.url === l.url); return i >= 0 ? c.taps[i] || 0 : 0; });
      c.links = next;
    }
    if (b.showLogo !== undefined) c.showLogo = !!b.showLogo;
    if (b.ask !== undefined) c.ask = !!b.ask;
    if (b.handle !== undefined && b.handle !== c.handle) {
      const h = String(b.handle || '').toLowerCase().trim();
      if (!HANDLE_RE.test(h)) throw Object.assign(new Error('Use 3 to 30 letters, numbers and dashes for your card’s address.'), { status: 400 });
      if (RESERVED.has(h)) throw Object.assign(new Error('That address is reserved. Try another.'), { status: 409 });
      if (Object.values(db.cards).some((x) => x.handle === h && x.id !== c.id)) throw Object.assign(new Error('That address is taken. Try another.'), { status: 409 });
      c.handle = h;
    }
    if (b.on !== undefined) c.on = !!b.on;
    c.updatedAt = Date.now();
  }
  function dropCard(c) {
    if (c.photo) fs.promises.rm(photoPath(c.photo), { force: true }).catch(() => {});
    delete db.cards[c.id];
  }

  // ---------- the owner: GET/PUT/DELETE /api/card, PUT/DELETE /api/card/photo ----------
  async function route(req, res, parts, auth, ws, user) {
    if (parts[0] !== 'card') return null;
    const m = req.method;
    if (!toolOn(ws, 'cards')) return send(res, 403, { error: 'Business cards are switched off for this team (Apps & Integrations → Tools).' });
    let c = mine(ws.id, auth.memberId);
    if (!parts[1]) {
      if (m === 'GET') return send(res, 200, c ? forOwner(c) : { ...draft(ws, auth.memberId, user), url: null, off: 'new', askOn: toolOn(ws, 'contacts') });
      if (m === 'PUT') {
        const b = await readJson(req, 50_000);
        const fresh = !c;
        const next = c ? { ...c, links: [...c.links], taps: [...c.taps] } : { ...draft(ws, auth.memberId, user), id: rid(), wsId: ws.id, memberId: auth.memberId, createdAt: Date.now() };
        delete next.url;
        try { applyCard(next, b); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
        if (next.on && !confirmed(ws.id, auth.memberId)) return send(res, 403, { error: 'Confirm your email first (Settings → Profile & sign-in), then turn your card on.' });
        // Taken between the draft and the save.
        if (fresh && Object.values(db.cards).some((x) => x.handle === next.handle)) next.handle = freeHandle(next.handle);
        db.cards[next.id] = next;
        save();
        return send(res, fresh ? 201 : 200, forOwner(next));
      }
      if (m === 'DELETE') {
        if (c) { dropCard(c); save(); }
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'Method not allowed' });
    }
    if (parts[1] === 'photo' && !parts[2]) {
      if (!c) return send(res, 404, { error: 'Save your card first.' });
      const old = c.photo;
      if (m === 'PUT') {
        const { data } = await readJson(req, Math.ceil(PHOTO_MAX * 1.4) + 1000);
        const buf = Buffer.from(String(data || '').replace(/^data:[^,]*,/, ''), 'base64');
        const mime = imageType(buf);
        if (!mime) return send(res, 400, { error: 'Use a PNG, JPEG, GIF or WebP photo.' });
        if (buf.length > PHOTO_MAX) return send(res, 400, { error: 'Keep the photo under 1 MB.' });
        const p = { id: rid(), mime };
        await fs.promises.writeFile(photoPath(p), buf);
        c.photo = p;
      } else if (m === 'DELETE') c.photo = null;
      else return send(res, 405, { error: 'Method not allowed' });
      if (old && old.id !== c.photo?.id) fs.promises.rm(photoPath(old), { force: true }).catch(() => {});
      c.updatedAt = Date.now();
      save();
      return send(res, 200, forOwner(c));
    }
    return send(res, 404, { error: 'Not found' });
  }

  // ---------- counting, without letting one visitor run the numbers up ----------
  const seen = new Map(); // `${cardId}:${what}:${ip}` → time
  function once(c, what, ip, ms = 3600_000) {
    const k = `${c.id}:${what}:${ip}`;
    const now = Date.now();
    if (now - (seen.get(k) || 0) < ms) return false;
    seen.set(k, now);
    if (seen.size > 50_000) for (const [x, t] of seen) if (now - t > ms) seen.delete(x);
    return true;
  }
  const asks = new Map(); // `${cardId}:${ip}` → times, `${cardId}:${day}` → count
  function askAllowed(c, ip) {
    const now = Date.now();
    const k = `${c.id}:${ip}`;
    const times = (asks.get(k) || []).filter((t) => now - t < 3600_000);
    if (times.length >= 5) return false;
    const day = `${c.id}:${teamDay(c.wsId)}`;
    if ((asks.get(day) || 0) >= 100) return false;
    times.push(now);
    asks.set(k, times);
    asks.set(day, (asks.get(day) || 0) + 1);
    return true;
  }

  // ---------- the public card ----------
  const HEAD = { 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  function page(res, code, c, body, head = '') {
    const ws = c && db.workspaces[c.wsId];
    const brand = ws ? brandOf(ws) : {};
    const accent = /^#[0-9a-f]{6}$/i.test(brand.accent || '') ? brand.accent : '#6b5cf0';
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...HEAD,
      'Content-Security-Policy': `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` });
    const title = c ? [c.name, c.title && c.company ? `${c.title}, ${c.company}` : c.title || c.company].filter(Boolean).join(' · ') : 'Not available';
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title>
<meta name="theme-color" content="${accent}">${head}<style>:root{color-scheme:light;--accent:${accent}}*{box-sizing:border-box}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f3f7;color:#16161a}
main{max-width:440px;margin:0 auto;padding:28px 16px 40px}.card{background:#fff;border:1px solid #e4e4ea;border-radius:20px;overflow:hidden;box-shadow:0 6px 24px rgba(20,20,40,.06)}
.top{background:var(--accent);height:84px;position:relative}.top img.logo{position:absolute;right:14px;top:14px;max-height:34px;max-width:120px;background:#fff;border-radius:8px;padding:4px}
.who{padding:0 22px 18px;text-align:center}.ph{position:relative;z-index:1;width:104px;height:104px;border-radius:50%;border:4px solid #fff;margin:-52px auto 8px;background:#e9e8f5;display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:700;color:var(--accent);overflow:hidden}
.ph img{width:100%;height:100%;object-fit:cover}h1{font-size:23px;margin:4px 0 0}.role{color:#5d5d68;margin:2px 0 0}.about{color:#3d3d46;margin:12px 0 0;white-space:pre-line}
.acts{display:flex;gap:8px;justify-content:center;padding:0 18px 16px}.acts a{flex:1;max-width:110px;text-decoration:none;color:#16161a;background:#f3f3f7;border-radius:12px;padding:10px 4px;font-size:13px;font-weight:600;text-align:center}
.acts a b{display:block;font-size:20px;line-height:1.2}.save{display:block;margin:0 18px 16px;text-align:center;text-decoration:none;color:#fff;background:var(--accent);border-radius:12px;padding:13px;font-weight:700}
.links{padding:0 18px 8px}.links a{display:block;text-decoration:none;color:#16161a;border:1px solid #e4e4ea;border-radius:12px;padding:12px 14px;margin-bottom:8px;font-weight:600;overflow-wrap:anywhere}
.links a small{display:block;font-weight:400;color:#6b6b76}.ask{border-top:1px solid #eee;padding:18px 22px 22px}.ask h2{font-size:17px;margin:0 0 4px}.ask p{color:#6b6b76;margin:0 0 6px;font-size:14px}
label{display:block;font-size:14px;font-weight:600;margin:10px 0 4px}input,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid #d6d6de;border-radius:9px}textarea{min-height:76px;resize:vertical}
button{margin-top:14px;width:100%;font:inherit;font-weight:700;color:#fff;background:var(--accent);border:0;border-radius:10px;padding:12px;cursor:pointer}.share{background:#16161a}.hp{position:absolute;left:-5000px}
.show{text-align:center;padding:22px 18px 18px}.show img.qr{width:100%;max-width:340px;aspect-ratio:1;background:#fff;border-radius:14px;padding:10px;border:1px solid #e4e4ea}.show h1{margin-top:12px}.show .hint{color:#6b6b76;font-size:14px;margin:8px 0 0}.show .full{display:block;margin-top:12px;color:#6b6b76;font-size:14px}
.err{color:#b42318;font-weight:600}.ok{color:#067647;font-weight:600}.muted{color:#6b6b76;font-size:13px;text-align:center;margin-top:16px}.muted a{color:inherit}</style></head>
<body><main>${body}<p class="muted">Made with <a href="${escHtml(publicUrl)}/welcome" rel="noopener">Kloomie</a></p></main>${c ? '<script src="/card.js"></script>' : ''}</body></html>`);
  }
  const notFound = (res) => page(res, 404, null, '<div class="card"><div class="who" style="padding:28px"><h1>This card isn’t available</h1><p class="role">The link may be old, or the card has been turned off.</p></div></div>');
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  function cardBody(c, { err = '', sent = false, v = {} } = {}) {
    const ws = db.workspaces[c.wsId];
    const brand = brandOf(ws);
    const tel = c.phone.replace(/[^0-9+]/g, '');
    const role = [c.title, c.company].filter(Boolean).join(' · ');
    const acts = [tel && `<a href="tel:${escHtml(tel)}" data-tap="call"><b>☎</b>Call</a>`, tel && `<a href="sms:${escHtml(tel)}" data-tap="text"><b>💬</b>Text</a>`, c.email && `<a href="mailto:${escHtml(c.email)}" data-tap="email"><b>✉</b>Email</a>`].filter(Boolean);
    const f = (name, label, type, extra = '') => `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escHtml(v[name] || '')}" ${extra}>`;
    const ask = !askOn(c) ? '' : sent
      ? `<div class="ask"><p class="ok">Thanks! ${escHtml(c.name.split(' ')[0] || 'They')} has your details.</p></div>`
      : `<div class="ask" id="ask"><h2>Share your info with ${escHtml(c.name.split(' ')[0] || 'us')}</h2><p>So they can get back to you.</p>${err ? `<p class="err">${escHtml(err)}</p>` : ''}
<form method="post" action="/c/${escHtml(c.handle)}#ask">${f('name', 'Your name', 'text', 'required autocomplete="name" maxlength="80"')}${f('phone', 'Phone', 'tel', 'autocomplete="tel" maxlength="40"')}${f('email', 'Email', 'email', 'autocomplete="email" maxlength="120"')}
<label for="message">Note (optional)</label><textarea id="message" name="message" maxlength="500">${escHtml(v.message || '')}</textarea>
<div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div><input type="hidden" name="t" value="${Date.now()}"><button type="submit">Send my info</button></form></div>`;
    return `<div class="card" data-card="${escHtml(c.handle)}"><div class="top">${c.showLogo && brand.logo ? `<img class="logo" src="${escHtml(logoUrl(brand.logo))}" alt="">` : ''}</div>
<div class="who"><div class="ph">${c.photo ? `<img src="/c/${escHtml(c.handle)}/photo/${escHtml(c.photo.id)}" alt="">` : escHtml(initials(c.name))}</div><h1>${escHtml(c.name || 'Business card')}</h1>${role ? `<p class="role">${escHtml(role)}</p>` : ''}${c.about ? `<p class="about">${escHtml(c.about)}</p>` : ''}</div>
${acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}<a class="save" href="/c/${escHtml(c.handle)}.vcf" data-tap="save">Save contact</a>
${c.links.length ? `<div class="links">${c.links.map((l, i) => `<a href="${escHtml(l.url)}" rel="noopener nofollow" target="_blank" data-tap="${i}">${escHtml(l.label)}<small>${escHtml(l.url.replace(/^(https?:\/\/(www\.)?|mailto:|tel:|sms:)/i, '').slice(0, 60))}</small></a>`).join('')}</div>` : ''}
<div class="links"><button type="button" class="share" id="shareBtn" hidden>Share this card</button></div>${ask}</div>`;
  }
  // vCard 3.0, which iPhone and Android contacts both open.
  const vEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const fold = (line) => { const out = []; for (let i = 0; i < line.length; i += 74) out.push((i ? ' ' : '') + line.slice(i, i + 74)); return out.join('\r\n'); };
  async function vcard(c) {
    const parts = c.name.trim().split(/\s+/);
    const last = parts.length > 1 ? parts.pop() : '';
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vEsc(c.name || c.company || 'Contact')}`, `N:${vEsc(last)};${vEsc(parts.join(' '))};;;`];
    if (c.company) lines.push(`ORG:${vEsc(c.company)}`);
    if (c.title) lines.push(`TITLE:${vEsc(c.title)}`);
    if (c.phone) lines.push(`TEL;TYPE=CELL:${vEsc(c.phone)}`);
    if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${vEsc(c.email)}`);
    lines.push(`URL:${vEsc(link(c))}`);
    for (const l of c.links) if (/^https?:/i.test(l.url)) lines.push(`URL:${vEsc(l.url)}`);
    if (c.about) lines.push(`NOTE:${vEsc(c.about)}`);
    if (c.photo) {
      const buf = await fs.promises.readFile(photoPath(c.photo)).catch(() => null);
      const t = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/gif': 'GIF' }[c.photo.mime];
      if (buf && t) lines.push(`PHOTO;ENCODING=b;TYPE=${t}:${buf.toString('base64')}`);
    }
    lines.push('END:VCARD');
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  async function readForm(req) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 20_000) break; }
    return Object.fromEntries(new URLSearchParams(body));
  }
  // What a visitor leaves: into the team's Contacts (matched by email or phone), and the card's owner is told.
  function take(c, form) {
    const name = clean(form.name, 80).replace(/\s+/g, ' ');
    const email = EMAIL_RE.test(clean(form.email, 120)) ? clean(form.email, 120) : '';
    const phone = clean(form.phone, 40);
    const message = clean(form.message, 500);
    if (!name) throw Object.assign(new Error('Please add your name.'), { status: 400 });
    if (!email && !phoneKey(phone)) throw Object.assign(new Error('Add a phone number or an email, so they can get back to you.'), { status: 400 });
    const source = `Business card (${c.name || c.handle})`.slice(0, 80);
    const note = `${teamDay(c.wsId)} (business card, ${c.name || c.handle})${message ? ': ' + message : ''}`;
    const all = contactsOf(c.wsId);
    const ek = emailKey(email), pk = phoneKey(phone);
    let x = all.find((y) => (ek && emailKey(y.email) === ek) || (pk && phoneKey(y.phone) === pk));
    let added = false;
    if (x) {
      const fill = Object.fromEntries([['name', name], ['phone', phone], ['email', email]].filter(([k, v]) => v && !x[k]));
      applyContact(x, { ...fill, tags: [...x.tags, 'business card'], note: [x.note, note].filter(Boolean).join('\n') });
    } else {
      if (all.length >= CONTACT_MAX) throw Object.assign(new Error('Sorry, this couldn’t be saved right now.'), { status: 409 });
      x = applyContact(newContact(c.wsId, 'Business card'), { name, email, phone, source, tags: ['business card'], note });
      db.contacts[x.id] = x;
      added = true;
    }
    c.leads = (c.leads || 0) + 1;
    c.recent = [{ name, phone, email, at: Date.now(), contactId: x.id }, ...(c.recent || [])].slice(0, 20);
    save();
    contactNews(c.wsId, x);
    refreshLiveSoon(c.wsId);
    if (added) {
      automate(c.wsId, 'contact.added', { contact: x, stage: x.stage, who: 'Business card' });
      hook(c.wsId, 'contact.created', x);
    } else hook(c.wsId, 'contact.updated', x);
    // The visitor gave their details to this person, so the owner is told what they left; the link to the contact
    // only for someone who can open Contacts.
    notify(c.wsId, c.memberId, { title: `From your card: ${name}`, text: [phone, email, message].filter(Boolean).join(' · '), kind: 'lead', go: isAdminId(c.wsId, c.memberId) ? 'contact:' + x.id : 'card', key: 'card:' + x.id });
  }
  const PHOTO_RE = /^\/c\/([a-z0-9-]+)\/photo\/([\w-]{8,40})$/;
  async function publicRoute(req, res, url) {
    const p = url.pathname;
    const ip = clientIp(req);
    let mm = PHOTO_RE.exec(p);
    if (mm && (req.method === 'GET' || req.method === 'HEAD')) {
      const c = byHandle(mm[1]);
      if (!c?.photo || c.photo.id !== mm[2]) return send(res, 404, 'Not found');
      const data = await fs.promises.readFile(photoPath(c.photo)).catch(() => null);
      if (!data) return send(res, 404, 'Not found');
      return send(res, 200, data, { 'Content-Type': c.photo.mime, 'Cache-Control': 'public, max-age=86400', ...HEAD });
    }
    mm = /^\/c\/([a-z0-9-]+)\/qr\.svg$/.exec(p);
    if (mm && req.method === 'GET') {
      const c = byHandle(mm[1]);
      if (!c) return send(res, 404, 'Not found');
      return send(res, 200, qrSvg(link(c), { scale: 8 }), { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", ...HEAD });
    }
    mm = /^\/c\/([a-z0-9-]+)\.vcf$/.exec(p);
    if (mm && req.method === 'GET') {
      const c = byHandle(mm[1]);
      if (!c) return send(res, 404, 'Not found');
      if (once(c, 'save', ip)) { c.saves = (c.saves || 0) + 1; save(); }
      const file = (slug(c.name) || c.handle) + '.vcf';
      return send(res, 200, await vcard(c), { 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store', ...HEAD });
    }
    // Showing your card in a hurry (2026-11-19): just the big QR code and Share, made to sit on a phone's Home Screen
    // as its own icon ("My card"), which opens straight here. Not counted as someone opening the card.
    mm = /^\/c\/([a-z0-9-]+)\/show$/.exec(p);
    if (mm && req.method === 'GET') {
      const c = byHandle(mm[1]);
      if (!c) return notFound(res);
      const icon = c.photo ? `/c/${c.handle}/photo/${c.photo.id}` : '/icon-192.png';
      const role = [c.title, c.company].filter(Boolean).join(' · ');
      const head = `<link rel="manifest" href="/c/${escHtml(c.handle)}/manifest.webmanifest"><link rel="apple-touch-icon" href="${escHtml(icon)}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="My card">`;
      return page(res, 200, c, `<div class="card show" data-card="${escHtml(c.handle)}" data-show="1"><img class="qr" src="/c/${escHtml(c.handle)}/qr.svg" alt="QR code for ${escHtml(c.name || 'this card')}"><h1>${escHtml(c.name || 'Business card')}</h1>${role ? `<p class="role">${escHtml(role)}</p>` : ''}
<p class="hint">Point your phone’s camera at the code.</p><button type="button" class="share" id="shareBtn" hidden>Share or text it</button><a class="full" href="/c/${escHtml(c.handle)}">See the full card</a></div>`, head);
    }
    mm = /^\/c\/([a-z0-9-]+)\/manifest\.webmanifest$/.exec(p);
    if (mm && req.method === 'GET') {
      const c = byHandle(mm[1]);
      if (!c) return send(res, 404, 'Not found');
      const ws = db.workspaces[c.wsId];
      const accent = /^#[0-9a-f]{6}$/i.test(brandOf(ws).accent || '') ? brandOf(ws).accent : '#6b5cf0';
      const icons = c.photo ? [{ src: `/c/${c.handle}/photo/${c.photo.id}`, sizes: '512x512', type: c.photo.mime }] : [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }];
      const mf = { name: c.name ? `${c.name}’s card` : 'My card', short_name: 'My card', start_url: `/c/${c.handle}/show`, scope: `/c/${c.handle}/`, display: 'standalone', background_color: '#f3f3f7', theme_color: accent, icons };
      return send(res, 200, JSON.stringify(mf), { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store', ...HEAD });
    }
    mm = /^\/c\/([a-z0-9-]+)\/tap$/.exec(p);
    if (mm && req.method === 'POST') {
      const c = byHandle(mm[1]);
      const what = url.searchParams.get('i');
      if (c && /^\d{1,2}$/.test(what || '') && Number(what) < c.links.length && once(c, 'tap' + what, ip, 600_000)) {
        c.taps[Number(what)] = (c.taps[Number(what)] || 0) + 1;
        save();
      }
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }
    mm = /^\/c\/([a-z0-9-]+)$/.exec(p);
    if (!mm || (req.method !== 'GET' && req.method !== 'POST')) return notFound(res);
    const c = byHandle(mm[1]);
    if (!c) return notFound(res);
    if (req.method === 'GET') {
      if (once(c, 'view', ip)) { c.views = (c.views || 0) + 1; save(); }
      return page(res, 200, c, cardBody(c, { sent: url.searchParams.has('sent') }));
    }
    if (!askOn(c)) return page(res, 403, c, cardBody(c));
    const form = await readForm(req);
    const thanks = () => { res.writeHead(303, { Location: `/c/${c.handle}?sent=1#ask` }); res.end(); };
    // Bots: the hidden field filled in, or sent faster than a person could type. They're thanked and nothing is kept.
    if (form.website || (Number(form.t) && Date.now() - Number(form.t) < 2500)) return thanks();
    if (!askAllowed(c, ip)) return page(res, 429, c, cardBody(c, { err: 'That’s a lot of messages. Please wait a while and try again.', v: form }));
    try {
      take(c, form);
    } catch (e) {
      return page(res, e.status || 400, c, cardBody(c, { err: e.message, v: form }));
    }
    return thanks();
  }
  // The card page's only script: Share (the phone's share sheet, or copy the link) and counting taps on links.
  const JS = `(function(){var c=document.querySelector('[data-card]');if(!c)return;var h=c.getAttribute('data-card');var b=document.getElementById('shareBtn');
if(b){b.hidden=false;b.addEventListener('click',function(){var u=location.origin+'/c/'+h;if(navigator.share){navigator.share({title:document.title,url:u}).catch(function(){});}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){b.textContent='Link copied';});}});}
if(c.hasAttribute('data-show')&&navigator.wakeLock){var k=function(){navigator.wakeLock.request('screen').catch(function(){});};k();document.addEventListener('visibilitychange',function(){if(!document.hidden)k();});}
c.addEventListener('click',function(e){var a=e.target.closest('a[data-tap]');if(!a)return;var i=a.getAttribute('data-tap');if(!/^\\d+$/.test(i))return;try{fetch('/c/'+h+'/tap?i='+i,{method:'POST',keepalive:true});}catch(x){}});})();`;
  function script(req, res) {
    return send(res, 200, JS, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...HEAD });
  }
  // Someone leaves the team: their card goes.
  function forgetMember(wsId, memberId) {
    const c = mine(wsId, memberId);
    if (c) dropCard(c);
  }
  const files = (wsId) => Object.values(db.cards).filter((c) => c.wsId === wsId && c.photo).map((c) => photoPath(c.photo));
  return { route, publicRoute, script, forgetMember, files, HANDLE_RE };
}
