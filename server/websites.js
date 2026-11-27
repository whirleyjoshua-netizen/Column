// Websites (Settings → Website): a team asks Kloomie to build its website, like Housecall Pro's website service.
// The owner or an admin picks a package (and website care or not) and says what they want; Kloomie's own people
// (KLOOMIE_STAFF_EMAILS, signed in with a confirmed email) are emailed at WEBSITE_EMAIL (or ALERT_EMAIL), see every
// team's request and move it along: building, review, live with its address. The team is told each time. Asking turns
// the team's lead capture on (leads.js), so the new site's contact form sends leads into Contacts from day one.
// A team that has a site already saves its address here and connects its form in Apps → Website lead forms.
// ws.website = { own: its site's address, req: the request now (or null), past: earlier ones }.

// Prices in one place. Website care is monthly; the rest is a one-time build.
export const PACKAGES = [
  { key: 'basic', name: 'Basic', price: 300, pages: 3, weeks: 1, does: ['Up to 3 pages: Home, Services, Contact', 'Looks right on phones and computers', 'A contact form that sends leads into Kloomie', 'Set up on your own web address, secure https', '1 round of changes before launch'] },
  { key: 'standard', name: 'Standard', price: 1500, pages: 5, weeks: 2, does: ['Up to 5 pages: Home, Services, About, Photos & Reviews, Contact', 'Everything in Basic', 'Google basics: page titles, a sitemap, linked to your Google Business Profile', 'Help writing the text for your pages', '2 rounds of changes before launch'] },
];
export const CARE = { price: 84, does: ['Hosting, security and backups', 'Small edits, up to 1 hour a month', 'The contact form checked and kept working', 'Cancel any time with 30 days’ notice'] };
const STATUS = ['requested', 'building', 'review', 'live', 'cancelled'];
const STATUS_NAME = { requested: 'Asked for', building: 'Building', review: 'Ready for you to review', live: 'Live', cancelled: 'Withdrawn' };
const OPEN = new Set(['requested', 'building', 'review']);

export function websitesModule({ db, save, readJson, send, rid, isAdmin, cleanText, notifyAdmins, mailer, leads, userOf, publicUrl }) {
  const staffList = () => String(process.env.KLOOMIE_STAFF_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  // Kloomie staff: a confirmed email on the list (or any email when email is off on this server, as for local tests).
  const isStaff = (ws, memberId) => {
    const u = userOf(ws?.members.find((m) => m.id === memberId));
    return !!u?.email && staffList().includes(String(u.email).toLowerCase()) && (u.emailVerified || mailer.mode !== 'resend');
  };
  const site = (ws) => ({ own: '', req: null, past: [], ...ws.website });
  const address = (v) => {
    let s = cleanText(v, 200);
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
      return u.href.replace(/\/$/, '');
    } catch { return null; }
  };
  const view = (ws, memberId) => {
    const s = site(ws);
    const lc = leads.settings(ws);
    return { packages: PACKAGES, care: CARE, statusNames: STATUS_NAME, own: s.own, req: s.req, leads: { on: !!lc.on, count: lc.count || 0, last: lc.last || null }, staff: isStaff(ws, memberId) };
  };
  const step = (req, status, text) => { req.status = status; req.updates = [...(req.updates || []), { at: Date.now(), status, text: text || '' }].slice(-30); };
  const pkgName = (k) => PACKAGES.find((p) => p.key === k)?.name || 'Not sure yet';

  async function route(req, res, parts, auth, ws) {
    if (parts[0] !== 'website') return null;
    const m = req.method;
    // Kloomie's side: every team's request.
    if (parts[1] === 'staff') {
      if (!isStaff(ws, auth.memberId) || auth.agent) return send(res, 403, { error: 'Only Kloomie staff see website requests.' });
      if (m === 'GET' && !parts[2]) {
        const list = [];
        for (const w of Object.values(db.workspaces)) {
          const s = site(w);
          const r = s.req || s.past[s.past.length - 1];
          if (!r) continue;
          const by = w.members.find((x) => x.id === r.by);
          list.push({ wsId: w.id, team: w.name, req: r, own: s.own, email: userOf(by)?.email || null, leadsOn: !!leads.settings(w).on });
        }
        list.sort((a, b) => (OPEN.has(b.req.status) - OPEN.has(a.req.status)) || b.req.at - a.req.at);
        return send(res, 200, { list, statusNames: STATUS_NAME });
      }
      if (m === 'PUT' && parts[2]) {
        const w = db.workspaces[parts[2]];
        const s = w && site(w);
        if (!s?.req) return send(res, 404, { error: 'That team has no open website request.' });
        const body = await readJson(req, 10_000);
        const status = String(body.status || '');
        if (!['building', 'review', 'live'].includes(status)) return send(res, 400, { error: 'Pick building, review or live.' });
        let url = null;
        if (body.url !== undefined && body.url !== '') { url = address(body.url); if (!url) return send(res, 400, { error: 'That isn’t a web address.' }); }
        if (status === 'live' && !url && !s.req.url) return send(res, 400, { error: 'Add the site’s address to mark it live.' });
        if (url) s.req.url = url;
        const note = cleanText(body.note, 500);
        step(s.req, status, note);
        if (status === 'live') s.own = s.req.url;
        w.website = s;
        save();
        notifyAdmins(w.id, { title: `Your website: ${STATUS_NAME[status]}`, text: note || (status === 'live' ? s.req.url : status === 'review' ? 'Have a look and tell us what to change.' : ''), kind: 'website', go: 'settings:website' });
        return send(res, 200, { req: s.req, own: s.own });
      }
      return send(res, 405, { error: 'Method not allowed' });
    }
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins look after the website.' });
    const s = site(ws);
    if (m === 'GET' && !parts[1]) return send(res, 200, view(ws, auth.memberId));
    if (m === 'PUT' && !parts[1]) {
      const body = await readJson(req, 10_000);
      if (body.own !== undefined) {
        const a = address(body.own);
        if (a === null) return send(res, 400, { error: 'That isn’t a web address. Try something like yourbusiness.com.' });
        s.own = a;
      }
      ws.website = s;
      save();
      return send(res, 200, view(ws, auth.memberId));
    }
    if (parts[1] === 'request' && m === 'POST') {
      if (auth.agent || auth.flow) return send(res, 403, { error: 'Ask for a website yourself, from Settings → Website.' });
      if (s.req && OPEN.has(s.req.status)) return send(res, 409, { error: 'You’ve already asked for a website. We’ll be in touch, or withdraw it first.' });
      const body = await readJson(req, 20_000);
      const pkg = String(body.pkg || '');
      if (!PACKAGES.some((p) => p.key === pkg) && pkg !== 'unsure') return send(res, 400, { error: 'Pick a package.' });
      const current = body.current ? address(body.current) : '';
      if (current === null) return send(res, 400, { error: 'Your website now: that isn’t a web address.' });
      const me = ws.members.find((x) => x.id === auth.memberId);
      const r = { id: rid(), at: Date.now(), by: auth.memberId, byName: me?.name || '', pkg, care: !!body.care,
        business: cleanText(body.business, 300), current, pages: cleanText(body.pages, 500), notes: cleanText(body.notes, 3000), phone: cleanText(body.phone, 40), url: null, updates: [] };
      step(r, 'requested', '');
      if (s.req) s.past = [...s.past, s.req].slice(-10);
      s.req = r;
      ws.website = s;
      save();
      leads.turnOn(ws);
      // Kloomie is told; the request is saved either way.
      const to = process.env.WEBSITE_EMAIL || process.env.ALERT_EMAIL || '';
      const email = userOf(me)?.email || '';
      if (to && mailer.mode !== 'off') {
        const p = PACKAGES.find((x) => x.key === pkg);
        mailer.websiteRequest(to, { team: ws.name, who: r.byName, email, replyTo: email || undefined, lines: [
          `Package: ${p ? `${p.name} ($${p.price.toLocaleString('en-US')}, up to ${p.pages} pages)` : 'Not sure yet'}`,
          `Website care: ${r.care ? `yes ($${CARE.price} a month)` : 'no'}`,
          r.business ? `The business: ${r.business}` : '', r.current ? `Their website now: ${r.current}` : '', r.pages ? `Pages: ${r.pages}` : '',
          r.notes ? `What they want: ${r.notes}` : '', r.phone ? `Phone: ${r.phone}` : '', `Their leads are ready: ${publicUrl}/l/${leads.settings(ws).key}`,
        ].filter(Boolean) }).catch((e) => console.error('Website request email failed:', e.message));
      }
      return send(res, 201, view(ws, auth.memberId));
    }
    if (parts[1] === 'request' && m === 'DELETE') {
      if (!s.req || s.req.status !== 'requested') return send(res, 409, { error: s.req ? 'Work on it has started. Email hello@kloomie.com to change or stop it.' : 'There’s no request to withdraw.' });
      step(s.req, 'cancelled', '');
      s.past = [...s.past, s.req].slice(-10);
      s.req = null;
      ws.website = s;
      save();
      return send(res, 200, view(ws, auth.memberId));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  return { route, isStaff };
}
