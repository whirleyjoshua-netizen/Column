// The page someone opens to sign a document they were sent. No account: the private link is their way in.
(() => {
  const token = location.pathname.split('/')[2] || '';
  const API = `/api/public/sign/${encodeURIComponent(token)}`;
  const page = document.getElementById('page');
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  };
  const V = { info: null, consent: false, name: '', sig: null, ini: null, values: {}, view: null, doc: null, width: 0 };
  const today = new Date().toLocaleDateString();

  function message(title, text, extra) {
    page.replaceChildren(h('div', { class: 'done' }, h('h1', {}, title), h('p', {}, text), extra || null));
  }

  async function start() {
    let r;
    try {
      r = await fetch(API);
    } catch {
      return message('Couldn’t connect', 'Check your internet connection, then reload this page.');
    }
    const info = await r.json().catch(() => ({}));
    if (!r.ok) return message('Link not available', info.error || 'This link isn’t available.');
    V.info = info;
    V.name = info.signer.name;
    document.title = `Sign: ${info.name}`;
    if (/^#[0-9a-f]{3,8}$/i.test(info.accent || '')) document.documentElement.style.setProperty('--accent', info.accent);
    if (info.status === 'signed') return finished();
    if (info.status === 'declined') return message('You declined to sign', `Let ${info.from} know if that was a mistake. They can send you a new link.`);
    if (info.status === 'expired') return message('This link has expired', `Ask ${info.from} at ${info.team} for a new one.`);
    render();
  }

  function finished() {
    page.replaceChildren(h('div', { class: 'done' },
      h('div', { class: 'tick' }, '✓'),
      h('h1', {}, 'Signed'),
      h('p', {}, `“${V.info.name}” is signed, and ${V.info.from} at ${V.info.team} has the signed copy. Keep one for yourself:`),
      h('a', { class: 'btn go', href: `${API}/signed` }, 'Download the signed copy')));
  }

  const need = () => {
    const f = V.info.fields;
    const missing = [];
    if (!V.consent) missing.push('agree to sign electronically');
    if (!V.name.trim()) missing.push('type your name');
    if (f.some((x) => x.type === 'sig') && !V.sig) missing.push('sign');
    if (f.some((x) => x.type === 'ini') && !V.ini) missing.push('add your initials');
    return missing;
  };

  function render() {
    const info = V.info;
    const nameIn = h('input', { value: V.name, autocomplete: 'name', 'aria-label': 'Your full name' });
    nameIn.addEventListener('input', () => {
      V.name = nameIn.value;
      refresh();
    });
    const agree = h('input', { type: 'checkbox' });
    agree.addEventListener('change', () => {
      V.consent = agree.checked;
      refresh();
    });
    const doc = h('div', { class: 'doc' }, h('p', { class: 'small', style: 'text-align:center' }, 'Opening the document…'));
    const status = h('div', {});
    const err = h('p', { class: 'err' });
    const finish = h('button', { class: 'btn go', onclick: submit }, 'Finish');
    page.replaceChildren(
      h('header', {},
        info.logo ? h('img', { class: 'brand', src: info.logo, alt: info.team }) : null,
        h('h1', {}, info.name),
        h('p', { class: 'from' }, `${info.from} at ${info.team} sent this for ${info.signer.name} to sign.`),
        info.message ? h('div', { class: 'msg' }, info.message) : null),
      h('div', { class: 'card' }, h('div', { class: 'consent' },
        h('label', {}, agree, h('span', {}, info.consent)),
        h('label', { class: 'name' }, 'Your full name', nameIn))),
      doc,
      h('div', { class: 'foot' }, h('div', { class: 'left' }, status, err), h('button', { class: 'link', onclick: decline }, 'Decline'), finish));
    V.refreshBar = () => {
      const missing = need();
      status.textContent = missing.length ? `To finish: ${missing.join(', ')}.` : 'Ready. Press Finish to sign.';
      finish.disabled = missing.length > 0;
    };
    refresh();
    ColumnPdf.open(`${API}/file`).then((d) => {
      V.doc = d;
      layout(doc);
      let t;
      window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => layout(doc), 200);
      });
    }).catch(() => doc.replaceChildren(h('p', { class: 'err', style: 'text-align:center' }, 'Couldn’t open the document. Reload the page to try again.')));

    async function submit() {
      err.textContent = '';
      finish.disabled = true;
      finish.textContent = 'Signing…';
      try {
        const r = await fetch(API, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consent: V.consent, name: V.name, sig: V.sig, ini: V.ini, date: today, values: V.values }),
        });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || 'Something went wrong. Try again.');
        finished();
      } catch (e) {
        err.textContent = e.message;
        finish.textContent = 'Finish';
        refresh();
      }
    }
  }
  function refresh() {
    V.refreshBar?.();
    for (const node of document.querySelectorAll('.f')) node.refresh?.();
  }

  async function layout(host) {
    const width = Math.min(host.clientWidth - 16, 880);
    if (Math.abs(width - V.width) < 4) return;
    V.width = width;
    V.view?.stop();
    const box = h('div', {});
    host.replaceChildren(box);
    V.view = await ColumnPdf.pages(V.doc, box, {
      width,
      onPage: (p) => {
        for (const f of V.info.fields) if (f.page === p.n) p.layer.append(field(p, f));
      },
    });
  }

  // One of the boxes the sender placed for them.
  function field(p, f) {
    const b = ColumnPdf.fromPdf(p, f);
    const node = h('div', { class: 'f', style: `left:${b.left}px;top:${b.top}px;width:${b.w}px;height:${b.h}px` });
    const font = `font-size:${Math.min(b.h * 0.6, 15 * p.vp.scale)}px`;
    if (f.type === 'sig' || f.type === 'ini') {
      node.setAttribute('role', 'button');
      node.tabIndex = 0;
      node.addEventListener('click', () => V.consent ? padFor(f.type) : nudge());
      node.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && node.click());
      node.refresh = () => {
        const png = V[f.type];
        node.classList.toggle('filled', !!png);
        node.classList.toggle('locked', !V.consent);
        node.replaceChildren(png ? h('img', { src: png, alt: '' }) : f.type === 'sig' ? 'Sign here' : 'Initials');
      };
    } else if (f.type === 'date') {
      node.classList.add('filled');
      node.style.cssText += ';justify-content:flex-start;padding-left:3px;color:#111;font-weight:400;font-family:Helvetica,Arial,sans-serif;' + font;
      node.textContent = today;
    } else if (f.type === 'name') {
      node.refresh = () => {
        node.classList.toggle('filled', !!V.name.trim());
        node.replaceChildren(h('span', { style: `color:#111;font-weight:400;font-family:Helvetica,Arial,sans-serif;width:100%;padding-left:3px;${font}` }, V.name));
      };
    } else {
      const input = h('input', { value: V.values[f.id] || '', style: font, 'aria-label': f.label || 'Text', maxlength: '300' });
      input.addEventListener('input', () => {
        V.values[f.id] = input.value;
        node.classList.toggle('filled', !!input.value.trim());
      });
      node.append(input);
    }
    node.refresh?.();
    return node;
  }

  function nudge() {
    const box = document.querySelector('.consent');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.parentElement.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 300 });
  }

  function modal(title, body, okLabel, onOk) {
    const err = h('p', { class: 'err' });
    const close = () => wrap.remove();
    const ok = h('button', { class: 'btn go' }, okLabel);
    ok.addEventListener('click', async () => {
      err.textContent = '';
      try {
        if ((await onOk()) !== false) close();
      } catch (e) {
        err.textContent = e.message;
      }
    });
    const wrap = h('div', { class: 'modal', onclick: (e) => e.target === wrap && close() },
      h('div', {}, h('h2', {}, title), ...body, err, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), ok)));
    document.body.append(wrap);
  }

  function padFor(kind) {
    const typed = kind === 'ini' ? V.name.split(/\s+/).map((w) => w[0] || '').join('').toUpperCase() : V.name;
    const pad = ColumnPdf.pad({ typed, label: kind === 'ini' ? 'Your initials' : 'Your signature' });
    modal(kind === 'ini' ? 'Add your initials' : 'Add your signature', [pad.el], 'Use this', () => {
      const png = pad.png();
      if (!png) throw new Error('Draw or type it first.');
      V[kind] = png;
      refresh();
    });
  }

  function decline() {
    const why = h('textarea', { rows: 3, placeholder: 'Why? (optional, sent to them)' });
    modal('Decline to sign?', [h('p', {}, `${V.info.from} will see that you declined.`), why], 'Decline', async () => {
      const r = await fetch(`${API}/decline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: why.value }) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || 'Something went wrong. Try again.');
      message('You declined to sign', `${V.info.from} at ${V.info.team} has been told.`);
    });
  }

  start();
})();
