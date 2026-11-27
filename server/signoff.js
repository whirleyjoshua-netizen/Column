// Sign-offs and acknowledgments on jobs and records. Any sign-off (signature) field can carry a form: one the team
// writes in Kloomie (a title and lines, with blanks the record fills in: {customer}, {job}, {address}, {date},
// {total}, {line_items} or any field's name, and "[ ] " lines the signer can tick) or a PDF they upload. A list's
// field has a form for every record in it, and one record can use a different one.
//
// The signer signs either here, on the device in front of them (the whole form is shown, filled in), or on
// Kloomie's signing page through a link that's emailed to them (the same e-signature flow as Signs, with its
// history and certificate). Either way the signed PDF is kept, the field fills in, the record's timeline says so,
// its stage can move on (the field's "when signed, move to"), and the signer gets a copy by email.
//
// What a signer sees is made from the record as it is when it's signed or sent; the PDF sent keeps its fingerprint.
export function signoffModule(d) {
  const { db, save, broadcast, rid, cleanText, readJson, send, badRequest, PJ } = d;
  const bad = (msg) => badRequest(msg);
  db.signForms ||= {};
  const FORM_MAX = 300;

  const publicForm = ({ wsId, ...x }) => x;
  const formsOf = (ws) => Object.values(db.signForms).filter((x) => x.wsId === ws.id);

  // ----- a record and its sign-off field -----
  function locate(ws, auth, recordId, fieldId) {
    const rec = db.records[recordId];
    const p = rec && db.projects[rec.projectId];
    if (!rec || rec.wsId !== ws.id || !PJ.sees(p, auth.memberId) || !PJ.seesJob(rec, auth.memberId, p)) return null;
    const t = p.types.find((x) => x.id === rec.typeId);
    const f = t?.fields.find((x) => x.id === fieldId && x.type === 'signature');
    return f ? { rec, p, t, f } : null;
  }
  const formFor = (ws, at) => {
    const id = at.rec.signForms?.[at.f.id] || at.f.form;
    const x = id && db.signForms[id];
    return x && x.wsId === ws.id ? x : null;
  };
  const contactOf = (at) => {
    const cf = at.t.fields.find((x) => x.type === 'contact' && at.rec.values[x.id]);
    return cf ? db.contacts?.[at.rec.values[cf.id]] || null : null;
  };
  const money = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const recName = (at) => String(at.rec.values[at.t.primary] ?? '') || at.t.singular || 'Record';

  // The blanks a form can use, from the record as it is now.
  // A member's form leaves prices blank (docs/jobflows/PRICES.md): no total, no line prices.
  function blanks(ws, at, day, view = null) {
    const c = contactOf(at);
    const items = at.t.fields.find((x) => x.type === 'items' && at.rec.values[x.id]?.rows?.length);
    const val = at.t.fields.find((x) => x.key === 'value' && at.rec.values[x.id] != null);
    const addr = at.t.fields.find((x) => x.key === 'address' && at.rec.values[x.id]);
    const totals = items && view?.prices ? PJ.itemsTotals(at.rec.values[items.id]) : null;
    const out = {
      customer: c ? c.name || c.company || '' : '', customer_email: c?.email || '', customer_phone: c?.phone || '',
      address: (addr && String(at.rec.values[addr.id])) || (c ? [c.address, c.city].filter(Boolean).join(', ') : ''),
      job: recName(at), record: recName(at), project: at.p.name, company: ws.name, team: ws.name, date: day,
      total: totals ? money(totals.total) : val ? PJ.words(ws, at.p, val, at.rec.values[val.id], view) : '',
    };
    const rows = items ? at.rec.values[items.id].rows.map((r) => ({ desc: r.desc || r.name || '', qty: r.qty ?? '', price: view?.prices ? money(r.price || 0) : '', total: view?.prices ? money(Math.round((r.qty || 0) * (r.price || 0))) : '' })) : [];
    return { out, rows, totals, view };
  }
  function fill(text, ws, at, b) {
    return String(text || '').replace(/\{([^{}\n]{1,40})\}/g, (_, k) => {
      const key = k.trim().toLowerCase().replace(/\s+/g, '_');
      if (Object.hasOwn(b.out, key)) return b.out[key] || '____';
      const f = at.t.fields.find((x) => x.name.toLowerCase() === k.trim().toLowerCase());
      if (f && f.type !== 'signature') return PJ.words(ws, at.p, f, at.rec.values[f.id], b.view) || '____';
      // A blank this list doesn't have prints as a line to fill in by hand.
      return '____';
    });
  }
  const DEFAULT_BODY = 'The work on {job} is complete, and I accept it.';
  // The form's lines, filled in for this record: headings, paragraphs, checkboxes (each with a steady id) and the items.
  function linesOf(ws, at, form, b) {
    const out = [];
    let n = 0;
    for (const raw of String(form?.kind === 'pdf' ? '' : form?.body ?? DEFAULT_BODY).split('\n').slice(0, 400)) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const chk = /^\s*(?:[-*]\s*)?\[\s?\]\s+(.+)$/.exec(line);
      if (chk) { out.push({ kind: 'check', id: 'c' + n++, text: fill(chk[1], ws, at, b).slice(0, 300) }); continue; }
      if (/^\s*#{1,3}\s+/.test(line)) { out.push({ kind: 'h', text: fill(line.replace(/^\s*#{1,3}\s+/, ''), ws, at, b).slice(0, 200) }); continue; }
      if (line.trim().toLowerCase() === '{line_items}') { if (b.rows.length) out.push({ kind: 'items', rows: b.rows.slice(0, 200), total: b.totals ? money(b.totals.total) : '' }); continue; }
      out.push({ kind: 'p', text: fill(line, ws, at, b).slice(0, 4000) });
    }
    return out;
  }
  // Everything a signer sees, for this record: the form's title, the job's details, the lines, and for an uploaded
  // form its pages first.
  async function render(ws, at, day, auth) {
    const form = formFor(ws, at);
    const b = blanks(ws, at, day, PJ.viewOf(ws.id, auth?.memberId));
    const title = fill(form?.title || form?.name || at.f.name, ws, at, b).slice(0, 160);
    const rows = [[at.t.singular || 'Record', recName(at)], ['Customer', b.out.customer], ['Address', b.out.address], ...(b.out.total ? [['Total', b.out.total]] : [])];
    const lines = linesOf(ws, at, form, b);
    let base = null;
    let intro = '';
    if (form?.kind === 'pdf') {
      const it = db.items[form.itemId];
      if (!it || it.wsId !== ws.id) throw bad('The PDF for this form is gone. Choose another form.');
      // Audit: a PDF someone keeps private isn't shown to people who can't see it, just because it's a form.
      if (auth && !d.canSee(auth, 'item', it)) throw bad('This form’s PDF is somewhere you can’t see. Ask whoever made the form to put it where the team can.');
      base = await d.readItem(it);
      intro = `By signing, I confirm I have read and accept “${form.name}” above.`;
    }
    const pdf = await d.pdfWork(() => d.writeForm({ base, team: ws.name, title, rows, lines, intro }));
    return { form, title, rows, lines, intro, ...pdf };
  }

  // ----- the record's sign-off state -----
  function track(rec, fieldId, state) {
    rec.signoffs ||= {};
    if (state) rec.signoffs[fieldId] = state;
    else delete rec.signoffs[fieldId];
  }
  function news(rec, by) {
    rec.updatedAt = Date.now();
    PJ.recordNews(rec, 'record.updated', by);
  }

  // Signed, here or online: the field fills in, the signed PDF is kept with it, the timeline says so, the stage
  // moves on if the field says to, and the signer is emailed a copy.
  async function finish(x, item, typed, sigPng) {
    const rec = db.records[x.recordId];
    const p = rec && db.projects[rec.projectId];
    const t = p?.types.find((y) => y.id === rec.typeId);
    const f = t?.fields.find((y) => y.id === x.fieldId);
    const ws = db.workspaces[x.wsId];
    if (!rec || !f || !ws) return;
    const title = x.title || x.name.replace(/\.pdf$/i, '');
    const image = sigPng ? 'data:image/png;base64,' + sigPng.toString('base64') : null;
    rec.values[f.id] = { name: typed, ...(image && image.length < 120_000 ? { image } : {}), at: x.signedAt, itemId: item.id, signId: x.id, how: x.inPerson ? 'in person' : 'online', form: title };
    track(rec, f.id, { signId: x.id, status: 'signed', to: x.signer, at: x.signedAt });
    PJ.recordActivity(rec.id, { kind: 'sign', what: 'signed', note: `${title} · signed by ${typed}${x.inPerson ? ' in person' : ' online'}`, by: typed });
    const st = t.fields.find((y) => y.key === 'status' && y.type === 'select') || t.fields.find((y) => y.type === 'select');
    if (f.onSigned && st?.choices.some((c) => c.id === f.onSigned) && rec.values[st.id] !== f.onSigned) {
      const was = st.choices.find((c) => c.id === rec.values[st.id])?.label || 'empty';
      rec.values[st.id] = f.onSigned;
      PJ.recordActivity(rec.id, { kind: 'change', field: st.name, from: was, to: st.choices.find((c) => c.id === f.onSigned).label, by: 'Kloomie' });
      d.onStage?.(rec, st, was);
    }
    news(rec, typed);
    if (x.signer.email) await d.emailCustomer(ws, x.memberId, x.signer.email, {
      subject: `Your signed copy: ${title}`, heading: 'Signed. Here’s your copy.',
      lines: [`Hi ${x.signer.name.split(/\s+/)[0]},`, `Thanks for signing “${title}” for ${ws.name}. Keep a copy for your records:`],
      button: { label: 'Download the signed copy', url: d.signLink(x) + '/signed' }, tag: 'signed-copy',
    }).then((ok) => { if (ok) PJ.recordActivity(rec.id, { kind: 'email', what: 'signed-copy', note: `Signed copy emailed to ${x.signer.email}`, by: 'Kloomie' }); });
  }
  // A request's progress (opened, declined, expired) shows on the record.
  function sync(x) {
    if (!x.recordId || x.status === 'signed') return;
    const rec = db.records[x.recordId];
    const cur = rec?.signoffs?.[x.fieldId];
    if (!cur || cur.signId !== x.id) return;
    const status = d.signStatus(x);
    if (cur.status === status) return;
    cur.status = status;
    if (status === 'viewed') PJ.recordActivity(rec.id, { kind: 'sign', what: 'viewed', note: x.title || x.name.replace(/\.pdf$/i, ''), by: x.signer.name });
    if (status === 'declined') PJ.recordActivity(rec.id, { kind: 'sign', what: 'declined', note: (x.title || x.name.replace(/\.pdf$/i, '')) + (x.declineReason ? ` · “${x.declineReason}”` : ''), by: x.signer.name });
    news(rec, x.signer.name);
  }

  function signerOf(body, at) {
    const c = contactOf(at);
    const name = cleanText(body.name, 120) || (c ? c.name || '' : '');
    const email = cleanText(body.email, 200).toLowerCase();
    if (!name) throw bad('Who’s signing? Add their name.');
    if (email && !d.EMAIL_RE.test(email)) throw bad('That email address doesn’t look right.');
    return { name, email };
  }
  const fileName = (r) => (r.title || 'Sign-off').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) + '.pdf';

  const made = new Map(); // memberId -> times a form was made in the last minute
  function tooMany(auth) {
    const now = Date.now();
    const list = (made.get(auth.memberId) || []).filter((x) => now - x < 60_000);
    if (list.length >= 20) return true;
    list.push(now);
    made.set(auth.memberId, list);
    if (made.size > 5000) for (const [k, v] of made) if (!v.some((x) => now - x < 60_000)) made.delete(k);
    return false;
  }
  async function route(req, res, parts, auth, ws) {
    const [a, b, c, e] = parts;
    const m = req.method;
    // ----- the team's forms -----
    if (a === 'sign-forms') {
      if (m === 'GET' && !b) return send(res, 200, formsOf(ws).sort((x, y) => x.name.localeCompare(y.name)).map(publicForm));
      if (m === 'POST' && !b) {
        if (formsOf(ws).length >= FORM_MAX) return send(res, 400, { error: `A team can keep up to ${FORM_MAX} forms.` });
        const body = await readJson(req, 100_000);
        const x = { id: rid(), wsId: ws.id, memberId: auth.memberId, by: auth.member, createdAt: Date.now() };
        Object.assign(x, cleanFormBody(body, ws, auth, null));
        db.signForms[x.id] = x;
        save();
        return send(res, 200, publicForm(x));
      }
      const x = b && db.signForms[b];
      if (!x || x.wsId !== ws.id) return send(res, 404, { error: 'That form is gone.' });
      const mayEdit = x.memberId === auth.memberId || ['owner', 'admin'].includes(auth.role);
      if (m === 'PATCH' && !c) {
        if (!mayEdit) return send(res, 403, { error: 'Only whoever made this form, or an owner or admin, can change it.' });
        Object.assign(x, cleanFormBody(await readJson(req, 100_000), ws, auth, x), { updatedAt: Date.now() });
        save();
        return send(res, 200, publicForm(x));
      }
      if (m === 'DELETE' && !c) {
        if (!mayEdit) return send(res, 403, { error: 'Only whoever made this form, or an owner or admin, can delete it.' });
        delete db.signForms[x.id];
        // Lists and records that used it go back to the plain sign-off.
        for (const p of Object.values(db.projects)) if (p.wsId === ws.id) for (const t of p.types) for (const f of t.fields) if (f.form === x.id) delete f.form;
        for (const r of Object.values(db.records)) if (r.wsId === ws.id && r.signForms) for (const [k, v] of Object.entries(r.signForms)) if (v === x.id) delete r.signForms[k];
        save();
        return send(res, 200, { ok: true });
      }
      return null;
    }
    if (a !== 'signoff') return null;
    // /api/signoff/<record>/<field>/<what>
    const at = locate(ws, auth, b, c);
    if (!at) return send(res, 404, { error: 'That sign-off is gone.' });
    const day = d.dayIn(d.okTz(req.headers['x-time-zone']) || d.tzOf(ws));
    const done = !!at.rec.values[at.f.id];
    const pending = at.rec.signoffs?.[at.f.id];
    const open = pending && ['sent', 'viewed'].includes(pending.status) && db.signs[pending.signId] && ['sent', 'viewed'].includes(d.signStatus(db.signs[pending.signId]));

    // Which form this record uses: the list's (null) or one of the team's.
    if (e === 'form' && m === 'POST') {
      const body = await readJson(req, 5_000);
      const id = body.formId ? String(body.formId) : null;
      if (id && db.signForms[id]?.wsId !== ws.id) return send(res, 404, { error: 'That form is gone.' });
      at.rec.signForms ||= {};
      if (id) at.rec.signForms[at.f.id] = id;
      else delete at.rec.signForms[at.f.id];
      news(at.rec, auth.member);
      return send(res, 200, PJ.publicRecord(at.rec, PJ.viewOf(ws.id, auth.memberId)));
    }
    // What the signer will see, filled in, for signing here.
    if (['preview', 'pdf', 'sign', 'send'].includes(e) && tooMany(auth)) return send(res, 429, { error: 'That’s a lot of forms in a minute. Wait a moment, then try again.' });
    if (e === 'preview' && m === 'GET') {
      const r = await render(ws, at, day, auth);
      const cn = contactOf(at);
      return send(res, 200, { form: r.form ? publicForm(r.form) : null, title: r.title, rows: r.rows.filter(([, v]) => String(v || '').trim()), lines: r.lines, intro: r.intro, pages: r.pages,
        signer: { name: cn ? cn.name || '' : '', email: cn?.email || '' }, consent: d.CONSENT });
    }
    // The filled-in form as a PDF, to read or print (always downloaded, never opened as a page).
    if (e === 'pdf' && m === 'GET') {
      const r = await render(ws, at, day, auth);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName(r).replace(/"/g, '')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Length': r.bytes.length });
      return res.end(r.bytes);
    }
    // The link of one that's out, to copy and send another way (anyone on the record can).
    if (e === 'link' && m === 'GET') {
      if (!open) return send(res, 404, { error: 'There’s nothing waiting to be signed.' });
      return send(res, 200, { link: d.signLink(db.signs[pending.signId]) });
    }
    if (m !== 'POST') return null;
    const body = await readJson(req, 2_000_000);
    // ----- signed here, on this device -----
    if (e === 'sign') {
      if (done) return send(res, 409, { error: 'This is already signed. Clear it first to sign again.' });
      if (body.consent !== true) return send(res, 400, { error: 'They need to tick the box to agree to sign electronically.' });
      const signer = signerOf(body, at);
      const sig = d.pngData(body.sig);
      if (!sig) return send(res, 400, { error: 'Have them sign in the box.' });
      const r = await render(ws, at, day, auth);
      const ticked = new Set((Array.isArray(body.checks) ? body.checks : []).map(String));
      const marks = r.fields.map((f) => (f.type === 'sig' ? { ...f, type: 'image', image: 'sig' } : f.type === 'name' ? { ...f, type: 'text', text: signer.name } : f.type === 'date' ? { ...f, type: 'text', text: day }
        : f.type === 'check' && ticked.has(f.id) ? { ...f, type: 'check' } : null)).filter(Boolean);
      const x = {
        id: rid(), wsId: ws.id, memberId: auth.memberId, by: auth.member, itemId: null, name: fileName(r), title: r.title, signer, message: '', fields: [], pages: r.pages,
        token: rid(24), hash: d.sha256(r.bytes), status: 'signed', events: [], createdAt: Date.now(), expiresAt: Date.now() + 3650 * 86_400_000,
        recordId: at.rec.id, fieldId: at.f.id, projectId: at.p.id, inPerson: true, checks: [...ticked].filter((id) => r.fields.some((f) => f.id === id)),
      };
      d.signEvent(x, `Shown to ${signer.name} on ${auth.member}’s device (${ws.name})`, req);
      d.signEvent(x, `Agreed to sign electronically: “${d.CONSENT}”`, req);
      d.signEvent(x, `Signed in person as “${signer.name}”`, req);
      const doc = await d.pdfWork(() => d.stampPdf(r.bytes, { marks, images: { sig }, flatten: true }));
      await d.addCertificate(doc, {
        title: 'Signing certificate',
        rows: [['Document', x.name], ['Record', `${recName(at)} (${at.p.name})`], ['Fingerprint of the document as shown (SHA-256)', x.hash], ['Signer', signer.email ? `${signer.name} <${signer.email}>` : signer.name],
          ['Signed', d.utc(Date.now())], ['How', `In person, on a device held by ${auth.member} of ${ws.name}`], ...(x.checks.length ? [['Ticked', r.fields.filter((f) => x.checks.includes(f.id)).map((f) => f.label).join('; ')]] : [])],
        images: [['Signature', sig]],
        events: x.events.map((ev) => [d.utc(ev.at), ev.what + (ev.ip ? ` · from ${ev.ip}` : '') + (ev.ua ? ` · ${ev.ua}` : '')]),
        note: 'Made with Kloomie. The signer signed on the device in front of them; each line of the history shows when it happened, the network address and the browser.',
      });
      const bytes = Buffer.from(await doc.save());
      await d.writeSignFiles(x, r.bytes, bytes);
      const item = await d.addPdf({ wsId: ws.id, member: auth.member, memberId: auth.memberId, device: 'Sign-off', deviceId: null }, bytes, x.name.replace(/\.pdf$/i, '') + ' (signed).pdf', {});
      Object.assign(x, { signedAt: Date.now(), signedName: signer.name, signedHash: d.sha256(bytes), signedItemId: item.id, itemId: item.id });
      db.signs[x.id] = x;
      await finish(x, item, signer.name, sig);
      d.afterSigned(x, item, signer.name);
      save();
      d.signNews(x);
      return send(res, 200, { record: PJ.publicRecord(at.rec, PJ.viewOf(ws.id, auth.memberId)) });
    }
    // ----- sent to sign online -----
    if (e === 'send') {
      if (done) return send(res, 409, { error: 'This is already signed.' });
      if (open) return send(res, 409, { error: `It’s already with ${pending.to.name}. Remind them, or cancel it to send a new one.` });
      const signer = signerOf(body, at);
      if (!signer.email) return send(res, 400, { error: 'Add their email address so the link can reach them.' });
      const r = await render(ws, at, day, auth);
      // Asks first (PHASE3B.md §1): who it goes to and what it says, before any request is made.
      if (d.sendGate) {
        const title = r.title || fileName(r).replace(/\.pdf$/i, '');
        const note = cleanText(body.message, 2000);
        const pv = { to: signer.name || signer.email, via: 'email', email: signer.email, subject: `Please sign: ${title}`, text: [`${auth.member} at ${ws.name} sent you “${title}” to sign.`, note].filter(Boolean).join('\n') };
        const gate = d.sendGate(ws, auth, 'sign-send', `${at.rec.id}:${at.f.id}`, pv, d.sha256(JSON.stringify([signer.email, signer.name, note, title])), body.confirm);
        if (gate) return send(res, gate.status, gate.body);
      }
      const kinds = { sig: 'sig', name: 'name', date: 'date', check: 'check' };
      const x = {
        id: rid(), wsId: ws.id, memberId: auth.memberId, by: auth.member, itemId: null, name: fileName(r), title: r.title, signer, message: cleanText(body.message, 2000),
        fields: r.fields.map((f) => ({ id: f.id || rid(6), type: kinds[f.type], page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, ...(f.label ? { label: f.label } : {}) })),
        pages: r.pages, token: rid(24), hash: d.sha256(r.bytes), status: 'sent', events: [], createdAt: Date.now(), expiresAt: Date.now() + d.SIGN_DAYS * 86_400_000,
        recordId: at.rec.id, fieldId: at.f.id, projectId: at.p.id,
      };
      await d.writeSignFiles(x, r.bytes, null);
      d.signEvent(x, `Sent by ${auth.member} (${ws.name}) from ${at.p.name}: ${recName(at)}`, req);
      db.signs[x.id] = x;
      track(at.rec, at.f.id, { signId: x.id, status: 'sent', to: signer, at: Date.now() });
      PJ.recordActivity(at.rec.id, { kind: 'sign', what: 'sent', note: `${r.title} · to ${signer.name} (${signer.email})`, by: auth.member });
      const via = await d.emailSignLink(ws, auth, x);
      news(at.rec, auth.member);
      save();
      d.signNews(x);
      return send(res, 200, { record: PJ.publicRecord(at.rec, PJ.viewOf(ws.id, auth.memberId)), link: d.signLink(x), emailed: via });
    }
    const x = pending && db.signs[pending.signId];
    if (e === 'remind') {
      if (!open || !x) return send(res, 400, { error: 'There’s nothing waiting to be signed.' });
      if (d.sendGate) {
        const title = x.title || x.name.replace(/\.pdf$/i, '');
        const pv = { to: x.signer.name || x.signer.email, via: 'email', email: x.signer.email, subject: `Reminder: please sign: ${title}`, text: `A reminder: ${auth.member} at ${ws.name} sent you “${title}” to sign.` };
        const gate = d.sendGate(ws, auth, 'sign-remind', x.id, pv, d.sha256(JSON.stringify([x.signer.email, x.id])), body.confirm);
        if (gate) return send(res, gate.status, gate.body);
      }
      const via = await d.emailSignLink(ws, auth, x, true);
      if (!via) return send(res, 502, { error: 'The reminder didn’t send. Copy the link and send it yourself.' });
      save();
      return send(res, 200, { emailed: via, link: d.signLink(x) });
    }
    if (e === 'cancel') {
      if (!open || !x) return send(res, 400, { error: 'There’s nothing waiting to be signed.' });
      x.status = 'void';
      d.signEvent(x, `Cancelled by ${auth.member}`);
      track(at.rec, at.f.id, null);
      PJ.recordActivity(at.rec.id, { kind: 'sign', what: 'cancelled', note: x.title || x.name.replace(/\.pdf$/i, ''), by: auth.member });
      news(at.rec, auth.member);
      save();
      d.signNews(x);
      return send(res, 200, { record: PJ.publicRecord(at.rec, PJ.viewOf(ws.id, auth.memberId)) });
    }
    return null;
  }

  // A form as kept: a name, a title, and either lines written here or a PDF from the team's files.
  function cleanFormBody(body, ws, auth, old) {
    const out = {};
    const name = cleanText(body.name ?? old?.name, 80);
    if (!name) throw bad('Give the form a name.');
    out.name = name;
    out.title = cleanText(body.title ?? old?.title ?? '', 160);
    out.when = ['before', 'after', 'any'].includes(body.when) ? body.when : old?.when || 'after';
    const kind = body.kind ?? old?.kind ?? 'text';
    if (kind === 'pdf') {
      const it = db.items[body.itemId ?? old?.itemId];
      if (!it || it.wsId !== ws.id || it.status !== 'ready' || !d.canSee(auth, 'item', it)) throw bad('Pick the PDF for this form.');
      if (!d.isPdf(it)) throw bad('Only a PDF can be a form.');
      Object.assign(out, { kind: 'pdf', itemId: it.id, body: '' });
    } else {
      const text = String(body.body ?? old?.body ?? '').replace(/\r\n?/g, '\n').slice(0, 20_000).trim();
      if (!text) throw bad('Write what the form says.');
      Object.assign(out, { kind: 'text', body: text, itemId: null });
    }
    return out;
  }

  return { route, finish, sync };
}
