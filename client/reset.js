// The page a password-reset email links to: choose a new password. The link works once, for 30 minutes.
(() => {
  const token = location.pathname.split('/')[2] || '';
  const API = `/api/public/reset/${encodeURIComponent(token)}`;
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
  const gone = (text) => page.replaceChildren(h('p', { class: 'gone' }, text), h('p', { class: 'small' }, h('a', { href: '/' }, 'Back to sign in')));

  function draw(info) {
    const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
    const again = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const err = h('p', { class: 'err' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Save new password');
    const form = h('form', { novalidate: true },
      h('label', { class: 'name' }, 'New password (at least 8 characters)', pw),
      h('label', { class: 'name' }, 'Type it again', again),
      err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (pw.value.length < 8) return (err.textContent = 'Choose a password of at least 8 characters.');
      if (pw.value !== again.value) return (err.textContent = 'The two passwords don’t match.');
      btn.disabled = true;
      try {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'That didn’t work. Try again.');
        page.replaceChildren(
          h('h1', {}, 'Password changed'),
          h('p', { class: 'from' }, 'You’ve been signed out on your other devices. Sign in with your email and new password.'),
          h('a', { class: 'btn', href: '/' }, 'Sign in'));
      } catch (e2) {
        err.textContent = e2.message;
        btn.disabled = false;
      }
    });
    page.replaceChildren(h('h1', {}, 'Choose a new password'), h('p', { class: 'from' }, `For ${info.email}`), form);
    pw.focus();
  }

  fetch(API).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return gone(body.error || 'This link isn’t available.');
    draw(body);
  }).catch(() => gone('Couldn’t load this page. Check your connection and try again.'));
})();
