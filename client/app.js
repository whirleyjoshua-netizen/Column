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
    doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
    grid: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>'),
    ask: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>'),
    stages: svg('<rect x="3" y="5" width="5" height="14" rx="1.5"/><rect x="10" y="5" width="5" height="9" rx="1.5"/><rect x="17" y="5" width="4" height="5" rx="1.5"/>'),
    side: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>'),
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
    if (ext(it.name) === 'DOCX' || m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (m.startsWith('text/') || /^(json|js|ts|css|html|md|csv|tsv|txt|log|py|sh|yml|yaml|xml)$/i.test(ext(it.name))) return 'textfile';
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
    // Files are cached as never changing, so an edited one gets a new address.
    return `${p}?t=${t()}${it.editedAt ? '&v=' + it.editedAt : ''}${dl ? '&dl=1' : ''}`;
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
      renderCamps();
      chatChanged();
      if (isNew && msg.item.deviceId !== S.deviceId) incoming(msg.item);
    } else if (msg.type === 'item:update') {
      upsert(msg.item);
      if (msg.item.id === VIEW_ID && !$('#preview .pv-edit')) openPreview(msg.item, { standalone: true });
      render();
      renderCamps();
      refreshLinks();
    } else if (msg.type === 'item:remove') {
      S.items = S.items.filter((x) => x.id !== msg.id);
      if (msg.id === VIEW_ID) openViewer();
      checkThread();
      render();
      renderCamps();
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
    } else if (msg.type === 'campaign' || msg.type === 'goal' || msg.type === 'attempt' || msg.type === 'list') {
      const list = { campaign: S.campaigns, goal: S.goals, attempt: S.attempts, list: S.lists }[msg.type];
      const x = msg[msg.type];
      const i = list.findIndex((y) => y.id === x.id);
      if (msg.type === 'campaign' && x.assigneeId === S.me?.memberId && list[i]?.assigneeId !== x.assigneeId && x.assignedBy !== S.me?.memberId) assignedToMe(x, 'campaign');
      if (i >= 0) list[i] = x;
      else list.push(x);
      renderCamps();
      renderDay();
      refreshLinks();
    } else if (msg.type === 'campaign:remove' || msg.type === 'goal:remove' || msg.type === 'attempt:remove' || msg.type === 'list:remove') {
      const key = { 'campaign:remove': 'campaigns', 'goal:remove': 'goals', 'attempt:remove': 'attempts', 'list:remove': 'lists' }[msg.type];
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
    } else if (msg.type === 'calendars') {
      if (!$('#settings').classList.contains('hidden')) loadCalendars();
    } else if (msg.type === 'meeting' || msg.type === 'meeting:remove') {
      const was = (S.meetings || []).find((x) => x.id === (msg.meeting?.id || msg.id));
      S.meetings = (S.meetings || []).filter((x) => x.id !== (msg.meeting?.id || msg.id));
      if (msg.meeting) S.meetings.unshift(msg.meeting);
      if (msg.meeting?.status === 'ready' && was?.status !== 'ready') toast('Meeting notes are ready', { label: 'Review', run: () => meetingSheet(msg.meeting) });
      renderRec();
      renderTool();
    } else if (msg.type === 'bill' || msg.type === 'bill:remove') {
      S.bills = S.bills.filter((x) => x.id !== (msg.bill?.id || msg.id));
      if (msg.type === 'bill') S.bills.push(msg.bill);
      renderDay();
      renderTool();
    } else if (msg.type === 'pss') {
      loadPss();
    } else if (msg.type === 'mail') {
      loadPss();
    } else if (msg.type === 'send' && S.mail) {
      S.mail.sends = [msg.send, ...S.mail.sends.filter((x) => x.id !== msg.send.id)];
      renderCamps();
      renderTool();
    } else if (msg.type === 'send:remove' && S.mail) {
      S.mail.sends = S.mail.sends.filter((x) => x.id !== msg.id);
      renderCamps();
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

  // Column was updated on the server: reload into the new version, now if nothing's being typed, else when asked.
  let updateOffered = false;
  function newVersion() {
    const typing = document.activeElement?.matches?.('input, textarea, [contenteditable]') && document.activeElement.value !== '';
    if (document.hidden || !typing) return location.reload();
    if (updateOffered) return;
    updateOffered = true;
    toast('Column was updated', { label: 'Reload', run: () => location.reload() });
    // Otherwise it reloads the next time the window is hidden.
    document.addEventListener('visibilitychange', () => document.hidden && location.reload());
  }

  async function loadState() {
    const st = await api('GET', '/state');
    if (st.version && S.version && st.version !== S.version) return newVersion();
    S.version ||= st.version;
    S.workspace = st.workspace;
    S.me = st.me;
    S.items = st.items;
    S.entries = st.entries || [];
    S.tasks = st.tasks || [];
    S.campaigns = st.campaigns || [];
    S.goals = st.goals || [];
    S.attempts = st.attempts || [];
    S.lists = st.lists || [];
    S.templates = st.templates || [];
    S.bills = st.bills || [];
    api('GET', '/meetings').then((x) => { S.meetings = x; renderRec(); }).catch(() => {});
    loadPss();
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
    if (VIEW_ID) {
      openViewer();
      return connect();
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
  // standalone: the whole page is this file (a window of its own), so there's nothing to close back to.
  function openPreview(it, { standalone = false } = {}) {
    const pv = $('#preview');
    pv.innerHTML = '';
    const k = kind(it);
    const close = () => { pv.classList.add('hidden'); pv.innerHTML = ''; };
    pv.onclick = (e) => { if (e.target === pv && !standalone) close(); };
    if (!standalone) pv.append(h('button', { class: 'icon-btn close', html: I.close, onclick: close, 'aria-label': 'Close' }));
    if (k === 'image') pv.append(h('img', { src: fileUrl(it), alt: it.name }));
    else if (k === 'video') pv.append(h('video', { src: fileUrl(it), controls: true, autoplay: true, playsinline: true }));
    else if (k === 'audio') pv.append(h('div', { style: 'color:#fff;font-size:15px' }, it.name), h('audio', { src: fileUrl(it), controls: true, autoplay: true }));
    else if (k === 'pdf') pv.append(h('iframe', { src: fileUrl(it) }));
    else if (k === 'text') pv.append(h('pre', { html: linkify(it.text) }));
    else if (k === 'docx') {
      const box = h('div', { class: 'docx' }, 'Loading…');
      pv.append(box);
      fetch(fileUrl(it)).then((r) => r.arrayBuffer()).then(renderDocx).then((doc) => box.replaceChildren(...doc.childNodes))
        .catch(() => box.replaceChildren('Couldn’t read this document. Download it to open it in Word.'));
    }
    else if (k === 'textfile') {
      const pre = h('pre', {}, 'Loading…');
      pv.append(pre);
      fetch(fileUrl(it)).then((r) => r.text()).then((txt) => {
        pre.textContent = txt.slice(0, 500_000);
        if (it.size <= 500_000) $('.pv-bar', pv)?.prepend(editText(it, pre, txt));
      }).catch(() => (pre.textContent = 'Could not load'));
    } else if (k === 'folder') {
      pv.append(h('div', { class: 'flist' }, it.files.map((f) =>
        h('a', { href: fileUrl(it, { idx: f.i, dl: true }), download: f.relPath.split('/').pop() }, h('span', {}, f.relPath), h('small', {}, fmtSize(f.size)))
      )));
    } else {
      pv.append(h('div', { style: 'color:#fff;text-align:center' }, h('div', { style: 'font-size:40px;font-weight:700;opacity:.5' }, ext(it.name) || 'FILE'), it.name, h('br'), fmtSize(it.size)));
    }
    pv.append(h('div', { class: 'pv-bar' },
      it.type !== 'text' ? h('span', {}, it.name) : null,
      standalone ? null : campOfItem(it) && it.type === 'file'
        ? h('button', { class: 'btn', title: 'Keep it open beside the campaign', onclick: () => { close(); dockOpen(campOfItem(it), { type: 'file', id: it.id }); } }, 'Keep beside')
        : h('button', { class: 'btn', title: 'Keep it open next to Column', onclick: () => { close(); popOut(it); } }, 'Open in new window'),
      !standalone && campOfItem(it) && it.type === 'file' ? h('button', { class: 'btn', onclick: () => { close(); useSheet(campOfItem(it), it); } }, 'Use as…') : null,
      it.type !== 'text' ? h('button', { class: 'btn', onclick: () => download(it) }, it.type === 'folder' ? 'Download all (.zip)' : 'Download') : null));
    pv.classList.remove('hidden');
  }
  // A file in a window of its own, e.g. your call script beside the call list. Each file gets one window.
  function popOut(it) {
    const w = window.open('/?view=' + encodeURIComponent(it.id), 'column-view-' + it.id, 'popup,width=760,height=900');
    if (!w) toast('Your browser blocked the window. Allow pop-ups for Column and try again.');
  }
  // This page is a popped-out file (/?view=<id>): show just that file, kept up to date.
  const VIEW_ID = new URLSearchParams(location.search).get('view');
  function openViewer() {
    document.body.classList.add('viewer');
    $('#login').classList.add('hidden');
    const it = S.items.find((x) => x.id === VIEW_ID);
    document.title = it ? `${it.name || 'Note'} · Column` : 'Column';
    if (it) openPreview(it, { standalone: true });
    else {
      const pv = $('#preview');
      pv.replaceChildren(h('p', { class: 'day-hint' }, 'This file isn’t available any more.'));
      pv.classList.remove('hidden');
    }
  }
  // A Word document as readable HTML: paragraphs, headings, bold/italic/underline, lists, tables and links.
  // Read only. It's built from elements, never from the file's own markup, so a document can't run anything.
  async function renderDocx(buf) {
    const z = unzip(buf);
    const read = async (name) => (z[name] ? new DOMParser().parseFromString(await z[name](), 'application/xml') : null);
    const [doc, rels, numbering] = await Promise.all([read('word/document.xml'), read('word/_rels/document.xml.rels'), read('word/numbering.xml')]);
    const body = doc?.getElementsByTagNameNS('*', 'body')[0];
    if (!body) throw new Error('Not a Word document');
    const kids = (el, tag) => (el ? [...el.children].filter((c) => c.localName === tag) : []);
    const val = (el) => el?.getAttribute('w:val') ?? null;
    const all = (doc, tag) => (doc ? [...doc.getElementsByTagNameNS('*', tag)] : []);
    const links = new Map(all(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
    // Bullet or numbered: numId → its abstract numbering → that level's format.
    const listFmt = (numId, lvl) => {
      const abs = val(kids(all(numbering, 'num').find((n) => n.getAttribute('w:numId') === numId), 'abstractNumId')[0]);
      const def = all(numbering, 'abstractNum').find((a) => a.getAttribute('w:abstractNumId') === abs);
      return val(kids(kids(def, 'lvl').find((l) => l.getAttribute('w:ilvl') === String(lvl)), 'numFmt')[0]);
    };
    const on = (rPr, tag) => {
      const e = kids(rPr, tag)[0];
      return !!e && !/^(0|false|none)$/.test(val(e) || '');
    };
    const runs = (el, out) => {
      for (const c of el.children) {
        if (c.localName === 'r') {
          let node = document.createDocumentFragment();
          for (const x of c.children) {
            if (x.localName === 't') node.append(x.textContent);
            else if (x.localName === 'tab') node.append('\t');
            else if (x.localName === 'br' || x.localName === 'cr') node.append(h('br'));
          }
          const rPr = kids(c, 'rPr')[0];
          for (const [tag, wrap] of [['b', 'b'], ['i', 'i'], ['u', 'u'], ['strike', 's']]) if (on(rPr, tag)) node = h(wrap, {}, node);
          out.append(node);
        } else if (c.localName === 'hyperlink') {
          const href = links.get(c.getAttribute('r:id')) || '';
          const a = /^(https?:|mailto:|tel:)/i.test(href) ? h('a', { href, target: '_blank', rel: 'noopener' }) : h('span');
          runs(c, a);
          out.append(a);
        } else if (['ins', 'smartTag', 'fldSimple', 'sdt', 'sdtContent'].includes(c.localName)) runs(c, out);
      }
    };
    const blocks = (parent, into) => {
      let list = null;
      for (const c of parent.children) {
        if (c.localName === 'p') {
          const pPr = kids(c, 'pPr')[0];
          const head = /^(Title|Heading([1-6]))$/i.exec(val(kids(pPr, 'pStyle')[0]) || '');
          const el = h(head ? (head[2] ? 'h' + Math.min(6, +head[2] + 1) : 'h1') : 'p');
          const align = val(kids(pPr, 'jc')[0]);
          if (align === 'center' || align === 'right') el.style.textAlign = align;
          runs(c, el);
          const num = kids(pPr, 'numPr')[0];
          if (num) {
            const lvl = Number(val(kids(num, 'ilvl')[0])) || 0;
            const ordered = listFmt(val(kids(num, 'numId')[0]), lvl) !== 'bullet';
            if (!list || list.ordered !== ordered) into.append((list = { ordered, el: h(ordered ? 'ol' : 'ul') }).el);
            const li = h('li', {}, ...el.childNodes);
            if (lvl) li.style.marginLeft = lvl * 1.5 + 'em';
            list.el.append(li);
            continue;
          }
          list = null;
          // An empty paragraph is a blank line.
          into.append(el.childNodes.length ? el : h('p', {}, h('br')));
        } else if (c.localName === 'tbl') {
          list = null;
          into.append(h('table', {}, kids(c, 'tr').map((tr) => h('tr', {}, kids(tr, 'tc').map((tc) => {
            const td = h('td');
            blocks(tc, td);
            return td;
          })))));
        } else if (c.localName === 'sdt') {
          list = null;
          blocks(kids(c, 'sdtContent')[0] || c, into);
        }
      }
    };
    const out = h('div');
    blocks(body, out);
    return out;
  }

  // Edit a text file in place. If it's a campaign's call list, the list follows the edit.
  function editText(it, pre, txt) {
    const ta = h('textarea', { class: 'pv-edit', spellcheck: 'false' });
    const btn = h('button', { class: 'btn' }, 'Edit');
    btn.onclick = async () => {
      if (!ta.isConnected) {
        ta.value = txt;
        pre.replaceWith(ta);
        ta.focus();
        btn.textContent = 'Save';
        return;
      }
      btn.disabled = true;
      try {
        upsert(await put('/api/files/' + it.id, new Blob([ta.value]), () => {}));
        const l = S.lists.find((x) => x.itemId === it.id);
        if (l) await syncList(l, new File([ta.value], it.name, { type: it.mime }));
        toast(l ? 'Saved · call list updated' : 'Saved');
        txt = pre.textContent = ta.value;
        ta.replaceWith(pre);
        btn.textContent = 'Edit';
      } catch (er) {
        toast(er.message);
      }
      btn.disabled = false;
    };
    return btn;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#sheet').classList.contains('hidden')) closeSheet();
      else if (!$('#preview').classList.contains('hidden') && !VIEW_ID) { $('#preview').classList.add('hidden'); $('#preview').innerHTML = ''; }
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
    document.querySelectorAll('.dropping').forEach((p) => p.classList.remove('dropping'));
  }
  // An open campaign takes the drop itself: files go to its stack, and lists become call lists.
  const dropCampaign = () => S.tab === 'camps' && campById(K.open);
  window.addEventListener('dragenter', (e) => {
    if (S.internalDrag || !S.token) return;
    if (S.tab === 'day' && hasFiles(e.dataTransfer)) setTab('column');
    dragDepth++;
    e.preventDefault();
  });
  window.addEventListener('dragover', (e) => {
    if (S.internalDrag || !S.token) return;
    e.preventDefault();
    if (dropCampaign()) return $('#camps').classList.add('dropping');
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
    const dt = e.dataTransfer;
    const camp = dropCampaign();
    if (camp) {
      if (!hasFiles(dt)) return;
      const entries = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
      if (!entries.length) return [...dt.files].forEach((f) => queue(() => addToCampaign(camp, f)));
      for (const entry of entries) {
        if (entry.isDirectory) {
          const files = await walk(entry, '');
          queue(() => uploadFolder(entry.name, files, { stackId: camp.stackId }));
        } else {
          const f = await new Promise((res, rej) => entry.file(res, rej));
          queue(() => addToCampaign(camp, f));
        }
      }
      return;
    }
    const pane = paneAt(e.target);
    const view = pane?._view || 'all';
    const dest = destOf(view);
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
    let item;
    try {
      const progress = (n) => { u.loaded = n; updateUpload(u); };
      const qs = new URLSearchParams({ name: file.name, type: file.type || '', ...(dest.stackId ? { stackId: dest.stackId } : {}), ...(dest.channelId ? { channelId: dest.channelId } : {}) });
      item = file.size > CHUNK
        ? await putResumable(file, { name: file.name, type: file.type || '', stackId: dest.stackId || null, channelId: dest.channelId || null }, progress, u)
        : await put('/api/upload?' + qs, file, progress);
      upsert(item);
    } finally {
      S.uploads.delete(u.key);
      render();
    }
    return item;
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
    $('#campsWrap').classList.toggle('hidden', tab !== 'camps');
    if (tab === 'camps') renderCamps();
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
    const bills = billsDueOn(k);
    if (due.length || bills.length) {
      const late = due.filter(isOverdue);
      parts.push(h('div', { class: 'anytime tasks' }, h('div', { class: 'any-h' }, 'Due', late.length ? moveToToday(late) : null), due.map(taskRow), bills.map(billDayRow)));
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
        isToday && !R.on && nowMin() >= b.start - 10 && nowMin() < b.end ? h('button', { class: 'b-rec', title: 'Record this meeting and get notes', onclick: (ev) => { ev.stopPropagation(); askRecord(b.text.split('\n')[0], b.id); } }, '● Record') : null,
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
    const list = listOfTask(t);
    const lp = list && listProgress(list, t.runId);
    const openList = () => {
      const key = 'task:' + t.id;
      if (inCampaign) {
        K.listOpen = K.listOpen === key ? null : key;
        return renderCamps();
      }
      K.listOpen = key;
      openCampaign(camp.id);
    };
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
      lp ? h('button', { class: 'list-chip' + (lp.of && lp.n === lp.of ? ' full' : ''), title: `${list.name}: ${lp.label} · click to open`, onclick: (ev) => { ev.stopPropagation(); openList(); } },
        h('span', { html: KIND_ICON[list.kind || 'calls'] }), lp.of ? `${lp.n}/${lp.of}` : '') : null,
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
  const K = { open: store.get('campOpen', null), mine: store.get('campsMine', false), logOpen: null, showAll: {}, stale: false, pick: null, listOpen: null, listShow: {}, listN: {}, dragList: null, logFrom: {}, book: null, dock: store.get('dock', null), dockSize: store.get('dockSize', 0.45), dockMin: false, refQ: {}, noteDraft: {}, runOpen: null, noteRow: null, answers: {}, askOpen: false, ansOpen: {}, lead: null, mailDraft: {}, sendHide: new Set(store.get('sendHide', [])) };
  const campById = (id) => id && S.campaigns?.find((c) => c.id === id);
  const goalById = (id) => id && S.goals?.find((g) => g.id === id);
  const goalsOf = (cid) => S.goals.filter((g) => g.campaignId === cid).sort((a, b) => (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt);
  const tasksOf = (gid) => S.tasks.filter((t) => t.goalId === gid);
  const listOfTask = (t) => t.listId && S.lists.find((l) => l.id === t.listId);
  // A list dragged onto a goal lives there, under its task, until the task is deleted.
  const onGoal = (l) => ['calls', 'tracker'].includes(l.kind || 'calls') && S.tasks.some((t) => t.listId === l.id && goalById(t.goalId)?.campaignId === l.campaignId);
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
    renderDock();
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

  // Weekly times: each row is some weekdays at a time. x: { auto, slots, tz }. Used by saved campaigns.
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
    const files = S.items.filter((it) => it.stackId === c.stackId && (it.type === 'file' || it.type === 'folder')).length;
    const notes = notesOf(c).length;
    const lists = listsOf(c.id).filter((l) => !onGoal(l));
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
        st ? h('button', { class: 'btn small', title: 'Open a file, add one, or go to the stack', onclick: (e) => filesMenu(e.currentTarget, c) }, `Files · ${files} ▾`) : null,
        st ? h('button', { class: 'btn small', title: 'Jot a quick note, or open one', onclick: (e) => notesMenu(e.currentTarget, c) }, `Notes · ${notes} ▾`) : null,
        h('button', { class: 'btn small' + (K.logOpen === c.id ? ' on' : ''), onclick: () => openLog(c) }, 'Log'),
        h('button', { class: 'btn small', onclick: () => openReport(c) }, 'Write a report')),
      sendBars(c),
      h('div', { class: 'any-h camp-goals-h' }, 'Log'),
      logBox(c),
      lists.length ? h('div', { class: 'any-h camp-goals-h' }, 'Lists & docs') : null,
      lists.map((l) => listCard(c, l)),
      h('div', { class: 'any-h camp-goals-h' }, 'Goals'),
      goals.map((g) => goalCard(c, g)),
      h('div', { class: 'goal-btns' },
        h('button', { class: 'add-goal', onclick: () => goalSheet(c) }, '+ Add a goal'),
        h('button', { class: 'add-goal ai-btn', title: 'Draft goals and tasks from the brief', onclick: (e) => suggestPlan(c, e.currentTarget) }, '✨ Suggest from the brief')));
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
    if (tasks.length) el.append(h('div', { class: 'goal-tasks' }, tasks.flatMap((t) => {
      const l = listOfTask(t);
      const close = () => { K.listOpen = null; renderCamps(); };
      return [taskRow(t, { inCampaign: true }), l && K.listOpen === 'task:' + t.id ? h('div', { class: 'task-list' }, taskListBody(c, l, t, close)) : null];
    }).filter(Boolean)));
    el.append(add);
    el.addEventListener('dragover', (e) => {
      if (!K.dragList || K.dragList.campaignId !== c.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      el.classList.add('list-over');
    });
    el.addEventListener('dragleave', (e) => !el.contains(e.relatedTarget) && el.classList.remove('list-over'));
    el.addEventListener('drop', (e) => {
      const l = K.dragList;
      if (!l) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('list-over');
      listToGoal(l, g);
    });
    return el;
  }

  // ----- call lists: a spreadsheet of prospects dropped on a campaign -----
  // CSV, TSV and Excel files with rows become lists; anything else is just attached. The file stays in the stack.
  const LIST_MAX = 5000;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isPhone = (v) => /^\+?[\d\s().\-\/]+$/.test(v) && v.replace(/\D/g, '').length >= 7 && !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(v.trim());
  const listsOf = (cid) => S.lists.filter((l) => l.campaignId === cid).sort((a, b) => a.createdAt - b.createdAt);
  function upsertList(l) {
    const i = S.lists.findIndex((x) => x.id === l.id);
    if (i >= 0) S.lists[i] = l;
    else S.lists.push(l);
  }

  function parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    const line = text.slice(0, text.search(/\r?\n|$/));
    const d = ['\t', ',', ';'].sort((a, b) => line.split(b).length - line.split(a).length)[0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch !== '"') cell += ch;
        else if (text[i + 1] === '"') cell += text[++i];
        else q = false;
      } else if (ch === '"' && !cell) q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell || row.length) rows.push([...row, cell]);
    return rows;
  }

  // Just enough of zip to read a spreadsheet: the central directory, then inflate the parts asked for.
  function unzip(buf) {
    const dv = new DataView(buf);
    let end = buf.byteLength - 22;
    while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error('Not a zip file');
    const out = {};
    let p = dv.getUint32(end + 16, true);
    for (let n = dv.getUint16(end + 10, true); n > 0; n--) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), local = dv.getUint32(p + 42, true);
      const nameLen = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
      out[name] = () => {
        const data = new Uint8Array(buf, local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), size);
        if (method === 0) return Promise.resolve(new TextDecoder().decode(data));
        return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      };
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return out;
  }
  // The first sheet of an .xlsx, as rows of text.
  async function readXlsx(file) {
    const z = unzip(await file.arrayBuffer());
    const xml = async (name) => z[name] ? new DOMParser().parseFromString(await z[name](), 'application/xml') : null;
    const tags = (el, tag) => (el ? [...el.getElementsByTagNameNS('*', tag)] : []);
    const text = (el) => tags(el, 't').map((t) => t.textContent).join('');
    const [wb, rels, ss] = await Promise.all([xml('xl/workbook.xml'), xml('xl/_rels/workbook.xml.rels'), xml('xl/sharedStrings.xml')]);
    const relId = tags(wb, 'sheet')[0]?.getAttribute('r:id');
    const target = tags(rels, 'Relationship').find((r) => r.getAttribute('Id') === relId)?.getAttribute('Target');
    const sheet = await xml(target ? (target.startsWith('/') ? target.slice(1) : 'xl/' + target) : 'xl/worksheets/sheet1.xml');
    const strings = tags(ss, 'si').map(text);
    return tags(sheet, 'row').map((r) => {
      const row = [];
      for (const c of tags(r, 'c')) {
        const col = [...(c.getAttribute('r') || '').replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const v = tags(c, 'v')[0]?.textContent ?? '';
        const t = c.getAttribute('t');
        row[col >= 0 ? col : row.length] = t === 's' ? strings[+v] ?? '' : t === 'inlineStr' ? text(c) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
      }
      return [...row].map((x) => x ?? '');
    });
  }

  // { columns, rows: [{ cells }] }, or null when the file isn't a list.
  async function readList(file) {
    let rows;
    if (/\.xlsx$/i.test(file.name)) rows = await readXlsx(file);
    else if (/\.(csv|tsv)$/i.test(file.name) || /^text\/(csv|tab-separated-values)$/.test(file.type)) rows = parseDelimited(await file.text());
    else return null;
    rows = rows.map((r) => r.map((x) => String(x ?? '').trim())).filter((r) => r.some(Boolean));
    const width = Math.min(30, Math.max(0, ...rows.map((r) => r.map(Boolean).lastIndexOf(true) + 1)));
    if (!width || !rows.length) return null;
    // A first row that holds an email or phone number is a prospect, not headings.
    const header = !rows[0].some((x) => EMAIL_RE.test(x) || isPhone(x)) && rows.length > 1;
    const columns = header ? rows[0].slice(0, width).map((x, i) => x || `Column ${i + 1}`) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    const data = rows.slice(header ? 1 : 0).map((r) => ({ cells: columns.map((_, i) => r[i] || '') }));
    return data.length ? { columns, rows: data } : null;
  }

  // Which columns say who a row is and how to reach them, from the headings or, failing that, the values.
  function listFields(l) {
    const taken = [];
    const col = (re) => {
      const i = l.columns.findIndex((c, j) => re.test(c) && !taken.includes(j));
      if (i >= 0) taken.push(i);
      return i;
    };
    const byValue = (test) => l.columns.findIndex((_, i) => {
      const vals = l.rows.slice(0, 20).map((r) => r.cells[i]).filter(Boolean);
      return vals.length && vals.filter(test).length >= vals.length / 2;
    });
    const first = col(/^first|given/i), last = col(/^(last|sur)|family/i);
    const company = col(/company|business|organi[sz]ation|account|firm|store|shop|practice|venue|brand/i);
    const name = col(/name|contact|person|prospect|lead|owner/i);
    const pc = col(/phone|mobile|cell|tel\b|telephone/i), ec = col(/e-?mail/i);
    const phone = pc >= 0 ? pc : byValue(isPhone), email = ec >= 0 ? ec : byValue((v) => EMAIL_RE.test(v));
    return {
      phone, email,
      // A first name to greet them by, or '' when there's only a business.
      first: (r) => {
        const w = String((first >= 0 ? r.cells[first] : name >= 0 ? r.cells[name] : '') || '').trim().split(/\s+/)[0];
        return /^\p{L}[\p{L}'’-]*$/u.test(w) ? w : '';
      },
      who: (r) => {
        const person = first >= 0 || last >= 0 ? [r.cells[first], r.cells[last]].filter(Boolean).join(' ') : r.cells[name] || '';
        return [person, r.cells[company]].filter(Boolean).join(' · ') || r.cells.find((x, i) => x && i !== phone && i !== email) || r.cells.find(Boolean) || '—';
      },
    };
  }
  // Where each prospect stands: the latest call or email logged against their row.
  function rowStatus(l) {
    const m = new Map();
    for (const x of S.attempts) if (x.listId === l.id && !(m.get(x.rowId)?.at > x.at)) m.set(x.rowId, x);
    return m;
  }
  const reachLinks = (f, r) => [
    f.phone >= 0 && r.cells[f.phone] ? h('a', { href: 'tel:' + r.cells[f.phone].replace(/[^\d+]/g, ''), onclick: (e) => e.stopPropagation() }, r.cells[f.phone]) : null,
    f.email >= 0 && r.cells[f.email] ? h('a', { href: 'mailto:' + r.cells[f.email], onclick: (e) => e.stopPropagation() }, r.cells[f.email]) : null,
  ].filter(Boolean);

  // ----- interactive files: what a file dropped on a campaign is, and what it can become -----
  const STATUS_RE = /^(status|stage|state|pipeline|progress|phase)$/i;
  const TASK_RE = /task|to-?do|action|deliverable|activity|^item$|^title$|^what$/i;
  const DUE_RE = /due|deadline|by when|^date$|^when$/i;
  const OWNER_RE = /owner|assignee|assigned|responsible|^who$|staff|employee|person|^name$/i;
  const DATE_RE = /date|^day$|^when$/i;
  const START_RE = /start|time|^from$|begins|shift/i;
  const END_RE = /end|^to$|until|finish/i;
  const TITLE_RE = /title|event|shift|role|position|summary|subject|what|task|activity/i;
  const QTY_RE = /qty|quantity|stock|on hand|inventory|units|^count$/i;
  const DONE_RE = /^(done|complete|completed|closed|paid|hired|won|delivered|shipped|finished|resolved|signed)$/i;
  const OBJ_RE = /objection|rebuttal|push ?back|concern|if they say/i;
  const USES = {
    calls: ['Call list', 'Call or email each row and log how it went'],
    tracker: ['Tracker', 'Move each row through stages, like applied → hired or sent → paid'],
    reference: ['Reference', 'A searchable sheet to keep beside your work: prices, products, stock'],
    tasks: ['Tasks', 'Add each row as a task on a goal'],
    schedule: ['Schedule', 'Put each row on your schedule, and your connected calendar'],
    checklist: ['Checklist', 'Tick through the steps, as many times as you need'],
    agenda: ['Meeting agenda', 'Run a meeting item by item, with a timer and notes'],
    form: ['Questions', 'Ask them on each call; the answers are saved in the log'],
    script: ['Keep beside', 'Open it in a panel next to the campaign, like a call script'],
    file: ['Just a file', 'Keep it in the campaign’s files'],
  };
  const TABLE_KINDS = ['calls', 'tracker', 'reference'];
  const KIND_ICON = { calls: I.menu, tracker: I.stages, reference: I.grid, checklist: I.check, form: I.ask };
  const kindOf = (l) => l.kind || 'calls';
  const useOf = (l) => (l ? (kindOf(l) === 'checklist' && l.agenda ? 'agenda' : kindOf(l)) : 'file');
  const colOf = (cols, re) => cols.findIndex((c) => re.test(c));
  // A column whose filled cells mostly pass the test.
  const colWhere = (t, re, test) => t.columns.findIndex((c, i) => {
    if (!re.test(c)) return false;
    const vals = t.rows.slice(0, 30).map((r) => r.cells[i]).filter(Boolean);
    return vals.length && vals.filter(test).length >= vals.length / 2;
  });

  // A date in a cell: 2026-10-21, 10/21/2026, 21.10.2026, Oct 21, or an Excel day number.
  function cellDate(v) {
    v = String(v || '').trim();
    if (!v) return null;
    const make = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? dayKey(new Date(y, mo - 1, d)) : null);
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v))) return make(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(v))) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      // Dots are day first (21.10.2026). Slashes are month first, unless that can't be.
      return v.includes('.') || +m[1] > 12 ? make(y, +m[2], +m[1]) : make(y, +m[1], +m[2]);
    }
    if (/^\d{5}(\.\d+)?$/.test(v) && +v > 30000 && +v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 864e5);
      return make(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    if (/[a-z]{3}/i.test(v)) {
      let t = Date.parse(v);
      if (isNaN(t)) t = Date.parse(`${v} ${new Date().getFullYear()}`);
      if (!isNaN(t)) return dayKey(new Date(t));
    }
    return null;
  }
  // A time in a cell, as minutes after midnight: 9:30, 9:30 AM, 9am, 14:00, or Excel's fraction of a day.
  function cellTime(v) {
    v = String(v || '').trim().toLowerCase().replace(/\./g, '');
    if (!v) return null;
    const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a|p)?$/.exec(v);
    if (!m) return null;
    let hh = +m[1];
    const mm = +(m[2] || 0);
    if (m[3]) {
      hh %= 12;
      if (m[3][0] === 'p') hh += 12;
    } else if (!m[2] && hh > 23) return null;
    return hh < 24 && mm < 60 ? hh * 60 + mm : null;
  }
  const dayFraction = (v) => (/^0?\.\d+$/.test(String(v).trim()) ? Math.round(+v * 1440) % 1440 : null);
  // "9:00–17:30" in one cell, or just a start.
  function cellRange(v) {
    const frac = dayFraction(v);
    if (frac != null) return [frac, null];
    const p = String(v || '').split(/\s*(?:–|—|-|\bto\b)\s*/i);
    if (p.length === 2) {
      const a = cellTime(p[0]);
      let b = cellTime(p[1]);
      if (a != null && b != null) {
        if (b <= a && b + 720 <= 1440) b += 720;
        return [a, b > a ? b : null];
      }
    }
    const a = cellTime(v);
    return a == null ? null : [a, null];
  }

  // A contact card file (.vcf) as a call list.
  function readVcf(text) {
    const rows = [];
    for (const card of text.replace(/\r?\n[ \t]/g, '').split(/BEGIN:VCARD/i).slice(1)) {
      const get = (key) => {
        const m = new RegExp(`^(?:[\\w-]+\\.)?${key}(?:;[^:\\n]*)?:(.*)$`, 'im').exec(card);
        return m ? m[1].replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ').trim() : '';
      };
      const n = get('N').split(';');
      rows.push({ cells: [get('FN') || [n[1], n[0]].filter(Boolean).join(' '), get('ORG').split(';')[0], get('TEL'), get('EMAIL')] });
    }
    return rows.length ? { columns: ['Name', 'Company', 'Phone', 'Email'], rows } : null;
  }
  // Events in a calendar file (.ics). Times with a time zone name are read as local time.
  function readIcs(text) {
    const out = [];
    let ev = null;
    const when = (v) => {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z)?)?/.exec(v);
      if (!m) return null;
      if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, min: null };
      const d = m[6] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
      return { date: dayKey(d), min: d.getHours() * 60 + d.getMinutes() };
    };
    for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
      if (/^BEGIN:VEVENT/i.test(line)) ev = {};
      else if (/^END:VEVENT/i.test(line)) {
        if (ev?.start) out.push(ev);
        ev = null;
      } else if (ev) {
        const i = line.indexOf(':');
        if (i < 0) continue;
        const key = line.slice(0, i).split(';')[0].toUpperCase(), val = line.slice(i + 1);
        if (key === 'SUMMARY') ev.title = val.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ').trim();
        else if (key === 'DTSTART') ev.start = when(val);
        else if (key === 'DTEND') ev.end = when(val);
      }
    }
    return out.slice(0, 500).map((e) => {
      const s = e.start.min;
      const end = s == null ? null : e.end && e.end.date === e.start.date ? e.end.min : e.end ? 1440 : s + 60;
      return { title: (e.title || 'Event').slice(0, 300), date: e.start.date, start: s, end: s == null ? null : Math.min(1440, end > s ? end : s + 30) };
    });
  }

  // Markdown or plain text as a readable document: headings, lists, checkboxes and **bold**.
  function renderText(txt) {
    const out = h('div');
    let list = null;
    const inline = (s) => s.split(/\*\*(.+?)\*\*/).map((x, i) => (i % 2 ? h('b', {}, x) : x));
    for (const raw of txt.replace(/\r/g, '').split('\n')) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        list = null;
        continue;
      }
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        list = null;
        out.append(h('h' + Math.min(6, m[1].length + 1), {}, inline(m[2])));
        continue;
      }
      const box = /^\s*(?:[-*•+]\s+)?\[([ xX]?)\]\s+(.*)$/.exec(line);
      const item = box || /^\s*(?:([-*•+])|(\d+)[.)])\s+(.*)$/.exec(line);
      if (item) {
        const ordered = !box && !!item[2];
        if (!list || list.ordered !== ordered) out.append((list = { ordered, el: h(ordered ? 'ol' : 'ul') }).el);
        list.el.append(h('li', box ? { 'data-box': '1' } : {}, inline(box ? box[2] : item[3])));
        continue;
      }
      list = null;
      // In a plain text file, a short line ending in a colon reads as a heading.
      out.append(/^[^.?!]{2,60}:$/.test(line.trim()) ? h('h3', {}, line.trim().slice(0, -1)) : h('p', {}, inline(line)));
    }
    return out;
  }
  const docKind = (it) => {
    if (kind(it) === 'docx') return 'docx';
    return kind(it) === 'textfile' && (/^(MD|MARKDOWN|TXT|TEXT)$/.test(ext(it.name)) || /^text\/(plain|markdown)$/.test(it.mime || '')) ? 'text' : null;
  };
  const fileBufs = new Map();
  function fileBuf(it) {
    const key = it.id + ':' + (it.editedAt || it.createdAt);
    if (!fileBufs.has(key)) fileBufs.set(key, fetch(fileUrl(it)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('Couldn’t load the file')))));
    return fileBufs.get(key);
  }
  async function docDom(it) {
    const buf = await fileBuf(it);
    return docKind(it) === 'docx' ? renderDocx(buf) : renderText(new TextDecoder().decode(buf));
  }
  // The steps, questions and headings in a document.
  function docParts(dom) {
    let section = '', boxes = 0;
    const steps = [], paras = [], questions = [], heads = [];
    for (const el of dom.querySelectorAll('h1,h2,h3,h4,h5,h6,li,p')) {
      if (el.tagName === 'P' && el.closest('li')) continue;
      let text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (/^H\d$/.test(el.tagName)) {
        section = text.slice(0, 120);
        heads.push(text);
        continue;
      }
      if (/^[☐☑☒□✓✔]\s*/.test(text) || el.dataset.box) {
        boxes++;
        text = text.replace(/^[☐☑☒□✓✔]\s*/, '');
      }
      const mins = /\b(\d{1,3})\s*(?:min(?:ute)?s?|m)\b/i.exec(text);
      const row = { cells: [text.slice(0, 300)], section, ...(mins ? { mins: +mins[1] } : {}) };
      if (el.tagName === 'LI') steps.push(row);
      else if (text.length <= 300) paras.push(row);
      if (/\?\s*$/.test(text)) questions.push({ cells: [text.slice(0, 300)], section });
    }
    return { steps, paras, questions, heads, boxes };
  }
  function tableGuess(t) {
    const f = listFields(t);
    if (f.phone >= 0 || f.email >= 0) return 'calls';
    if (colOf(t.columns, STATUS_RE) >= 0) return 'tracker';
    if (colOf(t.columns, TASK_RE) >= 0 && (colOf(t.columns, DUE_RE) >= 0 || colOf(t.columns, OWNER_RE) >= 0)) return 'tasks';
    if (colWhere(t, DATE_RE, cellDate) >= 0 && colWhere(t, START_RE, (v) => cellRange(v)) >= 0) return 'schedule';
    return 'reference';
  }
  // What a file is and what it can be used as: { table | events | doc, uses, guess }, or null for any other file.
  async function analyze(file) {
    const name = file.name.toLowerCase();
    if (/\.ics$/.test(name) || file.type === 'text/calendar') {
      const events = readIcs(await file.text());
      return events.length ? { events, uses: ['schedule', 'file'], guess: 'schedule' } : null;
    }
    const table = /\.vcf$/.test(name) || /^text\/(x-)?vcard$/.test(file.type) ? readVcf(await file.text()) : await readList(file);
    if (table) {
      if (table.rows.length > LIST_MAX) {
        toast(`Only the first ${LIST_MAX} rows are used`);
        table.rows.length = LIST_MAX;
      }
      return { table, uses: ['calls', 'tracker', 'reference', 'tasks', 'schedule', 'file'], guess: tableGuess(table) };
    }
    const isDocx = /\.docx$/.test(name);
    if (!isDocx && !/\.(md|markdown|txt)$/.test(name) && !/^text\/(plain|markdown)$/.test(file.type)) return null;
    const parts = docParts(isDocx ? await renderDocx(await file.arrayBuffer()) : renderText(await file.text()));
    const items = parts.steps.length >= 2 ? parts.steps : parts.paras;
    const uses = [...(items.length >= 2 ? ['checklist', 'agenda'] : []), ...(parts.questions.length ? ['form'] : []), 'script', 'file'];
    let guess = 'file';
    if (/agenda/.test(name) && uses.includes('agenda')) guess = 'agenda';
    else if ((/checklist|sop|procedure|onboarding|routine|inspection|process|steps|to-?do/.test(name) || parts.boxes >= 2) && uses.includes('checklist')) guess = 'checklist';
    else if (parts.questions.length >= 3 && (/question|intake|discovery|survey|interview|qualif/.test(name) || parts.questions.length >= 0.6 * items.length)) guess = 'form';
    else if (/script|pitch|talk.?track|call.?guide|objection/.test(name)) guess = 'script';
    return { doc: { ...parts, items }, uses, guess };
  }
  const analyzeItem = async (it) => analyze(new File([await fileBuf(it)], it.name, { type: it.mime || '' }));
  const campOfItem = (it) => it?.stackId && S.campaigns.find((c) => c.stackId === it.stackId);

  // Stages from a table's status column, finished-sounding ones last. Each row starts at its status.
  function trackerRows(t) {
    const i = colOf(t.columns, STATUS_RE);
    const seen = [];
    if (i >= 0) for (const r of t.rows) if (r.cells[i] && !seen.some((s) => s.toLowerCase() === r.cells[i].toLowerCase()) && seen.length < 12) seen.push(r.cells[i]);
    const stages = seen.length >= 2 ? [...seen.filter((s) => !DONE_RE.test(s)), ...seen.filter((s) => DONE_RE.test(s))] : ['To do', 'In progress', 'Done'];
    const at = (r) => (i >= 0 && stages.find((s) => s.toLowerCase() === (r.cells[i] || '').toLowerCase())) || stages[0];
    return { stages, rows: t.rows.map((r) => ({ ...r, stage: at(r) })) };
  }

  async function addToCampaign(c, file) {
    let a = null;
    try {
      a = await analyze(file);
    } catch {}
    const item = await uploadFile(file, { stackId: c.stackId });
    if (!item) return;
    if (!a) return toast(`Attached to ${c.name}`);
    try {
      await useAs(c, item, a, a.guess, null, true);
    } catch (e) {
      toast(e.message);
    }
  }
  // Makes a campaign file into one of its uses, replacing what it was before. Calls logged against a list stay in the log.
  async function useAs(c, item, a, use, cur = null, auto = false) {
    const name = item.name.replace(/\.[^.]+$/, '');
    const base = { campaignId: c.id, itemId: item.id, name: cur?.name || name };
    let l = null;
    if (TABLE_KINDS.includes(use)) {
      const extra = use === 'tracker' ? trackerRows(cur && TABLE_KINDS.includes(kindOf(cur)) ? cur : a.table) : {};
      l = cur && TABLE_KINDS.includes(kindOf(cur))
        ? await api('PATCH', '/lists/' + cur.id, { kind: use, ...extra })
        : await api('POST', '/lists', { ...base, kind: use, columns: a.table.columns, rows: a.table.rows, ...extra });
    } else if (['checklist', 'agenda', 'form'].includes(use)) {
      const rows = (use === 'form' ? a.doc.questions : a.doc.items).slice(0, 500);
      l = await api('POST', '/lists', { ...base, kind: use === 'form' ? 'form' : 'checklist', agenda: use === 'agenda', columns: [use === 'form' ? 'Question' : 'Step'], rows });
    }
    if (cur && cur.id !== l?.id) {
      await api('DELETE', '/lists/' + cur.id);
      S.lists = S.lists.filter((x) => x.id !== cur.id);
    }
    if (l) {
      upsertList(l);
      K.listOpen = ['calls', 'tracker', 'checklist'].includes(use === 'agenda' ? 'checklist' : use) ? l.id : K.listOpen;
    }
    if (use === 'reference' || use === 'script') dockOpen(c, use === 'script' ? { type: 'file', id: item.id } : { type: 'list', id: l.id });
    renderCamps();
    if (use === 'tasks') return setTimeout(() => tasksSheet(c, a.table, name));
    if (use === 'schedule') return setTimeout(() => scheduleSheet(c, a, name));
    const n = l?.rows.length || 0;
    const said = {
      calls: `${plural(n, 'prospect')} ready to call`,
      tracker: `Tracker with ${plural(n, 'row')} in ${plural(l?.stages?.length || 0, 'stage')}`,
      reference: `${name} is beside the campaign`,
      checklist: `Checklist with ${plural(n, 'step')}`,
      agenda: `Agenda with ${plural(n, 'item')}`,
      form: `${plural(n, 'question')} added to the Log`,
      script: `${name} is beside the campaign`,
      file: auto ? `Attached to ${c.name}` : 'Kept as a file',
    }[use];
    toast(said, a.uses.length > 2 || use !== 'file' ? { label: auto && use === 'file' ? 'Use as…' : 'Change', run: () => useSheet(c, item) } : undefined);
  }
  async function useSheet(c, item) {
    const cur = S.lists.find((l) => l.itemId === item.id && l.campaignId === c.id);
    let a = null;
    try {
      a = await analyzeItem(item);
    } catch {}
    if (!a) return toast('This file can only be opened. It stays in the campaign’s files.');
    const now = useOf(cur);
    let pick = now;
    const opts = h('div', { class: 'use-opts' }, a.uses.map((u) => {
      const r = h('input', { type: 'radio', name: 'use', value: u });
      r.checked = u === now;
      r.addEventListener('change', () => (pick = u));
      return h('label', { class: 'use-opt' }, r, h('span', {}, h('b', {}, USES[u][0], u === now ? h('small', {}, ' · now') : null), h('small', {}, USES[u][1])));
    }));
    const keep = cur && kindOf(cur) === 'calls' ? h('p', { class: 'day-hint' }, 'Calls already logged stay in the log.') : null;
    sheet(`Use “${item.name}” as`, [opts, keep], () => {
      if (pick === now && !['script', 'reference'].includes(pick)) return;
      setTimeout(() => useAs(c, item, a, pick, cur).catch((e) => toast(e.message)));
    }, 'Use');
  }

  // Re-reads an edited file. Rows keep their ids (matched by who they are, or by a step's words), so what's logged against them stays.
  async function syncList(l, file) {
    if (kindOf(l) === 'checklist' || kindOf(l) === 'form') {
      const a = await analyze(file).catch(() => null);
      const rows = a?.doc && (kindOf(l) === 'form' ? a.doc.questions : a.doc.items);
      if (!rows?.length) return;
      const ids = new Map(l.rows.map((r) => [r.cells[0].toLowerCase(), r.id]));
      for (const r of rows) {
        const id = ids.get(r.cells[0].toLowerCase());
        if (id) r.id = id;
        ids.delete(r.cells[0].toLowerCase());
      }
      upsertList(await api('PATCH', '/lists/' + l.id, { rows: rows.slice(0, 500) }));
      return renderCamps();
    }
    const next = /\.vcf$/i.test(file.name) ? readVcf(await file.text()) : await readList(file);
    if (!next) return;
    const was = listFields(l), now = listFields(next);
    const ids = new Map(l.rows.map((r) => [was.who(r).toLowerCase(), r.id]));
    for (const r of next.rows) {
      const key = now.who(r).toLowerCase();
      if (ids.has(key)) r.id = ids.get(key);
      ids.delete(key);
    }
    upsertList(await api('PATCH', '/lists/' + l.id, { columns: next.columns, rows: next.rows.slice(0, LIST_MAX) }));
    renderCamps();
  }
  function pickCampaignFiles(c) {
    const inp = $('#filePick');
    inp.value = '';
    inp.onchange = () => [...inp.files].forEach((f) => queue(() => addToCampaign(c, f)));
    inp.click();
  }

  // ----- the campaign's lists and docs -----
  const stageOf = (l, r) => (l.stages?.includes(r.stage) ? r.stage : l.stages?.[0]);
  function overdue(l) {
    const i = colOf(l.columns, DUE_RE), t = todayKey(), last = l.stages.at(-1);
    return i < 0 ? [] : l.rows.filter((r) => stageOf(l, r) !== last && (cellDate(r.cells[i]) || '9') < t);
  }
  // How far along a list is: { n, of, label }. A checklist task counts the ticks of its own run.
  function listProgress(l, runId) {
    const k = kindOf(l), of = l.rows.length;
    if (k === 'calls') {
      const st = rowStatus(l);
      const n = l.rows.filter((r) => st.has(r.id)).length;
      return { n, of, label: `${n}/${of} contacted` };
    }
    if (k === 'tracker') {
      const last = l.stages.at(-1);
      const n = l.rows.filter((r) => stageOf(l, r) === last).length;
      const late = overdue(l).length;
      return { n, of, late, label: `${n}/${of} ${last.toLowerCase()}${late ? ` · ${late} overdue` : ''}` };
    }
    if (k === 'checklist') {
      const run = runId && l.runs?.find((r) => r.id === runId);
      if (run) {
        const n = l.rows.filter((r) => run.ticks[r.id]).length;
        return { n, of, label: `${n}/${of}` };
      }
      const open = (l.runs || []).filter((r) => !r.doneAt).length;
      return { label: plural(of, l.agenda ? 'item' : 'step') + (l.runs?.length ? ` · ${open ? `${open} open` : plural(l.runs.length, 'run')}` : '') };
    }
    if (k === 'reference') return { label: plural(of, 'row') };
    return { label: `${plural(of, 'question')} · in the Log` };
  }
  const draggableKind = (l) => ['calls', 'tracker', 'checklist'].includes(kindOf(l));

  function listCard(c, l) {
    const k = kindOf(l);
    const p = listProgress(l);
    const open = K.listOpen === l.id;
    const toggle = () => { K.listOpen = open ? null : l.id; K.runOpen = null; renderCamps(); };
    const click = k === 'reference' ? () => dockOpen(c, { type: 'list', id: l.id }) : k === 'form' ? () => openLog(c, { ask: true }) : toggle;
    const drag = draggableKind(l);
    const el = h('div', { class: `goal clist k-${k}${open ? ' open' : ''}` },
      h('div', { class: 'goal-top', draggable: drag ? 'true' : null, title: drag ? 'Drag onto a goal to make it a task' : null },
        h('span', { class: 'goal-ic', html: KIND_ICON[k] }),
        h('button', { class: 'goal-title clist-name', onclick: click }, l.name),
        l.live ? h('small', { class: 'clist-live', title: 'Kept in step with PSS' + (l.syncedAt ? ` · updated ${ago(l.syncedAt)}` : '') }, 'Live') : null,
        h('small', { class: 'clist-meta' + (p.late ? ' late' : '') }, p.label),
        h('button', { class: 't-btn', 'aria-label': 'Options', html: I.more, onclick: (e) => listMenu(e.currentTarget, c, l) })),
      p.of ? bar(p.n / p.of, c.color) : null);
    if (drag) {
      const top = el.firstChild;
      top.addEventListener('dragstart', (e) => {
        S.internalDrag = true;
        K.dragList = l;
        e.dataTransfer.effectAllowed = 'link';
        e.dataTransfer.setData('text/plain', l.name);
        e.dataTransfer.setDragImage(el, 20, 14);
        $('#camps').classList.add('list-drag');
      });
      top.addEventListener('dragend', () => {
        S.internalDrag = false;
        K.dragList = null;
        $('#camps').classList.remove('list-drag');
        document.querySelectorAll('.goal.list-over').forEach((g) => g.classList.remove('list-over'));
      });
    }
    if (open) el.append(h('div', { class: 'clist-body' }, k === 'tracker' ? trackerBody(c, l, toggle) : k === 'checklist' ? checklistBody(c, l, toggle) : listBody(c, l, toggle)));
    return el;
  }
  // What a list shows when it's opened under a goal's task.
  const taskListBody = (c, l, t, close) => (kindOf(l) === 'checklist'
    ? (l.runs.find((r) => r.id === t.runId) ? runView(c, l, l.runs.find((r) => r.id === t.runId)) : h('p', { class: 'day-hint' }, 'This run was deleted.'))
    : kindOf(l) === 'tracker' ? trackerBody(c, l, close) : listBody(c, l, close));

  // The prospects themselves, with To contact / Contacted tabs and a Log button on each.
  function listBody(c, l, close) {
    const f = listFields(l);
    const st = rowStatus(l);
    const reached = l.rows.filter((r) => st.has(r.id)).length;
    const show = K.listShow[l.id] || 'todo';
    const q = h('input', { class: 'goal-add clist-q', placeholder: 'Search this list', 'aria-label': 'Search this list' });
    const box = h('div', { class: 'clist-rows' });
    const draw = () => {
      const needle = q.value.trim().toLowerCase();
      const rows = l.rows.filter((r) => (show === 'all' || (show === 'todo') === !st.has(r.id)) && (!needle || r.cells.some((x) => x.toLowerCase().includes(needle))));
      const n = K.listN[l.id] || 50;
      box.replaceChildren(...[
        ...rows.slice(0, n).map((r) => {
          const x = st.get(r.id);
          return h('div', { class: 'crow' },
            h('div', { class: 'crow-who' }, h('b', {}, f.who(r)), h('small', {}, reachLinks(f, r))),
            x ? h('span', { class: 'oc oc-' + c.outcomes.indexOf(x.outcome), title: `${x.method ? x.method + ' · ' : ''}${x.by} · ${ago(x.at)}` }, x.outcome) : null,
            h('button', { class: 'btn small', onclick: () => logRow(c, l, r) }, 'Log'));
        }),
        rows.length > n ? h('button', { class: 'link', onclick: () => { K.listN[l.id] = n + 100; draw(); } }, `Show more (${rows.length - n} left)`) : null,
        rows.length ? null : h('p', { class: 'day-hint' }, needle ? 'No matches' : show === 'todo' ? 'Everyone on this list has been contacted.' : 'Nobody contacted yet.'),
      ].filter(Boolean));
    };
    q.addEventListener('input', draw);
    const tab = (k, label) => h('button', { class: show === k ? 'on' : '', onclick: () => { K.listShow[l.id] = k; renderCamps(); } }, label);
    draw();
    return [
      h('div', { class: 'seg clist-seg' }, tab('todo', `To contact · ${l.rows.length - reached}`), tab('done', `Contacted · ${reached}`), tab('all', 'All')),
      l.rows.length > 8 ? q : null,
      box,
      h('button', { class: 'link', onclick: close }, 'Hide'),
    ].filter(Boolean);
  }

  // A tracker: rows moving through stages. Tap a row's stage to move it.
  function trackerBody(c, l, close) {
    const f = listFields(l);
    const last = l.stages.at(-1);
    const si = colOf(l.columns, STATUS_RE);
    const late = new Set(overdue(l).map((r) => r.id));
    const counts = new Map(l.stages.map((s) => [s, 0]));
    for (const r of l.rows) counts.set(stageOf(l, r), counts.get(stageOf(l, r)) + 1);
    const show = K.listShow[l.id] || 'open';
    const q = h('input', { class: 'goal-add clist-q', placeholder: 'Search', 'aria-label': 'Search this tracker' });
    const box = h('div', { class: 'clist-rows' });
    const match = (r) => (show === 'all' ? true : show === 'open' ? stageOf(l, r) !== last : show === 'late' ? late.has(r.id) : stageOf(l, r) === show);
    const draw = () => {
      const needle = q.value.trim().toLowerCase();
      const rows = l.rows.filter((r) => match(r) && (!needle || r.cells.some((x) => x.toLowerCase().includes(needle)) || (r.note || '').toLowerCase().includes(needle)));
      const n = K.listN[l.id] || 50;
      box.replaceChildren(...[
        ...rows.slice(0, n).map((r) => trackRow(l, r, f, si, late.has(r.id))),
        rows.length > n ? h('button', { class: 'link', onclick: () => { K.listN[l.id] = n + 100; draw(); } }, `Show more (${rows.length - n} left)`) : null,
        rows.length ? null : h('p', { class: 'day-hint' }, needle ? 'No matches' : show === 'open' ? `Everything is ${last.toLowerCase()}.` : 'Nothing here.'),
      ].filter(Boolean));
    };
    q.addEventListener('input', draw);
    const chip = (k, label, n, cls = '') => h('button', { class: (show === k ? 'on ' : '') + cls, onclick: () => { K.listShow[l.id] = k; renderCamps(); } }, label, h('small', {}, ' ' + n));
    draw();
    return [
      h('div', { class: 'tchips' },
        chip('open', 'Open', l.rows.length - counts.get(last)),
        l.stages.map((s) => chip(s, s, counts.get(s))),
        late.size ? chip('late', 'Overdue', late.size, 'late') : null,
        chip('all', 'All', l.rows.length)),
      l.rows.length > 8 ? q : null,
      box,
      h('button', { class: 'link', onclick: close }, 'Hide'),
    ].filter(Boolean);
  }
  function trackRow(l, r, f, si, late) {
    const who = f.who(r);
    const sub = r.cells.filter((x, i) => x && i !== si && !who.includes(x)).slice(0, 2).join(' · ');
    const st = stageOf(l, r), i = l.stages.indexOf(st);
    const noting = K.noteRow === r.id;
    const row = h('div', { class: 'crow trow' },
      h('div', { class: 'crow-who' }, h('b', {}, who), sub ? h('small', {}, sub) : null, r.note && !noting ? h('small', { class: 'trow-note' }, r.note) : null),
      late ? h('span', { class: 'due late' }, 'Overdue') : null,
      h('button', { class: `stage s-${Math.min(i, 5)}${st === l.stages.at(-1) ? ' last' : ''}`, title: 'Move to another stage', onclick: (e) => stageMenu(e.currentTarget, l, r) }, st),
      h('button', { class: 't-btn', title: r.note ? 'Edit note' : 'Add a note', 'aria-label': 'Note', html: I.edit, onclick: () => { K.noteRow = noting ? null : r.id; renderCamps(); $('#camps .row-note')?.focus(); } }));
    if (!noting) return row;
    const inp = h('input', { class: 'goal-add row-note', placeholder: 'Note · Enter to save', 'aria-label': 'Note' });
    inp.value = r.note || '';
    const save = () => {
      K.noteRow = null;
      if (inp.value.trim() !== (r.note || '')) patchRow(l, r, { note: inp.value });
      else setTimeout(renderCamps);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = r.note || ''; inp.blur(); } });
    inp.addEventListener('blur', save);
    return h('div', { class: 'trow-wrap' }, row, inp);
  }
  async function patchRow(l, r, body) {
    Object.assign(r, body);
    renderCamps();
    try {
      upsertList(await api('PATCH', `/lists/${l.id}/rows/${r.id}`, body));
    } catch (e) {
      toast(e.message);
    }
    renderCamps();
    renderDock();
  }
  function stageMenu(anchor, l, r) {
    openMenu(anchor, [
      { head: 'Move to' },
      ...l.stages.map((s) => ({ label: s, on: stageOf(l, r) === s, run: () => patchRow(l, r, { stage: s }) })),
      { label: 'Edit stages…', run: () => stagesSheet(l) },
    ]);
  }
  function stagesSheet(l) {
    const ta = h('textarea', { rows: 6 });
    ta.value = l.stages.join('\n');
    sheet('Stages', [h('label', {}, 'One per line, in order. The last one counts as done.', ta)], async () => {
      const next = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (next.length < 2) throw new Error('Add at least two stages.');
      // Same number of stages: a rename, so each row keeps its place.
      const rows = next.length === l.stages.length ? l.rows.map((r) => ({ id: r.id, cells: r.cells, stage: next[l.stages.indexOf(stageOf(l, r))] })) : undefined;
      upsertList(await api('PATCH', '/lists/' + l.id, { stages: next, ...(rows ? { rows } : {}) }));
      renderCamps();
    });
  }

  // A reference sheet, kept beside the campaign: search it, tap a value to copy it, count stock up and down.
  function refPanel(l) {
    const qi = colWhere(l, QTY_RE, (v) => /^-?\d+(\.\d+)?$/.test(v));
    const q = h('input', { class: 'goal-add dock-q', placeholder: `Search ${l.name}`, 'aria-label': 'Search' });
    q.value = K.refQ[l.id] || '';
    const box = h('div', { class: 'ref-rows' });
    const draw = () => {
      K.refQ[l.id] = q.value;
      const needle = q.value.trim().toLowerCase();
      const rows = l.rows.filter((r) => !needle || r.cells.some((x) => x.toLowerCase().includes(needle)));
      box.replaceChildren(...[
        ...rows.slice(0, 200).map((r) => h('div', { class: 'ref-row' },
          h('div', { class: 'ref-cells' }, r.cells.map((x, i) => (x && i !== qi
            ? h('button', { class: 'ref-cell' + (i ? '' : ' first'), title: `${l.columns[i]} · tap to copy`, onclick: () => copyText(x) }, i ? h('small', {}, l.columns[i]) : null, x)
            : null))),
          qi >= 0 ? h('div', { class: 'stepper' },
            h('button', { 'aria-label': 'One less', onclick: () => patchRow(l, r, { cell: { i: qi, v: String(Math.max(0, Number(r.cells[qi] || 0) - 1)) } }) }, '−'),
            h('b', { title: l.columns[qi] }, r.cells[qi] || '0'),
            h('button', { 'aria-label': 'One more', onclick: () => patchRow(l, r, { cell: { i: qi, v: String(Number(r.cells[qi] || 0) + 1) } }) }, '+')) : null)),
        rows.length > 200 ? h('p', { class: 'day-hint' }, `${rows.length - 200} more · search to narrow it down`) : null,
        rows.length ? null : h('p', { class: 'day-hint' }, 'No matches'),
      ].filter(Boolean));
    };
    q.addEventListener('input', draw);
    draw();
    return [q, box];
  }

  // A checklist: its runs, newest open ones first. Each run keeps its own ticks.
  function checklistBody(c, l, close) {
    const runs = [...l.runs].sort((a, b) => !!a.doneAt - !!b.doneAt || b.createdAt - a.createdAt);
    const all = K.showAll['runs:' + l.id];
    const add = h('input', { class: 'goal-add', placeholder: l.agenda ? 'Start a meeting… “Monday standup”' : 'Start a run… “Acme onboarding”', 'aria-label': 'Start a run' });
    add.addEventListener('keydown', (e) => e.key === 'Enter' && add.value.trim() && startRun(l, add.value.trim()));
    return [
      ...(all ? runs : runs.slice(0, 5)).map((run) => {
        const n = l.rows.filter((r) => run.ticks[r.id]).length;
        const open = K.runOpen === run.id;
        return h('div', { class: 'run' + (open ? ' open' : '') + (run.doneAt ? ' finished' : '') },
          h('button', { class: 'run-top', onclick: () => { K.runOpen = open ? null : run.id; renderCamps(); } },
            h('span', { class: 'run-name' }, run.name),
            h('small', {}, run.doneAt ? `Finished ${ago(run.doneAt)}` : run.cur ? 'In progress' : `${n}/${l.rows.length}`)),
          open ? runView(c, l, run) : null);
      }),
      runs.length > 5 ? h('button', { class: 'link', onclick: () => { K.showAll['runs:' + l.id] = !all; renderCamps(); } }, all ? 'Show fewer' : `All ${runs.length} runs`) : null,
      add,
      runs.length ? null : h('p', { class: 'day-hint' }, l.agenda ? 'Each meeting keeps its own notes and timings.' : 'Each run keeps its own ticks, so the same checklist works for every client or shift.'),
      h('button', { class: 'link', onclick: close }, 'Hide'),
    ].filter(Boolean);
  }
  async function startRun(l, name) {
    try {
      const { list, run } = await api('POST', `/lists/${l.id}/runs`, { name });
      upsertList(list);
      K.runOpen = run.id;
      renderCamps();
      return run;
    } catch (e) {
      toast(e.message);
    }
  }
  function patchRun(l, run, body) {
    if (body.tick) {
      if (body.tick.on) run.ticks[body.tick.rowId] = { by: memberName(S.me?.memberId) || 'You', at: Date.now() };
      else delete run.ticks[body.tick.rowId];
    }
    if (body.cur !== undefined) run.cur = body.cur ? { rowId: body.cur, at: Date.now() } : null;
    if (body.done !== undefined) run.doneAt = body.done ? Date.now() : null;
    renderCamps();
    api('PATCH', `/lists/${l.id}/runs/${run.id}`, body).then((x) => { upsertList(x); renderCamps(); }).catch((e) => toast(e.message));
  }
  // One run, step by step. An agenda also has the item being discussed, with a timer against its planned minutes.
  function runView(c, l, run) {
    const n = l.rows.filter((r) => run.ticks[r.id]).length;
    const cur = l.agenda && run.cur && l.rows.find((r) => r.id === run.cur.rowId);
    const parts = [];
    if (l.agenda && !run.doneAt) {
      const next = l.rows[cur ? l.rows.indexOf(cur) + 1 : 0];
      const planned = l.rows.reduce((s, r) => s + (r.mins || 0), 0);
      parts.push(h('div', { class: 'agenda-bar' },
        cur ? h('span', {}, h('b', { class: 'agenda-timer', 'data-since': run.cur.at, 'data-mins': cur.mins || '' }, clock(Date.now() - run.cur.at)), cur.mins ? h('small', {}, ` of ${cur.mins} min`) : null)
          : h('small', {}, planned ? `${planned} min planned` : plural(l.rows.length, 'item')),
        h('button', { class: 'btn small primary-btn', onclick: () => patchRun(l, run, { cur: cur ? next?.id || null : l.rows[0].id, ...(cur ? { tick: { rowId: cur.id, on: true } } : {}), ...(cur && !next ? { done: true } : {}) }) },
          !cur ? 'Start meeting' : next ? 'Next item' : 'End meeting')));
    }
    let section = null;
    for (const r of l.rows) {
      if (r.section && r.section !== section) parts.push(h('div', { class: 'run-sec' }, (section = r.section)));
      const t = run.ticks[r.id];
      const isCur = cur?.id === r.id;
      const key = run.id + ':' + r.id;
      const noting = isCur || K.noteRow === key;
      let note = null;
      if (noting) {
        note = h('textarea', { class: 'step-note-in', rows: isCur ? 3 : 2, placeholder: isCur ? 'Notes · start a line with “Action:” to make it a task' : 'Note', 'aria-label': 'Note' });
        note.value = run.notes[r.id] || '';
        note.addEventListener('blur', () => {
          if (!isCur) K.noteRow = null;
          if (note.value.trim() !== (run.notes[r.id] || '')) {
            run.notes[r.id] = note.value.trim();
            patchRun(l, run, { note: { rowId: r.id, text: note.value } });
          } else setTimeout(renderCamps);
        });
      }
      parts.push(h('div', { class: 'step' + (t ? ' done' : '') + (isCur ? ' cur' : '') },
        h('button', { class: 'check' + (t ? ' on' : ''), html: I.check, 'aria-label': t ? 'Untick' : 'Tick', onclick: () => patchRun(l, run, { tick: { rowId: r.id, on: !t } }) }),
        h('div', { class: 'step-body' },
          h('span', { class: 'step-text', title: l.agenda ? 'Discuss this now' : 'Add a note', onclick: () => { if (l.agenda && !run.doneAt) patchRun(l, run, { cur: r.id }); else { K.noteRow = noting ? null : key; renderCamps(); $('#camps .step-note-in')?.focus(); } } }, r.cells[0]),
          t ? h('small', {}, `${t.by} · ${ago(t.at)}`) : null,
          run.notes[r.id] && !noting ? h('small', { class: 'step-note' }, run.notes[r.id]) : null,
          note),
        l.agenda && r.mins ? h('small', { class: 'step-mins' }, r.mins + 'm') : null));
    }
    // Lines in the notes that start with "Action:" become tasks.
    const actions = Object.values(run.notes).flatMap((x) => x.split('\n').map((y) => /^\s*(?:action|todo|to do|next step)s?\s*[:\-–]\s*(.+)/i.exec(y)?.[1]?.trim()).filter(Boolean));
    parts.push(h('div', { class: 'run-foot' },
      h('small', {}, `${n} of ${l.rows.length} done`),
      actions.length ? h('button', { class: 'btn small', onclick: (e) => actionsMenu(e.currentTarget, c, actions) }, `Make ${plural(actions.length, 'task')}`) : null,
      l.agenda && !run.doneAt ? null : h('button', { class: 'btn small', onclick: () => patchRun(l, run, { done: !run.doneAt, ...(run.doneAt ? {} : { cur: null }) }) }, run.doneAt ? 'Reopen' : 'Finish'),
      h('button', { class: 't-btn', 'aria-label': 'Run options', html: I.more, onclick: (e) => runMenu(e.currentTarget, l, run) })));
    return h('div', { class: 'run-view' }, parts);
  }
  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
  };
  setInterval(() => {
    for (const el of document.querySelectorAll('.agenda-timer[data-since]')) {
      const ms = Date.now() - Number(el.dataset.since);
      el.textContent = clock(ms);
      el.classList.toggle('over', !!el.dataset.mins && ms > el.dataset.mins * 60000);
    }
  }, 1000);
  function actionsMenu(anchor, c, actions) {
    const make = async (goalId) => {
      try {
        for (const text of actions) upsertTask(await api('POST', '/tasks', { ...parseTask(text), goalId }));
        toast(`Added ${plural(actions.length, 'task')}`);
        renderCamps();
      } catch (e) {
        toast(e.message);
      }
    };
    openMenu(anchor, [{ head: 'Add the tasks to' }, ...goalsOf(c.id).map((g) => ({ label: g.title, run: () => make(g.id) })), { label: 'My tasks (no goal)', run: () => make(null) }]);
  }
  function runMenu(anchor, l, run) {
    openMenu(anchor, [
      { label: 'Rename…', run: () => {
        const name = h('input', { value: run.name });
        sheet('Rename', [h('label', {}, 'Name', name)], async () => upsertList(await api('PATCH', `/lists/${l.id}/runs/${run.id}`, { name: name.value })));
      } },
      { label: 'Delete this run', danger: true, run: () => api('DELETE', `/lists/${l.id}/runs/${run.id}`).then((x) => { upsertList(x); renderCamps(); }).catch((e) => toast(e.message)) },
    ]);
  }

  // Working through a list becomes a task on a goal: a call list or tracker moves there; a checklist starts a run for it.
  async function listToGoal(l, g) {
    try {
      let body = { text: kindOf(l) === 'calls' ? `Call ${l.name}` : l.name, goalId: g.id, listId: l.id };
      if (kindOf(l) === 'checklist') {
        const { list, run } = await api('POST', `/lists/${l.id}/runs`, { name: `${l.name} · ${g.title}` });
        upsertList(list);
        body = { ...body, runId: run.id };
      } else if (tasksOf(g.id).some((t) => t.listId === l.id)) return toast(`${l.name} is already a task on ${g.title}`);
      const t = await api('POST', '/tasks', body);
      upsertTask(t);
      K.listOpen = 'task:' + t.id;
      renderCamps();
      toast(kindOf(l) === 'checklist' ? `Started a run on ${g.title}` : `Moved to ${g.title}`);
    } catch (e) {
      toast(e.message);
    }
  }
  function listMenu(anchor, c, l) {
    const file = l.itemId && S.items.find((x) => x.id === l.itemId);
    const k = kindOf(l);
    openMenu(anchor, [
      k === 'reference' ? { label: 'Keep beside', run: () => dockOpen(c, { type: 'list', id: l.id }) } : null,
      file ? { label: kind(file) === 'textfile' ? 'Open or edit the file' : 'Open the file', run: () => openPreview(file) } : null,
      file ? { label: 'Use as…', run: () => useSheet(c, file) } : null,
      k === 'tracker' ? { label: 'Edit stages…', run: () => stagesSheet(l) } : null,
      l.live && S.pss?.connected ? { label: 'Change who’s on it…', run: () => liveSheet(c, l) } : null,
      S.mail && k === 'calls' && listFields(l).email >= 0 ? { label: 'Email this list…', run: () => { const f = listFields(l); emailTo(l.rows.filter((r) => !r.dne).map((r) => ({ email: r.cells[f.email], name: f.who(r) === '—' ? '' : f.who(r), first: f.first(r), listId: l.id, rowId: r.id }))); } } : null,
      ...(draggableKind(l) && goalsOf(c.id).length ? [{ head: k === 'checklist' ? 'Run it as a task on' : 'Add as a task to' }, ...goalsOf(c.id).map((g) => ({ label: g.title, run: () => listToGoal(l, g) }))] : []),
      { label: file ? 'Remove (the file stays)' : 'Remove', danger: true, run: () => api('DELETE', '/lists/' + l.id).catch((e) => toast(e.message)) },
    ].filter(Boolean));
  }
  function logRow(c, l, r) {
    K.logOpen = c.id;
    K.logFrom[c.id] = l.id;
    K.pick = { listId: l.id, rowId: r.id };
    renderCamps();
    $('#camps .logbox')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#camps .log-note')?.focus();
  }

  // ----- tables into tasks or onto the schedule -----
  const pickCol = (t, re, none) => {
    const s = h('select', {}, none ? h('option', { value: '-1' }, none) : null, t.columns.map((col, i) => h('option', { value: String(i) }, col)));
    const i = typeof re === 'number' ? re : colOf(t.columns, re);
    s.value = String(i >= 0 ? i : none ? -1 : 0);
    return s;
  };
  const memberByName = (v) => {
    v = String(v || '').trim().toLowerCase();
    if (!v) return null;
    const ms = S.workspace.members;
    return (ms.find((m) => m.name.toLowerCase() === v) || ms.find((m) => m.name.toLowerCase().split(' ')[0] === v.split(' ')[0]))?.id || null;
  };
  function tasksSheet(c, t, name) {
    const what = pickCol(t, TASK_RE), due = pickCol(t, DUE_RE, 'No due dates'), who = pickCol(t, OWNER_RE, 'Nobody');
    const goal = h('select', {}, h('option', { value: '' }, `New goal: ${name}`), goalsOf(c.id).map((g) => h('option', { value: g.id }, g.title)));
    const info = h('p', { class: 'day-hint' });
    const build = () => t.rows.map((r) => ({
      text: r.cells[+what.value] || '',
      due: +due.value >= 0 ? cellDate(r.cells[+due.value]) : null,
      assigneeId: +who.value >= 0 ? memberByName(r.cells[+who.value]) : null,
    })).filter((x) => x.text.trim()).slice(0, 300);
    const sync = () => {
      const list = build();
      info.textContent = [plural(list.length, 'task'), `${list.filter((x) => x.due).length} with due dates`, `${list.filter((x) => x.assigneeId).length} assigned`].join(' · ') + (t.rows.length > 300 ? ' · the first 300' : '');
    };
    for (const s of [what, due, who]) s.addEventListener('change', sync);
    sync();
    sheet(`Tasks from ${name}`, [h('label', {}, 'Task', what), h('div', { class: 'row2' }, h('label', {}, 'Due', due), h('label', {}, 'Assigned to', who)), h('label', {}, 'Goal', goal), info], async () => {
      const list = build();
      if (!list.length) throw new Error('That column has no tasks in it.');
      let gid = goal.value;
      if (!gid) {
        const g = await api('POST', '/goals', { campaignId: c.id, title: name, kind: 'tasks' });
        if (!S.goals.some((x) => x.id === g.id)) S.goals.push(g);
        gid = g.id;
      }
      for (const x of list) upsertTask(await api('POST', '/tasks', { ...x, goalId: gid }));
      renderCamps();
      toast(`Added ${plural(list.length, 'task')}`);
    }, 'Add tasks');
  }
  // Rows (or a calendar file's events) as blocks on your schedule. Timed blocks also go to your connected calendar.
  function scheduleSheet(c, a, name) {
    const t = a.table;
    const fmt = (e) => `${fmtDay(e.date).rel || keyDate(e.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${e.start == null ? 'all day' : fmtTime(e.start) + (e.end ? '–' + fmtTime(e.end) : '')} · ${e.title}`;
    const info = h('p', { class: 'day-hint' }), prev = h('div', { class: 'sched-prev' });
    let build = () => a.events;
    const fields = [];
    if (t) {
      const title = pickCol(t, TITLE_RE, `“${name}”`), date = pickCol(t, colWhere(t, DATE_RE, cellDate)), start = pickCol(t, colWhere(t, START_RE, (v) => cellRange(v)), 'No times (all day)'), end = pickCol(t, colWhere(t, END_RE, (v) => cellRange(v)), 'An hour after the start');
      const pc = colOf(t.columns, OWNER_RE);
      const names = pc >= 0 ? [...new Set(t.rows.map((r) => r.cells[pc]).filter(Boolean))].sort() : [];
      const whose = h('select', {}, h('option', { value: '' }, 'Everyone'), names.map((n) => h('option', { value: n }, n)));
      whose.value = names.find((n) => memberByName(n) === S.me?.memberId) || '';
      build = () => t.rows.filter((r) => !whose.value || r.cells[pc] === whose.value).map((r) => {
        const range = +start.value >= 0 ? cellRange(r.cells[+start.value]) : null;
        const s = range?.[0] ?? null;
        const e = s == null ? null : +end.value >= 0 ? cellRange(r.cells[+end.value])?.[0] ?? null : range[1];
        const who = pc >= 0 && !whose.value && r.cells[pc] && +title.value !== pc ? ` · ${r.cells[pc]}` : '';
        return { title: ((+title.value >= 0 && r.cells[+title.value]) || name) + who, date: cellDate(r.cells[+date.value]), start: s, end: s == null ? null : Math.min(1440, e > s ? e : s + 60) };
      }).filter((e) => e.date);
      for (const s of [title, date, start, end, whose]) s.addEventListener('change', () => sync());
      fields.push(h('div', { class: 'row2' }, h('label', {}, 'What', title), h('label', {}, 'Day', date)), h('div', { class: 'row2' }, h('label', {}, 'Starts', start), h('label', {}, 'Ends', end)));
      if (names.length) fields.push(h('label', {}, 'Whose rows', whose));
    }
    const sync = () => {
      const list = build();
      info.textContent = list.length ? `${plural(Math.min(list.length, 200), 'block')} for your schedule${list.length > 200 ? ' (the first 200)' : ''}` : 'No dates found. Pick the column with the days.';
      prev.replaceChildren(...list.slice(0, 4).map((e) => h('div', {}, fmt(e))), list.length > 4 ? h('div', { class: 'day-hint' }, `…and ${list.length - 4} more`) : '');
    };
    sync();
    sheet(`Schedule from ${name}`, [...fields, info, prev], async () => {
      const list = build().slice(0, 200);
      if (!list.length) throw new Error('No dates found.');
      for (const e of list) upsertEntry(await api('POST', '/entries', { text: e.title, date: e.date, start: e.start, end: e.end, color: c.color }));
      renderDay();
      toast(`Added ${plural(list.length, 'block')} to your schedule`);
    }, 'Add to schedule');
  }

  // ----- kept beside: a document or reference sheet docked next to the campaign -----
  function dockOpen(c, what) {
    K.dock = { cid: c.id, ...what };
    K.dockMin = false;
    store.set('dock', K.dock);
    if (S.tab !== 'camps' || K.open !== c.id) openCampaign(c.id);
    renderDock(true);
  }
  function dockClose() {
    K.dock = null;
    store.set('dock', null);
    renderDock(true);
  }
  // Adds a line from the script (say, an objection) to the note of the call being logged.
  function addToNote(c, text) {
    K.noteDraft[c.id] = [K.noteDraft[c.id], text].filter(Boolean).join(' · ');
    K.logOpen = c.id;
    const inp = $('#camps .log-note');
    if (inp) inp.value = K.noteDraft[c.id];
    else renderCamps();
    toast('Added to the log note');
  }
  let dockKey = null;
  function renderDock(force) {
    const el = $('#dock');
    const d = K.dock;
    const c = d && S.tab === 'camps' && K.open === d.cid && campById(d.cid);
    const it = c && d.type === 'file' && S.items.find((x) => x.id === d.id);
    const l = c && d.type === 'list' && S.lists.find((x) => x.id === d.id);
    const on = !!(it || l);
    el.classList.toggle('hidden', !on);
    el.classList.toggle('min', on && !!K.dockMin);
    $('#campsWrap').classList.toggle('docked', on);
    if (!on) {
      dockKey = null;
      el.replaceChildren();
      return;
    }
    el.style.flexBasis = K.dockMin ? '' : (K.dockSize || 0.45) * 100 + '%';
    const key = it ? `f:${it.id}:${it.editedAt || it.createdAt}` : `l:${l.id}`;
    // A list redraws in place when it changes, unless someone is typing in it.
    if (key === dockKey && !force && (it || el.contains(document.activeElement))) return;
    const keep = $('.dock-body', el)?.scrollTop || 0;
    dockKey = key;
    const body = h('div', { class: 'dock-body' });
    const chips = h('div', { class: 'dock-chips' });
    const grip = h('div', { class: 'dock-grip', title: 'Drag to resize' });
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const box = $('#campsWrap').getBoundingClientRect();
      const side = getComputedStyle($('#campsWrap')).flexDirection === 'row';
      const move = (ev) => {
        K.dockSize = Math.min(0.8, Math.max(0.2, side ? (box.right - ev.clientX) / box.width : (box.bottom - ev.clientY) / box.height));
        el.style.flexBasis = K.dockSize * 100 + '%';
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        store.set('dockSize', K.dockSize);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
    el.replaceChildren(grip,
      h('div', { class: 'dock-head' },
        h('span', { class: 'dock-ic', html: it ? I.doc : I.grid }),
        h('b', { class: 'dock-title', title: it ? it.name : l.name }, it ? it.name : l.name),
        it ? h('button', { class: 't-btn', title: 'Open in its own window', 'aria-label': 'Open in its own window', html: I.reveal, onclick: () => popOut(it) }) : null,
        h('button', { class: 't-btn', title: K.dockMin ? 'Show' : 'Shrink', 'aria-label': K.dockMin ? 'Show' : 'Shrink', html: I.down, style: K.dockMin ? 'transform:rotate(180deg)' : null, onclick: () => { K.dockMin = !K.dockMin; renderDock(true); } }),
        h('button', { class: 't-btn', title: 'Close', 'aria-label': 'Close', html: I.close, onclick: dockClose })),
      chips, body);
    if (l) {
      body.append(...refPanel(l));
      body.scrollTop = keep;
      return;
    }
    const k = kind(it);
    if (k === 'pdf') return body.append(h('iframe', { src: fileUrl(it), title: it.name }));
    if (k === 'image') return body.append(h('img', { src: fileUrl(it), alt: it.name }));
    if (!docKind(it) && k !== 'textfile') return body.append(h('p', { class: 'day-hint' }, 'This file can’t be shown here.'), h('button', { class: 'btn small', onclick: () => download(it) }, 'Download'));
    body.append(h('p', { class: 'day-hint' }, 'Loading…'));
    (docKind(it) ? docDom(it) : fileBuf(it).then((b) => h('div', {}, h('pre', {}, new TextDecoder().decode(b).slice(0, 500_000))))).then((dom) => {
      if (dockKey !== key) return;
      const doc = h('div', { class: 'docx dock-doc' }, ...dom.childNodes);
      body.replaceChildren(doc);
      body.scrollTop = keep;
      // Headings become jumps. Under an "Objections" heading, tapping a line adds it to the log note.
      const heads = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')];
      if (heads.length >= 2) chips.replaceChildren(...heads.slice(0, 30).map((hd) => h('button', { onclick: () => hd.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, hd.textContent.trim().slice(0, 40))));
      let obj = false;
      for (const x of doc.querySelectorAll('h1,h2,h3,h4,h5,h6,li,p')) {
        if (/^H\d$/.test(x.tagName)) obj = OBJ_RE.test(x.textContent);
        else if (obj && !(x.tagName === 'P' && x.closest('li')) && x.textContent.trim()) {
          x.classList.add('tap-add');
          x.title = 'Tap to add to the log note';
          x.addEventListener('click', (e) => {
            if (e.target.closest('a')) return;
            addToNote(c, x.textContent.replace(/\s+/g, ' ').trim().slice(0, 200));
          });
        }
      }
    }).catch(() => body.replaceChildren(h('p', { class: 'day-hint' }, 'Couldn’t read this file.')));
  }

  // Notes are text cards in the campaign's stack, so they sit in the stack next to its files.
  const notesOf = (c) => S.items.filter((it) => it.stackId === c.stackId && it.type === 'text').sort((a, b) => (b.editedAt || b.createdAt) - (a.editedAt || a.createdAt));
  const noteTitle = (it) => it.text.trim().split('\n')[0].slice(0, 60) || 'Empty note';
  function notesMenu(anchor, c) {
    const notes = notesOf(c);
    openMenu(anchor, [
      { label: '+ New note', run: () => noteWin(c) },
      ...(notes.length ? [{ head: 'Recent notes' }] : []),
      ...notes.slice(0, 8).map((it) => ({ label: h('span', { class: 'mfile' }, h('span', { class: 'mfile-name' }, noteTitle(it)), h('small', { class: 'mfile-when' }, ago(it.editedAt || it.createdAt))), run: () => noteWin(c, it) })),
      { label: notes.length > 8 ? `Go to the stack · all ${notes.length} notes` : 'Go to the stack', run: () => showStack(c.stackId) },
    ]);
  }
  // A small window that floats over Column, so you can jot while the list stays in view. It saves as you type.
  function noteWin(c, it = null) {
    $('.note-win')?._close();
    const ta = h('textarea', { class: 'note-ta', placeholder: 'Jot something…', 'aria-label': 'Note' });
    ta.value = it?.text || '';
    const status = h('small', { class: 'note-status' }, it ? 'Saved' : '');
    let saved = ta.value, timer = null, saving = Promise.resolve();
    const flush = () => {
      clearTimeout(timer);
      const text = ta.value;
      if (text === saved || !text.trim()) return saving;
      saved = text;
      status.textContent = 'Saving…';
      saving = saving.then(async () => {
        try {
          it = it ? await api('PATCH', '/items/' + it.id, { text }) : await api('POST', '/items', { type: 'text', text, stackId: c.stackId });
          if (it?.id) upsert(it);
          status.textContent = 'Saved';
        } catch (e) {
          saved = null;
          status.textContent = 'Not saved';
          toast(e.message);
        }
      });
      return saving;
    };
    ta.addEventListener('input', () => {
      status.textContent = '';
      clearTimeout(timer);
      timer = setTimeout(flush, 600);
    });
    const close = async () => {
      await flush();
      win.remove();
      renderCamps();
    };
    ta.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    const win = h('div', { class: 'note-win', role: 'dialog', 'aria-label': 'Quick note' },
      h('div', { class: 'note-top' },
        h('b', {}, 'Note'), h('span', { class: 'note-camp' }, c.name), status,
        h('button', { class: 'icon-btn', 'aria-label': 'Close note', html: I.close, onclick: close })),
      ta);
    win._close = close;
    document.body.append(win);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // The Files button: the campaign's newest files to open, a way to add one, and the whole stack.
  function filesMenu(anchor, c) {
    const files = S.items.filter((it) => it.stackId === c.stackId && (it.type === 'file' || it.type === 'folder')).sort((a, b) => (b.editedAt || b.createdAt) - (a.editedAt || a.createdAt));
    openMenu(anchor, [
      ...(files.length ? [{ head: 'Recent files' }] : [{ note: 'No files yet. Drop one on this campaign.' }]),
      ...files.slice(0, 8).map((it) => ({
        label: h('span', { class: 'mfile' }, h('span', { class: 'mfile-ext' }, it.type === 'folder' ? 'DIR' : ext(it.name) || 'FILE'), h('span', { class: 'mfile-name' }, it.name)),
        run: () => (it.type === 'folder' ? showStack(c.stackId) : docKind(it) || kind(it) === 'pdf' ? dockOpen(c, { type: 'file', id: it.id }) : openPreview(it)),
      })),
      { label: '+ Add a call list or file…', run: () => pickCampaignFiles(c) },
      { label: files.length > 8 ? `Go to the stack · all ${files.length} files` : 'Go to the stack', run: () => showStack(c.stackId) },
    ].filter(Boolean));
  }

  // Log one attempt: how (call, email…), who (optional, or picked from a call list), then tap how it went.
  // Every count goal reads from this log.
  function logBox(c) {
    const open = K.logOpen === c.id;
    const recent = attemptsIn(c.id);
    const showN = K.showAll[c.id] ? 50 : 3;
    const methods = c.methods || [];
    if (!methods.includes(K.method)) K.method = methods[0] || null;
    const list = recent.length ? h('div', { class: 'attempts' },
      recent.slice(0, showN).flatMap((x) => [h('div', { class: 'attempt' },
        h('span', { class: 'oc oc-' + c.outcomes.indexOf(x.outcome) }, x.outcome),
        h('span', { class: 'att-who' }, x.method ? h('small', {}, x.method + ' · ') : null, x.contact || '—', x.note ? h('small', {}, ' · ' + x.note) : null,
          x.answers?.length ? h('button', { class: 'link att-ans-btn', onclick: () => { K.ansOpen[x.id] = !K.ansOpen[x.id]; renderCamps(); } }, ` · ${plural(x.answers.length, 'answer')}`) : null),
        h('span', { class: 'att-by' }, `${x.memberId === S.me?.memberId ? 'You' : x.by} · `, h('span', { 'data-ago': x.at }, ago(x.at))),
        x.memberId === S.me?.memberId || c.ownerId === S.me?.memberId ? h('button', { class: 't-btn', 'aria-label': 'Remove', html: I.close, onclick: () => api('DELETE', '/attempts/' + x.id).catch((e) => toast(e.message)) }) : null),
        K.ansOpen[x.id] ? h('div', { class: 'att-ans' }, x.answers.map((y) => h('div', {}, h('small', {}, y.q), y.a))) : null]).filter(Boolean),
      recent.length > 3 ? h('button', { class: 'link', onclick: () => { K.showAll[c.id] = !K.showAll[c.id]; renderCamps(); } }, K.showAll[c.id] ? 'Show less' : `Show all ${recent.length}`) : null) : null;
    if (!open) return h('div', { class: 'logbox' }, list || h('p', { class: 'day-hint' }, 'Nothing logged yet. Tap Log above after a call or email.'));
    // Log against one of the campaign's lists, or blank for anyone else.
    const all = listsOf(c.id).filter((l) => (l.kind || 'calls') === 'calls');
    if (K.logFrom[c.id] !== 'blank' && !all.some((l) => l.id === K.logFrom[c.id])) K.logFrom[c.id] = all[0]?.id || 'blank';
    const from = K.logFrom[c.id];
    const lists = all.filter((l) => l.id === from);
    const pl = K.pick && all.find((l) => l.id === K.pick.listId);
    const picked = pl && pl.rows.find((r) => r.id === K.pick.rowId);
    if (!picked) K.pick = null;
    const leads = !lists.length && S.contacts?.length ? S.contacts : null;
    const contact = h('input', { class: 'log-contact', placeholder: lists.length ? `Who? Search ${lists[0].name}, or type a name` : leads ? 'Who? Search PSS contacts, or type a name' : 'Who? (business, person, area)', 'aria-label': 'Who you reached' });
    const note = h('input', { class: 'log-note', placeholder: 'Note (optional)', 'aria-label': 'Note' });
    note.value = K.noteDraft[c.id] || '';
    note.addEventListener('input', () => (K.noteDraft[c.id] = note.value));
    // The campaign's questions, answered on this call and saved with it.
    const qs = listsOf(c.id).filter((l) => l.kind === 'form').flatMap((l) => l.rows.map((r) => ({ id: r.id, q: r.cells[0] })));
    const ans = (K.answers[c.id] ||= {});
    const answered = qs.filter((x) => ans[x.id]?.trim()).length;
    const ask = qs.length ? h('div', { class: 'log-ask' },
      h('button', { class: 'link log-ask-btn', onclick: () => { K.askOpen = !K.askOpen; document.activeElement?.blur(); renderCamps(); } }, `${K.askOpen ? '▾' : '▸'} Questions · ${answered}/${qs.length}`),
      K.askOpen ? qs.map((x) => {
        const ta = h('textarea', { rows: 1, class: 'log-ans', placeholder: 'Answer', 'aria-label': x.q });
        ta.value = ans[x.id] || '';
        ta.addEventListener('input', () => (ans[x.id] = ta.value));
        return h('label', { class: 'log-q' }, h('span', {}, x.q), ta);
      }) : null) : null;
    // Prospects matching what's typed; with nothing typed, the next few not yet contacted.
    const sugg = h('div', { class: 'log-sugg hidden' });
    const suggest = () => {
      const needle = contact.value.trim().toLowerCase();
      // Logging blank, an owner can pick from PSS's leads.
      if (leads) {
        const found = needle.length < 2 ? [] : leads.filter((x) => [x.name, x.phone, x.email, x.city].some((v) => v.toLowerCase().includes(needle))).slice(0, 6);
        sugg.replaceChildren(h('small', { class: 'log-sugg-h' }, 'From PSS'), ...found.map((x) => h('button', {
          onpointerdown: (e) => { e.preventDefault(); contact.value = x.name; K.lead = x.id; sugg.classList.add('hidden'); note.focus(); },
        }, h('b', {}, x.name), h('small', {}, [x.phone, x.email, x.city].filter(Boolean).join(' · ')), h('span', { class: 'lead-stage' }, stageLabel(x.stage)))));
        sugg.classList.toggle('hidden', !found.length);
        return;
      }
      const hits = [];
      for (const l of lists) {
        const f = listFields(l), st = rowStatus(l);
        for (const r of l.rows) {
          if (needle ? r.cells.some((x) => x.toLowerCase().includes(needle)) : !st.has(r.id)) hits.push({ l, r, f, x: st.get(r.id) });
          if (hits.length >= 40) break;
        }
      }
      hits.sort((a, b) => !!a.x - !!b.x);
      sugg.replaceChildren(
        h('small', { class: 'log-sugg-h' }, needle ? (hits.length ? 'From ' + lists[0].name : 'Not on ' + lists[0].name) : 'Up next'),
        ...hits.slice(0, 6).map(({ l, r, f, x }) => h('button', {
          onpointerdown: (e) => { e.preventDefault(); K.pick = { listId: l.id, rowId: r.id }; contact.blur(); renderCamps(); $('#camps .log-note')?.focus(); },
        }, h('b', {}, f.who(r)), h('small', {}, [r.cells[f.phone], r.cells[f.email]].filter(Boolean).join(' · ')), x ? h('span', { class: 'oc oc-' + c.outcomes.indexOf(x.outcome) }, x.outcome) : null)));
      sugg.classList.toggle('hidden', !lists.length || (!hits.length && !needle));
    };
    contact.addEventListener('input', suggest);
    contact.addEventListener('focus', suggest);
    contact.addEventListener('blur', () => sugg.classList.add('hidden'));
    contact.addEventListener('keydown', (e) => { if (e.key === 'Escape') sugg.classList.add('hidden'); });
    const f = picked && listFields(pl);
    const who = picked
      ? h('div', { class: 'log-row log-picked' },
          h('div', { class: 'crow-who' }, h('b', {}, f.who(picked)), h('small', {}, reachLinks(f, picked))),
          h('button', { class: 't-btn', 'aria-label': 'Pick someone else', html: I.close, onclick: () => { K.pick = null; renderCamps(); $('#camps .log-contact')?.focus(); } }))
      : h('div', { class: 'log-row' }, contact, h('button', { class: 't-btn', 'aria-label': 'Close', html: I.close, onclick: () => { K.logOpen = null; K.book = null; renderCamps(); } }));
    const bk = K.book;
    const log = async (outcome) => {
      const name = picked ? f.who(picked) : contact.value.trim();
      const leadId = !picked && K.lead && S.contacts?.find((x) => x.id === K.lead)?.name === name ? K.lead : undefined;
      if (bk && (!bk.date || !bk.time)) return toast('Pick a day and time for the meeting');
      try {
        const x = await api('POST', '/attempts', { campaignId: c.id, method: K.method, outcome, contact: name, note: note.value, answers: qs.filter((x) => ans[x.id]?.trim()).map((x) => ({ q: x.q, a: ans[x.id] })), leadId, ...(picked ? K.pick : {}) });
        if (!S.attempts.some((y) => y.id === x.id)) S.attempts.push(x);
        let booked = '';
        if (bk) {
          const [hh, mm] = bk.time.split(':').map(Number);
          const start = hh * 60 + mm;
          const e = await api('POST', '/entries', { text: `${name ? 'Meeting with ' + name : 'Meeting'} · ${c.name}${note.value.trim() ? '\n' + note.value.trim() : ''}`, date: bk.date, start, end: Math.min(1440, start + bk.mins), color: c.color });
          upsertEntry(e);
          booked = ` · on your schedule ${fmtDay(bk.date).rel || fmtDay(bk.date).long} ${fmtTime(start)}`;
          K.book = null;
        }
        contact.value = note.value = '';
        K.noteDraft[c.id] = '';
        K.answers[c.id] = {};
        K.pick = K.lead = null;
        toast(`Logged · ${outcome}${booked}`);
        renderCamps();
        $('#camps .log-contact')?.focus();
      } catch (e) {
        toast(e.message);
      }
    };
    // Book a meeting straight onto the schedule. A timed block also goes to your connected calendar.
    if (bk && !S.cals) loadCalendars().then(() => K.book && renderCamps());
    const cal = S.cals?.connections.find((x) => x.writeCalId && !x.error);
    const field = (el, key) => {
      el.value = bk[key];
      el.addEventListener('change', () => (bk[key] = key === 'mins' ? Number(el.value) : el.value));
      return el;
    };
    const booking = bk
      ? h('div', { class: 'log-book' },
          h('div', { class: 'log-book-row' },
            field(h('input', { type: 'date', 'aria-label': 'Meeting day' }), 'date'),
            field(h('input', { type: 'time', step: 900, 'aria-label': 'Meeting time' }), 'time'),
            field(h('select', { 'aria-label': 'How long' }, [15, 30, 45, 60, 90].map((n) => h('option', { value: n }, n < 60 ? `${n} min` : `${n / 60} hr`.replace('1.5 hr', '1½ hr')))), 'mins'),
            h('button', { class: 't-btn', 'aria-label': 'Don’t book', html: I.close, onclick: () => { K.book = null; document.activeElement?.blur(); renderCamps(); } })),
          h('small', { class: 'day-hint' }, `Goes on your schedule${cal ? ` and ${CAL_NAMES[cal.provider]}` : ''} when you tap how it went.`))
      : h('button', { class: 'link log-book-btn', onclick: () => { K.book = { date: todayKey(), time: '', mins: 30 }; document.activeElement?.blur(); renderCamps(); } }, '+ Book a meeting');
    const sources = all.length
      ? h('div', { class: 'seg log-from' }, [...all.map((l) => [l.id, l.name]), ['blank', 'Blank']].map(([id, label]) =>
          h('button', { class: id === from ? 'on' : '', title: id === 'blank' ? 'Log someone who isn’t on a list' : 'Log from ' + label, onclick: () => { K.logFrom[c.id] = id; K.pick = null; document.activeElement?.blur(); renderCamps(); $('#camps .log-contact')?.focus(); } }, label)))
      : null;
    return h('div', { class: 'logbox open' },
      sources,
      methods.length > 1 ? h('div', { class: 'seg log-methods' }, methods.map((m) => h('button', { class: m === K.method ? 'on' : '', onclick: () => { K.method = m; renderCamps(); $('#camps .log-contact')?.focus(); } }, m))) : null,
      h('div', { class: 'log-who' }, who, picked ? null : sugg),
      note,
      ask,
      booking,
      h('div', { class: 'log-outcomes' }, c.outcomes.map((o, i) => h('button', { class: 'oc oc-' + i, onclick: () => log(o) }, o))),
      list);
  }

  function openLog(c, { ask = false } = {}) {
    K.logOpen = ask || K.logOpen !== c.id ? c.id : null;
    if (ask) K.askOpen = true;
    if (!K.logOpen) K.book = null;
    renderCamps();
    $('#camps .logbox')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#camps .log-contact')?.focus();
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
    const notes = h('textarea', { rows: 6, placeholder: 'What did you find? What’s working, what isn’t, what’s next?' });
    const draft = h('button', { type: 'button', class: 'btn small ai-btn' }, '✨ Draft from the log');
    draft.addEventListener('click', async () => {
      const r = await aiRun(draft, 'report', { campaignId: c.id, since, stats });
      if (r) notes.value = notes.value.trim() ? `${notes.value.trim()}\n\n${r.text}` : r.text;
    });
    sheet(`Report · ${c.name}`, [
      task ? h('p', { class: 'day-hint' }, `Finishes “${task.text}”.`) : null,
      h('div', { class: 'report-stats' }, stats.map((l) => h('div', {}, l))),
      h('div', { class: 'report-findings-h' }, h('span', {}, 'Findings'), draft),
      notes,
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
    closeTool();
    const s = $('#settings');
    if (s.classList.toggle('hidden')) return;
    renderSettings();
  });
  // Opens Settings at the AI keys, for a smart button that needs one.
  function openSettings() {
    $('#settings').classList.remove('hidden');
    renderSettings();
    $('#settings .ai-sec')?.scrollIntoView({ block: 'start' });
  }

  function toggleRow(label, hint, checked, onChange) {
    const input = h('input', { type: 'checkbox' });
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked, input));
    return h('div', { class: 'srow' }, h('span', {}, label, hint ? h('small', {}, hint) : null), h('label', { class: 'toggle' }, input, h('i')));
  }

  // ---------- AI: smart buttons on your own API key ----------
  // Drafts for you to check: a report's findings, a campaign plan. Nothing changes until you accept it.
  async function loadAi() {
    try {
      S.ai = await api('GET', '/ai');
    } catch {
      return;
    }
    $('#settings .ai-sec')?.replaceWith(aiSection());
  }
  // Runs a smart button: shows it working, and points to Settings when there's no key yet.
  async function aiRun(btn, path, body) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    try {
      return await api('POST', '/ai/' + path, body);
    } catch (e) {
      if (/Settings → AI/.test(e.message)) toast(e.message, { label: 'Open Settings', run: () => { closeSheet(); openSettings(); } });
      else toast(e.message);
      return null;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
  function aiSection() {
    const sec = h('section', { class: 'ai-sec' }, h('h3', {}, 'AI'));
    const ai = S.ai;
    if (!ai) {
      sec.append(h('p', { class: 'day-hint' }, 'Loading…'));
      return sec;
    }
    sec.append(h('p', { class: 'day-hint' }, 'Smart buttons draft campaign reports and plans for you to check. They use your own key from Anthropic (Claude), OpenAI or Google (Gemini), and that provider bills you for what you use. Keys are stored encrypted on your team’s server and never sent back to the app.'));
    for (const [k, label] of Object.entries(ai.providers)) {
      const saved = ai.keys[k];
      const input = h('input', { type: 'password', placeholder: 'Paste your API key', autocomplete: 'off' });
      const save = h('button', { class: 'btn small primary-btn' }, 'Save');
      save.addEventListener('click', async () => {
        save.disabled = true;
        save.textContent = 'Checking…';
        try {
          S.ai = await api('PUT', '/ai/keys/' + k, { key: input.value });
          sec.replaceWith(aiSection());
        } catch (e) {
          toast(e.message);
          save.disabled = false;
          save.textContent = 'Save';
        }
      });
      const remove = h('button', { class: 'btn small danger' }, 'Remove');
      remove.addEventListener('click', () => confirmClick(remove, async () => {
        S.ai = await api('DELETE', '/ai/keys/' + k).catch((e) => (toast(e.message), S.ai));
        sec.replaceWith(aiSection());
      }));
      sec.append(h('div', { class: 'srow' },
        h('span', {}, label, h('small', {}, saved ? `Saved ····${saved.last4}` : 'Not added')),
        saved ? remove : h('span', { class: 'ai-key' }, input, save)));
    }
    if (ai.provider) {
      const set = (body) => api('PATCH', '/ai', body).then((x) => { S.ai = x; sec.replaceWith(aiSection()); }).catch((e) => toast(e.message));
      const prov = h('select', {}, Object.keys(ai.keys).map((k) => h('option', { value: k, selected: k === ai.provider }, ai.providers[k])));
      prov.addEventListener('change', () => set({ provider: prov.value }));
      const model = h('select', {}, ai.keys[ai.provider].models.map((m) => h('option', { value: m.id, selected: m.id === ai.model }, m.name)));
      model.addEventListener('change', () => set({ model: model.value }));
      sec.append(h('div', { class: 'srow' }, h('span', {}, 'Use'), h('span', { class: 'ai-key' }, Object.keys(ai.keys).length > 1 ? prov : null, model)));
    }
    return sec;
  }

  // Goals and tasks drafted from the brief. Tick what to keep, then add it.
  async function suggestPlan(c, btn) {
    if (!c.brief?.trim()) return toast('Write a brief first: the plan is made from it.');
    const r = await aiRun(btn, 'plan', { campaignId: c.id, today: todayKey() });
    if (!r) return;
    const picks = r.goals.map((g) => {
      const gb = h('input', { type: 'checkbox', checked: true });
      const tbs = g.tasks.map((t) => ({ t, cb: h('input', { type: 'checkbox', checked: true }) }));
      gb.addEventListener('change', () => tbs.forEach((x) => (x.cb.disabled = !gb.checked)));
      const what = g.kind === 'count' ? `Count ${g.target} ${[g.counts.join(' / '), g.methods.length ? g.methods.join(' / ').toLowerCase() + 's' : 'logged'].filter(Boolean).join(' ').toLowerCase()}` : 'Done when its tasks are';
      const el = h('div', { class: 'plan-goal' },
        h('label', { class: 'pick' }, gb, h('b', {}, g.title)),
        h('small', { class: 'day-hint' }, what + (g.due ? ` · by ${dueLabel(g.due)}` : '')),
        tbs.map(({ t, cb }) => h('label', { class: 'pick plan-task' }, cb, t.text, t.due ? h('small', {}, ' · ' + dueLabel(t.due)) : null)));
      return { g, gb, tbs, el };
    });
    sheet('Suggested plan', [
      h('p', { class: 'day-hint' }, 'Drafted from the brief. Untick anything you don’t want; you can edit everything after.'),
      ...picks.map((p) => p.el),
    ], async () => {
      let n = 0;
      for (const { g, gb, tbs } of picks) {
        if (!gb.checked) continue;
        const goal = await api('POST', '/goals', { campaignId: c.id, title: g.title, kind: g.kind, due: g.due, ...(g.kind === 'count' ? { target: g.target, counts: g.counts, methods: g.methods } : {}) });
        if (!S.goals.some((x) => x.id === goal.id)) S.goals.push(goal);
        for (const { t, cb } of tbs) if (cb.checked) upsertTask(await api('POST', '/tasks', { text: t.text, due: t.due, goalId: goal.id }));
        n++;
      }
      renderCamps();
      if (n) toast(`Added ${plural(n, 'goal')}`);
    }, 'Add to campaign');
  }

  // ---------- PSS admin: the business site's leads (owners only) ----------
  // Column reads them every 15 minutes. Owners can browse them, make live call lists from them, and pick
  // them in the Log. Nothing here changes PSS.
  const PSS_STAGES = ['new', 'contacted', 'visit_booked', 'quoted', 'approved', 'signed', 'sold', 'measure', 'ordered', 'installed', 'completed', 'lost'];
  const stagesIn = (all) => [...new Set(all.map((x) => x.stage))].sort((a, b) => (PSS_STAGES.indexOf(a) + 1 || 99) - (PSS_STAGES.indexOf(b) + 1 || 99));
  const stageLabel = (s) => { const t = String(s || '').replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
  async function loadPss() {
    if (!S.workspace || !amOwner()) {
      S.pss = S.contacts = S.mail = null;
      return;
    }
    try {
      S.pss = await api('GET', '/pss');
      S.contacts = S.pss.connected ? (await api('GET', '/pss/contacts')).leads : null;
      S.mail = S.pss.connected ? await api('GET', '/mail') : null;
      renderCamps();
      renderTool();
    } catch {
      return;
    }
    const sec = $('#settings .pss-sec');
    if (sec && !sec.contains(document.activeElement)) sec.replaceWith(pssSection());
  }
  function pssSection() {
    const sec = h('section', { class: 'pss-sec' }, h('h3', {}, 'PSS admin'));
    const p = S.pss;
    if (!p) {
      sec.append(h('p', { class: 'day-hint' }, 'Loading…'));
      return sec;
    }
    const redo = (x) => { S.pss = x; sec.replaceWith(pssSection()); };
    if (!p.connected) {
      const url = h('input', { type: 'url', placeholder: 'https://premiershadesolutions.com', value: 'https://premiershadesolutions.com', autocomplete: 'off' });
      const key = h('input', { type: 'password', placeholder: 'Paste the key from PSS', autocomplete: 'off' });
      const go = h('button', { class: 'btn small primary-btn' }, 'Connect');
      go.addEventListener('click', async () => {
        go.disabled = true;
        go.textContent = 'Connecting…';
        try {
          redo(await api('PUT', '/pss', { url: url.value, key: key.value }));
          loadPss();
        } catch (e) {
          toast(e.message);
          go.disabled = false;
          go.textContent = 'Connect';
        }
      });
      sec.append(h('p', { class: 'day-hint' }, 'Brings every lead’s name, phone, email, address, stage and source over from PSS, and keeps them current. Only team owners see them. In PSS admin, open Settings → Marketing → Column → Connect Column, and paste the key here.'),
        h('div', { class: 'pss-form' }, url, h('span', { class: 'ai-key' }, key, go)));
      return sec;
    }
    const sync = h('button', { class: 'btn small' }, p.syncing ? 'Syncing…' : 'Sync now');
    sync.disabled = !!p.syncing;
    sync.addEventListener('click', async () => {
      sync.disabled = true;
      sync.textContent = 'Syncing…';
      try {
        redo(await api('POST', '/pss/sync'));
        loadPss();
      } catch (e) {
        toast(e.message);
      }
    });
    const off = h('button', { class: 'btn small danger' }, 'Disconnect');
    off.addEventListener('click', () => confirmClick(off, async () => {
      redo(await api('DELETE', '/pss').catch((e) => (toast(e.message), S.pss)));
      S.contacts = null;
      renderCamps();
    }));
    sec.append(
      h('div', { class: 'srow' }, h('span', {}, new URL(p.url).host, h('small', {}, `Key ····${p.last4} · connected by ${p.by}`)), off),
      h('div', { class: 'srow' },
        h('span', {}, `${p.count.toLocaleString()} contact${p.count === 1 ? '' : 's'}`,
          h('small', { class: p.error ? 'err' : null }, p.error ? p.error : p.syncedAt ? [`Updated `, h('span', { 'data-ago': p.syncedAt }, ago(p.syncedAt)), p.dne ? ` · ${p.dne} don’t want email` : ''] : 'Not synced yet')),
        h('span', { class: 'ai-key' }, p.count ? h('button', { class: 'btn small', onclick: () => openTool('contacts') }, 'Contacts') : null, sync)));
    return sec;
  }
  // Everyone in PSS, kept current. Tick people to email them.
  const CT = { q: '', stage: '', picked: new Set() };
  function contactsTool() {
    if (!S.pss?.connected) return [h('p', { class: 'day-hint' }, 'Connect PSS admin in Settings to bring your leads and customers here. They stay current with your website.'), h('button', { class: 'btn small', onclick: () => { closeTool(); openSettings(); } }, 'Open Settings')];
    const all = [...(S.contacts || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const q = h('input', { type: 'search', value: CT.q, placeholder: 'Search name, phone, email, city', 'aria-label': 'Search contacts' });
    const stage = h('select', { 'aria-label': 'Stage' }, h('option', { value: '' }, 'All stages'), stagesIn(all).map((v) => h('option', { value: v, selected: CT.stage === v }, `${stageLabel(v)} · ${all.filter((x) => x.stage === v).length}`)));
    const count = h('p', { class: 'day-hint' });
    const box = h('div', { class: 'contacts contacts-tool' });
    const bar = h('div', { class: 'contacts-act hidden' });
    const no = noEmail();
    const act = () => {
      const n = CT.picked.size;
      bar.classList.toggle('hidden', !n);
      bar.replaceChildren(h('span', {}, `${n} selected`), h('button', { class: 'link', onclick: () => { CT.picked.clear(); show(); } }, 'Clear'),
        h('button', { class: 'btn small primary-btn', onclick: () => { const ps = all.filter((x) => CT.picked.has(x.id)); CT.picked.clear(); emailTo(ps.map((x) => ({ email: x.email, name: x.name, leadId: x.id }))); } }, `Email ${n}`));
    };
    const show = () => {
      CT.q = q.value;
      CT.stage = stage.value;
      const n = q.value.trim().toLowerCase();
      const hits = all.filter((x) => (!stage.value || x.stage === stage.value) && (!n || [x.name, x.phone, x.email, x.city, x.address].some((v) => v.toLowerCase().includes(n))));
      count.textContent = hits.length === all.length ? `${all.length.toLocaleString()} contacts` : `${hits.length.toLocaleString()} of ${all.length.toLocaleString()}`;
      box.replaceChildren(...hits.slice(0, 150).map((x) => {
        const can = MAIL_RE.test(x.email.trim()) && !no.has(x.email.toLowerCase());
        const cb = h('input', { type: 'checkbox', checked: CT.picked.has(x.id), disabled: !can, title: can ? 'Select to email' : x.email ? 'Unsubscribed' : 'No email address', 'aria-label': 'Select ' + x.name });
        cb.addEventListener('change', () => { if (cb.checked) CT.picked.add(x.id); else CT.picked.delete(x.id); act(); });
        return h('div', { class: 'contact contact-row' }, cb,
          h('div', { class: 'contact-main' },
            h('div', { class: 'contact-top' }, h('b', {}, x.name || '—'), h('span', { class: 'lead-stage' }, stageLabel(x.stage))),
            h('small', {}, [x.address, x.city, x.source, x.assignedTo ? '→ ' + x.assignedTo : ''].filter(Boolean).join(' · ')),
            h('small', { class: 'contact-reach' },
              x.phone ? h('a', { href: 'tel:' + x.phone.replace(/[^\d+]/g, '') }, x.phone) : null,
              x.email ? (x.dne ? h('span', { title: 'On the do-not-contact list' }, h('s', {}, x.email), ' · unsubscribed') : h('a', { href: 'mailto:' + x.email }, x.email)) : null)));
      }), hits.length > 150 ? h('p', { class: 'day-hint' }, 'Showing the newest 150. Search to narrow it down.') : null);
      act();
    };
    q.addEventListener('input', show);
    stage.addEventListener('change', show);
    show();
    return [h('div', { class: 'contacts-bar' }, q, stage), count, box, bar];
  }
  // A call list of the leads that match, kept in step with PSS.
  const LIVE_DAYS = [[0, 'Any time'], [30, 'Last 30 days'], [90, 'Last 90 days'], [180, 'Last 6 months'], [365, 'Last year']];
  function liveMatch(f, x, now) {
    const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    return (!f.stages.length || f.stages.includes(x.stage)) && (!f.cities.length || f.cities.some((c) => same(c, x.city)))
      && (!f.sources.length || f.sources.some((v) => same(v, x.source))) && (!f.days || (x.createdAt || 0) >= now - f.days * 864e5)
      && (f.need !== 'phone' || !!x.phone) && (f.need !== 'email' || (!!x.email && !x.dne));
  }
  function liveSheet(c, l) {
    const all = S.contacts || [];
    const f = l?.live || { stages: [], cities: [], sources: [], days: 0, need: null };
    const name = h('input', { value: l?.name || '', placeholder: 'Quoted, not sold' });
    const byCount = (key) => [...all.reduce((m, x) => (x[key] ? m.set(x[key], (m.get(x[key]) || 0) + 1) : m), new Map())].sort((a, b) => b[1] - a[1]);
    const stages = stagesIn(all).map((v) => ({ v, cb: h('input', { type: 'checkbox', checked: f.stages.includes(v) }) }));
    const one = (key, any, picked) => h('select', {}, h('option', { value: '' }, any), byCount(key).map(([v, n]) => h('option', { value: v, selected: picked.some((x) => x.toLowerCase() === v.toLowerCase()) }, `${v} · ${n}`)));
    const city = one('city', 'Any city', f.cities), source = one('source', 'Any source', f.sources);
    const days = h('select', {}, LIVE_DAYS.map(([v, t]) => h('option', { value: v, selected: f.days === v }, t)));
    const need = h('select', {}, [['', 'Anyone'], ['phone', 'Has a phone number'], ['email', 'Can be emailed']].map(([v, t]) => h('option', { value: v, selected: (f.need || '') === v }, t)));
    const count = h('p', { class: 'day-hint live-count' });
    const read = () => ({ stages: stages.filter((x) => x.cb.checked).map((x) => x.v), cities: city.value ? [city.value] : [], sources: source.value ? [source.value] : [], days: Number(days.value), need: need.value || null });
    const update = () => {
      const n = all.filter((x) => liveMatch(read(), x, Date.now())).length;
      count.textContent = `${n.toLocaleString()} lead${n === 1 ? '' : 's'} right now. New matches join by themselves; anyone who stops matching leaves.`;
    };
    for (const el of [city, source, days, need, ...stages.map((x) => x.cb)]) el.addEventListener('change', update);
    update();
    sheet(l ? 'Who’s on this list' : 'Live list from PSS', [
      h('label', {}, 'Name', name),
      h('div', { class: 'live-field' }, 'Stage', h('div', { class: 'live-stages' }, stages.map((x) => h('label', { class: 'pick' }, x.cb, stageLabel(x.v))))),
      h('div', { class: 'row2' }, h('label', {}, 'City', city), h('label', {}, 'Source', source)),
      h('div', { class: 'row2' }, h('label', {}, 'Added', days), h('label', {}, 'Who', need)),
      count,
      l ? null : h('p', { class: 'day-hint' }, 'Everyone in this campaign will see these contacts.'),
    ], async () => {
      const body = { name: name.value.trim() || 'PSS leads', live: read() };
      const x = l ? await api('PATCH', '/lists/' + l.id, body) : await api('POST', '/lists', { campaignId: c.id, ...body });
      const i = S.lists.findIndex((y) => y.id === x.id);
      if (i >= 0) S.lists[i] = x;
      else S.lists.push(x);
      K.listOpen = x.id;
      renderCamps();
      if (!l) toast(`Added ${x.name} · ${x.rows.length} lead${x.rows.length === 1 ? '' : 's'}`);
    }, l ? 'Save' : 'Add to campaign');
  }

  // ---------- tools: small apps that open in a drawer, so the tabs stay as they are ----------
  const TOOLS = { bills: { name: 'Bills', render: billsTool }, contacts: { name: 'Contacts', render: contactsTool }, email: { name: 'Email', render: emailTool }, meetings: { name: 'Meeting notes', render: meetingsTool } };
  let toolOpen = null;
  $('#toolsBtn').addEventListener('click', (e) => {
    const soon = billsSoon().length;
    openMenu(e.currentTarget, [
      { head: 'Tools' },
      { label: h('span', { class: 'tool-item' }, 'Bills', soon ? h('small', {}, `${soon} due soon`) : null), on: toolOpen === 'bills', run: () => openTool('bills') },
      amOwner() ? { label: h('span', { class: 'tool-item' }, 'Contacts', S.contacts?.length ? h('small', {}, S.contacts.length.toLocaleString()) : null), on: toolOpen === 'contacts', run: () => openTool('contacts') } : null,
      amOwner() ? { label: h('span', { class: 'tool-item' }, 'Email', (S.mail?.sends || []).some((x) => x.status === 'sending') ? h('small', {}, 'sending…') : null), on: toolOpen === 'email', run: () => openTool('email') } : null,
      { label: 'Meeting notes', on: toolOpen === 'meetings', run: () => openTool('meetings') },
      R.on ? null : { label: '● Record a meeting', run: () => askRecord('') },
    ].filter(Boolean));
  });
  function openTool(name) {
    toolOpen = name;
    $('#settings').classList.add('hidden');
    $('#tool').classList.remove('hidden');
    renderTool();
  }
  function closeTool() {
    toolOpen = null;
    $('#tool').classList.add('hidden');
  }
  function renderTool() {
    const el = $('#tool');
    if (!toolOpen || el.classList.contains('hidden')) return;
    if (el.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
    const keep = el.scrollTop;
    el.replaceChildren(h('h2', {}, TOOLS[toolOpen].name, h('button', { class: 'icon-btn', html: I.close, 'aria-label': 'Close', onclick: closeTool })), ...TOOLS[toolOpen].render().filter(Boolean));
    el.scrollTop = keep;
  }

  // ----- bills -----
  const money = (cents) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 });
  const BILL_REPEATS = [['monthly', 'Every month'], ['weekly', 'Every week'], ['quarterly', 'Every 3 months'], ['yearly', 'Every year'], ['once', 'Just once']];
  const PER_MONTH = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, once: 0 };
  const billsLive = () => (S.bills || []).filter((b) => !b.done);
  const billsSoon = () => billsLive().filter((b) => b.due <= addDays(todayKey(), 7));
  // A bill shows on the day it's due; on today, so do any that are late.
  const billsDueOn = (k) => billsLive().filter((b) => b.due === k || (k === todayKey() && b.due < k)).sort((a, b) => (a.due < b.due ? -1 : 1));
  const billLate = (b) => !b.done && b.due < todayKey();
  async function payBill(b, undo) {
    try {
      const x = await api('POST', `/bills/${b.id}/paid`, undo ? { undo: true } : {});
      S.bills = S.bills.map((y) => (y.id === x.id ? x : y));
      renderDay();
      renderTool();
      if (!undo) toast(`Paid ${b.name} · ${money(b.amount)}` + (x.done ? '' : ` · next due ${dueLabel(x.due)}`), { label: 'Undo', run: () => payBill(x, true) });
    } catch (e) {
      toast(e.message);
    }
  }
  function billDayRow(b) {
    return h('div', { class: 'any-row bill-day' + (billLate(b) ? ' late' : ''), onclick: () => openTool('bills') },
      h('button', { class: 'check', html: I.check, title: 'Mark paid', 'aria-label': 'Mark paid', onclick: (ev) => { ev.stopPropagation(); payBill(b); } }),
      h('span', { class: 'p-text' }, b.name, h('small', { class: 'bill-amt' }, ' · ' + money(b.amount)),
        b.autopay ? h('small', { class: 'bill-tag' }, 'autopay') : null,
        billLate(b) ? h('small', { class: 'bill-tag late' }, `due ${dueLabel(b.due)}`) : null));
  }
  function billRow(b) {
    const late = billLate(b);
    return h('div', { class: 'bill' + (late ? ' late' : ''), onclick: () => billSheet(b) },
      h('button', { class: 'check', html: I.check, title: 'Mark paid', 'aria-label': 'Mark paid', onclick: (ev) => { ev.stopPropagation(); payBill(b); } }),
      h('span', { class: 'bill-name' }, b.name,
        h('small', {}, [b.scope === 'business' ? 'Business' : null, b.autopay ? 'Autopay' : null, b.repeat === 'once' ? null : BILL_REPEATS.find((r) => r[0] === b.repeat)?.[1].toLowerCase()].filter(Boolean).join(' · '))),
      h('span', { class: 'bill-right' }, h('b', {}, money(b.amount)), h('small', { class: late ? 'late' : null }, late ? `late · ${dueLabel(b.due)}` : dueLabel(b.due))));
  }
  let billScope = store.get('billScope', 'all');
  function billsTool() {
    const all = billsLive().filter((b) => billScope === 'all' || b.scope === billScope).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.name.localeCompare(b.name)));
    const today = todayKey();
    const groups = [
      ['Late', all.filter((b) => b.due < today)],
      ['Next 7 days', all.filter((b) => b.due >= today && b.due <= addDays(today, 7))],
      ['Later', all.filter((b) => b.due > addDays(today, 7))],
    ].filter(([, xs]) => xs.length);
    const perMonth = (xs) => Math.round(xs.reduce((n, b) => n + b.amount * PER_MONTH[b.repeat], 0));
    const in30 = all.filter((b) => b.due <= addDays(today, 30)).reduce((n, b) => n + b.amount, 0);
    const mine = billsLive();
    const hasBiz = mine.some((b) => b.scope === 'business');
    const set = (v) => { billScope = v; store.set('billScope', v); renderTool(); };
    const paid = (S.bills || []).flatMap((b) => (b.paid || []).map((p) => ({ b, p }))).filter(({ b }) => billScope === 'all' || b.scope === billScope).sort((x, y) => y.p.at - x.p.at).slice(0, 12);
    return [
      hasBiz ? h('div', { class: 'seg' }, [['all', 'All'], ['personal', 'Personal'], ['business', 'Business']].map(([v, t]) => h('button', { class: billScope === v ? 'on' : null, onclick: () => set(v) }, t))) : null,
      all.length ? h('div', { class: 'bill-sum' },
        h('div', {}, h('small', {}, 'Due in the next 30 days'), h('b', {}, money(in30))),
        h('div', {}, h('small', {}, 'A month, on average'), h('b', {}, money(perMonth(all))),
          hasBiz && billScope === 'all' ? h('small', {}, `${money(perMonth(all.filter((b) => b.scope === 'personal')))} personal · ${money(perMonth(all.filter((b) => b.scope === 'business')))} business`) : null)) : null,
      ...groups.map(([t, xs]) => h('section', {}, h('h3', { class: t === 'Late' ? 'late' : null }, t), xs.map(billRow))),
      h('button', { class: 'add-goal', onclick: () => billSheet() }, '+ Add a bill'),
      all.length ? null : h('p', { class: 'day-hint' }, 'Add what you pay and when. Each bill shows on your Day when it’s due, and ticking it moves it to the next one. Personal bills are only yours; business bills are shared with the team’s owners.'),
      paid.length ? h('details', { class: 'bill-paid' }, h('summary', {}, 'Paid recently'),
        paid.map(({ b, p }) => h('div', { class: 'bill-hist' }, h('span', {}, b.name, h('small', {}, ` · due ${dueLabel(p.due)}${p.auto ? ' · autopay' : ''}`)), h('span', {}, money(p.amount))))) : null,
    ];
  }
  function billSheet(b) {
    const name = h('input', { value: b?.name || '', placeholder: 'Electric, Rent, Truck loan…' });
    const amount = h('input', { value: b ? (b.amount / 100).toFixed(2) : '', placeholder: '0.00', inputmode: 'decimal' });
    const due = h('input', { type: 'date', value: b?.due || todayKey() });
    const repeat = h('select', {}, BILL_REPEATS.map(([v, t]) => h('option', { value: v, selected: (b?.repeat || 'monthly') === v }, t)));
    const mineOrNew = !b || b.memberId === S.me?.memberId;
    const scope = h('select', { disabled: !mineOrNew || (!amOwner() && b?.scope !== 'business') }, h('option', { value: 'personal' }, 'Personal · only you'), h('option', { value: 'business', selected: b?.scope === 'business' }, 'Business · shared with owners'));
    const autopay = h('input', { type: 'checkbox', checked: !!b?.autopay });
    const note = h('input', { value: b?.note || '', placeholder: 'Account number, how you pay… (optional)' });
    const del = b ? h('button', { class: 'btn small danger', 'data-label': '1' }, 'Delete bill') : null;
    del?.addEventListener('click', () => confirmClick(del, async () => {
      await api('DELETE', '/bills/' + b.id).catch((e) => toast(e.message));
      S.bills = S.bills.filter((x) => x.id !== b.id);
      closeSheet();
      renderDay();
      renderTool();
    }));
    sheet(b ? 'Edit bill' : 'New bill', [
      h('label', {}, 'Name', name),
      h('div', { class: 'row2' }, h('label', {}, 'Amount ($)', amount), h('label', {}, b ? 'Next due' : 'Due', due)),
      h('div', { class: 'row2' }, h('label', {}, 'Repeats', repeat), h('label', {}, 'Kind', scope)),
      h('label', { class: 'pick' }, autopay, 'Autopay: mark it paid by itself after it’s due'),
      h('label', {}, 'Note', note),
      del,
    ], async () => {
      const body = { name: name.value, amount: amount.value, due: due.value, repeat: repeat.value, autopay: autopay.checked, note: note.value, tz: myTz(), ...(mineOrNew ? { scope: scope.value } : {}) };
      const x = b ? await api('PATCH', '/bills/' + b.id, body) : await api('POST', '/bills', body);
      S.bills = [...S.bills.filter((y) => y.id !== x.id), x];
      renderDay();
      renderTool();
    }, b ? 'Save' : 'Add bill');
  }

  // ----- meeting notes: record a call, then review notes drafted from it -----
  // Records the microphone plus, when shared, the call's own sound, mixed into one track and sent up in
  // 10-second pieces as it goes, so closing the window loses at most the last few seconds.
  const R = { on: null };
  const REC_MAX = 115 * 60_000;
  const MEET_STATE = { recording: 'Recording', transcribing: 'Transcribing…', drafting: 'Writing notes…', ready: 'Ready to review', failed: 'Didn’t work', saved: 'Saved' };
  function askRecord(title, entryId) {
    if (R.on) return toast('Already recording');
    if (!navigator.mediaDevices?.getUserMedia) return toast('Recording works in the Column desktop app, or in a browser on this computer.');
    const name = h('input', { value: title || '', placeholder: 'Meeting with…' });
    sheet('Record a meeting', [
      h('label', {}, 'What is it', name),
      h('p', { class: 'day-hint' }, desktop ? 'Column records your microphone and the sound from your computer, so both sides of the call are heard.' : 'Column records your microphone. Next, pick the window or tab with the call and turn on “Share audio” so the other side is heard too.'),
      h('p', { class: 'day-hint' }, 'Let everyone on the call know you’re recording. When you stop, you’ll get a summary and next steps to check before anything is saved.'),
    ], () => startRecording(name.value.trim() || 'Meeting', entryId), 'Start recording');
  }
  async function startRecording(title, entryId) {
    let mic, call;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      throw new Error('Column can’t use the microphone. Allow it in your browser or system settings, then try again.');
    }
    try {
      const d = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include', selfBrowserSurface: 'exclude' });
      for (const t of d.getVideoTracks()) t.stop();
      if (d.getAudioTracks().length) call = d;
    } catch {}
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    for (const st of [mic, call].filter(Boolean)) ctx.createMediaStreamSource(st).connect(dest);
    await ctx.resume().catch(() => {});
    let meeting;
    try {
      meeting = await api('POST', '/meetings', { title, entryId, mic: true, call: !!call });
    } catch (e) {
      for (const st of [mic, call].filter(Boolean)) st.getTracks().forEach((t) => t.stop());
      ctx.close();
      throw e;
    }
    const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const rec = new MediaRecorder(dest.stream, { mimeType: type, audioBitsPerSecond: 24000 });
    const r = (R.on = { meeting, rec, ctx, streams: [mic, call].filter(Boolean), seq: 0, chain: Promise.resolve(), started: Date.now(), call: !!call, failed: false });
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      const n = r.seq++;
      r.chain = r.chain.then(() => sendPiece(r, e.data, n));
    };
    rec.onstop = () => { r.chain = r.chain.then(() => api('POST', `/meetings/${meeting.id}/stop`)).then((x) => upsertMeeting(x)).catch((e) => toast(e.message)); };
    rec.start(10_000);
    r.timer = setTimeout(() => { toast('Recordings stop at about two hours'); stopRecording(); }, REC_MAX);
    r.tick = setInterval(renderRec, 1000);
    r.bytes = 0;
    // A silent recorder (audio blocked, no microphone signal) shows up as nothing arriving.
    r.check = setTimeout(() => { if (R.on === r && !r.bytes) toast('Nothing is being recorded yet. Check the microphone, then stop and start again.'); }, 15_000);
    call?.getAudioTracks()[0]?.addEventListener('ended', () => { r.call = false; renderRec(); toast('Call sound stopped. Still recording your microphone.'); });
    if (!call) toast('Recording your microphone only');
    upsertMeeting(meeting);
    renderDay();
  }
  async function sendPiece(r, blob, n) {
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(`/api/meetings/${r.meeting.id}/audio?seq=${n}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + S.token }, body: blob });
        if (res.ok) return void (r.bytes += blob.size);
        if (res.status === 413) return stopRecording();
      } catch {}
      await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
    }
    if (!r.failed) toast('Part of the recording didn’t upload. Check the connection.');
    r.failed = true;
  }
  function stopRecording() {
    const r = R.on;
    if (!r) return;
    R.on = null;
    clearTimeout(r.timer);
    clearTimeout(r.check);
    clearInterval(r.tick);
    if (r.rec.state !== 'inactive') r.rec.stop();
    for (const st of r.streams) st.getTracks().forEach((t) => t.stop());
    r.ctx.close();
    renderRec();
    renderDay();
  }
  function upsertMeeting(x) {
    S.meetings = [x, ...(S.meetings || []).filter((y) => y.id !== x.id)];
    renderRec();
    renderTool();
  }
  // The floating pill: recording time and Stop, then progress, then "Review" when the notes are ready.
  function renderRec() {
    let el = $('#rec');
    const busy = (S.meetings || []).find((x) => x.status === 'transcribing' || x.status === 'drafting');
    const ready = (S.meetings || []).filter((x) => x.status === 'ready');
    if (!R.on && !busy && !ready.length) return el?.remove();
    if (!el) document.body.append((el = h('div', { id: 'rec', class: 'rec' })));
    if (R.on) {
      const s = Math.floor((Date.now() - R.on.started) / 1000);
      el.className = 'rec on';
      return el.replaceChildren(h('span', { class: 'rec-dot' }), h('b', {}, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`),
        h('span', { class: 'rec-what' }, R.on.meeting.title, h('small', {}, R.on.call ? ' · mic + call' : ' · mic only')),
        h('button', { class: 'btn small', onclick: stopRecording }, 'Stop'));
    }
    el.className = 'rec';
    if (busy) return el.replaceChildren(h('span', { class: 'rec-spin' }), h('span', { class: 'rec-what' }, busy.title, h('small', {}, ' · ' + MEET_STATE[busy.status])));
    el.replaceChildren(h('span', { class: 'rec-what' }, ready.length > 1 ? `${ready.length} meetings` : ready[0].title, h('small', {}, ' · notes ready')),
      h('button', { class: 'btn small primary-btn', onclick: () => meetingSheet(ready[0]) }, 'Review'));
  }
  function meetingsTool() {
    const xs = S.meetings || [];
    return [
      R.on ? null : h('button', { class: 'add-goal', onclick: () => askRecord('') }, '● Record a meeting'),
      xs.length ? null : h('p', { class: 'day-hint' }, 'Record a call and Column writes the notes: a summary, decisions and next steps, tied to the right campaign. Meetings happening now also get a Record button on your Day.'),
      ...xs.map((x) => h('div', { class: 'bill', onclick: () => meetingSheet(x) },
        h('span', { class: 'bill-name' }, x.draft?.title || x.title, h('small', {}, `${new Date(x.startedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${Math.max(1, Math.round(((x.endedAt || Date.now()) - x.startedAt) / 60000))} min`)),
        h('span', { class: 'bill-right' }, h('small', { class: x.status === 'failed' ? 'late' : null }, MEET_STATE[x.status])))),
    ];
  }
  function meetingSheet(x) {
    x = (S.meetings || []).find((y) => y.id === x.id) || x;
    const del = h('button', { class: 'btn small danger', 'data-label': '1' }, 'Delete recording and notes');
    del.addEventListener('click', () => confirmClick(del, async () => {
      await api('DELETE', '/meetings/' + x.id).catch((e) => toast(e.message));
      S.meetings = S.meetings.filter((y) => y.id !== x.id);
      closeSheet();
      renderRec();
      renderTool();
    }));
    if (x.status === 'saved') {
      const note = x.noteId && S.items.find((it) => it.id === x.noteId);
      if (note) return openPreview(note);
      return sheet(x.title, [h('p', { class: 'day-hint' }, 'These notes were saved, and the note has since been removed.'), del], () => {}, 'Close');
    }
    if (x.status !== 'ready') {
      const retry = x.status === 'failed' ? h('button', { class: 'btn small', onclick: () => api('POST', `/meetings/${x.id}/retry`).then((y) => { upsertMeeting(y); closeSheet(); }).catch((e) => toast(e.message)) }, 'Try again') : null;
      return sheet(x.title, [h('p', { class: x.status === 'failed' ? 'err' : 'day-hint', style: 'text-align:left' }, x.status === 'failed' ? x.error || 'Didn’t work.' : MEET_STATE[x.status]), h('div', { class: 'btns' }, retry, del)], () => {}, 'Close');
    }
    const d = x.draft;
    const camps = S.campaigns.filter((c) => c.status !== 'done');
    const title = h('input', { value: d.title });
    const body = h('textarea', { rows: 9 });
    body.value = [...d.summary.map((t) => '- ' + t), ...(d.decisions.length ? ['', 'Decided', ...d.decisions.map((t) => '- ' + t)] : [])].join('\n');
    const camp = h('select', {}, h('option', { value: '' }, 'No campaign · keep it in my notes'), camps.map((c) => h('option', { value: c.id, selected: c.id === d.campaignId }, c.name)));
    const actBox = h('div', { class: 'meet-acts' });
    const acts = d.actions.map((a) => ({ a, cb: h('input', { type: 'checkbox', checked: true }), goal: h('select', { 'aria-label': 'Goal' }) }));
    const logRow = h('div', { class: 'meet-log' });
    const logOn = h('input', { type: 'checkbox', checked: !!d.outcome });
    const contact = h('input', { value: d.contact || '', placeholder: 'Who you met', 'aria-label': 'Who you met' });
    const outcome = h('select', { 'aria-label': 'Outcome' });
    const fill = () => {
      const c = campById(camp.value);
      for (const { a, goal } of acts) {
        goal.replaceChildren(h('option', { value: '' }, c ? 'My tasks' : 'My tasks'), ...(c ? goalsOf(c.id).map((g) => h('option', { value: g.id, selected: g.id === a.goalId }, g.title)) : []));
        goal.disabled = !c;
      }
      outcome.replaceChildren(...(c ? c.outcomes.map((o) => h('option', { value: o, selected: o === d.outcome }, o)) : []));
      logRow.classList.toggle('hidden', !c);
    };
    camp.addEventListener('change', fill);
    fill();
    actBox.append(...acts.map(({ a, cb, goal }) => h('div', { class: 'meet-act' }, h('label', { class: 'pick' }, cb, h('span', {}, a.text, a.due || a.who ? h('small', {}, ` · ${[a.who, a.due && dueLabel(a.due)].filter(Boolean).join(' · ')}`) : null)), goal)));
    logRow.append(h('label', { class: 'pick' }, logOn, 'Log it in the campaign'), h('div', { class: 'row2' }, contact, outcome));
    sheet('Meeting notes', [
      h('label', {}, 'Title', title),
      h('label', {}, 'Notes', body),
      h('label', {}, 'Goes with', camp),
      acts.length ? h('div', { class: 'live-field' }, 'Next steps · ticked ones become tasks', actBox) : null,
      logRow,
      x.transcript ? h('details', { class: 'meet-tx' }, h('summary', {}, 'Transcript'), h('pre', {}, x.transcript)) : null,
      del,
    ], async () => {
      const c = campById(camp.value);
      const keep = acts.filter((y) => y.cb.checked);
      const text = [title.value.trim() || 'Meeting', new Date(x.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }), '', body.value.trim(), ...(keep.length ? ['', 'Next steps', ...keep.map(({ a }) => '- ' + a.text)] : [])].join('\n');
      const note = await api('POST', '/items', { type: 'text', text, stackId: c?.stackId || null });
      await api('PATCH', '/items/' + note.id, { pinned: true }).catch(() => {});
      for (const { a, goal } of keep) upsertTask(await api('POST', '/tasks', { text: a.text, due: a.due, goalId: c && goal.value ? goal.value : null, assigneeId: a.who ? memberByName(a.who) : null }));
      if (c && logOn.checked && outcome.value) {
        const at = await api('POST', '/attempts', { campaignId: c.id, method: c.methods?.includes('Meeting') ? 'Meeting' : null, outcome: outcome.value, contact: contact.value.trim(), note: title.value.trim(), leadId: d.leadId || undefined });
        if (!S.attempts.some((y) => y.id === at.id)) S.attempts.push(at);
      }
      upsertMeeting(await api('POST', `/meetings/${x.id}/saved`, { noteId: note.id, campaignId: c?.id || null }));
      renderCamps();
      toast(`Saved the notes${keep.length ? ` · ${keep.length} task${keep.length === 1 ? '' : 's'}` : ''}${c ? ' · ' + c.name : ''}`);
    }, 'Save notes');
  }

  // ----- Email: one email to each person, from your Outlook -----
  // Who gets it is built up from Contacts, a list, or addresses typed or pasted in, and can be logged in a
  // campaign. Each person gets their own email, addressed only to them.
  const MAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[a-z]{2,}$/i;
  const M = { to: [], subject: '', body: '', campaignId: '', showAll: false, armed: false, preview: false };
  const mergeText = (t, r) => t.replace(/\{\s*first\s*name\s*\}/gi, r?.first || 'there').replace(/\{\s*name\s*\}/gi, r?.name || 'there');
  const firstOf = (name) => {
    const w = String(name || '').trim().split(/\s+/)[0];
    return /^\p{L}[\p{L}'’-]*$/u.test(w) ? w : '';
  };
  const noEmail = () => new Set((S.contacts || []).filter((x) => x.dne).map((x) => x.email.toLowerCase()));
  // Adds people, each address once. Returns how many were new.
  function mailAdd(people) {
    const have = new Set(M.to.map((r) => r.email));
    let n = 0;
    for (const p of people) {
      const email = String(p.email || '').trim().toLowerCase();
      if (!MAIL_RE.test(email) || have.has(email)) continue;
      have.add(email);
      M.to.push({ ...p, email, name: p.name || '', first: p.first ?? firstOf(p.name) });
      n++;
    }
    M.armed = false;
    return n;
  }
  function emailTo(people) {
    const n = mailAdd(people);
    openTool('email');
    toast(n ? `Added ${n} to the email` : 'They’re already on it');
  }
  // Addresses from pasted text or a file: "Name <a@b.co>", CSV rows, or bare addresses.
  function readAddresses(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) {
      const cells = line.split(/[,;\t]/).map((x) => x.trim().replace(/^"|"$/g, ''));
      for (const m of line.matchAll(/(?:"?([^"<>,;\t]*?)"?\s*<)?([^\s<>",;]+@[^\s<>",;]+\.[a-z]{2,})>?/gi)) {
        const name = (m[1] || '').trim() || cells.find((x) => x && !x.includes('@') && !/^[\d\s()+.-]{7,}$/.test(x) && x.length < 60) || '';
        out.push({ email: m[2], name });
      }
    }
    return out;
  }
  function pickContacts() {
    const no = noEmail();
    const all = (S.contacts || []).filter((x) => MAIL_RE.test(x.email.trim()) && !no.has(x.email.toLowerCase())).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const q = h('input', { type: 'search', placeholder: 'Search name, email, city', 'aria-label': 'Search contacts' });
    const stage = h('select', { 'aria-label': 'Stage' }, h('option', { value: '' }, 'All stages'), stagesIn(all).map((v) => h('option', { value: v }, `${stageLabel(v)} · ${all.filter((x) => x.stage === v).length}`)));
    const picked = new Set();
    const box = h('div', { class: 'contacts' });
    const allBox = h('input', { type: 'checkbox' });
    const hits = () => {
      const n = q.value.trim().toLowerCase();
      return all.filter((x) => (!stage.value || x.stage === stage.value) && (!n || [x.name, x.email, x.city].some((v) => v.toLowerCase().includes(n))));
    };
    const label = () => { const b = $('#sheet .btns .primary-btn'); if (b) b.textContent = picked.size ? `Add ${picked.size}` : 'Add'; };
    const show = () => {
      const xs = hits();
      allBox.checked = xs.length > 0 && xs.every((x) => picked.has(x.id));
      box.replaceChildren(...xs.slice(0, 300).map((x) => {
        const cb = h('input', { type: 'checkbox', checked: picked.has(x.id) });
        cb.addEventListener('change', () => { if (cb.checked) picked.add(x.id); else picked.delete(x.id); label(); });
        return h('label', { class: 'pick contact-pick' }, cb, h('span', {}, h('b', {}, x.name || x.email), h('small', {}, ` · ${x.email} · ${stageLabel(x.stage)}`)));
      }), xs.length > 300 ? h('p', { class: 'day-hint' }, `Showing 300 of ${xs.length}. “Select all” takes all ${xs.length}.`) : null);
    };
    allBox.addEventListener('change', () => { for (const x of hits()) allBox.checked ? picked.add(x.id) : picked.delete(x.id); show(); label(); });
    q.addEventListener('input', show);
    stage.addEventListener('change', show);
    show();
    sheet('Add from Contacts', [
      h('div', { class: 'contacts-bar' }, q, stage),
      h('label', { class: 'pick' }, allBox, 'Select all shown'),
      box,
      h('p', { class: 'day-hint' }, 'Only contacts with an email address who haven’t unsubscribed are here.'),
    ], () => {
      mailAdd(all.filter((x) => picked.has(x.id)).map((x) => ({ email: x.email, name: x.name, leadId: x.id })));
      renderTool();
    }, 'Add');
  }
  function pickList() {
    const lists = S.lists.filter((l) => kindOf(l) === 'calls' && listFields(l).email >= 0 && campById(l.campaignId));
    if (!lists.length) return toast('None of your campaigns has a list with email addresses yet.');
    const pick = h('select', {}, lists.map((l) => h('option', { value: l.id }, `${l.name} · ${campById(l.campaignId).name}`)));
    const fresh = h('input', { type: 'checkbox' });
    const info = h('p', { class: 'day-hint' });
    const people = () => {
      const l = lists.find((x) => x.id === pick.value), f = listFields(l), st = rowStatus(l);
      return l.rows.filter((r) => !(fresh.checked && st.has(r.id))).map((r) => ({ email: r.cells[f.email], name: f.who(r) === '—' ? '' : f.who(r), first: f.first(r), listId: l.id, rowId: r.id, dne: r.dne }))
        .filter((p) => MAIL_RE.test(String(p.email || '').trim()) && !p.dne);
    };
    const update = () => (info.textContent = `${people().length} with an email address`);
    pick.addEventListener('change', update);
    fresh.addEventListener('change', update);
    update();
    sheet('Add from a list', [h('label', {}, 'List', pick), h('label', { class: 'pick' }, fresh, 'Only people not contacted yet'), info], () => {
      mailAdd(people());
      renderTool();
    }, 'Add');
  }
  function pickTyped() {
    const ta = h('textarea', { rows: 6, placeholder: 'pat@example.com\nSam Lee <sam@example.com>\nor paste rows from a spreadsheet' });
    const file = h('input', { type: 'file', accept: '.csv,.txt,text/csv,text/plain', class: 'hidden' });
    const info = h('p', { class: 'day-hint' });
    const update = () => (info.textContent = `${readAddresses(ta.value).length} address${readAddresses(ta.value).length === 1 ? '' : 'es'} found`);
    ta.addEventListener('input', update);
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (f) ta.value = [ta.value.trim(), (await f.text()).slice(0, 2_000_000)].filter(Boolean).join('\n');
      update();
    });
    update();
    sheet('Type or paste addresses', [ta, h('div', { class: 'mail-tools' }, info, h('button', { class: 'btn small', onclick: () => file.click() }, 'Choose a file…')), file], () => {
      mailAdd(readAddresses(ta.value));
      renderTool();
    }, 'Add');
  }
  function emailTool() {
    const m = S.mail;
    if (!S.pss?.connected) return [h('p', { class: 'day-hint' }, 'Connect PSS admin in Settings first. Every email carries an unsubscribe link, and those come from your website.'), h('button', { class: 'btn small', onclick: () => { closeTool(); openSettings(); } }, 'Open Settings')];
    if (!m) return [h('p', { class: 'day-hint' }, 'Loading…')];
    if (!m.from) {
      const go = h('button', { class: 'btn primary-btn' }, 'Connect Outlook');
      go.addEventListener('click', async () => {
        try {
          const { url } = await api('POST', '/calendars/connect', { provider: 'microsoft', tz: myTz(), mail: true });
          window.open(url, '_blank');
          toast('Finish signing in in your browser. This updates when it’s done.');
        } catch (e) {
          toast(e.message);
        }
      });
      return [h('p', { class: 'day-hint' }, 'Emails go out from your own Outlook, so replies land in your inbox and they show in your Sent folder. Connect it once and allow Column to send email for you.'),
        m.canConnect ? go : h('p', { class: 'day-hint' }, 'Outlook sign-in isn’t set up on this server yet. See “Calendars” in the README.'), sendBars(null)];
    }
    const no = noEmail();
    const out = M.to.filter((r) => no.has(r.email));
    const to = M.to.filter((r) => !no.has(r.email));
    const rerender = () => { document.activeElement?.blur(); renderTool(); };
    const shown = M.showAll ? M.to : M.to.slice(0, 6);
    const subject = h('input', { value: M.subject, placeholder: 'Subject', 'aria-label': 'Subject', maxlength: 200 });
    const body = h('textarea', { rows: 8, placeholder: 'Hi {first name},\n\n…', 'aria-label': 'Message' });
    body.value = M.body;
    const footer = h('textarea', { rows: 2, placeholder: 'Premier Shade Solutions\n123 Main St, Henderson, NV 89002', 'aria-label': 'Footer' });
    footer.value = m.footer || '';
    const camp = h('select', { 'aria-label': 'Log it in' }, h('option', { value: '' }, 'Don’t log it'), S.campaigns.filter((c) => c.status !== 'done').map((c) => h('option', { value: c.id, selected: c.id === M.campaignId }, c.name)));
    const preview = h('pre', { class: 'mail-preview' + (M.preview ? '' : ' hidden') });
    const sendBtn = h('button', { class: 'btn primary-btn' });
    const warn = h('small', { class: 'day-hint mail-warn' });
    const update = () => {
      Object.assign(M, { subject: subject.value, body: body.value, campaignId: camp.value });
      m.footer = footer.value;
      const r = to[0];
      preview.textContent = `To: ${r ? (r.name ? `${r.name} <${r.email}>` : r.email) : '—'}\nSubject: ${mergeText(subject.value, r)}\n\n${mergeText(body.value, r).trim()}\n\n--\n${footer.value.trim() || '(your business and mailing address)'}\nDon’t want these emails? Unsubscribe: (their own link)`;
      sendBtn.textContent = M.armed ? `Yes, send ${to.length} now` : `Send to ${to.length}`;
      sendBtn.disabled = !to.length;
      warn.textContent = M.armed ? `${to.length} emails go out from ${m.from}, one every few seconds. You can stop it.` : '';
    };
    for (const el of [subject, body, footer]) el.addEventListener('input', () => { M.armed = false; update(); });
    camp.addEventListener('change', update);
    const payload = () => ({ subject: subject.value, body: body.value, footer: footer.value });
    const test = h('button', { class: 'btn small' }, 'Send me a test');
    test.addEventListener('click', async () => {
      test.disabled = true;
      try {
        toast(`Test sent to ${(await api('POST', '/mail/test', { ...payload(), sample: to[0] })).to}`);
      } catch (e) {
        toast(e.message);
      }
      test.disabled = false;
    });
    sendBtn.addEventListener('click', async () => {
      if (!subject.value.trim() || !body.value.trim()) return toast('Add a subject and a message');
      if (!M.armed) {
        M.armed = true;
        return update();
      }
      sendBtn.disabled = true;
      try {
        const x = await api('POST', '/mail/sends', { ...payload(), campaignId: camp.value || null, to });
        S.mail.sends = [x, ...S.mail.sends.filter((y) => y.id !== x.id)];
        Object.assign(M, { to: [], subject: '', body: '', armed: false, preview: false });
        toast(`Sending ${x.total} emails`);
        rerender();
      } catch (e) {
        toast(e.message);
        sendBtn.disabled = false;
      }
    });
    update();
    return [
      sendBars(null),
      h('p', { class: 'day-hint' }, `From ${m.from}. Each person gets their own email, addressed only to them.`),
      h('section', { class: 'mail-to' },
        h('h3', {}, M.to.length ? `To · ${to.length} ${to.length === 1 ? 'person' : 'people'}` : 'To'),
        h('div', { class: 'mail-add' },
          S.contacts?.length ? h('button', { class: 'btn small', onclick: pickContacts }, '+ Contacts') : null,
          h('button', { class: 'btn small', onclick: pickList }, '+ From a list'),
          h('button', { class: 'btn small', onclick: pickTyped }, '+ Type or paste')),
        out.length ? h('small', { class: 'day-hint' }, `${out.length} unsubscribed, so they’re left out.`) : null,
        shown.map((r) => h('div', { class: 'mail-person' + (no.has(r.email) ? ' out' : '') },
          h('span', {}, r.name ? h('b', {}, r.name) : null, h('small', {}, (r.name ? ' · ' : '') + r.email)),
          h('button', { class: 't-btn', 'aria-label': 'Remove', html: I.close, onclick: () => { M.to = M.to.filter((y) => y !== r); M.armed = false; rerender(); } }))),
        M.to.length > 6 ? h('button', { class: 'link', onclick: () => { M.showAll = !M.showAll; rerender(); } }, M.showAll ? 'Show fewer' : `Show all ${M.to.length}`) : null,
        M.to.length ? h('button', { class: 'link mail-clear', onclick: () => { M.to = []; rerender(); } }, 'Clear') : null),
      h('section', { class: 'mail-form' },
        h('label', {}, 'Subject', subject),
        h('label', {}, 'Message', body),
        h('small', { class: 'day-hint' }, '{first name} becomes each person’s first name, or “there” when there isn’t one.'),
        h('label', {}, 'Footer: your business and mailing address', footer),
        h('small', { class: 'day-hint' }, 'Every email ends with this and the person’s own unsubscribe link.'),
        h('label', {}, 'Log each email in a campaign', camp),
        h('div', { class: 'mail-tools' }, h('button', { class: 'link', onclick: () => { M.preview = !M.preview; preview.classList.toggle('hidden', !M.preview); } }, 'Preview'), test),
        preview,
        h('div', { class: 'mail-send' }, warn, sendBtn)),
    ];
  }
  // Email going out, and how the last ones went: a campaign's own, or all of them (c = null).
  function sendBars(c) {
    const xs = (S.mail?.sends || []).filter((x) => (!c || x.campaignId === c.id) && (x.status === 'sending' || x.status === 'paused' || (!K.sendHide.has(x.id) && Date.now() - (x.doneAt || 0) < 7 * 864e5)));
    if (!xs.length) return null;
    const act = (x, what) => api('POST', `/mail/sends/${x.id}/${what}`).catch((e) => toast(e.message));
    const hide = (x) => { K.sendHide.add(x.id); store.set('sendHide', [...K.sendHide].slice(-100)); renderCamps(); renderTool(); };
    return h('div', { class: 'sends' }, xs.slice(0, 3).map((x) => {
      const n = x.sent + x.failed + x.skipped;
      const state = x.status === 'sending' ? `${x.sent} of ${x.total} sent` : x.status === 'paused' ? `Paused at ${x.sent} of ${x.total}` : x.status === 'stopped' ? `Stopped · ${x.sent} of ${x.total} sent` : `Sent ${x.sent} of ${x.total}`;
      const bad = x.failed + x.skipped;
      return h('div', { class: 'send' + (x.status === 'paused' ? ' paused' : '') },
        h('div', { class: 'send-top' },
          h('span', { class: 'send-what' }, h('b', {}, x.subject), h('small', {}, ' · ' + state),
            bad ? h('button', { class: 'link send-bad', onclick: (e) => openMenu(e.currentTarget, [{ head: 'Not sent' }, ...x.problems.map((y) => ({ note: `${y.name || y.email} · ${y.why || ''}` }))]) }, ` · ${bad} not sent`) : null),
          x.status === 'sending' ? h('button', { class: 'btn small', onclick: () => act(x, 'stop') }, 'Stop')
            : x.status === 'paused' ? [h('button', { class: 'btn small primary-btn', onclick: () => act(x, 'resume') }, 'Resume'), h('button', { class: 'btn small', onclick: () => act(x, 'stop') }, 'Stop')]
            : h('button', { class: 't-btn', 'aria-label': 'Hide', html: I.close, onclick: () => hide(x) })),
        x.error ? h('small', { class: 'err' }, x.error) : null,
        x.status === 'sending' || x.status === 'paused' ? bar(n / x.total, (c || campById(x.campaignId))?.color || 'violet') : null);
    }));
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
  // ---------- brand & culture: set by team owners; brands the app and guides AI drafts ----------
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
        ? 'Set your mission, values, tone of voice, logo and colours. AI drafts follow them, and your logo and colour brand Column for everyone.'
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
        ? 'Everything AI drafts for the team (reports, plans) follows this.'
        : 'Set by your team owner. Everything AI drafts for the team follows it.'),
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
    s.append(aiSection());
    loadAi();
    if (isOwner()) s.append(pssSection());

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
