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
    panes: store.get('panes', ['all']).map((v) => (v === 'chat' ? 'all' : v)), // chat moved to its own tab
    notify: store.get('notify', false),
    desktopCfg: {},
    internalDrag: false,
    loginMode: 'signin',
    entries: [],
    tasks: [],
    tab: 'day',
    remind: store.get('remind', true),
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
    left: svg('<path d="M15 18l-6-6 6-6"/>'),
    right: svg('<path d="M9 18l6-6-6-6"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    share: svg('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v12M7 8l5-5 5 5"/>'),
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    down: svg('<path d="M6 9l6 6 6-6"/>'),
    task: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
    smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
    reply: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
    flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    repeat: svg('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
    target: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8"/>'),
    lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
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
    setLoginMode(S.loginMode);
    (!f.workspace.value ? f.workspace : !f.name.value ? f.name : f.password).focus();
  }

  const LOGIN_MODES = {
    signin: { btn: 'Sign in', hint: '' },
    join: { btn: 'Join team', hint: 'New to a team? Ask someone on it for the invite code, then choose your own password.' },
    create: { btn: 'Create team', hint: 'Start a new team. You’ll get an invite code to share in Settings.' },
  };
  function setLoginMode(mode) {
    S.loginMode = mode;
    for (const x of $('#modeSeg').children) x.classList.toggle('on', x.dataset.mode === mode);
    $('#loginBtn').textContent = LOGIN_MODES[mode].btn;
    $('#modeHint').textContent = LOGIN_MODES[mode].hint;
    $('#modeHint').classList.toggle('hidden', !LOGIN_MODES[mode].hint);
    $('#codeField').classList.toggle('hidden', mode !== 'join');
    $('#loginForm').password.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    $('#loginErr').textContent = '';
  }
  $('#modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setLoginMode(b.dataset.mode);
  });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#loginErr').textContent = '';
    const err = (msg) => void ($('#loginErr').textContent = msg);
    if (!f.workspace.value.trim()) return err('Enter a team name.');
    if (!f.name.value.trim()) return err('Enter your name.');
    if (f.password.value.length < 6) return err('Password must be at least 6 characters.');
    if (S.loginMode === 'join' && !f.code.value.trim()) return err('Enter the invite code.');
    $('#loginBtn').disabled = true;
    try {
      const body = {
        mode: S.loginMode,
        workspace: f.workspace.value,
        password: f.password.value,
        code: f.code.value,
        name: f.name.value.trim(),
        device: f.device.value || guessDevice(),
        deviceId: S.deviceId,
      };
      const r = await api('POST', '/auth', body);
      S.token = r.token;
      store.set('token', r.token);
      store.set('name', body.name);
      store.set('device', body.device);
      store.set('lastWorkspace', body.workspace);
      f.password.value = '';
      f.code.value = '';
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
    s.onclose = (e) => {
      if (sock !== s) return;
      if (e.code === 4001) {
        toast('You were signed out of this team');
        return signOutLocal();
      }
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
      chatChanged();
      if (isNew && msg.item.deviceId !== S.deviceId) incoming(msg.item);
    } else if (msg.type === 'item:update') {
      upsert(msg.item);
      render();
      refreshLinks();
    } else if (msg.type === 'item:remove') {
      S.items = S.items.filter((x) => x.id !== msg.id);
      checkThread();
      render();
      refreshLinks();
      chatChanged();
    } else if (msg.type === 'workspace') {
      S.workspace = msg.workspace;
      applyBrand();
      refreshLinks();
      S.panes = S.panes.map((v) => (v.startsWith('stack:') && !stackById(v.slice(6)) ? 'files' : v));
      buildPanes();
      if (C.view.startsWith('ch:') && !channelById(viewChannel(C.view))) C.view = 'chat';
      if (S.tab === 'chat') openChannel(C.view);
      else renderChatSide();
      if (!$('#settings').classList.contains('hidden')) renderSettings();
    } else if (msg.type === 'entry') {
      upsertEntry(msg.entry);
      renderDay();
    } else if (msg.type === 'entry:remove') {
      S.entries = S.entries.filter((x) => x.id !== msg.id);
      renderDay();
    } else if (msg.type === 'task') {
      const was = taskById(msg.task.id);
      upsertTask(msg.task);
      if (msg.task.assigneeId === S.me?.memberId && was?.assigneeId !== msg.task.assigneeId && msg.task.assignedBy !== S.me?.memberId) assignedToMe(msg.task);
      renderDay();
      refreshLinks();
    } else if (msg.type === 'task:remove') {
      S.tasks = S.tasks.filter((x) => x.id !== msg.id);
      renderDay();
      refreshLinks();
    } else if (msg.type === 'campaign' || msg.type === 'goal' || msg.type === 'attempt') {
      const list = { campaign: S.campaigns, goal: S.goals, attempt: S.attempts }[msg.type];
      const x = msg[msg.type];
      const i = list.findIndex((y) => y.id === x.id);
      if (msg.type === 'campaign' && x.assigneeId === S.me?.memberId && list[i]?.assigneeId !== x.assigneeId && x.assignedBy !== S.me?.memberId) assignedToMe(x, 'campaign');
      if (i >= 0) list[i] = x;
      else list.push(x);
      renderCamps();
      renderDay();
      refreshLinks();
    } else if (msg.type === 'campaign:remove' || msg.type === 'goal:remove' || msg.type === 'attempt:remove') {
      const key = { 'campaign:remove': 'campaigns', 'goal:remove': 'goals', 'attempt:remove': 'attempts' }[msg.type];
      S[key] = S[key].filter((y) => y.id !== msg.id);
      renderCamps();
      renderDay();
      refreshLinks();
    } else if (msg.type === 'template') {
      upsertTemplate(msg.template);
      renderCamps();
    } else if (msg.type === 'template:remove') {
      S.templates = S.templates.filter((y) => y.id !== msg.id);
      renderCamps();
    } else if (msg.type === 'resync') {
      // Who can see a private campaign or feed changed.
      loadState().catch(() => {});
    } else if (msg.type === 'agent') {
      agentUpdated(msg.agent);
    } else if (msg.type === 'calendars') {
      if (!$('#settings').classList.contains('hidden')) loadCalendars();
    } else if (msg.type === 'presence') {
      S.online = msg.devices;
      renderDevices();
      const settings = $('#settings');
      if (!settings.classList.contains('hidden') && !settings.contains(document.activeElement)) renderSettings();
    }
  }

  function incoming(it) {
    if (S.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const body = it.type === 'message' ? plainText(it.text).slice(0, 140) : it.type === 'text' ? it.text.slice(0, 140) : `${it.name}${it.size ? ' · ' + fmtSize(it.size) : ''}`;
      try {
        const ch = channelById(it.channelId);
        new Notification(`${it.by}${mentionsMe(it) ? ' mentioned you' : ''}${ch ? ' in #' + ch.name : ''} · ${it.device}`, { body, icon: '/icon-128.png', silent: false });
      } catch {}
    }
    if (desktop && S.desktopCfg.autoSave && (it.type === 'file' || it.type === 'folder')) {
      desktop.save(desktopInfo(it)).catch(() => {});
    }
  }

  // Someone else gave me a task: a toast here, and a system notification if the app is in the background.
  // Same for a campaign I'm made responsible for. Things that arrive together (Plan it out, or a campaign
  // with its tasks) become one notice. Nobody assigned it = a saved campaign started on its schedule.
  let assignedBatch = [];
  function assignedToMe(x, kind = 'task') {
    assignedBatch.push({ kind, x });
    if (assignedBatch.length === 1) setTimeout(flushAssigned, 800);
  }
  function flushAssigned() {
    const list = assignedBatch;
    assignedBatch = [];
    const camps = list.filter((a) => a.kind === 'campaign').map((a) => a.x);
    const tasks = list.filter((a) => a.kind === 'task').map((a) => a.x);
    const by = [...new Set(list.map((a) => a.x.assignedBy).filter(Boolean).map(memberName))].join(', ');
    const plural = (n, one) => (n === 1 ? 'a ' + one : `${n} ${one}s`);
    const what = camps.length ? plural(camps.length, 'campaign') : plural(tasks.length, 'task');
    const title = by ? `${by} assigned you ${what}` : `Scheduled: ${what} for you`;
    const body = camps.length ? camps.map((c) => c.name).join(' · ') + (tasks.length ? ` · ${plural(tasks.length, 'task')}` : '')
      : tasks.length === 1 ? tasks[0].text.slice(0, 140) + (tasks[0].due ? ` · due ${tasks[0].due}` : '')
      : tasks.slice(0, 3).map((t) => t.text.slice(0, 60)).join(' · ') + (tasks.length > 3 ? ' …' : '');
    const show = camps.length ? () => openCampaign(camps[0].id) : showTasks;
    toast(`${title}: ${body}`, { label: 'Show', run: show });
    if (S.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, icon: '/icon-128.png', silent: false });
        n.onclick = () => { window.focus(); show(); };
      } catch {}
    }
  }

  async function loadState() {
    const st = await api('GET', '/state');
    S.workspace = st.workspace;
    S.me = st.me;
    S.items = st.items;
    S.entries = st.entries || [];
    S.tasks = st.tasks || [];
    S.campaigns = st.campaigns || [];
    S.goals = st.goals || [];
    S.attempts = st.attempts || [];
    S.templates = st.templates || [];
    S.panes = S.panes.map((v) => (v.startsWith('stack:') && !stackById(v.slice(6)) ? 'files' : v));
    $('#wsName').textContent = S.workspace.name;
    document.title = `${S.workspace.name} · Column`;
    applyBrand();
    buildPanes();
    renderDay();
    renderCamps();
    if (S.tab === 'chat') openChannel(C.view);
    else renderChatSide();
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
    setTab('day');
    connect();
  }

  // ---------- views ----------
  const stackById = (id) => S.workspace?.stacks.find((s) => s.id === id);
  const VIEWS = { all: 'Everything', files: 'Files' };
  const viewLabel = (v) => (v.startsWith('stack:') ? stackById(v.slice(6))?.name || 'Stack' : VIEWS[v]);
  const viewStack = (v) => (v.startsWith('stack:') ? v.slice(6) : null);
  const viewChannel = (v) => (v.startsWith('ch:') ? v.slice(3) : null);
  const viewThread = (v) => (v.startsWith('th:') ? v.slice(3) : null);
  const destOf = (v) => (viewThread(v) ? { parentId: viewThread(v) } : { stackId: viewStack(v), channelId: viewChannel(v) });
  const isChatView = (v) => v === 'chat' || v.startsWith('ch:') || v.startsWith('th:');
  const newestAtBottom = (v) => v === 'all' || isChatView(v);

  function itemsFor(view) {
    const th = viewThread(view);
    if (th) return S.items.filter((x) => x.id === th || x.parentId === th).sort((a, b) => a.createdAt - b.createdAt);
    const ch = viewChannel(view);
    let list = S.items.filter((x) => (x.channelId || null) === ch && !x.parentId);
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
        const views = ['all', 'files', ...S.workspace.stacks.map((s) => 'stack:' + s.id)];
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
    const chan = channelById(viewChannel(view));
    const ta = h('textarea', { rows: 1, placeholder: viewThread(view) ? 'Reply…' : chan ? `Message #${chan.name}` : view === 'chat' && S.tab === 'chat' ? 'Message #general' : isChatView(view) || view === 'all' ? 'Message…' : 'Paste or type a note…' });
    const chat = isChatView(view);
    const links = []; // picked but not sent yet
    const tray = h('div', { class: 'tray hidden' });
    const drawTray = () => {
      tray.replaceChildren(...links.map((l, i) => h('span', { class: 'tray-chip' },
        h('span', { class: 'ln-ic', html: l.type === 'stack' ? I.stack : l.type === 'task' ? I.task : l.type === 'campaign' ? I.target : I.link }),
        h('span', { class: 'ln-text' }, linkName(l)),
        h('button', { 'aria-label': 'Remove', html: I.close, onclick: () => { links.splice(i, 1); drawTray(); } }))));
      tray.classList.toggle('hidden', !links.length);
    };
    const addLink = (r) => {
      if (!links.some((l) => l.type === r.type && l.id === r.id)) links.push({ type: r.type, id: r.id });
      drawTray();
      ta.focus();
    };
    const sendIt = async () => {
      const text = ta.value;
      if (!text.trim() && !links.length) return;
      const sent = links.splice(0);
      const body = [text.trim(), sent.map((l) => linkToken(l.type, l.id)).join(' ')].filter(Boolean).join('\n');
      ta.value = '';
      ta.style.height = '';
      drawTray();
      try {
        await api('POST', '/items', { type: chat || view === 'all' ? 'message' : 'text', text: sent.length ? body : text, ...destOf(view) });
      } catch (e) {
        ta.value = text;
        links.push(...sent);
        drawTray();
        toast(e.message);
      }
    };
    let mentionKey = () => false;
    ta.addEventListener('keydown', (e) => {
      if (mentionKey(e)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendIt();
      } else if (e.key === 'ArrowUp' && chat && !ta.value) {
        // Up in an empty box edits your last message, like Slack.
        const last = itemsFor(view).filter((x) => x.type === 'message' && isMine(x)).sort((x, y) => y.createdAt - x.createdAt)[0];
        const el = last && pane._cards.get(last.id);
        if (el) { e.preventDefault(); el.scrollIntoView({ block: 'nearest' }); editMessage(el, last); }
      }
    });
    ta.addEventListener('input', () => {
      ta.style.height = '';
      ta.style.height = Math.min(ta.scrollHeight + 2, 120) + 'px';
      // Typing [[ opens the link picker.
      const at = ta.selectionStart;
      if (chat && ta.value.slice(at - 2, at) === '[[') {
        ta.value = ta.value.slice(0, at - 2) + ta.value.slice(at);
        ta.setSelectionRange(at - 2, at - 2);
        openPicker(wrap, addLink);
      }
    });
    const add = h('button', { class: 'add', title: 'Add files', onclick: () => pickFiles(destOf(view)) }, '+');
    if (!chat) return h('div', { class: 'composer' }, add, ta);
    const linkBtn = h('button', { class: 'add link-btn', title: 'Link a stack, file or task  ([[)', 'aria-label': 'Link a stack, file or task', html: I.link, onclick: () => openPicker(wrap, addLink) });
    const wrap = h('div', { class: 'composer-wrap' }, tray, h('div', { class: 'composer' }, viewThread(view) ? null : add, linkBtn, ta));
    mentionKey = mentionAuto(wrap, ta);
    return wrap;
  }

  // ---------- rendering ----------
  function render(force = false) {
    for (const pane of document.querySelectorAll('.pane')) renderPane(pane, force);
  }

  function renderPane(pane, force) {
    const view = pane._view;
    const list = pane._list;
    const items = itemsFor(view);
    const uploads = view === 'chat' || viewThread(view) ? [] : [...S.uploads.values()].filter((u) => (u.channelId || null) === viewChannel(view) && (!viewStack(view) || u.stackId === viewStack(view)));
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;

    const want = [];
    for (const it of items) {
      let el = pane._cards.get(it.id);
      const key = it.type === 'message' ? threadKey(it) : '';
      if (!el || ((el._item !== it || el._key !== key || force) && !el._editing)) {
        const fresh = it.type === 'message' ? messageEl(it, view) : cardEl(it);
        if (el) el.replaceWith(fresh);
        el = fresh;
        el._item = it;
        el._key = key;
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
          h('b', {}, isChatView(view) ? 'No messages yet' : 'Drop anything'),
          h('small', {}, isChatView(view) ? 'Say something to your other devices' : 'files · folders · photos · music · video · text')
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
    if (it.share) el.append(' · ', h('span', { class: 'shared', title: 'Anyone with the link can download this' }, 'public link'));
    return el;
  }

  function actionsEl(it, view = '') {
    const a = h('div', { class: 'actions' });
    const btn = (icon, title, fn, cls) => h('button', { title, 'aria-label': title, class: cls, html: icon, onclick: (e) => { e.stopPropagation(); fn(e.currentTarget, e); } });
    if (it.type === 'file' || it.type === 'folder') a.append(btn(I.download, it.type === 'folder' ? 'Download (.zip)' : 'Download', () => download(it)));
    if (it.type === 'message') a.append(btn(I.smile, 'React', (b) => reactMenu(b, it)));
    if (it.type === 'message' && !it.parentId && !viewThread(view)) a.append(btn(I.reply, 'Reply in thread', () => openThread(it.id)));
    if (it.type === 'text' || it.type === 'message') {
      a.append(btn(I.copy, 'Copy', () => copyText(it.type === 'message' ? plainText(it.text) : it.text)));
      a.append(btn(I.clock, 'Add to my day', () => openSheet({ text: it.text.slice(0, 5000), date: todayKey() })));
    }
    if (it.type === 'file' || it.type === 'folder') a.append(btn(I.share, 'Share to chat', (b) => shareMenu(b, linkToken('file', it.id))));
    if (it.type === 'file' || it.type === 'folder') a.append(btn(I.link, it.share ? 'Public link' : 'Make a public link', (b) => publicLinkMenu(b, it), it.share ? 'on' : null));
    if (it.type === 'file' || it.type === 'folder') a.append(btn(I.edit, 'Rename', (b) => startRename(b.closest('.card'), it)));
    if (it.type !== 'message') {
      a.append(btn(I.pin, it.pinned ? 'Unpin' : 'Pin (never auto-clear)', () => api('PATCH', '/items/' + it.id, { pinned: !it.pinned }).catch((e) => toast(e.message)), it.pinned ? 'on' : null));
      if (!it.channelId) a.append(btn(I.stack, 'Move to stack', (b) => stackMenu(it, b)));
    }
    if (it.type === 'message' && isMine(it)) a.append(btn(I.edit, 'Edit', (b) => editMessage(b.closest('.msg'), it)));
    if (it.type !== 'message' || isMine(it) || amOwner()) {
      a.append(btn(I.trash, it.type === 'message' ? 'Delete message' : 'Delete everywhere', (b) => confirmClick(b, () => api('DELETE', '/items/' + it.id).catch((e) => toast(e.message)))));
    }
    return a;
  }

  // Swap `el` for a text input. Enter or blur commits, Escape cancels; `el` goes back either way.
  // onDone gets the trimmed text, or null when cancelled.
  function inlineEdit(el, { value = '', placeholder = '', select, onDone }) {
    const inp = h('input', { class: 'rename', value, placeholder, 'aria-label': placeholder || 'Name', spellcheck: 'false' });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      inp.replaceWith(el);
      onDone(commit ? inp.value.trim() : null);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(true));
    for (const ev of ['click', 'dblclick', 'pointerdown']) inp.addEventListener(ev, (e) => e.stopPropagation());
    el.replaceWith(inp);
    inp.focus();
    if (select) inp.setSelectionRange(...select);
    return inp;
  }

  // Rename a file card in place. The extension is left unselected, like Finder.
  function startRename(card, it) {
    const nameEl = card?.querySelector('.name');
    if (!nameEl || card.querySelector('.rename')) return;
    const dot = it.type === 'file' ? it.name.lastIndexOf('.') : -1;
    card.draggable = false;
    inlineEdit(nameEl, { value: it.name, select: [0, dot > 0 ? dot : it.name.length], onDone: (name) => {
      card.draggable = true;
      if (!name || name === it.name) return;
      nameEl.textContent = name;
      api('PATCH', '/items/' + it.id, { name }).catch((e) => { nameEl.textContent = it.name; toast(e.message); });
    } });
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

  // Yours from any device. Items from before per-person logins only know their device.
  const isMine = (it) => (it.memberId ? it.memberId === S.me?.memberId : it.deviceId === S.deviceId);

  const amOwner = () => S.workspace?.members?.find((m) => m.id === S.me?.memberId)?.role === 'owner';
  const memberName = (id) => (id === S.me?.memberId ? 'You' : S.workspace?.members?.find((m) => m.id === id)?.name || 'Someone');

  // ---------- @mentions: plain "@Name" in the text, so edits and copies just work. @here is everyone. ----------
  const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentionNames = () => ['here', ...(S.workspace?.members || []).map((m) => m.name)].sort((a, b) => b.length - a.length);
  const mentionRe = (names, flags) => new RegExp(`(^|[\\s(])@(${names.map(reEsc).join('|')})(?![\\w])`, flags);
  function mentionsMe(it) {
    if (it.type !== 'message' || isMine(it) || !it.text.includes('@')) return false;
    const me = S.workspace?.members?.find((m) => m.id === S.me?.memberId);
    return mentionRe(['here', ...(me ? [me.name] : [])], 'i').test(it.text);
  }
  // Highlight mentions in already-escaped message html.
  function mentionify(html) {
    if (!html.includes('@')) return html;
    const me = S.workspace?.members?.find((m) => m.id === S.me?.memberId)?.name.toLowerCase();
    return html.replace(mentionRe(mentionNames().map(esc), 'gi'), (_, pre, name) => {
      const self = name.toLowerCase() === 'here' || esc(me || '') === name.toLowerCase();
      return `${pre}<span class="mention${self ? ' me' : ''}">@${name}</span>`;
    });
  }

  // Autocomplete for "@" in a chat composer. Returns a keydown hook; true means it used the key.
  function mentionAuto(wrap, ta) {
    let pop = null, rows = [], sel = 0, at = -1;
    const close = () => { pop?.remove(); pop = null; };
    const pick = (name) => {
      const end = ta.selectionStart;
      ta.value = ta.value.slice(0, at) + '@' + name + ' ' + ta.value.slice(end);
      const caret = at + name.length + 2;
      ta.setSelectionRange(caret, caret);
      close();
      ta.focus();
    };
    const draw = () => {
      pop.replaceChildren(h('div', { class: 'mh' }, 'Mention'), ...rows.map((r, i) =>
        h('button', { class: 'pk-row' + (i === sel ? ' on' : ''), onpointerdown: (e) => { e.preventDefault(); pick(r.name); } },
          h('span', { class: 'pk-ic at-ic' }, r.here ? '@' : r.name.slice(0, 1).toUpperCase()),
          h('span', { class: 'pk-label' }, r.here ? '@here' : r.name),
          h('span', { class: 'pk-sub' }, r.here ? 'everyone in the team' : r.online ? 'online' : ''))));
    };
    ta.addEventListener('input', () => {
      const before = ta.value.slice(0, ta.selectionStart);
      const m = before.match(/(^|\s)@([^\s@]{0,30})$/);
      if (!m) return close();
      at = before.length - m[2].length - 1;
      const q = m[2].toLowerCase();
      const hit = (n) => n.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || n.toLowerCase().startsWith(q);
      rows = [
        ...(S.workspace?.members || []).filter((x) => x.id !== S.me?.memberId && hit(x.name))
          .map((x) => ({ name: x.name, online: S.online?.some((d) => d.memberId === x.id) })),
        ...('here'.startsWith(q) ? [{ name: 'here', here: true }] : []),
      ].slice(0, 8);
      if (!rows.length) return close();
      sel = 0;
      if (!pop) wrap.append((pop = h('div', { class: 'picker mention-pop' })));
      draw();
    });
    ta.addEventListener('blur', close);
    return (e) => {
      if (!pop) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        draw();
      } else if (e.key === 'Enter' || e.key === 'Tab') pick(rows[sel].name);
      else if (e.key === 'Escape') close();
      else return false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    };
  }

  const repliesTo = (id) => S.items.filter((x) => x.parentId === id);
  const threadKey = (it) => { const r = repliesTo(it.id); return r.length ? r.length + ':' + Math.max(...r.map((x) => x.createdAt)) : ''; };

  // In a thread pane the parent shows on top and doesn't link to itself.
  function threadEl(it, view) {
    const r = repliesTo(it.id);
    if (!r.length || viewThread(view)) return null;
    const last = Math.max(...r.map((x) => x.createdAt));
    const who = [...new Set(r.map((x) => (isMine(x) ? 'You' : x.by)))].slice(0, 3).join(', ');
    return h('button', { class: 'thread-link', onclick: () => openThread(it.id) },
      h('b', {}, `${r.length} repl${r.length === 1 ? 'y' : 'ies'}`), ` · ${who} · `, h('span', { 'data-ago': last }, ago(last)));
  }

  function messageEl(it, view = '') {
    const mine = isMine(it);
    const atMe = mentionsMe(it);
    const links = linksIn(it.text);
    const text = links.length ? stripLinks(it.text) : it.text;
    return h('article', { class: 'msg' + (mine ? ' mine' : '') + (atMe ? ' at-me' : '') },
      h('div', { class: 'who' }, `${mine ? 'You' : it.by} · ${it.device} · `, h('span', { 'data-ago': it.createdAt }, ago(it.createdAt)),
        it.editedAt ? h('span', { class: 'edited', title: 'Edited ' + new Date(it.editedAt).toLocaleString() }, ' · edited') : null),
      text ? h('div', { class: 'bubble', html: mentionify(linkify(text)) }) : null,
      links.length ? h('div', { class: 'links' }, links.map(linkEl)) : null,
      reactsEl(it),
      threadEl(it, view),
      actionsEl(it, view)
    );
  }

  // ---------- reactions + editing ----------
  const EMOJI = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '✅', '🔥'];
  const react = (it, emoji) => api('POST', `/items/${it.id}/react`, { emoji }).catch((e) => toast(e.message));

  function reactsEl(it) {
    const r = Object.entries(it.reactions || {});
    if (!r.length) return null;
    return h('div', { class: 'reacts' }, r.map(([emoji, who]) =>
      h('button', { class: 'react' + (who.includes(S.me?.memberId) ? ' on' : ''), title: who.map(memberName).join(', '), onclick: () => react(it, emoji) },
        emoji, h('span', {}, String(who.length)))));
  }

  function reactMenu(anchor, it) {
    openMenu(anchor, [{ emojis: EMOJI, run: (emoji) => react(it, emoji) }]);
  }

  // Edit a message in place. Links stay attached; only the words are edited.
  function editMessage(el, it) {
    if (!el || el._editing) return;
    const links = linksIn(it.text);
    const old = links.length ? stripLinks(it.text) : it.text;
    const bubble = el.querySelector('.bubble');
    const ta = h('textarea', { class: 'msg-edit', rows: 1, 'aria-label': 'Edit message' });
    ta.value = old;
    const hint = h('div', { class: 'edit-hint' }, 'Enter to save · Esc to cancel');
    const box = h('div', { class: 'edit-box' }, ta, hint);
    el._editing = true;
    el.classList.add('editing');
    if (bubble) bubble.replaceWith(box);
    else el.querySelector('.who').after(box);
    const grow = () => { ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight + 2, 240) + 'px'; };
    const finish = (save) => {
      if (!el._editing) return;
      el._editing = false;
      const next = ta.value.trim();
      if (save && !next && !links.length) {
        el._editing = true;
        return toast('A message can’t be empty — delete it instead.');
      }
      el._item = null; // redraw on the next render
      render();
      if (!save || next === old.trim()) return;
      const text = [next, links.map((l) => linkToken(l.type, l.id)).join(' ')].filter(Boolean).join('\n');
      api('PATCH', '/items/' + it.id, { text }).catch((e) => toast(e.message));
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ta.addEventListener('input', grow);
    ta.addEventListener('blur', () => setTimeout(() => finish(true), 0));
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    grow();
  }

  // ---------- links in chat: [[file:<id>]], [[stack:<id>]], [[task:<id>]] ----------
  // They point at the live thing, so renames, ticks and deletes show up in old messages too.
  const LINK_RE = /\[\[(file|stack|task|campaign):([\w-]+)\]\]/g;
  const linkToken = (type, id) => `[[${type}:${id}]]`;
  const linksIn = (text) => [...text.matchAll(LINK_RE)].map(([, type, id]) => ({ type, id }));
  const stripLinks = (text) => text.replace(LINK_RE, '').trim();
  const linkedFile = (id) => S.items.find((x) => x.id === id && (x.type === 'file' || x.type === 'folder'));
  const stackCount = (id) => S.items.filter((x) => x.stackId === id && !x.channelId).length;

  function linkName({ type, id }) {
    if (type === 'file') return linkedFile(id)?.name || 'Removed file';
    if (type === 'stack') return stackById(id)?.name || 'Removed stack';
    if (type === 'campaign') return campById(id)?.name || 'Campaign';
    return taskById(id)?.text || 'Deleted task';
  }
  // Message text with links spelled out, for notifications and copying.
  const plainText = (text) => text.replace(LINK_RE, (_, type, id) => linkName({ type, id })).trim();

  function showStack(id) {
    setTab('column');
    const p = [...S.panes];
    p[0] = 'stack:' + id;
    setPanes(p);
  }
  function showTasks() {
    setTab('day');
    setSub('tasks');
  }

  function linkEl({ type, id }) {
    const gone = (msg) => h('div', { class: 'ln ln-gone' }, msg);
    if (type === 'file') {
      const it = linkedFile(id);
      if (!it) return gone('File no longer available');
      if (kind(it) === 'image') {
        const img = h('img', { class: 'ln-img', src: fileUrl(it), alt: it.name, loading: 'lazy', draggable: 'true', title: it.name, onclick: () => openPreview(it) });
        wireDrag(img, it);
        return img;
      }
      const el = h('div', { class: 'ln ln-file', draggable: 'true', title: 'Click to preview · drag out to save' },
        thumbEl(it),
        h('div', { class: 'meta', onclick: () => openPreview(it) },
          h('div', { class: 'name' }, it.name),
          h('div', { class: 'sub' }, it.type === 'folder' ? `${it.files.length} files · ${fmtSize(it.size)}` : fmtSize(it.size))),
        h('button', { class: 'icon-btn', title: 'Download', 'aria-label': 'Download', html: I.download, onclick: () => download(it) })
      );
      wireDrag(el, it);
      return el;
    }
    if (type === 'stack') {
      const st = stackById(id);
      if (!st) return gone('Stack no longer exists');
      const n = stackCount(id);
      return h('button', { class: 'ln ln-chip', title: 'Open stack', onclick: () => showStack(id) },
        h('span', { class: 'ln-ic', html: I.stack }), h('span', { class: 'ln-text' }, st.name), h('span', { class: 'ln-sub' }, `${n} item${n === 1 ? '' : 's'}`));
    }
    if (type === 'campaign') {
      const c = campById(id);
      if (!c) return gone('Campaign not available');
      const p = campProgress(c);
      return h('button', { class: 'ln ln-chip ln-camp c-' + c.color, title: 'Open campaign', onclick: () => openCampaign(id) },
        h('span', { class: 'ln-ic', html: I.target }), h('span', { class: 'ln-text' }, c.name), bar(p, c.color), h('span', { class: 'ln-sub' }, Math.round(p * 100) + '%'));
    }
    const t = taskById(id);
    if (!t) return gone('Task was deleted');
    const slot = taskSlot(t);
    return h('div', { class: 'ln ln-chip ln-task' + (t.done ? ' done' : '') },
      h('button', { class: 'check' + (t.done ? ' on' : ''), html: I.check, 'aria-label': t.done ? 'Mark not done' : 'Mark done', onclick: () => patchTask(t, { done: !t.done }) }),
      h('span', { class: 'ln-text', title: 'Open tasks', onclick: showTasks }, t.text),
      slot ? h('span', { class: 'ln-sub' }, slot.label) : null);
  }

  // Redraw messages that link to something, after the thing changed.
  function refreshLinks() {
    for (const pane of document.querySelectorAll('.pane')) {
      for (const [id, el] of pane._cards) {
        const it = el._item;
        if (it?.type !== 'message' || !it.text.includes('[[') || el._editing) continue;
        const fresh = messageEl(it, pane._view);
        fresh._item = it;
        fresh._key = el._key;
        el.replaceWith(fresh);
        pane._cards.set(id, fresh);
      }
    }
  }

  // Search picker above a chat composer.
  let picker = null;
  function closePicker() {
    picker?.remove();
    picker = null;
  }
  document.addEventListener('pointerdown', (e) => { if (picker && !e.target.closest('.picker, .link-btn')) closePicker(); });

  function openPicker(wrap, onPick) {
    if (picker) return closePicker();
    const q = h('input', { class: 'pk-q', placeholder: 'Link a stack, file or task…', spellcheck: 'false', 'aria-label': 'Search' });
    const list = h('div', { class: 'pk-list' });
    let rows = [];
    let sel = 0;
    const pick = (r) => {
      closePicker();
      if (r) onPick(r);
    };
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      const hit = (t) => !s || t.toLowerCase().includes(s);
      const cap = s ? 20 : 6;
      const groups = [
        ['Stacks', S.workspace.stacks.filter((x) => hit(x.name)).map((x) => ({ type: 'stack', id: x.id, label: x.name, icon: I.stack, sub: `${stackCount(x.id)} item${stackCount(x.id) === 1 ? '' : 's'}` }))],
        ['Files & images', S.items.filter((x) => (x.type === 'file' || x.type === 'folder') && hit(x.name)).sort((a, b) => b.createdAt - a.createdAt)
          .map((x) => ({ type: 'file', id: x.id, label: x.name, it: x, sub: fmtSize(x.size) }))],
        ['Campaigns', S.campaigns.filter((c) => hit(c.name)).map((c) => ({ type: 'campaign', id: c.id, label: c.name, icon: I.target, sub: Math.round(campProgress(c) * 100) + '%' }))],
        ['Tasks', S.tasks.filter((t) => hit(t.text)).sort((a, b) => a.done - b.done || b.createdAt - a.createdAt)
          .map((t) => ({ type: 'task', id: t.id, label: t.text, icon: I.task, sub: t.done ? 'done' : taskSlot(t)?.label }))],
      ];
      rows = [];
      list.replaceChildren();
      for (const [title, all] of groups) {
        if (!all.length) continue;
        list.append(h('div', { class: 'mh' }, title));
        for (const r of all.slice(0, cap)) {
          const i = rows.length;
          rows.push(r);
          const icon = r.it
            ? kind(r.it) === 'image' ? h('img', { class: 'pk-ic', src: fileUrl(r.it), alt: '' }) : h('span', { class: 'pk-ic pk-ext', html: r.it.type === 'folder' ? I.folder : null }, r.it.type === 'folder' ? null : (ext(r.it.name) || 'file').slice(0, 4))
            : h('span', { class: 'pk-ic', html: r.icon });
          list.append(h('button', { class: 'pk-row' + (i === sel ? ' on' : ''), onclick: () => pick(r) },
            icon, h('span', { class: 'pk-label' }, r.label), r.sub ? h('span', { class: 'pk-sub' }, r.sub) : null));
        }
      }
      if (!rows.length) list.append(h('div', { class: 'pk-none' }, s ? 'Nothing matches' : 'Nothing to link yet'));
      list.querySelector('.pk-row.on')?.scrollIntoView({ block: 'nearest' });
    };
    q.addEventListener('input', () => { sel = 0; draw(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % (rows.length || 1);
        draw();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(rows[sel]);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        closePicker();
        wrap.querySelector('textarea')?.focus();
      }
    });
    picker = h('div', { class: 'picker' }, q, list);
    wrap.append(picker);
    draw();
    q.focus();
  }

  // Post a link into a feed.
  function shareMenu(anchor, token) {
    const send = async (view, name) => {
      try {
        await api('POST', '/items', { type: 'message', text: token, channelId: viewChannel(view) });
        toast(`Shared to #${name}`, { label: 'Show', run: () => { C.view = view; setTab('chat'); } });
      } catch (e) {
        toast(e.message);
      }
    };
    openMenu(anchor, [
      { head: 'Share to' },
      { label: '# general', run: () => send('chat', 'general') },
      ...(S.workspace.channels || []).map((c) => ({ label: '# ' + c.name, run: () => send('ch:' + c.id, c.name) })),
    ]);
  }

  function updateUpload(u) {
    for (const el of Object.values(u.els || {})) {
      el.querySelector('i').style.width = Math.round((u.loaded / (u.size || 1)) * 100) + '%';
      el.querySelector('.sub').textContent = u.retrying ? `Connection lost · will resume at ${fmtSize(u.loaded)}` : `Uploading… ${fmtSize(u.loaded)} of ${fmtSize(u.size)}`;
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

  // Popup menu under `anchor`. Rows: { head }, { note }, or { label, run, on, danger } (danger asks for a second click).
  function openMenu(anchor, rows) {
    const menu = $('#menu');
    menu.innerHTML = '';
    for (const r of rows) {
      if (r.head) menu.append(h('div', { class: 'mh' }, r.head));
      else if (r.note) menu.append(h('div', { class: 'mh', style: 'text-transform:none' }, r.note));
      else if (r.emojis) menu.append(h('div', { class: 'emoji-row' }, r.emojis.map((e) => h('button', { 'aria-label': 'React ' + e, onclick: () => { hideMenu(); r.run(e); } }, e))));
      else {
        const b = h('button', { class: (r.on ? 'on' : '') + (r.danger ? ' danger' : ''), 'data-label': r.danger ? '1' : null }, r.label);
        b.addEventListener('click', () => (r.danger ? confirmClick(b, () => { hideMenu(); r.run(); }) : (hideMenu(), r.run())));
        menu.append(b);
      }
    }
    menu.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const x = r.left + r.right < innerWidth ? r.left : r.right - mw; // open toward the roomier side
    menu.style.left = Math.max(8, Math.min(x, innerWidth - mw - 8)) + 'px';
    menu.style.top = (r.bottom + mh + 8 > innerHeight ? r.top - mh - 4 : r.bottom + 4) + 'px';
  }

  // Public download links. They work for anyone who can reach this server.
  const shareUrl = (it) => `${location.origin}/s/${it.share.token}`;
  function publicLinkMenu(anchor, it) {
    const make = async (hours) => {
      try {
        const next = await api('POST', `/items/${it.id}/share`, { hours });
        upsert(next);
        render();
        copyText(shareUrl(next));
      } catch (e) {
        toast(e.message);
      }
    };
    if (!it.share) {
      return openMenu(anchor, [
        { head: 'Public link' },
        { note: 'Anyone with the link can download it, without signing in.' },
        { label: 'Create link', run: () => make(null) },
        { label: 'Link that expires in 1 day', run: () => make(24) },
        { label: 'Link that expires in 7 days', run: () => make(24 * 7) },
      ]);
    }
    openMenu(anchor, [
      { head: 'Public link' },
      { note: it.share.expiresAt ? `Expires ${new Date(it.share.expiresAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Never expires' },
      { label: 'Copy link', run: () => copyText(shareUrl(it)) },
      { label: 'Open link', run: () => window.open(shareUrl(it), '_blank', 'noopener') },
      { label: 'New link (old one stops working)', run: () => make(it.share.expiresAt ? Math.max(1, (it.share.expiresAt - Date.now()) / 3600_000) : null) },
      { label: 'Stop sharing', danger: true, run: () => api('DELETE', `/items/${it.id}/share`).then((x) => { upsert(x); render(); toast('Link turned off'); }).catch((e) => toast(e.message)) },
    ]);
  }

  function stackMenu(it, anchor) {
    const move = (id) => api('PATCH', '/items/' + it.id, { stackId: id }).catch((e) => toast(e.message));
    openMenu(anchor, [
      { head: 'Move to stack' },
      { label: 'No stack', on: !it.stackId, run: () => move(null) },
      ...S.workspace.stacks.map((s) => ({ label: s.name, on: it.stackId === s.id, run: () => move(s.id) })),
      ...(S.workspace.stacks.length ? [] : [{ note: 'Create stacks in ⚙ Settings' }]),
    ]);
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
      if (!$('#sheet').classList.contains('hidden')) closeSheet();
      else if (!$('#preview').classList.contains('hidden')) { $('#preview').classList.add('hidden'); $('#preview').innerHTML = ''; }
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
    return target?.closest?.('.pane') || (S.tab === 'chat' ? C.pane : document.querySelector('#panes .pane'));
  }
  function clearDropping() {
    document.querySelectorAll('.pane.dropping').forEach((p) => p.classList.remove('dropping'));
  }
  window.addEventListener('dragenter', (e) => {
    if (S.internalDrag || !S.token) return;
    if (S.tab === 'day' && hasFiles(e.dataTransfer)) setTab('column');
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
    const dest = destOf(view);
    const dt = e.dataTransfer;
    if (hasFiles(dt)) {
      const entries = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
      const plainFiles = [...dt.files];
      if (!entries.length) return plainFiles.forEach((f) => queue(() => uploadFile(f, dest)));
      for (const entry of entries) {
        if (entry.isDirectory) {
          const files = await walk(entry, '');
          queue(() => uploadFolder(entry.name, files, dest));
        } else {
          const f = await new Promise((res, rej) => entry.file(res, rej));
          queue(() => uploadFile(f, dest));
        }
      }
      return;
    }
    const text = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (text?.trim()) api('POST', '/items', { type: isChatView(view) ? 'message' : 'text', text: text.trim(), ...dest }).catch((er) => toast(er.message));
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
    const view = S.tab === 'chat' ? C.view : S.panes.find((v) => v !== 'chat') || 'all';
    if (files.length) {
      e.preventDefault();
      files.forEach((f, i) => {
        const name = f.name && f.name !== 'image.png' ? f.name : `Pasted ${new Date().toLocaleString().replace(/[/:]/g, '-')}${files.length > 1 ? ' ' + (i + 1) : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
        queue(() => uploadFile(new File([f], name, { type: f.type }), destOf(view)));
      });
      return;
    }
    if (inField) return;
    const text = e.clipboardData?.getData('text/plain');
    if (S.tab === 'day') {
      if (text?.trim()) setComposer(text.trim());
      return;
    }
    if (S.tab === 'chat') return;
    if (text?.trim()) api('POST', '/items', { type: 'text', text, stackId: viewStack(view) }).catch((er) => toast(er.message));
  });

  function pickFiles(dest) {
    const inp = $('#filePick');
    inp.value = '';
    inp.onchange = () => [...inp.files].forEach((f) => queue(() => uploadFile(f, dest)));
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
        xhr.status < 300 ? resolve(data) : reject(Object.assign(new Error(data.error || 'HTTP ' + xhr.status), { status: xhr.status }));
      };
      xhr.onerror = () => reject(Object.assign(new Error('Network error'), { status: 0 }));
      xhr.send(file);
    });
  }

  // Files over CHUNK go up in pieces. If the connection drops, wait (or until we're back online),
  // ask the server how much it has, and carry on from there.
  const CHUNK = 8 * 1024 * 1024;
  const waitRetry = (ms) => new Promise((resolve) => {
    const done = () => { clearTimeout(t); removeEventListener('online', done); resolve(); };
    const t = navigator.onLine ? setTimeout(done, ms) : null;
    addEventListener('online', done);
  });
  async function putResumable(file, init, onProgress, u) {
    const { id } = await api('POST', '/uploads', { ...init, size: file.size });
    let offset = 0;
    let fails = 0;
    const setRetrying = (on) => { if (u && !!u.retrying !== on) { u.retrying = on; updateUpload(u); } };
    while (offset < file.size) {
      try {
        const from = offset;
        const r = await put(`/api/uploads/${id}?offset=${from}`, file.slice(from, Math.min(from + CHUNK, file.size)), (n) => onProgress(from + n));
        offset = r.offset;
        fails = 0;
        setRetrying(false);
      } catch (e) {
        if (e.status === 404 || e.status === 401 || e.status === 403 || ++fails > 15) throw e;
        setRetrying(true);
        await waitRetry(Math.min(30_000, 1000 * 2 ** (fails - 1)));
        offset = await fetch(`/api/uploads/${id}`, { headers: { Authorization: 'Bearer ' + S.token } })
          .then((r) => (r.ok ? r.json() : Promise.reject(Object.assign(new Error('Upload expired, try again'), { status: r.status }))))
          .then((d) => d.offset)
          .catch((er) => { if (er.status === 404) throw er; return offset; });
        onProgress(offset);
      }
    }
    setRetrying(false);
    return api('POST', `/uploads/${id}/done`);
  }

  // dest: { stackId, channelId }, where the upload lands.
  async function uploadFile(file, dest) {
    const u = { key: newId(), name: file.name, size: file.size, loaded: 0, ...dest };
    S.uploads.set(u.key, u);
    render();
    try {
      const progress = (n) => { u.loaded = n; updateUpload(u); };
      const qs = new URLSearchParams({ name: file.name, type: file.type || '', ...(dest.stackId ? { stackId: dest.stackId } : {}), ...(dest.channelId ? { channelId: dest.channelId } : {}) });
      const item = file.size > CHUNK
        ? await putResumable(file, { name: file.name, type: file.type || '', stackId: dest.stackId || null, channelId: dest.channelId || null }, progress, u)
        : await put('/api/upload?' + qs, file, progress);
      upsert(item);
    } finally {
      S.uploads.delete(u.key);
      render();
    }
  }

  async function uploadFolder(name, files, dest) {
    const total = files.reduce((n, f) => n + f.file.size, 0);
    const u = { key: newId(), name, size: total, loaded: 0, ...dest, folder: true };
    S.uploads.set(u.key, u);
    render();
    try {
      const { id } = await api('POST', '/folders', { name, ...dest });
      let done = 0;
      const next = [...files];
      const worker = async () => {
        while (next.length) {
          const f = next.shift();
          let last = 0;
          const qs = new URLSearchParams({ folder: id, relPath: f.relPath, mtime: f.file.lastModified || '' });
          const progress = (n) => { done += n - last; last = n; u.loaded = done; updateUpload(u); };
          if (f.file.size > CHUNK) await putResumable(f.file, { folder: id, relPath: f.relPath, mtime: f.file.lastModified || null }, progress, u);
          else await put('/api/upload?' + qs, f.file, progress);
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

  // ---------- day planner ----------
  // Entries: a note (start only, or no time = "anytime") or a block (start + end).
  // Times are minutes from midnight; date is the local YYYY-MM-DD.
  const HOUR = 56; // px per hour on the timeline
  const COLORS = ['violet', 'blue', 'green', 'amber', 'rose'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const keyDate = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (k, n) => {
    const d = keyDate(k);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  };
  const todayKey = () => dayKey(new Date());
  const nowMin = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  function fmtTime(m) {
    const h24 = Math.floor(m / 60) % 24;
    const mm = m % 60;
    return `${h24 % 12 || 12}${mm ? ':' + pad2(mm) : ''}${h24 < 12 ? 'am' : 'pm'}`;
  }
  function fmtDay(k) {
    const t = todayKey();
    const rel = k === t ? 'Today' : k === addDays(t, 1) ? 'Tomorrow' : k === addDays(t, -1) ? 'Yesterday' : null;
    return { rel, long: keyDate(k).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) };
  }
  const dayName = (k) => fmtDay(k).rel || fmtDay(k).long;

  // ----- repeats: 'daily' | 'weekdays' | 'weekly' | 'monthly', anchored on the first date -----
  function repeatHits(rule, anchor, k) {
    if (!rule || k < anchor) return k === anchor;
    const a = keyDate(anchor), d = keyDate(k);
    if (rule === 'daily') return true;
    if (rule === 'weekdays') return d.getDay() > 0 && d.getDay() < 6;
    if (rule === 'weekly') return d.getDay() === a.getDay();
    if (rule === 'monthly') return d.getDate() === a.getDate();
    return false;
  }
  function nextRepeat(rule, anchor, after) {
    for (let k = addDays(after, 1), i = 0; i < 400; k = addDays(k, 1), i++) if (repeatHits(rule, anchor, k)) return k;
    return null;
  }
  function repeatLabel(rule, anchor) {
    const d = keyDate(anchor);
    if (rule === 'daily') return 'Every day';
    if (rule === 'weekdays') return 'Every weekday';
    if (rule === 'weekly') return 'Every ' + d.toLocaleDateString(undefined, { weekday: 'long' });
    if (rule === 'monthly') return `Monthly on the ${d.getDate()}${[, 'st', 'nd', 'rd'][d.getDate() % 10 * (Math.floor(d.getDate() / 10) !== 1)] || 'th'}`;
    return 'Never';
  }
  const REPEATS = [null, 'daily', 'weekdays', 'weekly', 'monthly'];

  // An entry as it appears on day k: repeating ones take that date and their per-day done state.
  const occursOn = (e, k) => repeatHits(e.repeat, e.date, k) && !(e.skip || []).includes(k);
  const occurrence = (e, k) => (e.repeat ? { ...e, date: k, seriesDate: e.date, done: (e.doneOn || []).includes(k) } : e);
  const entriesOn = (k) => S.entries.filter((e) => occursOn(e, k)).map((e) => linked(occurrence(e, k)));

  function upsertEntry(e) {
    const i = S.entries.findIndex((x) => x.id === e.id);
    if (i >= 0) S.entries[i] = e;
    else S.entries.push(e);
  }

  function upsertTask(t) {
    const i = S.tasks.findIndex((x) => x.id === t.id);
    if (i >= 0) S.tasks[i] = t;
    else S.tasks.push(t);
  }
  const taskById = (id) => id && S.tasks.find((t) => t.id === id);
  // A schedule entry linked to a task shows the task's current text and done state.
  function linked(e) {
    const t = taskById(e.taskId);
    return t ? { ...e, text: t.text, done: e.repeat ? e.done : t.done } : e;
  }

  // Quick capture: "Call Sam at 3pm", "10-12 Marketing", "email Dana tomorrow 9am", "gym friday 6-7pm".
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function toMin(h, m, ap, guess) {
    h = Number(h);
    m = Number(m || 0);
    if (h > 23 || m > 59) return null;
    if (ap) {
      if (h > 12 || h === 0) return null;
      const pm = /^p/i.test(ap);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    } else if (guess && h >= 1 && h <= 6) h += 12; // "at 3" means 3pm
    return h * 60 + m;
  }
  function parseQuick(raw, baseDate) {
    let text = ` ${raw} `;
    let date = baseDate;
    let start = null;
    let end = null;
    const take = (re, fn) => {
      const m = re.exec(text);
      if (!m || fn(m) === false) return false;
      text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
      return true;
    };
    const T = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?';
    const END = '(?=[\\s,.!?;])';

    take(/\s(?:tomorrow|tmrw)(?=[\s,.!?;])/i, () => { date = addDays(todayKey(), 1); });
    take(/\stoday(?=[\s,.!?;])/i, () => { date = todayKey(); });
    take(new RegExp(`\\s(?:on\\s+|(next)\\s+)?(${WEEKDAYS.join('|')})${END}`, 'i'), (m) => {
      const t = keyDate(todayKey());
      let d = (WEEKDAYS.indexOf(m[2].toLowerCase()) - t.getDay() + 7) % 7;
      if (m[1] && d === 0) d = 7;
      date = addDays(todayKey(), d);
    });
    // Ranges: "10-12", "1:30-3pm", "from 9 to 11am"
    take(new RegExp(`\\s(?:from\\s+)?${T}\\s*(?:-|–|—|to|until|till)\\s*${T}${END}`, 'i'), (m) => {
      const [, h1, m1, a1, h2, m2, a2] = m;
      if (!a1 && !a2 && !m1 && !m2 && (Number(h1) > 12 || Number(h2) > 12)) return false;
      let e = toMin(h2, m2, a2);
      let s;
      if (a1) s = toMin(h1, m1, a1);
      else if (a2) {
        s = toMin(h1, m1, a2);
        if (s != null && e != null && s >= e) s = toMin(h1, m1, /^p/i.test(a2) ? 'am' : 'pm');
      } else s = toMin(h1, m1, null, true);
      if (s == null || e == null) return false;
      if (!a2) while (e <= s && e + 720 <= 1440) e += 720; // "10-2" means 10am-2pm
      if (e <= s || e > 1440) return false;
      start = s;
      end = e;
    });
    if (start == null) {
      take(/\s(?:at\s+)?(noon|midnight)(?=[\s,.!?;])/i, (m) => { start = /noon/i.test(m[1]) ? 720 : 0; }) ||
        take(new RegExp(`\\s(?:at|@)\\s*${T}${END}`, 'i'), (m) => { start = toMin(m[1], m[2], m[3], true); if (start == null) return false; }) ||
        take(new RegExp(`\\s(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)${END}`, 'i'), (m) => { start = toMin(m[1], m[2], m[3]); if (start == null) return false; }) ||
        take(new RegExp(`\\s(\\d{1,2}):(\\d{2})${END}`), (m) => { start = toMin(m[1], m[2], null, true); if (start == null) return false; });
    }
    // Duration: "for 2h", "for 30 min" turns a timed note into a block.
    if (start != null && end == null) {
      take(/\s(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)(?=[\s,.!?;])/i, (m) => {
        const mins = Math.round(Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1));
        if (!mins || start + mins > 1440) return false;
        end = start + mins;
      });
    }
    let title = text.replace(/\s+/g, ' ').replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '').trim();
    if (!title) title = raw.trim();
    return { text: title, date, start, end };
  }

  const repeatMark = (e) => [
    e.cal ? h('span', { class: 'is-task', html: I.cal, title: e.cal.imported ? 'From your calendar (only you see this)' : 'Also on your calendar' }) : null,
    e.repeat ? h('span', { class: 'is-task', html: I.repeat, title: repeatLabel(e.repeat, e.seriesDate || e.date) }) : null,
  ];

  // ----- view state -----
  const D = { date: todayKey(), scrolledFor: null, sub: store.get('daySub', 'schedule'), mine: store.get('tasksMine', false) };

  function setSub(sub) {
    D.sub = sub;
    store.set('daySub', sub);
    D.scrolledFor = null;
    renderDay();
  }

  function setTab(tab) {
    S.tab = tab;
    for (const b of $('#tabs').children) b.classList.toggle('on', b.dataset.tab === tab);
    $('#day').classList.toggle('hidden', tab !== 'day');
    $('#panes').classList.toggle('hidden', tab !== 'column');
    $('#chat').classList.toggle('hidden', tab !== 'chat');
    $('#camps').classList.toggle('hidden', tab !== 'camps');
    $('#agents').classList.toggle('hidden', tab !== 'agents');
    if (tab === 'camps') renderCamps();
    if (tab === 'agents') renderAgents();
    if (tab === 'day') renderDay();
    if (tab === 'chat') openChannel(C.view);
  }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setTab(b.dataset.tab);
  });

  function goDay(k) {
    D.date = k;
    D.scrolledFor = null;
    renderDay();
  }

  function buildDay() {
    const root = $('#day');
    root.innerHTML = '';
    const pick = h('input', { type: 'date', class: 'date-pick', 'aria-label': 'Pick a date' });
    pick.addEventListener('click', () => { try { pick.showPicker(); } catch {} });
    pick.addEventListener('change', () => pick.value && goDay(pick.value));
    D.pick = pick;
    D.title = h('div', { class: 'day-title' });
    D.todayBtn = h('button', { class: 'btn small', onclick: () => goDay(todayKey()) }, 'Today');
    D.scroll = h('div', { class: 'day-scroll' });
    D.seg = h('div', { class: 'seg day-sub' },
      h('button', { 'data-sub': 'schedule', onclick: () => setSub('schedule') }, 'Schedule'),
      h('button', { 'data-sub': 'tasks', onclick: () => setSub('tasks') }, 'Tasks')
    );
    root.append(
      D.seg,
      D.head = h('div', { class: 'day-head' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous day', html: I.left, onclick: () => goDay(addDays(D.date, -1)) }),
        h('div', { class: 'day-title-wrap' }, D.title, pick),
        D.todayBtn,
        h('button', { class: 'icon-btn', 'aria-label': 'Next day', html: I.right, onclick: () => goDay(addDays(D.date, 1)) })
      ),
      D.scroll,
      dayComposer()
    );
  }

  function checkEl(e) {
    return h('button', {
      class: 'check' + (e.done ? ' on' : ''),
      html: I.check,
      title: e.done ? 'Mark not done' : 'Mark done',
      'aria-label': e.done ? 'Mark not done' : 'Mark done',
      onclick: (ev) => { ev.stopPropagation(); toggleDone(e); },
    });
  }

  function toggleDone(e) {
    const base = S.entries.find((x) => x.id === e.id) || e;
    if (e.repeat) {
      const on = base.doneOn || [];
      return patchEntry(base, { doneOn: on.includes(e.date) ? on.filter((d) => d !== e.date) : [...on, e.date] });
    }
    const t = taskById(e.taskId);
    if (t) patchTask(t, { done: !t.done });
    else patchEntry(base, { done: !e.done });
  }

  async function patchTask(t, changes, { reported } = {}) {
    if (changes.done && t.report && !t.done && !reported && goalById(t.goalId)) return openReport(campById(goalById(t.goalId).campaignId), t);
    if (changes.done && t.repeat) {
      const from = t.due || todayKey();
      const due = nextRepeat(t.repeat, from, from > todayKey() ? from : todayKey());
      if (due) {
        changes = { due };
        toast(`Done · next one ${dayName(due)}`);
      }
    }
    upsertTask({ ...t, ...changes });
    renderDay();
    refreshLinks();
    try {
      upsertTask(await api('PATCH', '/tasks/' + t.id, changes));
    } catch (er) {
      upsertTask(t);
      toast(er.message);
    }
    renderDay();
    refreshLinks();
  }

  async function patchEntry(e, changes) {
    upsertEntry({ ...e, ...changes });
    renderDay();
    try {
      upsertEntry(await api('PATCH', '/entries/' + e.id, changes));
    } catch (er) {
      upsertEntry(e);
      toast(er.message);
    }
    renderDay();
  }

  // Side-by-side columns for overlapping blocks.
  function layoutBlocks(blocks) {
    const out = new Map();
    let cluster = [];
    let colEnds = [];
    let clusterEnd = -1;
    const flush = () => {
      const n = colEnds.length;
      for (const c of cluster) out.set(c.id, { col: c.col, n });
      cluster = [];
      colEnds = [];
      clusterEnd = -1;
    };
    for (const b of blocks) {
      if (cluster.length && b.start >= clusterEnd) flush();
      let col = colEnds.findIndex((end) => end <= b.start);
      if (col < 0) col = colEnds.length;
      colEnds[col] = b.end;
      cluster.push({ id: b.id, col });
      clusterEnd = Math.max(clusterEnd, b.end);
    }
    if (cluster.length) flush();
    return out;
  }

  function renderDay() {
    if (!S.workspace || D.dragging) return;
    sendNext();
    if (S.tab === 'camps') renderCamps();
    if (!D.scroll) buildDay();
    for (const b of D.seg.children) b.classList.toggle('on', b.dataset.sub === D.sub);
    D.head.classList.toggle('hidden', D.sub !== 'schedule');
    D.input.placeholder = D.sub === 'tasks' ? 'Add a task…' : 'Add to your day… “Call Sam at 3pm”';
    if (D.sub === 'tasks') return renderTasks();
    const k = D.date;
    const isToday = k === todayKey();
    const { rel, long } = fmtDay(k);
    D.title.replaceChildren(...(rel ? [h('b', {}, rel), ' '] : []), h('span', {}, rel ? long.replace(/^\w+,?\s*/, '') : long));
    D.pick.value = k;
    D.todayBtn.classList.toggle('hidden', isToday);

    const entries = entriesOn(k);
    const anytime = entries.filter((e) => e.start == null).sort((a, b) => a.done - b.done || a.createdAt - b.createdAt);
    const blocks = entries.filter((e) => e.start != null && e.end != null).sort((a, b) => a.start - b.start || b.end - a.end);
    const pins = entries.filter((e) => e.start != null && e.end == null).sort((a, b) => a.start - b.start);

    const h0 = Math.min(6, ...[...blocks, ...pins].map((e) => Math.floor(e.start / 60)));
    const y = (m) => ((m - h0 * 60) / 60) * HOUR;
    const keep = D.scroll.scrollTop;
    const parts = [];

    // Tasks due this day (plus overdue ones, carried over to today) that aren't on the schedule yet.
    const onDay = new Set(entries.map((e) => e.taskId).filter(Boolean));
    const due = S.tasks.filter((t) => !t.done && forMe(t) && !onDay.has(t.id) && (t.due === k || (isToday && isOverdue(t)))).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : byPrio(a, b)));
    if (due.length) {
      const late = due.filter(isOverdue);
      parts.push(h('div', { class: 'anytime tasks' }, h('div', { class: 'any-h' }, 'Due', late.length ? moveToToday(late) : null), due.map(taskRow)));
    }

    if (anytime.length || (!entries.length && !due.length)) {
      const sec = h('div', { class: 'anytime' }, h('div', { class: 'any-h' }, 'Anytime'));
      for (const e of anytime) {
        sec.append(h('div', { class: 'any-row' + (e.done ? ' done' : ''), onclick: () => openSheet(e),
          onpointerdown: (ev) => dragToTimeline(ev, e.text, (k, m) => patchEntry(S.entries.find((x) => x.id === e.id), { start: m, ...(e.repeat ? {} : { date: k }) })) }, checkEl(e), h('span', { class: 'p-text' }, e.taskId ? h('span', { class: 'is-task', html: I.task, title: 'Linked task' }) : null, repeatMark(e), e.text)));
      }
      if (!entries.length) {
        sec.append(h('p', { class: 'day-hint' }, 'Nothing planned. Type below, like “10-12 Marketing” or “Call Sam at 3pm”, or tap a time on the timeline.'));
      }
      parts.push(sec);
    }

    const tl = h('div', { class: 'timeline', style: `height:${(24 - h0) * HOUR}px` });
    for (let hr = h0; hr < 24; hr++) {
      tl.append(h('div', { class: 'hour', style: `top:${y(hr * 60)}px` }, h('span', {}, fmtTime(hr * 60))));
    }

    const cols = layoutBlocks(blocks);
    for (const b of blocks) {
      const { col, n } = cols.get(b.id);
      const top = y(b.start);
      const ht = Math.max(y(b.end) - top, 22);
      const el = h('div', {
        class: `block c-${b.color || 'violet'}${b.done ? ' done' : ''}${ht < 44 ? ' short' : ''}`,
        style: `top:${top + 1}px;height:${ht - 2}px;left:calc(var(--gut) + (100% - var(--gut) - 6px) * ${col / n});width:calc((100% - var(--gut) - 6px) / ${n} - 3px)`,
        onclick: (ev) => { ev.stopPropagation(); openSheet(b); },
      },
        h('div', { class: 'b-title' }, b.taskId ? h('span', { class: 'is-task', html: I.task, title: 'Linked task' }) : null, repeatMark(b), b.text),
        h('div', { class: 'b-time' }, `${fmtTime(b.start)} – ${fmtTime(b.end)}`),
        h('div', { class: 'b-resize', title: 'Drag to change the end time' })
      );
      el.addEventListener('pointerdown', (ev) => dragTime(ev, b, el, ev.target.closest('.b-resize') ? 'end' : 'move'));
      tl.append(el);
    }

    // Notes pinned to a time sit on top of any block they fall inside; keep them clear of block titles and each other.
    const bands = blocks.map((b) => [y(b.start), y(b.start) + 22]);
    let last = -Infinity;
    for (const p of pins) {
      let top = Math.max(y(p.start) - 11, last + 3);
      for (let i = 0; i < bands.length; i++) {
        const [a, z] = bands[i];
        if (top + 24 > a && top < z) {
          top = z;
          i = -1; // re-check every band after moving
        }
      }
      last = top + 24;
      const pin = h('div', { class: 'pin' + (p.done ? ' done' : ''), style: `top:${top}px`, onclick: (ev) => { ev.stopPropagation(); openSheet(p); } },
        checkEl(p),
        h('span', { class: 'p-time' }, fmtTime(p.start)),
        h('span', { class: 'p-text' }, p.taskId ? h('span', { class: 'is-task', html: I.task, title: 'Linked task' }) : null, repeatMark(p), p.text)
      );
      pin.addEventListener('pointerdown', (ev) => dragTime(ev, p, pin, 'pin'));
      tl.append(pin);
    }

    if (isToday) tl.append(h('div', { class: 'now', style: `top:${y(nowMin())}px` }));
    tl._h0 = h0;

    tl.addEventListener('click', (ev) => {
      if (ev.target.closest('.block, .pin')) return;
      const r = tl.getBoundingClientRect();
      const m = Math.round((((ev.clientY - r.top) / HOUR) * 60 + h0 * 60) / 15) * 15;
      openSheet({ date: k, start: Math.max(0, Math.min(m, 1425)) });
    });
    parts.push(tl);
    D.scroll.replaceChildren(...parts);

    if (D.scrolledFor !== k && D.scroll.clientHeight) {
      D.scrolledFor = k;
      const first = [...blocks, ...pins].sort((a, b) => a.start - b.start)[0];
      const target = isToday ? nowMin() - 60 : first ? first.start - 30 : 8 * 60;
      D.scroll.scrollTop = tl.offsetTop + y(Math.max(h0 * 60, target)) - 8;
    } else D.scroll.scrollTop = keep;
  }

  // ----- dragging on the timeline (mouse and pen; touch keeps scrolling) -----
  // Calls onMove(event, dx, dy) once the pointer has moved a few px, then onEnd(event) and eats the click.
  function pointerDrag(ev, { onStart, onMove, onEnd }) {
    if (ev.button !== 0 || ev.pointerType === 'touch' || ev.target.closest('button, input, textarea, select, .rename')) return;
    const x0 = ev.clientX, y0 = ev.clientY;
    let on = false;
    const move = (e) => {
      if (!on && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
      if (!on) { on = true; onStart?.(); document.body.classList.add('is-dragging'); }
      e.preventDefault();
      onMove(e, e.clientX - x0, e.clientY - y0);
    };
    const stop = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      document.body.classList.remove('is-dragging');
    };
    const up = (e) => {
      stop();
      if (!on) return;
      const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
      addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', eat, { capture: true }), 100);
      onEnd(e);
    };
    const cancel = () => { stop(); if (on) onEnd(null); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
  }
  const snap = (dy) => Math.round(((dy / HOUR) * 60) / 15) * 15;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // Move a block or timed note, or drag a block's bottom edge to change when it ends. Moves the whole series for repeats.
  function dragTime(ev, e, el, mode) {
    const base = S.entries.find((x) => x.id === e.id);
    if (!base) return;
    const top0 = el.offsetTop, h0 = el.offsetHeight;
    const dur = mode === 'pin' ? 0 : e.end - e.start;
    let start = e.start, end = e.end;
    const label = el.querySelector(mode === 'pin' ? '.p-time' : '.b-time');
    pointerDrag(ev, {
      onStart: () => { D.dragging = true; el.classList.add('dragging'); },
      onMove: (_, dx, dy) => {
        const d = snap(dy);
        if (mode === 'end') {
          end = clamp(e.end + d, e.start + 15, 1440);
          el.style.height = h0 + ((end - e.end) / 60) * HOUR + 'px';
        } else {
          start = clamp(e.start + d, 0, mode === 'pin' ? 1439 : 1440 - dur);
          if (mode !== 'pin') end = start + dur;
          el.style.top = top0 + ((start - e.start) / 60) * HOUR + 'px';
        }
        label.textContent = mode === 'pin' ? fmtTime(start) : `${fmtTime(start)} – ${fmtTime(end)}`;
      },
      onEnd: (up) => {
        D.dragging = false;
        el.classList.remove('dragging');
        if (!up || (start === e.start && end === e.end)) return renderDay();
        patchEntry(base, mode === 'pin' ? { start } : { start, end });
      },
    });
  }

  // Drag a task or an anytime note onto the timeline. From the Tasks tab, hovering the Schedule tab switches to it.
  function dragToTimeline(ev, text, drop) {
    let ghost = null, line = null, at = null;
    pointerDrag(ev, {
      onStart: () => {
        ghost = h('div', { class: 'drag-ghost' }, text.slice(0, 60));
        line = h('div', { class: 'drop-line' }, h('span'));
        document.body.append(ghost);
      },
      onMove: (e) => {
        ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
        const tab = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sub="schedule"]');
        if (tab && D.sub !== 'schedule') setSub('schedule');
        const tl = D.scroll.querySelector('.timeline');
        const r = tl?.getBoundingClientRect();
        const sr = D.scroll.getBoundingClientRect();
        at = null;
        if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= Math.max(r.top, sr.top) && e.clientY <= Math.min(r.bottom, sr.bottom)) {
          at = clamp(snap(e.clientY - r.top) + tl._h0 * 60, 0, 1425);
          line.style.top = ((at - tl._h0 * 60) / 60) * HOUR + 'px';
          line.firstChild.textContent = fmtTime(at);
          if (line.parentNode !== tl) tl.append(line);
        } else line.remove();
        // Scroll the day when dragging near its top or bottom edge.
        if (e.clientY < sr.top + 30) D.scroll.scrollTop -= 12;
        else if (e.clientY > sr.bottom - 30 && e.clientY < sr.bottom + 40) D.scroll.scrollTop += 12;
      },
      onEnd: (up) => {
        ghost.remove();
        line.remove();
        if (up && at != null) drop(D.date, at);
      },
    });
  }

  // A dropped task becomes a 30 minute block linked to it.
  async function scheduleTask(t, k, m) {
    try {
      upsertEntry(await api('POST', '/entries', { text: t.text, taskId: t.id, date: k, start: m, end: Math.min(m + 30, 1440) }));
      renderDay();
    } catch (e) {
      toast(e.message);
    }
  }

  // When a task is on the schedule: the next upcoming slot, else the most recent one.
  function taskSlot(t) {
    const at = (e) => `${e.date} ${pad2(Math.floor((e.start ?? 0) / 60))}:${pad2((e.start ?? 0) % 60)}`;
    const slots = S.entries.filter((e) => e.taskId === t.id).sort((a, b) => (at(a) < at(b) ? -1 : 1));
    if (!slots.length) return null;
    const now = `${todayKey()} ${pad2(Math.floor(nowMin() / 60))}:${pad2(nowMin() % 60)}`;
    const e = slots.find((x) => at(x) >= now) || slots[slots.length - 1];
    return { e, label: dayName(e.date) + (e.start != null ? ' ' + fmtTime(e.start) : ''), more: slots.length - 1 };
  }

  // ----- due dates + priority -----
  const PRIO = ['None', 'Low', 'Medium', 'High'];
  const byPrio = (a, b) => (b.priority || 0) - (a.priority || 0) || a.createdAt - b.createdAt;
  // Short label: Today / Tomorrow / Yesterday / Fri / Oct 20.
  function dueLabel(k) {
    const rel = fmtDay(k).rel;
    if (rel) return rel;
    const days = Math.round((keyDate(k) - keyDate(todayKey())) / 864e5);
    const d = keyDate(k);
    return days > 0 && days < 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const isOverdue = (t) => !t.done && t.due && t.due < todayKey();

  function dueMenu(anchor, t) {
    const set = (due) => patchTask(t, { due });
    const today = todayKey();
    openMenu(anchor, [
      { head: 'Due' },
      { label: 'Today', on: t.due === today, run: () => set(today) },
      { label: 'Tomorrow', on: t.due === addDays(today, 1), run: () => set(addDays(today, 1)) },
      { label: 'Next week', on: t.due === addDays(today, 7), run: () => set(addDays(today, 7)) },
      { label: 'Pick a date…', run: () => {
        const inp = h('input', { type: 'date', class: 'date-pop', value: t.due || today });
        const r = anchor.getBoundingClientRect();
        inp.style.cssText = `left:${r.left}px;top:${r.bottom}px`;
        inp.addEventListener('change', () => { if (inp.value) set(inp.value); inp.remove(); });
        inp.addEventListener('blur', () => setTimeout(() => inp.remove(), 300));
        document.body.append(inp);
        try { inp.showPicker(); } catch { inp.focus(); }
      } },
      ...(t.due ? [{ label: 'No due date', run: () => patchTask(t, { due: null, repeat: null }) }] : []),
      { head: 'Repeat' },
      ...REPEATS.map((r) => ({ label: repeatLabel(r, t.due || today), on: (t.repeat || null) === r, run: () => patchTask(t, r && !t.due ? { repeat: r, due: today } : { repeat: r }) })),
    ]);
  }
  function prioMenu(anchor, t) {
    openMenu(anchor, [{ head: 'Priority' }, ...[3, 2, 1, 0].map((p) => ({ label: PRIO[p], on: (t.priority || 0) === p, run: () => patchTask(t, { priority: p }) }))]);
  }

  // Quick add for tasks: "Pay rent friday !!" → due Friday, medium priority. !/!!/!!! = low/medium/high.
  function parseTask(raw) {
    let text = raw;
    let priority = 0;
    text = text.replace(/(^|\s)(!{1,3})(?=\s|$)/, (_, pre, bangs) => { priority = bangs.length; return pre; });
    let assigneeId;
    text = text.replace(/(^|\s)@([^\s@]+)(?=\s|$)/, (all, pre, who) => {
      const m = (S.workspace?.members || []).find((x) => x.name.toLowerCase() === who.toLowerCase() || x.name.toLowerCase().split(/\s+/)[0] === who.toLowerCase());
      if (!m) return all;
      assigneeId = m.id;
      return pre;
    });
    const p = parseQuick(text, null);
    return { text: p.date && p.start == null ? p.text : text.trim() || raw.trim(), due: p.date, priority, ...(assigneeId ? { assigneeId } : {}) };
  }

  function editTaskText(span, t) {
    inlineEdit(span, { value: t.text, placeholder: 'Task', onDone: (text) => text && text !== t.text && patchTask(t, { text }) });
  }

  function taskRow(t, { inCampaign } = {}) {
    const text = h('span', { class: 'p-text', title: 'Click to edit' }, t.report ? h('span', { class: 'is-task', title: 'Report: ticking it asks for your findings', html: I.copy }) : null, t.text);
    text.addEventListener('click', () => editTaskText(text, t));
    const slot = taskSlot(t);
    const btn = (icon, title, fn) => h('button', { class: 't-btn', title, 'aria-label': title, html: icon, onclick: (ev) => { ev.stopPropagation(); fn(ev.currentTarget); } });
    const g = goalById(t.goalId);
    const camp = g && campById(g.campaignId);
    const pr = t.priority || 0;
    return h('div', { class: 'any-row task-row' + (t.done ? ' done' : ''),
      onpointerdown: (ev) => !t.done && dragToTimeline(ev, t.text, (k, m) => scheduleTask(t, k, m)) },
      h('button', {
        class: 'check' + (t.done ? ' on' : '') + (pr ? ' pr-' + pr : ''),
        html: I.check,
        'aria-label': t.done ? 'Mark not done' : 'Mark done',
        onclick: () => patchTask(t, { done: !t.done }),
      }),
      pr && !t.done ? h('button', { class: 'prio pr-' + pr, title: PRIO[pr] + ' priority', onclick: (ev) => prioMenu(ev.currentTarget, t) }, '!'.repeat(pr)) : null,
      text,
      t.due && !t.done ? h('button', { class: 'due' + (isOverdue(t) ? ' late' : t.due === todayKey() ? ' today' : ''), title: 'Due ' + dayName(t.due) + (t.repeat ? ' · ' + repeatLabel(t.repeat, t.due) : ''), onclick: (ev) => dueMenu(ev.currentTarget, t) },
        t.repeat ? h('span', { class: 'rep', html: I.repeat }) : null, dueLabel(t.due)) : null,
      slot ? h('button', { class: 'slot', title: 'Show on schedule', onclick: () => { D.sub = 'schedule'; store.set('daySub', 'schedule'); setTab('day'); goDay(slot.e.date); } },
        slot.label + (slot.more ? ` +${slot.more}` : '')) : null,
      camp && !inCampaign ? h('button', { class: 'camp-chip c-' + camp.color, title: `${camp.name} · ${g.title}`, onclick: () => openCampaign(camp.id) }, camp.name) : null,
      t.assigneeId ? avatar(t.assigneeId) : null,
      t.done ? null : btn(I.clock, 'Put on schedule', () => openSheet({ text: t.text, taskId: t.id, date: t.due && D.sub === 'tasks' ? t.due : D.date })),
      btn(I.more, 'More', (b) => taskMenu(b, t))
    );
  }

  function taskMenu(anchor, t) {
    const g = goalById(t.goalId);
    openMenu(anchor, [
      { label: t.due ? `Due ${dueLabel(t.due)}…` : 'Due date…', run: () => dueMenu(anchor, t) },
      { label: t.priority ? `${PRIO[t.priority]} priority…` : 'Priority…', run: () => prioMenu(anchor, t) },
      { label: t.assigneeId ? `Assigned to ${memberName(t.assigneeId)}…` : 'Assign to…', run: () => assignMenu(anchor, t) },
      { label: g ? `Goal: ${g.title}…` : 'Add to a goal…', run: () => goalMenu(anchor, t) },
      ...(g ? [{ label: t.report ? 'Stop asking for a report' : 'Ask for a report when done', run: () => patchTask(t, { report: !t.report }) }] : []),
      { label: 'Share to chat…', run: () => shareMenu(anchor, linkToken('task', t.id)) },
      { label: 'Delete task', danger: true, run: async () => {
        try {
          await api('DELETE', '/tasks/' + t.id);
          S.tasks = S.tasks.filter((x) => x.id !== t.id);
          for (const e of S.entries) if (e.taskId === t.id) e.taskId = null;
          renderDay();
        } catch (er) {
          toast(er.message);
        }
      } },
    ]);
  }
  function assignMenu(anchor, t) {
    openMenu(anchor, [
      { head: 'Assign to' },
      { label: 'Nobody', on: !t.assigneeId, run: () => patchTask(t, { assigneeId: null }) },
      ...S.workspace.members.map((m) => ({ label: m.id === S.me?.memberId ? `${m.name} (you)` : m.name, on: t.assigneeId === m.id, run: () => patchTask(t, { assigneeId: m.id }) })),
    ]);
  }
  function goalMenu(anchor, t) {
    const rows = [{ head: 'Goal' }, { label: 'No goal', on: !t.goalId, run: () => patchTask(t, { goalId: null, report: false }) }];
    for (const c of S.campaigns.filter((x) => x.status !== 'done')) {
      const goals = goalsOf(c.id);
      if (!goals.length) continue;
      rows.push({ head: c.name }, ...goals.map((g) => ({ label: g.title, on: t.goalId === g.id, run: () => patchTask(t, { goalId: g.id }) })));
    }
    if (rows.length === 2) rows.push({ note: 'Make a campaign with goals first' });
    openMenu(anchor, rows);
  }

  // Small round initial for a teammate.
  function avatar(memberId, size) {
    const name = memberName(memberId);
    const hue = [...String(memberId)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 360;
    return h('span', { class: 'av' + (size ? ' ' + size : ''), title: name, style: `--h:${hue}` }, name === 'You' ? (S.workspace?.members.find((m) => m.id === memberId)?.name || 'Y')[0].toUpperCase() : name[0].toUpperCase());
  }
  // Tasks on my day: mine, or nobody's.
  const forMe = (t) => !t.assigneeId || t.assigneeId === S.me?.memberId;

  function moveToToday(list) {
    const b = h('button', { class: 'link' }, 'Move to today');
    b.addEventListener('click', () => { for (const t of list) patchTask(t, { due: todayKey() }); });
    return b;
  }

  function renderTasks() {
    const keep = D.scroll.scrollTop;
    const mineOnly = D.mine;
    const shown = S.tasks.filter((t) => !mineOnly || t.assigneeId === S.me?.memberId);
    const open = shown.filter((t) => !t.done).sort(byPrio);
    const done = shown.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    const today = todayKey();
    const parts = [];
    if (S.tasks.some((t) => t.assigneeId)) {
      parts.push(h('div', { class: 'seg mine-seg' },
        h('button', { class: mineOnly ? '' : 'on', onclick: () => { D.mine = false; store.set('tasksMine', false); renderDay(); } }, 'All tasks'),
        h('button', { class: mineOnly ? 'on' : '', onclick: () => { D.mine = true; store.set('tasksMine', true); renderDay(); } }, 'Assigned to me')));
    }
    const group = (title, list, extra) => list.length && parts.push(h('div', { class: 'anytime tasks' }, h('div', { class: 'any-h' }, title, extra || null), list.map(taskRow)));
    const late = open.filter(isOverdue);
    group(`Overdue · ${late.length}`, late, late.length ? moveToToday(late) : null);
    if (open.some((t) => t.due)) {
      group('Today', open.filter((t) => t.due === today));
      group('Upcoming', open.filter((t) => t.due > today).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : byPrio(a, b))));
      group('No date', open.filter((t) => !t.due));
    } else group('To do', open);
    if (!open.length) {
      parts.push(h('div', { class: 'anytime tasks' }, h('div', { class: 'any-h' }, 'To do'),
        h('p', { class: 'day-hint' }, mineOnly ? 'Nothing assigned to you.' : done.length ? 'All done.' : 'No tasks yet. Type below, like “Pay rent friday !!” (! low, !! medium, !!! high), then tap the clock to put it on your schedule.')));
    }
    if (done.length) {
      const clear = h('button', { class: 'link', 'data-label': '1' }, 'Clear');
      clear.addEventListener('click', () => confirmClick(clear, async () => {
        for (const t of done) await api('DELETE', '/tasks/' + t.id).catch((e) => toast(e.message));
      }));
      parts.push(h('div', { class: 'anytime tasks' }, h('div', { class: 'any-h' }, `Done · ${done.length}`, clear), done.map(taskRow)));
    }
    D.scroll.replaceChildren(...parts);
    D.scroll.scrollTop = keep;
  }

  function dayComposer() {
    const ta = h('textarea', { rows: 1, placeholder: 'Add to your day… “Call Sam at 3pm”' });
    const hint = h('div', { class: 'qp hidden' });
    const update = () => {
      ta.style.height = '';
      ta.style.height = Math.min(ta.scrollHeight + 2, 120) + 'px';
      if (!ta.value.trim()) return hint.classList.add('hidden');
      if (D.sub === 'tasks') {
        const t = parseTask(ta.value);
        if (!t.due && !t.priority) return hint.classList.add('hidden');
        hint.classList.remove('hidden');
        return hint.replaceChildren(h('b', {}, 'Task'), t.due ? ` · due ${dayName(t.due)}` : '', t.priority ? ` · ${PRIO[t.priority]} priority` : '', h('span', {}, ' ↵'));
      }
      const p = parseQuick(ta.value, D.date);
      hint.classList.remove('hidden');
      const when = p.start == null ? 'anytime' : p.end == null ? fmtTime(p.start) : `${fmtTime(p.start)} – ${fmtTime(p.end)}`;
      hint.replaceChildren(h('b', {}, p.end != null ? 'Block' : 'Note'), ` · ${dayName(p.date)} · ${when}`, h('span', {}, ' ↵'));
    };
    const add = async () => {
      const raw = ta.value;
      if (!raw.trim()) return;
      if (D.sub === 'tasks') {
        ta.value = '';
        update();
        try {
          upsertTask(await api('POST', '/tasks', parseTask(raw)));
          renderDay();
        } catch (e) {
          ta.value = raw;
          update();
          toast(e.message);
        }
        return;
      }
      const p = parseQuick(raw, D.date);
      ta.value = '';
      update();
      try {
        upsertEntry(await api('POST', '/entries', p));
        renderDay();
        if (p.date !== D.date) toast(`Added to ${dayName(p.date)}`, { label: 'Show', run: () => goDay(p.date) });
        if (p.start != null) offerReminders();
      } catch (e) {
        ta.value = raw;
        update();
        toast(e.message);
      }
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        add();
      }
    });
    ta.addEventListener('input', update);
    D.input = ta;
    D.update = update;
    const more = h('button', { class: 'add', title: 'Add with details', onclick: () => {
      if (D.sub === 'tasks') return ta.value.trim() ? add() : ta.focus();
      const p = ta.value.trim() ? parseQuick(ta.value, D.date) : { date: D.date };
      ta.value = '';
      update();
      openSheet(p);
    } }, '+');
    return h('div', { class: 'day-composer' }, hint, h('div', { class: 'composer' }, more, ta));
  }

  function setComposer(text) {
    D.input.value = text;
    D.update();
    D.input.focus();
  }

  // ----- add / edit sheet -----
  function closeSheet() {
    $('#sheet').classList.add('hidden');
    $('#sheet').innerHTML = '';
  }

  function openSheet(entry) {
    const isNew = !entry.id;
    const wrap = $('#sheet');
    const toHM = (m) => (m == null ? '' : `${pad2(Math.floor(Math.min(m, 1439) / 60))}:${pad2(Math.min(m, 1439) % 60)}`);
    const fromHM = (v) => {
      if (!v) return null;
      const [hh, mm] = v.split(':').map(Number);
      return hh * 60 + mm;
    };
    const text = h('textarea', { rows: 3, placeholder: 'What do you need to do or remember?' });
    text.value = entry.text || '';
    // For a repeating entry the sheet edits the whole series, so the date is the series start.
    const date = h('input', { type: 'date', value: entry.seriesDate || entry.date || D.date });
    const repeat = h('select', {});
    const drawRepeat = () => {
      const keep = repeat.value || entry.repeat || '';
      repeat.replaceChildren(...REPEATS.map((r) => h('option', { value: r || '' }, repeatLabel(r, date.value || D.date))));
      repeat.value = keep;
    };
    drawRepeat();
    date.addEventListener('change', drawRepeat);
    const start = h('input', { type: 'time', step: 300, value: toHM(entry.start) });
    const end = h('input', { type: 'time', step: 300, value: entry.end == null ? '' : toHM(entry.end) });
    const err = h('p', { class: 'err' });
    let color = entry.color || 'violet';
    const sw = h('div', { class: 'swatches' }, COLORS.map((c) =>
      h('button', {
        type: 'button',
        class: `sw c-${c}${c === color ? ' on' : ''}`,
        'aria-label': c,
        title: c,
        onclick: (e) => {
          color = c;
          for (const x of sw.children) x.classList.toggle('on', x === e.currentTarget);
        },
      })
    ));
    // Link a task: its text becomes this entry's title and checking either one checks both.
    const choices = S.tasks.filter((t) => !t.done || t.id === entry.taskId);
    let taskSel = null;
    if (choices.length) {
      taskSel = h('select', {}, h('option', { value: '' }, 'Not linked'), choices.map((t) => h('option', { value: t.id }, t.text.slice(0, 80))));
      taskSel.value = taskById(entry.taskId) ? entry.taskId : '';
      taskSel.addEventListener('change', () => {
        const t = taskById(taskSel.value);
        if (t) text.value = t.text;
      });
    }
    const clearTime = h('button', { type: 'button', class: 'link', onclick: () => { start.value = ''; end.value = ''; } }, 'Clear time');

    const save = async () => {
      err.textContent = '';
      const body = { text: text.value.trim(), date: date.value, start: fromHM(start.value), end: start.value ? fromHM(end.value) : null, color, taskId: taskSel ? taskSel.value || null : entry.taskId || null, repeat: repeat.value || null };
      if (!body.text) return void (err.textContent = 'Write something first.');
      if (!body.date) return void (err.textContent = 'Pick a day.');
      if (body.end != null && body.end <= body.start) return void (err.textContent = 'End time must be after the start.');
      try {
        const saved = isNew ? await api('POST', '/entries', body) : await api('PATCH', '/entries/' + entry.id, body);
        upsertEntry(saved);
        const t = taskById(saved.taskId);
        if (t && t.text !== body.text) patchTask(t, { text: body.text });
        closeSheet();
        if (S.tab !== 'day') setTab('day');
        if (!occursOn(saved, D.date) || D.sub !== 'schedule') {
          toast(`Saved to ${dayName(saved.date)}${saved.start != null ? ' ' + fmtTime(saved.start) : ''}`, { label: 'Show', run: () => { D.sub = 'schedule'; store.set('daySub', 'schedule'); goDay(saved.date); } });
        }
        renderDay();
        if (saved.start != null) offerReminders();
      } catch (e) {
        err.textContent = e.message;
      }
    };
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
    });

    const btns = h('div', { class: 'btns' });
    if (!isNew) {
      const del = h('button', { class: 'btn danger', 'data-label': '1' }, entry.repeat ? 'Delete all' : 'Delete');
      del.addEventListener('click', () => confirmClick(del, async () => {
        try {
          await api('DELETE', '/entries/' + entry.id);
          S.entries = S.entries.filter((x) => x.id !== entry.id);
          closeSheet();
          renderDay();
        } catch (e) {
          err.textContent = e.message;
        }
      }));
      if (entry.repeat) {
        const base = S.entries.find((x) => x.id === entry.id);
        btns.append(h('button', { class: 'btn', onclick: () => { closeSheet(); patchEntry(base, { skip: [...(base.skip || []), entry.date] }); } }, 'Delete this one'));
      }
      btns.append(del, h('button', { class: 'btn', onclick: () => { closeSheet(); toggleDone(entry); } }, entry.done ? 'Not done' : 'Mark done'));
    }
    btns.append(h('span', { style: 'flex:1' }), h('button', { class: 'btn primary-btn', onclick: save }, isNew ? 'Add' : 'Save'));

    wrap.innerHTML = '';
    wrap.onclick = (e) => { if (e.target === wrap) closeSheet(); };
    wrap.append(h('div', { class: 'sheet' },
      h('h2', {}, isNew ? (entry.start != null ? `Add at ${fmtTime(entry.start)}` : 'Add to your day') : 'Edit',
        h('button', { class: 'icon-btn', html: I.close, 'aria-label': 'Close', onclick: closeSheet })),
      text,
      taskSel ? h('label', {}, 'Task', taskSel) : null,
      h('div', { class: 'row2' }, h('label', {}, entry.repeat ? 'Starts' : 'Day', date), h('label', {}, 'Repeat', repeat)),
      h('div', { class: 'row2' }, h('label', {}, 'Time', start), h('label', {}, 'Until (optional)', end)),
      h('div', { class: 'sheet-tip' }, h('span', {}, 'No time = anytime note. Add an end time to block out time.'), clearTime),
      h('label', {}, 'Color', sw),
      err,
      btns
    ));
    wrap.classList.remove('hidden');
    if (!text.value) text.focus();
  }

  // ----- reminders -----
  async function askNotify() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const p = await Notification.requestPermission();
    if (p !== 'granted') toast('Notifications are blocked by the system');
    return p === 'granted';
  }

  function offerReminders() {
    if (!('Notification' in window) || Notification.permission !== 'default' || store.get('askedRemind')) return;
    store.set('askedRemind', true);
    toast('Get a reminder when it’s time?', { label: 'Turn on', run: () => askNotify().then((ok) => { S.remind = ok; store.set('remind', ok); }) });
  }

  const fired = new Set(store.get('fired', []));
  function checkReminders() {
    if (!S.token) return;
    const k = todayKey();
    const n = nowMin();
    for (const e of entriesOn(k)) {
      if (e.start == null || e.done) continue;
      const key = `${e.id}@${e.date}@${e.start}`;
      if (fired.has(key) || n < e.start || n > e.start + 2) continue;
      fired.add(key);
      store.set('fired', [...fired].slice(-300));
      const when = e.end != null ? `${fmtTime(e.start)} – ${fmtTime(e.end)}` : fmtTime(e.start);
      toast(`${when} · ${e.text}`);
      if (S.remind && 'Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
        try {
          const nt = new Notification(e.text, { body: e.end != null ? `Now until ${fmtTime(e.end)}` : `Reminder · ${fmtTime(e.start)}`, icon: '/icon-128.png', tag: key });
          nt.onclick = () => { window.focus(); setTab('day'); goDay(e.date); };
        } catch {}
      }
    }
  }
  // Desktop menu bar: what's on now, else what's next today, plus the rest of today for the tray menu.
  let lastNext = '';
  function sendNext() {
    if (!desktop?.setNext || !S.workspace) return;
    const n = nowMin();
    const short = (t) => (t.length > 22 ? t.slice(0, 21) + '…' : t);
    const today = entriesOn(todayKey()).filter((e) => e.start != null && !e.done).sort((a, b) => a.start - b.start);
    const now = today.find((e) => e.end != null && e.start <= n && n < e.end);
    const up = today.find((e) => e.start > n);
    const title = now ? `${short(now.text)} · til ${fmtTime(now.end)}` : up ? `${fmtTime(up.start)} ${short(up.text)}` : '';
    const items = today.filter((e) => (e.end ?? e.start + 1) > n).map((e) => ({ label: `${fmtTime(e.start)}${e.end != null ? '–' + fmtTime(e.end) : ''}  ${e.text}` }));
    const msg = JSON.stringify({ title, items });
    if (msg === lastNext) return;
    lastNext = msg;
    desktop.setNext({ title, items });
  }
  desktop?.onOpenDay?.(() => {
    setTab('day');
    if (D.sub !== 'schedule') setSub('schedule');
    goDay(todayKey());
  });

  setInterval(() => {
    sendNext();
    checkReminders();
    if (S.tab === 'day' && D.sub === 'schedule' && D.scroll) renderDay(); // move the "now" line
  }, 30_000);

  // ---------- campaigns: campaign → goals → tasks, with logged attempts ----------
  const K = { open: store.get('campOpen', null), mine: store.get('campsMine', false), logOpen: null, showAll: {}, stale: false };
  const campById = (id) => id && S.campaigns?.find((c) => c.id === id);
  const goalById = (id) => id && S.goals?.find((g) => g.id === id);
  const goalsOf = (cid) => S.goals.filter((g) => g.campaignId === cid).sort((a, b) => (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt);
  const tasksOf = (gid) => S.tasks.filter((t) => t.goalId === gid);
  const attemptsIn = (cid) => S.attempts.filter((x) => x.campaignId === cid).sort((a, b) => b.at - a.at);
  // Count goals count the campaign's log, filtered by outcome and method.
  const countsFor = (g, x) => (!g.counts?.length || g.counts.includes(x.outcome)) && (!g.methods?.length || g.methods.includes(x.method));
  function goalProgress(g) {
    if (g.kind === 'count') {
      const n = attemptsIn(g.campaignId).filter((x) => countsFor(g, x)).length;
      const what = [g.counts?.length ? g.counts.join(' / ').toLowerCase() : '', g.methods?.length ? g.methods.join(' / ').toLowerCase() + 's' : g.counts?.length ? '' : 'logged'].filter(Boolean).join(' ');
      return { n, of: g.target, frac: Math.min(1, n / g.target), label: `${n} / ${g.target} ${what}` };
    }
    const ts = tasksOf(g.id);
    const n = ts.filter((t) => t.done).length;
    return { n, of: ts.length, frac: ts.length ? n / ts.length : 0, label: ts.length ? `${n} / ${ts.length} tasks` : 'No tasks yet' };
  }
  function campProgress(c) {
    const gs = goalsOf(c.id);
    return gs.length ? gs.reduce((s, g) => s + goalProgress(g).frac, 0) / gs.length : 0;
  }
  const bar = (frac, color) => h('div', { class: 'pbar c-' + (color || 'violet') }, h('i', { style: `width:${Math.round(frac * 100)}%` }));
  function campDates(c) {
    const f = (k) => keyDate(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const range = c.start && c.end ? `${f(c.start)} – ${f(c.end)}` : c.start ? `From ${f(c.start)}` : c.end ? `Until ${f(c.end)}` : '';
    if (!c.end || c.status === 'done') return range;
    const left = Math.round((keyDate(c.end) - keyDate(todayKey())) / 864e5);
    return `${range} · ${left > 1 ? left + ' days left' : left === 1 ? 'ends tomorrow' : left === 0 ? 'ends today' : 'ended'}`;
  }

  function openCampaign(id) {
    K.open = id;
    store.set('campOpen', id);
    if (S.tab !== 'camps') setTab('camps');
    else renderCamps();
    $('#camps').scrollTop = 0;
  }

  // Re-render, unless someone is typing in here; then wait until they're done.
  function renderCamps() {
    const root = $('#camps');
    if (!S.workspace || S.tab !== 'camps') return;
    if (root.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) {
      K.stale = true;
      return;
    }
    K.stale = false;
    const keep = root.scrollTop;
    const c = campById(K.open);
    root.replaceChildren(c ? campaignView(c) : campaignList());
    root.scrollTop = keep;
  }
  $('#camps').addEventListener('focusout', () => setTimeout(() => K.stale && renderCamps(), 0));

  function campaignList() {
    const all = [...S.campaigns].filter((c) => !K.mine || c.assigneeId === S.me?.memberId).sort((a, b) => (a.end || '9999') < (b.end || '9999') ? -1 : 1);
    const live = all.filter((c) => c.status !== 'done');
    const done = all.filter((c) => c.status === 'done');
    const card = (c) => {
      const p = campProgress(c);
      const gs = goalsOf(c.id);
      const mine = gs.flatMap((g) => tasksOf(g.id)).filter((t) => !t.done && t.assigneeId === S.me?.memberId).length;
      return h('button', { class: 'camp-card c-' + c.color + (c.status === 'paused' ? ' paused' : ''), onclick: () => openCampaign(c.id) },
        h('div', { class: 'cc-top' }, h('b', {}, c.name), c.private ? h('span', { class: 'cc-lock', html: I.lock, title: 'Private' }) : null, h('span', { class: 'cc-pct' }, Math.round(p * 100) + '%')),
        bar(p, c.color),
        h('div', { class: 'cc-sub' }, [c.assigneeId ? '→ ' + memberName(c.assigneeId) : '', campDates(c), `${gs.length} goal${gs.length === 1 ? '' : 's'}`, mine ? `${mine} for you` : '', c.status === 'paused' ? 'paused' : ''].filter(Boolean).join(' · ')));
    };
    const setMine = (on) => { K.mine = on; store.set('campsMine', on); renderCamps(); };
    const tpls = [...S.templates].sort((a, b) => a.name.localeCompare(b.name));
    return h('div', { class: 'camp-list' },
      h('div', { class: 'camp-h' }, h('b', {}, 'Campaigns'), h('button', { class: 'btn small primary-btn', onclick: () => campaignSheet() }, '+ New')),
      S.campaigns.some((c) => c.assigneeId) ? h('div', { class: 'seg mine-seg' },
        h('button', { class: K.mine ? '' : 'on', onclick: () => setMine(false) }, 'All campaigns'),
        h('button', { class: K.mine ? 'on' : '', onclick: () => setMine(true) }, 'Assigned to me')) : null,
      live.length ? live.map(card) : h('p', { class: 'day-hint camp-empty' }, K.mine ? 'Nothing assigned to you right now.' : done.length ? 'Nothing running right now.' : 'A campaign is a project with goals, and goals are made of tasks. Make one for an outreach push, a launch, anything with a finish line.'),
      done.length ? h('details', { class: 'camp-done' }, h('summary', {}, `Finished · ${done.length}`), done.map(card)) : null,
      tpls.length ? h('div', { class: 'any-h camp-goals-h' }, 'Saved campaigns') : null,
      tpls.map(templateRow));
  }

  // ----- saved campaigns: run again by hand or on a weekly schedule -----
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hhmm = (t) => fmtTime(Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  function upsertTemplate(t) {
    const i = S.templates.findIndex((x) => x.id === t.id);
    if (i >= 0) S.templates[i] = t;
    else S.templates.push(t);
  }
  function scheduleText(t) {
    if (!t.auto || !t.slots.length) return 'Start by hand';
    const days = (d) => (d.length === 7 ? 'Every day' : d.join() === '1,2,3,4,5' ? 'Weekdays' : d.map((x) => DOW[x]).join('/'));
    return t.slots.map((x) => `${days(x.days)} ${hhmm(x.time)}`).join(', ');
  }
  const canEditTemplate = (t) => t.ownerId === S.me?.memberId || amOwner();
  async function runTemplate(t) {
    try {
      const c = await api('POST', `/templates/${t.id}/run`, { date: todayKey() });
      if (!campById(c.id)) S.campaigns.push(c);
      openCampaign(c.id);
    } catch (e) {
      toast(e.message);
    }
  }
  function templateRow(t) {
    return h('div', { class: 'tpl-row' },
      h('div', { class: 'tpl-main' }, h('b', {}, t.name),
        h('small', {}, [scheduleText(t), t.assigneeId ? '→ ' + memberName(t.assigneeId) : '', `${t.goals.length} goal${t.goals.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '))),
      h('button', { class: 'btn small', onclick: () => runTemplate(t) }, 'Start now'),
      canEditTemplate(t) ? h('button', { class: 'icon-btn', 'aria-label': 'Saved campaign options', html: I.more, onclick: (e) => openMenu(e.currentTarget, [
        { label: 'Schedule and details…', run: () => templateSheet(t) },
        { label: 'Delete saved campaign', danger: true, run: () => api('DELETE', '/templates/' + t.id).catch((er) => toast(er.message)) },
      ]) }) : null);
  }
  async function saveTemplate(c) {
    try {
      const t = await api('POST', '/templates', { campaignId: c.id, name: c.name.replace(/ · .*$/, ''), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      upsertTemplate(t);
      templateSheet(t, true);
    } catch (e) {
      toast(e.message);
    }
  }
  function assigneeSelect(id) {
    const sel = h('select', {}, h('option', { value: '' }, 'Nobody'), S.workspace.members.map((m) => h('option', { value: m.id }, m.id === S.me?.memberId ? `${m.name} (you)` : m.name)));
    sel.value = id || '';
    return sel;
  }
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  function templateSheet(t, fresh) {
    const name = h('input', { value: t.name });
    const who = assigneeSelect(t.assigneeId);
    const sched = slotEditor(t, 'Each time makes a new campaign, starting that day.');
    sheet(fresh ? 'Saved. Run it again when?' : 'Saved campaign', [
      h('label', {}, 'Name', name),
      h('label', {}, 'Responsible', who),
      h('small', { class: 'day-hint' }, `Keeps its ${plural(t.goals.length, 'goal')} and ${plural(t.goals.reduce((n, g) => n + g.tasks.length, 0), 'task')}, with due dates counted from each run’s start. Start it by hand any time from Campaigns.`),
      h('label', { class: 'pick' }, sched.auto, 'Also start it automatically'),
      sched.box,
    ], async () => {
      upsertTemplate(await api('PATCH', '/templates/' + t.id, { name: name.value, assigneeId: who.value || null, ...sched.value() }));
      renderCamps();
    });
  }

  // Weekly times: each row is some weekdays at a time. x: { auto, slots, tz }. Used by saved campaigns and agents.
  function slotEditor(x, hint) {
    const auto = h('input', { type: 'checkbox' });
    auto.checked = !!x.auto;
    const slots = x.slots.length ? x.slots.map((y) => ({ days: [...y.days], time: y.time })) : [{ days: [1, 2, 3, 4, 5], time: '09:00' }];
    const box = h('div', { class: 'tpl-slots' + (auto.checked ? '' : ' hidden') });
    const draw = () => box.replaceChildren(
      ...slots.map((x, i) => {
        const time = h('input', { type: 'time', value: x.time });
        time.addEventListener('change', () => { x.time = time.value || '09:00'; });
        return h('div', { class: 'tpl-slot' },
          h('div', { class: 'seg tpl-days' }, DOW.map((d, n) => h('button', { type: 'button', class: x.days.includes(n) ? 'on' : '', title: d, onclick: () => {
            x.days = x.days.includes(n) ? x.days.filter((y) => y !== n) : [...x.days, n].sort();
            draw();
          } }, d[0]))),
          time,
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove time', html: I.close, onclick: () => { slots.splice(i, 1); draw(); } }));
      }),
      h('button', { type: 'button', class: 'link', onclick: () => { slots.push({ days: [1], time: '09:00' }); draw(); } }, '+ Add a time'),
      h('small', { class: 'day-hint' }, `${hint} Times are ${x.tz.replace(/_/g, ' ')} time.`));
    draw();
    auto.addEventListener('change', () => box.classList.toggle('hidden', !auto.checked));
    return {
      auto, box,
      value() {
        const keep = slots.filter((y) => y.days.length);
        if (auto.checked && !keep.length) throw new Error('Pick at least one day.');
        return { auto: auto.checked, slots: keep };
      },
    };
  }

  function campaignView(c) {
    const p = campProgress(c);
    const goals = goalsOf(c.id);
    const ch = S.workspace.channels.find((x) => x.id === c.channelId);
    const st = S.workspace.stacks.find((x) => x.id === c.stackId);
    const files = st ? stackCount(st.id) : 0;
    const who = c.private ? [...new Set([c.ownerId, ...c.memberIds, c.assigneeId].filter(Boolean))] : null;
    const brief = h('div', { class: 'camp-brief' + (c.brief ? '' : ' empty'), title: 'Click to edit', html: c.brief ? linkify(c.brief) : 'Add a brief: the goal, who it’s for, how you’ll know it worked…' });
    brief.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const ta = h('textarea', { class: 'camp-brief-edit', rows: 5 });
      ta.value = c.brief || '';
      const done = () => {
        if (ta.value !== (c.brief || '')) api('PATCH', '/campaigns/' + c.id, { brief: ta.value }).catch((er) => toast(er.message));
        c.brief = ta.value;
        ta.replaceWith(brief);
        renderCamps();
      };
      ta.addEventListener('blur', done);
      ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ta.value = c.brief || ''; ta.blur(); } });
      brief.replaceWith(ta);
      ta.focus();
    });
    return h('div', { class: 'camp-view' },
      h('div', { class: 'camp-top' },
        h('button', { class: 'icon-btn', 'aria-label': 'All campaigns', html: I.back, onclick: () => openCampaign(null) }),
        h('b', { class: 'camp-name' }, c.name),
        h('button', { class: 'icon-btn', 'aria-label': 'Campaign options', html: I.more, onclick: (e) => campaignMenu(e.currentTarget, c) })),
      h('div', { class: 'camp-meta' },
        campDates(c) ? h('span', {}, campDates(c)) : null,
        h('button', { class: 'pill pill-btn', title: 'Who’s responsible', onclick: (e) => assignCampaignMenu(e.currentTarget, c) }, c.assigneeId ? avatar(c.assigneeId) : null, c.assigneeId ? memberName(c.assigneeId) : 'Assign to…'),
        c.status !== 'active' ? h('span', { class: 'pill' }, c.status === 'done' ? 'Finished' : 'Paused') : null,
        who ? h('span', { class: 'pill', title: who.map(memberName).join(', ') }, h('span', { class: 'is-task', html: I.lock }), `Private · ${who.length}`) : null),
      h('div', { class: 'camp-total' }, bar(p, c.color), h('span', {}, Math.round(p * 100) + '%')),
      brief,
      h('div', { class: 'camp-links' },
        ch ? h('button', { class: 'btn small', onclick: () => { setTab('chat'); openChannel('ch:' + ch.id); } }, '# ' + ch.name) : null,
        st ? h('button', { class: 'btn small', onclick: () => showStack(st.id) }, `Files · ${files}`) : null,
        h('button', { class: 'btn small', onclick: () => openReport(c) }, 'Write a report')),
      h('div', { class: 'any-h camp-goals-h' }, 'Log'),
      logBox(c),
      h('div', { class: 'any-h camp-goals-h' }, 'Goals'),
      goals.map((g) => goalCard(c, g)),
      h('button', { class: 'add-goal', onclick: () => goalSheet(c) }, '+ Add a goal'));
  }

  function goalCard(c, g) {
    const pg = goalProgress(g);
    const tasks = tasksOf(g.id).sort((a, b) => a.done - b.done || ((a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : a.createdAt - b.createdAt));
    const add = h('input', { class: 'goal-add', placeholder: 'Add a task… “Call Old Town monday @Sam”', 'aria-label': 'Add a task to this goal' });
    add.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !add.value.trim()) return;
      const raw = add.value;
      add.value = '';
      try {
        upsertTask(await api('POST', '/tasks', { ...parseTask(raw), goalId: g.id }));
        add.focus();
        K.stale = true;
      } catch (er) {
        add.value = raw;
        toast(er.message);
      }
    });
    const el = h('div', { class: 'goal' },
      h('div', { class: 'goal-top' },
        h('span', { class: 'goal-ic', html: g.kind === 'count' ? I.target : I.task }),
        h('b', { class: 'goal-title' }, g.title),
        g.due ? h('span', { class: 'due' + (g.due < todayKey() && pg.frac < 1 ? ' late' : '') }, dueLabel(g.due)) : null,
        h('button', { class: 't-btn', 'aria-label': 'Goal options', html: I.more, onclick: (e) => goalOptions(e.currentTarget, c, g) })),
      h('div', { class: 'goal-prog' }, bar(pg.frac, c.color), h('span', {}, pg.label)));
    if (tasks.length) el.append(h('div', { class: 'goal-tasks' }, tasks.map((t) => taskRow(t, { inCampaign: true }))));
    el.append(add);
    return el;
  }

  // Log one attempt: how (call, email…), who (optional), then tap how it went. Every count goal reads from this log.
  function logBox(c) {
    const open = K.logOpen === c.id;
    const recent = attemptsIn(c.id);
    const showN = K.showAll[c.id] ? 50 : 3;
    const methods = c.methods || [];
    if (!methods.includes(K.method)) K.method = methods[0] || null;
    const list = recent.length ? h('div', { class: 'attempts' },
      recent.slice(0, showN).map((x) => h('div', { class: 'attempt' },
        h('span', { class: 'oc oc-' + c.outcomes.indexOf(x.outcome) }, x.outcome),
        h('span', { class: 'att-who' }, x.method ? h('small', {}, x.method + ' · ') : null, x.contact || '—', x.note ? h('small', {}, ' · ' + x.note) : null),
        h('span', { class: 'att-by' }, `${x.memberId === S.me?.memberId ? 'You' : x.by} · `, h('span', { 'data-ago': x.at }, ago(x.at))),
        x.memberId === S.me?.memberId || c.ownerId === S.me?.memberId ? h('button', { class: 't-btn', 'aria-label': 'Remove', html: I.close, onclick: () => api('DELETE', '/attempts/' + x.id).catch((e) => toast(e.message)) }) : null)),
      recent.length > 3 ? h('button', { class: 'link', onclick: () => { K.showAll[c.id] = !K.showAll[c.id]; renderCamps(); } }, K.showAll[c.id] ? 'Show less' : `Show all ${recent.length}`) : null) : null;
    if (!open) return h('div', { class: 'logbox' }, h('button', { class: 'btn small log-btn', onclick: () => { K.logOpen = c.id; renderCamps(); $('#camps .log-contact')?.focus(); } }, `+ Log ${methods.length ? methods.map((m) => (/^[aeiou]/i.test(m) ? 'an ' : 'a ') + m.toLowerCase()).join(' or ') : 'an attempt'}`), list);
    const contact = h('input', { class: 'log-contact', placeholder: 'Who? (business, person, area)', 'aria-label': 'Who you reached' });
    const note = h('input', { class: 'log-note', placeholder: 'Note (optional)', 'aria-label': 'Note' });
    const log = async (outcome) => {
      try {
        const x = await api('POST', '/attempts', { campaignId: c.id, method: K.method, outcome, contact: contact.value, note: note.value });
        if (!S.attempts.some((y) => y.id === x.id)) S.attempts.push(x);
        contact.value = note.value = '';
        toast(`Logged · ${outcome}`);
        renderCamps();
        $('#camps .log-contact')?.focus();
      } catch (e) {
        toast(e.message);
      }
    };
    return h('div', { class: 'logbox open' },
      methods.length > 1 ? h('div', { class: 'seg log-methods' }, methods.map((m) => h('button', { class: m === K.method ? 'on' : '', onclick: () => { K.method = m; renderCamps(); $('#camps .log-contact')?.focus(); } }, m))) : null,
      h('div', { class: 'log-row' }, contact, h('button', { class: 't-btn', 'aria-label': 'Close', html: I.close, onclick: () => { K.logOpen = null; renderCamps(); } })),
      note,
      h('div', { class: 'log-outcomes' }, c.outcomes.map((o, i) => h('button', { class: 'oc oc-' + i, onclick: () => log(o) }, o))),
      list);
  }

  function assignCampaignMenu(anchor, c) {
    openMenu(anchor, [
      { head: 'Responsible' },
      { label: 'Nobody', on: !c.assigneeId, run: () => api('PATCH', '/campaigns/' + c.id, { assigneeId: null }).catch((e) => toast(e.message)) },
      ...S.workspace.members.map((m) => ({ label: m.id === S.me?.memberId ? `${m.name} (you)` : m.name, on: c.assigneeId === m.id, run: () => api('PATCH', '/campaigns/' + c.id, { assigneeId: m.id }).catch((e) => toast(e.message)) })),
    ]);
  }
  function campaignMenu(anchor, c) {
    const owner = c.ownerId === S.me?.memberId;
    openMenu(anchor, [
      { label: 'Edit details…', run: () => campaignSheet(c) },
      { label: c.assigneeId ? `Responsible: ${memberName(c.assigneeId)}…` : 'Assign to…', run: () => assignCampaignMenu(anchor, c) },
      { label: 'Save to run again…', run: () => saveTemplate(c) },
      { label: 'What to log…', run: () => outcomesSheet(c) },
      { label: 'Write a report', run: () => openReport(c) },
      { label: 'Share to chat…', run: () => shareMenu(anchor, linkToken('campaign', c.id)) },
      c.status === 'active' ? { label: 'Pause', run: () => api('PATCH', '/campaigns/' + c.id, { status: 'paused' }).catch((e) => toast(e.message)) } : { label: 'Make active', run: () => api('PATCH', '/campaigns/' + c.id, { status: 'active' }).catch((e) => toast(e.message)) },
      c.status !== 'done' ? { label: 'Mark finished', run: () => api('PATCH', '/campaigns/' + c.id, { status: 'done' }).catch((e) => toast(e.message)) } : { note: 'Finished' },
      ...(owner || amOwner() ? [{ label: 'Delete campaign and everything in it', danger: true, run: () => api('DELETE', '/campaigns/' + c.id).then(() => openCampaign(null)).catch((e) => toast(e.message)) }] : []),
    ]);
  }
  function goalOptions(anchor, c, g) {
    openMenu(anchor, [
      { label: 'Plan it out…', run: () => planSheet(c, g) },
      { label: 'Edit goal…', run: () => goalSheet(c, g) },
      { label: 'Delete goal and its tasks', danger: true, run: () => api('DELETE', '/goals/' + g.id).catch((e) => toast(e.message)) },
    ]);
  }

  // ----- sheets: campaign details, goal, outcomes, report -----
  function sheet(title, body, onSave, saveLabel = 'Save') {
    const wrap = $('#sheet');
    const err = h('p', { class: 'err' });
    const save = async () => {
      err.textContent = '';
      try {
        await onSave();
        closeSheet();
      } catch (e) {
        err.textContent = e.message;
      }
    };
    wrap.innerHTML = '';
    wrap.onclick = (e) => { if (e.target === wrap) closeSheet(); };
    wrap.append(h('div', { class: 'sheet' },
      h('h2', {}, title, h('button', { class: 'icon-btn', html: I.close, 'aria-label': 'Close', onclick: closeSheet })),
      ...body, err,
      h('div', { class: 'btns' }, h('span', { style: 'flex:1' }), h('button', { class: 'btn primary-btn', onclick: save }, saveLabel))));
    wrap.classList.remove('hidden');
    wrap.querySelector('input, textarea')?.focus();
  }

  function campaignSheet(c) {
    const name = h('input', { value: c?.name || '', placeholder: 'Q4 outreach' });
    const brief = h('textarea', { rows: 4, placeholder: 'What’s the goal? Who’s it for? How will you know it worked?' });
    brief.value = c?.brief || '';
    const start = h('input', { type: 'date', value: c?.start || todayKey() });
    const end = h('input', { type: 'date', value: c?.end || '' });
    let color = c?.color || COLORS[S.campaigns.length % COLORS.length];
    const sw = h('div', { class: 'swatches' }, COLORS.map((col) => h('button', { type: 'button', class: `sw c-${col}${col === color ? ' on' : ''}`, 'aria-label': col,
      onclick: (e) => { color = col; for (const x of sw.children) x.classList.toggle('on', x === e.currentTarget); } })));
    const owner = !c || c.ownerId === S.me?.memberId;
    const priv = h('input', { type: 'checkbox' });
    priv.checked = !!c?.private;
    const others = S.workspace.members.filter((m) => m.id !== (c?.ownerId || S.me?.memberId));
    const picks = others.map((m) => {
      const cb = h('input', { type: 'checkbox', value: m.id });
      cb.checked = !!c?.memberIds.includes(m.id);
      return h('label', { class: 'pick' }, cb, m.name);
    });
    const people = h('div', { class: 'picks' + (priv.checked ? '' : ' hidden') }, picks.length ? picks : h('small', {}, 'Nobody else on the team yet.'));
    priv.addEventListener('change', () => people.classList.toggle('hidden', !priv.checked));
    const who = assigneeSelect(c?.assigneeId);
    sheet(c ? 'Campaign details' : 'New campaign', [
      h('label', {}, 'Name', name),
      h('label', {}, 'Brief', brief),
      h('div', { class: 'row2' }, h('label', {}, 'Starts', start), h('label', {}, 'Ends (optional)', end)),
      h('label', {}, 'Color', sw),
      h('label', {}, 'Responsible', who),
      owner ? h('label', { class: 'pick' }, priv, 'Private: only people I choose can see it') : (c?.private ? h('small', { class: 'day-hint' }, 'Private. The campaign owner chooses who sees it.') : null),
      owner ? people : null,
    ], async () => {
      const body = { name: name.value, brief: brief.value, start: start.value || null, end: end.value || null, color, assigneeId: who.value || null };
      if (owner) Object.assign(body, { private: priv.checked, memberIds: picks.map((l) => l.firstChild).filter((cb) => cb.checked).map((cb) => cb.value) });
      const saved = c ? await api('PATCH', '/campaigns/' + c.id, body) : await api('POST', '/campaigns', body);
      const i = S.campaigns.findIndex((x) => x.id === saved.id);
      if (i >= 0) S.campaigns[i] = saved;
      else S.campaigns.push(saved);
      openCampaign(saved.id);
    }, c ? 'Save' : 'Create');
  }

  function goalSheet(c, g) {
    const title = h('input', { value: g?.title || '', placeholder: 'Book 20 meetings downtown' });
    const due = h('input', { type: 'date', value: g?.due || '' });
    const kind = h('select', {}, h('option', { value: 'tasks' }, 'Checking off its tasks'), h('option', { value: 'count' }, 'Counting logged attempts'));
    kind.value = g?.kind || 'tasks';
    const target = h('input', { type: 'number', min: 1, value: g?.target || 20 });
    const boxes = c.outcomes.map((o) => {
      const cb = h('input', { type: 'checkbox', value: o });
      cb.checked = !!g?.counts?.includes(o);
      return h('label', { class: 'pick' }, cb, o);
    });
    const mboxes = (c.methods || []).map((o) => {
      const cb = h('input', { type: 'checkbox', value: o });
      cb.checked = !!g?.methods?.includes(o);
      return h('label', { class: 'pick' }, cb, o);
    });
    const countOpts = h('div', { class: 'count-opts' },
      h('label', {}, 'Target', target),
      mboxes.length ? h('div', { class: 'picks-h' }, 'Count which? (none ticked = all)') : null,
      mboxes.length ? h('div', { class: 'picks' }, mboxes) : null,
      h('div', { class: 'picks-h' }, 'With which outcome? (none ticked = any)'),
      h('div', { class: 'picks' }, boxes));
    const sync = () => countOpts.classList.toggle('hidden', kind.value !== 'count');
    kind.addEventListener('change', sync);
    sync();
    sheet(g ? 'Edit goal' : 'New goal', [
      h('label', {}, 'Goal', title),
      h('div', { class: 'row2' }, h('label', {}, 'Progress by', kind), h('label', {}, 'Due (optional)', due)),
      countOpts,
    ], async () => {
      const counts = boxes.map((l) => l.firstChild).filter((cb) => cb.checked).map((cb) => cb.value);
      const methods = mboxes.map((l) => l.firstChild).filter((cb) => cb.checked).map((cb) => cb.value);
      const body = { title: title.value, due: due.value || null, kind: kind.value, target: Number(target.value), counts: counts.length ? counts : null, methods: methods.length ? methods : null };
      const saved = g ? await api('PATCH', '/goals/' + g.id, body) : await api('POST', '/goals', { ...body, campaignId: c.id });
      const i = S.goals.findIndex((x) => x.id === saved.id);
      if (i >= 0) S.goals[i] = saved;
      else S.goals.push(saved);
      renderCamps();
    }, g ? 'Save' : 'Add goal');
  }

  // "Plan it out": a list (areas, leads, batches) becomes one dated task each, spread over the days you pick.
  function planSheet(c, g) {
    const list = h('textarea', { rows: 6, placeholder: 'Pearl District\nOld Town\nNob Hill\n…' });
    const pattern = h('input', { value: 'Call {}', placeholder: 'Call {}' });
    const start = h('input', { type: 'date', value: [todayKey(), c.start].filter(Boolean).sort().pop() });
    const perDay = h('input', { type: 'number', min: 1, max: 50, value: 1 });
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => {
      const cb = h('input', { type: 'checkbox', value: (i + 1) % 7 });
      cb.checked = i < 5;
      return h('label', { class: 'pick' }, cb, d);
    });
    const who = h('select', {}, h('option', { value: '' }, 'Nobody'), h('option', { value: '*' }, 'Take turns'), S.workspace.members.map((m) => h('option', { value: m.id }, m.name)));
    const report = h('input', { type: 'checkbox' });
    report.checked = true;
    const preview = h('div', { class: 'report-stats plan-preview' });
    const plan = () => {
      const items = list.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 200);
      const ok = new Set(days.map((l) => l.firstChild).filter((cb) => cb.checked).map((cb) => Number(cb.value)));
      const n = Math.max(1, Math.min(50, Number(perDay.value) || 1));
      const out = [];
      let k = start.value || todayKey();
      for (let guard = 0; ok.size && out.length < items.length && guard < 800; guard++, k = addDays(k, 1)) {
        if (!ok.has(keyDate(k).getDay())) continue;
        for (let j = 0; j < n && out.length < items.length; j++) {
          const it = items[out.length];
          out.push({ text: pattern.value.includes('{}') ? pattern.value.replace('{}', it) : `${pattern.value} ${it}`.trim(), due: k });
        }
      }
      return out;
    };
    const draw = () => {
      const p = plan();
      preview.replaceChildren(...(p.length
        ? [h('div', {}, h('b', {}, `${p.length} task${p.length === 1 ? '' : 's'}`), `, ${dueLabel(p[0].due)} → ${dueLabel(p[p.length - 1].due)}`),
          ...p.slice(0, 4).map((x) => h('div', { class: 'plan-row' }, h('span', {}, dueLabel(x.due)), x.text)),
          p.length > 4 ? h('div', { class: 'plan-row' }, '…') : null]
        : [h('div', {}, 'Add one line per area, lead or batch.')]));
    };
    for (const el of [list, pattern, start, perDay, ...days.map((l) => l.firstChild)]) el.addEventListener('input', draw);
    draw();
    sheet(`Plan it out · ${g.title}`, [
      h('label', {}, 'One per line', list),
      h('div', { class: 'row2' }, h('label', {}, 'Task ({} = each line)', pattern), h('label', {}, 'Starting', start)),
      h('div', { class: 'picks' }, days),
      h('div', { class: 'row2' }, h('label', {}, 'Per day', perDay), h('label', {}, 'Assign to', who)),
      h('label', { class: 'pick' }, report, 'Add a “Report findings” task on the last day'),
      preview,
    ], async () => {
      const p = plan();
      if (!p.length) throw new Error('Add at least one line.');
      const people = S.workspace.members.map((m) => m.id);
      for (const [i, x] of p.entries()) {
        const assigneeId = who.value === '*' ? people[i % people.length] : who.value || null;
        upsertTask(await api('POST', '/tasks', { ...x, goalId: g.id, assigneeId }));
      }
      if (report.checked) upsertTask(await api('POST', '/tasks', { text: 'Report findings', due: p[p.length - 1].due, goalId: g.id, report: true, assigneeId: who.value && who.value !== '*' ? who.value : null }));
      toast(`Added ${p.length} task${p.length === 1 ? '' : 's'}`);
      renderCamps();
    }, 'Add tasks');
  }

  function outcomesSheet(c) {
    const ta = h('textarea', { rows: 5 });
    ta.value = c.outcomes.join('\n');
    const ms = h('textarea', { rows: 3 });
    ms.value = (c.methods || []).join('\n');
    sheet('What to log', [
      h('label', {}, 'Ways you reach people (one per line)', ms),
      h('label', {}, 'Outcomes (one per line; these are the buttons you tap)', ta),
    ], async () => {
      const saved = await api('PATCH', '/campaigns/' + c.id, { outcomes: ta.value.split('\n'), methods: ms.value.split('\n') });
      Object.assign(c, saved);
      renderCamps();
    });
  }

  // A report: numbers since the last one are filled in from the log, you add what you found. Posts to the campaign feed.
  function openReport(c, task) {
    if (!c) return;
    const since = c.lastReportAt || (c.start ? keyDate(c.start).getTime() : 0);
    const xs = S.attempts.filter((x) => x.campaignId === c.id && x.at > since);
    const by = (key) => Object.entries(xs.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
    const outcomes = by('outcome').map(([o, n]) => `${o} ${n}`).join(' · ');
    const methods = xs.some((x) => x.method) ? by('method').filter(([m]) => m !== 'null').map(([m, n]) => `${m} ${n}`).join(' · ') : '';
    const people = by('by').map(([p, n]) => `${p} ${n}`).join(' · ');
    const sinceTxt = since ? new Date(since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'the start';
    const goals = goalsOf(c.id).map((g) => `${g.title}: ${goalProgress(g).label}`);
    const stats = [
      xs.length ? `${xs.length} attempt${xs.length === 1 ? '' : 's'} since ${sinceTxt}: ${outcomes}` : `No attempts logged since ${sinceTxt}`,
      methods ? `How: ${methods}` : '',
      xs.length && people ? `By: ${people}` : '',
      ...goals,
    ].filter(Boolean);
    const notes = h('textarea', { rows: 5, placeholder: 'What did you find? What’s working, what isn’t, what’s next?' });
    sheet(`Report · ${c.name}`, [
      task ? h('p', { class: 'day-hint' }, `Finishes “${task.text}”.`) : null,
      h('div', { class: 'report-stats' }, stats.map((l) => h('div', {}, l))),
      h('label', {}, 'Findings', notes),
    ].filter(Boolean), async () => {
      const text = [`📋 Report · ${c.name}`, ...stats, notes.value.trim() ? '\n' + notes.value.trim() : '', linkToken('campaign', c.id)].filter(Boolean).join('\n');
      await api('POST', '/items', { type: 'message', text, channelId: c.channelId });
      await api('PATCH', '/campaigns/' + c.id, { lastReportAt: Date.now() });
      if (task) await patchTask(task, { done: true }, { reported: true });
      toast(`Posted to #${S.workspace.channels.find((x) => x.id === c.channelId)?.name || 'feed'}`, { label: 'Show', run: () => { setTab('chat'); openChannel('ch:' + c.channelId); } });
    }, 'Post report');
  }

  // ---------- chat: #feeds in folders, Slack style ----------
  const channelById = (id) => id && S.workspace?.channels?.find((c) => c.id === id);
  const C = {
    view: store.get('chatView', 'chat'), // 'chat' is #general; 'ch:<id>' is a feed
    collapsed: store.get('chatCollapsed', {}),
    lastRead: store.get('lastRead', {}),
    since: store.get('chatSince', null) ?? Date.now(), // feeds never opened count as read up to first launch
    pane: null,
  };
  store.set('chatSince', C.since);

  const unread = (view) => unreadItems(view).length;
  function unreadItems(view) {
    const ch = viewChannel(view);
    const seen = C.lastRead[view] ?? C.since;
    return S.items.filter((x) => (x.channelId || null) === ch && x.createdAt > seen && !isMine(x) && (ch || x.type === 'message') && (!x.parentId || mentionsMe(x)));
  }
  const unreadAt = (view) => unreadItems(view).some(mentionsMe);
  function markRead() {
    if (S.tab !== 'chat' || document.hidden) return;
    C.lastRead[C.view] = Date.now();
    store.set('lastRead', C.lastRead);
  }
  function chatChanged() {
    markRead();
    renderChatSide();
  }
  document.addEventListener('visibilitychange', () => S.tab === 'chat' && chatChanged());

  function buildChat() {
    const root = $('#chat');
    C.side = h('nav', { class: 'ch-side' });
    C.title = h('div', { class: 'ch-title' });
    C.main = h('div', { class: 'ch-main' },
      h('div', { class: 'ch-head' },
        h('button', { class: 'icon-btn ch-menu', 'aria-label': 'Feeds', html: I.menu, onclick: () => root.classList.toggle('side-open') }),
        C.title,
        h('button', { class: 'icon-btn ch-search', title: 'Search  (⌘K)', 'aria-label': 'Search', html: I.search, onclick: () => openPalette() })
      )
    );
    root.append(C.side, h('div', { class: 'ch-scrim', onclick: () => root.classList.remove('side-open') }), C.main);
  }

  function openChannel(view) {
    if (!S.workspace) return;
    if (!C.side) buildChat();
    if (view.startsWith('ch:') && !channelById(viewChannel(view))) view = 'chat';
    if (C.pane?._view !== view) {
      C.view = view;
      store.set('chatView', view);
      C.pane?.remove();
      const pane = h('section', { class: 'pane chat-pane', 'data-i': 'c' });
      pane._view = view;
      pane._cards = new Map();
      pane._list = h('div', { class: 'list bottom' });
      pane.append(pane._list, composer(pane));
      C.main.append(pane);
      C.pane = pane;
      renderPane(pane, true);
    }
    const ch = channelById(viewChannel(view));
    C.title.replaceChildren(h('span', { class: 'hash' }, '#'), ch ? ch.name : 'general');
    $('#chat').classList.remove('side-open');
    checkThread();
    chatChanged();
  }

  // Thread panel beside the feed (over it when narrow). Its pane renders like any other.
  function openThread(id) {
    const root = S.items.find((x) => x.id === id);
    if (!root) return;
    if (S.tab !== 'chat') setTab('chat');
    const feed = root.channelId ? 'ch:' + root.channelId : 'chat';
    if (C.view !== feed) openChannel(feed);
    if (C.thread?._view === 'th:' + id) return C.thread.querySelector('textarea')?.focus();
    closeThread();
    const pane = h('section', { class: 'pane chat-pane', 'data-i': 't' });
    pane._view = 'th:' + id;
    pane._cards = new Map();
    pane._list = h('div', { class: 'list bottom' });
    pane.append(pane._list, composer(pane));
    const ch = channelById(root.channelId);
    C.threadBox = h('aside', { class: 'ch-thread' },
      h('div', { class: 'ch-head' },
        h('div', { class: 'ch-title' }, 'Thread', h('span', { class: 'th-in' }, ' in #' + (ch ? ch.name : 'general'))),
        h('button', { class: 'icon-btn th-close', 'aria-label': 'Close thread', html: I.close, onclick: closeThread })),
      pane);
    $('#chat').append(C.threadBox);
    C.thread = pane;
    renderPane(pane, true);
    pane.querySelector('textarea').focus();
  }
  function closeThread() {
    C.threadBox?.remove();
    C.threadBox = C.thread = null;
  }
  // The parent was deleted, or we moved to another feed.
  function checkThread() {
    const id = C.thread && viewThread(C.thread._view);
    const root = id && S.items.find((x) => x.id === id);
    if (id && (!root || (root.channelId ? 'ch:' + root.channelId : 'chat') !== C.view)) closeThread();
  }

  // ---------- ⌘K: jump to a feed, or search messages, files, tasks and stacks ----------
  let palette = null;
  function closePalette() {
    palette?.remove();
    palette = null;
  }

  // Open the feed (or thread) holding a message and flash it.
  function jumpTo(it) {
    if (it.parentId) openThread(it.parentId);
    else {
      setTab('chat');
      openChannel(it.channelId ? 'ch:' + it.channelId : 'chat');
    }
    const pane = it.parentId ? C.thread : C.pane;
    const el = pane?._cards.get(it.id);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  function openPalette() {
    if (palette) return closePalette();
    const q = h('input', { class: 'pk-q', placeholder: 'Jump to a feed, or search everything…', spellcheck: 'false', 'aria-label': 'Search' });
    const list = h('div', { class: 'pk-list' });
    let rows = [], sel = 0;
    const go = (r) => { closePalette(); r?.run(); };
    const mark = (text, s) => {
      const t = text.replace(/\s+/g, ' ').trim();
      const i = s ? t.toLowerCase().indexOf(s) : -1;
      const from = Math.max(0, i - 30);
      const part = (from ? '…' : '') + t.slice(from, from + 140);
      return s ? esc(part).replace(new RegExp(reEsc(esc(s)), 'gi'), (m) => `<mark>${m}</mark>`) : esc(part);
    };
    const feedOf = (it) => '#' + (channelById(it.channelId)?.name || 'general');
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      const hit = (t) => !s || (t || '').toLowerCase().includes(s);
      const feeds = [['chat', 'general'], ...S.workspace.channels.map((c) => ['ch:' + c.id, c.name])].filter(([, n]) => hit(n));
      const groups = [
        ['Feeds', feeds.map(([v, n]) => ({ icon: h('span', { class: 'pk-ic pk-hash' }, '#'), label: n, sub: unread(v) ? `${unread(v)} new` : '', run: () => { setTab('chat'); openChannel(v); } }))],
      ];
      if (s) {
        const msgs = S.items.filter((x) => x.type === 'message' && hit(plainText(x.text))).sort((a, b) => b.createdAt - a.createdAt);
        groups.push(
          ['Messages', msgs.slice(0, 30).map((x) => ({ icon: h('span', { class: 'pk-ic at-ic' }, (x.by || '?').slice(0, 1).toUpperCase()),
            html: mark(plainText(x.text), s), sub: `${isMine(x) ? 'You' : x.by} · ${feedOf(x)}${x.parentId ? ' thread' : ''} · ${ago(x.createdAt)}`, two: true, run: () => jumpTo(x) }))],
          ['Files', S.items.filter((x) => (x.type === 'file' || x.type === 'folder') && hit(x.name)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
            .map((x) => ({ icon: h('span', { class: 'pk-ic', html: x.type === 'folder' ? I.folder : I.link }), label: x.name, sub: fmtSize(x.size), run: () => openPreview(x) }))],
          ['Notes', S.items.filter((x) => x.type === 'text' && hit(x.text)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
            .map((x) => ({ icon: h('span', { class: 'pk-ic', html: I.copy }), html: mark(x.text, s), sub: ago(x.createdAt), two: true, run: () => openPreview(x) }))],
          ['Campaigns', [...S.campaigns.filter((c) => hit(c.name) || hit(c.brief)).map((c) => ({ icon: h('span', { class: 'pk-ic', html: I.target }), label: c.name, sub: Math.round(campProgress(c) * 100) + '%', run: () => openCampaign(c.id) })),
            ...S.goals.filter((g) => hit(g.title)).slice(0, 10).map((g) => ({ icon: h('span', { class: 'pk-ic', html: I.target }), label: g.title, sub: `${campById(g.campaignId)?.name} · ${goalProgress(g).label}`, run: () => openCampaign(g.campaignId) }))]],
          ['Tasks', S.tasks.filter((t) => hit(t.text)).slice(0, 10)
            .map((t) => ({ icon: h('span', { class: 'pk-ic', html: I.task }), label: t.text, sub: t.done ? 'done' : taskSlot(t)?.label, run: () => (goalById(t.goalId) ? openCampaign(goalById(t.goalId).campaignId) : showTasks()) }))],
          ['Stacks', S.workspace.stacks.filter((x) => hit(x.name))
            .map((x) => ({ icon: h('span', { class: 'pk-ic', html: I.stack }), label: x.name, sub: `${stackCount(x.id)} items`, run: () => showStack(x.id) }))],
        );
      }
      rows = [];
      list.replaceChildren();
      for (const [title, all] of groups) {
        if (!all.length) continue;
        list.append(h('div', { class: 'mh' }, title));
        for (const r of all) {
          const i = rows.length;
          rows.push(r);
          const label = r.html != null ? h('span', { class: 'pk-label', html: r.html }) : h('span', { class: 'pk-label' }, r.label);
          list.append(h('button', { class: 'pk-row' + (i === sel ? ' on' : '') + (r.two ? ' two' : ''), onclick: () => go(r), onpointermove: () => { if (sel !== i) { sel = i; list.querySelector('.pk-row.on')?.classList.remove('on'); list.querySelectorAll('.pk-row')[i].classList.add('on'); } } },
            r.icon, r.two ? h('span', { class: 'pk-two' }, label, h('span', { class: 'pk-sub' }, r.sub)) : [label, r.sub ? h('span', { class: 'pk-sub' }, r.sub) : null]));
        }
      }
      if (!rows.length) list.append(h('div', { class: 'pk-none' }, 'Nothing matches'));
      list.querySelector('.pk-row.on')?.scrollIntoView({ block: 'nearest' });
    };
    q.addEventListener('input', () => { sel = 0; draw(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % (rows.length || 1);
        draw();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        go(rows[sel]);
      } else if (e.key === 'Escape') closePalette();
    });
    palette = h('div', { class: 'palette', onpointerdown: (e) => { if (e.target === palette) closePalette(); } },
      h('div', { class: 'pal-box' }, q, list, h('div', { class: 'pal-foot' }, '↑↓ to move · ↵ to open · esc to close')));
    document.body.append(palette);
    draw();
    q.focus();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && S.workspace && !$('#app').classList.contains('hidden')) {
      e.preventDefault();
      openPalette();
    }
  });

  function chanRow(view, name) {
    const n = view === C.view ? 0 : unread(view);
    const ch = channelById(viewChannel(view));
    const row = h('div', { class: 'ch-row' + (view === C.view ? ' on' : '') + (n ? ' unread' : ''), onclick: () => openChannel(view) },
      h('span', { class: 'hash' }, '#'),
      h('span', { class: 'ch-name' }, name),
      campById(ch?.campaignId)?.private ? h('span', { class: 'ch-lock', title: 'Private campaign', html: I.lock })
        : ch?.memberIds ? h('span', { class: 'ch-lock', title: 'Invite only: ' + [ch.ownerId, ...ch.memberIds].map(memberName).join(', '), html: I.lock }) : null,
      n ? h('span', { class: 'badge' + (unreadAt(view) ? ' at' : '') }, (unreadAt(view) ? '@' : '') + (n > 99 ? '99+' : n)) : null,
      ch ? h('button', { class: 'ch-more', 'aria-label': 'Feed options', html: I.more, onclick: (e) => { e.stopPropagation(); channelMenu(ch, e.currentTarget, row); } }) : null
    );
    return row;
  }

  // Inline "name it" row; used for new feeds and folders.
  function askName(after, placeholder, onName, indent) {
    const slot = h('div', { class: 'ch-row' + (indent ? ' in' : '') });
    after.after(slot);
    const ph = h('span');
    slot.append(ph);
    inlineEdit(ph, { placeholder, onDone: (name) => { slot.remove(); if (name) onName(name); } });
  }

  const wsCall = (method, path, body) => api(method, path, body).then((ws) => { S.workspace = ws; renderChatSide(); return ws; }).catch((e) => toast(e.message));

  function newChannel(anchorRow, folderId) {
    askName(anchorRow, 'new-feed', async (name) => {
      const ws = await wsCall('POST', '/channels', { name, folderId });
      const ch = ws?.channels[ws.channels.length - 1];
      if (!ch) return;
      openChannel('ch:' + ch.id);
      // Feeds are invite-only, so straight on to who's in it.
      if (S.workspace.members.length > 1) feedPeopleSheet(ch);
    }, !!folderId);
  }

  function feedPeopleSheet(ch) {
    const picks = S.workspace.members.filter((m) => m.id !== ch.ownerId).map((m) => {
      const cb = h('input', { type: 'checkbox', value: m.id });
      cb.checked = ch.memberIds.includes(m.id);
      return h('label', { class: 'pick' }, cb, m.name);
    });
    sheet('Who’s in #' + ch.name, [
      h('small', { class: 'day-hint' }, `Only the people you pick (and ${memberName(ch.ownerId) === 'You' ? 'you' : memberName(ch.ownerId)}) can see this feed and its messages.`),
      h('div', { class: 'picks' }, picks.length ? picks : h('small', {}, 'Nobody else on the team yet.')),
    ], async () => {
      const memberIds = picks.map((l) => l.firstChild).filter((cb) => cb.checked).map((cb) => cb.value);
      S.workspace = await api('PATCH', '/channels/' + ch.id, { memberIds });
      renderChatSide();
    });
  }

  function channelMenu(ch, anchor, row) {
    const manages = ch.ownerId === S.me?.memberId || S.workspace.members.find((m) => m.id === S.me?.memberId)?.role === 'owner';
    const people = !ch.memberIds ? []
      : manages ? [{ label: 'People…', run: () => feedPeopleSheet(ch) }]
      : [{ note: 'In this feed: ' + [ch.ownerId, ...ch.memberIds].map(memberName).join(', ') },
         { label: 'Leave feed', danger: true, run: () => wsCall('POST', '/channels/' + ch.id + '/leave') }];
    openMenu(anchor, [
      ...people,
      { label: 'Rename', run: () => {
        const nameEl = row.querySelector('.ch-name');
        inlineEdit(nameEl, { value: ch.name, onDone: (name) => name && name !== ch.name && wsCall('PATCH', '/channels/' + ch.id, { name }) });
      } },
      { head: 'Move to folder' },
      { label: 'No folder', on: !ch.folderId, run: () => wsCall('PATCH', '/channels/' + ch.id, { folderId: null }) },
      ...S.workspace.chatFolders.map((f) => ({ label: f.name, on: ch.folderId === f.id, run: () => wsCall('PATCH', '/channels/' + ch.id, { folderId: f.id }) })),
      ...(ch.campaignId || (ch.ownerId && !manages) ? [] : [{ head: '' }, { label: 'Delete feed and its messages', danger: true, run: () => wsCall('DELETE', '/channels/' + ch.id) }]),
    ]);
  }

  function folderMenu(f, anchor, head) {
    openMenu(anchor, [
      { label: 'New feed in folder', run: () => {
        C.collapsed[f.id] = false;
        store.set('chatCollapsed', C.collapsed);
        renderChatSide();
        newChannel(C.side.querySelector(`[data-folder="${f.id}"]`), f.id);
      } },
      { label: 'Rename folder', run: () => inlineEdit(head.querySelector('.ch-name'), { value: f.name, onDone: (name) => name && name !== f.name && wsCall('PATCH', '/chat-folders/' + f.id, { name }) }) },
      { label: 'Delete folder (feeds stay)', danger: true, run: () => wsCall('DELETE', '/chat-folders/' + f.id) },
    ]);
  }

  function renderChatSide() {
    if (!S.workspace) return;
    const views = ['chat', ...(S.workspace.channels || []).map((c) => 'ch:' + c.id)];
    $('#tabs [data-tab="chat"]').classList.toggle('dot', views.some((v) => !(S.tab === 'chat' && v === C.view) && unread(v)));
    if (!C.side) return;
    if (C.side.querySelector('.rename')) return; // don't yank an input out from under the user
    const channels = S.workspace.channels || [];
    const folders = S.workspace.chatFolders || [];
    const head = h('div', { class: 'ch-side-head' }, h('span', {}, 'Feeds'));
    head.append(h('button', { class: 'ch-more', 'aria-label': 'New feed or folder', title: 'New feed or folder', html: I.plus, onclick: (e) => openMenu(e.currentTarget, [
      { label: '# New feed', run: () => newChannel(head) },
      { label: 'New folder', run: () => askName(head, 'Folder name', (name) => wsCall('POST', '/chat-folders', { name })) },
    ]) }));
    const out = [head, chanRow('chat', 'general')];
    for (const ch of channels.filter((c) => !c.folderId)) out.push(chanRow('ch:' + ch.id, ch.name));
    for (const f of folders) {
      const shut = !!C.collapsed[f.id];
      const inside = channels.filter((c) => c.folderId === f.id);
      const total = shut ? inside.reduce((n, c) => n + unread('ch:' + c.id), 0) : 0;
      const fh = h('div', { class: 'ch-folder' + (shut ? ' shut' : ''), 'data-folder': f.id, onclick: () => {
        C.collapsed[f.id] = !shut;
        store.set('chatCollapsed', C.collapsed);
        renderChatSide();
      } },
        h('span', { class: 'caret', html: I.down }),
        h('span', { class: 'ch-name' }, f.name),
        total ? h('span', { class: 'badge' }, total) : null,
        h('button', { class: 'ch-more', 'aria-label': 'Folder options', html: I.more, onclick: (e) => { e.stopPropagation(); folderMenu(f, e.currentTarget, fh); } })
      );
      out.push(fh);
      // A closed folder still shows the open feed and any with unread messages.
      for (const ch of inside) {
        const v = 'ch:' + ch.id;
        if (shut && v !== C.view && !unread(v)) continue;
        const r = chanRow(v, ch.name);
        r.classList.add('in');
        out.push(r);
      }
      if (!inside.length && !shut) out.push(h('div', { class: 'ch-empty in' }, 'No feeds yet'));
    }
    C.side.replaceChildren(...out);
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

  // ---------- agents: your own, on your own API key ----------
  const G = { open: store.get('agentOpen', null), view: null };
  const agentById = (id) => id && G.data?.agents.find((a) => a.id === id);
  async function loadAgents() {
    try {
      G.data = await api('GET', '/agents');
    } catch (e) {
      toast(e.message);
    }
  }
  function openAgent(id) {
    G.open = id;
    store.set('agentOpen', id);
    G.view = null;
    if (S.tab !== 'agents') setTab('agents');
    else renderAgents();
  }
  function agentUpdated(a) {
    if (!G.data) return;
    const i = G.data.agents.findIndex((x) => x.id === a.id);
    const was = G.data.agents[i];
    if (i >= 0) G.data.agents[i] = a;
    else G.data.agents.push(a);
    // A routine that ran on its own finished: say so unless it's on screen.
    const last = a.thread.at(-1);
    if (was?.status === 'running' && a.status === 'idle' && last?.trigger === 'schedule' && !(S.tab === 'agents' && G.open === a.id && !document.hidden)) {
      const title = `${a.name} finished`;
      const body = last.error || (last.actions?.length ? `${plural(last.actions.length, 'change')}. ` : '') + plainText(last.text || '').slice(0, 120);
      toast(`${title}: ${body}`, { label: 'Show', run: () => openAgent(a.id) });
      if (S.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(title, { body, icon: '/icon-128.png' });
          n.onclick = () => { window.focus(); openAgent(a.id); };
        } catch {}
      }
    }
    if (S.tab === 'agents') renderAgents();
  }

  async function renderAgents() {
    const root = $('#agents');
    if (!S.workspace) return;
    if (!G.data) {
      root.replaceChildren(h('p', { class: 'day-hint camp-empty' }, 'Loading…'));
      await loadAgents();
      if (!G.data) return;
    }
    const a = agentById(G.open);
    if (a && G.view?._id === a.id) return G.view._update(a); // keep what's being typed
    G.view = a ? agentView(a) : null;
    root.replaceChildren(G.view || agentList());
  }

  // Replies use a little markdown: **bold**, lists and links.
  const agentHtml = (t) => linkify(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4} (.+)$/gm, '<b>$1</b>').replace(/^[-*] /gm, '• ');
  const providerName = (k) => G.data.providers[k] || k;
  const modelName = (a) => G.data.keys[a.provider]?.models.find((m) => m.id === a.model)?.name || a.model;
  const canText = (a) => [a.can.day && 'Day & tasks', a.can.campaigns && 'Campaigns', a.can.chat && 'Chat', a.can.web && 'Web'].filter(Boolean).join(', ') + (a.write ? '' : ' · look only');

  function agentList() {
    const keys = Object.keys(G.data.keys);
    const card = (a) => h('button', { class: 'camp-card c-violet', onclick: () => openAgent(a.id) },
      h('div', { class: 'cc-top' }, h('b', {}, a.name), a.status === 'running' ? h('span', { class: 'cc-pct' }, 'Working…') : null),
      h('div', { class: 'cc-sub' }, [modelName(a), a.auto && a.slots.length ? scheduleText(a) : 'On demand', a.lastRunAt ? 'ran ' + ago(a.lastRunAt) : ''].filter(Boolean).join(' · ')));
    return h('div', { class: 'camp-list' },
      h('div', { class: 'camp-h' }, h('b', {}, 'Agents'), h('span', { class: 'ag-head-btns' },
        h('button', { class: 'btn small', onclick: keysSheet }, 'API keys'),
        keys.length ? h('button', { class: 'btn small primary-btn', onclick: (e) => newAgentMenu(e.currentTarget) }, '+ New') : null)),
      !keys.length ? h('div', { class: 'ag-intro' },
        h('b', {}, 'Agents that help run your day and your campaigns'),
        h('p', {}, 'They plan your day around your meetings, keep tasks moving, and research and plan campaigns. They work inside Column with what you can see, and run when you ask or on a schedule.'),
        h('p', {}, 'They use your own API key from Anthropic (Claude), OpenAI or Google (Gemini), so usage is billed to you by that provider. Your key is stored encrypted and only your agents use it.'),
        h('button', { class: 'btn primary-btn', onclick: keysSheet }, 'Add an API key'))
        : G.data.agents.length ? G.data.agents.map(card)
        : h('p', { class: 'day-hint camp-empty' }, 'No agents yet. Start with a Day planner: it lays out your day each morning.'));
  }

  function newAgentMenu(anchor) {
    openMenu(anchor, Object.entries(G.data.presets).map(([k, p]) => ({ label: p.name, run: async () => {
      try {
        const a = await api('POST', '/agents', { preset: k, tz: myTz() });
        G.data.agents.push(a);
        openAgent(a.id);
        agentSheet(a);
      } catch (e) {
        toast(e.message);
      }
    } })));
  }

  function agentView(a) {
    const list = h('div', { class: 'ag-thread' });
    const status = h('div', { class: 'ag-status' });
    const meta = h('div', { class: 'camp-meta' });
    const input = h('textarea', { rows: 2, placeholder: `Ask ${a.name}…  e.g. “Plan my day”, “Research coffee shops in Austin for the outreach campaign”` });
    const send = async (text) => {
      if (!text.trim()) return;
      try {
        agentUpdated(await api('POST', `/agents/${a.id}/message`, { text }));
        input.value = '';
      } catch (e) {
        toast(e.message);
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(input.value);
      }
    });
    const sendBtn = h('button', { class: 'btn primary-btn', onclick: () => send(input.value) }, 'Send');
    const routineBtn = h('button', { class: 'btn small', onclick: () => api('POST', `/agents/${a.id}/run`).then(agentUpdated).catch((e) => toast(e.message)) }, 'Run routine');
    const title = h('b', { class: 'camp-name' });
    const view = h('div', { class: 'camp-view ag-view' },
      h('div', { class: 'camp-top' },
        h('button', { class: 'icon-btn', 'aria-label': 'All agents', html: I.back, onclick: () => openAgent(null) }),
        title,
        h('button', { class: 'icon-btn', 'aria-label': 'Agent options', html: I.more, onclick: (e) => openMenu(e.currentTarget, [
          { label: 'Settings…', run: () => agentSheet(agentById(a.id)) },
          { label: 'Memory…', run: () => notesSheet(agentById(a.id)) },
          { label: 'Clear conversation', run: () => api('POST', `/agents/${a.id}/clear`).then(agentUpdated).catch((er) => toast(er.message)) },
          { label: 'Delete agent', danger: true, run: () => api('DELETE', '/agents/' + a.id).then(() => { G.data.agents = G.data.agents.filter((x) => x.id !== a.id); openAgent(null); }).catch((er) => toast(er.message)) },
        ]) })),
      meta, list, status,
      h('div', { class: 'ag-compose' }, input, h('div', { class: 'ag-compose-btns' }, routineBtn, sendBtn)));
    view._id = a.id;
    view._update = (x) => {
      title.textContent = x.name;
      meta.replaceChildren(
        h('span', { class: 'pill' }, `${providerName(x.provider)} · ${modelName(x)}`),
        h('span', { class: 'pill' }, x.auto && x.slots.length ? scheduleText(x) : 'On demand'),
        h('span', { class: 'pill' }, canText(x)),
        h('button', { class: 'pill pill-btn', title: 'What it remembers between conversations', onclick: () => notesSheet(agentById(x.id)) }, x.notes.length ? `Memory · ${x.notes.length}` : 'Memory'));
      routineBtn.classList.toggle('hidden', !x.routine);
      routineBtn.disabled = sendBtn.disabled = x.status === 'running';
      list.replaceChildren(...(x.thread.length ? x.thread.map(agentMsg) : [h('p', { class: 'day-hint' }, x.routine ? `Message it, or press Run routine (“${x.routine}”).` : 'Message it to get started.')]));
      status.replaceChildren(...(x.status === 'running' ? [h('span', { class: 'ag-dots' }), (x.step || 'Thinking') + '…'] : []));
      list.scrollTop = list.scrollHeight;
    };
    view._update(a);
    setTimeout(() => (list.scrollTop = list.scrollHeight), 0);
    return view;
  }
  function agentMsg(m) {
    const label = m.trigger === 'schedule' ? 'On schedule' : m.trigger === 'routine' ? 'Routine' : null;
    if (m.role === 'user') return h('div', { class: 'ag-msg me' }, label ? h('small', {}, label) : null, h('div', { class: 'ag-bubble' }, m.text));
    return h('div', { class: 'ag-msg' },
      m.actions?.length ? h('ul', { class: 'ag-actions' }, m.actions.map((x) => h('li', {}, h('span', { html: I.check }), x))) : null,
      m.error ? h('div', { class: 'ag-bubble err' }, m.error) : h('div', { class: 'ag-bubble', html: agentHtml(m.text) }),
      h('small', {}, new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
  }

  function agentSheet(a) {
    const keys = G.data.keys;
    const name = h('input', { value: a.name });
    const provider = h('select', {}, Object.keys(keys).map((k) => h('option', { value: k }, providerName(k))));
    provider.value = a.provider;
    const model = h('select');
    const fillModels = () => {
      const ms = keys[provider.value]?.models || [];
      model.replaceChildren(...ms.map((m) => h('option', { value: m.id }, m.name)));
      model.value = provider.value === a.provider ? a.model : ms[0]?.id || '';
    };
    fillModels();
    provider.addEventListener('change', fillModels);
    const instructions = h('textarea', { rows: 5, placeholder: 'What it’s for and how you like things done.' });
    instructions.value = a.instructions;
    const routine = h('textarea', { rows: 2, placeholder: 'e.g. Plan my day.' });
    routine.value = a.routine;
    const can = {};
    const box = (k, label) => {
      can[k] = h('input', { type: 'checkbox' });
      can[k].checked = !!a.can[k];
      return h('label', { class: 'pick' }, can[k], label);
    };
    const write = h('input', { type: 'checkbox' });
    write.checked = !!a.write;
    const sched = slotEditor(a, 'Each time it runs its routine.');
    sheet('Agent settings', [
      h('label', {}, 'Name', name),
      h('div', { class: 'row2' }, h('label', {}, 'Provider', provider), h('label', {}, 'Model', model)),
      h('label', {}, 'Instructions', instructions),
      h('label', {}, 'Routine: what it does when it runs on its own', routine),
      h('div', { class: 'picks-h' }, 'It can work with'),
      h('div', { class: 'picks' }, box('day', 'My day & tasks'), box('campaigns', 'Campaigns'), box('chat', 'Post in chat'), box('web', 'Search the web')),
      h('label', { class: 'pick' }, write, 'Let it make changes (otherwise it only looks and suggests)'),
      h('label', { class: 'pick' }, sched.auto, 'Run its routine on a schedule'),
      sched.box,
    ], async () => {
      agentUpdated(await api('PATCH', '/agents/' + a.id, {
        name: name.value, provider: provider.value, model: model.value, instructions: instructions.value, routine: routine.value,
        can: Object.fromEntries(Object.entries(can).map(([k, el]) => [k, el.checked])), write: write.checked, tz: myTz(), ...sched.value(),
      }));
    });
  }

  // What an agent keeps between conversations. It adds notes itself; you can edit or remove any.
  function notesSheet(a) {
    const list = h('div', { class: 'ag-notes' });
    const row = (n) => {
      const t = h('textarea', { rows: 2, maxlength: 400, placeholder: 'e.g. I like calls before 11am' });
      t.value = n.text;
      const el = h('div', { class: 'ag-note' }, t, h('button', { type: 'button', class: 't-btn', 'aria-label': 'Remove note', html: I.close, onclick: () => el.remove() }));
      el._id = n.id;
      el._text = () => t.value;
      if (n.by === 'agent') el.append(h('small', {}, `Saved by ${a.name}${n.at ? ' · ' + ago(n.at) : ''}`));
      return el;
    };
    list.append(...a.notes.map(row));
    const add = h('button', { type: 'button', class: 'btn small ag-add-note', onclick: () => {
      if (list.children.length >= 40) return toast('That’s the most it can keep (40).');
      const el = row({ text: '' });
      list.append(el);
      el.querySelector('textarea').focus();
    } }, '+ Add a note');
    sheet(`${a.name}’s memory`, [
      h('p', { class: 'day-hint' }, 'Notes it keeps between conversations and reads every time it runs. It saves things it learns on its own; you can add, change or remove any. Clearing the conversation keeps these.'),
      list, add,
    ], async () => {
      agentUpdated(await api('PATCH', '/agents/' + a.id, { notes: [...list.children].map((el) => ({ id: el._id, text: el._text() })) }));
    });
  }

  function keysSheet() {
    const rows = Object.entries(G.data.providers).map(([k, label]) => {
      const row = h('div', { class: 'srow' });
      const draw = () => {
        const saved = G.data.keys[k];
        const input = h('input', { type: 'password', placeholder: 'Paste your API key', autocomplete: 'off' });
        const save = h('button', { class: 'btn small primary-btn' }, 'Save');
        save.addEventListener('click', async () => {
          save.disabled = true;
          save.textContent = 'Checking…';
          try {
            G.data = { ...G.data, ...(await api('PUT', '/agents/keys/' + k, { key: input.value })) };
            draw();
            if (S.tab === 'agents') renderAgents();
          } catch (e) {
            toast(e.message);
            save.disabled = false;
            save.textContent = 'Save';
          }
        });
        const remove = h('button', { class: 'btn small danger' }, 'Remove');
        remove.addEventListener('click', () => confirmClick(remove, async () => {
          G.data = { ...G.data, ...(await api('DELETE', '/agents/keys/' + k).catch((e) => toast(e.message))) };
          draw();
          if (S.tab === 'agents') renderAgents();
        }));
        row.replaceChildren(
          h('span', {}, label, h('small', {}, saved ? `Saved ····${saved.last4} · ${plural(saved.models.length, 'model')}` : 'Not added')),
          saved ? remove : h('span', { class: 'ag-key' }, input, save));
      };
      draw();
      return row;
    });
    sheet('API keys', [
      h('small', { class: 'day-hint' }, 'Your agents use your own key, and the provider bills you for what they use. Keys are stored encrypted on your team’s server and never sent back to the app. Get one from console.anthropic.com, platform.openai.com or aistudio.google.com.'),
      ...rows,
    ], async () => {}, 'Done');
  }

  // ----- connected calendars (each person's own) -----
  const CAL_NAMES = { google: 'Google Calendar', microsoft: 'Outlook' };
  const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function loadCalendars() {
    try {
      S.cals = await api('GET', '/calendars');
    } catch {
      return;
    }
    const box = $('#settings .cal-sec');
    if (box) box.replaceWith(calendarSection());
  }
  // ---------- brand & culture: set by team owners; brands the app and guides every agent ----------
  const isOwner = () => S.workspace.members.find((x) => x.id === S.me?.memberId)?.role === 'owner';
  function applyBrand() {
    const b = S.workspace?.brand;
    const root = document.documentElement.style;
    if (b?.accent) {
      // Very light brand colours are deepened so white text on them stays readable.
      const n = parseInt(b.accent.slice(1), 16);
      const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
      root.setProperty('--accent', lum > 0.6 ? `color-mix(in srgb, ${b.accent} 70%, #000)` : b.accent);
      root.setProperty('--accent-soft', `color-mix(in srgb, ${b.accent} 15%, transparent)`);
    } else {
      root.removeProperty('--accent');
      root.removeProperty('--accent-soft');
    }
    const logo = $('#wsLogo');
    logo.classList.toggle('hidden', !b?.logo);
    if (b?.logo && logo.getAttribute('src') !== b.logo) logo.src = b.logo;
  }

  function brandSection() {
    const b = S.workspace.brand;
    const owner = isOwner();
    const set = b.mission || b.values || b.tone || b.about || b.colors.length || b.logo;
    const sec = h('section', {}, h('h3', {}, 'Brand & culture'));
    if (set) {
      sec.append(h('div', { class: 'brand-sum' },
        b.logo ? h('img', { class: 'brand-logo', src: b.logo, alt: '' }) : null,
        h('div', { class: 'brand-txt' },
          b.mission ? h('p', { class: 'brand-mission' }, b.mission) : h('p', {}, 'No mission statement yet.'),
          b.colors.length ? h('div', { class: 'brand-sw' }, b.colors.map((x) => h('span', { class: 'brand-dot' + (x.hex === b.accent ? ' on' : ''), style: `background:${x.hex}`, title: (x.name ? x.name + ' ' : '') + x.hex + (x.hex === b.accent ? ' · app colour' : '') }))) : null)));
    } else {
      sec.append(h('p', {}, owner
        ? 'Set your mission, values, tone of voice, logo and colours. Every agent on the team follows them, and your logo and colour brand Column for everyone.'
        : 'Your team owner hasn’t set the brand up yet.'));
    }
    if (owner || set) sec.append(h('button', { class: 'btn', onclick: brandSheet }, owner ? (set ? 'Edit brand & culture' : 'Set up brand & culture') : 'View all'));
    return sec;
  }

  function brandSheet() {
    const b = S.workspace.brand;
    const owner = isOwner();
    const area = (v, rows, placeholder) => {
      const t = h('textarea', { rows, placeholder, ...(owner ? {} : { readonly: '' }) });
      t.value = v || '';
      return t;
    };
    const mission = area(b.mission, 2, 'Why the business exists, in a sentence or two.');
    const values = area(b.values, 4, 'One per line, e.g.\nCustomers first: we call back the same day\nNo jargon');
    const tone = area(b.tone, 4, 'How you sound. e.g. Warm and direct. Short sentences. Never pushy. We say “we”, not “the company”.');
    const about = area(b.about, 4, 'What you sell, who to, where, and what makes you different.');

    // Logo uploads straight away; everything else saves with the button.
    const logoImg = h('img', { class: 'brand-logo big' + (b.logo ? '' : ' hidden'), alt: '' });
    if (b.logo) logoImg.src = b.logo;
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', class: 'hidden' });
    const rmLogo = h('button', { type: 'button', class: 'btn small danger' + (b.logo ? '' : ' hidden') }, 'Remove');
    const upLogo = h('button', { type: 'button', class: 'btn small', onclick: () => file.click() }, b.logo ? 'Replace' : 'Upload logo');
    const showLogo = (w) => {
      S.workspace = w;
      applyBrand();
      const l = w.brand.logo;
      logoImg.classList.toggle('hidden', !l);
      if (l) logoImg.src = l;
      rmLogo.classList.toggle('hidden', !l);
      upLogo.textContent = l ? 'Replace' : 'Upload logo';
    };
    file.addEventListener('change', () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      if (f.size > 2_000_000) return toast('Keep the logo under 2 MB.');
      const r = new FileReader();
      r.onload = () => api('PUT', '/brand/logo', { data: r.result }).then(showLogo).catch((e) => toast(e.message));
      r.readAsDataURL(f);
    });
    rmLogo.addEventListener('click', () => confirmClick(rmLogo, () => api('DELETE', '/brand/logo').then(showLogo).catch((e) => toast(e.message))));

    // Brand colours, and which one (if any) becomes the app's accent.
    let colors = b.colors.map((x) => ({ ...x }));
    let accent = b.accent;
    const list = h('div', { class: 'brand-colors' });
    const accentSel = h('select');
    const drawColors = () => {
      list.replaceChildren(...colors.map((x, i) => {
        const pick = h('input', { type: 'color', value: x.hex, ...(owner ? {} : { disabled: '' }) });
        const name = h('input', { value: x.name, placeholder: 'Name, e.g. Navy', ...(owner ? {} : { readonly: '' }) });
        pick.addEventListener('input', () => {
          if (accent === x.hex) accent = pick.value;
          x.hex = pick.value;
          drawAccent();
        });
        name.addEventListener('input', () => { x.name = name.value; drawAccent(); });
        return h('div', { class: 'brand-color' }, pick, name, h('code', {}, x.hex), owner ? h('button', { type: 'button', class: 't-btn', 'aria-label': 'Remove colour', html: I.close, onclick: () => {
          if (accent === x.hex) accent = null;
          colors.splice(i, 1);
          drawColors();
        } }) : null);
      }), ...(owner && colors.length < 8 ? [h('button', { type: 'button', class: 'btn small', onclick: () => { colors.push({ hex: '#6b5cf0', name: '' }); drawColors(); } }, '+ Add colour')] : []));
      drawAccent();
    };
    const drawAccent = () => {
      accentSel.replaceChildren(h('option', { value: '' }, 'Column’s default'), ...colors.map((x) => h('option', { value: x.hex }, (x.name || 'Colour') + ' ' + x.hex)));
      accentSel.value = colors.some((x) => x.hex === accent) ? accent : '';
      accentSel.disabled = !owner;
    };
    accentSel.addEventListener('change', () => { accent = accentSel.value || null; });
    drawColors();

    sheet('Brand & culture', [
      h('p', { class: 'day-hint' }, owner
        ? 'Every agent on the team writes and plans with this. Mission, values and tone go into everything they do; the rest they look up when a task needs it.'
        : 'Set by your team owner. Every agent on the team follows it.'),
      h('label', {}, 'Logo', h('div', { class: 'brand-logo-row' }, logoImg, owner ? h('span', { class: 'btns' }, upLogo, rmLogo, file) : (b.logo ? null : h('small', {}, 'None yet')))),
      h('label', {}, 'Mission statement', mission),
      h('label', {}, 'Core values', values),
      h('label', {}, 'Tone of voice', tone),
      h('label', {}, 'About the business', about),
      h('label', {}, 'Brand colours', list),
      h('label', {}, 'App colour', accentSel, h('small', {}, 'Buttons, links and highlights in Column, for everyone on the team.')),
    ], async () => {
      if (!owner) return;
      S.workspace = await api('PATCH', '/brand', { mission: mission.value, values: values.value, tone: tone.value, about: about.value, colors, accent });
      applyBrand();
      if (!$('#settings').classList.contains('hidden')) renderSettings();
    }, owner ? 'Save' : 'Close');
  }

  function calendarSection() {
    const sec = h('section', { class: 'cal-sec' }, h('h3', {}, 'Calendars'));
    const c = S.cals;
    if (!c) {
      sec.append(h('p', { class: 'day-hint' }, 'Loading…'));
      return sec;
    }
    for (const conn of c.connections) {
      const synced = conn.error ? h('small', { class: 'err' }, conn.error) : h('small', {}, conn.lastSync ? `Synced ${ago(conn.lastSync)}` : 'Syncing…');
      const sync = h('button', { class: 'btn small' }, 'Sync now');
      sync.addEventListener('click', async () => {
        sync.disabled = true;
        await api('POST', `/calendars/${conn.id}/sync`).catch((e) => toast(e.message));
        loadCalendars();
      });
      const del = h('button', { class: 'btn small danger' }, 'Disconnect');
      del.addEventListener('click', () => confirmClick(del, () => api('DELETE', '/calendars/' + conn.id).then(loadCalendars).catch((e) => toast(e.message))));
      const shows = conn.calendars.map((cal) => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = cal.on;
        cb.addEventListener('change', () => api('PATCH', '/calendars/' + conn.id, { on: { [cal.id]: cb.checked } }).then(loadCalendars).catch((e) => toast(e.message)));
        return h('label', { class: 'pick' }, cb, cal.name);
      });
      const write = h('select', {}, h('option', { value: '' }, 'Don’t add them'), conn.calendars.filter((x) => x.canWrite).map((x) => h('option', { value: x.id }, x.name)));
      write.value = conn.writeCalId || '';
      write.addEventListener('change', () => api('PATCH', '/calendars/' + conn.id, { writeCalId: write.value || null }).then(loadCalendars).catch((e) => toast(e.message)));
      sec.append(h('div', { class: 'cal-conn' },
        h('div', { class: 'srow' }, h('span', {}, `${CAL_NAMES[conn.provider]} · ${conn.account}`, synced), h('span', { class: 'cal-btns' }, sync, del)),
        h('div', { class: 'picks-h' }, 'Show in my Day'),
        h('div', { class: 'picks' }, shows),
        h('div', { class: 'srow' }, h('span', {}, 'Add blocks I make in Column to', h('small', {}, 'Blocks with a start and end time. Edits and deletes follow both ways.')), write)));
    }
    const ready = Object.entries(c.providers).filter(([, on]) => on);
    if (ready.length) {
      sec.append(h('div', { class: 'cal-add' }, ready.map(([k]) => h('button', { class: 'btn', onclick: async () => {
        try {
          const { url } = await api('POST', '/calendars/connect', { provider: k, tz: myTz() });
          window.open(url, '_blank');
          toast('Finish signing in in your browser. Your calendar shows up here when it’s done.');
        } catch (e) {
          toast(e.message);
        }
      } }, (c.connections.some((x) => x.provider === k) ? '+ Another ' : 'Connect ') + CAL_NAMES[k]))));
    } else sec.append(h('p', { class: 'day-hint' }, 'Calendar sign-in isn’t set up on this server yet. See “Calendars” in the README.'));
    sec.append(h('p', { style: 'margin-top:8px;font-size:11.5px' }, 'Only you see events from your calendars. Your team sees what you add in Column as usual.'));
    return sec;
  }

  function renderSettings() {
    const s = $('#settings');
    const ws = S.workspace;
    s.innerHTML = '';
    s.append(h('h2', {}, 'Settings', h('button', { class: 'icon-btn', html: I.close, 'aria-label': 'Close', onclick: () => s.classList.add('hidden') })));

    // Layout
    const seg = h('div', { class: 'seg' },
      h('button', { class: S.panes.length === 1 ? 'on' : null, onclick: () => { setPanes([S.panes[0] === 'files' ? 'all' : S.panes[0]]); renderSettings(); } }, 'One column'),
      h('button', { class: S.panes.length === 2 ? 'on' : null, onclick: () => { setPanes(['all', 'files']); renderSettings(); } }, 'Split into two')
    );
    s.append(h('section', {}, h('h3', {}, 'Layout'), seg,
      h('p', { style: 'margin-top:8px;font-size:11.5px' }, 'Use the tabs at the top of each column to switch what it shows: everything, files, or a stack.')));

    s.append(brandSection());

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

    s.append(calendarSection());
    loadCalendars();

    // This device
    const dev = h('section', {}, h('h3', {}, 'This device'));
    if ('Notification' in window) {
      dev.append(toggleRow('Notifications', 'When something arrives from another device, or a task or campaign is assigned to you', S.notify && Notification.permission === 'granted', async (on, input) => {
        if (on && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          if (p !== 'granted') { input.checked = false; toast('Notifications blocked by the system'); return; }
        }
        S.notify = on;
        store.set('notify', on);
      }));
    }
    if ('Notification' in window) {
      dev.append(toggleRow('Reminders', 'Notify me when a note or block on my day starts', S.remind && Notification.permission === 'granted', async (on, input) => {
        if (on && !(await askNotify())) { input.checked = false; return; }
        S.remind = on;
        store.set('remind', on);
      }));
    }
    if (desktop) {
      dev.append(
        toggleRow('Always on top', 'Keep the column above other windows', S.desktopCfg.alwaysOnTop, (on) => { S.desktopCfg.alwaysOnTop = on; desktop.setConfig({ alwaysOnTop: on }); }),
        toggleRow('Auto-save incoming files', 'Copy everything that arrives into Downloads/Column', S.desktopCfg.autoSave, (on) => { S.desktopCfg.autoSave = on; desktop.setConfig({ autoSave: on }); }),
        toggleRow('Open at login', null, S.desktopCfg.openAtLogin, (on) => { S.desktopCfg.openAtLogin = on; desktop.setConfig({ openAtLogin: on }); }),
        desktop.setNext && desktop.platform === 'darwin' ? toggleRow('Next event in menu bar', 'Show what’s on now or next beside the menu-bar icon', S.desktopCfg.trayNext !== false, (on) => { S.desktopCfg.trayNext = on; desktop.setConfig({ trayNext: on }); }) : null,
        h('div', { class: 'srow' }, h('span', {}, 'Show / hide', h('small', {}, desktop.platform === 'darwin' ? '⌘ ⇧ Space, or the menu bar icon' : 'Ctrl + Shift + Space, or the tray icon'))),
        h('div', { class: 'btns', style: 'margin-top:8px' },
          h('button', { class: 'btn', onclick: () => desktop.openFolder() }, 'Open Downloads/Column'),
          h('button', { class: 'btn', onclick: () => desktop.changeServer() }, 'Change server')
        )
      );
    }
    s.append(dev);

    // People
    const me = ws.members.find((x) => x.id === S.me.memberId);
    const owner = me?.role === 'owner';
    const onlineIds = new Set(S.online.map((d) => d.memberId));
    const peopleCall = (method, path, body) => api(method, path, body).then((w) => { S.workspace = w; renderSettings(); }).catch((e) => toast(e.message));
    const people = h('section', {}, h('h3', {}, `People · ${ws.members.length}`));
    const sorted = [...ws.members].sort((a, b) => (b.id === me?.id) - (a.id === me?.id) || a.name.localeCompare(b.name));
    for (const mb of sorted) {
      const you = mb.id === me?.id;
      const notes = [mb.role === 'owner' ? 'Owner' : 'Member', mb.hasPassword ? null : 'no password yet', onlineIds.has(mb.id) ? 'online' : null].filter(Boolean).join(' · ');
      const row = h('div', { class: 'srow person' },
        h('span', {}, h('span', { class: 'live' + (onlineIds.has(mb.id) ? ' on' : '') }), mb.name, you ? ' (you)' : '', h('small', {}, notes)));
      if (owner && !you) {
        row.append(h('button', { class: 'icon-btn', 'aria-label': 'Options for ' + mb.name, html: I.more, onclick: (e) => openMenu(e.currentTarget, [
          mb.role === 'owner'
            ? { label: 'Make member', run: () => peopleCall('PATCH', '/members/' + mb.id, { role: 'member' }) }
            : { label: 'Make owner', run: () => peopleCall('PATCH', '/members/' + mb.id, { role: 'owner' }) },
          { label: 'Reset password', danger: true, run: () => peopleCall('POST', `/members/${mb.id}/reset`).then(() => toast(`${mb.name} is signed out. They can set a new password with Join team.`)) },
          { label: 'Remove from team', danger: true, run: () => peopleCall('DELETE', '/members/' + mb.id) },
        ]) }));
      }
      people.append(row);
    }
    const inviteText = () => `Join “${ws.name}” on Column\n${location.origin}\nChoose Join team · Team: ${ws.name} · Invite code: ${ws.inviteCode}`;
    const newCode = h('button', { class: 'btn', 'data-label': '1', title: 'The old code stops working' }, ws.inviteCode ? 'New code' : 'Make an invite code');
    newCode.addEventListener('click', () => (ws.inviteCode ? confirmClick(newCode, () => peopleCall('POST', '/invite')) : peopleCall('POST', '/invite')));
    people.append(
      ws.inviteCode
        ? h('p', { style: 'margin-top:10px' }, 'Invite code: ', h('code', {}, ws.inviteCode))
        : h('p', { style: 'margin-top:10px' }, 'The old team passphrase works as the invite code.' + (owner ? ' Make a code to replace it.' : '')),
      h('p', {}, 'New people open ', h('code', {}, location.origin), ', choose ', h('b', {}, 'Join team'), ', and enter the team name and code. Removing someone signs them out; make a new code too if they still know it.'),
      h('div', { class: 'btns' },
        ws.inviteCode ? h('button', { class: 'btn', onclick: () => copyText(inviteText()) }, 'Copy invite') : null,
        owner ? newCode : null)
    );
    s.append(people);

    // Your password
    const cur = h('input', { type: 'password', placeholder: 'Current password', autocomplete: 'current-password' });
    const next = h('input', { type: 'password', placeholder: me?.hasPassword ? 'New password' : 'Choose a password', autocomplete: 'new-password' });
    const savePw = async () => {
      try {
        S.workspace = await api('POST', '/members/me/password', { current: cur.value, next: next.value });
        toast('Password saved');
        renderSettings();
      } catch (e) {
        toast(e.message);
      }
    };
    next.addEventListener('keydown', (e) => e.key === 'Enter' && savePw());
    s.append(h('section', {}, h('h3', {}, 'Your password'),
      me?.hasPassword ? null : h('p', { class: 'warn' }, 'You don’t have a password yet. Set one so you can sign in on new devices.'),
      me?.hasPassword ? h('div', { class: 'stack-row' }, cur) : null,
      h('div', { class: 'stack-row' }, next, h('button', { class: 'btn', onclick: savePw }, 'Save'))));

    // Account
    const devices = S.online.filter((d) => d.memberId === S.me.memberId).map((d) => `${d.device}${d.deviceId === S.deviceId ? ' (this)' : ''}`).join(', ');
    const clearBtn = h('button', { class: 'btn danger', 'data-label': '1' }, 'Clear unpinned items');
    clearBtn.addEventListener('click', () => confirmClick(clearBtn, () => api('POST', '/clear').then(() => toast('Cleared')).catch((e) => toast(e.message))));
    s.append(h('section', {}, h('h3', {}, 'Account'),
      h('p', {}, 'Signed in to ', h('b', {}, ws.name), ` as ${S.me.member} on ${S.me.device}.`),
      h('p', {}, 'Your devices online: ', devices || '—'),
      h('p', {}, 'To add another computer or phone, open ', h('code', {}, location.origin), ' and sign in with your name and password. On a phone, use “Add to Home Screen” to keep it as an app.'),
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
