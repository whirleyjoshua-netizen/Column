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
    setTab: store.get('setTab', 'general'),
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
    clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
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
    vaultLock();
    mapResetLocal();
    VK.meta = undefined;
    VK.raw = [];
    SG.mine = {};
    SG.list = [];
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
      if (msg.item.id === VIEW_ID && !$('#preview .pv-edit, #preview .wd.editing')) openPreview(msg.item, { standalone: true });
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
      const mailWas = !!S.workspace?.settings?.memberEmail;
      S.workspace = msg.workspace;
      if (mailWas !== !!S.workspace.settings?.memberEmail) loadPss();
      applyBrand();
      refreshLinks();
      S.panes = S.panes.map((v) => (v.startsWith('stack:') && !stackById(v.slice(6)) ? 'files' : v));
      buildPanes();
      if (C.view.startsWith('ch:') && !channelById(viewChannel(C.view))) C.view = 'chat';
      if (S.tab === 'chat') openChannel(C.view);
      else renderChatSide();
      if (!$('#settings').classList.contains('hidden')) renderSettings();
      if (toolOpen === 'folders') renderTool();
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
    } else if (msg.type === 'vault') {
      loadVault();
    } else if (msg.type === 'signature') {
      loadSignature();
    } else if (msg.type === 'sign' || msg.type === 'sign:remove') {
      const was = SG.list.find((x) => x.id === (msg.sign?.id || msg.id));
      if (!msg.sign) {
        SG.list = SG.list.filter((x) => x.id !== msg.id);
        renderCamps();
        renderTool();
      } else upsertSign(msg.sign);
      const x = msg.sign;
      if (x && was && x.status !== was.status && (x.status === 'signed' || x.status === 'declined')) {
        toast(`${x.signer.name} ${x.status === 'signed' ? 'signed' : 'declined to sign'} “${x.name}”`, { label: 'Details', run: () => signSheet(x) });
      }
    } else if (msg.type === 'sidekick' || msg.type === 'sidekick:remove') {
      S.sidekick = (S.sidekick || []).filter((x) => x.id !== (msg.sidekick?.id || msg.id));
      if (msg.sidekick) S.sidekick.unshift(msg.sidekick);
      renderTool();
      renderCamps();
    } else if (msg.type === 'map' || msg.type === 'map:remove') {
      mapNews(msg);
    } else if (msg.type === 'plan' || msg.type === 'plan:remove') {
      if (msg.plan && msg.plan.id === PL.dirty) return;
      S.plans = (S.plans || []).filter((x) => x.id !== (msg.plan?.id || msg.id));
      if (msg.plan) S.plans.unshift(msg.plan);
      renderTool();
    } else if (msg.type === 'bill' || msg.type === 'bill:remove') {
      S.bills = S.bills.filter((x) => x.id !== (msg.bill?.id || msg.id));
      if (msg.type === 'bill') S.bills.push(msg.bill);
      renderDay();
      renderTool();
    } else if (msg.type === 'money' || msg.type === 'money:remove') {
      S.money = (S.money || []).filter((x) => x.id !== (msg.money?.id || msg.id));
      if (msg.money) S.money.push(msg.money);
      renderDay();
      renderTool();
    } else if (msg.type === 'budget' || msg.type === 'budget:remove') {
      S.budgets = (S.budgets || []).filter((x) => x.id !== (msg.budget?.id || msg.id));
      if (msg.budget) S.budgets.push(msg.budget);
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
    S.money = st.money || [];
    S.budgets = st.budgets || [];
    api('GET', '/meetings').then((x) => { S.meetings = x; renderRec(); }).catch(() => {});
    api('GET', '/plans').then((x) => { S.plans = x; renderTool(); }).catch(() => {});
    loadMap();
    api('GET', '/sidekick').then((x) => { S.sidekick = x; renderTool(); renderCamps(); }).catch(() => {});
    loadVault();
    loadSignature();
    loadSigns();
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
    let list = S.items.filter((x) => (x.channelId || null) === ch && !x.parentId && !x.dirId);
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
    const add = h('button', { class: 'add', title: 'Add files or a new document', onclick: (e) => openMenu(e.currentTarget, [
      { label: 'Upload files…', run: () => pickFiles(destOf(view)) },
      { label: 'New document', run: () => newDocSheet(destOf(view)) },
    ]) }, '+');
    if (!chat) return h('div', { class: 'composer' }, add, ta);
    const linkBtn = h('button', { class: 'add link-btn', title: 'Link a stack, file or task  ([[)', 'aria-label': 'Link a stack, file or task', html: I.link, onclick: () => openPicker(wrap, addLink) });
    const wrap = h('div', { class: 'composer-wrap' }, tray, h('div', { class: 'composer' }, viewThread(view) ? null : add, linkBtn, ta));
    mentionKey = mentionAuto(wrap, ta);
    return wrap;
  }

  // ---------- rendering ----------
  function render(force = false) {
    for (const pane of document.querySelectorAll('.pane')) renderPane(pane, force);
    if (toolOpen === 'folders') renderTool();
  }

  function renderPane(pane, force) {
    const view = pane._view;
    const list = pane._list;
    const items = itemsFor(view);
    const uploads = view === 'chat' || viewThread(view) ? [] : [...S.uploads.values()].filter((u) => !u.dirId && (u.channelId || null) === viewChannel(view) && (!viewStack(view) || u.stackId === viewStack(view)));
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
    if (it.type === 'folder') bits.push(`Uploaded folder · ${it.files.length} file${it.files.length === 1 ? '' : 's'}`);
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
      if (!it.channelId) a.append(btn(I.folder, it.dirId ? `In ${dirById(it.dirId)?.name || 'a folder'} · move it` : 'Save to folder', (b) => folderMenu(it, b), it.dirId ? 'on' : null));
      if (!it.channelId) a.append(btn(I.stack, it.dirId ? 'Move to a stack (out of the folder)' : 'Move to stack', (b) => stackMenu(it, b)));
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
      { label: 'No stack', on: !it.stackId && !it.dirId, run: () => move(null) },
      ...S.workspace.stacks.map((s) => ({ label: s.name, on: it.stackId === s.id, run: () => move(s.id) })),
      ...(S.workspace.stacks.length ? [] : [{ note: 'Create stacks in ⚙ Settings' }]),
    ]);
  }
  const hideMenu = () => $('#menu').classList.add('hidden');
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#menu')) hideMenu(); });

  // ---------- preview ----------
  // standalone: the whole page is this file (a window of its own), so there's nothing to close back to.
  function openPreview(it, { standalone = false, edit = false } = {}) {
    const pv = $('#preview');
    pv.innerHTML = '';
    const k = kind(it);
    const close = (force) => {
      if (force !== true && wordGuard()) return;
      pv.classList.add('hidden');
      pv.innerHTML = '';
    };
    pv.onclick = (e) => { if (e.target === pv && !standalone) close(); };
    if (!standalone) pv.append(h('button', { class: 'icon-btn close', html: I.close, onclick: close, 'aria-label': 'Close' }));
    if (k === 'image') pv.append(h('img', { src: fileUrl(it), alt: it.name }));
    else if (k === 'video') pv.append(h('video', { src: fileUrl(it), controls: true, autoplay: true, playsinline: true }));
    else if (k === 'audio') pv.append(h('div', { style: 'color:#fff;font-size:15px' }, it.name), h('audio', { src: fileUrl(it), controls: true, autoplay: true }));
    else if (k === 'pdf') pv.append(pdfView(it));
    else if (k === 'text') pv.append(h('pre', { html: linkify(it.text) }));
    else if (k === 'docx') pv.append(wordView(it, { edit, close: () => (standalone ? null : close(true)) }));
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
  // A Word document as HTML: paragraphs, headings, bold/italic/underline, lists, tables, links and pictures (wordkit.js).
  async function renderDocx(buf) {
    return (await ColumnWord.read(buf)).el;
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
      else if (pdfStop()) return;
      else if (!$('#preview').classList.contains('hidden') && !VIEW_ID) { if (!wordGuard()) { $('#preview').classList.add('hidden'); $('#preview').innerHTML = ''; } }
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
      S.dragItem = { it, at: Date.now() };
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
  // A task row takes a file dropped on it as an attachment, from the computer or from Column.
  const taskAt = (target) => { const tr = target?.closest?.('.task-row[data-id]'); return tr && taskById(tr.dataset.id) ? tr : null; };
  window.addEventListener('dragover', (e) => {
    const fr = S.token && dirAt(e.target);
    document.querySelectorAll('#tool .dir-over').forEach((x) => x !== fr && x.classList.remove('dir-over'));
    if (fr && (hasFiles(e.dataTransfer) || (S.internalDrag && S.dragItem && !S.dragItem.it.channelId))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = S.internalDrag ? (e.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move') : 'copy';
      fr.classList.add('dir-over');
      return;
    }
    const tr = S.token && taskAt(e.target);
    document.querySelectorAll('.task-row.file-over').forEach((x) => x !== tr && x.classList.remove('file-over'));
    if (tr && (hasFiles(e.dataTransfer) || (S.internalDrag && S.dragItem?.it.type !== 'text'))) {
      e.preventDefault();
      tr.classList.add('file-over');
      return;
    }
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
    document.querySelectorAll('.task-row.file-over').forEach((x) => x.classList.remove('file-over'));
    document.querySelectorAll('#tool .dir-over').forEach((x) => x.classList.remove('dir-over'));
    const fr = S.token && dirAt(e.target);
    if (fr) {
      const it = S.internalDrag && S.dragItem?.it;
      S.internalDrag = false;
      S.dragItem = null;
      if (it) return it.dirId !== fr.dataset.dir && saveToDir(it, fr.dataset.dir);
      if (hasFiles(e.dataTransfer)) {
        FD.open = fr.dataset.dir;
        renderTool(true);
        return dirUploads([...e.dataTransfer.files]);
      }
      return;
    }
    const tr = S.token && taskAt(e.target);
    if (tr) {
      const t = taskById(tr.dataset.id);
      // Something dragged out of Column is attached as it is, not uploaded again (the desktop app drags a copy).
      const fromColumn = S.dragItem && Date.now() - S.dragItem.at < 60_000 && (S.internalDrag || [...(e.dataTransfer.files || [])].some((f) => f.name === S.dragItem.it.name)) ? S.dragItem.it : null;
      S.internalDrag = false;
      S.dragItem = null;
      if (fromColumn) return attachToTask(t, [], [fromColumn]);
      if (hasFiles(e.dataTransfer)) return attachToTask(t, [...e.dataTransfer.files]);
      return;
    }
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
      const qs = new URLSearchParams({ name: file.name, type: file.type || '', ...(dest.stackId ? { stackId: dest.stackId } : {}), ...(dest.channelId ? { channelId: dest.channelId } : {}), ...(dest.dirId ? { dirId: dest.dirId } : {}) });
      item = file.size > CHUNK
        ? await putResumable(file, { name: file.name, type: file.type || '', stackId: dest.stackId || null, channelId: dest.channelId || null, dirId: dest.dirId || null }, progress, u)
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
  const D = { date: todayKey(), scrolledFor: null, sub: store.get('daySub', 'schedule'), mine: store.get('tasksMine', false), taskView: store.get('taskView', 'mine'), campsOpen: new Set(store.get('stepsOpen', [])) };

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
    const tight = isToday ? budgetAlerts() : [];
    if (due.length || bills.length || tight.length) {
      const late = due.filter(isOverdue);
      parts.push(h('div', { class: 'anytime tasks' }, h('div', { class: 'any-h' }, 'Due', late.length ? moveToToday(late) : null), due.map(taskRow), bills.map(billDayRow), tight.map(budgetDayRow)));
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

  function taskRow(t, { inCampaign, sort, noCamp } = {}) {
    const text = h('span', { class: 'p-text', title: 'Click to edit' }, t.report ? h('span', { class: 'is-task', title: 'Report: ticking it asks for your findings', html: I.copy }) : null, t.text);
    text.addEventListener('click', () => editTaskText(text, t));
    const slot = taskSlot(t);
    const btn = (icon, title, fn) => h('button', { class: 't-btn', title, 'aria-label': title, html: icon, onclick: (ev) => { ev.stopPropagation(); fn(ev.currentTarget); } });
    const g = goalById(t.goalId);
    const camp = g && campById(g.campaignId);
    const pr = t.priority || 0;
    const list = listOfTask(t);
    const lp = list && listProgress(list, t.runId);
    const waits = taskWaitsOn(t);
    const waitMsg = waits && `Waiting on “${waits.title || waits.text}” · this campaign is worked in order`;
    const openList = () => {
      if (waits) return toast(waitMsg);
      const key = 'task:' + t.id;
      if (inCampaign) {
        K.listOpen = K.listOpen === key ? null : key;
        return renderCamps();
      }
      K.listOpen = key;
      openCampaign(camp.id);
    };
    return h('div', { class: 'any-row task-row' + (t.done ? ' done' : '') + (waits ? ' waiting' : ''), 'data-id': t.id, title: waitMsg || null,
      onpointerdown: (ev) => !t.done && !waits && dragToTimeline(ev, t.text, (k, m) => scheduleTask(t, k, m)) },
      sort ? grip((ev) => sortDrag(ev, ev.currentTarget.parentNode, '.task-row', sort)) : null,
      h('button', {
        class: 'check' + (t.done ? ' on' : '') + (pr ? ' pr-' + pr : ''),
        html: I.check,
        disabled: !!waits,
        'aria-label': waits ? waitMsg : t.done ? 'Mark not done' : 'Mark done',
        onclick: () => patchTask(t, { done: !t.done }),
      }),
      pr && !t.done ? h('button', { class: 'prio pr-' + pr, title: PRIO[pr] + ' priority', onclick: (ev) => prioMenu(ev.currentTarget, t) }, '!'.repeat(pr)) : null,
      text,
      stepTag(t),
      t.due && !t.done ? h('button', { class: 'due' + (isOverdue(t) ? ' late' : t.due === todayKey() ? ' today' : ''), title: 'Due ' + dayName(t.due) + (t.repeat ? ' · ' + repeatLabel(t.repeat, t.due) : ''), onclick: (ev) => dueMenu(ev.currentTarget, t) },
        t.repeat ? h('span', { class: 'rep', html: I.repeat }) : null, dueLabel(t.due)) : null,
      slot ? h('button', { class: 'slot', title: 'Show on schedule', onclick: () => { D.sub = 'schedule'; store.set('daySub', 'schedule'); setTab('day'); goDay(slot.e.date); } },
        slot.label + (slot.more ? ` +${slot.more}` : '')) : null,
      lp ? h('button', { class: 'list-chip' + (lp.of && lp.n === lp.of ? ' full' : ''), title: `${list.name}: ${lp.label} · click to open`, onclick: (ev) => { ev.stopPropagation(); openList(); } },
        h('span', { html: KIND_ICON[list.kind || 'calls'] }), lp.of ? `${lp.n}/${lp.of}` : '') : null,
      taskFiles(t).length ? h('button', { class: 'list-chip file-chip', title: taskFiles(t).map((it) => it.name || 'Note').join(', '), onclick: (ev) => { ev.stopPropagation(); taskFiles(t).length === 1 ? openPreview(taskFiles(t)[0]) : taskFilesMenu(ev.currentTarget, t); } },
        h('span', { html: I.clip }), taskFiles(t).length === 1 ? shortText(taskFiles(t)[0].name || 'Note', 18) : String(taskFiles(t).length)) : null,
      t.pinId && pinById(t.pinId) ? h('button', { class: 'list-chip', title: 'Show it on the map', onclick: (ev) => { ev.stopPropagation(); openMap({ pinId: t.pinId }); } }, 'Map') : null,
      camp && !inCampaign && !noCamp ? h('button', { class: 'camp-chip c-' + camp.color, title: `${camp.name} · ${g.title}`, onclick: () => openCampaign(camp.id) }, camp.name) : null,
      t.assigneeId ? avatar(t.assigneeId) : null,
      t.done || waits ? null : btn(I.clock, 'Put on schedule', () => openSheet({ text: t.text, taskId: t.id, date: t.due && D.sub === 'tasks' ? t.due : D.date })),
      btn(I.more, 'More', (b) => taskMenu(b, t))
    );
  }

  // ----- files on tasks: the finished thing a task asked for, dropped on it or picked -----
  // A file from the computer goes into the campaign's stack (or the main column), then on the task.
  const taskFiles = (t) => (t.files || []).map((id) => S.items.find((it) => it.id === id)).filter(Boolean);
  const shortText = (v, n) => (String(v || '').length > n ? String(v).slice(0, n - 1) + '…' : String(v || ''));
  async function attachToTask(t, files, items = []) {
    const camp = campById(goalById(t.goalId)?.campaignId);
    const add = [...items];
    try {
      for (const f of files) {
        if (!f.size && !f.type) { toast(`${f.name}: folders can’t be attached to a task`); continue; }
        add.push(await uploadFile(f, { stackId: camp?.stackId || null }));
      }
    } catch (er) {
      toast(er.message);
    }
    if (!add.length) return;
    const now = taskById(t.id) || t;
    await patchTask(now, { files: [...new Set([...(now.files || []), ...add.map((it) => it.id)])] });
    renderCamps();
    const what = add.length === 1 ? add[0].name || 'Note' : `${add.length} files`;
    toast(`Attached ${what} to “${shortText(now.text, 40)}”`, now.done ? null : { label: 'Mark done', run: () => patchTask(taskById(t.id), { done: true }).then(renderCamps) });
  }
  function pickForTask(t) {
    $('#taskFile')?.remove();
    const input = h('input', { type: 'file', id: 'taskFile', class: 'hidden', multiple: true });
    document.body.append(input);
    input.addEventListener('change', () => { const fs = [...input.files]; input.remove(); if (fs.length) attachToTask(t, fs); });
    input.click();
  }
  function taskFilesMenu(anchor, t) {
    const fs = taskFiles(t);
    openMenu(anchor, [
      { head: 'Attached' },
      ...fs.map((it) => ({ label: it.name || shortText(it.text || 'Note', 40), run: () => openPreview(it) })),
      { label: '+ Attach a file…', run: () => pickForTask(t) },
      ...(fs.length ? [{ head: 'Remove' }, ...fs.map((it) => ({ label: '× ' + (it.name || 'Note'), run: () => patchTask(t, { files: (t.files || []).filter((id) => id !== it.id) }).then(renderCamps) }))] : []),
    ]);
  }

  function taskMenu(anchor, t) {
    const g = goalById(t.goalId);
    openMenu(anchor, [
      { label: t.due ? `Due ${dueLabel(t.due)}…` : 'Due date…', run: () => dueMenu(anchor, t) },
      { label: t.priority ? `${PRIO[t.priority]} priority…` : 'Priority…', run: () => prioMenu(anchor, t) },
      { label: taskFiles(t).length ? `Attached · ${taskFiles(t).length}…` : 'Attach a file…', run: () => (taskFiles(t).length ? taskFilesMenu(anchor, t) : pickForTask(t)) },
      { label: t.assigneeId ? `Assigned to ${memberName(t.assigneeId)}…` : 'Assign to…', run: () => assignMenu(anchor, t) },
      { label: g ? `Goal: ${g.title}…` : 'Add to a goal…', run: () => goalMenu(anchor, t) },
      ...(g ? [{ label: t.report ? 'Stop asking for a report' : 'Ask for a report when done', run: () => patchTask(t, { report: !t.report }) }] : []),
      ...stepRows(g && campById(g.campaignId), t, !!taskWaitsOn(t), (ch) => patchTask(t, ch)),
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

  // Two views: your own to-dos, and campaign steps grouped by campaign, so a busy campaign can't bury them.
  const stepOf = (t) => !!(t.goalId && goalById(t.goalId));
  function renderTasks() {
    const keep = D.scroll.scrollTop;
    const mineOnly = D.mine;
    const steps = D.taskView === 'camps';
    const shown = S.tasks.filter((t) => (!mineOnly || t.assigneeId === S.me?.memberId) && stepOf(t) === steps);
    const open = shown.filter((t) => !t.done).sort(byPrio);
    const done = shown.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    const today = todayKey();
    const parts = [];
    const view = (v) => { D.taskView = v; store.set('taskView', v); renderDay(); };
    const stepsDue = S.tasks.filter((t) => stepOf(t) && !t.done && t.due && t.due <= today && (!mineOnly || t.assigneeId === S.me?.memberId));
    parts.push(h('div', { class: 'seg mine-seg' },
      h('button', { class: steps ? '' : 'on', onclick: () => view('mine') }, 'My tasks'),
      h('button', { class: steps ? 'on' : '', onclick: () => view('camps') }, 'Campaign steps', stepsDue.length ? h('span', { class: 'seg-n' }, stepsDue.length) : null)));
    if (S.tasks.some((t) => t.assigneeId)) {
      parts.push(h('div', { class: 'seg mine-seg' },
        h('button', { class: mineOnly ? '' : 'on', onclick: () => { D.mine = false; store.set('tasksMine', false); renderDay(); } }, 'All tasks'),
        h('button', { class: mineOnly ? 'on' : '', onclick: () => { D.mine = true; store.set('tasksMine', true); renderDay(); } }, 'Assigned to me')));
    }
    if (steps) {
      renderSteps(parts, open, done);
      D.scroll.replaceChildren(...parts);
      D.scroll.scrollTop = keep;
      return;
    }
    if (stepsDue.length) parts.push(h('button', { class: 'steps-due', onclick: () => view('camps') }, `${stepsDue.length} campaign step${stepsDue.length === 1 ? '' : 's'} due today or late →`));
    // Overdue, Today and undated tasks can be dragged into your own order; Upcoming stays by date.
    const sortBy = (ids) => saveOrder(S.tasks, 'dayOrder', ids, '/tasks/');
    const group = (title, list, extra, sort) => list.length && parts.push(h('div', { class: 'anytime tasks' }, h('div', { class: 'any-h' }, title, extra || null),
      (sort ? list.sort(placed('dayOrder', byPrio)) : list).map((t) => taskRow(t, { sort: sort && sortBy }))));
    const late = open.filter(isOverdue);
    group(`Overdue · ${late.length}`, late, late.length ? moveToToday(late) : null, true);
    if (open.some((t) => t.due)) {
      group('Today', open.filter((t) => t.due === today), null, true);
      group('Upcoming', open.filter((t) => t.due > today).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : byPrio(a, b))));
      group('No date', open.filter((t) => !t.due), null, true);
    } else group('To do', open, null, true);
    if (!open.length) {
      parts.push(h('div', { class: 'anytime tasks' }, h('div', { class: 'any-h' }, 'To do'),
        h('p', { class: 'day-hint' }, mineOnly ? 'Nothing assigned to you.' : done.length ? 'All done.' : 'No tasks yet. Type below, like “Pay rent friday !!” (! low, !! medium, !!! high), then tap the clock to put it on your schedule.')));
    }
    if (done.length) {
      const clear = h('button', { class: 'link', 'data-label': '1' }, 'Clear');
      clear.addEventListener('click', () => confirmClick(clear, async () => {
        for (const t of done) await api('DELETE', '/tasks/' + t.id).catch((e) => toast(e.message));
      }));
      parts.push(h('div', { class: 'anytime tasks' }, h('div', { class: 'any-h' }, `Done · ${done.length}`, clear), done.map((t) => taskRow(t))));
    }
    D.scroll.replaceChildren(...parts);
    D.scroll.scrollTop = keep;
  }

  // Campaign steps, a group per campaign: late and due-today ones first, each group folded to a line if you like.
  function renderSteps(parts, open, done) {
    const today = todayKey();
    const byCamp = new Map();
    for (const t of open) {
      const c = campById(goalById(t.goalId).campaignId);
      if (!c) continue;
      if (!byCamp.has(c.id)) byCamp.set(c.id, { c, ts: [] });
      byCamp.get(c.id).ts.push(t);
    }
    const urgent = (x) => x.ts.filter((t) => t.due && t.due <= today).length;
    const groups = [...byCamp.values()].sort((a, b) => urgent(b) - urgent(a) || a.c.name.localeCompare(b.c.name));
    const order = (a, b) => (a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : byPrio(a, b);
    for (const { c, ts } of groups) {
      const shut = !D.campsOpen.has(c.id);
      const n = urgent({ ts });
      const fold = () => {
        if (shut) D.campsOpen.add(c.id);
        else D.campsOpen.delete(c.id);
        store.set('stepsOpen', [...D.campsOpen]);
        renderDay();
      };
      parts.push(h('div', { class: 'anytime tasks steps-group' + (shut ? ' closed' : '') },
        h('div', { class: 'any-h steps-h', onclick: fold },
          h('span', { class: 'goal-fold', html: I.down }), h('span', { class: 'camp-dot c-' + c.color }), c.name,
          h('small', {}, `${ts.length} open${n ? ` · ${n} due` : ''}`),
          h('button', { class: 'link', onclick: (ev) => { ev.stopPropagation(); setTab('camps'); openCampaign(c.id); } }, 'Open')),
        shut ? null : ts.sort(order).map((t) => taskRow(t, { noCamp: true }))));
    }
    if (!groups.length) parts.push(h('div', { class: 'anytime tasks' }, h('p', { class: 'day-hint' }, D.mine ? 'No campaign steps assigned to you.' : 'No open campaign steps.')));
    if (done.length) parts.push(h('details', { class: 'anytime tasks' }, h('summary', { class: 'any-h' }, `Done · ${done.length}`), done.slice(0, 50).map((t) => taskRow(t))));
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
  const K = { open: store.get('campOpen', null), mine: store.get('campsMine', false), logOpen: null, showAll: {}, stale: false, pick: null, listOpen: null, listShow: {}, listN: {}, dragList: null, logFrom: {}, book: null, dock: store.get('dock', null), dockSize: store.get('dockSize', 0.45), dockMin: false, refQ: {}, noteDraft: {}, runOpen: null, noteRow: null, answers: {}, askOpen: false, ansOpen: {}, lead: null, mailDraft: {}, sendHide: new Set(store.get('sendHide', [])), closed: new Set(store.get('goalsClosed', [])) };
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
    if (g.kind === 'money') {
      const n = Math.max(0, g.saved || 0), of = g.target * 100;
      return { n, of, frac: Math.min(1, n / of), label: `${money(n)} of ${money(of)}` };
    }
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

  // ----- campaigns worked in order (same rules as the server) -----
  // Goals open one at a time, top to bottom; inside a goal each task waits for the one above it.
  // What's waiting is greyed out but still readable. Owners can skip a step or unlock one early.
  const canPass = (c) => !!c && (!c.ownerId || c.ownerId === S.me?.memberId || amOwner());
  // Hand-placed rows (key set) come first in that order; the rest follow in their usual order.
  const placed = (key, base) => (a, b) => (a[key] != null) !== (b[key] != null) ? (a[key] != null ? -1 : 1) : a[key] != null && a[key] !== b[key] ? a[key] - b[key] : base(a, b);
  const byDueMade = (a, b) => ((a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : a.createdAt - b.createdAt);
  const tasksInOrder = (gid) => tasksOf(gid).sort(placed('order', byDueMade));
  const goalMet = (g) => !!g.skipped || (g.kind === 'count' ? goalProgress(g).n >= g.target : tasksOf(g.id).every((t) => t.done || t.skipped));
  function goalWaitsOn(g) {
    if (!campById(g.campaignId)?.inOrder || g.unlocked) return null;
    for (const x of goalsOf(g.campaignId)) {
      if (x.id === g.id) return null;
      if (!goalMet(x)) return x;
    }
    return null;
  }
  function taskWaitsOn(t) {
    const g = goalById(t.goalId);
    if (!g || !campById(g.campaignId)?.inOrder || t.done || t.unlocked) return null;
    const wg = goalWaitsOn(g);
    if (wg) return wg;
    for (const x of tasksInOrder(g.id)) {
      if (x.id === t.id) return null;
      if (!x.done && !x.skipped) return x;
    }
    return null;
  }
  // Owner-only menu rows for a goal or task in an in-order campaign.
  function stepRows(c, x, waiting, patch) {
    if (!c?.inOrder || !canPass(c) || x.done) return [];
    return [
      waiting || x.unlocked ? { label: x.unlocked ? 'Lock again (back in order)' : 'Unlock now', run: () => patch({ unlocked: !x.unlocked }) } : null,
      { label: x.skipped ? 'Stop skipping' : 'Skip for now', run: () => patch({ skipped: !x.skipped }) },
    ].filter(Boolean);
  }
  const stepTag = (x) => (x.skipped ? h('span', { class: 'step-tag' }, 'Skipped') : x.unlocked ? h('span', { class: 'step-tag' }, 'Unlocked') : null);

  // Drag a row by its grip to move it among its siblings (matching sel). Rows move as you go;
  // done(ids) gets the new order. Mouse and pen only, like the other drags.
  function sortDrag(ev, row, sel, done) {
    ev.stopPropagation();
    const box = row.parentNode;
    const sibs = () => [...box.children].filter((x) => x !== row && x.matches(sel));
    pointerDrag(ev, {
      onStart: () => { D.dragging = K.sorting = true; row.classList.add('sorting'); },
      onMove: (e) => {
        const list = sibs();
        const before = list.find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
        if (before) { if (row.nextElementSibling !== before) before.before(row); }
        else if (list.length) list[list.length - 1].after(row);
      },
      onEnd: (up) => {
        D.dragging = K.sorting = false;
        row.classList.remove('sorting');
        if (up) done([...box.children].filter((x) => x.matches(sel)).map((x) => x.dataset.id));
        renderDay();
        renderCamps();
      },
    });
  }
  const grip = (onDown) => h('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true', onpointerdown: onDown }, '⋮⋮');
  // Number the rows 1, 2, 3… in their new order, saving only the ones that moved.
  async function saveOrder(rows, key, ids, path) {
    const moved = [];
    ids.forEach((id, i) => {
      const x = rows.find((r) => r.id === id);
      if (x && x[key] !== i + 1) { x[key] = i + 1; moved.push(x); }
    });
    renderDay();
    renderCamps();
    try {
      await Promise.all(moved.map((x) => api('PATCH', path + x.id, { [key]: x[key] })));
    } catch (er) {
      toast(er.message);
    }
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
    if (!S.workspace || S.tab !== 'camps' || K.sorting) return;
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
        c.inOrder ? h('span', { class: 'pill', title: 'Goals and tasks open one at a time, top to bottom' }, 'In order') : null,
        who ? h('span', { class: 'pill', title: who.map(memberName).join(', ') }, h('span', { class: 'is-task', html: I.lock }), `Private · ${who.length}`) : null),
      h('div', { class: 'camp-total' }, bar(p, c.color), h('span', {}, Math.round(p * 100) + '%')),
      c.money ? h('div', { class: 'camp-money', onclick: () => { FIN.tab = 'flow'; FIN.campaign = c.id; openTool('bills'); } },
        c.money.spent ? h('span', {}, 'Spent ', h('b', {}, money(c.money.spent))) : null,
        c.money.earned ? h('span', {}, 'Brought in ', h('b', {}, money(c.money.earned))) : null,
        c.money.spent && c.money.earned ? h('span', { class: c.money.earned >= c.money.spent ? 'up' : 'down' }, c.money.earned >= c.money.spent ? `+${money(c.money.earned - c.money.spent)}` : `−${money(c.money.spent - c.money.earned)}`) : null) : null,
      brief,
      h('div', { class: 'camp-links' },
        ch ? h('button', { class: 'btn small', onclick: () => { setTab('chat'); openChannel('ch:' + ch.id); } }, '# ' + ch.name) : null,
        st ? h('button', { class: 'btn small', title: 'Open a file, add one, or go to the stack', onclick: (e) => filesMenu(e.currentTarget, c) }, `Files · ${files} ▾`) : null,
        st ? h('button', { class: 'btn small', title: 'Jot a quick note, or open one', onclick: (e) => notesMenu(e.currentTarget, c) }, `Notes · ${notes} ▾`) : null,
        h('button', { class: 'btn small' + (K.logOpen === c.id ? ' on' : ''), onclick: () => openLog(c) }, 'Log'),
        h('button', { class: 'btn small', onclick: () => openReport(c) }, 'Write a report'),
        h('button', { class: 'btn small' + (skFor(c.id)?.nudge ? ' sk-nudge' : ''), title: skFor(c.id)?.nudge?.text || 'Talk this campaign through with Sidekick', onclick: () => sidekickFor(c) }, '✦ Sidekick'),
        mapFor(c) ? h('button', { class: 'btn small', title: 'Runs and pins on the map', onclick: () => openMap({ campaignId: c.id }) }, `Map · ${mapFor(c)}`) : null,
        signsFor(c) ? h('button', { class: 'btn small', title: 'Sent for signature', onclick: () => { SG.filter = c.id; openTool('signs'); } }, `Signatures · ${signsFor(c)}`) : null,
        vaultLinked('campaign', c.id) ? h('button', { class: 'btn small', title: 'In your vault', onclick: () => openVaultFor('campaign', c.id) }, h('span', { class: 'vault-ic', html: I.lock }), `Vault · ${vaultLinked('campaign', c.id)}`) : null),
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
    const tasks = tasksInOrder(g.id).sort((a, b) => a.done - b.done);
    const waits = goalWaitsOn(g);
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
    // Collapsed to its title row (remembered on this device), or open with its progress and tasks.
    const closed = K.closed.has(g.id);
    const fold = () => {
      if (K.closed.has(g.id)) K.closed.delete(g.id);
      else K.closed.add(g.id);
      store.set('goalsClosed', [...K.closed].filter((id) => goalById(id)));
      renderCamps();
    };
    const el = h('div', { class: 'goal' + (waits ? ' waiting' : '') + (closed ? ' closed' : ''), 'data-id': g.id, title: waits ? `Opens when “${waits.title}” is met · this campaign is worked in order` : null },
      h('div', { class: 'goal-top' },
        grip((ev) => sortDrag(ev, el, '.goal', (ids) => saveOrder(S.goals, 'order', ids, '/goals/'))),
        h('button', { class: 't-btn goal-fold', 'aria-label': closed ? 'Show tasks' : 'Hide tasks', 'aria-expanded': String(!closed), html: I.down, onclick: fold }),
        h('span', { class: 'goal-ic', html: g.kind === 'task' || g.kind === 'tasks' || !g.kind ? I.task : I.target }),
        h('b', { class: 'goal-title', onclick: fold }, g.title),
        closed ? h('small', { class: 'goal-mini' }, pg.label) : null,
        stepTag(g),
        g.due ? h('span', { class: 'due' + (g.due < todayKey() && pg.frac < 1 ? ' late' : '') }, dueLabel(g.due)) : null,
        h('button', { class: 't-btn', 'aria-label': 'Goal options', html: I.more, onclick: (e) => goalOptions(e.currentTarget, c, g) })),
      closed ? null : h('div', { class: 'goal-prog' }, bar(pg.frac, c.color), h('span', {}, pg.label)));
    if (!closed) {
      if (tasks.length) el.append(h('div', { class: 'goal-tasks' }, tasks.flatMap((t) => {
        const l = listOfTask(t);
        const close = () => { K.listOpen = null; renderCamps(); };
        return [taskRow(t, { inCampaign: true, sort: (ids) => saveOrder(S.tasks, 'order', ids, '/tasks/') }), l && K.listOpen === 'task:' + t.id ? h('div', { class: 'task-list' }, taskListBody(c, l, t, close)) : null];
      }).filter(Boolean)));
      el.append(add);
    }
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
      S.mail && k === 'calls' && listFields(l).email >= 0 && (amOwner() || myCampaign(c)) ? { label: 'Email this list…', run: () => { const f = listFields(l); emailTo(l.rows.filter((r) => !r.dne).map((r) => ({ email: r.cells[f.email], name: f.who(r) === '—' ? '' : f.who(r), first: f.first(r), listId: l.id, rowId: r.id }))); } } : null,
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
    if (k === 'pdf') return body.append(pdfView(it, { docked: true }));
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
      { label: '+ New document', run: () => newDocSheet({ stackId: c.stackId }) },
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
      ...(canPass(c) ? [{ label: c.inOrder ? 'Stop working in order' : 'Work in order (one step at a time)', on: !!c.inOrder, run: () => api('PATCH', '/campaigns/' + c.id, { inOrder: !c.inOrder }).catch((e) => toast(e.message)) }] : []),
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
      ...stepRows(c, g, !!goalWaitsOn(g), (ch) => api('PATCH', '/goals/' + g.id, ch).catch((e) => toast(e.message))),
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
    const kind = h('select', {}, h('option', { value: 'tasks' }, 'Checking off its tasks'), h('option', { value: 'count' }, 'Counting logged attempts'), h('option', { value: 'money' }, 'Saving or earning money'));
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
    // A money goal fills from Finance: tag money in (or out) to it there.
    const amount = h('input', { value: g?.kind === 'money' ? g.target : '', placeholder: '5000', inputmode: 'decimal' });
    const moneyOpts = h('div', { class: 'count-opts' }, h('label', {}, 'Amount ($)', amount),
      h('p', { class: 'day-hint' }, 'It fills up from Finance: add money in and pick this goal, and money out tagged to it counts against it.'));
    const sync = () => {
      countOpts.classList.toggle('hidden', kind.value !== 'count');
      moneyOpts.classList.toggle('hidden', kind.value !== 'money');
    };
    kind.addEventListener('change', sync);
    sync();
    sheet(g ? 'Edit goal' : 'New goal', [
      h('label', {}, 'Goal', title),
      h('div', { class: 'row2' }, h('label', {}, 'Progress by', kind), h('label', {}, 'Due (optional)', due)),
      countOpts,
      moneyOpts,
    ], async () => {
      const counts = boxes.map((l) => l.firstChild).filter((cb) => cb.checked).map((cb) => cb.value);
      const methods = mboxes.map((l) => l.firstChild).filter((cb) => cb.checked).map((cb) => cb.value);
      const body = { title: title.value, due: due.value || null, kind: kind.value, target: kind.value === 'money' ? amount.value : Number(target.value), counts: counts.length ? counts : null, methods: methods.length ? methods : null };
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
  // Opens Settings on one of its tabs, scrolled to a section: the AI keys, unless told otherwise.
  function openSettings(tab = 'connections', at = '.ai-sec') {
    S.setTab = tab;
    $('#settings').classList.remove('hidden');
    renderSettings();
    $('#settings ' + at)?.scrollIntoView({ block: 'start' });
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
      // Members get Email when an owner allows it.
      if (S.workspace && mayEmail()) S.mail = await api('GET', '/mail').catch(() => null);
      renderCamps();
      renderTool();
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
        h('span', { class: 'ai-key' }, p.count ? h('button', { class: 'btn small', onclick: () => openTool('contacts') }, 'Contacts') : null, sync)),
      // Calls and emails logged against a PSS contact go onto their timeline in PSS.
      h('div', { class: 'srow' },
        h('span', {}, 'Calls and emails go to PSS',
          h('small', { class: p.pushError ? 'err' : null }, p.pushError ? p.pushError
            : p.waiting ? `${p.waiting} waiting to send`
            : p.pushedAt ? ['Up to date · last sent ', h('span', { 'data-ago': p.pushedAt }, ago(p.pushedAt))]
            : 'Logged against a contact, they show up on that lead in PSS'))));
    return sec;
  }
  // Everyone in PSS, kept current. Tick people to email them.
  const CT = { q: '', stage: '', picked: new Set() };
  function contactsTool() {
    if (!S.pss?.connected) return [h('p', { class: 'day-hint' }, 'Connect PSS admin in Settings to bring your leads and customers here. They stay current with your website.'), h('button', { class: 'btn small', onclick: () => { closeTool(); openSettings('connections', '.pss-sec'); } }, 'Open Settings')];
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
            h('div', { class: 'contact-top' }, h('b', {}, x.name || '—'), h('span', { class: 'lead-stage' }, stageLabel(x.stage)),
              vaultLinked('contact', x.id) ? h('button', { class: 'link vault-tag', title: 'In your vault', onclick: () => openVaultFor('contact', x.id) }, h('span', { class: 'vault-ic', html: I.lock }), vaultLinked('contact', x.id)) : null),
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
  // With onPick, the filter is handed back instead of saved as a list (the Planner keeps it until it's a campaign).
  function liveSheet(c, l, onPick) {
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
      l || onPick ? null : h('p', { class: 'day-hint' }, 'Everyone in this campaign will see these contacts.'),
    ], async () => {
      const body = { name: name.value.trim() || 'PSS leads', live: read() };
      if (onPick) return onPick(body);
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
  const TOOLS = { sidekick: { name: 'Sidekick', render: sidekickTool }, bills: { name: 'Finance', render: financeTool }, contacts: { name: 'Contacts', render: contactsTool }, email: { name: 'Email', render: emailTool }, meetings: { name: 'Meeting notes', render: meetingsTool }, planner: { name: 'Planner', render: plannerTool }, folders: { name: 'Folders', render: foldersTool }, map: { name: 'Map', render: mapTool }, signs: { name: 'Signatures', render: signsTool }, vault: { name: 'Vault', render: vaultTool } };
  let toolOpen = null;
  $('#toolsBtn').addEventListener('click', (e) => {
    const soon = billsSoon().length;
    const tight = budgetAlerts().length;
    openMenu(e.currentTarget, [
      { head: 'Tools' },
      { label: h('span', { class: 'tool-item' }, '✦ Sidekick', skNudges().length ? h('small', {}, `${skNudges().length} need${skNudges().length === 1 ? 's' : ''} a look`) : null), on: toolOpen === 'sidekick', run: () => { SK.open = null; openTool('sidekick'); } },
      { label: h('span', { class: 'tool-item' }, 'Finance', soon || tight ? h('small', {}, [soon ? `${soon} due soon` : '', tight ? `${tight} budget${tight === 1 ? '' : 's'} nearly used` : ''].filter(Boolean).join(' · ')) : null), on: toolOpen === 'bills', run: () => openTool('bills') },
      amOwner() ? { label: 'Contacts', on: toolOpen === 'contacts', run: () => openTool('contacts') } : null,
      mayEmail() ? { label: h('span', { class: 'tool-item' }, 'Email', (S.mail?.sends || []).some((x) => x.status === 'sending') ? h('small', {}, 'sending…') : null), on: toolOpen === 'email', run: () => openTool('email') } : null,
      { label: 'Folders', on: toolOpen === 'folders', run: () => openTool('folders') },
      { label: 'Meeting notes', on: toolOpen === 'meetings', run: () => openTool('meetings') },
      { label: h('span', { class: 'tool-item' }, 'Map', MP.run ? h('small', {}, 'recording a run') : null), on: toolOpen === 'map', run: () => openMap() },
      { label: h('span', { class: 'tool-item' }, 'Signatures', SG.list.some((x) => x.status === 'sent' || x.status === 'viewed') ? h('small', {}, `${SG.list.filter((x) => x.status === 'sent' || x.status === 'viewed').length} waiting`) : null), on: toolOpen === 'signs', run: () => { SG.filter = null; openTool('signs'); } },
      { label: h('span', { class: 'tool-item' }, 'Vault', VK.key ? h('small', {}, 'unlocked') : null), on: toolOpen === 'vault', run: () => { VK.filter = null; openTool('vault'); } },
    ].filter(Boolean));
  });
  function openTool(name) {
    toolOpen = name;
    $('#settings').classList.add('hidden');
    $('#tool').classList.remove('hidden');
    $('#tool').classList.toggle('side', name === 'folders'); // beside the stacks, so cards can be dragged in
    renderTool();
  }
  function closeTool() {
    toolOpen = null;
    if (!MP.run) mapUnwatch();
    $('#tool').classList.add('hidden');
  }
  // Holds off while you're typing in it, so a redraw can't eat what you wrote. Sidekick keeps its own draft.
  function renderTool(force) {
    const el = $('#tool');
    if (!toolOpen || el.classList.contains('hidden')) return;
    if (!force && el.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
    const keep = el.scrollTop;
    el.replaceChildren(h('h2', {}, TOOLS[toolOpen].name, h('button', { class: 'icon-btn', html: I.close, 'aria-label': 'Close', onclick: closeTool })), ...TOOLS[toolOpen].render().filter(Boolean));
    el.scrollTop = keep;
  }

  // ----- Folders: somewhere to keep things out of the stacks. What's in a folder never auto-clears. -----
  // A top folder is the team's or just yours (Only me); folders inside it follow it.
  const FD = { open: null, q: '', sort: 'new' };
  const dirs = () => S.workspace?.dirs || [];
  const dirById = (id) => dirs().find((d) => d.id === id);
  const dirKids = (id) => dirs().filter((d) => (d.parentId || null) === (id || null)).sort((a, b) => a.name.localeCompare(b.name));
  const dirPath = (id) => {
    const out = [];
    for (let d = dirById(id); d && out.length < 10; d = dirById(d.parentId)) out.unshift(d);
    return out;
  };
  const dirTop = (id) => dirPath(id)[0];
  const dirTreeIds = (id) => {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const d of dirs()) if (d.parentId === out[i]) out.push(d.id);
    return out;
  };
  const dirItems = (id) => S.items.filter((x) => x.dirId === id && !x.parentId);
  const dirCount = (id) => { const t = new Set(dirTreeIds(id)); return S.items.filter((x) => t.has(x.dirId)).length; };
  // Every folder, parents first, for the pickers. skip: a folder (and what's in it) to leave out.
  const dirFlat = (skip) => {
    const out = [];
    const walk = (pid, depth) => { for (const d of dirKids(pid)) if (d.id !== skip) { out.push({ d, depth }); walk(d.id, depth + 1); } };
    walk(null, 0);
    return out;
  };
  const dirLabel = (d, depth) => h('span', { class: 'dir-pick', style: `padding-left:${depth * 14}px` }, h('span', { class: 'dir-ic', html: I.folder }), d.name, dirTop(d.id)?.private ? h('small', {}, ' · only me') : null);

  async function saveToDir(it, dirId) {
    try {
      upsert(await api('PATCH', '/items/' + it.id, { dirId }));
      render();
      const d = dirById(dirId);
      toast(d ? `Saved to ${d.name}` : 'Back in the stack', d ? { label: 'Open', run: () => openFolder(dirId) } : undefined);
    } catch (e) {
      toast(e.message);
    }
  }
  function folderMenu(it, anchor) {
    openMenu(anchor, [
      { head: 'Save to folder' },
      ...dirFlat().map(({ d, depth }) => ({ label: dirLabel(d, depth), on: it.dirId === d.id, run: () => saveToDir(it, d.id) })),
      { label: '+ New folder…', run: () => newFolder(null, (d) => saveToDir(it, d.id)) },
      it.dirId ? { label: 'Take it out (back to the stack)', run: () => saveToDir(it, null) } : null,
    ].filter(Boolean));
  }
  function newFolder(parentId, then) {
    const name = h('input', { placeholder: parentId ? 'Contracts' : 'Clients' });
    const priv = h('input', { type: 'checkbox' });
    sheet(parentId ? `New folder in ${dirById(parentId)?.name || 'folder'}` : 'New folder', [
      h('label', {}, 'Name', name),
      parentId ? null : h('label', { class: 'pick' }, priv, 'Only me: nobody else on the team sees it or what’s in it'),
    ], async () => {
      if (!name.value.trim()) throw new Error('Give it a name.');
      const d = await api('POST', '/dirs', { name: name.value, parentId, private: priv.checked });
      if (!dirById(d.id)) S.workspace.dirs = [...dirs(), d];
      then ? then(d) : openFolder(d.id);
    }, 'Create');
    setTimeout(() => name.focus(), 50);
  }
  function openFolder(id) {
    FD.open = id;
    FD.q = '';
    openTool('folders');
  }
  function dirMenu(d, anchor, row) {
    const top = !d.parentId;
    const mayShare = top && (d.ownerId === S.me?.memberId || amOwner());
    const n = dirCount(d.id);
    const move = (pid) => api('PATCH', '/dirs/' + d.id, { parentId: pid }).catch((e) => toast(e.message));
    openMenu(anchor, [
      { label: 'Rename', run: () => {
        const el = row?.querySelector('.dir-name');
        if (!el) return;
        inlineEdit(el, { value: d.name, select: [0, d.name.length], onDone: (name) => name && name !== d.name && api('PATCH', '/dirs/' + d.id, { name }).catch((e) => toast(e.message)) });
      } },
      { label: 'Move to…', run: () => openMenu(anchor, [
        { head: `Move ${d.name} to` },
        { label: 'Top level', on: top, run: () => move(null) },
        ...dirFlat(d.id).map(({ d: x, depth }) => ({ label: dirLabel(x, depth), on: d.parentId === x.id, run: () => move(x.id) })),
      ]) },
      mayShare ? { label: d.private ? 'Share with the team' : 'Make it only me', run: () => api('PATCH', '/dirs/' + d.id, { private: !d.private }).catch((e) => toast(e.message)) } : null,
      { label: n ? `Delete folder (its ${n} thing${n === 1 ? '' : 's'} go back to the stack)` : 'Delete folder', danger: true, run: async () => {
        await api('DELETE', '/dirs/' + d.id).catch((e) => toast(e.message));
        if (dirTreeIds(d.id).includes(FD.open)) FD.open = d.parentId || null;
        renderTool();
      } },
    ].filter(Boolean));
  }
  function dirRow(d) {
    const n = dirCount(d.id);
    const kids = dirKids(d.id).length;
    const row = h('div', { class: 'bill dir-row', 'data-dir': d.id, tabindex: '0', role: 'button', onclick: (e) => !e.target.closest('input') && openFolder(d.id), onkeydown: (e) => e.key === 'Enter' && e.target === row && openFolder(d.id) },
      h('span', { class: 'dir-ic', html: I.folder }),
      h('span', { class: 'bill-name' }, h('span', { class: 'dir-name' }, d.name), h('small', {}, [n ? `${n} thing${n === 1 ? '' : 's'}` : kids ? null : 'Empty', kids ? `${kids} folder${kids === 1 ? '' : 's'}` : null, !d.parentId && d.private ? 'only me' : null].filter(Boolean).join(' · '))),
      h('button', { class: 'icon-btn', html: I.more, title: 'Folder options', 'aria-label': 'Folder options', onclick: (e) => { e.stopPropagation(); dirMenu(d, e.currentTarget, row); } }));
    return row;
  }
  function dirUploads(files) {
    const id = FD.open;
    if (!id || !files.length) return;
    toast(`Uploading ${files.length} file${files.length === 1 ? '' : 's'} to ${dirById(id)?.name}…`);
    for (const f of files) uploadFile(f, { dirId: id }).catch((e) => toast(e.message));
  }
  function foldersTool() {
    if (FD.open && !dirById(FD.open)) FD.open = null;
    const id = FD.open;
    const path = dirPath(id);
    const crumbs = h('div', { class: 'dir-crumbs' },
      h('button', { class: 'link', onclick: () => { FD.open = null; renderTool(); } }, 'Folders'),
      ...path.flatMap((d, i) => [h('span', {}, '›'), i === path.length - 1 ? h('b', {}, d.name) : h('button', { class: 'link', onclick: () => { FD.open = d.id; renderTool(); } }, d.name)]));
    const body = h('div', { class: 'dir-body' });
    const draw = () => {
      const q = FD.q.trim().toLowerCase();
      const scope = id ? new Set(dirTreeIds(id)) : null;
      const hits = (it) => [it.name, it.text].some((t) => t && t.toLowerCase().includes(q));
      const items = q ? S.items.filter((x) => x.dirId && (!scope || scope.has(x.dirId)) && hits(x)) : id ? dirItems(id) : [];
      const by = { new: (a, b) => (b.editedAt || b.createdAt) - (a.editedAt || a.createdAt), name: (a, b) => (a.name || a.text || '').localeCompare(b.name || b.text || ''), type: (a, b) => kind(a).localeCompare(kind(b)) || (a.name || '').localeCompare(b.name || '') }[FD.sort];
      const sub = q ? dirFlat().filter(({ d }) => d.name.toLowerCase().includes(q) && (!scope || scope.has(d.id))).map(({ d }) => d) : dirKids(id);
      const ups = id ? [...S.uploads.values()].filter((u) => u.dirId === id) : [];
      body.replaceChildren(...[
        ...sub.map(dirRow),
        ...ups.map((u) => h('p', { class: 'day-hint' }, `Uploading ${u.name}…`)),
        items.length ? h('div', { class: 'list dir-list' }, [...items].sort(by).map((it) => {
          const el = cardEl(it);
          if (q && it.dirId !== id) el.querySelector('.sub')?.append(' · in ', dirById(it.dirId)?.name || '');
          return el;
        })) : null,
        !sub.length && !items.length && !ups.length ? h('p', { class: 'day-hint' }, q ? 'Nothing matches.'
          : id ? 'Empty. Drag cards here from a stack, drop files from your computer, or use “Save to folder” on any card.'
          : 'Keep things out of the stacks: files, notes, documents, links. Make a folder, then drag cards onto it or use the folder button on any card. Nothing in a folder auto-clears.') : null].filter(Boolean));
    };
    const search = h('input', { type: 'search', class: 'dir-search', value: FD.q, placeholder: id ? `Search ${dirById(id).name}` : 'Search all folders', 'aria-label': 'Search folders', oninput: (e) => { FD.q = e.target.value; draw(); } });
    const sorts = h('div', { class: 'seg dir-sort' }, [['new', 'Newest'], ['name', 'Name'], ['type', 'Type']].map(([k, label]) =>
      h('button', { class: FD.sort === k ? 'on' : null, onclick: () => { FD.sort = k; renderTool(true); } }, label)));
    const pick = h('input', { type: 'file', multiple: true, class: 'hidden', onchange: (e) => { dirUploads([...e.target.files]); e.target.value = ''; } });
    draw();
    return [
      crumbs,
      h('div', { class: 'dir-tools' }, search, sorts),
      h('div', { class: 'dir-view', 'data-dir': id || null }, body),
      h('div', { class: 'btns dir-foot' },
        h('button', { class: 'add-goal', onclick: () => newFolder(id) }, id ? '+ Folder inside' : '+ New folder'),
        id ? h('button', { class: 'add-goal', onclick: () => pick.click() }, '+ Upload files') : null,
        id ? h('button', { class: 'add-goal', onclick: () => newNoteIn(id) }, '+ Note') : null,
        pick),
    ];
  }
  function newNoteIn(dirId) {
    const ta = h('textarea', { rows: 8, placeholder: 'Write anything' });
    sheet(`New note in ${dirById(dirId)?.name}`, [ta], async () => {
      if (!ta.value.trim()) throw new Error('Write something first.');
      upsert(await api('POST', '/items', { type: 'text', text: ta.value, dirId }));
      render();
    });
    setTimeout(() => ta.focus(), 50);
  }
  // Drag a card (or files from your computer) onto a folder row, or into an open folder.
  const dirAt = (target) => {
    const el = target?.closest?.('#tool [data-dir]');
    return el && dirById(el.dataset.dir) ? el : null;
  };

  // ----- Word documents: read, edit and save as .docx, or make a PDF to sign or send -----
  // You edit the page Column shows. Saving writes a .docx from it that keeps the document's styles, headers and
  // footers, pictures and page setup; pieces Column can't edit (text boxes, footnotes) ride along as they were.
  const WD_STYLES = [['P', 'Normal text'], ['H1', 'Title'], ['H2', 'Heading 1'], ['H3', 'Heading 2'], ['H4', 'Heading 3']];
  const WD_WARN = { tracked: 'tracked changes are accepted', fields: 'fields like page numbers or a table of contents become plain text', textbox: 'text boxes stay as they are but can’t be edited here' };
  const isWord = (it) => kind(it) === 'docx';
  let wordGuard = () => false; // true when closing would lose changes (it says so, and offers to close anyway)

  function wordView(it, { edit: startEditing = false, close } = {}) {
    const page = h('div', { class: 'docx wd-page' }, 'Loading…');
    const bar = h('div', { class: 'wd-bar' });
    const note = h('p', { class: 'wd-note hidden' });
    const wrap = h('div', { class: 'wd' }, bar, note, page);
    const status = h('small', { class: 'wd-status' });
    let doc = null, editing = false, dirty = false, busy = false, range = null;
    const current = () => S.items.find((x) => x.id === it.id) || it;
    const setDirty = (on) => {
      dirty = on;
      status.textContent = on ? 'Not saved' : status.textContent === 'Not saved' ? '' : status.textContent;
    };
    wordGuard = () => {
      if (!dirty || !wrap.isConnected) return false;
      toast('You have changes you haven’t saved', { label: 'Close anyway', run: () => { dirty = false; close?.(); } });
      return true;
    };
    const leaving = (e) => {
      if (dirty && wrap.isConnected) e.preventDefault();
    };
    addEventListener('beforeunload', leaving);

    async function load() {
      try {
        doc = await ColumnWord.read(await fileBuf(current()));
        page.replaceChildren(...doc.el.childNodes);
      } catch (e) {
        doc = null;
        page.replaceChildren(h('p', {}, 'Couldn’t read this document. Download it to open it in Word.'));
      }
      setDirty(false);
      draw();
    }

    // The toolbar keeps the place you were typing, so choosing from it acts on that.
    document.addEventListener('selectionchange', function track() {
      if (!wrap.isConnected) return document.removeEventListener('selectionchange', track);
      const sel = getSelection();
      if (editing && sel.rangeCount && page.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0).cloneRange();
        sync();
      }
    });
    const restore = () => {
      page.focus({ preventScroll: true });
      if (range) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    };
    const exec = (cmd, value = null) => {
      restore();
      document.execCommand(cmd, false, value);
      setDirty(true);
      sync();
    };
    const tool = (label, title, run, cls = '') => {
      const b = h('button', { class: 'btn small ' + cls, title, 'aria-label': title, type: 'button' }, label);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', run);
      return b;
    };
    const STATES = [['bold', 'B'], ['italic', 'I'], ['underline', 'U'], ['strikeThrough', 'S'], ['insertUnorderedList', '•'], ['insertOrderedList', '1.'], ['justifyLeft', 'L'], ['justifyCenter', 'C'], ['justifyRight', 'R']];
    const btns = {};
    const styleSel = h('select', { class: 'wd-style', 'aria-label': 'Paragraph style' }, WD_STYLES.map(([v, l]) => h('option', { value: v }, l)));
    styleSel.addEventListener('change', () => {
      exec('formatBlock', `<${styleSel.value.toLowerCase()}>`);
    });
    const block = () => {
      let n = range?.startContainer;
      if (n?.nodeType === 3) n = n.parentNode;
      return n && page.contains(n) ? n.closest('h1,h2,h3,h4,h5,h6,p,li,td') : null;
    };
    function sync() {
      if (!editing) return;
      for (const [cmd] of STATES) btns[cmd]?.classList.toggle('on', document.queryCommandState(cmd));
      const b = block();
      const tag = b?.tagName;
      styleSel.value = WD_STYLES.some(([v]) => v === tag) ? tag : 'P';
      btns.table?.classList.toggle('on', !!b?.closest('td'));
    }

    function linkSheet() {
      const a = (() => {
        let n = range?.startContainer;
        if (n?.nodeType === 3) n = n.parentNode;
        return n && page.contains(n) ? n.closest('a') : null;
      })();
      const url = h('input', { type: 'url', placeholder: 'https://… or someone@example.com', value: a?.getAttribute('href')?.replace(/^mailto:/, '') || '' });
      sheet(a ? 'Edit link' : 'Add a link', [h('label', {}, 'Link to', url), h('p', { class: 'day-hint' }, 'Leave it empty to take the link off.')], async () => {
        let v = url.value.trim();
        if (v && !/^(https?:|mailto:|tel:)/i.test(v)) v = EMAIL_RE.test(v) ? 'mailto:' + v : 'https://' + v;
        if (v && !/^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d][\d\s().-]*)$/i.test(v)) throw new Error('That doesn’t look like a web address or an email.');
        if (a && range?.collapsed) {
          const r = document.createRange();
          r.selectNodeContents(a);
          range = r;
        }
        if (!v) return exec('unlink');
        if (range && !range.collapsed) exec('createLink', v);
        else exec('insertHTML', `<a href="${esc(v)}">${esc(v.replace(/^mailto:/, ''))}</a>&nbsp;`);
      }, 'Save');
    }
    function tableMenu(anchor) {
      const td = block()?.closest('td');
      const tr = td?.parentElement;
      const table = td?.closest('table');
      const fresh = (cell) => {
        const c = cell.cloneNode(false);
        c.removeAttribute('colspan');
        c.append(h('p', {}, h('br')));
        return c;
      };
      const changed = () => {
        setDirty(true);
        sync();
      };
      openMenu(anchor, [
        { label: 'Insert a table (3 × 3)', run: () => exec('insertHTML', `<table><tbody>${'<tr>' + '<td><p><br></p></td>'.repeat(3) + '</tr>'}${'<tr>' + '<td><p><br></p></td>'.repeat(3) + '</tr>'}${'<tr>' + '<td><p><br></p></td>'.repeat(3) + '</tr>'}</tbody></table><p><br></p>`) },
        ...(td ? [
          { head: 'This table' },
          { label: 'Add a row below', run: () => { const r = tr.cloneNode(false); [...tr.cells].forEach((c) => r.append(fresh(c))); tr.after(r); changed(); } },
          { label: 'Add a column to the right', run: () => { const i = td.cellIndex; for (const r of table.rows) { const c = r.cells[Math.min(i, r.cells.length - 1)]; c && c.after(fresh(c)); } changed(); } },
          { label: 'Delete this row', run: () => { tr.parentElement.children.length > 1 ? tr.remove() : table.remove(); changed(); } },
          { label: 'Delete this column', run: () => { const i = td.cellIndex; for (const r of [...table.rows]) r.cells[Math.min(i, r.cells.length - 1)]?.remove(); if (![...table.rows].some((r) => r.cells.length)) table.remove(); changed(); } },
          { label: 'Delete the table', run: () => { table.remove(); changed(); } },
        ] : []),
      ]);
    }

    async function save(copy, btn) {
      if (busy || !doc) return;
      busy = true;
      btn.disabled = true;
      status.textContent = 'Saving…';
      try {
        const blob = await doc.save(page);
        const it2 = current();
        if (copy) {
          const name = it2.name.replace(/\.docx$/i, '').replace(/ \(copy\)$/, '') + ' (copy).docx';
          const item = await uploadFile(new File([blob], name, { type: ColumnWord.DOCX }), { stackId: it2.stackId, channelId: it2.channelId });
          dirty = false;
          toast(`Saved as ${name}. The original hasn’t changed.`);
          if (item) openPreview(item, { edit: true, standalone: !!VIEW_ID });
          return;
        }
        upsert(await put('/api/files/' + it2.id, blob, () => {}));
        setDirty(false);
        status.textContent = 'Saved';
      } catch (e) {
        status.textContent = dirty ? 'Not saved' : '';
        toast(e.message);
      } finally {
        busy = false;
        btn.disabled = false;
      }
    }
    async function makePdf(btn) {
      if (!doc) return;
      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = 'Making the PDF…';
      try {
        const blocks = await ColumnWord.outline(page, doc);
        const item = await api('POST', '/docs/pdf', { itemId: it.id, name: current().name, blocks });
        upsert(item);
        toast(`Made ${item.name}`, { label: 'Open', run: () => openPreview(item, { standalone: !!VIEW_ID }) });
      } catch (e) {
        toast(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = was;
      }
    }

    function draw() {
      wrap.classList.toggle('editing', editing);
      page.contentEditable = editing ? 'true' : 'false';
      page.spellcheck = editing;
      const warn = doc?.warn.map((k) => WD_WARN[k]).filter(Boolean) || [];
      note.classList.toggle('hidden', !editing || !warn.length);
      note.textContent = warn.length ? `When you save here, ${warn.join(', ')}. Save a copy to keep the original as it is.` : '';
      if (!editing) {
        const pdfBtn = h('button', { class: 'btn small', title: 'Make a PDF of this document, to sign or send for signature', onclick: (e) => makePdf(e.currentTarget) }, 'Make a PDF');
        bar.replaceChildren(
          doc ? h('button', { class: 'btn small primary-btn', onclick: () => edit() }, 'Edit') : null,
          doc ? pdfBtn : null,
          h('span', { class: 'pdf-gap' }), status);
        return;
      }
      for (const [cmd, label] of STATES) {
        const titles = { bold: 'Bold (Ctrl+B)', italic: 'Italic (Ctrl+I)', underline: 'Underline (Ctrl+U)', strikeThrough: 'Strikethrough', insertUnorderedList: 'Bulleted list', insertOrderedList: 'Numbered list', justifyLeft: 'Align left', justifyCenter: 'Center', justifyRight: 'Align right' };
        btns[cmd] = tool(label, titles[cmd], () => exec(cmd), 'wd-' + cmd);
      }
      btns.table = tool('Table', 'Insert or change a table', (e) => tableMenu(e.currentTarget));
      const saveBtn = h('button', { class: 'btn small primary-btn', title: 'Save (Ctrl+S)' }, 'Save');
      saveBtn.onclick = () => save(false, saveBtn);
      const copyBtn = h('button', { class: 'btn small', title: 'Save as a new document and leave this one as it is' }, 'Save a copy');
      copyBtn.onclick = () => save(true, copyBtn);
      const done = h('button', { class: 'btn small', 'data-label': '1' }, 'Done');
      done.onclick = () => {
        if (!dirty) return stopEditing();
        confirmClick(done, () => load().then(stopEditing));
      };
      const sep = () => h('span', { class: 'pdf-sep' });
      bar.replaceChildren(
        styleSel, sep(),
        btns.bold, btns.italic, btns.underline, btns.strikeThrough, sep(),
        btns.insertUnorderedList, btns.insertOrderedList, sep(),
        btns.justifyLeft, btns.justifyCenter, btns.justifyRight, sep(),
        tool('Link', 'Add a link (Ctrl+K)', linkSheet), btns.table,
        tool('↶', 'Undo (Ctrl+Z)', () => exec('undo')), tool('↷', 'Redo', () => exec('redo')),
        h('span', { class: 'pdf-gap' }), status, copyBtn, saveBtn, done);
      sync();
    }
    function edit() {
      editing = true;
      document.execCommand('defaultParagraphSeparator', false, 'p');
      draw();
      page.focus();
    }
    function stopEditing() {
      editing = false;
      status.textContent = '';
      draw();
    }

    page.addEventListener('input', () => editing && setDirty(true));
    page.addEventListener('keydown', (e) => {
      if (!editing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        $('.wd-bar .primary-btn', wrap)?.click();
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        linkSheet();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (block()?.closest('li')) exec(e.shiftKey ? 'outdent' : 'indent');
        else if (!e.shiftKey) exec('insertText', '\t');
      }
    });
    // What comes in from outside is cleaned down to what a document can hold.
    const insertFrom = (dt) => {
      const html = dt.getData('text/html');
      if (html) exec('insertHTML', cleanPaste(html));
      else exec('insertText', dt.getData('text/plain'));
    };
    page.addEventListener('paste', (e) => {
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.clipboardData.files?.length && !e.clipboardData.getData('text/plain')) return toast('Pictures can’t be pasted into a document here yet.');
      insertFrom(e.clipboardData);
    });
    page.addEventListener('drop', (e) => {
      if (!editing || hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (at) range = at;
      insertFrom(e.dataTransfer);
    });
    // While editing, a click on a link puts the cursor there; Ctrl- or Cmd-click opens it.
    page.addEventListener('click', (e) => {
      const a = editing && (e.metaKey || e.ctrlKey) && e.target.closest('a[href]');
      if (a) window.open(a.href, '_blank', 'noopener');
    });

    load().then(() => startEditing && doc && edit());
    return wrap;
  }

  // Pasted HTML (from Word, Google Docs, a web page) cut down to paragraphs, headings, lists, tables, links,
  // bold, italic, underline and strikethrough. Built fresh from elements, so nothing pasted can run.
  function cleanPaste(html) {
    const src = new DOMParser().parseFromString(html, 'text/html').body;
    const TAGS = { P: 'p', DIV: 'div', H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6', LI: 'li', UL: 'ul', OL: 'ol', TABLE: 'table', TBODY: 'tbody', THEAD: 'tbody', TFOOT: 'tbody', TR: 'tr', TD: 'td', TH: 'td', BR: 'br', B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', A: 'a' };
    const SKIP = /^(SCRIPT|STYLE|META|LINK|TITLE|HEAD|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|IMG|PICTURE|VIDEO|AUDIO|CANVAS|INPUT|BUTTON|SELECT|TEXTAREA|NOSCRIPT|FORM)$/;
    const out = h('div');
    const walk = (from, to) => {
      for (const n of from.childNodes) {
        if (n.nodeType === 3) {
          to.append(n.data.replace(/\s+/g, ' '));
          continue;
        }
        if (n.nodeType !== 1 || SKIP.test(n.tagName)) continue;
        let into = to;
        let tag = TAGS[n.tagName];
        // Google Docs wraps a whole paste in <b style="font-weight:normal">.
        if (tag === 'b' && /font-weight:\s*(normal|[1-5]00)/.test(n.getAttribute('style') || '')) tag = null;
        if (tag === 'a') {
          const href = n.getAttribute('href') || '';
          tag = /^(https?:|mailto:|tel:)/i.test(href) ? 'a' : null;
          if (tag) to.append((into = h('a', { href })));
        } else if (tag) to.append((into = h(tag)));
        else {
          const st = n.style;
          for (const [want, t] of [[/^(bold|bolder|[6-9]00)$/.test(st?.fontWeight || ''), 'b'], [st?.fontStyle === 'italic', 'i'], [/underline/.test(st?.textDecoration || ''), 'u'], [/line-through/.test(st?.textDecoration || ''), 's']]) {
            if (!want) continue;
            const x = h(t);
            into.append(x);
            into = x;
          }
        }
        if (tag === 'br') continue;
        const align = n.style?.textAlign;
        if (tag && /^(p|div|h\d|li)$/.test(tag) && ['center', 'right', 'justify'].includes(align)) into.style.textAlign = align;
        walk(n, into);
      }
    };
    walk(src, out);
    return out.innerHTML;
  }

  function newDocSheet(dest) {
    const name = h('input', { value: 'Untitled document', maxlength: 120 });
    sheet('New document', [h('label', {}, 'Name', name), h('p', { class: 'day-hint' }, 'A Word document (.docx). Anyone can download it and open it in Word.')], async () => {
      const n = name.value.trim().replace(/[\\/]/g, '-').replace(/\.docx$/i, '') || 'Untitled document';
      const item = await uploadFile(new File([await ColumnWord.blank()], n + '.docx', { type: ColumnWord.DOCX }), dest);
      if (item) openPreview(item, { edit: true });
    }, 'Create');
    setTimeout(() => name.select());
  }

  // ----- Map: where you've been with flyers, and the spots to come back to -----
  // A run is your path while you walk or drive, recorded while Column is open. Pins are dropped where you are,
  // or anywhere you tap: a flyer left, a spot to come back to (a date makes it a task), or a lead.
  // Everything is saved on the phone first and sent when there's signal, so a dead zone loses nothing.
  const MP = { trips: [], pins: [], zones: [], draw: null, drawLayer: null, loaded: false, map: null, box: null, group: null, live: null, meDot: null, meRing: null, me: null, watch: null, run: null, wake: null, camp: '', show: 'all', focus: null, centered: false, stats: null };
  const MAP_KIND = { flyer: 'Flyer left', back: 'Come back', lead: 'Lead' };
  const MAP_COLOR = { flyer: '#1f9d55', back: '#e8930c', lead: '#2f7bf5', done: '#9a9aa5' };
  const mapNewId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 20);
  const miles = /^en-(US|GB|LR|MM)$/i.test(navigator.language || '');
  const fmtDist = (m) => (miles ? `${(m / 1609.34).toFixed(m < 16093 ? 1 : 0)} mi` : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
  const fmtLength = (ms) => {
    const min = Math.round(ms / 60000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  };
  const metersBetween = (a, b) => {
    const r = Math.PI / 180;
    const x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(x));
  };
  const pinById = (id) => MP.pins.find((p) => p.id === id);
  const tripById = (id) => MP.trips.find((t) => t.id === id);
  const pinTitle = (p) => p.address || p.name || 'Dropped pin';
  const inCamp = (x) => !MP.camp || x.campaignId === MP.camp;
  const mapFor = (c) => [MP.pins, MP.trips, MP.zones].reduce((n, list) => n + list.filter((x) => x.campaignId === c.id).length, 0);
  const directions = (p) => /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? `https://maps.apple.com/?daddr=${p.lat},${p.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

  // Sent in order, one at a time. With no signal they wait here (kept across reloads) and go when it's back.
  let mapQ = store.get('mapQueue', []);
  let mapFlushing = false;
  function mapSend(method, path, body) {
    mapQ.push({ method, path, body });
    store.set('mapQueue', mapQ);
    flushMap();
  }
  async function flushMap() {
    if (mapFlushing || !S.token) return;
    mapFlushing = true;
    try {
      while (mapQ.length) {
        const job = mapQ[0];
        let res;
        try {
          res = await fetch('/api' + job.path, { method: job.method, headers: { Authorization: 'Bearer ' + S.token, 'Content-Type': 'application/json' }, body: JSON.stringify(job.body || {}) });
        } catch {
          break; // no signal: try again later
        }
        if (res.status >= 500 || res.status === 401) break;
        if (!res.ok) {
          const out = await res.json().catch(() => ({}));
          if (res.status !== 404) toast(out.error || 'The map couldn’t save a change.');
        }
        mapQ.shift();
        store.set('mapQueue', mapQ);
      }
    } finally {
      mapFlushing = false;
    }
    if (mapQ.length) setTimeout(flushMap, 15000);
  }
  addEventListener('online', flushMap);
  const mapPending = (id) => mapQ.some((j) => j.path.endsWith('/' + id) || j.body?.id === id);

  async function loadMap() {
    try {
      const x = await api('GET', '/map');
      // Anything made here and not sent yet stays, on top of what the server has.
      const keep = (list, fresh) => [...list.filter((y) => mapPending(y.id) && !fresh.some((f) => f.id === y.id)), ...fresh.map((f) => (mapPending(f.id) ? list.find((y) => y.id === f.id) || f : f))];
      MP.trips = keep(MP.trips, x.trips);
      MP.pins = keep(MP.pins, x.pins);
      MP.zones = keep(MP.zones, x.zones || []);
      MP.loaded = true;
    } catch {}
    const runId = store.get('mapRun', null);
    if (runId && !MP.run && tripById(runId) && !tripById(runId).endedAt) beginRun(tripById(runId));
    flushMap();
    mapDraw();
    renderTool();
  }
  function mapResetLocal() {
    if (MP.run) clearInterval(MP.run.timer);
    MP.run = null;
    mapUnwatch();
    Object.assign(MP, { trips: [], pins: [], zones: [], draw: null, loaded: false, camp: '', focus: null });
    mapQ = [];
    store.set('mapQueue', []);
    store.set('mapRun', null);
  }
  function mapNews(msg) {
    if (msg.type === 'map:remove') {
      MP.trips = MP.trips.filter((t) => t.id !== msg.tripId);
      MP.pins = MP.pins.filter((p) => p.id !== msg.pinId);
      MP.zones = MP.zones.filter((z) => z.id !== msg.zoneId);
    } else if (msg.zone && !mapPending(msg.zone.id)) {
      MP.zones = [msg.zone, ...MP.zones.filter((z) => z.id !== msg.zone.id)];
    } else if (msg.trip && msg.trip.id !== MP.run?.id && !mapPending(msg.trip.id)) {
      MP.trips = [msg.trip, ...MP.trips.filter((t) => t.id !== msg.trip.id)].sort((a, b) => b.startedAt - a.startedAt);
    } else if (msg.pin && !mapPending(msg.pin.id)) {
      MP.pins = [msg.pin, ...MP.pins.filter((p) => p.id !== msg.pin.id)];
    } else return;
    mapDraw();
    renderTool();
    renderCamps();
  }

  // ---- where you are ----
  function mapWatch() {
    if (MP.watch != null || !navigator.geolocation) return;
    MP.watch = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords;
      const first = !MP.me;
      MP.me = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, at: pos.timestamp || Date.now() };
      MP.geoErr = null;
      if (MP.run) runPoint(MP.me);
      drawMe();
      if (first) renderTool();
    }, (e) => {
      MP.geoErr = e.code === 1 ? 'Column can’t see your location. Allow location for this site in your browser settings, or tap the map to drop pins.' : 'Looking for your location…';
      renderTool();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
  function mapUnwatch() {
    if (MP.watch != null) navigator.geolocation.clearWatch(MP.watch);
    MP.watch = null;
  }
  const hereNow = () => (MP.me && Date.now() - MP.me.at < 120_000 ? MP.me : null);
  function drawMe() {
    if (!MP.map || !MP.me) return;
    const ll = [MP.me.lat, MP.me.lng];
    if (!MP.meDot) {
      // You stay on top of the pins, in a layer of your own.
      MP.map.createPane('me').style.zIndex = 650;
      MP.meRing = L.circle(ll, { pane: 'me', radius: MP.me.acc, color: '#2f7bf5', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(MP.map);
      MP.meDot = L.circleMarker(ll, { pane: 'me', radius: 7, color: '#fff', weight: 3, fillColor: '#2f7bf5', fillOpacity: 1, interactive: false }).addTo(MP.map);
    } else {
      MP.meDot.setLatLng(ll);
      MP.meRing.setLatLng(ll).setRadius(MP.me.acc);
    }
    if (!MP.centered && !MP.focus) {
      MP.centered = true;
      MP.map.setView(ll, 17);
    } else if (MP.run && MP.follow) MP.map.panTo(ll, { animate: true });
  }

  // ---- runs ----
  async function keepAwake() {
    try {
      MP.wake = MP.run ? await navigator.wakeLock?.request('screen') : null;
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && MP.run) keepAwake();
  });
  function beginRun(t) {
    MP.run = { id: t.id, buf: [], timer: setInterval(() => { flushRun(); runStats(); }, 15000) };
    MP.follow = true;
    store.set('mapRun', t.id);
    keepAwake();
    mapWatch();
  }
  function startRun() {
    const t = { id: mapNewId(), memberId: S.me?.memberId, by: S.me?.member, name: '', startedAt: Date.now(), endedAt: null, path: [], dist: 0, campaignId: MP.camp || null, createdAt: Date.now() };
    MP.trips.unshift(t);
    mapSend('POST', '/trips', { id: t.id, startedAt: t.startedAt, campaignId: t.campaignId });
    beginRun(t);
    if (MP.me) runPoint(MP.me);
    mapDraw();
    renderTool(true);
    toast(hereNow() ? 'Run started. Keep Column open while you go.' : 'Run started. Waiting for your location…');
  }
  // A point every 8 m or so, once the phone knows where it is to within 35 m.
  function runPoint(me) {
    const t = tripById(MP.run.id);
    if (!t || me.acc > 35) return;
    const pt = [Math.round(me.lat * 1e6) / 1e6, Math.round(me.lng * 1e6) / 1e6, Math.round(me.at)];
    const last = t.path.at(-1);
    if (last) {
      const d = metersBetween(last, pt);
      if (d < 8 || pt[2] <= last[2] || d / Math.max(1, (pt[2] - last[2]) / 1000) > 45) return;
      t.dist = Math.round((t.dist || 0) + d);
    }
    t.path.push(pt);
    MP.run.buf.push(pt);
    MP.live?.addLatLng([pt[0], pt[1]]);
    if (MP.run.buf.length >= 40) flushRun();
    runStats();
  }
  function flushRun() {
    if (!MP.run?.buf.length) return;
    mapSend('PATCH', '/trips/' + MP.run.id, { add: MP.run.buf });
    MP.run.buf = [];
  }
  function stopRun() {
    const t = tripById(MP.run.id);
    flushRun();
    clearInterval(MP.run.timer);
    if (t) {
      t.endedAt = Date.now();
      mapSend('PATCH', '/trips/' + t.id, { endedAt: t.endedAt });
    }
    MP.run = null;
    store.set('mapRun', null);
    MP.wake?.release?.().catch(() => {});
    MP.wake = null;
    if (toolOpen !== 'map') mapUnwatch();
    mapDraw();
    renderTool(true);
    if (t) toast(`Run saved: ${fmtDist(t.dist || 0)} in ${fmtLength(t.endedAt - t.startedAt)}, ${plural(MP.pins.filter((p) => p.tripId === t.id && p.kind === 'flyer').length, 'flyer')}.`);
  }
  const runFlyers = (t) => MP.pins.filter((p) => p.tripId === t.id && p.kind === 'flyer').length;
  function runStats() {
    const t = MP.run && tripById(MP.run.id);
    if (!t || !MP.stats?.isConnected) return;
    MP.stats.textContent = `${fmtDist(t.dist || 0)} · ${fmtLength(Date.now() - t.startedAt)} · ${plural(runFlyers(t), 'flyer')}`;
  }

  // ---- pins ----
  function newPin(kind, at, extra = {}) {
    const p = { id: mapNewId(), memberId: S.me?.memberId, by: S.me?.member, kind, lat: Math.round(at.lat * 1e6) / 1e6, lng: Math.round(at.lng * 1e6) / 1e6, note: '', address: '', name: '', phone: '', email: '', due: null, done: false, tripId: MP.run?.id || null, campaignId: MP.camp || null, photoId: null, taskId: null, createdAt: Date.now(), ...extra };
    return p;
  }
  function savePin(p, fresh, changes) {
    if (fresh) {
      MP.pins.unshift(p);
      const { memberId, by, taskId, ...body } = p;
      mapSend('POST', '/pins', body);
      // Its street address, when the lookup can find one.
      if (!p.address) {
        api('GET', `/geo?lat=${p.lat}&lng=${p.lng}`).then(({ address }) => {
          const now = pinById(p.id);
          if (!address || !now || now.address) return;
          now.address = address;
          mapSend('PATCH', '/pins/' + p.id, { address });
          mapDraw();
          renderTool();
        }).catch(() => {});
      }
    } else {
      Object.assign(p, changes);
      mapSend('PATCH', '/pins/' + p.id, changes);
    }
    mapDraw();
    renderTool();
    renderCamps();
  }
  function placeFor(fn) {
    const at = hereNow();
    if (at) return fn(at);
    toast(MP.geoErr && /can’t/.test(MP.geoErr) ? 'No location yet. Tap the map where you are to drop it there.' : 'Still finding your location. Try again in a moment, or tap the map to drop it there.');
  }
  function dropFlyer(at) {
    const p = newPin('flyer', at);
    savePin(p, true);
    toast('Flyer left', { label: 'Undo', run: () => deletePin(p) });
  }
  function deletePin(p) {
    MP.pins = MP.pins.filter((x) => x.id !== p.id);
    mapSend('DELETE', '/pins/' + p.id);
    MP.map?.closePopup();
    mapDraw();
    renderTool();
    renderCamps();
  }
  const inDays = (n) => addDays(todayKey(), n);
  function pinSheet(p, fresh) {
    const kind = h('select', {}, Object.entries(MAP_KIND).map(([k, l]) => h('option', { value: k, selected: k === p.kind }, l)));
    const address = h('input', { value: p.address || '', placeholder: 'Street address (found for you when there’s signal)' });
    const note = h('textarea', { rows: 3, placeholder: p.kind === 'back' ? 'New build, framing up. Check back when the windows are in.' : 'Anything worth remembering' });
    note.value = p.note || '';
    const due = h('input', { type: 'date', value: p.due || '' });
    const quick = h('div', { class: 'btns' }, [['2 weeks', 14], ['1 month', 30], ['3 months', 91]].map(([l, n]) => h('button', { type: 'button', class: 'btn small', onclick: () => { due.value = inDays(n); } }, l)));
    const name = h('input', { value: p.name || '', placeholder: 'Their name', autocomplete: 'off' });
    const phone = h('input', { type: 'tel', value: p.phone || '', placeholder: 'Phone', autocomplete: 'off' });
    const email = h('input', { type: 'email', value: p.email || '', placeholder: 'Email', autocomplete: 'off' });
    const photo = h('input', { type: 'file', accept: 'image/*', capture: 'environment' });
    const camp = h('select', {}, h('option', { value: '' }, 'No campaign'), S.campaigns.filter((c) => c.status !== 'done' || c.id === p.campaignId).map((c) => h('option', { value: c.id, selected: c.id === p.campaignId }, c.name)));
    const backBox = h('div', {}, h('label', {}, 'Come back on', due), quick, h('p', { class: 'day-hint' }, 'With a date, it’s a task on your Day for that day.'));
    const leadBox = h('div', { class: 'row2' }, h('label', {}, 'Name', name), h('label', {}, 'Phone', phone), h('label', {}, 'Email', email));
    const show = () => {
      backBox.classList.toggle('hidden', kind.value !== 'back');
      leadBox.classList.toggle('hidden', kind.value !== 'lead');
    };
    kind.addEventListener('change', show);
    show();
    const had = p.photoId && S.items.find((it) => it.id === p.photoId);
    sheet(fresh ? MAP_KIND[p.kind] : 'Edit pin', [
      h('label', {}, 'What', kind),
      h('label', {}, 'Where', address),
      backBox, leadBox,
      h('label', {}, 'Note', note),
      h('label', {}, had ? 'Replace the photo' : 'Photo (optional)', photo),
      S.campaigns.length ? h('label', {}, 'Campaign', camp) : null,
    ], async () => {
      const changes = { kind: kind.value, address: address.value.trim(), note: note.value.trim(), campaignId: camp.value || null };
      if (changes.kind === 'back') changes.due = due.value || null;
      else if (p.due) changes.due = null;
      if (changes.kind === 'lead') Object.assign(changes, { name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim() });
      if (changes.kind === 'lead' && !changes.name && !changes.phone && !changes.note) throw new Error('Add their name, phone, or a note.');
      if (photo.files[0]) {
        const item = await uploadFile(photo.files[0], { stackId: campById(changes.campaignId)?.stackId || null });
        if (item) changes.photoId = item.id;
      }
      if (fresh) savePin(Object.assign(p, changes), true);
      else savePin(p, false, changes);
      if (changes.kind === 'back' && changes.due) toast(`Come back ${dueLabel(changes.due)}: it’s on your tasks`);
    }, fresh ? 'Drop pin' : 'Save');
  }

  // ---- drawing ----
  let leafletLoad = null;
  const loadLeaflet = () => (leafletLoad ||= new Promise((ok, bad) => {
    document.head.append(h('link', { rel: 'stylesheet', href: '/vendor/leaflet-1.9.4/leaflet.css' }));
    const s = document.createElement('script');
    s.src = '/vendor/leaflet-1.9.4/leaflet.js';
    s.onload = () => ok(window.L);
    s.onerror = () => {
      leafletLoad = null;
      bad(new Error('Couldn’t load the map.'));
    };
    document.head.append(s);
  }));
  function mapBox() {
    if (MP.box) return MP.box;
    MP.box = h('div', { class: 'map-box' }, h('p', { class: 'day-hint map-loading' }, 'Loading the map…'));
    loadLeaflet().then(() => {
      MP.box.replaceChildren();
      MP.map = L.map(MP.box, { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(MP.map);
      MP.group = L.layerGroup().addTo(MP.map);
      MP.map.on('click', (e) => (MP.draw ? drawPoint(e.latlng) : tapMenu(e.latlng)));
      MP.map.on('dragstart', () => (MP.follow = false));
      new ResizeObserver(() => MP.map.invalidateSize()).observe(MP.box);
      mapDraw(true);
      drawMe();
    }).catch((e) => MP.box.replaceChildren(h('p', { class: 'day-hint map-loading' }, e.message)));
    return MP.box;
  }
  // ---- done streets and blocks ----
  // Tap along a street to mark it covered, or tap the corners of a block to shade it in.
  function startDraw(kind = 'line') {
    MP.draw = { kind, pts: [] };
    MP.map?.closePopup();
    mapDraw();
    drawPreview();
    renderTool(true);
  }
  function drawPoint(ll) {
    MP.draw.pts.push([Math.round(ll.lat * 1e6) / 1e6, Math.round(ll.lng * 1e6) / 1e6]);
    drawPreview();
    renderTool(true);
  }
  function drawPreview() {
    MP.drawLayer?.remove();
    MP.drawLayer = null;
    if (!MP.draw || !MP.map) return;
    const g = L.layerGroup();
    const pts = MP.draw.pts;
    if (pts.length > 1) (MP.draw.kind === 'area' ? L.polygon(pts, { color: '#1f9d55', weight: 2, dashArray: '6 6', fillOpacity: 0.15 }) : L.polyline(pts, { color: '#1f9d55', weight: 10, opacity: 0.5, lineCap: 'round' })).addTo(g);
    pts.forEach((p, i) => L.circleMarker(p, { radius: i === pts.length - 1 ? 6 : 4, color: '#fff', weight: 2, fillColor: '#1f9d55', fillOpacity: 1, interactive: false }).addTo(g));
    MP.drawLayer = g.addTo(MP.map);
  }
  function endDraw() {
    MP.draw = null;
    mapDraw();
    drawPreview();
    renderTool(true);
  }
  function saveZone(kind, points, note = '') {
    const z = { id: mapNewId(), memberId: S.me?.memberId, by: S.me?.member, kind, points, note, campaignId: MP.camp || null, createdAt: Date.now() };
    MP.zones.unshift(z);
    const { memberId, by, ...body } = z;
    mapSend('POST', '/zones', body);
    mapDraw();
    renderTool(true);
    renderCamps();
    toast(kind === 'area' ? 'Block marked done' : 'Street marked done', { label: 'Undo', run: () => deleteZone(z) });
  }
  function deleteZone(z) {
    MP.zones = MP.zones.filter((x) => x.id !== z.id);
    mapSend('DELETE', '/zones/' + z.id);
    MP.map?.closePopup();
    mapDraw();
    renderTool();
    renderCamps();
  }
  // A run's path as a done street, thinned to at most 2000 points.
  function runDone(t) {
    const step = Math.ceil(t.path.length / 2000);
    const pts = t.path.filter((_, i) => i % step === 0 || i === t.path.length - 1).map((x) => [x[0], x[1]]);
    if (pts.length < 2) return toast('This run is too short to mark.');
    saveZone('line', pts, t.name || '');
  }
  function zonePop(z) {
    const del = h('button', { class: 'btn small danger', 'data-label': '1' }, 'Not done');
    del.addEventListener('click', () => confirmClick(del, () => deleteZone(z)));
    const camp = campById(z.campaignId);
    return h('div', { class: 'map-pop' },
      h('small', { class: 'map-kind', style: `color:${MAP_COLOR.flyer}` }, z.kind === 'area' ? 'Block done' : 'Street done'),
      h('b', {}, `Done ${dayName(dayKey(new Date(z.createdAt)))}`),
      z.note ? h('p', { class: 'map-note' }, z.note) : null,
      camp ? h('small', { class: 'map-when' }, camp.name) : null,
      h('div', { class: 'map-pop-btns' },
        h('button', { class: 'btn small', onclick: () => { MP.map.closePopup(); const note = h('textarea', { rows: 3, placeholder: 'Anything about it: gated, no soliciting, half the houses empty…' }); note.value = z.note || ''; sheet('Note', [note], () => { z.note = note.value.trim(); mapSend('PATCH', '/zones/' + z.id, { note: z.note }); }); } }, z.note ? 'Edit note' : 'Add a note'),
        del));
  }

  function tapMenu(ll) {
    const at = { lat: ll.lat, lng: ll.lng };
    const pop = L.popup({ closeButton: false });
    const go = (fn) => () => { MP.map.closePopup(pop); fn(); };
    pop.setLatLng(ll).setContent(h('div', { class: 'map-pop' },
      h('b', {}, 'Drop a pin here'),
      h('div', { class: 'map-pop-btns' },
        h('button', { class: 'btn small', onclick: go(() => dropFlyer(at)) }, 'Flyer left'),
        h('button', { class: 'btn small', onclick: go(() => pinSheet(newPin('back', at), true)) }, 'Come back…'),
        h('button', { class: 'btn small', onclick: go(() => pinSheet(newPin('lead', at), true)) }, 'Lead…')))).openOn(MP.map);
  }
  function pinPop(p) {
    const photo = p.photoId && S.items.find((it) => it.id === p.photoId);
    const del = h('button', { class: 'btn small danger', 'data-label': '1' }, 'Delete');
    del.addEventListener('click', () => confirmClick(del, () => deletePin(p)));
    return h('div', { class: 'map-pop' },
      h('small', { class: 'map-kind', style: `color:${MAP_COLOR[p.done ? 'done' : p.kind]}` }, MAP_KIND[p.kind] + (p.done ? ' · done' : '')),
      h('b', {}, pinTitle(p)),
      p.kind === 'lead' && p.name ? h('div', {}, p.name) : null,
      p.phone ? h('div', {}, h('a', { href: 'tel:' + p.phone.replace(/[^\d+]/g, '') }, p.phone)) : null,
      p.email ? h('div', {}, h('a', { href: 'mailto:' + p.email }, p.email)) : null,
      p.due ? h('div', { class: isOverdue({ due: p.due, done: p.done }) ? 'map-late' : null }, 'Come back ' + dueLabel(p.due)) : null,
      p.note ? h('p', { class: 'map-note' }, p.note) : null,
      photo ? h('img', { class: 'map-photo', src: fileUrl(photo), alt: 'Photo', onclick: () => openPreview(photo) }) : null,
      h('small', { class: 'map-when' }, `${dayName(dayKey(new Date(p.createdAt)))} · ${new Date(p.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
      h('div', { class: 'map-pop-btns' },
        h('a', { class: 'btn small', href: directions(p), target: '_blank', rel: 'noopener' }, 'Directions'),
        h('button', { class: 'btn small', onclick: () => { MP.map.closePopup(); pinSheet(p, false); } }, 'Edit'),
        p.kind === 'back' ? h('button', { class: 'btn small', onclick: () => { MP.map.closePopup(); savePin(p, false, { done: !p.done }); } }, p.done ? 'Not done' : 'Done') : null,
        del));
  }
  function mapDraw(fit) {
    if (!MP.group) return;
    MP.group.clearLayers();
    MP.live = null;
    if (MP.show === 'all' || MP.show === 'done') {
      for (const z of MP.zones) {
        if (!inCamp(z)) continue;
        const shape = z.kind === 'area'
          ? L.polygon(z.points, { color: '#1f9d55', weight: 2, fillColor: '#1f9d55', fillOpacity: 0.22, interactive: !MP.draw, bubblingMouseEvents: false })
          : L.polyline(z.points, { color: '#1f9d55', weight: 12, opacity: 0.45, lineCap: 'round', lineJoin: 'round', interactive: !MP.draw, bubblingMouseEvents: false });
        shape.bindPopup(() => zonePop(z), { maxWidth: 260 });
        shape.addTo(MP.group);
      }
    }
    for (const t of MP.trips) {
      if (!inCamp(t) || (t.path.length < 2 && t.id !== MP.run?.id)) continue;
      const line = L.polyline(t.path.map((x) => [x[0], x[1]]), t.id === MP.run?.id ? { color: '#6b5cf0', weight: 6, opacity: 0.9 } : { color: '#6b5cf0', weight: 4, opacity: 0.35 });
      line.addTo(MP.group);
      if (t.id === MP.run?.id) MP.live = line;
    }
    const markers = {};
    for (const p of MP.pins) {
      if (!inCamp(p) || (MP.show !== 'all' && MP.show !== p.kind)) continue;
      const m = L.circleMarker([p.lat, p.lng], { radius: p.kind === 'flyer' ? 6 : 9, color: '#fff', weight: 2, fillColor: MAP_COLOR[p.done ? 'done' : p.kind], fillOpacity: 1, interactive: !MP.draw, bubblingMouseEvents: false });
      m.bindPopup(() => pinPop(p), { maxWidth: 260 });
      m.addTo(MP.group);
      markers[p.id] = m;
    }
    if (MP.focus) {
      const p = pinById(MP.focus);
      MP.focus = null;
      if (p) {
        MP.centered = true;
        MP.map.setView([p.lat, p.lng], 18);
        markers[p.id]?.openPopup();
        return;
      }
    }
    if (fit && !MP.me) {
      const pts = [...MP.pins.filter(inCamp).map((p) => [p.lat, p.lng]), ...MP.trips.filter(inCamp).flatMap((t) => t.path.slice(-1).map((x) => [x[0], x[1]]))];
      if (pts.length) MP.map.fitBounds(pts, { maxZoom: 17, padding: [30, 30] });
    }
  }
  function openMap({ pinId = null, campaignId } = {}) {
    if (campaignId !== undefined) MP.camp = campaignId || '';
    MP.focus = pinId;
    openTool('map');
    if (MP.map) {
      mapDraw();
      setTimeout(() => MP.map.invalidateSize(), 50);
    }
  }
  function showOnMap(p) {
    MP.focus = p.id;
    if (MP.show !== 'all' && MP.show !== p.kind) MP.show = 'all';
    mapDraw();
    MP.box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function showTrip(t) {
    if (!MP.map || t.path.length < 1) return;
    MP.follow = false;
    MP.map.fitBounds(t.path.map((x) => [x[0], x[1]]), { maxZoom: 18, padding: [30, 30] });
    MP.box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawBar() {
    const d = MP.draw;
    const need = d.kind === 'area' ? 3 : 2;
    const tab = (k, l) => h('button', { class: d.kind === k ? 'on' : '', onclick: () => { d.kind = k; drawPreview(); renderTool(true); } }, l);
    return h('div', { class: 'map-draw' },
      h('div', { class: 'seg map-draw-kind' }, tab('line', 'Street'), tab('area', 'Block or area')),
      h('p', { class: 'map-draw-hint' }, d.kind === 'area'
        ? (d.pts.length ? `${plural(d.pts.length, 'corner')}. Keep tapping corners, then Save.` : 'Tap the corners of the block on the map, all the way round.')
        : (d.pts.length ? `${plural(d.pts.length, 'point')}. Keep tapping along the street, then Save.` : 'Tap along the street on the map: where you started, each corner, and where you stopped.')),
      h('div', { class: 'btns' },
        h('button', { class: 'btn small', disabled: !d.pts.length, onclick: () => { d.pts.pop(); drawPreview(); renderTool(true); } }, 'Undo point'),
        h('button', { class: 'btn small', onclick: endDraw }, 'Cancel'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn small primary-btn', disabled: d.pts.length < need, onclick: () => { const { kind, pts } = d; MP.draw = null; drawPreview(); saveZone(kind, pts); } }, 'Save as done')));
  }
  function mapTool() {
    mapWatch();
    const box = mapBox();
    if (MP.map) setTimeout(() => MP.map.invalidateSize(), 0);
    const run = MP.run && tripById(MP.run.id);
    MP.stats = h('span', { class: 'map-stats' });
    const camps = S.campaigns.filter((c) => c.status !== 'done' || c.id === MP.camp);
    const backs = MP.pins.filter((p) => p.kind === 'back' && !p.done && inCamp(p)).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.createdAt - a.createdAt);
    const doneBacks = MP.pins.filter((p) => p.kind === 'back' && p.done && inCamp(p)).length;
    const leads = MP.pins.filter((p) => p.kind === 'lead' && inCamp(p));
    const trips = MP.trips.filter((t) => inCamp(t) && t.id !== MP.run?.id).slice(0, 30);
    const flyers = MP.pins.filter((p) => p.kind === 'flyer' && inCamp(p)).length;
    const big = (label, cls, fn) => h('button', { class: 'map-act ' + cls, onclick: fn }, label);
    const tripMenu = (anchor, t) => openMenu(anchor, [
      { label: 'Show on the map', run: () => showTrip(t) },
      { label: 'Mark its streets done', run: () => runDone(t) },
      { label: 'Rename…', run: () => { const name = h('input', { value: t.name || '', placeholder: 'Maple Ave and around' }); sheet('Name this run', [h('label', {}, 'Name', name)], () => { t.name = name.value.trim(); mapSend('PATCH', '/trips/' + t.id, { name: t.name }); renderTool(); }); } },
      { label: 'Delete run', danger: true, run: () => { MP.trips = MP.trips.filter((x) => x.id !== t.id); mapSend('DELETE', '/trips/' + t.id); mapDraw(); renderTool(); } },
    ]);
    const out = [
      h('div', { class: 'map-run' + (run ? ' on' : '') },
        run ? h('span', { class: 'map-rec' }) : null,
        run ? MP.stats : h('span', { class: 'map-stats' }, MP.geoErr || (hereNow() ? 'Ready when you are' : 'Finding your location…')),
        run ? h('button', { class: 'btn small primary-btn', onclick: stopRun }, 'Stop run') : h('button', { class: 'btn small primary-btn', onclick: startRun }, 'Start a run')),
      MP.draw ? drawBar() : h('div', { class: 'map-acts' },
        big('Flyer left', 'flyer', () => placeFor(dropFlyer)),
        big('Come back…', 'back', () => placeFor((at) => pinSheet(newPin('back', at), true))),
        big('Lead…', 'lead', () => placeFor((at) => pinSheet(newPin('lead', at), true))),
        h('button', { class: 'map-act done', onclick: () => startDraw('line') }, 'Mark a street or block done')),
      box,
      h('div', { class: 'map-filters' },
        h('div', { class: 'seg map-show' }, [['all', 'All'], ['done', `Done ${MP.zones.filter(inCamp).length}`], ['flyer', `Flyers ${flyers}`], ['back', `Come back ${backs.length}`], ['lead', `Leads ${leads.length}`]].map(([k, l]) =>
          h('button', { class: MP.show === k ? 'on' : '', onclick: () => { MP.show = k; mapDraw(); renderTool(true); } }, l))),
        camps.length ? h('select', { class: 'map-camp', 'aria-label': 'Campaign', onchange: (e) => { MP.camp = e.target.value; mapDraw(true); renderTool(true); } },
          h('option', { value: '' }, 'All campaigns'), camps.map((c) => h('option', { value: c.id, selected: c.id === MP.camp }, c.name))) : null),
      MP.camp ? h('p', { class: 'day-hint' }, `New runs and pins go on ${campById(MP.camp)?.name || 'this campaign'}.`) : null,
      h('section', {}, h('h3', {}, 'Come back to'),
        backs.length ? backs.map((p) => h('div', { class: 'bill map-row', onclick: () => showOnMap(p) },
          h('span', { class: 'bill-name' }, pinTitle(p), h('small', {}, p.note || 'No note')),
          h('span', { class: 'bill-right' }, p.due ? h('small', { class: isOverdue({ due: p.due, done: false }) ? 'map-late' : null }, dueLabel(p.due)) : h('small', {}, 'No date'),
            h('a', { class: 'btn small', href: directions(p), target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'Go')))) :
          h('p', { class: 'day-hint' }, 'Spots to double back to show here, soonest first. Drop one with Come back, or tap the map.'),
        doneBacks ? h('p', { class: 'day-hint' }, `${plural(doneBacks, 'spot')} done.`) : null),
      leads.length ? h('section', {}, h('h3', {}, 'Leads'), leads.slice(0, 50).map((p) => h('div', { class: 'bill map-row', onclick: () => showOnMap(p) },
        h('span', { class: 'bill-name' }, p.name || pinTitle(p), h('small', {}, [p.phone, p.address].filter(Boolean).join(' · ') || p.note || '')),
        p.phone ? h('a', { class: 'btn small', href: 'tel:' + p.phone.replace(/[^\d+]/g, ''), onclick: (e) => e.stopPropagation() }, 'Call') : null))) : null,
      h('section', {}, h('h3', {}, 'Runs'),
        trips.length ? trips.map((t) => h('div', { class: 'bill map-row', onclick: () => showTrip(t) },
          h('span', { class: 'bill-name' }, t.name || `${dayName(dayKey(new Date(t.startedAt)))} · ${new Date(t.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
            h('small', {}, [fmtDist(t.dist || 0), t.endedAt ? fmtLength(t.endedAt - t.startedAt) : 'not finished', plural(runFlyers(t), 'flyer'), campById(t.campaignId)?.name].filter(Boolean).join(' · '))),
          h('button', { class: 't-btn', html: I.more, 'aria-label': 'More', onclick: (e) => { e.stopPropagation(); tripMenu(e.currentTarget, t); } }))) :
          h('p', { class: 'day-hint' }, 'Press Start a run when you head out. Column draws your path while it’s open, so you can see which streets you’ve covered. Keep the screen on: a phone stops sharing its location with a web page when the screen locks.')),
    ];
    setTimeout(runStats);
    return out;
  }

  // ----- PDFs: read, fill in, sign, and send for signature -----
  // What you add (text, dates, checks, your signature, form answers) stays in the viewer until you save a copy;
  // the original file never changes. Sending for signature places boxes for the other person to fill instead.
  const SG = { mine: {}, dims: {}, list: [], filter: null };
  const PDF_SIZE = { text: [20, 14], date: [72, 14], check: [12, 12], sig: [150, 45], ini: [48, 30], name: [150, 18] }; // points
  const SEND_TOOLS = [['sig', 'Signature'], ['ini', 'Initials'], ['date', 'Date signed'], ['name', 'Name'], ['text', 'Text box']];
  const FIELD_NAME = Object.fromEntries(SEND_TOOLS);
  const SIGN_STATUS = { sent: 'Sent', viewed: 'Opened', signed: 'Signed', declined: 'Declined', void: 'Cancelled', expired: 'Expired' };
  const pdfViews = new Map(); // item → its open viewer, so redrawing what's around it keeps your marks
  let pdfStop = () => false; // Esc puts down the tool in hand before it closes anything
  const measure = document.createElement('canvas').getContext('2d');
  const textWidth = (t, size) => {
    measure.font = `${size}px Helvetica, Arial, sans-serif`;
    return measure.measureText(t).width;
  };
  const markId = () => Math.random().toString(36).slice(2, 10);

  async function loadSignature() {
    try {
      SG.mine = await api('GET', '/signature');
    } catch {}
    await Promise.all(['sig', 'ini'].map((k) => new Promise((done) => {
      if (!SG.mine[k]) return done();
      const img = new Image();
      img.onload = img.onerror = () => done((SG.dims[k] = img.naturalWidth / img.naturalHeight || 3));
      img.src = SG.mine[k];
    })));
    renderTool();
  }
  async function loadSigns() {
    try {
      SG.list = await api('GET', '/signs');
    } catch {}
    renderCamps();
    renderTool();
  }
  function upsertSign(x) {
    SG.list = [x, ...SG.list.filter((y) => y.id !== x.id)].sort((p, q) => q.createdAt - p.createdAt);
    renderCamps();
    renderTool();
  }

  function signatureSheet(kind, then) {
    const name = S.me?.member || '';
    const typed = kind === 'ini' ? name.split(/\s+/).map((w) => w[0] || '').join('').toUpperCase() : name;
    const pad = ColumnPdf.pad({ typed, label: kind === 'ini' ? 'Your initials' : 'Your signature' });
    sheet(kind === 'ini' ? 'Your initials' : 'Your signature', [
      pad.el,
      h('p', { class: 'day-hint' }, 'Kept with your account so you can sign anything in Column with one click. Only you can use it.'),
    ], async () => {
      const png = pad.png();
      if (!png) throw new Error(kind === 'ini' ? 'Draw or type your initials first.' : 'Draw or type your signature first.');
      await api('PUT', '/signature', { [kind]: png });
      await loadSignature();
      then?.();
    });
  }

  function pdfView(it, { docked = false } = {}) {
    const key = `${it.id}:${it.editedAt || it.createdAt}:${docked ? 'dock' : 'full'}`;
    if (pdfViews.has(key)) return pdfViews.get(key);
    const P = { marks: [], form: {}, fields: [], tool: null, sending: false, zoom: 1, doc: null, view: null, width: 0, run: 0 };
    const bar = h('div', { class: 'pdf-bar' });
    const hint = h('div', { class: 'pdf-hint hidden' });
    const host = h('div', { class: 'pdf-pages' }, h('p', { class: 'day-hint' }, 'Opening…'));
    const scroll = h('div', { class: 'pdf-scroll' }, host);
    const el = h('div', { class: 'pdf' + (docked ? ' docked' : '') }, bar, h('div', { class: 'pdf-body' }, hint, scroll));
    pdfViews.set(key, el);
    if (pdfViews.size > 6) pdfViews.delete(pdfViews.keys().next().value);
    const marks = () => (P.sending ? P.fields : P.marks);
    const dirty = () => P.marks.length > 0 || Object.keys(P.form).length > 0;

    async function layout() {
      if (!P.doc || !el.isConnected) return;
      const width = Math.round(Math.max(200, scroll.clientWidth - 16) * P.zoom);
      if (P.view && Math.abs(width - P.width) < 4) return;
      const at = scroll.scrollTop / (scroll.scrollHeight || 1);
      P.width = width;
      P.view?.stop();
      const pages = h('div', {});
      host.replaceChildren(pages);
      const run = ++P.run;
      P.view = await ColumnPdf.pages(P.doc, pages, { width, onPage: (p) => fillPage(p) });
      if (run === P.run) scroll.scrollTop = at * scroll.scrollHeight;
    }
    let resizing;
    new ResizeObserver(() => {
      clearTimeout(resizing);
      resizing = setTimeout(layout, 150);
    }).observe(scroll);
    ColumnPdf.open(fileUrl(it)).then((doc) => {
      P.doc = doc;
      layout();
    }).catch(() => host.replaceChildren(h('p', { class: 'day-hint' }, 'Couldn’t open this PDF. '), h('button', { class: 'btn small', onclick: () => download(it) }, 'Download it')));

    async function fillPage(p) {
      p.layer.replaceChildren();
      p.layer.onpointerdown = (e) => {
        if (!P.tool || e.target !== p.layer) return;
        e.preventDefault();
        const r = p.layer.getBoundingClientRect();
        place(p, e.clientX - r.left, e.clientY - r.top);
      };
      if (!P.sending) for (const f of await ColumnPdf.fields(p)) p.layer.append(formInput(p, f));
      for (const m of marks()) if (m.page === p.n) p.layer.append(markEl(p, m));
    }
    const refill = () => P.view?.pages.forEach(fillPage);

    function place(p, x, y) {
      const t = P.tool;
      const s = p.vp.scale;
      let [w, ht] = PDF_SIZE[t];
      if (!P.sending && (t === 'sig' || t === 'ini')) ht = clamp(w / (SG.dims[t] || 3), 14, 80);
      const m = { id: markId(), type: t, ...ColumnPdf.toPdf(p, x, y - (ht * s) / 2, w * s, ht * s) };
      if (!P.sending && (t === 'text' || t === 'date')) Object.assign(m, { type: 'text', text: t === 'date' ? new Date().toLocaleDateString() : '', size: 11 });
      marks().push(m);
      const node = markEl(p, m);
      p.layer.append(node);
      node.querySelector('input')?.focus();
      setTool(null);
      changed();
    }

    function markEl(p, m) {
      const s = p.vp.scale;
      const node = h('div', { class: `pdf-mark pm-${m.type}${P.sending ? ' pm-field' : ''}` });
      const put = () => {
        const b = ColumnPdf.fromPdf(p, m);
        Object.assign(node.style, { left: b.left + 'px', top: b.top + 'px', width: b.w + 'px', height: b.h + 'px' });
      };
      const drop = () => {
        const list = marks();
        if (list.includes(m)) list.splice(list.indexOf(m), 1);
        node.remove();
        changed();
      };
      const drag = (e, how) => {
        e.preventDefault();
        e.stopPropagation();
        const [x0, y0] = [e.clientX, e.clientY];
        const b = ColumnPdf.fromPdf(p, m);
        const [W, H] = [p.el.clientWidth, p.el.clientHeight];
        const ratio = !P.sending && ['sig', 'ini', 'check'].includes(m.type) ? b.w / b.h : 0;
        const move = (ev) => {
          let { left, top, w, h: ht } = b;
          if (how === 'move') {
            left = clamp(left + ev.clientX - x0, -w / 2, W - w / 2);
            top = clamp(top + ev.clientY - y0, -ht / 2, H - ht / 2);
          } else {
            w = Math.max(10, w + ev.clientX - x0);
            ht = ratio ? w / ratio : Math.max(10, ht + ev.clientY - y0);
          }
          Object.assign(m, ColumnPdf.toPdf(p, left, top, w, ht));
          put();
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          changed();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };
      const grip = h('span', { class: 'pm-grip', title: 'Drag to move', onpointerdown: (e) => drag(e, 'move') }, '⠿');
      const x = h('button', { class: 'pm-x', title: 'Remove', 'aria-label': 'Remove', onclick: drop }, '×');
      if (m.type === 'text') {
        const input = h('input', { value: m.text, 'aria-label': 'Text on the page', spellcheck: 'false' });
        const fit = () => {
          m.h = m.size * 1.25;
          m.w = Math.max(PDF_SIZE.text[0], textWidth(input.value || ' ', m.size) + 3);
          input.style.fontSize = m.size * s + 'px';
          put();
        };
        const size = (d) => {
          m.size = clamp(m.size + d, 6, 36);
          fit();
          changed();
        };
        input.addEventListener('input', () => {
          m.text = input.value;
          fit();
          changed();
        });
        input.addEventListener('blur', () => setTimeout(() => !m.text.trim() && !node.contains(document.activeElement) && drop(), 150));
        node.append(input, h('span', { class: 'pm-tools' }, grip,
          h('button', { title: 'Smaller', onclick: () => size(-1) }, 'A−'), h('button', { title: 'Bigger', onclick: () => size(1) }, 'A+'), x));
        fit();
        return node;
      }
      if (P.sending) node.append(h('span', { class: 'pm-label' }, FIELD_NAME[m.type]));
      else if (m.type === 'check') node.append(h('span', { class: 'pm-check' }, '✓'));
      else node.append(h('img', { src: SG.mine[m.type], alt: m.type === 'sig' ? 'Your signature' : 'Your initials', draggable: 'false' }));
      node.addEventListener('pointerdown', (e) => !e.target.closest('button, .pm-size') && drag(e, 'move'));
      node.append(h('span', { class: 'pm-tools' }, x), h('span', { class: 'pm-size', title: 'Drag to resize', onpointerdown: (e) => drag(e, 'size') }));
      put();
      if (m.type === 'check') node.querySelector('.pm-check').style.fontSize = m.h * s + 'px';
      return node;
    }

    // A fillable field in the PDF itself. Fields that share a name (one on each page, say) stay the same.
    function formInput(p, { a, left, top, w, h: ht }) {
      const name = a.fieldName;
      const val = Object.hasOwn(P.form, name) ? P.form[name] : a.fieldValue;
      const set = (v, from) => {
        P.form[name] = v;
        for (const o of host.querySelectorAll('[data-field]')) {
          if (o === from || o.dataset.field !== name || o.type === 'radio') continue;
          if (o.type === 'checkbox') o.checked = !!v;
          else o.value = v;
        }
        changed();
      };
      let input;
      if (a.fieldType === 'Btn' && a.radioButton) {
        input = h('input', { type: 'radio', name: key + name });
        input.checked = val === a.buttonValue;
        input.onchange = () => input.checked && set(a.buttonValue, input);
      } else if (a.fieldType === 'Btn') {
        input = h('input', { type: 'checkbox' });
        input.checked = val === true || (typeof val === 'string' && val !== 'Off' && val !== '');
        input.onchange = () => set(input.checked, input);
      } else if (a.fieldType === 'Ch') {
        input = h('select', {}, h('option', { value: '' }, ''), (a.options || []).map((o) => h('option', { value: o.exportValue ?? o.displayValue }, o.displayValue ?? o.exportValue)));
        input.value = (Array.isArray(val) ? val[0] : val) ?? '';
        input.onchange = () => set(input.value, input);
      } else {
        input = a.multiLine ? h('textarea') : h('input');
        input.value = val ?? '';
        if (a.maxLen) input.maxLength = a.maxLen;
        input.style.fontSize = Math.min(ht * 0.7, (a.textSize || 11) * p.vp.scale) + 'px';
        input.oninput = () => set(input.value, input);
      }
      input.dataset.field = name;
      input.disabled = !!a.readOnly;
      return h('div', { class: 'pdf-field', style: `left:${left}px;top:${top}px;width:${w}px;height:${ht}px` }, input);
    }

    function setTool(t) {
      P.tool = t;
      el.classList.toggle('placing', !!t);
      pdfStop = () => (P.tool && el.isConnected ? (setTool(null), true) : false);
      drawBar();
    }
    function pick(t) {
      if (!P.sending && (t === 'sig' || t === 'ini') && !SG.mine[t]) return signatureSheet(t, () => pick(t));
      setTool(P.tool === t ? null : t);
    }
    let was = null;
    function changed() {
      if (dirty() !== was || P.sending) drawBar();
    }
    function zoomBy(d) {
      P.zoom = clamp(P.zoom + d, 0.5, 3);
      layout();
    }
    function sendMode(on) {
      P.sending = on;
      P.tool = null;
      refill();
      setTool(null);
    }
    function drawBar() {
      was = dirty();
      const tool = (t, label, title) => h('button', { class: 'btn small' + (P.tool === t ? ' on' : ''), title, onclick: () => pick(t) }, label);
      if (P.sending) {
        const n = P.fields.length;
        bar.replaceChildren(h('b', { class: 'pdf-what' }, 'Their boxes:'), ...SEND_TOOLS.map(([t, l]) => tool(t, l)), h('span', { class: 'pdf-gap' }),
          h('button', { class: 'btn small', onclick: () => sendMode(false) }, 'Cancel'),
          h('button', { class: 'btn small primary-btn', disabled: !P.fields.some((f) => f.type === 'sig'), onclick: () => sendSheet(it, P, () => sendMode(false)) }, n ? `Next (${n})` : 'Next'));
      } else {
        bar.replaceChildren(...[
          h('button', { class: 'btn small', title: 'Smaller', 'aria-label': 'Smaller', onclick: () => zoomBy(-0.25) }, '−'),
          h('button', { class: 'btn small', title: 'Bigger', 'aria-label': 'Bigger', onclick: () => zoomBy(0.25) }, '+'),
          h('span', { class: 'pdf-sep' }),
          tool('text', 'Text', 'Type anywhere on the page'), tool('date', 'Date', 'Today’s date'), tool('check', '✓', 'A checkmark'),
          tool('sig', 'Sign', 'Your signature'), tool('ini', 'Initials', 'Your initials'),
          h('span', { class: 'pdf-gap' }),
          dirty() ? h('button', { class: 'btn small primary-btn', title: 'Saves a new PDF next to this one. This one stays as it is.', onclick: saveCopy }, 'Save a copy') : null,
          h('button', { class: 'btn small', title: 'Get someone else’s signature', onclick: () => sendMode(true) }, 'Send for signature'),
        ].filter(Boolean));
      }
      const tip = P.tool ? 'Click on the page where it goes. Esc to stop.'
        : P.sending ? `Put a box wherever they sign or fill something in. At least one Signature box.${dirty() ? ' Your own changes aren’t sent: save a copy first and send that one.' : ''}` : '';
      hint.textContent = tip;
      hint.classList.toggle('hidden', !tip);
    }
    async function saveCopy(e) {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const list = P.marks.filter((m) => m.type !== 'text' || m.text.trim()).map(({ id, type, page, x, y, w, h: ht, text, size }) => ({ id, type, page, x, y, w, h: ht, text, size }));
        const item = await api('POST', `/pdf/${it.id}/save`, { marks: list, form: P.form });
        P.marks = [];
        P.form = {};
        refill();
        drawBar();
        toast(`Saved “${item.name}”`, { label: 'Open', run: () => openPreview(S.items.find((x) => x.id === item.id) || item) });
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
        btn.textContent = 'Save a copy';
      }
    }
    drawBar();
    return el;
  }

  function sendSheet(it, P, done) {
    const name = h('input', { placeholder: 'Pat Smith', autocomplete: 'off' });
    const email = h('input', { type: 'email', placeholder: 'pat@example.com', list: 'signPeople', autocomplete: 'off' });
    const people = amOwner() ? (S.contacts || []).filter((x) => x.email) : [];
    const dl = h('datalist', { id: 'signPeople' }, people.slice(0, 2000).map((p) => h('option', { value: p.email }, p.name)));
    email.addEventListener('change', () => {
      const p = people.find((x) => x.email.toLowerCase() === email.value.trim().toLowerCase());
      if (p && !name.value.trim()) name.value = p.name;
    });
    const msg = h('textarea', { rows: 3, placeholder: 'A note for them (optional)' });
    const camp = h('select', {}, h('option', { value: '' }, 'None'), (S.campaigns || []).map((c) => h('option', { value: c.id }, c.name)));
    camp.value = campOfItem(it)?.id || '';
    const n = P.fields.length;
    sheet('Send for signature', [
      h('p', { class: 'day-hint' }, `“${it.name}” · ${n} box${n === 1 ? '' : 'es'} for them to fill`),
      h('label', {}, 'Their name', name), h('label', {}, 'Their email', email), dl,
      h('label', {}, 'Message', msg), h('label', {}, 'Campaign', camp),
      h('p', { class: 'day-hint' }, 'They get a private link and don’t need an account. When they sign, the signed copy lands next to this file, with a last page showing who signed, when and from where.'),
    ], async () => {
      const fields = P.fields.map(({ id, type, page, x, y, w, h: ht }) => ({ id, type, page, x, y, w, h: ht }));
      const x = await api('POST', '/signs', { itemId: it.id, signer: { name: name.value, email: email.value }, message: msg.value, campaignId: camp.value || null, fields });
      upsertSign(x);
      P.fields = [];
      done();
      setTimeout(() => signSheet(x, true));
    }, 'Make the signing link');
  }

  function signSheet(x, fresh) {
    x = SG.list.find((y) => y.id === x.id) || x;
    const open = x.status === 'sent' || x.status === 'viewed';
    const copy = h('button', { class: 'btn small', onclick: () => navigator.clipboard.writeText(x.link).then(() => toast('Link copied'), () => toast('Couldn’t copy. Select the link and copy it.')) }, 'Copy link');
    const mail = h('button', { class: 'btn small' }, 'Email it from Outlook');
    mail.addEventListener('click', async () => {
      mail.disabled = true;
      try {
        upsertSign(await api('POST', `/signs/${x.id}/email`));
        toast(`Emailed to ${x.signer.email}`);
      } catch (err) {
        toast(err.message);
      }
      mail.disabled = false;
    });
    const cancel = h('button', { class: 'btn small', 'data-label': '1' }, 'Cancel request');
    cancel.addEventListener('click', () => confirmClick(cancel, async () => {
      try {
        upsertSign(await api('POST', `/signs/${x.id}/void`));
        closeSheet();
      } catch (err) {
        toast(err.message);
      }
    }));
    const del = h('button', { class: 'btn small', 'data-label': '1' }, 'Delete');
    del.addEventListener('click', () => confirmClick(del, async () => {
      try {
        await api('DELETE', `/signs/${x.id}`);
        SG.list = SG.list.filter((y) => y.id !== x.id);
        renderCamps();
        renderTool();
        closeSheet();
      } catch (err) {
        toast(err.message);
      }
    }));
    const signed = x.signedItemId && S.items.find((y) => y.id === x.signedItemId);
    const fmt = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    sheet(x.name, [
      h('p', { class: 'sign-who' }, h('span', { class: `sign-st st-${x.status}` }, SIGN_STATUS[x.status]), ` ${x.signer.name} · ${x.signer.email}`),
      fresh ? h('p', { class: 'day-hint' }, 'Here’s their link. Email it from Outlook, or copy it into your own email or text.') : null,
      open ? h('div', { class: 'sign-link' }, h('input', { value: x.link, readonly: true, 'aria-label': 'Signing link', onfocus: (e) => e.target.select() }), copy) : null,
      open ? h('div', { class: 'btns' }, mail, cancel) : null,
      x.status === 'signed' ? h('div', { class: 'btns' }, signed ? h('button', { class: 'btn small primary-btn', onclick: () => { closeSheet(); openPreview(signed); } }, 'Open the signed copy') : h('span', { class: 'day-hint' }, 'The signed copy was removed from Column.')) : null,
      x.declineReason ? h('p', {}, `Their reason: “${x.declineReason}”`) : null,
      h('div', { class: 'any-h' }, 'History'),
      h('ul', { class: 'sign-log' }, x.events.slice().reverse().map((e) => h('li', {}, h('small', {}, fmt(e.at)), ` ${e.what.replace(/: “I agree.*$/, '')}`, e.ip ? h('small', {}, ` · ${e.ip}`) : null))),
      x.status === 'signed' ? h('p', { class: 'day-hint sign-hash' }, `Fingerprint of the signed copy (SHA-256): ${x.signedHash}`) : null,
      x.status !== 'signed' ? h('div', { class: 'btns' }, del) : null,
    ].filter(Boolean), async () => {}, 'Done');
  }

  function signsTool() {
    const mine = (k, label) => h('div', { class: 'sig-mine' },
      h('small', {}, label),
      SG.mine[k] ? h('img', { src: SG.mine[k], alt: label }) : h('span', { class: 'day-hint' }, 'Not added yet'),
      h('button', { class: 'btn small', onclick: () => signatureSheet(k) }, SG.mine[k] ? 'Change' : 'Add'));
    const f = SG.filter;
    const list = SG.list.filter((x) => !f || x.campaignId === f);
    return [
      h('div', { class: 'any-h' }, 'Yours'),
      h('div', { class: 'sig-mines' }, mine('sig', 'Signature'), mine('ini', 'Initials')),
      h('div', { class: 'any-h' }, 'Sent for signature'),
      f ? h('p', { class: 'day-hint' }, `For ${campById(f)?.name || 'one campaign'} · `, h('button', { class: 'link', onclick: () => { SG.filter = null; renderTool(); } }, 'Show all')) : null,
      list.length ? h('div', { class: 'sign-list' }, list.map(signRow))
        : h('p', { class: 'day-hint' }, 'Open a PDF and choose Send for signature. Who it went to, and whether they’ve opened or signed it, shows up here.'),
    ];
  }
  function signRow(x) {
    const when = new Date(x.signedAt || x.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return h('div', { class: 'bill sign-row', onclick: () => signSheet(x) },
      h('span', { class: 'bill-name' }, x.name, h('small', {}, `${x.signer.name} · ${when}`)),
      h('span', { class: `sign-st st-${x.status}` }, SIGN_STATUS[x.status]));
  }
  const signsFor = (c) => SG.list.filter((x) => x.campaignId === c.id).length;

  // ----- vault: a safe box locked with your own passphrase -----
  // Items are encrypted here, in the browser (AES-GCM, with a key made from the passphrase by PBKDF2), and
  // only the encrypted blobs go to the server. The key lives in memory while it's unlocked: locking, five
  // idle minutes, a minute in the background or signing out forgets it, and everything decrypted with it.
  const VAULT_ITERS = 600_000;
  const VAULT_IDLE = 5 * 60_000;
  const VAULT_CHECK = 'column-vault';
  const VK = { meta: undefined, raw: [], key: null, items: null, at: 0, hid: null, q: '', filter: null };
  const VAULT_KINDS = {
    login: ['Login', [['site', 'Website'], ['user', 'Username'], ['secret', 'Password', true]]],
    code: ['Code', [['code', 'Code', true], ['where', 'What it opens, or where']]],
    number: ['Account number', [['number', 'Number', true], ['extra', 'Routing or other number', true]]],
    key: ['Secret key', [['secret', 'Key', true]]],
    note: ['Private note', []],
  };
  const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
  async function vaultDerive(pass, salt, iters) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64u(salt), iterations: iters, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function vaultSeal(key, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    // Chunks keep String.fromCharCode under the argument limit for big notes.
    let s = '';
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function vaultOpen(key, blob) {
    const b = unb64u(blob);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, key, b.subarray(12));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function loadVault() {
    try {
      const v = await api('GET', '/vault');
      VK.meta = v.salt ? { salt: v.salt, iters: v.iters, check: v.check } : null;
      VK.raw = v.items || [];
      if (VK.key) await vaultDecryptAll();
    } catch {}
    renderCamps();
    renderTool();
  }
  async function vaultDecryptAll() {
    const out = [];
    for (const x of VK.raw) {
      try {
        out.push({ id: x.id, link: x.link, updatedAt: x.updatedAt, ...(await vaultOpen(VK.key, x.blob)) });
      } catch {
        out.push({ id: x.id, link: x.link, updatedAt: x.updatedAt, kind: 'note', title: 'Can’t be opened', broken: true });
      }
    }
    VK.items = out;
  }
  async function vaultUnlock(pass) {
    const key = await vaultDerive(pass, VK.meta.salt, VK.meta.iters);
    try {
      if ((await vaultOpen(key, VK.meta.check)) !== VAULT_CHECK) throw new Error();
    } catch {
      throw new Error('That’s not the passphrase.');
    }
    VK.key = key;
    vaultTouch();
    await vaultDecryptAll();
  }
  function vaultLock() {
    if (!VK.key && !VK.items) return;
    VK.key = null;
    VK.items = null;
    if ($('#sheet .vault-item')) closeSheet();
    // The drawer won't redraw under someone typing, so take the focus out first: locked has to hide it.
    if ($('#tool').contains(document.activeElement)) document.activeElement.blur();
    renderTool();
  }
  function vaultTouch() {
    VK.at = Date.now();
  }
  setInterval(() => VK.key && Date.now() - VK.at > VAULT_IDLE && vaultLock(), 15_000);
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => VK.key && vaultTouch(), true);
  document.addEventListener('visibilitychange', () => {
    clearTimeout(VK.hid);
    if (document.hidden && VK.key) VK.hid = setTimeout(vaultLock, 60_000);
  });
  const vaultLinked = (type, id) => VK.raw.filter((x) => x.link?.type === type && x.link.id === id).length;
  function openVaultFor(type, id) {
    VK.filter = { type, id };
    openTool('vault');
  }
  const vaultLinkName = (l) => (!l ? '' : l.type === 'campaign' ? campById(l.id)?.name || 'Campaign' : (S.contacts || []).find((x) => x.id === l.id)?.name || 'Contact');

  function vaultTool() {
    if (VK.meta === undefined) {
      loadVault();
      return [h('p', { class: 'day-hint' }, 'Opening…')];
    }
    if (!VK.meta) return vaultSetup(false);
    if (!VK.key) return vaultLocked();
    const q = h('input', { type: 'search', value: VK.q, placeholder: 'Search the vault', 'aria-label': 'Search the vault' });
    const box = h('div', { class: 'vault-list' });
    const show = () => {
      VK.q = q.value;
      const n = q.value.trim().toLowerCase();
      const f = VK.filter;
      const hits = VK.items
        .filter((x) => !f || (x.link?.type === f.type && x.link.id === f.id))
        .filter((x) => !n || [x.title, x.site, x.user, x.where, vaultLinkName(x.link)].some((v) => (v || '').toLowerCase().includes(n)))
        .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      box.replaceChildren(...(hits.length ? hits.map(vaultRow) : [h('p', { class: 'day-hint' }, VK.items.length ? 'Nothing matches.' : 'Nothing in here yet. Add a gate code, an account number, a key…')]));
    };
    q.addEventListener('input', show);
    show();
    return [
      h('div', { class: 'vault-bar' }, q,
        h('button', { class: 'btn small', onclick: () => vaultSheet(null) }, '+ Add'),
        h('button', { class: 'btn small', title: 'Lock the vault', onclick: vaultLock }, h('span', { class: 'vault-ic', html: I.lock }), 'Lock')),
      VK.filter ? h('p', { class: 'day-hint vault-filter' }, `Linked to ${vaultLinkName(VK.filter)} · `, h('button', { class: 'link', onclick: () => { VK.filter = null; renderTool(); } }, 'Show everything')) : null,
      box,
      h('p', { class: 'day-hint vault-foot' }, 'Locked with your passphrase on this device. Column’s server only keeps it scrambled; nobody else, team owners included, can open it. It locks by itself after 5 idle minutes.'),
    ];
  }
  function vaultRow(x) {
    const sub = [VAULT_KINDS[x.kind]?.[0], x.user || x.where || x.site, x.link ? '→ ' + vaultLinkName(x.link) : ''].filter(Boolean).join(' · ');
    return h('div', { class: 'bill vault-row', onclick: () => vaultSheet(x) },
      h('span', { class: 'vault-ic', html: I.lock }),
      h('span', { class: 'bill-name' }, x.title || 'Untitled', h('small', {}, sub)));
  }
  function vaultLocked() {
    const pass = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Vault passphrase', 'aria-label': 'Vault passphrase' });
    const err = h('p', { class: 'err' });
    const go = h('button', { class: 'btn primary-btn' }, 'Unlock');
    const unlock = async () => {
      if (!pass.value) return pass.focus();
      go.disabled = true;
      go.textContent = 'Unlocking…';
      err.textContent = '';
      try {
        await vaultUnlock(pass.value);
        pass.value = '';
        pass.blur();
        renderTool();
      } catch (e) {
        err.textContent = e.message;
        go.disabled = false;
        go.textContent = 'Unlock';
        pass.select();
      }
    };
    go.addEventListener('click', unlock);
    pass.addEventListener('keydown', (e) => e.key === 'Enter' && unlock());
    const reset = h('button', { class: 'link', 'data-label': '1' }, 'Forgot it? Start over');
    reset.addEventListener('click', () => confirmClick(reset, () => { VK.resetting = true; renderTool(); }));
    if (VK.resetting) return vaultSetup(true);
    setTimeout(() => pass.focus());
    return [
      h('div', { class: 'vault-lock' }, h('span', { class: 'vault-big', html: I.lock }), h('b', {}, 'Your vault is locked'),
        h('div', { class: 'vault-unlock' }, pass, go), err, reset),
    ];
  }
  function vaultSetup(reset) {
    const pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 10 characters' });
    const again = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Type it again' });
    const ok = h('input', { type: 'checkbox' });
    const err = h('p', { class: 'err' });
    const go = h('button', { class: 'btn primary-btn' }, reset ? 'Erase and start over' : 'Set up my vault');
    go.addEventListener('click', async () => {
      err.textContent = '';
      if (pass.value.length < 10) return (err.textContent = 'Use at least 10 characters. A few words together works well.');
      if (pass.value !== again.value) return (err.textContent = 'The two don’t match.');
      if (!ok.checked) return (err.textContent = 'Tick the box to show you’ve read it.');
      go.disabled = true;
      try {
        const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
        const key = await vaultDerive(pass.value, salt, VAULT_ITERS);
        const v = await api('POST', '/vault/setup', { salt, iters: VAULT_ITERS, check: await vaultSeal(key, VAULT_CHECK), reset });
        VK.meta = { salt: v.salt, iters: v.iters, check: v.check };
        VK.raw = [];
        VK.items = [];
        VK.key = key;
        VK.resetting = false;
        vaultTouch();
        renderTool();
        renderCamps();
      } catch (e) {
        err.textContent = e.message;
        go.disabled = false;
      }
    });
    return [
      h('p', { class: 'day-hint' }, reset
        ? 'This erases everything in your vault, for good, and locks the new one with a new passphrase.'
        : 'A safe place for gate and alarm codes, account numbers, logins and keys. It’s locked with a passphrase that only you know: Column’s server only ever keeps it scrambled, and nobody else on the team can open it.'),
      h('div', { class: 'vault-setup' },
        h('label', {}, 'Passphrase', pass),
        h('label', {}, 'Again', again),
        h('label', { class: 'pick' }, ok, 'If I forget this passphrase, what’s in the vault is gone. Nobody can get it back.')),
      err,
      h('div', { class: 'btns' }, reset ? h('button', { class: 'btn', onclick: () => { VK.resetting = false; renderTool(); } }, 'Cancel') : null, h('span', { style: 'flex:1' }), go),
    ];
  }
  async function vaultCopy(v) {
    try {
      await navigator.clipboard.writeText(v);
      toast('Copied. It’s cleared from the clipboard in 30 seconds.');
      setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30_000);
    } catch {
      toast('Couldn’t copy it.');
    }
  }
  function vaultSheet(x) {
    if (!VK.key) return;
    const kind = h('select', { 'aria-label': 'Kind' }, Object.entries(VAULT_KINDS).map(([k, [t]]) => h('option', { value: k, selected: (x?.kind || 'code') === k }, t)));
    const title = h('input', { value: x?.title || '', placeholder: 'Smith job gate, Supplier account…' });
    const note = h('textarea', { rows: 3, placeholder: 'Anything else (optional)' });
    note.value = x?.note || '';
    const vals = { ...(x || {}) };
    const fieldsBox = h('div', { class: 'vault-fields' });
    const drawFields = () => {
      fieldsBox.replaceChildren(...VAULT_KINDS[kind.value][1].map(([k, label, secret]) => {
        const inp = h('input', { value: vals[k] || '', type: secret ? 'password' : 'text', autocomplete: 'off', spellcheck: 'false' });
        inp.addEventListener('input', () => (vals[k] = inp.value));
        const tools = secret ? [
          h('button', { class: 'btn small', type: 'button', onclick: (e) => { const on = inp.type === 'password'; inp.type = on ? 'text' : 'password'; e.currentTarget.textContent = on ? 'Hide' : 'Show'; } }, 'Show'),
          h('button', { class: 'btn small', type: 'button', onclick: () => inp.value && vaultCopy(inp.value) }, 'Copy'),
          kind.value === 'login' ? h('button', { class: 'btn small', type: 'button', title: 'Make a strong password', onclick: () => { inp.value = vals[k] = vaultPassword(); inp.type = 'text'; } }, 'New') : null,
        ] : [];
        return h('label', {}, label, h('div', { class: 'vault-field' }, inp, ...tools));
      }));
    };
    kind.addEventListener('change', drawFields);
    drawFields();
    const camp = h('select', {}, h('option', { value: '' }, 'No campaign'), (S.campaigns || []).map((c) => h('option', { value: 'campaign:' + c.id, selected: x?.link?.type === 'campaign' && x.link.id === c.id }, c.name)));
    // Contacts are owners-only, like the Contacts tool.
    const contacts = amOwner() ? S.contacts || [] : [];
    const dl = h('datalist', { id: 'vaultContacts' }, contacts.slice(0, 2000).map((p) => h('option', { value: [p.name, p.address || p.city].filter(Boolean).join(' · ') })));
    const contactLabel = (p) => [p.name, p.address || p.city].filter(Boolean).join(' · ');
    const was = x?.link?.type === 'contact' ? contacts.find((p) => p.id === x.link.id) : null;
    const contact = h('input', { list: 'vaultContacts', value: was ? contactLabel(was) : '', placeholder: 'Type a name' });
    const del = x ? h('button', { class: 'btn small danger', 'data-label': '1' }, 'Delete') : null;
    del?.addEventListener('click', () => confirmClick(del, async () => {
      await api('DELETE', '/vault/items/' + x.id).catch((e) => toast(e.message));
      VK.raw = VK.raw.filter((y) => y.id !== x.id);
      VK.items = VK.items?.filter((y) => y.id !== x.id) || null;
      closeSheet();
      renderTool();
      renderCamps();
    }));
    sheet(x ? x.title || 'Vault item' : 'Add to the vault', [
      h('div', { class: 'vault-item' }),
      h('div', { class: 'row2' }, h('label', {}, 'Kind', kind), h('label', {}, 'Name', title)),
      fieldsBox,
      h('label', {}, 'Note', note),
      h('div', { class: 'row2' }, h('label', {}, 'Campaign', camp), contacts.length ? h('label', {}, 'Contact', contact, dl) : null),
      del,
    ], async () => {
      if (!VK.key) throw new Error('The vault locked. Unlock it and try again.');
      if (!title.value.trim()) throw new Error('Give it a name.');
      const k = kind.value;
      const data = { kind: k, title: title.value.trim(), note: note.value };
      for (const [f] of VAULT_KINDS[k][1]) data[f] = vals[f] || '';
      const p = contact.value.trim() && contacts.find((y) => contactLabel(y) === contact.value.trim());
      const link = p ? { type: 'contact', id: p.id } : camp.value ? { type: 'campaign', id: camp.value.slice(9) } : null;
      const blob = await vaultSeal(VK.key, data);
      const saved = x ? await api('PATCH', '/vault/items/' + x.id, { blob, link }) : await api('POST', '/vault/items', { blob, link });
      VK.raw = [...VK.raw.filter((y) => y.id !== saved.id), saved];
      VK.items = [...(VK.items || []).filter((y) => y.id !== saved.id), { id: saved.id, link: saved.link, updatedAt: saved.updatedAt, ...data }];
      renderTool();
      renderCamps();
    }, x ? 'Save' : 'Add');
  }
  function vaultPassword() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_';
    const r = crypto.getRandomValues(new Uint32Array(20));
    return [...r].map((n) => abc[n % abc.length]).join('');
  }

  // ----- Sidekick: plan a campaign or a schedule by talking it through -----
  // You talk it through; it proposes cards (goals, a prospect list, a script, a budget, time on your Day).
  // You accept, skip or edit each, ask it to check what you kept, then build: the cards become the campaign,
  // its goals and tasks, notes and lists, or blocks on your Day. Afterwards it keeps an eye on the pace,
  // and you can open it again to talk about how it's going.
  const SK = { open: null, busy: false, draft: '' };
  const skById = (id) => (S.sidekick || []).find((x) => x.id === id);
  const skFor = (campaignId) => (S.sidekick || []).find((x) => x.campaignId === campaignId);
  const skNudges = () => (S.sidekick || []).filter((x) => x.nudge && x.status !== 'done' && campById(x.campaignId)?.status === 'active');
  const skCards = (x) => x.messages.flatMap((m) => m.cards || []);
  const SK_LABEL = { campaign: 'Campaign', goal: 'Goal', list: 'Prospect list', note: 'Note', budget: 'Budget', block: 'On your Day', task: 'Task', change: 'Change' };
  async function skCall(method, path, body) {
    SK.busy = true;
    renderTool(true);
    try {
      const x = await api(method, path, { ...body, today: todayKey() });
      S.sidekick = [x, ...(S.sidekick || []).filter((y) => y.id !== x.id)];
      return x;
    } catch (e) {
      if (/Settings → AI/.test(e.message)) toast(e.message, { label: 'Open Settings', run: () => { closeTool(); openSettings(); } });
      else toast(e.message);
      return null;
    } finally {
      SK.busy = false;
      renderTool(true);
      if (path.endsWith('/say') || path === '/sidekick') {
        $('#tool .sk-end')?.scrollIntoView({ block: 'end' });
        $('#tool .sk-say')?.focus();
      }
    }
  }
  async function skStart(kind) {
    const x = await skCall('POST', '/sidekick', { kind });
    if (x) { SK.open = x.id; renderTool(); }
  }
  // From a campaign: its conversation if Sidekick made it or talked about it, else a new one about it.
  async function sidekickFor(c) {
    const had = skFor(c.id);
    if (had) { SK.open = had.id; openTool('sidekick'); return; }
    SK.open = null;
    openTool('sidekick');
    const x = await skCall('POST', '/sidekick', { campaignId: c.id });
    if (x) { SK.open = x.id; renderTool(); }
  }
  function skStatus(x) {
    const c = campById(x.campaignId);
    if (x.status === 'done') return 'Done';
    if (c) return `${Math.round(campProgress(c) * 100)}% · ${x.nudge ? 'behind pace' : c.status === 'done' ? 'finished' : 'on track'}`;
    if (x.status === 'built') return 'On your Day';
    const n = skCards(x).filter((y) => y.state === 'accepted').length;
    return n ? `Planning · ${n} accepted` : 'Planning';
  }
  function sidekickTool() {
    const x = SK.open && skById(SK.open);
    if (x) return skView(x);
    SK.open = null;
    const rank = (y) => (y.status === 'done' ? 3 : y.nudge ? 0 : y.status === 'built' ? 1 : 2);
    const all = [...(S.sidekick || [])].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
    const row = (y) => h('div', { class: 'bill sk-row' + (y.status === 'done' ? ' done' : ''), onclick: () => { SK.open = y.id; renderTool(); } },
      y.nudge && y.status !== 'done' ? h('span', { class: 'sk-dot', title: y.nudge.text }) : null,
      h('span', { class: 'bill-name' }, y.title, h('small', {}, `${y.kind === 'schedule' ? 'Schedule' : 'Campaign'} · ${skStatus(y)}`)),
      h('span', { class: 'bill-right' }, h('small', {}, ago(y.updatedAt))));
    return [
      h('p', { class: 'day-hint' }, 'Talk it through and Sidekick lays out a plan: what to do, what you need, and when. You pick what to keep, it checks it adds up, then builds it.'),
      h('div', { class: 'sk-start' },
        h('button', { class: 'btn', disabled: SK.busy, onclick: () => skStart('campaign') }, h('b', {}, 'Plan a campaign'), h('small', {}, 'Goals, prospects, scripts, budget')),
        h('button', { class: 'btn', disabled: SK.busy, onclick: () => skStart('schedule') }, h('b', {}, 'Plan my schedule'), h('small', {}, 'Time blocks around your Day'))),
      SK.busy ? h('p', { class: 'day-hint' }, 'Thinking…') : null,
      all.length ? h('section', {}, h('h3', {}, 'Your plans'), all.map(row)) : null,
      (S.plans || []).length ? h('details', { class: 'bill-paid' }, h('summary', {}, `Older plans · ${S.plans.length}`),
        S.plans.map((p) => h('div', { class: 'bill-hist', onclick: () => { PL.open = p.id; openTool('planner'); } }, h('span', {}, p.name), h('small', {}, p.goal || '')))) : null,
    ];
  }
  function skCardBody(c) {
    const fmtT = (m) => (m == null ? '' : fmtTime(m));
    if (c.type === 'campaign') return [h('b', {}, c.name), c.start || c.end ? h('small', {}, [c.start && dueLabel(c.start), c.end && dueLabel(c.end)].filter(Boolean).join(' → ')) : null, c.brief ? h('p', {}, c.brief) : null];
    if (c.type === 'goal') return [h('b', {}, c.title), h('small', {}, [c.kind === 'count' ? `${c.target} logged` : c.kind === 'money' ? money(c.target * 100) : `${c.tasks.length} task${c.tasks.length === 1 ? '' : 's'}`, c.due && 'by ' + dueLabel(c.due)].filter(Boolean).join(' · ')),
      c.tasks.length ? h('ul', {}, c.tasks.map((t) => h('li', {}, t.text, t.due ? h('small', {}, ' · ' + dueLabel(t.due)) : null))) : null];
    if (c.type === 'list') {
      const n = S.contacts ? S.contacts.filter((x) => liveMatch(c.live, x, Date.now())).length : null;
      const f = c.live;
      return [h('b', {}, c.name), h('small', {}, [f.stages.length ? f.stages.map(stageLabel).join(', ') : 'Any stage', f.cities.join(', '), f.sources.join(', '), f.days ? `last ${f.days} days` : '', f.need ? `has ${f.need}` : '', n != null ? `${n} from PSS now` : ''].filter(Boolean).join(' · '))];
    }
    if (c.type === 'note') return [h('b', {}, c.title || 'Note'), h('p', { class: 'sk-note' }, c.text)];
    if (c.type === 'budget') return [h('b', {}, `${c.category} · ${money(c.limit * 100)} a month`)];
    if (c.type === 'block') return [h('b', {}, c.text), h('small', {}, `${dueLabel(c.date)} · ${fmtT(c.start)}–${fmtT(c.end)}${c.repeat ? ' · repeats ' + c.repeat : ''}`)];
    if (c.type === 'task') return [h('b', {}, c.text), h('small', {}, [c.goal && 'under ' + c.goal, c.due && dueLabel(c.due)].filter(Boolean).join(' · '))];
    return [h('b', {}, c.text), h('small', {}, [c.due && 'due ' + dueLabel(c.due), c.target && 'target ' + c.target, c.end && 'ends ' + dueLabel(c.end)].filter(Boolean).join(' · '))];
  }
  function skCardEl(x, c) {
    const set = (state) => skCall('PATCH', `/sidekick/${x.id}/cards/${c.id}`, { state });
    const can = c.type !== 'list' || amOwner();
    return h('div', { class: `sk-card ${c.state}` },
      h('div', { class: 'sk-card-h' }, SK_LABEL[c.type]),
      ...skCardBody(c),
      c.why ? h('p', { class: 'sk-why' }, c.why) : null,
      h('div', { class: 'sk-card-btns' },
        c.state === 'built' ? h('small', { class: 'plan-ok' }, '✓ Added')
          : c.state === 'accepted' ? [h('small', { class: 'plan-ok' }, '✓ Accepted'), h('button', { class: 'linkish', onclick: () => set('new') }, 'Undo')]
          : c.state === 'skipped' ? [h('small', {}, 'Skipped'), h('button', { class: 'linkish', onclick: () => set('new') }, 'Undo')]
          : [can ? h('button', { class: 'btn small primary-btn', onclick: () => set('accepted') }, 'Accept') : h('small', {}, 'Only owners can pull PSS leads'),
            h('button', { class: 'btn small', onclick: () => skEdit(x, c) }, 'Edit'),
            h('button', { class: 'btn small', onclick: () => set('skipped') }, 'Skip')]));
  }
  // Edit a card's main fields, then it's accepted.
  function skEdit(x, c) {
    const f = {};
    const field = (k, label, el) => { f[k] = el; return h('label', {}, label, el); };
    const inp = (v, extra) => h('input', { value: v ?? '', ...extra });
    const area = (v, rows) => { const t = h('textarea', { rows }); t.value = v || ''; return t; };
    const time = (m) => h('input', { type: 'time', value: m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` });
    const body = {
      campaign: () => [field('name', 'Name', inp(c.name)), h('div', { class: 'row2' }, field('start', 'Starts', inp(c.start, { type: 'date' })), field('end', 'Ends', inp(c.end, { type: 'date' }))), field('brief', 'Brief', area(c.brief, 4))],
      goal: () => [field('title', 'Goal', inp(c.title)), h('div', { class: 'row2' }, c.kind === 'tasks' ? null : field('target', c.kind === 'money' ? 'Amount ($)' : 'How many', inp(c.target, { inputmode: 'decimal' })), field('due', 'By', inp(c.due, { type: 'date' }))), field('tasks', 'Tasks · one per line', area(c.tasks.map((t) => t.text).join('\n'), 5))],
      list: () => [field('name', 'Name', inp(c.name))],
      note: () => [field('title', 'Title', inp(c.title)), field('text', 'Text', area(c.text, 10))],
      budget: () => [h('div', { class: 'row2' }, field('category', 'Category', inp(c.category)), field('limit', 'Each month ($)', inp(c.limit, { inputmode: 'decimal' })))],
      block: () => [field('text', 'What', inp(c.text)), h('div', { class: 'row3' }, field('date', 'Day', inp(c.date, { type: 'date' })), field('start', 'From', time(c.start)), field('end', 'To', time(c.end)))],
      task: () => [field('text', 'Task', inp(c.text)), field('due', 'Due', inp(c.due, { type: 'date' }))],
      change: () => [field('text', 'Change', inp(c.text)), field('due', 'New date', inp(c.due || c.end, { type: 'date' }))],
    }[c.type]();
    sheet('Edit ' + SK_LABEL[c.type].toLowerCase(), body, async () => {
      const card = {};
      for (const [k, el] of Object.entries(f)) {
        if (k === 'tasks') card.tasks = el.value.split('\n').map((t) => t.trim()).filter(Boolean).map((text) => ({ text, due: c.tasks.find((t) => t.text === text)?.due || null }));
        else if (el.type === 'time') { const [hh, mm] = el.value.split(':').map(Number); card[k] = Number.isFinite(hh) ? hh * 60 + (mm || 0) : null; }
        else card[k] = el.value;
      }
      if (c.type === 'change' && c.end && !c.due) { card.end = card.due; delete card.due; }
      const y = await api('PATCH', `/sidekick/${x.id}/cards/${c.id}`, { state: 'accepted', card });
      S.sidekick = [y, ...S.sidekick.filter((z) => z.id !== y.id)];
      renderTool(true);
    }, 'Save and accept');
  }
  // Files for Sidekick to read while planning: from this device or from Column. The plan keeps its own copies.
  const SK_READS = /\.(pdf|png|jpe?g|gif|webp|docx|xlsx|pptx|txt|md|csv|tsv|json|html?|xml|ya?ml|log)$/i;
  async function skUpload(x, files) {
    SK.busy = true;
    renderTool(true);
    try {
      for (const f of files) {
        const res = await fetch(`/api/sidekick/${x.id}/files?name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type)}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + S.token }, body: f });
        const y = await res.json().catch(() => ({}));
        if (!res.ok) { toast(y.error || `Couldn’t add ${f.name}`); continue; }
        S.sidekick = [y, ...S.sidekick.filter((z) => z.id !== y.id)];
      }
    } finally {
      SK.busy = false;
      renderTool(true);
    }
  }
  function skPickFromColumn(x) {
    const q = h('input', { placeholder: 'Search files and notes', spellcheck: 'false' });
    const list = h('div', { class: 'sk-pick' });
    const chosen = new Set();
    const all = S.items.filter((it) => (it.type === 'file' && SK_READS.test(it.name)) || (it.type === 'text' && it.text?.trim())).sort((a, b) => b.createdAt - a.createdAt);
    const label = (it) => (it.type === 'text' ? it.text.trim().split('\n')[0].slice(0, 80) : it.name);
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      const hits = all.filter((it) => !s || label(it).toLowerCase().includes(s)).slice(0, 60);
      list.replaceChildren(...(hits.length ? hits.map((it) => {
        const box = h('input', { type: 'checkbox', checked: chosen.has(it.id), onchange: () => (box.checked ? chosen.add(it.id) : chosen.delete(it.id)) });
        return h('label', { class: 'sk-pick-row' }, box, h('span', {}, label(it)), h('small', {}, it.type === 'text' ? 'Note' : fmtSize(it.size)));
      }) : [h('p', { class: 'day-hint' }, s ? 'Nothing matches.' : 'No files or notes in Column yet.')]));
    };
    q.addEventListener('input', draw);
    draw();
    sheet('Add from Column', [q, list], async () => {
      for (const id of chosen) {
        const y = await api('POST', `/sidekick/${x.id}/files`, { itemId: id });
        S.sidekick = [y, ...S.sidekick.filter((z) => z.id !== y.id)];
      }
      renderTool(true);
    }, 'Add');
  }
  function skFilesBar(x) {
    const files = x.files || [];
    const input = h('input', { type: 'file', multiple: true, class: 'hidden', accept: '.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.xlsx,.pptx,.txt,.md,.csv,.tsv,.json,.html', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) skUpload(x, f); } });
    const add = (e) => openMenu(e.currentTarget, [
      { label: 'From this device…', run: () => input.click() },
      { label: 'From Column…', run: () => skPickFromColumn(x) },
    ]);
    const remove = async (f) => {
      const y = await api('DELETE', `/sidekick/${x.id}/files/${f.id}`).catch((er) => toast(er.message));
      if (y) { S.sidekick = [y, ...S.sidekick.filter((z) => z.id !== y.id)]; renderTool(true); }
    };
    return h('div', { class: 'sk-files' }, input,
      files.map((f) => h('span', { class: 'sk-file', title: f.chars > 80_000 ? 'Long file: Sidekick reads the first part' : f.name },
        h('span', { class: 'sk-file-n' }, f.name),
        h('button', { class: 'sk-file-x', 'aria-label': 'Remove ' + f.name, disabled: SK.busy, onclick: () => remove(f) }, '×'))),
      h('button', { class: 'btn small sk-attach', disabled: SK.busy || files.length >= 12, onclick: add, title: 'PDFs, images, Word, Excel, PowerPoint or text files for Sidekick to plan from' },
        h('span', { class: 'sk-clip', html: I.clip }), files.length ? 'Add' : 'Add files for Sidekick to read'));
  }
  function skView(x) {
    const c = campById(x.campaignId);
    const cards = skCards(x);
    const ready = cards.filter((y) => y.state === 'accepted');
    const say = h('textarea', { class: 'sk-say', rows: 2, placeholder: SK.busy ? 'Thinking…' : x.status === 'talking' ? 'Answer, or ask for changes…' : 'How’s it going? What should change?', disabled: SK.busy });
    say.value = SK.draft;
    say.addEventListener('input', () => (SK.draft = say.value));
    const send = () => {
      const text = say.value.trim();
      if (!text || SK.busy) return;
      SK.draft = '';
      skCall('POST', `/sidekick/${x.id}/say`, { text }).then((y) => { if (!y) SK.draft = text; });
    };
    say.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    const menu = (e) => openMenu(e.currentTarget, [
      { label: 'Rename', run: () => { const t = h('input', { value: x.title }); sheet('Rename', [h('label', {}, 'Name', t)], async () => { await skCall('PATCH', '/sidekick/' + x.id, { title: t.value }); }); } },
      x.status !== 'done' ? { label: 'Mark done', run: () => skCall('PATCH', '/sidekick/' + x.id, { status: 'done' }) } : { label: 'Reopen', run: () => skCall('PATCH', '/sidekick/' + x.id, { status: x.campaignId || x.entryIds.length ? 'built' : 'talking' }) },
      { label: 'Delete conversation', danger: true, run: async () => { await api('DELETE', '/sidekick/' + x.id).catch((er) => toast(er.message)); S.sidekick = S.sidekick.filter((y) => y.id !== x.id); SK.open = null; renderTool(); } },
    ]);
    return [
      h('div', { class: 'sk-top' },
        h('button', { class: 'icon-btn', 'aria-label': 'All plans', html: I.back, onclick: () => { SK.open = null; renderTool(); } }),
        h('b', {}, x.title),
        c ? h('button', { class: 'btn small', onclick: () => { closeTool(); setTab('camps'); openCampaign(c.id); } }, 'Open campaign') : x.entryIds.length ? h('button', { class: 'btn small', onclick: () => { closeTool(); setTab('day'); } }, 'Open Day') : null,
        h('button', { class: 'icon-btn', 'aria-label': 'Options', html: I.more, onclick: menu })),
      skFilesBar(x),
      x.nudge && x.status !== 'done' ? h('div', { class: 'sk-nudge-bar' }, h('span', {}, 'Behind pace: ' + x.nudge.text), h('button', { class: 'btn small', disabled: SK.busy, onclick: () => skCall('POST', `/sidekick/${x.id}/say`, { text: 'We’re behind. What should change?' }) }, 'Talk it through')) : null,
      h('div', { class: 'sk-chat' },
        x.messages.filter((m) => !(m.role === 'user' && x.messages.indexOf(m) === 0)).map((m) => m.role === 'user'
          ? h('div', { class: 'sk-msg me' }, m.check ? '✓ Check my plan' : m.text)
          : h('div', { class: 'sk-msg' }, h('div', { class: 'sk-text' }, m.text), (m.cards || []).length ? h('div', { class: 'sk-cards' }, m.cards.map((cd) => skCardEl(x, cd))) : null)),
        SK.busy ? h('div', { class: 'sk-msg sk-thinking' }, 'Thinking…') : null,
        h('span', { class: 'sk-end' })),
      ready.length ? h('div', { class: 'sk-ready' },
        h('span', {}, `${ready.length} accepted`),
        h('button', { class: 'btn small', disabled: SK.busy, onclick: () => skCall('POST', `/sidekick/${x.id}/check`, {}) }, 'Check my plan'),
        h('button', { class: 'btn small primary-btn', disabled: SK.busy, onclick: () => skBuild(x) }, c || x.status === 'built' ? `Apply ${ready.length}` : x.kind === 'schedule' ? 'Put it on my Day' : 'Build campaign')) : null,
      h('div', { class: 'sk-compose' }, say, h('button', { class: 'btn primary-btn', disabled: SK.busy, onclick: send }, 'Send')),
    ];
  }
  // Builds the accepted cards: the campaign first (or the one this is about), then everything that goes in it.
  async function skBuild(x) {
    const cards = skCards(x).filter((y) => y.state === 'accepted');
    SK.busy = true;
    renderTool(true);
    const made = [];
    const entryIds = [];
    try {
      let c = campById(x.campaignId);
      if (!c && x.kind === 'campaign') {
        const cc = cards.find((y) => y.type === 'campaign') || { name: x.title };
        c = await api('POST', '/campaigns', { name: cc.name, brief: cc.brief || '', start: cc.start || todayKey(), end: cc.end || null });
        if (!S.campaigns.some((y) => y.id === c.id)) S.campaigns.push(c);
        made.push(cc);
      }
      const goalByTitle = (t) => c && goalsOf(c.id).find((g) => g.title.trim().toLowerCase() === String(t || '').trim().toLowerCase());
      for (const y of cards) {
        if (y.type === 'campaign') {
          // On a campaign that's already there, it updates the brief and dates.
          if (!made.includes(y) && c) {
            const z = await api('PATCH', '/campaigns/' + c.id, { brief: y.brief || c.brief, ...(y.start ? { start: y.start } : {}), ...(y.end ? { end: y.end } : {}) });
            S.campaigns = S.campaigns.map((w) => (w.id === z.id ? z : w));
          }
          if (!made.includes(y)) made.push(y);
        } else if (y.type === 'goal' && c) {
          const g = await api('POST', '/goals', { campaignId: c.id, title: y.title, kind: y.kind, target: y.target, due: y.due });
          if (!S.goals.some((z) => z.id === g.id)) S.goals.push(g);
          for (const t of y.tasks) upsertTask(await api('POST', '/tasks', { text: t.text, due: t.due, goalId: g.id }));
          made.push(y);
        } else if (y.type === 'list' && c && amOwner()) {
          upsertList(await api('POST', '/lists', { campaignId: c.id, name: y.name, live: y.live }));
          made.push(y);
        } else if (y.type === 'note') {
          const it = await api('POST', '/items', { type: 'text', text: [y.title, y.text].filter(Boolean).join('\n\n'), stackId: c?.stackId || null });
          await api('PATCH', '/items/' + it.id, { pinned: true }).catch(() => {});
          made.push(y);
        } else if (y.type === 'budget') {
          const b = await api('PUT', '/budgets', { scope: amOwner() && c ? 'business' : 'personal', category: y.category, limit: y.limit });
          S.budgets = [...(S.budgets || []).filter((z) => z.id !== b.id), b];
          made.push(y);
        } else if (y.type === 'block') {
          const e = await api('POST', '/entries', { text: y.text, date: y.date, start: y.start, end: y.end, repeat: y.repeat });
          upsertEntry(e);
          entryIds.push(e.id);
          made.push(y);
        } else if (y.type === 'task') {
          upsertTask(await api('POST', '/tasks', { text: y.text, due: y.due, goalId: goalByTitle(y.goal)?.id || null }));
          made.push(y);
        } else if (y.type === 'change' && c) {
          if (y.goalId && goalById(y.goalId)) {
            const g = await api('PATCH', '/goals/' + y.goalId, { ...(y.due ? { due: y.due } : {}), ...(y.target ? { target: y.target } : {}) });
            S.goals = S.goals.map((z) => (z.id === g.id ? g : z));
          }
          if (y.end) {
            const z = await api('PATCH', '/campaigns/' + c.id, { end: y.end });
            S.campaigns = S.campaigns.map((w) => (w.id === z.id ? z : w));
          }
          made.push(y);
        }
      }
      for (const y of made) await api('PATCH', `/sidekick/${x.id}/cards/${y.id}`, { state: 'built' }).catch(() => {});
      const z = await api('PATCH', '/sidekick/' + x.id, { built: true, campaignId: c?.id, entryIds, today: todayKey() });
      S.sidekick = [z, ...S.sidekick.filter((w) => w.id !== z.id)];
      const left = cards.length - made.length;
      toast(`${c ? c.name : 'Your Day'}: ${plural(made.length, 'thing')} added${left ? ` · ${left} couldn’t be` : ''}`, c ? { label: 'Open', run: () => { closeTool(); setTab('camps'); openCampaign(c.id); } } : { label: 'Open Day', run: () => { closeTool(); setTab('day'); } });
      renderCamps();
      renderDay();
    } catch (e) {
      toast(e.message);
    } finally {
      SK.busy = false;
      renderTool(true);
    }
  }

  // ----- planner: the end goal, the steps to it, and what's needed before it can start -----
  // A plan is yours alone until "Make it a campaign": its steps become goals with their tasks, its lists
  // become call lists, its files are put to use, and anything still missing becomes a "Before you start" goal.
  const PL = { open: null, timer: null, dirty: null, seq: 0 };
  const planById = (id) => (S.plans || []).find((x) => x.id === id);
  const planUid = () => Math.random().toString(36).slice(2, 10);
  // Whether a need is in hand: a link is ready when what it points at is there; a plain note when it's ticked.
  function needState(n) {
    const l = n.link;
    if (!l) return { ready: n.done };
    if (l.type === 'live') {
      if (!S.contacts) return { ready: true, sub: 'Leads from PSS' };
      const k = S.contacts.filter((x) => liveMatch(l.live, x, Date.now())).length;
      return { ready: k > 0, sub: `${plural(k, 'lead')} from PSS right now` };
    }
    if (l.type === 'rows') return { ready: true, sub: plural(l.rows.length, 'row') };
    const there = l.type === 'file' ? linkedFile(l.id) : l.type === 'stack' ? stackById(l.id) : l.type === 'campaign' ? campById(l.id) : taskById(l.id);
    return { ready: !!there };
  }
  const planReady = (p) => { const ns = p.needs.filter((n) => n.text || n.link); return [ns.filter((n) => needState(n).ready).length, ns.length]; };
  // Saves shortly after the last change. Until it's saved, news of this plan from the server is ignored so it can't undo typing.
  function savePlan(p) {
    const n = ++PL.seq;
    PL.dirty = p.id;
    clearTimeout(PL.timer);
    PL.timer = setTimeout(async () => {
      await api('PATCH', '/plans/' + p.id, { name: p.name, goal: p.goal, due: p.due, notes: p.notes, steps: p.steps, needs: p.needs }).catch((e) => toast(e.message));
      if (n === PL.seq) PL.dirty = null;
    }, 500);
  }
  const redrawPlan = () => { document.activeElement?.blur?.(); renderTool(); };
  async function newPlan() {
    try {
      const x = await api('POST', '/plans', { name: 'Untitled plan', steps: [{ title: '', tasks: [] }], needs: [{ text: '' }] });
      S.plans = [x, ...(S.plans || []).filter((y) => y.id !== x.id)];
      PL.open = x.id;
      renderTool();
      $('#tool .plan-name')?.select();
    } catch (e) {
      toast(e.message);
    }
  }
  function plannerTool() {
    const p = PL.open && planById(PL.open);
    if (p) return planView(p);
    PL.open = null;
    const all = S.plans || [];
    return [
      ...all.map((x) => {
        const [r, n] = planReady(x);
        const c = campById(x.campaignId);
        return h('div', { class: 'bill plan-row', onclick: () => { PL.open = x.id; renderTool(); } },
          h('span', { class: 'bill-name' }, x.name, h('small', {}, x.goal || 'No end goal yet')),
          h('span', { class: 'bill-right' }, c ? h('small', {}, '→ ' + c.name) : n ? h('small', { class: r === n ? 'plan-ok' : null }, `${r} of ${n} ready`) : null, x.due ? h('small', {}, 'by ' + dueLabel(x.due)) : null));
      }),
      h('button', { class: 'add-goal', onclick: newPlan }, '+ New plan'),
      all.length ? null : h('p', { class: 'day-hint' }, 'Start from where you want to end up. Write the goal, the steps to it, and what you need before you can start, like a list of prospects or a script. Link what’s already in Column. When it’s ready, make it a campaign: the steps become its goals and tasks, and the lists become its call lists.'),
    ];
  }
  function planView(p) {
    const set = (k) => (e) => { p[k] = e.target.value; savePlan(p); };
    const name = h('input', { class: 'plan-name', value: p.name, 'aria-label': 'Plan name', onchange: set('name') });
    const goal = h('textarea', { rows: 2, placeholder: 'Where you want to end up. 10 booked installs, a full call list, a new hire…', onchange: set('goal') });
    goal.value = p.goal;
    const due = h('input', { type: 'date', value: p.due || '', onchange: (e) => { p.due = e.target.value || null; savePlan(p); } });
    const notes = h('textarea', { rows: 4, placeholder: 'Anything else: ideas, numbers, who to ask… (optional)', onchange: set('notes') });
    notes.value = p.notes;
    const c = campById(p.campaignId);
    const [r, n] = planReady(p);
    const del = h('button', { class: 'btn small danger', 'data-label': '1' }, 'Delete plan');
    del.addEventListener('click', () => confirmClick(del, async () => {
      clearTimeout(PL.timer);
      await api('DELETE', '/plans/' + p.id).catch((e) => toast(e.message));
      S.plans = S.plans.filter((x) => x.id !== p.id);
      PL.open = null;
      renderTool();
    }));
    return [
      h('button', { class: 'link plan-back', onclick: () => { PL.open = null; redrawPlan(); } }, '← All plans'),
      name,
      h('div', { class: 'row2 plan-goal-row' }, h('label', {}, 'End goal', goal), h('label', {}, 'By', due)),
      h('section', {}, h('h3', {}, 'Steps to get there'),
        p.steps.map((st, i) => planStep(p, st, i)),
        h('button', { class: 'add-goal', onclick: () => { p.steps.push({ id: planUid(), title: '', due: null, tasks: [] }); savePlan(p); redrawPlan(); [...document.querySelectorAll('#tool .plan-step-title')].at(-1)?.focus(); } }, '+ Add a step')),
      h('section', {}, h('h3', {}, 'What you need', n ? h('small', { class: 'plan-count' + (r === n ? ' plan-ok' : '') }, ` · ${r} of ${n} ready`) : null),
        p.needs.map((x, i) => planNeed(p, x, i)),
        h('button', { class: 'add-goal', onclick: () => { p.needs.push({ id: planUid(), text: '', done: false, link: null }); savePlan(p); redrawPlan(); [...document.querySelectorAll('#tool .plan-need-text')].at(-1)?.focus(); } }, '+ Add something you need')),
      h('label', { class: 'plan-notes' }, 'Notes', notes),
      h('div', { class: 'btns plan-foot' }, del, h('span', { style: 'flex:1' }),
        c ? h('button', { class: 'btn', onclick: () => { closeTool(); openCampaign(c.id); } }, 'Open ' + c.name)
          : h('button', { class: 'btn primary-btn', onclick: () => planToCampaign(p) }, p.campaignId ? 'Make it a campaign again' : 'Make it a campaign')),
    ];
  }
  function planStep(p, st, i) {
    const title = h('input', { class: 'plan-step-title', value: st.title, placeholder: i ? 'Next step' : 'First step, e.g. Build the prospect list', onchange: (e) => { st.title = e.target.value; savePlan(p); } });
    const due = h('input', { type: 'date', value: st.due || '', title: 'Done by', 'aria-label': 'Done by', onchange: (e) => { st.due = e.target.value || null; savePlan(p); } });
    const task = (t, j) => h('div', { class: 'plan-task-row' },
      h('input', { class: 'plan-task', value: t.text, placeholder: 'Task', onchange: (e) => { t.text = e.target.value; savePlan(p); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); t.text = e.target.value; addTask(j + 1); } } }),
      h('button', { class: 'icon-btn', html: I.close, title: 'Remove task', 'aria-label': 'Remove task', onclick: () => { st.tasks.splice(j, 1); savePlan(p); redrawPlan(); } }));
    const addTask = (at) => {
      st.tasks.splice(at, 0, { id: planUid(), text: '' });
      savePlan(p);
      redrawPlan();
      document.querySelectorAll('#tool .plan-step')[i]?.querySelectorAll('.plan-task')[at]?.focus();
    };
    return h('div', { class: 'plan-step' },
      h('div', { class: 'plan-step-top' }, h('span', { class: 'plan-num' }, i + 1), title, due,
        h('button', { class: 'icon-btn', html: I.close, title: 'Remove step', 'aria-label': 'Remove step', onclick: () => { p.steps.splice(i, 1); savePlan(p); redrawPlan(); } })),
      st.tasks.map(task),
      h('button', { class: 'link plan-add-task', onclick: () => addTask(st.tasks.length) }, '+ Task'));
  }
  function planNeed(p, x, i) {
    const s = needState(x);
    const setLink = (link, text) => { x.link = link; if (text && !x.text) x.text = text; savePlan(p); redrawPlan(); };
    const text = h('input', { class: 'plan-need-text', value: x.text, placeholder: i ? 'Something else you need' : 'e.g. 300 prospects to call', onchange: (e) => { x.text = e.target.value; savePlan(p); } });
    const pick = h('div', { class: 'plan-pick' });
    const l = x.link;
    const shown = !l ? null
      : l.type === 'live' ? h('button', { class: 'ln ln-chip', title: 'Change who’s on it', onclick: () => amOwner() && liveSheet(null, { name: x.text, live: l.live }, (b) => setLink({ type: 'live', live: b.live }, b.name)) }, h('span', { class: 'ln-ic', html: I.target }), h('span', { class: 'ln-text' }, 'PSS leads'), h('span', { class: 'ln-sub' }, s.sub))
      : l.type === 'rows' ? h('button', { class: 'ln ln-chip', title: 'Edit the list', onclick: () => pasteSheet(x, (link) => setLink(link)) }, h('span', { class: 'ln-ic', html: I.task }), h('span', { class: 'ln-text' }, l.columns.join(' · ')), h('span', { class: 'ln-sub' }, s.sub))
      : linkEl(l);
    const menu = (e) => openMenu(e.currentTarget, [
      { head: 'Get it from' },
      { label: 'Something in Column…', run: () => openPicker(pick, (r) => setLink({ type: r.type, id: r.id }, r.label)) },
      amOwner() && S.pss?.connected ? { label: 'Leads from PSS…', run: () => liveSheet(null, l?.type === 'live' ? { name: x.text, live: l.live } : null, (b) => setLink({ type: 'live', live: b.live }, b.name)) } : null,
      { label: l?.type === 'rows' ? 'Edit the list…' : 'Type or paste a list…', run: () => pasteSheet(x, (link) => setLink(link)) },
      l ? { label: 'Unlink', run: () => setLink(null) } : null,
      { label: 'Remove', run: () => { p.needs.splice(i, 1); savePlan(p); redrawPlan(); } },
    ].filter(Boolean));
    return h('div', { class: 'plan-need' + (s.ready ? ' ready' : '') },
      h('div', { class: 'plan-need-top' },
        l ? h('span', { class: 'plan-dot', title: s.ready ? 'Ready' : 'Missing' })
          : h('button', { class: 'check' + (x.done ? ' on' : ''), html: I.check, 'aria-label': x.done ? 'Not got it yet' : 'Got it', title: x.done ? 'Got it' : 'Tick when you have it', onclick: () => { x.done = !x.done; savePlan(p); redrawPlan(); } }),
        text,
        h('button', { class: 'btn small', onclick: menu }, l ? 'Change' : 'Link…')),
      shown ? h('div', { class: 'plan-link' }, shown) : null,
      pick);
  }
  // A list typed or pasted into the plan (from a spreadsheet, or one name per line). It becomes a call list.
  function pasteSheet(x, done) {
    const l = x.link?.type === 'rows' ? x.link : null;
    const ta = h('textarea', { rows: 10, class: 'plan-paste', placeholder: 'One per line: name, phone, email…\nOr copy the rows from a spreadsheet and paste them here.' });
    ta.value = l ? [l.columns, ...l.rows.map((r) => r.cells)].map((r) => r.join('\t')).join('\n') : '';
    const head = h('input', { type: 'checkbox', checked: !!l });
    const hint = h('p', { class: 'day-hint' });
    const read = () => {
      const all = parseDelimited(ta.value.trim()).filter((r) => r.some((v) => v.trim()));
      const width = Math.max(1, ...all.map((r) => r.length));
      const columns = head.checked && all.length ? all[0] : Array.from({ length: width }, (_, i) => (i ? `Column ${i + 1}` : 'Name'));
      return { type: 'rows', columns: columns.slice(0, width), rows: (head.checked ? all.slice(1) : all).map((cells) => ({ cells })) };
    };
    const update = () => {
      if (!l && !head._touched) head.checked = /\b(name|phone|email|company|address|city)\b/i.test(ta.value.split('\n')[0] || '');
      const r = read();
      hint.textContent = r.rows.length ? `${plural(r.rows.length, 'row')} · ${r.columns.join(', ')}` : '';
    };
    ta.addEventListener('input', update);
    head.addEventListener('change', () => { head._touched = true; update(); });
    update();
    sheet(l ? 'Edit the list' : 'Type or paste a list', [ta, h('label', { class: 'pick' }, head, 'The first line is the column names'), hint], () => {
      const r = read();
      if (!r.rows.length) throw new Error('Nothing in the list yet.');
      done(r);
    });
  }
  // Makes the campaign: the brief from the goal and notes, a goal per step, call lists from the lists and
  // PSS leads, files put to use, and whatever's still missing as tasks to do first.
  function planToCampaign(p) {
    const steps = p.steps.filter((st) => st.title.trim() || st.tasks.some((t) => t.text.trim()));
    const missing = p.needs.filter((x) => x.text.trim() && !needState(x).ready);
    const lists = p.needs.filter((x) => x.link?.type === 'rows' || (x.link?.type === 'live' && amOwner()));
    const files = p.needs.filter((x) => x.link?.type === 'file' && linkedFile(x.link.id)?.type === 'file');
    const tasks = steps.reduce((k, st) => k + st.tasks.filter((t) => t.text.trim()).length, 0);
    const lines = [
      `A campaign called “${p.name}”${p.due ? `, ending ${dueLabel(p.due)}` : ''}, with the end goal${p.notes.trim() ? ' and notes' : ''} as its brief`,
      steps.length ? `${plural(steps.length, 'goal')}, one per step${tasks ? `, with ${plural(tasks, 'task')}` : ''}` : null,
      missing.length ? `A “Before you start” goal with ${plural(missing.length, 'task')}, for what you don’t have yet` : null,
      ...lists.map((x) => `Call list: ${x.text || (x.link.type === 'live' ? 'PSS leads' : 'List')}`),
      ...files.map((x) => `${linkedFile(x.link.id).name}, put to use in the campaign`),
    ].filter(Boolean);
    sheet('Make it a campaign', [
      h('p', { class: 'day-hint' }, 'This makes:'),
      h('ul', { class: 'plan-make' }, lines.map((t) => h('li', {}, t))),
      h('p', { class: 'day-hint' }, 'You can change everything after. The plan stays here.'),
    ], () => { setTimeout(() => makeFromPlan(p, { steps, missing, lists, files })); }, 'Make campaign');
  }
  async function makeFromPlan(p, { steps, missing, lists, files }) {
    try {
      const today = todayKey();
      const c = await api('POST', '/campaigns', { name: p.name, brief: [p.goal, p.notes].map((t) => t.trim()).filter(Boolean).join('\n\n'), start: !p.due || p.due >= today ? today : null, end: p.due || null });
      if (!S.campaigns.some((x) => x.id === c.id)) S.campaigns.push(c);
      const goal = async (title, due, items) => {
        const g = await api('POST', '/goals', { campaignId: c.id, title, kind: 'tasks', due: due || null });
        if (!S.goals.some((x) => x.id === g.id)) S.goals.push(g);
        for (const t of items) upsertTask(await api('POST', '/tasks', { text: t, due: due || null, goalId: g.id }));
      };
      if (missing.length) await goal('Before you start', null, missing.map((x) => x.text.trim()));
      for (const st of steps) await goal(st.title.trim() || 'Step', st.due, st.tasks.map((t) => t.text.trim()).filter(Boolean));
      for (const x of lists) {
        const l = x.link.type === 'live'
          ? await api('POST', '/lists', { campaignId: c.id, name: x.text || 'PSS leads', live: x.link.live })
          : await api('POST', '/lists', { campaignId: c.id, name: x.text || 'Call list', kind: 'calls', columns: x.link.columns, rows: x.link.rows });
        upsertList(l);
      }
      for (const x of files) {
        const it = linkedFile(x.link.id);
        const a = await analyzeItem(it).catch(() => null);
        if (a) await useAs(c, it, a, a.guess, null, true).catch(() => {});
      }
      p.campaignId = c.id;
      const saved = await api('PATCH', '/plans/' + p.id, { campaignId: c.id });
      S.plans = S.plans.map((y) => (y.id === saved.id ? saved : y));
      closeTool();
      openCampaign(c.id);
      toast(`${c.name} is ready`);
    } catch (e) {
      toast(e.message);
    }
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
  function billsTab() {
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
    const paid = (S.bills || []).flatMap((b) => (b.paid || []).map((p) => ({ b, p }))).filter(({ b }) => billScope === 'all' || b.scope === billScope).sort((x, y) => y.p.at - x.p.at).slice(0, 12);
    return [
      all.length ? h('div', { class: 'bill-sum' },
        h('div', {}, h('small', {}, 'Due in the next 30 days'), h('b', {}, money(in30))),
        h('div', {}, h('small', {}, 'A month, on average'), h('b', {}, money(perMonth(all))),
          hasBiz && billScope === 'all' ? h('small', {}, `${money(perMonth(all.filter((b) => b.scope === 'personal')))} personal · ${money(perMonth(all.filter((b) => b.scope === 'business')))} business`) : null)) : null,
      ...groups.map(([t, xs]) => h('section', {}, h('h3', { class: t === 'Late' ? 'late' : null }, t), xs.map(billRow))),
      h('button', { class: 'add-goal', onclick: () => billSheet() }, '+ Add a bill'),
      all.length ? null : h('p', { class: 'day-hint' }, 'Add what you pay and when. Each bill shows on your Day when it’s due, and ticking it records the payment as spending and moves it to the next one. Personal bills are only yours; business bills are shared with the team’s owners.'),
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
    const cat = catInput('out', b?.category || 'Bills');
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
      h('label', {}, 'Category', cat, h('small', { class: 'hint' }, 'When it’s paid, it counts as spending in this category.')),
      h('label', {}, 'Note', note),
      del,
    ], async () => {
      const body = { name: name.value, amount: amount.value, due: due.value, repeat: repeat.value, autopay: autopay.checked, note: note.value, category: cat.value, tz: myTz(), ...(mineOrNew ? { scope: scope.value } : {}) };
      const x = b ? await api('PATCH', '/bills/' + b.id, body) : await api('POST', '/bills', body);
      S.bills = [...S.bills.filter((y) => y.id !== x.id), x];
      renderDay();
      renderTool();
    }, b ? 'Save' : 'Add bill');
  }

  // ----- finance: money in and out, budgets, bills -----
  // One tool with three views. Overview is the month at a glance and its budgets; In & out is every entry,
  // typed in or imported from a bank statement; Bills is what's owed. Personal or business, as with bills.
  const IN_CATS = ['Client payment', 'Sales', 'Paycheck', 'Refund', 'Transfer in', 'Other income'];
  const OUT_CATS = ['Bills', 'Rent', 'Utilities', 'Groceries', 'Dining', 'Gas', 'Ads & marketing', 'Supplies', 'Software', 'Payroll', 'Insurance', 'Travel', 'Kids', 'Shopping', 'Health', 'Fees', 'Savings', 'Transfer', 'Other'];
  // Not counted when suggesting budgets: moving money around isn't spending it.
  const NOT_SPENDING = ['Transfer', 'Savings'];
  const FIN = { tab: store.get('finTab', 'overview'), month: todayKey().slice(0, 7), campaign: null };
  const monthKey = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return t.toISOString().slice(0, 7); };
  const monthName = (ym) => new Date(ym + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long', year: ym.slice(0, 4) === todayKey().slice(0, 4) ? undefined : 'numeric' });
  const inScope = (x) => billScope === 'all' || x.scope === billScope;
  const moneyIn = (ym) => (S.money || []).filter((x) => x.day?.startsWith(ym) && inScope(x));
  const sum = (xs, kind) => xs.reduce((n, x) => n + (x.kind === kind ? x.amount : 0), 0);
  const spentOn = (xs, cat) => xs.reduce((n, x) => n + (x.kind === 'out' && sameText(x.category, cat) ? x.amount : 0), 0);
  const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  function catInput(kind, value) {
    const id = 'cats-' + kind;
    if (!document.getElementById(id)) document.body.append(h('datalist', { id }, (kind === 'in' ? IN_CATS : OUT_CATS).map((c) => h('option', { value: c }))));
    return h('input', { value: value || '', list: id, placeholder: kind === 'in' ? 'Client payment, Sales…' : 'Groceries, Ads…' });
  }
  // Budgets on this month with most of their limit used.
  function budgetAlerts() {
    const xs = (S.money || []).filter((x) => x.day?.startsWith(todayKey().slice(0, 7)));
    return (S.budgets || []).map((b) => ({ b, spent: spentOn(xs.filter((x) => x.scope === b.scope), b.category) })).filter(({ b, spent }) => spent >= b.limit * 0.9);
  }
  function budgetDayRow({ b, spent }) {
    const over = spent > b.limit;
    return h('div', { class: 'any-row bill-day' + (over ? ' late' : ''), onclick: () => { FIN.tab = 'overview'; FIN.month = todayKey().slice(0, 7); openTool('bills'); } },
      h('span', { class: 'p-text' }, `${b.category} budget`, h('small', { class: 'bill-amt' }, ` · ${money(spent)} of ${money(b.limit)}`),
        h('small', { class: 'bill-tag' + (over ? ' late' : '') }, over ? 'over' : `${Math.round((spent / b.limit) * 100)}% used`)));
  }
  function financeTool() {
    const hasBiz = [...(S.bills || []), ...(S.money || []), ...(S.budgets || [])].some((x) => x.scope === 'business') || amOwner();
    const tab = (k) => { FIN.tab = k; store.set('finTab', k); renderTool(); };
    const scope = (v) => { billScope = v; store.set('billScope', v); renderTool(); };
    return [
      h('div', { class: 'seg' }, [['overview', 'Overview'], ['flow', 'In & out'], ['bills', 'Bills']].map(([k, t]) => h('button', { class: FIN.tab === k ? 'on' : null, onclick: () => tab(k) }, t))),
      hasBiz ? h('div', { class: 'seg seg-sm' }, [['all', 'All'], ['personal', 'Personal'], ['business', 'Business']].map(([v, t]) => h('button', { class: billScope === v ? 'on' : null, onclick: () => scope(v) }, t))) : null,
      ...(FIN.tab === 'bills' ? billsTab() : FIN.tab === 'flow' ? flowTab() : overviewTab()),
    ];
  }
  function monthNav() {
    const go = (d) => { FIN.month = monthKey(FIN.month, d); renderTool(); };
    const now = todayKey().slice(0, 7);
    return h('div', { class: 'fin-month' },
      h('button', { class: 'icon-btn', 'aria-label': 'Month before', onclick: () => go(-1) }, '‹'),
      h('b', {}, monthName(FIN.month)),
      h('button', { class: 'icon-btn', 'aria-label': 'Month after', disabled: FIN.month >= now, onclick: () => go(1) }, '›'));
  }
  function overviewTab() {
    const ym = FIN.month;
    const xs = moneyIn(ym);
    const got = sum(xs, 'in'), spent = sum(xs, 'out');
    const today = todayKey();
    // Bills still to pay this month, late ones included.
    const owed = ym === today.slice(0, 7) ? billsLive().filter((b) => inScope(b) && b.due.slice(0, 7) <= ym).reduce((n, b) => n + b.amount, 0) : 0;
    const left = got - spent;
    const budgets = (S.budgets || []).filter(inScope).sort((a, b) => a.category.localeCompare(b.category));
    const cats = new Map();
    for (const x of xs) if (x.kind === 'out') cats.set(x.category || 'Other', (cats.get(x.category || 'Other') || 0) + x.amount);
    const loose = [...cats].filter(([c]) => !budgets.some((b) => sameText(b.category, c))).sort((a, b) => b[1] - a[1]);
    const budgetRow = (b) => {
      const n = spentOn(xs.filter((x) => x.scope === b.scope), b.category);
      const frac = n / b.limit;
      return h('div', { class: 'budget', onclick: () => budgetSheet(b) },
        h('div', { class: 'budget-top' }, h('span', {}, b.category, billScope === 'all' && b.scope === 'business' ? h('small', {}, ' · business') : null),
          h('span', { class: frac > 1 ? 'late' : null }, `${money(n)} of ${money(b.limit)}`)),
        h('div', { class: 'pbar ' + (frac > 1 ? 'c-rose' : frac >= 0.9 ? 'c-amber' : 'c-green') }, h('i', { style: `width:${Math.min(100, Math.round(frac * 100))}%` })),
        h('small', { class: frac > 1 ? 'late' : null }, frac > 1 ? `${money(n - b.limit)} over` : `${money(b.limit - n)} left`));
    };
    return [
      monthNav(),
      h('div', { class: 'bill-sum fin-sum' },
        h('div', {}, h('small', {}, 'Money in'), h('b', { class: 'up' }, money(got))),
        h('div', {}, h('small', {}, 'Money out'), h('b', {}, money(spent))),
        h('div', {}, h('small', {}, 'Left'), h('b', { class: left < 0 ? 'down' : null }, (left < 0 ? '−' : '') + money(Math.abs(left)))),
        owed ? h('div', {}, h('small', {}, 'Safe to spend', h('span', { title: 'What’s left after the bills still due this month' }, ' ⓘ')), h('b', { class: left - owed < 0 ? 'down' : null }, (left - owed < 0 ? '−' : '') + money(Math.abs(left - owed))), h('small', {}, `after ${money(owed)} in bills`)) : null),
      h('section', {}, h('h3', {}, 'Budgets'),
        budgets.length ? budgets.map(budgetRow) : h('p', { class: 'day-hint' }, 'Set a monthly limit for what you spend on, like groceries or ads, and Column shows how much is left. It warns you on your Day when one is nearly used.'),
        h('div', { class: 'btns' },
          h('button', { class: 'add-goal', onclick: () => budgetSheet() }, '+ Set a budget'),
          h('button', { class: 'add-goal', onclick: suggestBudgets }, '✦ Suggest budgets'))),
      loose.length ? h('section', {}, h('h3', {}, 'Other spending'),
        loose.map(([c, n]) => h('div', { class: 'bill-hist', onclick: () => budgetSheet(null, c) }, h('span', {}, c), h('span', {}, money(n))))) : null,
      xs.length ? null : h('p', { class: 'day-hint' }, 'Nothing for this month yet. Add money in and out under In & out, or import a bank statement.'),
    ];
  }
  function flowTab() {
    const xs = moneyIn(FIN.month).filter((x) => !FIN.campaign || x.campaignId === FIN.campaign).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.createdAt - a.createdAt));
    const days = [...new Set(xs.map((x) => x.day))];
    const camp = FIN.campaign && campById(FIN.campaign);
    const row = (x) => {
      const g = x.goalId && goalById(x.goalId), c = x.campaignId && campById(x.campaignId);
      return h('div', { class: 'bill', onclick: () => moneySheet(x) },
        h('span', { class: 'bill-name' }, x.note || x.category || (x.kind === 'in' ? 'Money in' : 'Money out'),
          h('small', {}, [x.category && x.note ? x.category : null, x.billId ? 'bill' : null, billScope === 'all' && x.scope === 'business' ? 'Business' : null, g ? '→ ' + g.title : c ? '→ ' + c.name : null].filter(Boolean).join(' · '))),
        h('span', { class: 'bill-right' }, h('b', { class: x.kind === 'in' ? 'up' : null }, (x.kind === 'in' ? '+' : '−') + money(x.amount))));
    };
    return [
      monthNav(),
      camp ? h('div', { class: 'fin-filter' }, `Only ${camp.name}`, h('button', { class: 'icon-btn', 'aria-label': 'Show all', html: I.close, onclick: () => { FIN.campaign = null; renderTool(); } })) : null,
      h('div', { class: 'btns fin-add' },
        h('button', { class: 'btn small', onclick: () => moneySheet(null, 'in') }, '+ Money in'),
        h('button', { class: 'btn small', onclick: () => moneySheet(null, 'out') }, '+ Money out'),
        h('button', { class: 'btn small', onclick: pickStatement }, 'Import bank statement…')),
      ...days.map((d) => h('section', {}, h('h3', {}, dueLabel(d)), xs.filter((x) => x.day === d).map(row))),
      xs.length ? null : h('p', { class: 'day-hint' }, 'Type in what comes in and goes out, or import the CSV file your bank lets you download. Tag money to a campaign to see what it cost and brought in, or to a money goal to fill it.'),
    ];
  }
  // Where a bit of money goes: nowhere, a campaign, or one of its money goals.
  function tagSelect(x) {
    const camps = S.campaigns.filter((c) => c.status !== 'done' || c.id === x?.campaignId);
    const sel = h('select', {}, h('option', { value: '' }, 'Not tagged'),
      camps.map((c) => [h('option', { value: 'c:' + c.id }, c.name), ...goalsOf(c.id).filter((g) => g.kind === 'money').map((g) => h('option', { value: 'g:' + g.id }, `${c.name} → ${g.title}`))]).flat());
    sel.value = x?.goalId ? 'g:' + x.goalId : x?.campaignId ? 'c:' + x.campaignId : '';
    return sel;
  }
  function moneySheet(x, kind) {
    kind = x?.kind || kind || 'out';
    const amount = h('input', { value: x ? (x.amount / 100).toFixed(2) : '', placeholder: '0.00', inputmode: 'decimal' });
    const day = h('input', { type: 'date', value: x?.day || todayKey() });
    const cat = catInput(kind, x?.category);
    const note = h('input', { value: x?.note || '', placeholder: kind === 'in' ? 'Who paid, what for' : 'Where, what for' });
    const mine = !x || x.memberId === S.me?.memberId;
    const scope = h('select', { disabled: !mine || !amOwner() }, h('option', { value: 'personal' }, 'Personal · only you'), h('option', { value: 'business', selected: (x?.scope || (billScope === 'business' ? 'business' : 'personal')) === 'business' }, 'Business · shared with owners'));
    const tag = tagSelect(x);
    const del = x ? h('button', { class: 'btn small danger', 'data-label': '1' }, 'Delete') : null;
    del?.addEventListener('click', () => confirmClick(del, async () => {
      await api('DELETE', '/money/' + x.id).catch((e) => toast(e.message));
      S.money = S.money.filter((y) => y.id !== x.id);
      closeSheet();
      renderTool();
    }));
    sheet(x ? (kind === 'in' ? 'Money in' : 'Money out') : kind === 'in' ? 'Add money in' : 'Add money out', [
      h('div', { class: 'row2' }, h('label', {}, 'Amount ($)', amount), h('label', {}, 'Date', day)),
      h('div', { class: 'row2' }, h('label', {}, 'Category', cat), h('label', {}, 'Kind', scope)),
      h('label', {}, 'Note', note),
      h('label', {}, 'Campaign or goal', tag, h('small', { class: 'hint' }, kind === 'in' ? 'Counts toward what that campaign brought in, or fills that money goal.' : 'Counts as that campaign’s cost.')),
      x?.billId ? h('p', { class: 'day-hint' }, 'Recorded when the bill was marked paid.') : null,
      del,
    ], async () => {
      const t = tag.value;
      const body = { kind, amount: amount.value, day: day.value, category: cat.value, note: note.value, goalId: t.startsWith('g:') ? t.slice(2) : null, campaignId: t.startsWith('c:') ? t.slice(2) : null, ...(mine ? { scope: scope.value } : {}) };
      const y = x ? await api('PATCH', '/money/' + x.id, body) : await api('POST', '/money', body);
      S.money = [...(S.money || []).filter((z) => z.id !== y.id), y];
      if (!x && y.day.slice(0, 7) !== FIN.month) FIN.month = y.day.slice(0, 7);
      renderTool();
    }, x ? 'Save' : 'Add');
  }
  function budgetSheet(b, category) {
    const cat = catInput('out', b?.category || category || '');
    const limit = h('input', { value: b ? (b.limit / 100).toFixed(0) : '', placeholder: '400', inputmode: 'decimal' });
    const scope = h('select', { disabled: !!b || !amOwner() }, h('option', { value: 'personal' }, 'Personal'), h('option', { value: 'business', selected: (b?.scope || (billScope === 'business' ? 'business' : 'personal')) === 'business' }, 'Business'));
    const del = b ? h('button', { class: 'btn small danger', 'data-label': '1' }, 'Remove budget') : null;
    del?.addEventListener('click', () => confirmClick(del, async () => {
      await api('PUT', '/budgets', { scope: b.scope, category: b.category, limit: 0 }).catch((e) => toast(e.message));
      S.budgets = S.budgets.filter((y) => y.id !== b.id);
      closeSheet();
      renderTool();
    }));
    sheet(b ? `${b.category} budget` : 'Set a budget', [
      h('div', { class: 'row2' }, h('label', {}, 'Category', cat), h('label', {}, 'Each month ($)', limit)),
      h('label', {}, 'Kind', scope),
      del,
    ], async () => {
      const y = await api('PUT', '/budgets', { scope: b?.scope || scope.value, category: cat.value, limit: limit.value });
      S.budgets = [...(S.budgets || []).filter((z) => z.id !== y.id), y];
      renderTool();
    }, 'Save');
  }
  // Suggested limits: what each category averaged over the last three full months, or its bills a month if
  // that's more, rounded up to the next $10. You change any of them, or untick it, before saving.
  function suggestBudgets() {
    const sc = billScope === 'all' ? 'personal' : billScope;
    const months = [1, 2, 3].map((d) => monthKey(todayKey().slice(0, 7), -d));
    const xs = (S.money || []).filter((x) => x.scope === sc && x.kind === 'out' && months.some((m) => x.day?.startsWith(m)));
    const per = new Map();
    for (const x of xs) if (!NOT_SPENDING.includes(x.category)) per.set(x.category || 'Other', (per.get(x.category || 'Other') || 0) + x.amount / 3);
    for (const b of billsLive().filter((b) => b.scope === sc)) {
      const c = b.category || 'Bills';
      per.set(c, Math.max(per.get(c) || 0, b.amount * PER_MONTH[b.repeat]));
    }
    const rows = [...per].filter(([, n]) => n >= 100).sort((a, b) => b[1] - a[1]).map(([c, n]) => {
      const have = (S.budgets || []).find((y) => y.scope === sc && sameText(y.category, c));
      const on = h('input', { type: 'checkbox', checked: !have });
      const val = h('input', { value: have ? (have.limit / 100).toFixed(0) : String(Math.ceil(n / 1000) * 10), inputmode: 'decimal' });
      return { c, on, val, el: h('div', { class: 'suggest-row' }, h('label', { class: 'pick' }, on, c, have ? h('small', {}, ` · now ${money(have.limit)}`) : null), h('span', {}, '$', val)) };
    });
    if (!rows.length) return toast('Add a few weeks of spending or some bills first, so there’s something to go on.');
    sheet(`Suggested ${sc} budgets`, [
      h('p', { class: 'day-hint' }, `From what you spent in ${months.slice().reverse().map(monthName).join(', ')}, and your bills. Change any amount, or untick the ones you don’t want.`),
      ...rows.map((r) => r.el),
    ], async () => {
      for (const r of rows.filter((r) => r.on.checked)) {
        const y = await api('PUT', '/budgets', { scope: sc, category: r.c, limit: r.val.value });
        S.budgets = [...(S.budgets || []).filter((z) => z.id !== y.id), y];
      }
      renderTool();
    }, 'Save budgets');
  }

  // ----- bank statements: a CSV file from the bank, sorted into categories -----
  const CAT_RULES = [
    ['Groceries', /trader joe|whole foods|safeway|kroger|aldi|sprouts|smith'?s food|albertsons|vons|grocery|market/i],
    ['Dining', /restaurant|cafe|coffee|starbucks|dutch bros|mcdonald|chipotle|doordash|uber eats|grubhub|pizza|taco|burger|chick-fil-a|in-n-out/i],
    ['Gas', /shell|chevron|exxon|arco|circle k|maverik|fuel|gas station|76 /i],
    ['Ads & marketing', /facebk|facebook|meta ads|google ads|adwords|instagram|tiktok|yelp|nextdoor/i],
    ['Software', /adobe|google \*|gsuite|workspace|microsoft|apple\.com|openai|anthropic|canva|dropbox|zoom|slack|notion|github|vercel|railway|squarespace|godaddy/i],
    ['Utilities', /electric|energy|power|water|sewer|internet|comcast|xfinity|cox comm|at&t|verizon|t-mobile|spectrum/i],
    ['Insurance', /insurance|geico|progressive|state farm|allstate/i],
    ['Rent', /\brent\b|lease|property mgmt/i],
    ['Travel', /airline|delta|united|southwest|american air|hotel|airbnb|marriott|hilton|uber|lyft/i],
    ['Health', /pharmacy|cvs|walgreens|dental|doctor|clinic|medical/i],
    ['Shopping', /amazon|amzn|target|etsy|ebay|walmart|costco|home depot|lowe'?s/i],
    ['Fees', /\bfee\b|interest charge|overdraft|service charge/i],
    ['Payroll', /gusto|adp|paychex/i],
    ['Transfer', /transfer|zelle|venmo|cash app|paypal|xfer/i],
  ];
  const IN_RULES = [['Paycheck', /payroll|direct dep|salary/i], ['Client payment', /stripe|square|deposit|invoice/i], ['Refund', /refund|return/i], ['Transfer in', /transfer|zelle|venmo|cash app|paypal|xfer/i]];
  const descKey = (t) => String(t || '').toLowerCase().replace(/[#*]?\d[\d\s/:-]*/g, ' ').replace(/\s+/g, ' ').trim();
  // A row's category: what you called the same place before, else a guess from its name.
  function guessCategory(note, kind) {
    const k = descKey(note);
    const before = k && [...(S.money || [])].sort((a, b) => b.createdAt - a.createdAt).find((x) => x.kind === kind && x.category && descKey(x.note) === k);
    if (before) return before.category;
    return ((kind === 'in' ? IN_RULES : CAT_RULES).find(([, re]) => re.test(note)) || [kind === 'in' ? 'Other income' : 'Other'])[0];
  }
  // Dates as banks write them: 2026-10-05, 10/05/2026, 10/5/26, Oct 5, 2026.
  function statementDay(v) {
    const t = String(v || '').trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const d = Date.parse(t);
    return Number.isNaN(d) ? null : new Date(d).toISOString().slice(0, 10);
  }
  const statementNum = (v) => {
    const t = String(v || '').trim();
    if (!t) return 0;
    const neg = /^\(.*\)$/.test(t) || /^-/.test(t) || /-$/.test(t);
    const n = Number(t.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? (neg ? -n : n) : 0;
  };
  function pickStatement() {
    // On the page while it's open, as some browsers won't open a file picker for one that isn't.
    $('#stmtFile')?.remove();
    const input = h('input', { type: 'file', id: 'stmtFile', class: 'hidden', accept: '.csv,.tsv,.txt,text/csv' });
    document.body.append(input);
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.remove();
      if (!f) return;
      if (f.size > 5_000_000) return toast('That file is too big for a statement.');
      statementSheet(parseDelimited(await f.text()).filter((r) => r.some((c) => c.trim())), f.name);
    });
    input.click();
  }
  function statementSheet(raw, name) {
    // The header is the first row with a date-like or description-like heading.
    const at = Math.max(0, raw.findIndex((r) => r.some((c) => /date|description|amount|debit|credit|memo|payee/i.test(c))));
    const head = raw[at] || [];
    const body = raw.slice(at + 1).filter((r) => r.length >= 2);
    if (!body.length) return toast('Couldn’t find any transactions in that file.');
    const find = (re) => head.findIndex((c) => re.test(c));
    const cols = head.map((c, i) => h('option', { value: i }, c || `Column ${i + 1}`));
    const pick = (i) => { const sel = h('select', {}, h('option', { value: -1 }, '—'), cols.map((o) => o.cloneNode(true))); sel.value = i; return sel; };
    const cDate = pick(Math.max(0, find(/date|posted/i)));
    const cDesc = pick(find(/desc|memo|payee|merchant|name|details|transaction/i));
    const cAmt = pick(find(/^amount|amount$/i));
    const cOut = pick(find(/debit|withdraw|charge|money out/i));
    const cIn = pick(find(/credit|deposit|money in/i));
    const flip = h('input', { type: 'checkbox' });
    const scope = h('select', { disabled: !amOwner() }, h('option', { value: 'personal' }, 'Personal · only you'), h('option', { value: 'business', selected: billScope === 'business' }, 'Business · shared with owners'));
    const preview = h('div', { class: 'stmt-rows' });
    const totals = h('p', { class: 'day-hint' });
    let rows = [];
    const read = () => {
      const v = (r, sel) => (Number(sel.value) >= 0 ? r[Number(sel.value)] : '');
      rows = body.map((r) => {
        let n = Number(cAmt.value) >= 0 ? statementNum(v(r, cAmt)) * (flip.checked ? -1 : 1) : statementNum(v(r, cIn)) - Math.abs(statementNum(v(r, cOut)));
        const note = String(v(r, cDesc) || '').trim().slice(0, 200);
        const kind = n > 0 ? 'in' : 'out';
        return { day: statementDay(v(r, cDate)), amount: n, note, kind };
      }).filter((r) => r.day && r.amount);
      for (const r of rows) r.category = guessCategory(r.note, r.kind);
      const got = rows.filter((r) => r.amount > 0).reduce((n, r) => n + r.amount, 0), out = rows.filter((r) => r.amount < 0).reduce((n, r) => n - r.amount, 0);
      totals.textContent = rows.length ? `${rows.length} transactions · ${money(Math.round(got * 100))} in · ${money(Math.round(out * 100))} out. Check the categories, then import. Ones already in Column are skipped.` : 'No transactions found with these columns. Pick the right ones above.';
      preview.replaceChildren(...rows.slice(0, 300).map((r) => {
        const cat = catInput(r.kind, r.category);
        cat.addEventListener('change', () => (r.category = cat.value));
        return h('div', { class: 'stmt-row' }, h('span', { class: 'stmt-d' }, dueLabel(r.day)), h('span', { class: 'stmt-n' }, r.note || '—'), cat,
          h('b', { class: r.amount > 0 ? 'up' : null }, (r.amount > 0 ? '+' : '−') + money(Math.round(Math.abs(r.amount) * 100))));
      }), rows.length > 300 ? h('p', { class: 'day-hint' }, `…and ${rows.length - 300} more, sorted the same way.`) : '');
    };
    for (const sel of [cDate, cDesc, cAmt, cOut, cIn, flip]) sel.addEventListener('change', read);
    read();
    sheet('Import ' + name, [
      h('div', { class: 'row2' }, h('label', {}, 'Date', cDate), h('label', {}, 'Description', cDesc)),
      h('div', { class: 'row3' }, h('label', {}, 'Amount', cAmt), h('label', {}, 'or Money out', cOut), h('label', {}, 'and Money in', cIn)),
      h('label', { class: 'pick' }, flip, 'Spending shows as positive numbers (common on credit card statements)'),
      h('label', {}, 'Kind', scope),
      totals,
      preview,
    ], async () => {
      if (!rows.length) throw new Error('Pick the columns with the date and amount first.');
      const r = await api('POST', '/money/import', { scope: scope.value, rows: rows.map(({ day, amount, note, category }) => ({ day, amount, note, category })) });
      S.money = [...(S.money || []).filter((x) => !r.entries.some((y) => y.id === x.id)), ...r.entries];
      FIN.tab = 'flow';
      renderTool();
      toast(`Imported ${r.added}` + (r.skipped ? ` · ${r.skipped} already in or unreadable` : ''));
    }, 'Import');
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
  // Owners always; members when an owner turns it on in Settings, and then only for lists in their own campaigns
  // (ones they made, run, are invited to, or have a task in). The server checks the same.
  const mayEmail = () => amOwner() || !!S.workspace?.settings?.memberEmail;
  const myCampaign = (c) => !!c && (c.ownerId === S.me?.memberId || c.assigneeId === S.me?.memberId || (c.memberIds || []).includes(S.me?.memberId)
    || S.tasks.some((t) => t.assigneeId === S.me?.memberId && goalById(t.goalId)?.campaignId === c.id));
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
    const lists = S.lists.filter((l) => kindOf(l) === 'calls' && listFields(l).email >= 0 && campById(l.campaignId) && (amOwner() || myCampaign(campById(l.campaignId))));
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
    if (!amOwner() && m && !m.pss) return [h('p', { class: 'day-hint' }, 'Email needs PSS admin connected, for the unsubscribe links. Ask a team owner to connect it in Settings.')];
    if (amOwner() && !S.pss?.connected) return [h('p', { class: 'day-hint' }, 'Connect PSS admin in Settings first. Every email carries an unsubscribe link, and those come from your website.'), h('button', { class: 'btn small', onclick: () => { closeTool(); openSettings('connections', '.pss-sec'); } }, 'Open Settings')];
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
    if (!amOwner()) footer.readOnly = true;
    const camp = h('select', { 'aria-label': 'Log it in' }, h('option', { value: '' }, 'Don’t log it'), S.campaigns.filter((c) => c.status !== 'done' && (amOwner() || myCampaign(c))).map((c) => h('option', { value: c.id, selected: c.id === M.campaignId }, c.name)));
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
          amOwner() ? h('button', { class: 'btn small', onclick: pickTyped }, '+ Type or paste') : null),
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
        h('small', { class: 'day-hint' }, amOwner() ? 'Every email ends with this and the person’s own unsubscribe link.' : 'Every email ends with this and the person’s own unsubscribe link. Team owners set the footer.'),
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

  const SET_TABS = [['general', 'General'], ['team', 'Team'], ['connections', 'Connections'], ['account', 'Account']];
  function renderSettings() {
    const s = $('#settings');
    const ws = S.workspace;
    s.innerHTML = '';
    s.append(h('h2', {}, 'Settings', h('button', { class: 'icon-btn', html: I.close, 'aria-label': 'Close', onclick: () => s.classList.add('hidden') })));
    // Grouped under tabs, so each one stays short.
    const tab = SET_TABS.some(([k]) => k === S.setTab) ? S.setTab : 'general';
    s.append(h('div', { class: 'seg set-tabs', role: 'tablist' }, SET_TABS.map(([k, label]) =>
      h('button', { class: tab === k ? 'on' : null, role: 'tab', 'aria-selected': String(tab === k), onclick: () => { S.setTab = k; store.set('setTab', k); renderSettings(); s.scrollTop = 0; } }, label))));
    const me = ws.members.find((x) => x.id === S.me.memberId);
    const owner = me?.role === 'owner';

    if (tab === 'general') {
      // Layout
      const seg = h('div', { class: 'seg' },
        h('button', { class: S.panes.length === 1 ? 'on' : null, onclick: () => { setPanes([S.panes[0] === 'files' ? 'all' : S.panes[0]]); renderSettings(); } }, 'One column'),
        h('button', { class: S.panes.length === 2 ? 'on' : null, onclick: () => { setPanes(['all', 'files']); renderSettings(); } }, 'Split into two')
      );
      s.append(h('section', {}, h('h3', {}, 'Layout'), seg,
        h('p', { style: 'margin-top:8px;font-size:11.5px' }, 'Use the tabs at the top of each column to switch what it shows: everything, files, or a stack.')));

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
    }

    if (tab === 'connections') {
      s.append(calendarSection());
      loadCalendars();
      s.append(aiSection());
      loadAi();
      if (isOwner()) s.append(pssSection());
    }

    if (tab === 'team') {
      // People
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
      if (isOwner()) {
        s.append(h('section', {}, h('h3', {}, 'Campaign email'),
          toggleRow('Members can send campaign email', 'From their own Outlook, to people on lists in their own campaigns. Owners can always send.', !!ws.settings.memberEmail,
            (on) => api('PATCH', '/workspace', { memberEmail: on }).catch((e) => toast(e.message)))));
      }
      s.append(brandSection());
    }

    if (tab === 'account') {
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
  }

  // ---------- boot ----------
  if (desktop) desktop.onConfig?.((cfg) => (S.desktopCfg = cfg));
  if (S.token) start();
  else showLogin();
  if (desktop) desktop.setLayout(S.panes.length);
})();
