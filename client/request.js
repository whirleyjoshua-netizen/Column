// The page a customer opens to send files into a team's stack. No account: the private link is their way in.
(() => {
  const token = location.pathname.split('/')[2] || '';
  const API = `/api/public/request/${encodeURIComponent(token)}`;
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
  const size = (n) => {
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
    return (i && n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  };
  const NAME_KEY = 'column-request-name';
  const remembered = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };

  function gone(text) {
    page.replaceChildren(h('p', { class: 'gone' }, text));
  }

  function draw(info) {
    if (/^#[0-9a-f]{3,8}$/i.test(info.accent || '')) document.documentElement.style.setProperty('--accent', info.accent);
    document.title = `Send files to ${info.team}`;
    const name = h('input', { type: 'text', autocomplete: 'name', placeholder: 'So they know who it’s from', value: remembered() });
    const pick = h('input', { type: 'file', multiple: true, class: 'hidden' });
    const list = h('ul');
    const drop = h('div', { class: 'drop', role: 'button', tabindex: '0', onclick: () => pick.click(), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && pick.click() },
      h('b', {}, 'Choose files or photos'),
      h('small', {}, 'or drag them here · up to ' + size(info.maxBytes) + ' each'),
      h('span', { class: 'btn' }, 'Choose files'));
    const queue = [];
    let busy = false;
    const next = async () => {
      if (busy) return;
      const job = queue.shift();
      if (!job) return;
      busy = true;
      await send(job);
      busy = false;
      next();
    };
    const send = (job) => new Promise((done) => {
      const from = name.value.trim();
      try { localStorage.setItem(NAME_KEY, from); } catch {}
      const q = new URLSearchParams({ name: job.file.name, type: job.file.type || '', from });
      const x = new XMLHttpRequest();
      x.open('PUT', `${API}/file?${q}`);
      x.upload.onprogress = (e) => { if (e.lengthComputable) job.bar.style.width = Math.round((e.loaded / e.total) * 100) + '%'; };
      x.onload = () => {
        let err = '';
        try { err = x.status === 200 ? '' : JSON.parse(x.responseText).error; } catch { err = 'Couldn’t send this one.'; }
        job.li.className = err ? 'fail' : 'done';
        job.st.textContent = err || 'Sent ✓';
        done();
      };
      x.onerror = () => { job.li.className = 'fail'; job.st.textContent = 'Couldn’t send. Check your connection.'; done(); };
      job.st.textContent = 'Sending…';
      x.send(job.file);
    });
    const add = (files) => {
      for (const file of files) {
        const bar = h('i');
        const st = h('span', { class: 'st' }, file.size > info.maxBytes ? 'Too big' : 'Waiting…');
        const li = h('li', { class: file.size > info.maxBytes ? 'fail' : null }, h('div', { class: 'top' }, h('span', { class: 'nm' }, file.name), st), h('div', { class: 'bar' }, bar));
        list.prepend(li);
        if (file.size <= info.maxBytes) queue.push({ file, li, st, bar });
      }
      next();
    };
    pick.addEventListener('change', () => { add([...pick.files]); pick.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); add([...e.dataTransfer.files]); });
    page.replaceChildren(...[
      info.logo ? h('img', { class: 'brand', src: info.logo, alt: info.team }) : null,
      h('h1', {}, `Send files to ${info.team}`),
      h('p', { class: 'from' }, `${info.by} asked for files. They go straight to the team.`),
      info.note ? h('div', { class: 'msg' }, info.note) : null,
      h('label', { class: 'name' }, 'Your name', name),
      drop, pick, list,
      h('p', { class: 'small' }, info.expiresAt ? `This link works until ${new Date(info.expiresAt).toLocaleDateString()}.` : 'Sent with Kloomie'),
    ].filter(Boolean));
  }

  fetch(API).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return gone(body.error || 'This link isn’t available.');
    draw(body);
  }).catch(() => gone('Couldn’t load this page. Check your connection and try again.'));
})();
