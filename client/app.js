// Column client: one UI for desktop (Electron), browsers and phones.
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  };
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('column.' + k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('column.' + k, JSON.stringify(v));
      } catch {}
    },
    del(k) {
      try {
        localStorage.removeItem('column.' + k);
      } catch {}
    },
  };
  const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  const desktop = window.columnDesktop || null;
  if (desktop) document.body.classList.add('desktop', 'platform-' + desktop.platform);

  const S = {
    token: store.get('token'),
    deviceId: store.get('deviceId') || newId(),
    workspace: null,
    me: null,
    items: [],
    online: [],
    uploads: new Map(),
    panes: store.get('panes', ['all']),
    notify: store.get('notify', false),
    desktopCfg: {},
    internalDrag: false,
    loginMode: 'join',
  };
  store.set('deviceId', S.deviceId);

  // ---------- icons ----------
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = {
    download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
    pin: svg('<path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/>'),
    stack: svg('<path d="M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    reveal: svg('<path d="M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>'),
  };

  // ---------- utils ----------
  function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do {
      n /= 1024;
      i++;
    } while (n >= 1024 && i < u.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  }
  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 45) return 'now';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    const d = new Date(t);
    if (s < 6 * 86400) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const linkify = (s) => esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  const ext = (name) => ((name || '').match(/\.([a-z0-9]{1,5})$/i) || [, ''])[1].toUpperCase();
  function kind(it) {
    if (it.type !== 'file') return it.type;
    const m = it.mime || '';
    if (/^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(m)) return 'image';
    if (/^video\/(mp4|webm|quicktime)$/.test(m)) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    if (m === 'application/pdf') return 'pdf';
    if (m.startsWith('text/') || /^(json|js|ts|css|html|md|csv|log|py|sh|yml|yaml|xml)$/i.test(ext(it.name))) return 'textfile';
    return 'file';
  }
  function guessDevice() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Device';
  }
  const t = () => encodeURIComponent(S.token);
  const abs = (p) => location.origin + p;
  function fileUrl(it, { dl = false, idx = null } = {}) {
    let p;
    if (it.type === 'folder') p = idx == null ? `/api/folders/${it.id}/zip` : `/api/folders/${it.id}/files/${idx}`;
    else p = `/api/files/${it.id}`;
    return `${p}?t=${t()}${dl ? '&dl=1' : ''}`;
  }
  function desktopInfo(it) {
    return {
      id: it.id,
      type: it.type,
      name: it.name,
      size: it.size,
      text: it.text,
      url: it.type === 'file' ? abs(fileUrl(it)) : null,
      files: it.type === 'folder' ? it.files.map((f) => ({ relPath: f.relPath, url: abs(fileUrl(it, { idx: f.i })) })) : null,
    };
  }

  function toast(msg, action) {
    const el = h('div', { class: 'toast' }, msg);
    if (action) el.append(h('button', { onclick: () => { action.run(); el.remove(); } }, action.label));
    $('#toasts').append(el);
    setTimeout(() => el.remove(), action ? 5000 : 2600);
  }

  // Two-step confirm for destructive buttons (no browser dialogs).
  function confirmClick(btn, fn) {
    if (btn.classList.contains('confirm')) return fn();
    btn.classList.add('confirm');
    const prev = btn.dataset.label ? btn.textContent : null;
    if (btn.dataset.label) btn.textContent = 'Click again to confirm';
    setTimeout(() => {
      btn.classList.remove('confirm');
      if (prev != null) btn.textContent = prev;
    }, 2500);
  }

  // ---------- api ----------
  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.token && path !== '/auth') {
      signOutLocal();
      throw new Error('Signed out');
    }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ---------- auth ----------
  function showLogin() {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    const f = $('#loginForm');
    f.name.value = store.get('name', '');
    f.device.value = store.get('device', guessDevice());
    f.workspace.value = store.get('lastWorkspace', '');
    (f.workspace.value ? f.passphrase : f.workspace).focus();
  }

  $('#modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.loginMode = b.dataset.mode;
    for (const x of $('#modeSeg').children) x.classList.toggle('on', x === b);
    $('#loginBtn').textContent = S.loginMode === 'create' ? 'Create & sign in' : 'Sign in';
    $('#loginErr').textContent = '';
  });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#loginErr').textContent = '';
    if (!f.workspace.value.trim()) return void ($('#loginErr').textContent = 'Enter an account or team name.');
    if (f.passphrase.value.length < 4) return void ($('#loginErr').textContent = 'Passphrase must be at least 4 characters.');
    $('#loginBtn').disabled = true;
    try {
      const body = {
        mode: S.loginMode,
        workspace: f.workspace.value,
        passphrase: f.passphrase.value,
        name: f.name.value || 'Me',
        device: f.device.value || guessDevice(),
        deviceId: S.deviceId,
      };
      const r = await api('POST', '/auth', body);
      S.token = r.token;
      store.set('token', r.token);
      store.set('name', body.name);
      store.set('device', body.device);
      store.set('lastWorkspace', body.workspace);
      f.passphrase.value = '';
      await start();
    } catch (err) {
      $('#loginErr').textContent = err.message;
    } finally {
      $('#loginBtn').disabled = false;
    }
  });

  function signOutLocal() {
    S.token = null;
    store.del('token');
    try {
      sock?.close();
    } catch {}
    S.items = [];
    $('#settings').classList.add('hidden');
    showLogin();
  }

  // ---------- realtime ----------
  let sock = null;
  let retry = 0;
  let hadConnection = false;
  function connect() {
    if (!S.token) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const s = new WebSocket(`${proto}://${location.host}/ws?t=${t()}`);
    sock = s;
    s.onopen = () => {
      retry = 0;
      $('#liveDot').classList.add('on');
      $('#liveDot').title = 'Live';
      if (hadConnection) loadState().catch(() => {}); // catch up on anything missed
      hadConnection = true;
    };
    s.onmessage = (e) => handle(JSON.parse(e.data));
    s.onclose = () => {
      if (sock !== s) return;
      $('#liveDot').classList.remove('on');
      $('#liveDot').title = 'Reconnecting…';
      if (S.token) setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
    };
  }

  function upsert(item) {
    const i = S.items.findIndex((x) => x.id === item.id);
    if (i >= 0) S.items[i] = item;
    else S.items.push(item);
  }

  function handle(msg) {
    if (msg.type === 'item:add') {
      const isNew = !S.items.some((x) => x.id === msg.item.id);
      upsert(msg.item);
      render();
      if (isNew && msg.item.deviceId !== S.deviceId) incoming(msg.item);
    } else if (msg.type === 'item:update') {
      upsert(msg.item);
      render();
    } else if (msg.type === 'item:remove') {
      S.items = S.items.filter((x) => x.id !== msg.id);
      render();
    } else if (msg.type === 'workspace') {
      S.workspace = msg.workspace;
      S.panes = S.panes.map((v) => (v.startsWith('stack:') && !stackById(v.slice(6)) ? 'files' : v));
      buildPanes();
      if (!$('#settings').classList.contains('hidden')) renderSettings();
    } else if (msg.type === 'presence') {
      S.online = msg.devices;
      renderDevices();
    }
  }

  function incoming(it) {
    if (S.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const body = it.type === 'message' || it.type === 'text' ? it.text.slice(0, 140) : `${it.name}${it.size ? ' · ' + fmtSize(it.size) : ''}`;
      try {
        new Notification(`${it.by} · ${it.device}`, { body, icon: '/icon-128.png', silent: false });
      } catch {}
    }
    if (desktop && S.desktopCfg.autoSave && (it.type === 'file' || it.type === 'folder')) {
      desktop.save(desktopInfo(it)).catch(() => {});
    }
  }

  async function loadState() {
    const st = await api('GET', '/state');
    S.workspace = st.workspace;
    S.me = st.me;
    S.items = st.items;
    S.panes = S.panes.map((v) => (v.startsWith('stack:') && !stackById(v.slice(6)) ? 'files' : v));
    $('#wsName').textContent = S.workspace.name;
    document.title = `${S.workspace.name} · Column`;
    buildPanes();
  }

  async function start() {
    try {
      if (desktop) S.desktopCfg = await desktop.getConfig();
      await loadState();
    } catch (e) {
      if (!S.token) return;
      toast('Could not reach server, retrying…');
      setTimeout(start, 3000);
      return;
    }
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    connect();
  }

  // ---------- views ----------
  const stackById = (id) => S.workspace?.stacks.find((s) => s.id === id);
  const VIEWS = { all: 'Everything', files: 'Files', chat: 'Chat' };
  const viewLabel = (v) => (v.startsWith('stack:') ? stackById(v.slice(6))?.name || 'Stack' : VIEWS[v]);
  const viewStack = (v) => (v.startsWith('stack:') ? v.slice(6) : null);
  const newestAtBottom = (v) => v === 'all' || v === 'chat';

  function itemsFor(view) {
    let list = S.items;
    if (view === 'files') list = list.filter((x) => x.type !== 'message');
    else if (view === 'chat') list = list.filter((x) => x.type === 'message');
    else if (view.startsWith('stack:')) list = list.filter((x) => x.stackId === viewStack(view));
    list = [...list].sort((a, b) => a.createdAt - b.createdAt);
    return newestAtBottom(view) ? list : list.reverse();
  }

  function setPanes(panes) {
    S.panes = panes;
    store.set('panes', panes);
    desktop?.setLayout(panes.length);
    buildPanes();
  }

  function buildPanes() {
    const root = $('#panes');
    root.innerHTML = '';
    const showChips = S.panes.length > 1 || (S.workspace?.stacks.length || 0) > 0;
    S.panes.forEach((view, i) => {
      const pane = h('section', { class: 'pane', 'data-i': i });
      pane._view = view;
      pane._cards = new Map();
      if (showChips) {
        const views = ['all', 'files', 'chat', ...S.workspace.stacks.map((s) => 'stack:' + s.id)];
        pane.append(
          h('div', { class: 'chips' }, views.map((v) =>
            h('button', {
              class: 'chip' + (v === view ? ' on' : ''),
              onclick: () => { const p = [...S.panes]; p[i] = v; setPanes(p); },
            }, viewLabel(v))
          ))
        );
      }
      pane._list = h('div', { class: 'list' + (newestAtBottom(view) ? ' bottom' : '') });
      pane.append(pane._list, composer(pane));
      root.append(pane);
    });
    render(true);
  }

  function composer(pane) {
    const view = pane._view;
    const ta = h('textarea', { rows: 1, placeholder: view === 'chat' || view === 'all' ? 'Message…' : 'Paste or type a note…' });
    const sendIt = async () => {
      const text = ta.value;
      if (!text.trim()) return;
      ta.value = '';
      ta.style.height = '';
      try {
        await api('POST', '/items', { type: view === 'chat' || view === 'all' ? 'message' : 'text', text, stackId: viewStack(view) });
      } catch (e) {
        ta.value = text;
        toast(e.message);
      }
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendIt();
      }
    });
    ta.addEventListener('input', () => {
      ta.style.height = '';
      ta.style.height = Math.min(ta.scrollHeight + 2, 120) + 'px';
    });
    const add = h('button', { class: 'add', title: 'Add files', onclick: () => pickFiles(viewStack(view)) }, '+');
    return h('div', { class: 'composer' }, add, ta);
  }

  // ---------- rendering ----------
  function render(force = false) {
    for (const pane of document.querySelectorAll('.pane')) renderPane(pane, force);
  }

  function renderPane(pane, force) {
    const view = pane._view;
    const list = pane._list;
    const items = itemsFor(view);
    const uploads = view === 'chat' ? [] : [...S.uploads.values()].filter((u) => !viewStack(view) || u.stackId === viewStack(view));
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;

    const want = [];
    for (const it of items) {
      let el = pane._cards.get(it.id);
      if (!el || el._item !== it || force) {
        const fresh = it.type === 'message' ? messageEl(it) : cardEl(it);
        if (el) el.replaceWith(fresh);
        el = fresh;
        el._item = it;
        pane._cards.set(it.id, el);
      }
      want.push(el);
    }
    for (const [id, el] of pane._cards) {
      if (!items.some((x) => x.id === id)) {
        el.remove();
        pane._cards.delete(id);
      }
    }
    const upEls = uploads.map((u) => uploadEl(u, pane.dataset.i + view));
    const ordered = newestAtBottom(view) ? [...want, ...upEls] : [...upEls, ...want];

    list.querySelector('.empty')?.remove();
    list.querySelectorAll('.card.uploading').forEach((n) => { if (!upEls.includes(n)) n.remove(); });
    ordered.forEach((el, i) => {
      if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
    });
    if (!ordered.length) {
      list.append(
        h('div', { class: 'empty' },
          h('b', {}, view === 'chat' ? 'No messages yet' : 'Drop anything'),
          h('small', {}, view === 'chat' ? 'Say something to your other devices' : 'files · folders · photos · music · video · text')
        )
      );
    }
    if (newestAtBottom(view) && (atBottom || force)) list.scrollTop = list.scrollHeight;
  }

  function subline(it) {
    const bits = [];
    if (it.type === 'folder') bits.push(`${it.files.length} file${it.files.length === 1 ? '' : 's'}`);
    if (it.size != null && it.type !== 'text') bits.push(fmtSize(it.size));
    bits.push(it.deviceId === S.deviceId ? 'this device' : it.device);
    bits.push(h('span', { 'data-ago': it.createdAt }, ago(it.createdAt)));
    const el = h('div', { class: 'sub' });
    bits.forEach((b, i) => { if (i) el.append(' · '); el.append(b); });
    if (it.stackId && stackById(it.stackId)) el.append(' · ', stackById(it.stackId).name);
    return el;
  }

  function actionsEl(it) {
    const a = h('div', { class: 'actions' });
    const btn = (icon, title, fn, cls) => h('button', { title, 'aria-label': title, class: cls, html: icon, onclick: (e) => { e.stopPropagation(); fn(e.currentTarget, e); } });
    if (it.type === 'file' || it.type === 'folder') a.append(btn(I.download, it.type === 'folder' ? 'Download (.zip)' : 'Download', () => download(it)));
    if (it.type === 'text' || it.type === 'message') a.append(btn(I.copy, 'Copy', () => copyText(it.text)));
    if (it.type !== 'message') {
      a.append(btn(I.pin, it.pinned ? 'Unpin' : 'Pin (never auto-clear)', () => api('PATCH', '/items/' + it.id, { pinned: !it.pinned }).catch((e) => toast(e.message)), it.pinned ? 'on' : null));
      a.append(btn(I.stack, 'Move to stack', (b) => stackMenu(it, b)));
    }
    a.append(btn(I.trash, 'Delete everywhere', (b) => confirmClick(b, () => api('DELETE', '/items/' + it.id).catch((e) => toast(e.message)))));
    return a;
  }

  function thumbEl(it) {
    const k = kind(it);
    const th = h('div', { class: 'thumb', onclick: () => openPreview(it) });
    if (k === 'image') th.append(h('img', { src: fileUrl(it), loading: 'lazy', alt: '' }));
    else if (k === 'video') {
      th.append(h('video', { src: fileUrl(it) + '#t=0.5', preload: 'metadata', muted: true, playsinline: true }));
      th.append(h('div', { class: 'play' }, '▶'));
    } else if (k === 'folder') th.innerHTML = I.folder;
    else if (k === 'audio') th.innerHTML = I.music;
    else th.textContent = ext(it.name) || 'FILE';
    if (k === 'folder' || k === 'audio') th.firstChild.style.cssText = 'width:20px;height:20px';
    return th;
  }

  function cardEl(it) {
    const k = kind(it);
    if (it.type === 'text') {
      const el = h('article', { class: 'card text' + (it.pinned ? ' pinned' : ''), draggable: 'true' },
        h('div', { class: 'meta' }, h('div', { class: 'snippet', html: linkify(it.text) }), subline(it)),
        actionsEl(it)
      );
      el.addEventListener('dblclick', () => openPreview(it));
      wireDrag(el, it);
      return el;
    }
    const big = k === 'image' || k === 'video';
    const el = h('article', { class: `card kind-${k}${big ? ' big' : ''}${it.pinned ? ' pinned' : ''}`, draggable: 'true', title: 'Drag out to save · click to preview' },
      thumbEl(it),
      h('div', { class: 'meta' }, h('div', { class: 'name' }, it.name), subline(it)),
      actionsEl(it)
    );
    el.addEventListener('dblclick', () => openPreview(it));
    wireDrag(el, it);
    return el;
  }

  function messageEl(it) {
    const mine = it.deviceId === S.deviceId;
    return h('article', { class: 'msg' + (mine ? ' mine' : '') },
      h('div', { class: 'who' }, `${mine ? 'You' : it.by} · ${it.device} · `, h('span', { 'data-ago': it.createdAt }, ago(it.createdAt))),
      h('div', { class: 'bubble', html: linkify(it.text) }),
      actionsEl(it)
    );
  }

  function updateUpload(u) {
    for (const el of Object.values(u.els || {})) {
      el.querySelector('i').style.width = Math.round((u.loaded / (u.size || 1)) * 100) + '%';
      el.querySelector('.sub').textContent = `Uploading… ${fmtSize(u.loaded)} of ${fmtSize(u.size)}`;
    }
  }

  // One placeholder element per pane (a DOM node can only live in one place).
  function uploadEl(u, paneKey) {
    u.els ||= {};
    if (!u.els[paneKey]) {
      const el = h('article', { class: 'card uploading' },
        h('div', { class: 'thumb', html: u.folder ? I.folder : null }, u.folder ? null : ext(u.name) || 'FILE'),
        h('div', { class: 'meta' }, h('div', { class: 'name' }, u.name), h('div', { class: 'sub' }, 'Uploading…'), h('div', { class: 'progress' }, h('i')))
      );
      if (u.folder) el.querySelector('.thumb svg').style.cssText = 'width:20px;height:20px';
      u.els[paneKey] = el;
      updateUpload(u);
    }
    return u.els[paneKey];
  }

  function renderDevices() {
    const el = $('#devices');
    el.innerHTML = '';
    const others = S.online.filter((d) => d.deviceId !== S.deviceId);
    others.slice(0, 2).forEach((d) => el.append(h('span', { title: `${d.member} · ${d.device} is online` }, d.device)));
    if (others.length > 2) el.append(h('span', { title: others.slice(2).map((d) => d.device).join(', ') }, '+' + (others.length - 2)));
  }

  setInterval(() => {
    for (const n of document.querySelectorAll('[data-ago]')) n.textContent = ago(Number(n.dataset.ago));
  }, 30_000);

  // ---------- actions ----------
  async function copyText(text) {
    try {
      if (desktop) desktop.copyText(text);
      else await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast('Could not copy');
    }
  }

  async function download(it) {
    if (desktop) {
      toast('Saving…');
      try {
        const p = await desktop.save(desktopInfo(it));
        toast('Saved to Downloads/Column', { label: 'Show', run: () => desktop.reveal(p) });
      } catch (e) {
        toast('Save failed: ' + e.message);
      }
      return;
    }
    const a = h('a', { href: fileUrl(it, { dl: true }), download: it.type === 'folder' ? it.name + '.zip' : it.name });
    document.body.append(a);
    a.click();
    a.remove();
  }

  function stackMenu(it, anchor) {
    const menu = $('#menu');
    menu.innerHTML = '';
    menu.append(h('div', { class: 'mh' }, 'Move to stack'));
    const opt = (label, id) => h('button', {
      class: (it.stackId || null) === id ? 'on' : null,
      onclick: () => { hideMenu(); api('PATCH', '/items/' + it.id, { stackId: id }).catch((e) => toast(e.message)); },
    }, label);
    menu.append(opt('No stack', null));
    for (const s of S.workspace.stacks) menu.append(opt(s.name, s.id));
    if (!S.workspace.stacks.length) menu.append(h('div', { class: 'mh', style: 'text-transform:none' }, 'Create stacks in ⚙ Settings'));
    menu.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8)) + 'px';
    menu.style.top = (r.bottom + mh + 8 > innerHeight ? r.top - mh - 4 : r.bottom + 4) + 'px';
  }
  const hideMenu = () => $('#menu').classList.add('hidden');
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#menu')) hideMenu(); });

  // ---------- preview ----------
  function openPreview(it) {
    const pv = $('#preview');
    pv.innerHTML = '';
    const k = kind(it);
    const close = () => { pv.classList.add('hidden'); pv.innerHTML = ''; };
    pv.onclick = (e) => { if (e.target === pv) close(); };
    pv.append(h('button', { class: 'icon-btn close', html: I.close, onclick: close, 'aria-label': 'Close' }));
    if (k === 'image') pv.append(h('img', { src: fileUrl(it), alt: it.name }));
    else if (k === 'video') pv.append(h('video', { src: fileUrl(it), controls: true, autoplay: true, playsinline: true }));
    else if (k === 'audio') pv.append(h('div', { style: 'color:#fff;font-size:15px' }, it.name), h('audio', { src: fileUrl(it), controls: true, autoplay: true }));
    else if (k === 'pdf') pv.append(h('iframe', { src: fileUrl(it) }));
    else if (k === 'text') pv.append(h('pre', { html: linkify(it.text) }));
    else if (k === 'textfile') {
      const pre = h('pre', {}, 'Loading…');
      pv.append(pre);
      fetch(fileUrl(it)).then((r) => r.text()).then((txt) => (pre.textContent = txt.slice(0, 500_000))).catch(() => (pre.textContent = 'Could not load'));
    } else if (k === 'folder') {
      pv.append(h('div', { class: 'flist' }, it.files.map((f) =>
        h('a', { href: fileUrl(it, { idx: f.i, dl: true }), download: f.relPath.split('/').pop() }, h('span', {}, f.relPath), h('small', {}, fmtSize(f.size)))
      )));
    } else {
      pv.append(h('div', { style: 'color:#fff;text-align:center' }, h('div', { style: 'font-size:40px;font-weight:700;opacity:.5' }, ext(it.name) || 'FILE'), it.name, h('br'), fmtSize(it.size)));
    }
    if (it.type !== 'text') {
      pv.append(h('div', { class: 'pv-bar' }, h('span', {}, it.name), h('button', { class: 'btn', onclick: () => download(it) }, it.type === 'folder' ? 'Download all (.zip)' : 'Download')));
    }
    pv.classList.remove('hidden');
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#preview').classList.contains('hidden')) { $('#preview').classList.add('hidden'); $('#preview').innerHTML = ''; }
      else if (!$('#settings').classList.contains('hidden')) $('#settings').classList.add('hidden');
      hideMenu();
    }
  });

  // ---------- drag out ----------
  function wireDrag(el, it) {
    if (desktop && (it.type === 'file' || it.type === 'folder')) {
      el.addEventListener('mouseenter', () => desktop.prefetch(desktopInfo(it)));
    }
    el.addEventListener('dragstart', (e) => {
      S.internalDrag = true;
      if (it.type === 'text') {
        e.dataTransfer.setData('text/plain', it.text);
        return;
      }
      if (desktop) {
        e.preventDefault();
        S.internalDrag = false;
        if (!desktop.startDrag(desktopInfo(it))) toast('Getting it ready — drag again in a moment');
        return;
      }
      const url = abs(fileUrl(it, { dl: true }));
      const name = it.type === 'folder' ? it.name + '.zip' : it.name;
      const mime = it.type === 'folder' ? 'application/zip' : it.mime;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('DownloadURL', `${mime}:${name}:${url}`);
      e.dataTransfer.setData('text/uri-list', url);
    });
    el.addEventListener('dragend', () => (S.internalDrag = false));
  }

  // ---------- drop in / paste / pick ----------
  const hasFiles = (dt) => dt && [...dt.types].includes('Files');
  let dragDepth = 0;
  function paneAt(target) {
    return target?.closest?.('.pane') || document.querySelector('.pane');
  }
  function clearDropping() {
    document.querySelectorAll('.pane.dropping').forEach((p) => p.classList.remove('dropping'));
  }
  window.addEventListener('dragenter', (e) => {
    if (S.internalDrag || !S.token) return;
    dragDepth++;
    e.preventDefault();
  });
  window.addEventListener('dragover', (e) => {
    if (S.internalDrag || !S.token) return;
    e.preventDefault();
    const pane = paneAt(e.target);
    if (!pane) return;
    if (!pane.classList.contains('dropping')) {
      clearDropping();
      pane.classList.add('dropping');
    }
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      clearDropping();
    }
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    clearDropping();
    if (S.internalDrag || !S.token) return;
    const pane = paneAt(e.target);
    const view = pane?._view || 'all';
    const stackId = viewStack(view);
    const dt = e.dataTransfer;
    if (hasFiles(dt)) {
      const entries = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
      const plainFiles = [...dt.files];
      if (!entries.length) return plainFiles.forEach((f) => queue(() => uploadFile(f, stackId)));
      for (const entry of entries) {
        if (entry.isDirectory) {
          const files = await walk(entry, '');
          queue(() => uploadFolder(entry.name, files, stackId));
        } else {
          const f = await new Promise((res, rej) => entry.file(res, rej));
          queue(() => uploadFile(f, stackId));
        }
      }
      return;
    }
    const text = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (text?.trim()) api('POST', '/items', { type: view === 'chat' ? 'message' : 'text', text: text.trim(), stackId }).catch((er) => toast(er.message));
  });

  async function walk(dir, prefix) {
    const out = [];
    const reader = dir.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const ent of batch) {
        if (ent.name === '.DS_Store' || ent.name === 'Thumbs.db') continue;
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        if (ent.isDirectory) out.push(...(await walk(ent, rel)));
        else out.push({ relPath: rel, file: await new Promise((res, rej) => ent.file(res, rej)) });
      }
    }
    return out;
  }

  document.addEventListener('paste', (e) => {
    if (!S.token || $('#app').classList.contains('hidden')) return;
    const files = [...(e.clipboardData?.files || [])];
    const inField = e.target.closest?.('input, textarea');
    const view = S.panes.find((v) => v !== 'chat') || 'all';
    if (files.length) {
      e.preventDefault();
      files.forEach((f, i) => {
        const name = f.name && f.name !== 'image.png' ? f.name : `Pasted ${new Date().toLocaleString().replace(/[/:]/g, '-')}${files.length > 1 ? ' ' + (i + 1) : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
        queue(() => uploadFile(new File([f], name, { type: f.type }), viewStack(view)));
      });
      return;
    }
    if (inField) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text?.trim()) api('POST', '/items', { type: 'text', text, stackId: viewStack(view) }).catch((er) => toast(er.message));
  });

  function pickFiles(stackId) {
    const inp = $('#filePick');
    inp.value = '';
    inp.onchange = () => [...inp.files].forEach((f) => queue(() => uploadFile(f, stackId)));
    inp.click();
  }

  // Simple upload queue: 2 at a time.
  const pending = [];
  let active = 0;
  function queue(job) {
    pending.push(job);
    pump();
  }
  function pump() {
    while (active < 2 && pending.length) {
      const job = pending.shift();
      active++;
      job().catch((e) => toast('Upload failed: ' + e.message)).finally(() => { active--; pump(); });
    }
  }

  function put(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Authorization', 'Bearer ' + S.token);
      xhr.upload.onprogress = (e) => onProgress(e.loaded);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        xhr.status < 300 ? resolve(data) : reject(new Error(data.error || 'HTTP ' + xhr.status));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(file);
    });
  }

  async function uploadFile(file, stackId) {
    const u = { key: newId(), name: file.name, size: file.size, loaded: 0, stackId };
    S.uploads.set(u.key, u);
    render();
    try {
      const qs = new URLSearchParams({ name: file.name, type: file.type || '', ...(stackId ? { stackId } : {}) });
      const item = await put('/api/upload?' + qs, file, (n) => { u.loaded = n; updateUpload(u); });
      upsert(item);
    } finally {
      S.uploads.delete(u.key);
      render();
    }
  }

  async function uploadFolder(name, files, stackId) {
    const total = files.reduce((n, f) => n + f.file.size, 0);
    const u = { key: newId(), name, size: total, loaded: 0, stackId, folder: true };
    S.uploads.set(u.key, u);
    render();
    try {
      const { id } = await api('POST', '/folders', { name, stackId });
      let done = 0;
      const next = [...files];
      const worker = async () => {
        while (next.length) {
          const f = next.shift();
          let last = 0;
          const qs = new URLSearchParams({ folder: id, relPath: f.relPath, mtime: f.file.lastModified || '' });
          await put('/api/upload?' + qs, f.file, (n) => { done += n - last; last = n; u.loaded = done; updateUpload(u); });
          done += f.file.size - last;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const item = await api('POST', `/folders/${id}/done`);
      upsert(item);
    } finally {
      S.uploads.delete(u.key);
      render();
    }
  }

  // ---------- settings ----------
  $('#settingsBtn').addEventListener('click', () => {
    const s = $('#settings');
    if (s.classList.toggle('hidden')) return;
    renderSettings();
  });

  function toggleRow(label, hint, checked, onChange) {
    const input = h('input', { type: 'checkbox' });
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked, input));
    return h('div', { class: 'srow' }, h('span', {}, label, hint ? h('small', {}, hint) : null), h('label', { class: 'toggle' }, input, h('i')));
  }

  function renderSettings() {
    const s = $('#settings');
    const ws = S.workspace;
    s.innerHTML = '';
    s.append(h('h2', {}, 'Settings', h('button', { class: 'icon-btn', html: I.close, 'aria-label': 'Close', onclick: () => s.classList.add('hidden') })));

    // Layout
    const seg = h('div', { class: 'seg' },
      h('button', { class: S.panes.length === 1 ? 'on' : null, onclick: () => { setPanes([S.panes[0] === 'files' ? 'all' : S.panes[0]]); renderSettings(); } }, 'One column'),
      h('button', { class: S.panes.length === 2 ? 'on' : null, onclick: () => { setPanes(['files', 'chat']); renderSettings(); } }, 'Split: files | chat')
    );
    s.append(h('section', {}, h('h3', {}, 'Layout'), seg,
      h('p', { style: 'margin-top:8px;font-size:11.5px' }, 'Use the tabs at the top of each column to switch what it shows: everything, files, chat, or a stack.')));

    // Stacks
    const stackSec = h('section', {}, h('h3', {}, 'Stacks (folders)'));
    for (const st of ws.stacks) {
      const inp = h('input', { value: st.name });
      inp.addEventListener('change', () => api('PATCH', '/stacks/' + st.id, { name: inp.value }).catch((e) => toast(e.message)));
      const del = h('button', { class: 'btn danger', title: 'Delete stack (items stay, just unsorted)' }, 'Delete');
      del.addEventListener('click', () => confirmClick(del, () => api('DELETE', '/stacks/' + st.id).catch((e) => toast(e.message))));
      stackSec.append(h('div', { class: 'stack-row' }, inp, del));
    }
    const newInp = h('input', { placeholder: 'New stack, e.g. Design, Receipts…' });
    const addStack = () => {
      if (!newInp.value.trim()) return;
      api('POST', '/stacks', { name: newInp.value }).catch((e) => toast(e.message));
      newInp.value = '';
    };
    newInp.addEventListener('keydown', (e) => e.key === 'Enter' && addStack());
    stackSec.append(h('div', { class: 'stack-row' }, newInp, h('button', { class: 'btn', onclick: addStack }, 'Add')));
    s.append(stackSec);

    // Auto-clear
    const sel = h('select', {},
      [[0, 'Never'], [1, 'After 1 hour'], [24, 'After 24 hours'], [168, 'After 7 days'], [720, 'After 30 days']].map(([v, l]) =>
        h('option', { value: v, selected: ws.settings.expireHours === v }, l)
      )
    );
    sel.addEventListener('change', () => api('PATCH', '/workspace', { expireHours: Number(sel.value) }).catch((e) => toast(e.message)));
    s.append(h('section', {}, h('h3', {}, 'Auto-clear'),
      h('div', { class: 'srow' }, h('span', {}, 'Remove items', h('small', {}, 'Pinned items are always kept')), sel)));

    // This device
    const dev = h('section', {}, h('h3', {}, 'This device'));
    if ('Notification' in window) {
      dev.append(toggleRow('Notifications', 'When something arrives from another device', S.notify && Notification.permission === 'granted', async (on, input) => {
        if (on && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          if (p !== 'granted') { input.checked = false; toast('Notifications blocked by the system'); return; }
        }
        S.notify = on;
        store.set('notify', on);
      }));
    }
    if (desktop) {
      dev.append(
        toggleRow('Always on top', 'Keep the column above other windows', S.desktopCfg.alwaysOnTop, (on) => { S.desktopCfg.alwaysOnTop = on; desktop.setConfig({ alwaysOnTop: on }); }),
        toggleRow('Auto-save incoming files', 'Copy everything that arrives into Downloads/Column', S.desktopCfg.autoSave, (on) => { S.desktopCfg.autoSave = on; desktop.setConfig({ autoSave: on }); }),
        toggleRow('Open at login', null, S.desktopCfg.openAtLogin, (on) => { S.desktopCfg.openAtLogin = on; desktop.setConfig({ openAtLogin: on }); }),
        h('div', { class: 'srow' }, h('span', {}, 'Show / hide', h('small', {}, desktop.platform === 'darwin' ? '⌘ ⇧ Space, or the menu bar icon' : 'Ctrl + Shift + Space, or the tray icon'))),
        h('div', { class: 'btns', style: 'margin-top:8px' },
          h('button', { class: 'btn', onclick: () => desktop.openFolder() }, 'Open Downloads/Column'),
          h('button', { class: 'btn', onclick: () => desktop.changeServer() }, 'Change server')
        )
      );
    }
    s.append(dev);

    // Account
    const devices = S.online.map((d) => `${d.device}${d.deviceId === S.deviceId ? ' (this)' : ''}`).join(', ');
    const clearBtn = h('button', { class: 'btn danger', 'data-label': '1' }, 'Clear unpinned items');
    clearBtn.addEventListener('click', () => confirmClick(clearBtn, () => api('POST', '/clear').then(() => toast('Cleared')).catch((e) => toast(e.message))));
    s.append(h('section', {}, h('h3', {}, 'Account'),
      h('p', {}, 'Signed in to ', h('b', {}, ws.name), ` as ${S.me.member} on ${S.me.device}.`),
      h('p', {}, 'Online now: ', devices || '—'),
      h('p', {}, 'To add another computer, phone or teammate: open ', h('code', {}, location.origin), ` and sign in to “${ws.name}” with the same passphrase. On a phone, use “Add to Home Screen” to keep it as an app.`),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => copyText(location.origin) }, 'Copy link'),
        clearBtn,
        h('button', { class: 'btn', onclick: () => { api('POST', '/logout').catch(() => {}).finally(signOutLocal); } }, 'Sign out')
      )
    ));
  }

  // ---------- boot ----------
  if (desktop) desktop.onConfig?.((cfg) => (S.desktopCfg = cfg));
  if (S.token) start();
  else showLogin();
  if (desktop) desktop.setLayout(S.panes.length);
})();
