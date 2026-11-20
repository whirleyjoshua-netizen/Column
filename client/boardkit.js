// The Whiteboard's canvas (2026-11-19): a board of stickies, text, shapes, frames, pictures and files, and cards that
// stand for a real task, campaign step, record, contact or doc, with arrows between them. Pan (drag the background,
// space+drag, two fingers, the scroll wheel on a trackpad), zoom (pinch, ⌘/Ctrl+wheel, a mouse wheel, + and −, fit),
// select (tap; Shift+tap adds; Shift+drag or the ⬚ tool draws a box), move, resize, write in place, color, front and
// back, duplicate, copy and paste, delete, undo and redo, and the keys for all of it.
// The app (app.js) does the rest: it loads the board, sends the changes (opts.send) and passes on the others'
// (editor.apply), and says what a card or a file is (opts.cardInfo, opts.fileInfo). Everything is built from
// elements and text, never from markup, so nothing on a board can run.
window.ColumnBoard = (() => {
  const COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange', 'gray', 'white'];
  const SIZE = { sticky: [200, 200], text: [240, 60], shape: [200, 120], frame: [640, 420], file: [240, 180], card: [260, 96] };
  const MIN_Z = 0.1, MAX_Z = 3;
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const svg = (tag, attrs = {}) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  let seq = 0;
  const newId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + (seq++).toString(36);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  function editor(opts) {
    const o = { send: async () => {}, cardInfo: () => null, fileInfo: () => null, openCard: () => {}, pickFile: null, pickCard: null, upload: null, toast: () => {}, onSelect: () => {}, viewKey: null, ...opts };
    const items = new Map(), links = new Map();
    const nodes = new Map(); // item id -> its element
    const labels = new Map(); // link id -> its label element
    let sel = new Set(), selLink = null, editing = null, tool = null, boxMode = false, space = false;
    let view = { x: 0, y: 0, z: 1 };
    const undo = [], redo = [];
    let clip = null, gone = false;
    for (const x of opts.board.items || []) items.set(x.id, clone(x));
    for (const l of opts.board.links || []) links.set(l.id, clone(l));

    // ----- the page -----
    const lines = svg('svg', { class: 'wb-links', width: 1, height: 1 });
    const defs = svg('defs');
    const mk = svg('marker', { id: 'wb-head-' + opts.board.id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
    mk.append(svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'wb-head' }));
    defs.append(mk);
    lines.append(defs);
    const temp = svg('line', { class: 'wb-temp', 'marker-end': `url(#wb-head-${opts.board.id})` });
    temp.style.display = 'none';
    const world = el('div', { class: 'wb-world' }, lines);
    const box = el('div', { class: 'wb-box' });
    box.style.display = 'none';
    const canvas = el('div', { class: 'wb-canvas', tabindex: '0', 'aria-label': 'Whiteboard. Double-click to add a sticky; drag to move around.' }, world, box);
    const selbar = el('div', { class: 'wb-selbar' });
    selbar.style.display = 'none';
    const toolbar = el('div', { class: 'wb-tools', role: 'toolbar', 'aria-label': 'Add to the board' });
    const zoomTxt = el('button', { class: 'wb-zoom-n', title: 'Fit everything (Shift+1)', onclick: () => fit() }, '100%');
    const undoBtn = el('button', { class: 'wb-btn', title: `Undo (${isMac ? '⌘' : 'Ctrl+'}Z)`, 'aria-label': 'Undo', onclick: () => doUndo() }, '↶');
    const redoBtn = el('button', { class: 'wb-btn', title: `Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`, 'aria-label': 'Redo', onclick: () => doRedo() }, '↷');
    const zoombar = el('div', { class: 'wb-zoom' }, undoBtn, redoBtn, el('span', { class: 'wb-sep' }),
      el('button', { class: 'wb-btn', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.25) }, '−'), zoomTxt,
      el('button', { class: 'wb-btn', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.25) }, '+'));
    const root = el('div', { class: 'wb' }, canvas, toolbar, zoombar, selbar);
    lines.append(temp);

    // ----- the toolbar -----
    const TOOLS = [
      ['select', '↖', 'Select and move (V)'], ['box', '⬚', 'Select an area (or Shift+drag)'], ['sticky', '🟨', 'Sticky note (S)'], ['text', 'T', 'Text (T)'],
      ['shape', '◻︎', 'Shape (R)'], ['frame', '▭', 'Frame, to group things (F)'], ['arrow', '↗', 'Arrow: drag from one thing to another (L)'],
      ['file', '🖼', 'Picture or file'], ['card', '🔗', 'A task, step, job, contact or doc'],
    ];
    const toolBtns = {};
    for (const [k, ic, tip] of TOOLS) {
      if (k === 'file' && !o.pickFile) continue;
      if (k === 'card' && !o.pickCard) continue;
      toolBtns[k] = el('button', { class: 'wb-tool', 'data-tool': k, title: tip, 'aria-label': tip, onclick: () => pickTool(k) }, ic);
      toolbar.append(toolBtns[k]);
    }
    let shapeNext = 'rect';
    function pickTool(k) {
      if (k === 'file') return addFile();
      if (k === 'card') return addCard();
      if (k === 'select') { tool = null; boxMode = false; }
      else if (k === 'box') { tool = null; boxMode = !boxMode; }
      else tool = tool === k ? null : k;
      if (k !== 'box' && k !== 'select') boxMode = false;
      markTools();
      canvas.focus({ preventScroll: true });
    }
    function markTools() {
      for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === 'box' ? boxMode : k === 'select' ? !tool && !boxMode : tool === k);
      root.classList.toggle('placing', !!tool && tool !== 'arrow');
      root.classList.toggle('linking', tool === 'arrow');
    }

    // ----- where things are -----
    const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch {} return null; };
    function setView(v, keep = true) {
      view = { x: v.x, y: v.y, z: Math.max(MIN_Z, Math.min(MAX_Z, v.z)) };
      world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
      root.style.setProperty('--wb-z', view.z);
      zoomTxt.textContent = Math.round(view.z * 100) + '%';
      if (keep && o.viewKey) { clearTimeout(setView.t); setView.t = setTimeout(() => store(o.viewKey, view), 300); }
      placeSelbar();
    }
    const rect = () => canvas.getBoundingClientRect();
    const toWorld = (cx, cy) => { const r = rect(); return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }; };
    function zoomAt(cx, cy, factor) {
      const r = rect();
      const z = Math.max(MIN_Z, Math.min(MAX_Z, view.z * factor));
      const px = cx - r.left, py = cy - r.top;
      setView({ x: px - ((px - view.x) / view.z) * z, y: py - ((py - view.y) / view.z) * z, z });
    }
    const zoomBy = (f) => { const r = rect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); };
    function bounds(list) {
      const xs = list.length ? list : [...items.values()];
      if (!xs.length) return null;
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const x of xs) { a = Math.min(a, x.x); b = Math.min(b, x.y); c = Math.max(c, x.x + x.w); d = Math.max(d, x.y + x.h); }
      return { x: a, y: b, w: c - a, h: d - b };
    }
    function fit(list = []) {
      const r = rect(), bb = bounds(list);
      if (!r.width) return;
      if (!bb) return setView({ x: r.width / 2, y: r.height / 2, z: 1 });
      // Room for the tools on the left (along the bottom on a phone) and the zoom bar.
      const narrowNow = r.width < 640, padL = narrowNow ? 24 : 108, padR = 40, padT = 50, padB = narrowNow ? 150 : 80;
      const z = Math.max(MIN_Z, Math.min(1.5, Math.min((r.width - padL - padR) / bb.w, (r.height - padT - padB) / bb.h)));
      setView({ x: padL + (r.width - padL - padR) / 2 - (bb.x + bb.w / 2) * z, y: padT + (r.height - padT - padB) / 2 - (bb.y + bb.h / 2) * z, z });
    }
    const middle = () => { const r = rect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); };

    // ----- drawing -----
    const order = () => [...items.values()].sort((a, b) => (b.kind === 'frame') - (a.kind === 'frame') || (a.z || 0) - (b.z || 0)); // frames underneath
    function body(x) {
      const words = el('div', { class: 'wb-text', text: x.text || '' });
      if (x.kind === 'frame') return [el('div', { class: 'wb-frame-t' }, words)];
      if (x.kind === 'shape') {
        const s = svg('svg', { class: 'wb-shape-bg', viewBox: '0 0 100 100', preserveAspectRatio: 'none' });
        s.append(x.shape === 'ellipse' ? svg('ellipse', { cx: 50, cy: 50, rx: 49, ry: 49, 'vector-effect': 'non-scaling-stroke' })
          : x.shape === 'diamond' ? svg('polygon', { points: '50,1 99,50 50,99 1,50', 'vector-effect': 'non-scaling-stroke' })
          : svg('rect', { x: 1, y: 1, width: 98, height: 98, rx: 8, 'vector-effect': 'non-scaling-stroke' }));
        return [s, words];
      }
      if (x.kind === 'file') {
        const f = o.fileInfo(x.fileId);
        if (!f) return [el('div', { class: 'wb-missing' }, 'File not available')];
        return [f.image ? el('img', { class: 'wb-img', src: f.url, alt: f.name, draggable: 'false' }) : el('div', { class: 'wb-file-ic' }, '📎'), el('div', { class: 'wb-file-n', text: f.name })];
      }
      if (x.kind === 'card') {
        const c = o.cardInfo(x.ref);
        if (!c) return [el('div', { class: 'wb-card-k' }, '🔗'), el('div', { class: 'wb-card-t' }, el('b', { text: 'Not available to you' }), el('small', { text: 'It was deleted, or it’s not shared with you' }))];
        return [el('div', { class: 'wb-card-k', text: c.icon || '🔗' }), el('div', { class: 'wb-card-t' }, el('b', { text: c.title || 'Untitled' }), c.sub ? el('small', { text: c.sub }) : null),
          c.status ? el('span', { class: 'wb-card-s' + (c.done ? ' done' : ''), text: c.status }) : null,
          el('button', { class: 'wb-card-open', title: 'Open it', onclick: (e) => { e.stopPropagation(); o.openCard(x.ref); } }, 'Open')];
      }
      return [words];
    }
    function draw(id) {
      const x = items.get(id);
      let n = nodes.get(id);
      if (!x) { n?.remove(); nodes.delete(id); return; }
      if (!n) { n = el('div', { class: 'wb-item', 'data-id': id }); nodes.set(id, n); world.append(n); }
      if (editing !== id) {
        n.className = `wb-item k-${x.kind} c-${x.color || 'white'}${x.kind === 'shape' ? ' s-' + (x.shape || 'rect') : ''}${sel.has(id) ? ' sel' : ''}`;
        n.replaceChildren(...body(x).filter(Boolean), ...(sel.size === 1 && sel.has(id) ? [el('div', { class: 'wb-h', title: 'Drag to resize' })] : []));
      } else n.classList.toggle('sel', sel.has(id));
      Object.assign(n.style, { left: x.x + 'px', top: x.y + 'px', width: x.w + 'px', height: x.h + 'px' });
    }
    function restack() { for (const x of order()) { const n = nodes.get(x.id); if (n) world.append(n); } }
    // An arrow from the edge of one thing to the edge of the other.
    function edge(a, b) {
      const cx = a.x + a.w / 2, cy = a.y + a.h / 2, dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy;
      if (!dx && !dy) return { x: cx, y: cy };
      const rw = a.w / 2, rh = a.h / 2;
      // Where the line leaves the thing's own outline: an oval's curve, a diamond's sides, else the box.
      const s = a.kind === 'shape' && a.shape === 'ellipse' ? 1 / Math.hypot(dx / rw, dy / rh)
        : a.kind === 'shape' && a.shape === 'diamond' ? 1 / (Math.abs(dx) / rw + Math.abs(dy) / rh)
        : Math.min(Math.abs(rw / (dx || 1e-9)), Math.abs(rh / (dy || 1e-9)));
      return { x: cx + dx * Math.min(1, s), y: cy + dy * Math.min(1, s) };
    }
    let linkFrame = 0;
    function drawLinks() {
      if (linkFrame) return;
      // Next frame; a hidden page has none, so then right after (it's up to date when it's shown).
      const later = document.hidden ? (f) => setTimeout(f, 0) : requestAnimationFrame;
      linkFrame = later(() => {
        linkFrame = 0;
        for (const n of [...lines.querySelectorAll('g.wb-link')]) n.remove();
        const seen = new Set();
        for (const l of links.values()) {
          const a = items.get(l.from), b = items.get(l.to);
          if (!a || !b) continue;
          seen.add(l.id);
          const p = edge(a, b), q = edge(b, a);
          const g = svg('g', { class: 'wb-link' + (selLink === l.id ? ' sel' : ''), 'data-link': l.id });
          g.append(svg('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: 'wb-hit' }), svg('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: 'wb-line', 'marker-end': `url(#wb-head-${opts.board.id})` }));
          lines.insertBefore(g, temp);
          let lab = labels.get(l.id);
          if (l.label || selLink === l.id || lab?.isContentEditable) {
            if (!lab) { lab = el('div', { class: 'wb-label', 'data-link': l.id }); labels.set(l.id, lab); world.append(lab); }
            if (!lab.isContentEditable) lab.textContent = l.label || '';
            lab.classList.toggle('empty', !l.label);
            lab.classList.toggle('sel', selLink === l.id);
            Object.assign(lab.style, { left: (p.x + q.x) / 2 + 'px', top: (p.y + q.y) / 2 + 'px' });
          } else if (lab) { lab.remove(); labels.delete(l.id); }
        }
        for (const [id, lab] of labels) if (!seen.has(id)) { lab.remove(); labels.delete(id); }
      });
    }
    function drawAll() {
      for (const id of [...nodes.keys()]) if (!items.has(id)) draw(id);
      for (const id of items.keys()) draw(id);
      restack();
      drawLinks();
      placeSelbar();
    }

    // ----- changes: made here (sent, undoable) or heard from others -----
    let queue = [], timer = null;
    function flush() {
      clearTimeout(timer);
      timer = null;
      if (!queue.length || gone) return;
      const ops = queue;
      queue = [];
      Promise.resolve(o.send(ops)).catch((e) => o.toast(e?.message || 'That change didn’t save. Reload the board to see where it is.'));
    }
    const sendSoon = (ops, wait = 120) => { queue.push(...ops); if (!timer) timer = setTimeout(flush, wait); };
    // Apply to what's shown; returns what would put it back.
    function applyLocal(ops) {
      const back = [];
      for (const op of ops) {
        if (op.op === 'put' && op.item) {
          const had = items.get(op.item.id);
          back.unshift(had ? { op: 'put', item: clone(had) } : { op: 'del', item: op.item.id });
          items.set(op.item.id, { ...(had || {}), ...clone(op.item) });
          draw(op.item.id);
        } else if (op.op === 'del' && op.item) {
          const had = items.get(op.item);
          if (!had) continue;
          // Its arrows go with it (the server does the same), and come back with an undo.
          for (const l of [...links.values()]) if (l.from === op.item || l.to === op.item) { back.unshift({ op: 'put', link: clone(l) }); links.delete(l.id); }
          for (const y of items.values()) if (y.parentId === op.item) { back.unshift({ op: 'put', item: { id: y.id, parentId: op.item } }); y.parentId = null; }
          back.unshift({ op: 'put', item: clone(had) });
          items.delete(op.item);
          sel.delete(op.item);
          draw(op.item);
        } else if (op.op === 'put' && op.link) {
          const had = links.get(op.link.id);
          back.unshift(had ? { op: 'put', link: clone(had) } : { op: 'del', link: op.link.id });
          links.set(op.link.id, { ...(had || {}), ...clone(op.link) });
        } else if (op.op === 'del' && op.link) {
          const had = links.get(op.link);
          if (!had) continue;
          back.unshift({ op: 'put', link: clone(had) });
          links.delete(op.link);
          if (selLink === op.link) selLink = null;
        }
      }
      restack();
      drawLinks();
      placeSelbar();
      return back;
    }
    function change(ops, { wait = 120, record = true } = {}) {
      if (!ops.length) return;
      const back = applyLocal(ops);
      if (record) { undo.push({ ops, back }); if (undo.length > 200) undo.shift(); redo.length = 0; }
      sendSoon(ops, wait);
      marks();
    }
    function doUndo() {
      const u = undo.pop();
      if (!u) return;
      applyLocal(u.back);
      sendSoon(u.back, 0);
      redo.push(u);
      sel = new Set([...sel].filter((id) => items.has(id)));
      drawAll();
      marks();
    }
    function doRedo() {
      const u = redo.pop();
      if (!u) return;
      applyLocal(u.ops);
      sendSoon(u.ops, 0);
      undo.push(u);
      drawAll();
      marks();
    }
    const marks = () => { undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length; };
    // Someone else's: shown, never undone from here. What I'm dragging or writing stays as I have it.
    function apply(ops) {
      const mine = new Set([...(drag?.ids || []), editing].filter(Boolean));
      for (const op of ops) {
        if (op.op === 'put' && op.item && mine.has(op.item.id)) {
          const keep = items.get(op.item.id);
          const next = { ...keep, ...op.item };
          if (drag?.ids.includes(op.item.id)) Object.assign(next, { x: keep.x, y: keep.y, w: keep.w, h: keep.h });
          if (editing === op.item.id) next.text = keep.text;
          items.set(op.item.id, next);
          continue;
        }
        applyLocal([op]);
      }
      sel = new Set([...sel].filter((id) => items.has(id)));
      drawAll();
    }

    // ----- selection -----
    function select(ids, link = null) {
      const before = [...sel];
      sel = new Set(ids);
      selLink = link;
      for (const id of new Set([...before, ...sel])) draw(id);
      drawLinks();
      placeSelbar();
      o.onSelect([...sel]);
    }
    function placeSelbar() {
      const list = [...sel].map((id) => items.get(id)).filter(Boolean);
      if ((!list.length && !selLink) || editing || drag) { selbar.style.display = 'none'; return; }
      selbar.replaceChildren(...selbarKids(list));
      selbar.style.display = '';
      const r = rect();
      let at;
      if (list.length) { const bb = bounds(list); at = { x: bb.x * view.z + view.x + (bb.w * view.z) / 2, y: bb.y * view.z + view.y }; }
      else { const lab = labels.get(selLink); const l = links.get(selLink); const a = l && items.get(l.from), b = l && items.get(l.to); at = a && b ? { x: ((a.x + a.w / 2 + b.x + b.w / 2) / 2) * view.z + view.x, y: ((a.y + a.h / 2 + b.y + b.h / 2) / 2) * view.z + view.y - 20 } : { x: r.width / 2, y: 60 }; void lab; }
      const w = selbar.offsetWidth || 300;
      const minL = root.classList.contains('narrow') ? 8 : toolbar.offsetLeft + toolbar.offsetWidth + 8; // clear of the tools
      selbar.style.left = Math.max(minL, Math.min(r.width - w - 8, at.x - w / 2)) + 'px';
      selbar.style.top = Math.max(8, at.y - 54) + 'px';
    }
    function selbarKids(list) {
      const out = [];
      const b = (label, title, run, cls = '') => el('button', { class: 'wb-sb ' + cls, title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); run(); } }, label);
      if (!list.length && selLink) {
        out.push(b('✎ Label', 'Write on the arrow', () => editLabel(selLink)), b('🗑', 'Delete the arrow (Delete)', () => { change([{ op: 'del', link: selLink }]); select([]); }, 'danger'));
        return out;
      }
      const colorable = list.filter((x) => ['sticky', 'shape', 'frame', 'text'].includes(x.kind));
      if (colorable.length) for (const c of COLORS) out.push(el('button', { class: `wb-sw c-${c}${colorable.every((x) => x.color === c) ? ' on' : ''}`, title: c, 'aria-label': 'Color ' + c, onclick: (e) => { e.stopPropagation(); change(colorable.map((x) => ({ op: 'put', item: { id: x.id, color: c } }))); } }));
      const shapes = list.filter((x) => x.kind === 'shape');
      if (shapes.length) {
        out.push(el('span', { class: 'wb-sep' }));
        for (const [s, ic] of [['rect', '▭'], ['ellipse', '◯'], ['diamond', '◇']]) out.push(b(ic, s === 'rect' ? 'Rectangle' : s === 'ellipse' ? 'Oval' : 'Diamond', () => { shapeNext = s; change(shapes.map((x) => ({ op: 'put', item: { id: x.id, shape: s } }))); }, shapes.every((x) => x.shape === s) ? 'on' : ''));
      }
      out.push(el('span', { class: 'wb-sep' }));
      if (list.length === 1 && list[0].kind === 'card') out.push(b('Open', 'Open it', () => o.openCard(list[0].ref)));
      if (list.length === 1 && ['sticky', 'text', 'shape', 'frame'].includes(list[0].kind)) out.push(b('✎', 'Write (Enter)', () => startEdit(list[0].id)));
      if (list.length === 2) out.push(b('↗', 'Connect them with an arrow', () => connect(list[0].id, list[1].id)));
      out.push(b('⤒', 'Bring to front', () => restackSel(1)), b('⤓', 'Send to back', () => restackSel(-1)), b('⧉', `Duplicate (${isMac ? '⌘' : 'Ctrl+'}D)`, () => duplicate()), b('🗑', 'Delete (Delete)', () => removeSel(), 'danger'));
      return out;
    }
    function restackSel(dir) {
      const zs = [...items.values()].map((x) => x.z || 0);
      const hi = Math.max(0, ...zs), lo = Math.min(0, ...zs);
      const list = [...sel].map((id) => items.get(id)).filter(Boolean).sort((a, b) => (a.z || 0) - (b.z || 0));
      change(list.map((x, i) => ({ op: 'put', item: { id: x.id, z: dir > 0 ? hi + 1 + i : lo - list.length + i } })));
    }
    const topZ = () => Math.max(0, ...[...items.values()].map((x) => x.z || 0)) + 1;
    // A frame and what's in it.
    const withKids = (ids) => { const out = new Set(ids); for (const id of ids) if (items.get(id)?.kind === 'frame') for (const y of items.values()) if (y.parentId === id) out.add(y.id); return [...out]; };
    function removeSel() {
      if (selLink && !sel.size) { change([{ op: 'del', link: selLink }]); select([]); return; }
      const ids = [...sel];
      if (!ids.length) return;
      change(ids.map((id) => ({ op: 'del', item: id })));
      select([]);
    }
    function copySel() {
      const ids = withKids([...sel]);
      if (!ids.length) return false;
      clip = { items: ids.map((id) => clone(items.get(id))), links: [...links.values()].filter((l) => ids.includes(l.from) && ids.includes(l.to)).map(clone) };
      return true;
    }
    function paste(dx = 40, dy = 40) {
      if (!clip) return;
      const map = new Map(clip.items.map((x) => [x.id, newId()]));
      const z = topZ();
      const ops = clip.items.map((x, i) => ({ op: 'put', item: { ...x, id: map.get(x.id), x: x.x + dx, y: x.y + dy, z: z + i, parentId: x.parentId && map.has(x.parentId) ? map.get(x.parentId) : x.parentId || null } }));
      ops.sort((a, b) => (b.item.kind === 'frame') - (a.item.kind === 'frame'));
      for (const l of clip.links) ops.push({ op: 'put', link: { ...l, id: newId(), from: map.get(l.from), to: map.get(l.to) } });
      change(ops, { wait: 0 });
      // What's selected after: the pasted things, but not those inside a pasted frame (they go with it).
      select(clip.items.filter((x) => !(x.parentId && map.has(x.parentId))).map((x) => map.get(x.id)));
      clip = { items: ops.filter((x) => x.item).map((x) => clone(x.item)), links: ops.filter((x) => x.link).map((x) => clone(x.link)) }; // the next paste steps on again
    }
    function duplicate() { if (copySel()) paste(); }
    function connect(a, b) {
      if (a === b || [...links.values()].some((l) => l.from === a && l.to === b)) return;
      const id = newId();
      change([{ op: 'put', link: { id, from: a, to: b, label: '' } }], { wait: 0 });
      select([], id);
    }

    // ----- adding -----
    function add(kind, at, extra = {}) {
      const [w, h] = SIZE[kind];
      const id = newId();
      const x = { id, kind, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h, text: '', color: kind === 'sticky' ? 'yellow' : kind === 'frame' ? 'gray' : 'white', z: kind === 'frame' ? Math.min(0, ...[...items.values()].map((y) => y.z || 0)) - 1 : topZ(), ...(kind === 'shape' ? { shape: shapeNext } : {}), ...extra };
      if (kind === 'frame') x.text = 'Frame';
      const fr = kind === 'frame' ? null : frameAt(x);
      if (fr) x.parentId = fr;
      change([{ op: 'put', item: x }], { wait: 0 });
      select([id]);
      tool = null;
      markTools();
      if (['sticky', 'text', 'shape', 'frame'].includes(kind)) setTimeout(() => startEdit(id, true));
      return id;
    }
    // Cards and pictures go in the middle of the view, a step down and right of any already there, so they don't stack.
    function freeSpot(at) {
      let p = { ...at };
      for (let i = 0; i < 20 && [...items.values()].some((x) => Math.abs(x.x + x.w / 2 - p.x) < 12 && Math.abs(x.y + x.h / 2 - p.y) < 12); i++) p = { x: p.x + 28, y: p.y + 28 };
      return p;
    }
    async function addFile(file) {
      try {
        const got = file ? await o.upload(file) : await o.pickFile();
        if (!got) return;
        const f = o.fileInfo(got);
        add('file', freeSpot(middle()), { fileId: got, ...(f && !f.image ? { h: 90 } : {}) });
      } catch (e) { if (e) o.toast(e.message || String(e)); }
    }
    async function addCard() {
      try {
        const ref = await o.pickCard();
        if (ref) add('card', freeSpot(middle()), { ref });
      } catch (e) { if (e) o.toast(e.message || String(e)); }
    }
    // The frame a thing sits in: the top one under its middle.
    function frameAt(x) {
      const cx = x.x + x.w / 2, cy = x.y + x.h / 2;
      let best = null;
      for (const f of items.values()) if (f.kind === 'frame' && f.id !== x.id && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h && (!best || (f.z || 0) > (best.z || 0))) best = f;
      return best ? best.id : null;
    }

    // ----- writing in place -----
    // Plain text only where the browser can; elsewhere ordinary editing (pasting is made plain below).
    const writable = (n) => { try { n.contentEditable = 'plaintext-only'; } catch {} if (n.contentEditable !== 'plaintext-only') n.contentEditable = 'true'; };
    function startEdit(id, fresh = false) {
      const x = items.get(id);
      const n = nodes.get(id);
      if (!x || !n || !['sticky', 'text', 'shape', 'frame'].includes(x.kind)) return;
      if (editing) stopEdit();
      editing = id;
      placeSelbar();
      const t = n.querySelector('.wb-text');
      writable(t);
      n.classList.add('editing');
      t.focus();
      // A click that's still finishing can take the focus back; try once more so typing goes into it, not to shortcuts.
      setTimeout(() => { if (editing === id && document.activeElement !== t) t.focus(); }, 60);
      const r = document.createRange();
      r.selectNodeContents(t);
      if (!fresh) r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      const done = (e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) || (e.key === 'Enter' && x.kind !== 'sticky' && !e.shiftKey)) { e.preventDefault(); stopEdit(); canvas.focus({ preventScroll: true }); }
        e.stopPropagation();
      };
      t.addEventListener('keydown', done);
      t.addEventListener('blur', () => stopEdit(), { once: true });
      t.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').slice(0, 4000)); });
      startEdit.off = () => t.removeEventListener('keydown', done);
    }
    function stopEdit() {
      const id = editing;
      if (!id) return;
      editing = null;
      startEdit.off?.();
      const n = nodes.get(id), x = items.get(id);
      const t = n?.querySelector('.wb-text');
      if (t) t.removeAttribute('contenteditable');
      n?.classList.remove('editing');
      const words = (t?.innerText || '').replace(/\n$/, '').slice(0, 4000);
      // A text box left empty is taken away again, not left behind invisible.
      if (x && x.kind === 'text' && !words.trim() && !(x.text || '').trim()) { change([{ op: 'del', item: id }], { wait: 0 }); select([]); placeSelbar(); return; }
      if (x && words !== (x.text || '')) change([{ op: 'put', item: { id, text: words } }], { wait: 0 });
      else if (x) draw(id);
      placeSelbar();
    }
    function editLabel(lid) {
      const l = links.get(lid);
      if (!l) return;
      selLink = lid;
      drawLinks();
      requestAnimationFrame(() => {
        const lab = labels.get(lid);
        if (!lab) return;
        writable(lab);
        lab.classList.add('editing');
        lab.focus();
        const end = () => {
          lab.removeAttribute('contenteditable');
          lab.classList.remove('editing');
          const v = lab.innerText.trim().slice(0, 120);
          if (links.has(lid) && v !== (links.get(lid).label || '')) change([{ op: 'put', link: { id: lid, label: v } }], { wait: 0 });
          drawLinks();
        };
        lab.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); lab.blur(); } });
        lab.addEventListener('blur', end, { once: true });
      });
    }

    // ----- pointer: pan, pinch, select, move, resize, link -----
    const ptrs = new Map();
    let drag = null, pinch = null, lastTap = { id: null, at: 0 };
    function onDown(e) {
      if (gone || e.button === 2) return;
      if (e.target.closest('.wb-card-open') || (editing && e.target.closest('.wb-item.editing .wb-text')) || e.target.closest('.wb-label.editing')) return;
      if (editing) stopEdit();
      canvas.focus({ preventScroll: true });
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      if (ptrs.size === 2) {
        // Two fingers: pinch to zoom, move to pan; whatever one finger had started stops.
        const [p, q] = [...ptrs.values()];
        if (drag?.kind === 'move' && drag.moved) finishMove(); // keep a move that was under way
        drag = null;
        box.style.display = 'none';
        temp.style.display = 'none';
        pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
        return;
      }
      if (ptrs.size > 2) return;
      const w = toWorld(e.clientX, e.clientY);
      const n = e.target.closest('.wb-item');
      const lab = e.target.closest('.wb-label');
      const hit = e.target.closest('g.wb-link');
      if (space || e.button === 1) { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; return; }
      if ((lab || hit) && !tool) { select([], (lab || hit).dataset.link); drag = { kind: 'none' }; return; }
      if (n && tool === 'arrow') {
        drag = { kind: 'link', from: n.dataset.id };
        return;
      }
      if (n && !tool) {
        const id = n.dataset.id;
        if (e.target.closest('.wb-h')) { const x = items.get(id); drag = { kind: 'resize', id, ids: [id], sx: w.x, sy: w.y, w: x.w, h: x.h, moved: false }; return; }
        if (e.shiftKey || e.metaKey || e.ctrlKey) { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); select([...s]); drag = { kind: 'none' }; return; }
        // A second tap on the same thing writes on it (a double-click, on a phone too).
        const now = Date.now();
        if (lastTap.id === id && now - lastTap.at < 400 && sel.has(id)) { lastTap = { id: null, at: 0 }; drag = { kind: 'none' }; const x = items.get(id); if (x.kind === 'card') o.openCard(x.ref); else startEdit(id); return; }
        lastTap = { id, at: now };
        if (!sel.has(id)) select([id]);
        const ids = withKids([...sel]);
        drag = { kind: 'move', ids, sx: w.x, sy: w.y, start: new Map(ids.map((k) => [k, { x: items.get(k).x, y: items.get(k).y }])), moved: false, sent: 0 };
        return;
      }
      if (tool && tool !== 'arrow') { drag = { kind: 'place', at: w, sx: e.clientX, sy: e.clientY }; return; }
      if (boxMode || e.shiftKey) { drag = { kind: 'box', sx: e.clientX, sy: e.clientY, add: e.shiftKey ? new Set(sel) : new Set() }; return; }
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, tap: true };
    }
    function onMove(e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) {
        const [p, q] = [...ptrs.values()];
        const d = Math.hypot(p.x - q.x, p.y - q.y), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        setView({ ...view, x: view.x + mx - pinch.mx, y: view.y + my - pinch.my });
        if (pinch.d > 0) zoomAt(mx, my, d / pinch.d);
        pinch = { d, mx, my };
        return;
      }
      if (!drag) return;
      const w = toWorld(e.clientX, e.clientY);
      if (drag.kind === 'pan') {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.tap = false;
        setView({ ...view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy });
        root.classList.add('panning');
      } else if (drag.kind === 'move') {
        const dx = Math.round(w.x - drag.sx), dy = Math.round(w.y - drag.sy);
        if (!drag.moved && Math.hypot(dx * view.z, dy * view.z) < 3) return;
        drag.moved = true;
        selbar.style.display = 'none';
        for (const id of drag.ids) { const x = items.get(id), s = drag.start.get(id); if (!x || !s) continue; x.x = s.x + dx; x.y = s.y + dy; draw(id); }
        drawLinks();
        // Others see it move about every 150ms, without each step being its own undo.
        const now = Date.now();
        if (now - drag.sent > 150) { drag.sent = now; sendSoon(drag.ids.filter((id) => items.has(id)).map((id) => ({ op: 'put', item: { id, x: items.get(id).x, y: items.get(id).y } })), 0); }
      } else if (drag.kind === 'resize') {
        const x = items.get(drag.id);
        if (!x) return;
        drag.moved = true;
        x.w = Math.max(40, Math.round(drag.w + w.x - drag.sx));
        x.h = Math.max(30, Math.round(drag.h + w.y - drag.sy));
        if (e.shiftKey && drag.w && drag.h) x.h = Math.round(x.w * (drag.h / drag.w));
        draw(drag.id);
        drawLinks();
      } else if (drag.kind === 'box') {
        const r = rect();
        const a = Math.min(drag.sx, e.clientX) - r.left, b = Math.min(drag.sy, e.clientY) - r.top;
        Object.assign(box.style, { display: '', left: a + 'px', top: b + 'px', width: Math.abs(e.clientX - drag.sx) + 'px', height: Math.abs(e.clientY - drag.sy) + 'px' });
        const p = toWorld(Math.min(drag.sx, e.clientX), Math.min(drag.sy, e.clientY)), q = toWorld(Math.max(drag.sx, e.clientX), Math.max(drag.sy, e.clientY));
        const inside = [...items.values()].filter((x) => x.x < q.x && x.x + x.w > p.x && x.y < q.y && x.y + x.h > p.y && !(x.kind === 'frame' && !(x.x >= p.x && x.y >= p.y && x.x + x.w <= q.x && x.y + x.h <= q.y)));
        select([...new Set([...drag.add, ...inside.map((x) => x.id)])]);
      } else if (drag.kind === 'link') {
        const a = items.get(drag.from);
        if (!a) return;
        Object.assign(temp.style, { display: '' });
        temp.setAttribute('x1', a.x + a.w / 2); temp.setAttribute('y1', a.y + a.h / 2); temp.setAttribute('x2', w.x); temp.setAttribute('y2', w.y);
      }
    }
    function finishMove(d = drag) {
      // Each moved thing lands in the frame under it (or out of one); a frame takes what's in it along.
      const ops = d.ids.filter((id) => items.has(id)).map((id) => { const x = items.get(id); const item = { id, x: x.x, y: x.y }; if (x.kind !== 'frame' && !(x.parentId && d.ids.includes(x.parentId))) item.parentId = frameAt(x); return { op: 'put', item }; });
      // Undo puts them back where they started.
      for (const id of d.ids) { const x = items.get(id), s = d.start.get(id); if (x && s) { x.x = s.x; x.y = s.y; } }
      change(ops, { wait: 0 });
    }
    function onUp(e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      root.classList.remove('panning');
      if (pinch) { if (ptrs.size < 2) pinch = null; drag = null; return; }
      const d = drag;
      drag = null;
      if (!d) return;
      if (d.kind === 'move' && d.moved) finishMove(d);
      else if (d.kind === 'resize' && d.moved) {
        const x = items.get(d.id);
        const now = { w: x.w, h: x.h };
        x.w = d.w; x.h = d.h;
        change([{ op: 'put', item: { id: d.id, ...now } }], { wait: 0 });
      } else if (d.kind === 'box') box.style.display = 'none';
      else if (d.kind === 'place') {
        // A frame dragged out takes the size of the drag; a click drops one of the usual size.
        const w = toWorld(e.clientX, e.clientY);
        if (tool === 'frame' && Math.abs(e.clientX - d.sx) > 20 && Math.abs(e.clientY - d.sy) > 20) {
          const x0 = Math.min(d.at.x, w.x), y0 = Math.min(d.at.y, w.y), fw = Math.round(Math.abs(w.x - d.at.x)), fh = Math.round(Math.abs(w.y - d.at.y));
          add('frame', { x: x0 + fw / 2, y: y0 + fh / 2 }, { x: Math.round(x0), y: Math.round(y0), w: Math.max(80, fw), h: Math.max(60, fh) });
        } else add(tool, d.at);
      }
      else if (d.kind === 'link') {
        temp.style.display = 'none';
        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.wb-item');
        if (under && under.dataset.id !== d.from && root.contains(under)) { connect(d.from, under.dataset.id); tool = null; markTools(); }
      } else if (d.kind === 'pan' && d.tap) select([]);
      placeSelbar();
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', (e) => {
      if (e.target.closest('.wb-item') || e.target.closest('.wb-label')) { const lab = e.target.closest('.wb-label'); if (lab) editLabel(lab.dataset.link); return; }
      const hit = e.target.closest('g.wb-link');
      if (hit) return editLabel(hit.dataset.link);
      add('sticky', toWorld(e.clientX, e.clientY));
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // ⌘/Ctrl (a trackpad pinch sends Ctrl) or a mouse wheel's notches zoom; a trackpad's two-finger scroll pans.
      const mouse = e.deltaMode === 1 || (!e.deltaX && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
      if (e.ctrlKey || e.metaKey || mouse) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)));
      else setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => { if (!e.target.closest('.wb-text[contenteditable="true"], .wb-text[contenteditable="plaintext-only"]')) e.preventDefault(); });
    // Files dropped in become pictures and files on the board.
    canvas.addEventListener('dragover', (e) => { if (o.upload && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); root.classList.add('dropping'); } });
    canvas.addEventListener('dragleave', () => root.classList.remove('dropping'));
    canvas.addEventListener('drop', async (e) => {
      if (!o.upload || !e.dataTransfer?.files?.length) return;
      e.preventDefault();
      root.classList.remove('dropping');
      const at = toWorld(e.clientX, e.clientY);
      let k = 0;
      for (const f of [...e.dataTransfer.files].slice(0, 10)) {
        try { const id = await o.upload(f); if (id) { const fi = o.fileInfo(id); add('file', { x: at.x + k * 30, y: at.y + k * 30 }, { fileId: id, ...(fi && !fi.image ? { h: 90 } : {}) }); k++; } } catch (err) { o.toast(err?.message || 'That file didn’t upload.'); }
      }
    });

    // ----- keys -----
    // On the whole board, so the keys still work after a click on a color, a tool or the zoom bar.
    root.addEventListener('keydown', (e) => {
      if (editing || e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (k === ' ' && !space) { space = true; root.classList.add('can-pan'); e.preventDefault(); return; }
      if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
      if (mod && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
      if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && k.toLowerCase() === 'a') { e.preventDefault(); select([...items.keys()]); return; }
      if (mod && k.toLowerCase() === 'c') { if (copySel()) e.preventDefault(); return; }
      if (mod && k.toLowerCase() === 'v') { if (clip) { e.preventDefault(); paste(); } return; }
      if (mod) return;
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSel(); return; }
      if (k === 'Escape') { tool = null; boxMode = false; markTools(); select([]); return; }
      if (k === 'Enter' && sel.size === 1) { e.preventDefault(); const x = items.get([...sel][0]); if (x?.kind === 'card') o.openCard(x.ref); else startEdit(x.id); return; }
      if (k.startsWith('Arrow') && sel.size) {
        e.preventDefault();
        const step = e.shiftKey ? 50 : 10;
        const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        change(withKids([...sel]).map((id) => ({ op: 'put', item: { id, x: items.get(id).x + dx, y: items.get(id).y + dy } })), { wait: 300 });
        return;
      }
      if (k === '+' || k === '=') { zoomBy(1.25); return; }
      if (k === '-' || k === '_') { zoomBy(1 / 1.25); return; }
      if (k === '!' || (k === '1' && e.shiftKey)) { fit(); return; }
      if (k === '2' && e.shiftKey) { fit([...sel].map((id) => items.get(id)).filter(Boolean)); return; }
      const key = { v: 'select', s: 'sticky', n: 'sticky', t: 'text', r: 'shape', f: 'frame', l: 'arrow' }[k.toLowerCase()];
      if (key) { e.preventDefault(); pickTool(key); }
    });
    root.addEventListener('keyup', (e) => { if (e.key === ' ') { space = false; root.classList.remove('can-pan'); } });
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) { space = false; root.classList.remove('can-pan'); } });
    // The board's own buttons don't take the focus from it (a color button is redrawn the moment it's clicked).
    for (const bar of [selbar, toolbar, zoombar]) bar.addEventListener('mousedown', (e) => { if (!editing) e.preventDefault(); });

    // ----- start -----
    const narrow = () => root.classList.toggle('narrow', root.offsetWidth < 640);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { narrow(); placeSelbar(); }) : null;
    ro?.observe(root);
    drawAll();
    markTools();
    marks();
    requestAnimationFrame(() => {
      narrow();
      const saved = o.viewKey && store(o.viewKey);
      if (saved && Number.isFinite(saved.z)) setView(saved, false); else fit();
    });

    return {
      el: root,
      board: opts.board,
      apply,
      // Everything again (after a reload of the board): what's being dragged or written is lost.
      reset(board) { drag = null; editing = null; items.clear(); links.clear(); for (const x of board.items || []) items.set(x.id, clone(x)); for (const l of board.links || []) links.set(l.id, clone(l)); sel = new Set([...sel].filter((id) => items.has(id))); drawAll(); },
      refresh: () => { for (const x of items.values()) if (x.kind === 'card' || x.kind === 'file') draw(x.id); placeSelbar(); },
      selection: () => [...sel],
      select: (ids) => select(ids.filter((id) => items.has(id))),
      items: () => [...items.values()].map(clone),
      links: () => [...links.values()].map(clone),
      fit: () => fit(),
      // Something made outside (Make tasks…, a phase): put on the board as if made here.
      change: (ops) => change(ops, { wait: 0 }),
      flush,
      destroy() { flush(); gone = true; ro?.disconnect(); root.remove(); },
    };
  }
  return { editor, COLORS };
})();
