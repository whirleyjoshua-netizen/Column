// Docs in Column: a page of blocks you write in, like Notion. Headings, lists, to-dos, toggles, quotes,
// callouts, code, tables, dividers, pictures and files. "/" picks a block, markdown shortcuts work as you type
// (# , - , 1. , [] , > , ``` , ---), blocks drag to reorder, and pasting from Word, Google Docs or a web page
// keeps the shape. The app saves it and keeps it in step with other people (app.js); this file is the page.
// "@" mentions a person, campaign, goal, task or doc; live blocks show a campaign's numbers as they are now (or
// frozen as of a day); a to-do can be a real task.
// A block is { id, type, indent, runs, … } and runs are [{ text, b, i, u, s, code, link, ref }], ref being a
// mention { k, id }. The page is built from elements, never from markup, so nothing pasted or saved can run.
window.ColumnDocs = (() => {
  const TEXT = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'callout', 'code', 'toggle']);
  const MARKS = ['b', 'i', 'u', 's', 'code', 'link', 'ref'];
  const EMOJIS = ['💡', '📌', '⚠️', '✅', '❗', '🔥', 'ℹ️', '📞', '💰', '🎯'];
  const COMMANDS = [
    { type: 'p', label: 'Text', hint: 'Plain writing', keys: 'text paragraph plain' },
    { type: 'h1', label: 'Heading 1', hint: 'Big section heading', keys: 'h1 heading title #' },
    { type: 'h2', label: 'Heading 2', hint: 'Medium heading', keys: 'h2 heading subheading ##' },
    { type: 'h3', label: 'Heading 3', hint: 'Small heading', keys: 'h3 heading ###' },
    { type: 'ul', label: 'Bulleted list', hint: 'A simple list', keys: 'bullet list ul unordered -' },
    { type: 'ol', label: 'Numbered list', hint: '1, 2, 3', keys: 'numbered list ol ordered 1.' },
    { type: 'todo', label: 'To-do list', hint: 'Things to tick off', keys: 'todo to-do checkbox check task []' },
    { type: 'toggle', label: 'Toggle list', hint: 'Hide what’s inside', keys: 'toggle collapse fold' },
    { type: 'quote', label: 'Quote', hint: 'Set a quote apart', keys: 'quote blockquote >' },
    { type: 'callout', label: 'Callout', hint: 'Make it stand out', keys: 'callout note tip warning info' },
    { type: 'code', label: 'Code', hint: 'Monospaced text', keys: 'code snippet ```' },
    { type: 'divider', label: 'Divider', hint: 'A line between sections', keys: 'divider line hr rule ---' },
    { type: 'table', label: 'Table', hint: 'Rows and columns', keys: 'table grid rows columns' },
    { type: 'image', label: 'Image', hint: 'Upload a picture', keys: 'image picture photo img' },
    { type: 'file', label: 'File', hint: 'Attach a file', keys: 'file attachment upload pdf' },
    { type: 'ai', label: 'Write with AI', hint: 'Ask for a section, a list, a summary…', keys: 'ai write draft generate assistant sidekick ✦' },
    { type: 'task', label: 'Task', hint: 'A to-do that’s a real task', keys: 'task assign todo due' },
    { type: 'mention', label: 'Mention', hint: 'A person, campaign, task or doc', keys: 'mention link person page @' },
    { type: 'live:campaign', live: 'campaign', label: 'Campaign summary', hint: 'Progress and goals, kept up to date', keys: 'campaign summary progress live status' },
    { type: 'live:goal', live: 'goal', label: 'Goal progress', hint: 'One goal’s progress bar', keys: 'goal progress live target' },
    { type: 'live:tasks', live: 'tasks', label: 'Task list', hint: 'Open tasks, ticked off as they’re done', keys: 'tasks list live open todo' },
    { type: 'live:calls', live: 'calls', label: 'Call stats', hint: 'Calls and emails logged, by outcome', keys: 'calls stats log attempts outcomes live report' },
    { type: 'live:budgets', live: 'budgets', label: 'Budgets', hint: 'This month against each budget', keys: 'budget money finance spending live' },
    { type: 'live:list', live: 'list', label: 'Call list', hint: 'How far through a list you are', keys: 'call list prospects contacted live' },
    { type: 'live:pipeline', live: 'pipeline', label: 'Pipeline', hint: 'A project’s deals or quotes by stage, with totals', keys: 'pipeline deals quotes bids stages project crm forecast live' },
  ];
  const LIVE_NAME = { campaign: 'Campaign summary', goal: 'Goal progress', tasks: 'Task list', calls: 'Call stats', budgets: 'Budgets', list: 'Call list', pipeline: 'Pipeline' };
  const LABEL = Object.fromEntries(COMMANDS.map((c) => [c.type, c.label]));
  const PH = { p: 'Type “/” for blocks', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', ul: 'List', ol: 'List', todo: 'To-do', toggle: 'Toggle', quote: 'Quote', callout: 'Write something', code: 'Code' };

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
    return e;
  };
  const uid = () => Math.random().toString(36).slice(2, 12);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // The same block always reads the same, whatever order its keys were set in.
  const canon = (x) => (Array.isArray(x) ? '[' + x.map(canon).join(',') + ']' : x && typeof x === 'object' ? '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}' : JSON.stringify(x));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  // ---------- runs ----------
  const refKey = (r) => (r ? r.k + ':' + r.id : '');
  const sameMarks = (a, b) => MARKS.every((k) => (k === 'ref' ? refKey(a.ref) === refKey(b.ref) : (a[k] || undefined) === (b[k] || undefined)));
  function norm(runs) {
    const out = [];
    for (const r of runs) {
      if (!r.text) continue;
      const last = out.at(-1);
      if (last && sameMarks(last, r)) last.text += r.text;
      else out.push({ ...r });
    }
    return out;
  }
  const runsText = (runs) => (runs || []).map((r) => r.text).join('');
  const runsLen = (runs) => runsText(runs).length;
  function sliceRuns(runs, a, b = Infinity) {
    const out = [];
    let at = 0;
    for (const r of runs || []) {
      const end = at + r.text.length;
      const s = Math.max(a, at), e = Math.min(b, end);
      if (e > s) out.push({ ...r, text: r.text.slice(s - at, e - at) });
      at = end;
    }
    return out;
  }
  const joinRuns = (...lists) => norm(lists.flat().map((r) => ({ ...r })));
  function markAll(runs, a, b, key) {
    const part = sliceRuns(runs, a, b);
    return part.length > 0 && part.every((r) => r[key]);
  }
  function setMark(runs, a, b, key, val) {
    const mid = sliceRuns(runs, a, b).map((r) => {
      const x = { ...r };
      if (val) x[key] = val;
      else delete x[key];
      return x;
    });
    return joinRuns(sliceRuns(runs, 0, a), mid, sliceRuns(runs, b));
  }

  // Runs onto the page: each run is its text wrapped in its marks. A line break is a <br>; a break at the very
  // end needs a second one for the empty line to show.
  function drawRuns(runs, into, refInfo) {
    into.replaceChildren();
    for (const r of runs || []) {
      // A mention is one chip, named as the thing is named now.
      if (r.ref) {
        const info = refInfo?.(r.ref);
        into.append(el('span', { class: `dk-ref dk-ref-${r.ref.k}${info?.gone ? ' gone' : ''}`, contenteditable: 'false', 'data-k': r.ref.k, 'data-id': r.ref.id, title: info?.gone ? 'This isn’t in Column any more' : info?.hint || null }, info?.label || r.text));
        continue;
      }
      r.text.split('\n').forEach((part, i) => {
        if (i) into.append(el('br'));
        if (!part) return;
        let n = document.createTextNode(part);
        if (r.code) n = el('code', {}, n);
        if (r.s) n = el('s', {}, n);
        if (r.u) n = el('u', {}, n);
        if (r.i) n = el('i', {}, n);
        if (r.b) n = el('b', {}, n);
        if (r.link) n = el('a', { href: r.link, target: '_blank', rel: 'noopener noreferrer', title: r.link + (isMac ? ' · ⌘-click to open' : ' · Ctrl-click to open') }, n);
        into.append(n);
      });
    }
    if (runsText(runs).endsWith('\n')) into.append(el('br'));
  }
  // Runs back from the page, whatever the browser made of the typing (spans with styles, fonts, stray divs).
  function readRuns(root, plain) {
    const out = [];
    let lastBr = false;
    const walk = (node, m) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          if (n.data) { out.push({ text: n.data, ...m }); lastBr = false; }
          continue;
        }
        if (n.nodeType !== 1) continue;
        const t = n.tagName;
        if (n.classList.contains('dk-ref') && n.dataset.k) {
          out.push({ text: n.textContent, ...m, ref: { k: n.dataset.k, id: n.dataset.id } });
          lastBr = false;
          continue;
        }
        if (t === 'BR') { out.push({ text: '\n', ...m }); lastBr = true; continue; }
        if ((t === 'DIV' || t === 'P') && out.length && !runsText(out).endsWith('\n')) out.push({ text: '\n' });
        const x = { ...m };
        if (!plain) {
          const st = n.style || {};
          const w = st.fontWeight;
          if (t === 'B' || t === 'STRONG' || w === 'bold' || Number(w) >= 600) x.b = true;
          if ((t === 'B' || t === 'STRONG') && (w === 'normal' || Number(w) && Number(w) < 600)) delete x.b;
          if (t === 'I' || t === 'EM' || st.fontStyle === 'italic') x.i = true;
          const deco = (st.textDecorationLine || st.textDecoration || '');
          if (t === 'U' || t === 'INS' || deco.includes('underline')) x.u = true;
          if (t === 'S' || t === 'STRIKE' || t === 'DEL' || deco.includes('line-through')) x.s = true;
          if (t === 'CODE') x.code = true;
          if (t === 'A' && n.getAttribute('href')) x.link = n.getAttribute('href');
        }
        walk(n, x);
      }
    };
    walk(root, {});
    if (lastBr && out.length) {
      const last = out.at(-1);
      last.text = last.text.slice(0, -1);
    }
    const runs = norm(out);
    return plain ? (runs.length ? [{ text: runsText(runs) }] : []) : runs;
  }

  // ---------- caret: a place in a block as a count of characters (a line break is one) ----------
  function pointOffset(root, node, offset) {
    let n = 0;
    let done = false;
    const visit = (x) => {
      if (done) return;
      if (x === node) {
        if (x.nodeType === 3) n += offset;
        else for (let i = 0; i < offset; i++) count(x.childNodes[i]);
        done = true;
        return;
      }
      if (x.nodeType === 3) n += x.data.length;
      else if (x.tagName === 'BR') n += 1;
      else for (const c of x.childNodes) visit(c);
    };
    const count = (x) => {
      if (!x) return;
      if (x.nodeType === 3) n += x.data.length;
      else if (x.tagName === 'BR') n += 1;
      else for (const c of x.childNodes) count(c);
    };
    if (node === root) {
      for (let i = 0; i < offset; i++) count(root.childNodes[i]);
      return n;
    }
    for (const c of root.childNodes) visit(c);
    return n;
  }
  function caretOf(root) {
    const sel = getSelection();
    if (!sel.rangeCount || !root.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
    return { start: pointOffset(root, r.startContainer, r.startOffset), end: pointOffset(root, r.endContainer, r.endOffset) };
  }
  function pointAt(root, want) {
    let left = want;
    let found = null;
    const visit = (x) => {
      if (found) return;
      if (x.nodeType === 3) {
        if (left <= x.data.length) { found = [x, left]; return; }
        left -= x.data.length;
      } else if (x.tagName === 'BR') {
        if (left === 0) { found = [x.parentNode, [...x.parentNode.childNodes].indexOf(x)]; return; }
        left -= 1;
      } else for (const c of x.childNodes) visit(c);
    };
    for (const c of root.childNodes) visit(c);
    return found || [root, root.childNodes.length];
  }
  function setCaret(root, start, end = start) {
    root.focus({ preventScroll: true });
    const sel = getSelection();
    const r = document.createRange();
    const a = pointAt(root, Math.max(0, start));
    const b = end === start ? a : pointAt(root, Math.max(0, end));
    r.setStart(a[0], a[1]);
    r.setEnd(b[0], b[1]);
    sel.removeAllRanges();
    sel.addRange(r);
    const box = (a[0].nodeType === 1 ? a[0] : a[0].parentElement);
    box?.scrollIntoView?.({ block: 'nearest' });
  }
  function caretRect() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0).cloneRange();
    let rect = r.getClientRects()[0];
    if (!rect) {
      const host = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      rect = host?.getBoundingClientRect();
    }
    return rect || null;
  }

  // ---------- reading other formats into blocks ----------
  // **bold**, *italic* or _italic_, `code` and [text](link) inside a line, as runs.
  function inlineMd(text) {
    const out = [];
    const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(((?:https?:|mailto:|tel:)[^\s)]+)\)|(?:^|(?<=[\s(]))[*_]([^*_\s][^*_]*?)[*_](?=[\s.,;:!?)]|$)/g;
    let at = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > at) out.push({ text: text.slice(at, m.index) });
      if (m[1]) out.push({ text: m[1], b: true });
      else if (m[2]) out.push({ text: m[2], code: true });
      else if (m[3]) out.push({ text: m[3], link: m[4] });
      else out.push({ text: m[5], i: true });
      at = m.index + m[0].length;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return norm(out);
  }
  // Plain text, read the way people type it: # headings, - bullets, 1. numbers, [ ] to-dos, > quotes, ``` code.
  function fromText(text) {
    const blocks = [];
    let code = null;
    for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
      if (code) {
        if (/^```/.test(line.trim())) { code = null; continue; }
        code.runs = [{ text: (runsText(code.runs) ? runsText(code.runs) + '\n' : '') + line }];
        continue;
      }
      if (!line.trim()) continue;
      const indent = Math.min(8, Math.floor(line.match(/^ */)[0].length / 2));
      const l = line.trim();
      const add = (type, t, more) => blocks.push({ id: uid(), type, ...(indent && !/^h/.test(type) ? { indent } : {}), runs: t ? inlineMd(t) : [], ...more });
      let m;
      if (/^```/.test(l)) blocks.push((code = { id: uid(), type: 'code', runs: [] }));
      else if (/^(-{3,}|\*{3,})$/.test(l)) blocks.push({ id: uid(), type: 'divider' });
      else if ((m = l.match(/^(#{1,3})\s+(.*)$/))) add('h' + m[1].length, m[2]);
      else if ((m = l.match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/)) || (m = l.match(/^\[([ xX])\]\s*(.*)$/))) add('todo', m[2], m[1].trim() ? { checked: true } : {});
      else if ((m = l.match(/^[-*+•]\s+(.*)$/))) add('ul', m[1]);
      else if ((m = l.match(/^\d+[.)]\s+(.*)$/))) add('ol', m[1]);
      else if ((m = l.match(/^>\s?(.*)$/))) add('quote', m[1]);
      else add('p', l);
    }
    return blocks;
  }
  // HTML from Word, Google Docs or a web page: paragraphs, headings, lists (nested ones indented), to-dos,
  // quotes, code, tables and dividers, with bold, italic, underline, strikethrough, code and links.
  function fromHtml(html) {
    const src = new DOMParser().parseFromString(html, 'text/html').body;
    const SKIP = /^(SCRIPT|STYLE|META|LINK|TITLE|HEAD|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|IMG|PICTURE|VIDEO|AUDIO|CANVAS|INPUT|BUTTON|SELECT|TEXTAREA|NOSCRIPT|FORM)$/;
    const BLOCK = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|HR|FIGURE|DL|DT|DD)$/;
    const blocks = [];
    const tidy = (runs) => {
      const r = norm(runs.map((x) => ({ ...x, text: x.text.replace(/[ \t\r\n ]+/g, ' ') })));
      if (r[0]) r[0].text = r[0].text.replace(/^ +/, '');
      if (r.at(-1)) r.at(-1).text = r.at(-1).text.replace(/ +$/, '');
      return norm(r);
    };
    const inline = (node, m, out) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { out.push({ text: n.data, ...m }); continue; }
        if (n.nodeType !== 1 || SKIP.test(n.tagName)) continue;
        if (n.classList.contains('dk-ref') && n.dataset.k && n.dataset.id) { out.push({ text: n.textContent, ...m, ref: { k: n.dataset.k, id: n.dataset.id } }); continue; }
        if (n.tagName === 'BR') { out.push({ text: ' ' }); continue; }
        if (n.tagName === 'UL' || n.tagName === 'OL') continue;
        const x = { ...m };
        const st = n.style || {};
        const w = st.fontWeight;
        if (/^(B|STRONG)$/.test(n.tagName) || w === 'bold' || Number(w) >= 600) x.b = true;
        if (/^(B|STRONG)$/.test(n.tagName) && (w === 'normal' || (Number(w) && Number(w) < 600))) delete x.b;
        if (/^(I|EM)$/.test(n.tagName) || st.fontStyle === 'italic') x.i = true;
        const deco = st.textDecorationLine || st.textDecoration || '';
        if (n.tagName === 'U' || deco.includes('underline')) x.u = true;
        if (/^(S|STRIKE|DEL)$/.test(n.tagName) || deco.includes('line-through')) x.s = true;
        if (/^(CODE|KBD|SAMP)$/.test(n.tagName)) x.code = true;
        const href = n.tagName === 'A' && n.getAttribute('href');
        if (href && /^(https?:|mailto:|tel:)/i.test(href)) { x.link = href; delete x.u; }
        inline(n, x, out);
      }
      return out;
    };
    const push = (type, runs, more = {}) => {
      if (blocks.length >= 2000) return;
      const r = tidy(runs);
      if (!r.length && type !== 'divider' && type !== 'table' && type !== 'code') return;
      blocks.push({ id: uid(), type, runs: r, ...more });
    };
    const walk = (node, indent) => {
      let loose = [];
      const flush = () => {
        if (loose.length) push('p', loose, indent ? { indent } : {});
        loose = [];
      };
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { loose.push({ text: n.data }); continue; }
        if (n.nodeType !== 1 || SKIP.test(n.tagName)) continue;
        const t = n.tagName;
        if (!BLOCK.test(t)) {
          if (t === 'BR') flush();
          // An inline wrapper around whole paragraphs (Google Docs puts everything in one <b>) is read as a container.
          else if (n.querySelector('p, div, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, table, hr')) { flush(); walk(n, indent); }
          else inline(el('span', {}, n.cloneNode(true)), {}, loose);
          continue;
        }
        flush();
        if (/^H[1-6]$/.test(t)) push(t === 'H1' ? 'h1' : t === 'H2' ? 'h2' : 'h3', inline(n, {}, []));
        else if (t === 'UL' || t === 'OL') {
          for (const li of n.children) {
            if (li.tagName === 'UL' || li.tagName === 'OL') { walk(el('div', {}, li.cloneNode(true)), indent + 1); continue; }
            if (li.tagName !== 'LI') continue;
            const box = li.querySelector(':scope > input[type=checkbox], :scope > * > input[type=checkbox]');
            const type = box ? 'todo' : t === 'OL' ? 'ol' : 'ul';
            const lead = [...li.childNodes].filter((c) => !(c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')));
            const runs = [];
            for (const c of lead) {
              if (c.nodeType === 3) runs.push({ text: c.data });
              else if (c.nodeType === 1 && !SKIP.test(c.tagName)) inline(el('span', {}, c.cloneNode(true)), {}, runs);
            }
            push(type, runs, { ...(indent ? { indent: Math.min(8, indent) } : {}), ...(box?.checked || box?.hasAttribute('checked') ? { checked: true } : {}) });
            for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') walk(el('div', {}, sub.cloneNode(true)), indent + 1);
          }
        } else if (t === 'BLOCKQUOTE') push('quote', inline(n, {}, []));
        else if (t === 'PRE') blocks.push({ id: uid(), type: 'code', runs: n.textContent ? [{ text: n.textContent.replace(/\n$/, '') }] : [] });
        else if (t === 'HR') blocks.push({ id: uid(), type: 'divider' });
        else if (t === 'TABLE') {
          const rows = [...n.rows].slice(0, 100).map((r) => [...r.cells].slice(0, 20).map((c) => tidy(inline(c, {}, []))));
          if (rows.length) {
            const cols = Math.max(...rows.map((r) => r.length));
            blocks.push({ id: uid(), type: 'table', rows: rows.map((r) => [...r, ...Array(cols - r.length).fill([])]), ...(n.querySelector('th') ? { header: true } : {}) });
          }
        } else walk(n, indent);
      }
      flush();
    };
    walk(src, 0);
    return blocks;
  }

  // ---------- writing blocks out ----------
  // As plain text: # headings, - bullets, [ ] to-dos.
  function toText(blocks) {
    const n = {};
    return blocks.map((b) => {
      const pad = '  '.repeat(b.indent || 0);
      const t = runsText(b.runs);
      n[b.indent || 0] = b.type === 'ol' ? (n[b.indent || 0] || 0) + 1 : 0;
      if (/^h[1-3]$/.test(b.type)) return '#'.repeat(Number(b.type[1])) + ' ' + t;
      if (b.type === 'ul' || b.type === 'toggle') return pad + '- ' + t;
      if (b.type === 'ol') return `${pad}${n[b.indent || 0]}. ${t}`;
      if (b.type === 'todo') return `${pad}[${b.checked ? 'x' : ' '}] ${t}`;
      if (b.type === 'quote') return pad + '> ' + t;
      if (b.type === 'callout') return `${pad}${b.emoji || ''} ${t}`;
      if (b.type === 'code') return '```\n' + t + '\n```';
      if (b.type === 'divider') return '---';
      if (b.type === 'table') return b.rows.map((r) => '| ' + r.map(runsText).join(' | ') + ' |').join('\n');
      if (b.type === 'file') return `[${b.name || 'File'}]`;
      if (b.type === 'live') return `[${LIVE_NAME[b.source]}]`;
      return pad + t;
    }).join('\n');
  }
  // As HTML elements (for the clipboard, and for Word). shift moves headings down a level, for a page whose
  // title is the top heading. live(b) gives a live block's numbers as lines of text; pics maps a file's id to
  // { src, w, h } for pictures to put in (Word).
  function toHtml(blocks, { shift = 0, files, live, pics } = {}) {
    const root = el('div');
    const stack = [{ indent: -1, into: root }];
    const runsEl = (runs, into) => { drawRuns(runs, into); into.querySelectorAll('a').forEach((a) => { a.removeAttribute('title'); a.removeAttribute('target'); a.removeAttribute('rel'); }); return into; };
    for (const b of blocks) {
      const indent = b.indent || 0;
      const listy = b.type === 'ul' || b.type === 'ol' || b.type === 'todo' || b.type === 'toggle';
      while (stack.length > 1 && (stack.at(-1).indent > indent || (stack.at(-1).indent === indent && (!listy || stack.at(-1).tag !== (b.type === 'ol' ? 'OL' : 'UL'))))) stack.pop();
      if (listy) {
        const tag = b.type === 'ol' ? 'OL' : 'UL';
        let top = stack.at(-1);
        if (top.indent !== indent || top.tag !== tag) {
          const list = el(tag.toLowerCase());
          (top.li || top.into).append(list);
          top = { indent, tag, into: list };
          stack.push(top);
        }
        const li = runsEl(b.type === 'todo' ? [{ text: b.checked ? '☑ ' : '☐ ' }, ...(b.runs || [])] : b.runs, el('li'));
        top.into.append(li);
        top.li = li;
        continue;
      }
      const into = stack.at(-1).li || root;
      const hx = (n) => 'h' + Math.min(6, n + shift);
      if (/^h[1-3]$/.test(b.type)) root.append(runsEl(b.runs, el(hx(Number(b.type[1])))));
      else if (b.type === 'quote') into.append(runsEl(b.runs, el('blockquote')));
      else if (b.type === 'callout') into.append(runsEl([{ text: (b.emoji || '') + ' ' }, ...(b.runs || [])], el('p')));
      else if (b.type === 'code') into.append(el('pre', {}, runsText(b.runs)));
      else if (b.type === 'divider') into.append(el('hr'));
      else if (b.type === 'table') {
        into.append(el('table', {}, el('tbody', {}, b.rows.map((r, i) => el('tr', {}, r.map((c) => runsEl(c, el(i === 0 && b.header ? 'th' : 'td'))))))));
      } else if (b.type === 'file') {
        const f = files?.(b.itemId);
        const pic = pics?.get(b.itemId);
        into.append(pic ? el('p', {}, el('img', { src: pic.src, 'data-w': pic.w, 'data-h': pic.h, alt: b.name || '' }))
          : el('p', {}, f?.url ? el('a', { href: f.url }, b.name || f.name || 'File') : `[${b.name || 'File'}]`));
      } else if (b.type === 'live') {
        const lines = live?.(b) || [LIVE_NAME[b.source]];
        into.append(el('p', {}, el('b', {}, lines[0])), ...lines.slice(1).map((l) => el('p', {}, l)));
      } else into.append(runsEl(b.runs, el('p')));
    }
    return root;
  }
  // As the blocks Column's PDF writer takes. Pictures come in as PNG or JPEG data URLs from pics(itemId).
  async function toPdf(title, blocks, pics, live) {
    const out = [];
    const runs = (rs) => (rs || []).map((r) => ({ text: r.text, ...(r.b ? { b: true } : {}), ...(r.i ? { i: true } : {}), ...(r.u ? { u: true } : {}), ...(r.s ? { s: true } : {}), ...(r.link ? { link: true } : {}) }));
    if (title) out.push({ t: 'h1', runs: [{ text: title, b: true }] });
    const n = {};
    for (const b of blocks) {
      const lvl = b.indent || 0;
      n[lvl] = b.type === 'ol' ? (n[lvl] || 0) + 1 : 0;
      if (/^h[1-3]$/.test(b.type)) out.push({ t: 'h' + (Number(b.type[1]) + 1), runs: runs(b.runs) });
      else if (b.type === 'ul' || b.type === 'toggle') out.push({ t: 'li', ordered: false, n: 1, lvl, runs: runs(b.runs) });
      else if (b.type === 'ol') out.push({ t: 'li', ordered: true, n: n[lvl], lvl, runs: runs(b.runs) });
      else if (b.type === 'todo') out.push({ t: 'li', ordered: false, n: 1, lvl, runs: [{ text: b.checked ? '[x] ' : '[ ] ' }, ...runs(b.runs)] });
      else if (b.type === 'quote') out.push({ t: 'p', runs: runs(b.runs).map((r) => ({ ...r, i: true })) });
      else if (b.type === 'divider') out.push({ t: 'p', runs: [{ text: ' ' }] });
      else if (b.type === 'live') {
        const lines = live?.(b) || [LIVE_NAME[b.source]];
        out.push({ t: 'p', runs: [{ text: lines[0], b: true }] }, ...lines.slice(1).map((l) => ({ t: 'li', ordered: false, n: 1, lvl: 0, runs: [{ text: l }] })));
      }
      else if (b.type === 'table') out.push({ t: 'table', rows: b.rows.map((r, i) => r.map((c) => [{ t: 'p', runs: runs(c).map((x) => (i === 0 && b.header ? { ...x, b: true } : x)) }])) });
      else if (b.type === 'file') {
        const pic = await pics?.(b.itemId);
        if (pic) out.push({ t: 'img', src: pic.src, w: pic.w, h: pic.h });
        else out.push({ t: 'p', runs: [{ text: `[${b.name || 'File'}]`, i: true }] });
      } else out.push({ t: 'p', runs: runs(b.runs) });
    }
    return out;
  }

  // ---------- changes between two versions of a doc ----------
  // What turns `prev` into `next`: blocks set (new or changed, each after the block it follows) and deleted,
  // and the whole order when blocks moved.
  function diff(prev, next) {
    const before = new Map(prev.map((b) => [b.id, canon(b)]));
    const ids = new Set(next.map((b) => b.id));
    const ops = [];
    next.forEach((b, i) => {
      if (before.get(b.id) !== canon(b)) ops.push({ set: clone(b), after: i ? next[i - 1].id : null });
    });
    for (const b of prev) if (!ids.has(b.id)) ops.push({ del: b.id });
    const kept = prev.filter((b) => ids.has(b.id)).map((b) => b.id);
    const now = next.filter((b) => before.has(b.id)).map((b) => b.id);
    const moved = kept.join() !== now.join();
    return { ops, order: moved ? next.map((b) => b.id) : null };
  }
  // The same as the server does it.
  function order(blocks, ids) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const out = [...new Set(ids)].filter((id) => byId.has(id)).map((id) => byId.get(id));
    const placed = new Set(out.map((b) => b.id));
    blocks.forEach((b, i) => {
      if (placed.has(b.id)) return;
      const before = blocks.slice(0, i).reverse().find((y) => placed.has(y.id));
      out.splice(before ? out.indexOf(before) + 1 : 0, 0, b);
      placed.add(b.id);
    });
    return out;
  }
  function apply(blocks, ops, ids) {
    let out = blocks.slice();
    for (const op of ops || []) {
      if (op.del) out = out.filter((b) => b.id !== op.del);
      else if (op.set) {
        const i = out.findIndex((b) => b.id === op.set.id);
        if (i >= 0) out[i] = clone(op.set);
        else out.splice((op.after ? out.findIndex((b) => b.id === op.after) : -1) + 1, 0, clone(op.set));
      }
    }
    return ids ? order(out, ids) : out;
  }

  // ---------- the editor ----------
  // opts: { title, blocks, onChange(), upload(files) → [{ itemId, name }], fileInfo(itemId) → { name, url, image,
  // size } | null, openFile(itemId), menu(anchor, rows), toast(text) }
  function editor(opts) {
    const S = { blocks: clone(opts.blocks || []), title: opts.title || '', sel: [], anchor: null, undo: [], redo: [], typing: null, slash: null, composing: false, uploads: 0, focus: null, autoTask: new Set(), ro: !!opts.readOnly };
    const draw = (runs, into) => drawRuns(runs, into, opts.refInfo);
    const titleEl = el('div', { class: 'dk-title', contenteditable: 'true', 'data-ph': 'Untitled', spellcheck: 'true', role: 'textbox', 'aria-label': 'Title' });
    titleEl.textContent = S.title;
    const body = el('div', { class: 'dk-body' });
    const tail = el('div', { class: 'dk-tail', title: 'Click to add a block' });
    const status = el('div', { class: 'dk-status' });
    const root = el('div', { class: 'dk', tabindex: '-1' }, titleEl, body, tail, status);
    const slashEl = el('div', { class: 'dk-pop dk-slash hidden', role: 'listbox' });
    const barEl = el('div', { class: 'dk-pop dk-bar hidden' });
    const filePick = el('input', { type: 'file', class: 'hidden', multiple: true });
    document.body.append(slashEl, barEl);
    root.append(filePick);
    const touch = matchMedia('(hover: none)').matches;

    const byId = (id) => S.blocks.find((b) => b.id === id);
    const idx = (id) => S.blocks.findIndex((b) => b.id === id);
    const rowOf = (id) => body.querySelector(`.dk-row[data-id="${CSS.escape(id)}"]`);
    const textOf = (id) => rowOf(id)?.querySelector('.dk-text');
    const changed = () => opts.onChange?.();
    const childrenEnd = (i) => {
      const lvl = S.blocks[i].indent || 0;
      let j = i + 1;
      while (j < S.blocks.length && (S.blocks[j].indent || 0) > lvl) j++;
      return j;
    };

    // ----- history: whole-doc snapshots; typing in one block counts as one step until you pause -----
    const where = () => {
      const a = document.activeElement;
      const row = a?.closest?.('.dk-row');
      if (!row || !root.contains(row)) return S.sel.length ? { sel: S.sel.slice() } : null;
      const cell = a.closest('.dk-cell');
      const c = caretOf(a) || { start: 0, end: 0 };
      return { id: row.dataset.id, cell: cell ? [Number(cell.dataset.r), Number(cell.dataset.c)] : null, ...c };
    };
    function snap() {
      S.undo.push({ blocks: clone(S.blocks), title: S.title, at: where() });
      if (S.undo.length > 150) S.undo.shift();
      S.redo = [];
      S.typing = null;
    }
    function typingSnap(id) {
      const now = Date.now();
      if (S.typing?.id === id && now - S.typing.at < 1200) { S.typing.at = now; return; }
      snap();
      S.typing = { id, at: now };
    }
    function restore(from, to) {
      const s = from.pop();
      if (!s) return;
      to.push({ blocks: clone(S.blocks), title: S.title, at: where() });
      S.blocks = s.blocks;
      S.title = s.title;
      titleEl.textContent = S.title;
      S.typing = null;
      render();
      if (s.at?.sel) select(s.at.sel);
      else if (s.at && byId(s.at.id)) focus(s.at.id, s.at.start, s.at.end, s.at.cell);
      else root.focus({ preventScroll: true }); // so the next ⌘Z still reaches the doc
      changed();
    }
    const undo = () => restore(S.undo, S.redo);
    const redo = () => restore(S.redo, S.undo);

    // ----- drawing -----
    function render() {
      closeSlash();
      const nums = [];
      const hide = [];
      let hideAt = null;
      const last = [];
      for (const b of S.blocks) {
        const lvl = b.indent || 0;
        last.length = lvl + 1;
        nums.push(b.type === 'ol' ? (last[lvl]?.type === 'ol' ? last[lvl].n + 1 : 1) : 0);
        last[lvl] = { type: b.type, n: nums.at(-1) };
        if (hideAt != null && lvl > hideAt) { hide.push(true); continue; }
        hideAt = null;
        hide.push(false);
        if (b.type === 'toggle' && b.closed) hideAt = lvl;
      }
      body.replaceChildren(...S.blocks.map((b, i) => (hide[i] ? null : row(b, nums[i]))).filter(Boolean));
      for (const id of S.sel) rowOf(id)?.classList.add('dk-selected');
      drawDraft();
    }
    function editable(b, cls, plain) {
      const e = el(plain ? 'pre' : 'div', { class: 'dk-text ' + cls, contenteditable: S.ro ? 'false' : 'true', 'data-ph': S.ro ? '' : PH[b.type] || '', spellcheck: plain ? 'false' : 'true' });
      // Code takes plain text only, where the browser can do that.
      if (plain && !S.ro) {
        try {
          e.contentEditable = 'plaintext-only';
        } catch {
          e.contentEditable = 'true';
        }
      }
      draw(b.runs, e);
      return e;
    }
    // A to-do that's a task is ticked when the task is done.
    const isDone = (b) => (b.taskId && opts.task?.(b.taskId) ? !!opts.task(b.taskId).done : !!b.checked);
    function row(b, num) {
      const r = el('div', { class: `dk-row dk-${b.type}${b.type === 'todo' && isDone(b) ? ' dk-done' : ''}${b.taskId ? ' dk-tasked' : ''}`, 'data-id': b.id, style: `--in:${b.indent || 0}` });
      r.append(el('div', { class: 'dk-handle', contenteditable: 'false' },
        el('button', { class: 'dk-add', type: 'button', title: 'Add a block below', 'aria-label': 'Add a block below', tabindex: '-1' }, '+'),
        el('button', { class: 'dk-grip', type: 'button', title: 'Drag to move · click for options', 'aria-label': 'Block options', tabindex: '-1' }, '⋮⋮')));
      r.append(...rowMarks(b));
      if (b.type === 'divider') r.append(el('div', { class: 'dk-hr' }, el('hr')));
      else if (b.type === 'live') r.append(liveEl(b));
      else if (b.type === 'file') r.append(fileEl(b));
      else if (b.type === 'table') r.append(tableEl(b));
      else {
        const lead = b.type === 'ul' ? el('span', { class: 'dk-lead dk-bullet', contenteditable: 'false' }, ['•', '◦', '▪'][(b.indent || 0) % 3])
          : b.type === 'ol' ? el('span', { class: 'dk-lead dk-num', contenteditable: 'false' }, num + '.')
          : b.type === 'todo' ? el('span', { class: 'dk-lead', contenteditable: 'false' }, el('button', { class: 'dk-check' + (isDone(b) ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': String(isDone(b)), 'aria-label': 'Done', tabindex: '-1' }))
          : b.type === 'toggle' ? el('span', { class: 'dk-lead', contenteditable: 'false' }, el('button', { class: 'dk-arrow' + (b.closed ? '' : ' open'), type: 'button', 'aria-label': b.closed ? 'Open' : 'Close', 'aria-expanded': String(!b.closed), tabindex: '-1' }, '▸'))
          : b.type === 'callout' ? el('span', { class: 'dk-lead', contenteditable: 'false' }, el('button', { class: 'dk-emoji', type: 'button', title: 'Change the icon', tabindex: '-1' }, b.emoji || '💡'))
          : null;
        r.append(el('div', { class: 'dk-line' }, lead, editable(b, 'dk-' + b.type + '-t', b.type === 'code'), taskBits(b)));
      }
      return r;
    }
    // Beside a block: its comments, and who else is in it.
    function rowMarks(b) {
      const out = [];
      const n = opts.commentCount?.(b.id) || 0;
      if (n) out.push(el('button', { class: 'dk-cmt', type: 'button', contenteditable: 'false', tabindex: '-1', title: `${n} comment${n === 1 ? '' : 's'}`, 'data-cmt': b.id }, '💬 ' + n));
      const here = (opts.here?.() || []).filter((p) => p.block === b.id);
      if (here.length) out.push(el('span', { class: 'dk-here', contenteditable: 'false', title: here.map((p) => p.name).join(', ') + ' here' }, here.map((p) => el('i', { style: `--h:${p.hue}` }, p.name[0].toUpperCase()))));
      return out;
    }
    // A task's due date and who it's for, beside its to-do.
    function taskBits(b) {
      if (b.type !== 'todo' || !b.taskId) return null;
      const bits = opts.taskChips?.(b);
      return el('span', { class: 'dk-task-bits', contenteditable: 'false' }, bits || el('small', { class: 'dk-task-gone' }, 'task deleted'));
    }
    function liveEl(b) {
      let shown;
      try {
        shown = opts.live?.(b);
      } catch {
        shown = null;
      }
      const when = b.snap ? new Date(b.snap.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(b.snap.at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : null;
      return el('div', { class: 'dk-lv' + (b.snap ? ' snap' : ''), contenteditable: 'false' },
        el('div', { class: 'dk-live-h' },
          el('span', { class: 'dk-live-tag', title: b.snap ? 'Numbers as they were that day. The block menu updates them.' : 'Always shows the numbers as they are now' }, b.snap ? 'As of ' + when : '● Live'),
          el('b', {}, shown?.title || LIVE_NAME[b.source])),
        el('div', { class: 'dk-live-body' }, shown?.body || el('p', { class: 'dk-live-none' }, 'Nothing to show.')));
    }
    function fileEl(b) {
      const f = opts.fileInfo?.(b.itemId);
      if (!f) return el('div', { class: 'dk-file gone' }, `${b.name || 'A file'} isn’t here any more`);
      if (f.image) return el('figure', { class: 'dk-figure' }, el('img', { src: f.url, alt: f.name || '', loading: 'lazy', draggable: 'false' }), el('figcaption', {}, f.name));
      return el('div', { class: 'dk-file', role: 'button', tabindex: '0' }, el('span', { class: 'dk-file-ic' }, '📎'), el('span', { class: 'dk-file-n' }, f.name || b.name), f.size ? el('small', {}, f.size) : null);
    }
    function tableEl(b) {
      const t = el('table', { class: 'dk-table' + (b.header ? ' head' : '') });
      b.rows.forEach((rw, r) => t.append(el('tr', {}, rw.map((c, i) => {
        const cell = el('div', { class: 'dk-text dk-cell', contenteditable: S.ro ? 'false' : 'true', 'data-r': r, 'data-c': i, spellcheck: 'true' });
        draw(c, cell);
        return el(r === 0 && b.header ? 'th' : 'td', {}, cell);
      }))));
      return el('div', { class: 'dk-table-wrap' }, t,
        el('button', { class: 'dk-tbl-add dk-tbl-row', type: 'button', title: 'Add a row', tabindex: '-1' }, '+'),
        el('button', { class: 'dk-tbl-add dk-tbl-col', type: 'button', title: 'Add a column', tabindex: '-1' }, '+'));
    }

    // Puts the caret in a block: at a character, 'end', or in a table cell.
    function focus(id, start = 0, end = start, cell) {
      clearSel();
      const r = rowOf(id);
      if (!r) return;
      const b = byId(id);
      if (b?.type === 'table') {
        const [cr, cc] = cell || [0, 0];
        const ed = r.querySelector(`.dk-cell[data-r="${cr}"][data-c="${cc}"]`) || r.querySelector('.dk-cell');
        if (ed) setCaret(ed, start === 'end' ? runsLen(b.rows[cr]?.[cc]) : start, end === 'end' ? runsLen(b.rows[cr]?.[cc]) : end);
        return;
      }
      const ed = r.querySelector('.dk-text');
      if (!ed) return select([id]);
      const len = runsLen(b.runs);
      setCaret(ed, start === 'end' ? len : Math.min(start, len), end === 'end' ? len : Math.min(end, len));
    }

    // ----- block selection: Esc, dragging across blocks, or the handle -----
    function select(ids, anchor) {
      document.activeElement?.blur?.();
      getSelection().removeAllRanges();
      body.querySelectorAll('.dk-selected').forEach((x) => x.classList.remove('dk-selected'));
      S.sel = ids.filter((id) => byId(id));
      S.anchor = anchor ?? S.sel[0] ?? null;
      for (const id of S.sel) rowOf(id)?.classList.add('dk-selected');
      if (S.sel.length) {
        root.focus({ preventScroll: true });
        rowOf(S.sel.at(-1))?.scrollIntoView({ block: 'nearest' });
      }
      hideBar();
    }
    function clearSel() {
      if (!S.sel.length) return;
      S.sel = [];
      body.querySelectorAll('.dk-selected').forEach((x) => x.classList.remove('dk-selected'));
    }
    const visibleIds = () => [...body.querySelectorAll('.dk-row')].map((r) => r.dataset.id);
    const range = (a, b) => {
      const ids = visibleIds();
      const i = ids.indexOf(a), j = ids.indexOf(b);
      return i < 0 || j < 0 ? [] : ids.slice(Math.min(i, j), Math.max(i, j) + 1);
    };
    // What moves or goes with a block: it and everything indented under it.
    function withChildren(ids) {
      const out = new Set();
      for (const id of ids) {
        const i = idx(id);
        if (i < 0) continue;
        for (let j = i; j < childrenEnd(i); j++) out.add(S.blocks[j].id);
      }
      return S.blocks.filter((b) => out.has(b.id)).map((b) => b.id);
    }

    // ----- changes -----
    const newBlock = (type = 'p', more = {}) => ({ id: uid(), type, ...(TEXT.has(type) ? { runs: [] } : {}), ...(type === 'callout' ? { emoji: '💡' } : {}), ...(type === 'table' ? { rows: [[[], [], []], [[], [], []]], header: true } : {}), ...more });
    function insertAfter(id, blocks) {
      const i = id ? idx(id) : -1;
      S.blocks.splice(i + 1, 0, ...blocks);
    }
    function setType(b, type) {
      if (!TEXT.has(b.type) || !TEXT.has(type)) return;
      b.type = type;
      if (type !== 'todo') { delete b.checked; delete b.taskId; S.autoTask.delete(b.id); }
      if (type !== 'toggle') delete b.closed;
      if (type === 'callout') b.emoji ||= '💡';
      else delete b.emoji;
      if (type === 'code') b.runs = runsText(b.runs) ? [{ text: runsText(b.runs) }] : [];
      else delete b.lang;
      if (/^h[1-3]$/.test(type)) delete b.indent;
    }
    function removeBlocks(ids) {
      const set = new Set(ids);
      const first = S.blocks.findIndex((b) => set.has(b.id));
      S.blocks = S.blocks.filter((b) => !set.has(b.id));
      if (!S.blocks.length) S.blocks.push(newBlock());
      return Math.max(0, first - 1);
    }
    function indent(ids, d) {
      for (const id of ids) {
        const i = idx(id);
        const b = S.blocks[i];
        if (!b || /^h[1-3]$/.test(b.type)) continue;
        const max = i ? (S.blocks[i - 1].indent || 0) + 1 : 0;
        const to = Math.max(0, Math.min(8, max, (b.indent || 0) + d));
        if (to) b.indent = to;
        else delete b.indent;
      }
    }
    function move(ids, d) {
      const set = new Set(withChildren(ids));
      const group = S.blocks.filter((b) => set.has(b.id));
      const rest = S.blocks.filter((b) => !set.has(b.id));
      const first = S.blocks.findIndex((b) => set.has(b.id));
      // Step over the whole neighbouring block, children and all.
      let at = first;
      if (d < 0) {
        if (first === 0) return;
        let j = first - 1;
        const lvl = group[0].indent || 0;
        while (j > 0 && (S.blocks[j].indent || 0) > lvl) j--;
        at = rest.indexOf(S.blocks[j]);
      } else {
        const after = rest[at];
        if (!after) return;
        let end = at + 1;
        while (end < rest.length && (rest[end].indent || 0) > (after.indent || 0)) end++;
        at = end;
      }
      rest.splice(at, 0, ...group);
      S.blocks = rest;
    }
    function duplicate(ids) {
      const all = withChildren(ids);
      const copies = all.map((id) => ({ ...clone(byId(id)), id: uid() }));
      insertAfter(all.at(-1), copies);
      return copies;
    }

    // ----- typing -----
    function onInput(e) {
      const ed = e.target.closest?.('.dk-text');
      if (!ed) return;
      const id = ed.closest('.dk-row').dataset.id;
      const b = byId(id);
      if (!b) return;
      if (ed.classList.contains('dk-cell')) b.rows[Number(ed.dataset.r)][Number(ed.dataset.c)] = readRuns(ed);
      else {
        b.runs = readRuns(ed, b.type === 'code');
        if (!runsLen(b.runs) && ed.childNodes.length) ed.replaceChildren();
        if (S.slash?.id === id) updateSlash(ed, b);
        else if (e.inputType === 'insertText' && (e.data === '/' || (e.data === '@' && opts.mentions)) && b.type !== 'code') {
          const c = caretOf(ed);
          const before = runsText(b.runs).slice(0, c ? c.start - 1 : 0);
          if (c && (!before || /\s$/.test(before))) openSlash(id, c.start - 1, e.data === '@' ? 'at' : 'slash');
        }
      }
      changed();
    }
    function onBeforeInput(e) {
      if (S.ro) return e.preventDefault();
      if (e.inputType === 'historyUndo') { e.preventDefault(); return undo(); }
      if (e.inputType === 'historyRedo') { e.preventDefault(); return redo(); }
      const ed = e.target.closest?.('.dk-text');
      if (!ed) return;
      const id = ed.closest('.dk-row').dataset.id;
      const b = byId(id);
      if (!b) return;
      typingSnap(id);
      if (ed.classList.contains('dk-cell') || e.inputType !== 'insertText' || S.composing) return;
      const c = caretOf(ed);
      if (!c || c.start !== c.end) return;
      const before = runsText(b.runs).slice(0, c.start);
      // Markdown as you type, at the start of a line of text.
      if (b.type !== 'code') {
        let to = null, more = {};
        if (e.data === ' ' && b.type === 'p') {
          to = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'ul', '*': 'ul', '+': 'ul', '1.': 'ol', '1)': 'ol', '[]': 'todo', '[ ]': 'todo', '[x]': 'todo', '>': 'quote' }[before] || null;
          if (before === '[x]') more.checked = true;
        }
        if (e.data === '`' && before === '``' && b.type === 'p') to = 'code';
        if (e.data === '-' && before === '--' && runsText(b.runs) === '--' && b.type === 'p') {
          e.preventDefault();
          b.type = 'divider';
          delete b.runs;
          const next = newBlock('p', b.indent ? { indent: b.indent } : {});
          insertAfter(id, [next]);
          render();
          focus(next.id);
          return changed();
        }
        if (to) {
          e.preventDefault();
          b.runs = sliceRuns(b.runs, c.start);
          setType(b, to);
          Object.assign(b, more);
          render();
          focus(id, 0);
          return changed();
        }
      }
    }
    // Enter: a new block after this one, carrying what's after the caret.
    function enter(b, ed, c) {
      snap();
      const len = runsLen(b.runs);
      const listy = ['ul', 'ol', 'todo', 'toggle'].includes(b.type);
      if (!len && (listy || b.type === 'quote' || b.type === 'callout')) {
        if (b.indent) indent([b.id], -1);
        else setType(b, 'p');
        render();
        focus(b.id, 0);
        return changed();
      }
      if (c.start === 0 && c.end === 0 && len) {
        const before = newBlock(listy ? b.type : 'p', b.indent ? { indent: b.indent } : {});
        S.blocks.splice(idx(b.id), 0, before);
        render();
        focus(b.id, 0);
        return changed();
      }
      const after = sliceRuns(b.runs, c.end);
      b.runs = sliceRuns(b.runs, 0, c.start);
      let type = listy ? b.type : 'p';
      let lvl = b.indent || 0;
      let at = b.id;
      if (b.type === 'toggle') {
        if (!b.closed) { type = 'p'; lvl += 1; }
        else at = S.blocks[childrenEnd(idx(b.id)) - 1].id;
      }
      const next = newBlock(type, { runs: after, ...(lvl ? { indent: lvl } : {}) });
      insertAfter(at, [next]);
      if (S.autoTask.has(b.id) && type === 'todo') S.autoTask.add(next.id);
      render();
      makeTaskSoon(b.id);
      focus(next.id, 0);
      changed();
    }
    // A new block under this one (and anything inside it), with the "/" menu open in it.
    function addBelow(id) {
      const b = byId(id);
      if (!b) return;
      snap();
      const n = newBlock('p', { runs: [{ text: '/' }], ...(b.indent ? { indent: b.indent } : {}) });
      S.blocks.splice(childrenEnd(idx(id)), 0, n);
      render();
      focus(n.id, 1);
      openSlash(n.id, 0);
      changed();
    }
    // A to-do started as a task becomes one when it has words and you move on from it.
    function makeTaskSoon(id) {
      const b = byId(id);
      if (!b || !S.autoTask.has(id) || b.type !== 'todo' || b.taskId || !runsText(b.runs).trim() || !opts.makeTask) return;
      S.autoTask.delete(id);
      linkTask(b);
    }
    async function linkTask(b) {
      const taskId = await opts.makeTask(b);
      const now = byId(b.id);
      if (!taskId || !now) return;
      now.taskId = taskId;
      refresh();
      changed();
    }
    // Backspace at the very start of a block.
    function backspace(b) {
      const i = idx(b.id);
      if (b.type !== 'p') {
        snap();
        if (b.type === 'code') b.runs = runsText(b.runs) ? [{ text: runsText(b.runs) }] : [];
        setType(b, 'p');
        render();
        focus(b.id, 0);
        return changed();
      }
      if (b.indent) {
        snap();
        indent([b.id], -1);
        render();
        focus(b.id, 0);
        return changed();
      }
      const vis = visibleIds();
      const prevId = vis[vis.indexOf(b.id) - 1];
      const prev = prevId && byId(prevId);
      if (!prev) return;
      if (!TEXT.has(prev.type)) {
        if (!runsLen(b.runs)) {
          snap();
          S.blocks.splice(i, 1);
          render();
          changed();
        }
        return select([prev.id]);
      }
      snap();
      const at = runsLen(prev.runs);
      prev.runs = prev.type === 'code' ? [{ text: runsText(prev.runs) + runsText(b.runs) }].filter((r) => r.text) : joinRuns(prev.runs, b.runs);
      S.blocks.splice(i, 1);
      render();
      focus(prev.id, at);
      changed();
    }
    // Delete at the very end: the next block's text joins this one.
    function forwardDelete(b) {
      const vis = visibleIds();
      const next = byId(vis[vis.indexOf(b.id) + 1]);
      if (!next) return;
      if (!TEXT.has(next.type)) return select([next.id]);
      snap();
      const at = runsLen(b.runs);
      b.runs = b.type === 'code' ? [{ text: runsText(b.runs) + runsText(next.runs) }].filter((r) => r.text) : joinRuns(b.runs, next.runs);
      S.blocks.splice(idx(next.id), 1);
      render();
      focus(b.id, at);
      changed();
    }
    // Up and down between blocks keep roughly the same place across the line.
    function lineEdge(ed, up) {
      const rect = caretRect();
      const box = ed.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return true;
      const lh = parseFloat(getComputedStyle(ed).lineHeight) || 20;
      return up ? rect.top - box.top < lh * 0.8 : box.bottom - rect.bottom < lh * 0.8;
    }
    function goVertical(b, up, x) {
      const vis = visibleIds();
      const to = byId(vis[vis.indexOf(b.id) + (up ? -1 : 1)]);
      if (!to) return up ? (titleEl.focus(), setCaret(titleEl, titleEl.textContent.length)) : null;
      if (to.type === 'table') return focus(to.id, up ? 'end' : 0, undefined, up ? [to.rows.length - 1, 0] : [0, 0]);
      if (!TEXT.has(to.type)) return select([to.id]);
      const ed = textOf(to.id);
      const box = ed.getBoundingClientRect();
      const y = up ? box.bottom - 4 : box.top + 4;
      const hit = document.caretRangeFromPoint?.(x, y) || (document.caretPositionFromPoint && (() => { const p = document.caretPositionFromPoint(x, y); if (!p) return null; const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r; })());
      if (hit && ed.contains(hit.startContainer)) return setCaret(ed, pointOffset(ed, hit.startContainer, hit.startOffset));
      focus(to.id, up ? 'end' : 0);
    }
    function onKey(e) {
      if (S.slash && slashKey(e)) return;
      if (S.draft && e.key === 'Escape' && !e.target.closest?.('.dk-ai-ask')) { e.preventDefault(); return discardDraft(); }
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const k = e.key;
      if (S.ro) { if (k === 'Escape') clearSel(); return; }
      if (mod && !e.altKey && (k === 'z' || k === 'Z')) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if (mod && k === 'y') { e.preventDefault(); return redo(); }
      // Block selection.
      if (S.sel.length && !e.target.closest?.('.dk-text, .dk-title')) return selKey(e, mod);
      const ed = e.target.closest?.('.dk-text');
      if (!ed) return;
      const id = ed.closest('.dk-row').dataset.id;
      const b = byId(id);
      if (!b) return;
      if (S.composing || e.isComposing) return;
      const cell = ed.classList.contains('dk-cell');
      if (mod && !e.shiftKey && ['b', 'i', 'u', 'e', 'k'].includes(k.toLowerCase())) {
        e.preventDefault();
        return k.toLowerCase() === 'k' ? linkAsk() : format({ b: 'b', i: 'i', u: 'u', e: 'code' }[k.toLowerCase()]);
      }
      if (mod && e.shiftKey && (k === 's' || k === 'S' || k === 'x' || k === 'X')) { e.preventDefault(); return format('s'); }
      if (mod && e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
        e.preventDefault();
        snap();
        const c = caretOf(ed);
        move([id], k === 'ArrowUp' ? -1 : 1);
        render();
        focus(id, c?.start || 0, c?.end || 0, cell ? [Number(ed.dataset.r), Number(ed.dataset.c)] : null);
        return changed();
      }
      if (mod && k === 'd') { e.preventDefault(); snap(); const [first] = duplicate([id]); render(); focus(first.id, 'end'); return changed(); }
      if (mod && k === 'Enter') {
        e.preventDefault();
        if (b.type === 'todo') { snap(); const on = !isDone(b); if (on) b.checked = true; else delete b.checked; if (b.taskId && opts.task?.(b.taskId)) opts.toggleTask?.(b.taskId, on); const c = caretOf(ed); render(); focus(id, c?.start || 0); return changed(); }
        if (b.type === 'toggle') { snap(); b.closed = !b.closed; if (!b.closed) delete b.closed; render(); focus(id, 'end'); return changed(); }
        if (b.type === 'code') { const next = byId(visibleIds()[visibleIds().indexOf(id) + 1]); if (next && TEXT.has(next.type)) return focus(next.id, 0); snap(); const n = newBlock(); insertAfter(id, [n]); render(); focus(n.id); return changed(); }
      }
      if (mod && k === 'a' && !cell) {
        const c = caretOf(ed);
        if (c && c.start === 0 && c.end === runsLen(b.runs)) { e.preventDefault(); return select(visibleIds()); }
        return;
      }
      if (k === 'Escape') { e.preventDefault(); return select([id]); }
      if (cell) return cellKey(e, b, ed);
      const c = caretOf(ed);
      if (!c) return;
      const len = runsLen(b.runs);
      if (k === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (b.type === 'code') { typingSnap(id); document.execCommand('insertText', false, '\n'); return; }
        return enter(b, ed, c);
      }
      if (k === 'Enter' && e.shiftKey && b.type === 'code') { e.preventDefault(); return enter(b, ed, { start: len, end: len }); }
      if (k === 'Tab') {
        e.preventDefault();
        if (b.type === 'code' && !e.shiftKey) { typingSnap(id); document.execCommand('insertText', false, '  '); return; }
        snap();
        indent([id], e.shiftKey ? -1 : 1);
        render();
        focus(id, c.start, c.end);
        return changed();
      }
      if (k === 'Backspace' && c.start === 0 && c.end === 0) { e.preventDefault(); return backspace(b); }
      if (k === 'Delete' && c.start === len && c.end === len) { e.preventDefault(); return forwardDelete(b); }
      if ((k === 'ArrowUp' || k === 'ArrowDown') && !e.shiftKey && !mod && !e.altKey && lineEdge(ed, k === 'ArrowUp')) {
        e.preventDefault();
        return goVertical(b, k === 'ArrowUp', caretRect()?.left ?? ed.getBoundingClientRect().left);
      }
      if (k === 'ArrowLeft' && !e.shiftKey && c.start === 0 && c.end === 0) {
        const vis = visibleIds();
        const prev = byId(vis[vis.indexOf(id) - 1]);
        if (prev && TEXT.has(prev.type)) { e.preventDefault(); focus(prev.id, 'end'); }
      }
      if (k === 'ArrowRight' && !e.shiftKey && c.start === len && c.end === len) {
        const vis = visibleIds();
        const next = byId(vis[vis.indexOf(id) + 1]);
        if (next && TEXT.has(next.type)) { e.preventDefault(); focus(next.id, 0); }
      }
    }
    function cellKey(e, b, ed) {
      const r = Number(ed.dataset.r), c = Number(ed.dataset.c);
      const cols = b.rows[0].length;
      const go = (rr, cc) => { render(); focus(b.id, 'end', 'end', [rr, cc]); };
      if (e.key === 'Tab') {
        e.preventDefault();
        let rr = r, cc = c + (e.shiftKey ? -1 : 1);
        if (cc >= cols) { cc = 0; rr++; }
        if (cc < 0) { cc = cols - 1; rr--; }
        if (rr < 0) return;
        if (rr >= b.rows.length) { snap(); b.rows.push(Array.from({ length: cols }, () => [])); changed(); }
        return go(rr, cc);
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (r + 1 >= b.rows.length) {
          const vis = visibleIds();
          const next = byId(vis[vis.indexOf(b.id) + 1]);
          if (next && TEXT.has(next.type)) return focus(next.id, 0);
          snap();
          const n = newBlock();
          insertAfter(b.id, [n]);
          render();
          focus(n.id);
          return changed();
        }
        return go(r + 1, c);
      }
      const cc = caretOf(ed);
      if (e.key === 'ArrowUp' && r === 0 && cc && lineEdge(ed, true)) { e.preventDefault(); return goVertical(b, true, caretRect()?.left || 0); }
      if (e.key === 'ArrowDown' && r === b.rows.length - 1 && cc && lineEdge(ed, false)) { e.preventDefault(); return goVertical(b, false, caretRect()?.left || 0); }
      if (e.key === 'ArrowUp' && r > 0 && cc && lineEdge(ed, true)) { e.preventDefault(); return focus(b.id, 'end', 'end', [r - 1, c]); }
      if (e.key === 'ArrowDown' && r + 1 < b.rows.length && cc && lineEdge(ed, false)) { e.preventDefault(); return focus(b.id, 'end', 'end', [r + 1, c]); }
    }
    function selKey(e, mod) {
      const k = e.key;
      const ids = S.sel;
      if (k === 'Escape') { e.preventDefault(); return clearSel(); }
      if (k === 'Backspace' || k === 'Delete') {
        e.preventDefault();
        snap();
        const at = removeBlocks(withChildren(ids));
        render();
        const b = S.blocks[Math.min(at, S.blocks.length - 1)];
        TEXT.has(b.type) ? focus(b.id, 'end') : select([b.id]);
        return changed();
      }
      if (k === 'Enter') {
        e.preventDefault();
        const b = byId(ids[0]);
        if (b?.type === 'file') return opts.openFile?.(b.itemId);
        return TEXT.has(b?.type) || b?.type === 'table' ? focus(b.id, 'end') : null;
      }
      if (k === 'Tab') { e.preventDefault(); snap(); indent(ids, e.shiftKey ? -1 : 1); render(); select(ids); return changed(); }
      if (mod && k === 'd') { e.preventDefault(); snap(); const copies = duplicate(ids); render(); select(copies.map((x) => x.id)); return changed(); }
      if (mod && k === 'a') { e.preventDefault(); return select(visibleIds()); }
      if (mod && e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); snap(); move(ids, k === 'ArrowUp' ? -1 : 1); render(); select(ids); return changed(); }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        const vis = visibleIds();
        const end = e.shiftKey ? (S.anchor === ids[0] ? ids.at(-1) : ids[0]) : k === 'ArrowUp' ? ids[0] : ids.at(-1);
        const to = vis[Math.max(0, Math.min(vis.length - 1, vis.indexOf(end) + (k === 'ArrowUp' ? -1 : 1)))];
        return e.shiftKey ? select(range(S.anchor, to), S.anchor) : select([to]);
      }
      // Typing over a selection replaces it, as in a text box.
      if (k.length === 1 && !mod && !e.altKey) {
        snap();
        const at = removeBlocks(withChildren(ids));
        const n = newBlock();
        S.blocks.splice(Math.min(at + 1, S.blocks.length), 0, n);
        render();
        focus(n.id);
        changed();
      }
    }

    // ----- marks: bold, italic, underline, strikethrough, code, links -----
    function activeText() {
      const sel = getSelection();
      if (!sel.rangeCount) return null;
      const ed = (sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest?.('.dk-text');
      if (!ed || !root.contains(ed) || (ed.tagName === 'PRE' && !S.ro)) return null;
      const c = caretOf(ed);
      if (!c) return null;
      const b = byId(ed.closest('.dk-row').dataset.id);
      const cell = ed.classList.contains('dk-cell') ? [Number(ed.dataset.r), Number(ed.dataset.c)] : null;
      const get = () => (cell ? b.rows[cell[0]][cell[1]] : b.runs);
      const put = (runs) => (cell ? (b.rows[cell[0]][cell[1]] = runs) : (b.runs = runs));
      return { ed, b, c, get, put };
    }
    function format(key, val = true) {
      const a = activeText();
      if (!a || a.c.start === a.c.end) return;
      snap();
      const all = markAll(a.get(), a.c.start, a.c.end, key);
      a.put(setMark(a.get(), a.c.start, a.c.end, key, all && key !== 'link' ? null : val));
      draw(a.get(), a.ed);
      setCaret(a.ed, a.c.start, a.c.end);
      changed();
      showBar();
    }
    function linkAsk() {
      const a = activeText();
      if (!a || a.c.start === a.c.end) return;
      const had = sliceRuns(a.get(), a.c.start, a.c.end).find((r) => r.link)?.link || '';
      const rect = caretRect();
      const inp = el('input', { class: 'dk-link-in', value: had, placeholder: 'Paste a link, Enter to add', spellcheck: 'false' });
      barEl.replaceChildren(inp);
      barEl.classList.remove('hidden');
      place(barEl, rect, true);
      inp.focus();
      inp.select();
      const done = (ok) => {
        hideBar();
        let url = inp.value.trim();
        if (ok && url && !/^(https?:|mailto:|tel:)/i.test(url)) url = (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? 'mailto:' : 'https://') + url;
        setCaret(a.ed, a.c.start, a.c.end);
        if (ok) {
          snap();
          a.put(setMark(a.get(), a.c.start, a.c.end, 'link', url || null));
          draw(a.get(), a.ed);
          setCaret(a.ed, a.c.end);
          changed();
        }
      };
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); done(true); }
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
      });
      inp.addEventListener('blur', () => setTimeout(() => !barEl.contains(document.activeElement) && hideBar(), 100));
    }
    function place(pop, rect, above) {
      if (!rect) return;
      const w = pop.offsetWidth, hgt = pop.offsetHeight;
      pop.style.left = Math.max(8, Math.min(rect.left, innerWidth - w - 8)) + 'px';
      const top = above ? rect.top - hgt - 8 : rect.bottom + 6;
      pop.style.top = (top < 8 ? rect.bottom + 6 : top + hgt > innerHeight - 8 ? rect.top - hgt - 6 : top) + 'px';
    }
    // The bar over selected text.
    function showBar() {
      const a = activeText();
      if (!a || a.c.start === a.c.end || S.sel.length) return hideBar();
      if (barEl.querySelector('.dk-link-in')) return;
      const runs = a.get();
      const btn = (key, label, title) => el('button', { type: 'button', class: markAll(runs, a.c.start, a.c.end, key) ? 'on' : null, title, onpointerdown: (e) => { e.preventDefault(); key === 'link' ? linkAsk() : format(key); } }, label);
      const k = isMac ? '⌘' : 'Ctrl+';
      const aiBtn = opts.ai && !a.ed.classList.contains('dk-cell') ? el('button', { type: 'button', class: 'dk-ai-btn', title: 'Rework this with AI', onpointerdown: (e) => { e.preventDefault(); aiSelMenu(e.currentTarget, a); } }, '✦ AI') : null;
      const cmtBtn = opts.comment ? el('button', { type: 'button', title: 'Comment on this', onpointerdown: (e) => { e.preventDefault(); hideBar(); opts.comment({ blockId: a.b.id, quote: runsText(sliceRuns(a.get(), a.c.start, a.c.end)) }); } }, '💬') : null;
      if (S.ro) return cmtBtn ? (barEl.replaceChildren(cmtBtn), barEl.classList.remove('hidden'), place(barEl, getSelection().getRangeAt(0).getBoundingClientRect(), true)) : hideBar();
      barEl.replaceChildren(...[aiBtn, cmtBtn, btn('b', el('b', {}, 'B'), `Bold (${k}B)`), btn('i', el('i', {}, 'I'), `Italic (${k}I)`), btn('u', el('u', {}, 'U'), `Underline (${k}U)`), btn('s', el('s', {}, 'S'), `Strikethrough (${k}Shift+S)`), btn('code', '</>', `Code (${k}E)`), btn('link', '🔗', `Link (${k}K)`)].filter(Boolean));
      barEl.classList.remove('hidden');
      const sel = getSelection();
      place(barEl, sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null, true);
    }
    function hideBar() {
      barEl.classList.add('hidden');
      barEl.replaceChildren();
    }

    // ----- AI: what it writes shows as a draft under the block; nothing changes until it's accepted -----
    // The doc as text for the AI, with live blocks as [[live:N]] so a full draft can keep them where they go.
    function docForAi() {
      let n = 0;
      return S.blocks.map((b) => (b.type === 'live' ? `[[live:${++n}]] (${LIVE_NAME[b.source]})` : toText([b]))).join('\n');
    }
    function aiSelMenu(anchor, a) {
      const sel = runsText(sliceRuns(a.get(), a.c.start, a.c.end));
      const go = (mode, ask) => { hideBar(); aiRun({ mode, ask, selection: sel, at: a.b.id, range: { id: a.b.id, start: a.c.start, end: a.c.end } }); };
      opts.menu?.(anchor, [
        { head: 'AI' },
        { label: 'Improve the writing', run: () => go('improve') },
        { label: 'Make it shorter', run: () => go('shorten') },
        { label: 'Make it longer', run: () => go('expand') },
        { label: 'Fix spelling and grammar', run: () => go('fix') },
        { label: 'Ask for something else…', run: () => { hideBar(); aiAsk({ mode: 'ask', selection: sel, at: a.b.id, range: { id: a.b.id, start: a.c.start, end: a.c.end } }); } },
      ]);
    }
    // A box to say what to write, with a few ready asks.
    function aiAsk(req) {
      const anchor = rowOf(req.at);
      const inp = el('input', { class: 'dk-ai-in', placeholder: req.mode === 'ask' ? 'What should it do with the selected text?' : 'What should it write? e.g. three follow-up email ideas', spellcheck: 'true' });
      const quick = req.mode === 'ask' ? [] : [['Continue writing', 'continue', ''], ['Next steps for this campaign', 'write', 'A short list of next steps for this campaign, from how it’s going'], ['Summary of how it’s going', 'write', 'A short summary of how the campaign is going, with the numbers'], ['Talking points', 'write', 'Talking points for calls about this']];
      const send = (mode, ask) => { close(); aiRun({ ...req, mode, ask }); };
      const close = () => { box.remove(); removeEventListener('pointerdown', away, true); };
      const away = (e) => { if (!box.contains(e.target)) close(); };
      const box = el('div', { class: 'dk-ai-ask', contenteditable: 'false' },
        el('div', { class: 'dk-ai-row' }, el('span', { class: 'dk-ai-spark' }, '✦'), inp, el('button', { type: 'button', class: 'dk-ai-go', onclick: () => inp.value.trim() && send(req.mode, inp.value.trim()) }, 'Write')),
        quick.length ? el('div', { class: 'dk-ai-quick' }, quick.map(([label, mode, ask]) => el('button', { type: 'button', onclick: () => send(mode, ask) }, label))) : null);
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); send(req.mode, inp.value.trim()); }
        if (e.key === 'Escape') { e.preventDefault(); close(); focus(req.at, 'end'); }
      });
      (anchor || body).after(box);
      setTimeout(() => addEventListener('pointerdown', away, true));
      inp.focus();
    }
    // Asks the app's AI, shows a draft, and puts it in on Accept.
    async function aiRun(req) {
      if (!opts.ai) return;
      const near = req.at && byId(req.at) ? runsText(byId(req.at).runs) || toText([byId(req.at)]) : '';
      S.draft = { req, blocks: null, error: null };
      drawDraft();
      try {
        const r = await opts.ai({ mode: req.mode, ask: req.ask || '', selection: req.selection || '', near, doc: docForAi(), title: S.title });
        if (S.draft?.req !== req) return;
        const blocks = fromText(r.text || '');
        if (!blocks.length) throw new Error('The AI didn’t write anything. Try asking another way.');
        S.draft = { req, blocks, title: r.title };
      } catch (e) {
        if (S.draft?.req !== req) return;
        S.draft = { req, blocks: null, error: e.message };
      }
      drawDraft();
    }
    function drawDraft() {
      body.parentNode.querySelector('.dk-draft')?.remove();
      const d = S.draft;
      if (!d) return;
      const card = el('div', { class: 'dk-draft', contenteditable: 'false' },
        el('div', { class: 'dk-draft-h' }, el('span', { class: 'dk-ai-spark' }, '✦'), d.error ? 'Couldn’t write that' : d.blocks ? 'Draft from AI' : 'Writing…'),
        d.error ? el('p', { class: 'dk-draft-err' }, d.error) : d.blocks ? draftPreview(d.blocks) : el('div', { class: 'dk-draft-wait' }, el('i'), el('i'), el('i')),
        el('div', { class: 'dk-draft-btns' },
          d.blocks ? el('button', { type: 'button', class: 'dk-draft-ok', onclick: acceptDraft }, d.req.range ? 'Replace selection' : d.req.mode === 'draft' ? 'Use this draft' : 'Insert') : null,
          d.blocks || d.error ? el('button', { type: 'button', onclick: () => aiRun(d.req) }, 'Try again') : null,
          el('button', { type: 'button', onclick: discardDraft }, d.blocks || d.error ? 'Discard' : 'Stop')));
      const anchor = d.req.mode === 'draft' ? null : rowOf(d.req.at);
      if (anchor) anchor.after(card);
      else body.before(card);
      card.scrollIntoView({ block: 'nearest' });
      card.querySelector('.dk-draft-ok')?.focus();
    }
    function draftPreview(blocks) {
      const page = toHtml(blocks.map((b) => (/^\[\[live:\d+\]\]/.test(runsText(b.runs)) ? { ...b, runs: [{ text: '▦ live numbers stay here' }] } : b)));
      page.className = 'dk-draft-page';
      return page;
    }
    function discardDraft() {
      const at = S.draft?.req.at;
      S.draft = null;
      drawDraft();
      if (at && byId(at)) focus(at, 'end');
    }
    function acceptDraft() {
      const d = S.draft;
      if (!d?.blocks) return;
      snap();
      const blocks = d.blocks.map((b) => ({ ...b, id: uid() }));
      const lvl = byId(d.req.at)?.indent;
      if (lvl) for (const b of blocks) if (!/^h/.test(b.type)) b.indent = Math.min(8, (b.indent || 0) + lvl);
      let last = blocks.at(-1);
      if (d.req.mode === 'draft') {
        // The whole doc: live blocks go where the AI kept their markers; any it left out stay at the top.
        const lives = S.blocks.filter((b) => b.type === 'live');
        const used = new Set();
        const out = blocks.map((b) => {
          const m = runsText(b.runs).match(/^\[\[live:(\d+)\]\]/);
          const live = m && lives[Number(m[1]) - 1];
          if (live && !used.has(live)) { used.add(live); return live; }
          return m ? null : b;
        }).filter(Boolean);
        S.blocks = [...lives.filter((b) => !used.has(b)), ...out];
        if (!S.title.trim() && d.title) { S.title = d.title; titleEl.textContent = d.title; }
        last = S.blocks.at(-1);
      } else if (d.req.range && byId(d.req.range.id)) {
        // The selected words: one paragraph replaces them in the line; more splits the line around them.
        const b = byId(d.req.range.id);
        const { start, end } = d.req.range;
        if (blocks.length === 1 && blocks[0].type === 'p') {
          b.runs = joinRuns(sliceRuns(b.runs, 0, start), blocks[0].runs, sliceRuns(b.runs, end));
          S.draft = null;
          render();
          focus(b.id, start + runsLen(blocks[0].runs));
          return changed();
        }
        const after = sliceRuns(b.runs, end);
        b.runs = sliceRuns(b.runs, 0, start);
        const tailB = runsLen(after) ? newBlock(b.type === 'code' ? 'p' : b.type, { runs: after, ...(b.indent ? { indent: b.indent } : {}) }) : null;
        insertAfter(b.id, [...blocks, ...(tailB ? [tailB] : [])]);
        if (!runsLen(b.runs) && b.type === 'p') S.blocks.splice(idx(b.id), 1);
      } else {
        const at = byId(d.req.at);
        if (at && at.type === 'p' && !runsLen(at.runs)) S.blocks.splice(idx(at.id), 1, ...blocks);
        else insertAfter(at ? S.blocks[childrenEnd(idx(at.id)) - 1].id : S.blocks.at(-1)?.id, blocks);
      }
      S.draft = null;
      render();
      if (last && byId(last.id)) TEXT.has(last.type) ? focus(last.id, 'end') : select([last.id]);
      changed();
    }

    // ----- the "/" menu -----
    function openSlash(id, start, mode = 'slash') {
      S.slash = { id, start, q: '', i: 0, mode, list: mode === 'at' ? opts.mentions('') : COMMANDS };
      drawSlash();
    }
    function updateSlash(ed, b) {
      const c = caretOf(ed);
      const text = runsText(b.runs);
      if (!c || c.start <= S.slash.start || text[S.slash.start] !== (S.slash.mode === 'at' ? '@' : '/')) return closeSlash();
      const q = text.slice(S.slash.start + 1, c.start);
      if (S.slash.mode === 'at') {
        if (/\s{2}|\n/.test(q) || q.length > 40) return closeSlash();
        const list = opts.mentions(q.trim());
        if (!list.length && q.length > 4) return closeSlash();
        Object.assign(S.slash, { q, list, i: Math.min(S.slash.i, Math.max(0, list.length - 1)) });
        return drawSlash();
      }
      if (/\s{2}|\n/.test(q) || q.length > 24) return closeSlash();
      // Matches the start of a word, best first: the label's start, a word in the label, then other names for it.
      const words = q.toLowerCase().trim();
      const score = (x) => {
        const label = x.label.toLowerCase();
        if (label.startsWith(words)) return 0;
        if (label.split(/[\s-]+/).some((w) => w.startsWith(words))) return 1;
        if (x.keys.split(' ').some((w) => w.startsWith(words))) return 2;
        return 9;
      };
      const list = words ? COMMANDS.map((x) => [x, score(x)]).filter(([, n]) => n < 9).sort((a, b) => a[1] - b[1]).map(([x]) => x) : COMMANDS;
      if (!list.length && q.length > 3) return closeSlash();
      Object.assign(S.slash, { q, list, i: Math.min(S.slash.i, Math.max(0, list.length - 1)) });
      drawSlash();
    }
    function drawSlash() {
      const s = S.slash;
      slashEl.replaceChildren(...(s.list.length ? s.list.map((x, i) => el('button', { type: 'button', class: i === s.i ? 'on' : null, role: 'option', 'aria-selected': String(i === s.i), onpointerdown: (e) => { e.preventDefault(); pickSlash(x); }, onmousemove: () => { if (s.i !== i) { s.i = i; drawSlash(); } } },
        el('span', { class: 'dk-slash-ic' }, s.mode === 'at' ? x.icon || '@' : ICON[x.type] || '¶'), el('span', {}, el('b', {}, x.label), el('small', {}, s.mode === 'at' ? x.sub : x.hint)))) : [el('p', { class: 'dk-slash-none' }, s.mode === 'at' ? 'Nothing by that name' : 'No block like that')]));
      slashEl.classList.remove('hidden');
      place(slashEl, caretRect(), false);
      slashEl.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    }
    function closeSlash() {
      S.slash = null;
      slashEl.classList.add('hidden');
    }
    function slashKey(e) {
      const s = S.slash;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (s.list.length) s.i = (s.i + (e.key === 'ArrowDown' ? 1 : -1) + s.list.length) % s.list.length;
        drawSlash();
        return true;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && s.list.length) {
        e.preventDefault();
        pickSlash(s.list[s.i]);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlash();
        return true;
      }
      return false;
    }
    function pickSlash(cmd) {
      const s = S.slash;
      closeSlash();
      const b = byId(s?.id);
      if (!b) return;
      snap();
      const ed = textOf(b.id);
      const c = (ed && caretOf(ed)) || { start: s.start + 1 + s.q.length };
      // A mention goes where the "@" was, as one chip, and the caret after it.
      if (s.mode === 'at') {
        const add = [{ text: cmd.label, ref: { k: cmd.k, id: cmd.id } }, { text: ' ' }];
        b.runs = joinRuns(sliceRuns(b.runs, 0, s.start), add, sliceRuns(b.runs, c.start));
        draw(b.runs, ed);
        setCaret(ed, s.start + runsLen(add));
        return changed();
      }
      b.runs = joinRuns(sliceRuns(b.runs, 0, s.start), sliceRuns(b.runs, c.start));
      if (cmd.type === 'mention') {
        b.runs = joinRuns(sliceRuns(b.runs, 0, s.start), [{ text: '@' }], sliceRuns(b.runs, s.start));
        draw(b.runs, ed);
        setCaret(ed, s.start + 1);
        openSlash(b.id, s.start, 'at');
        return changed();
      }
      turnInto(b, cmd.type, true, cmd.live);
    }
    // A block becomes another kind: this one if it's empty, else a new one below.
    function turnInto(b, type, fromSlash, live) {
      const empty = !runsLen(b.runs);
      const lvl = b.indent ? { indent: b.indent } : {};
      // A live block: what it shows is picked first.
      if (live) {
        render();
        const anchor = rowOf(b.id);
        Promise.resolve(opts.pickLive?.(live, anchor)).then((pick) => {
          if (!pick || !byId(b.id)) return;
          snap();
          const n = newBlock('live', { source: live, ...pick });
          const after = newBlock('p', lvl);
          if (!runsLen(b.runs) && b.type === 'p') S.blocks.splice(idx(b.id), 1, n, after);
          else insertAfter(b.id, [n, after]);
          render();
          focus(after.id);
          changed();
        });
        return;
      }
      if (type === 'ai') {
        render();
        focus(b.id, 'end');
        return aiAsk({ mode: empty ? 'write' : 'write', at: b.id, replaceEmpty: empty });
      }
      if (type === 'task') {
        if (!empty) {
          const n = newBlock('todo', lvl);
          insertAfter(b.id, [n]);
          b = n;
        } else setType(b, 'todo');
        S.autoTask.add(b.id);
        render();
        focus(b.id, 'end');
        return changed();
      }
      if (type === 'image' || type === 'file') {
        render();
        if (empty && fromSlash) focus(b.id);
        return pickFiles(b.id, type === 'image');
      }
      if (type === 'divider' || type === 'table') {
        const n = newBlock(type, lvl);
        const after = newBlock('p', lvl);
        if (empty && b.type === 'p') S.blocks.splice(idx(b.id), 1, n, after);
        else insertAfter(b.id, [n, after]);
        render();
        type === 'table' ? focus(n.id, 0, 0, [0, 0]) : focus(after.id);
        return changed();
      }
      if (empty || !fromSlash) {
        setType(b, type);
        render();
        focus(b.id, fromSlash ? 0 : 'end');
        return changed();
      }
      const n = newBlock(type, /^h/.test(type) ? {} : lvl);
      insertAfter(b.id, [n]);
      render();
      focus(n.id);
      changed();
    }

    // ----- files and pictures -----
    let pickFor = null;
    function pickFiles(afterId, images) {
      pickFor = afterId;
      filePick.accept = images ? 'image/*' : '';
      filePick.value = '';
      filePick.click();
    }
    filePick.addEventListener('change', () => {
      const files = [...filePick.files];
      if (files.length) addFiles(files, pickFor);
    });
    async function addFiles(files, afterId) {
      if (!opts.upload) return;
      S.uploads += files.length;
      drawStatus();
      try {
        const made = (await opts.upload(files)).filter(Boolean);
        if (!made.length) return;
        snap();
        const blocks = made.map((f) => newBlock('file', { itemId: f.itemId, name: f.name }));
        const at = byId(afterId);
        if (at && TEXT.has(at.type) && !runsLen(at.runs) && at.type === 'p') S.blocks.splice(idx(at.id), 1, ...blocks);
        else insertAfter(afterId && byId(afterId) ? afterId : S.blocks.at(-1)?.id, blocks);
        const lastId = blocks.at(-1).id;
        if (idx(lastId) === S.blocks.length - 1) S.blocks.push(newBlock());
        render();
        const next = S.blocks[idx(lastId) + 1];
        if (next) focus(next.id, 0);
        changed();
      } finally {
        S.uploads -= files.length;
        drawStatus();
      }
    }
    function drawStatus() {
      status.textContent = S.uploads ? `Uploading ${S.uploads} file${S.uploads === 1 ? '' : 's'}…` : '';
    }

    // ----- paste and copy -----
    function onPaste(e) {
      if (S.ro) return e.preventDefault();
      const ed = e.target.closest?.('.dk-text');
      const cd = e.clipboardData;
      if (!cd) return;
      if (e.target === titleEl || titleEl.contains(e.target)) {
        e.preventDefault();
        document.execCommand('insertText', false, cd.getData('text/plain').replace(/\s*\n\s*/g, ' '));
        return;
      }
      const files = [...(cd.files || [])];
      const at = ed ? ed.closest('.dk-row').dataset.id : S.sel.at(-1);
      if (files.length && opts.upload) { e.preventDefault(); return addFiles(files, at); }
      if (!ed) {
        if (!S.sel.length) return;
        e.preventDefault();
        const blocks = pasted(cd);
        if (!blocks.length) return;
        snap();
        insertAfter(S.sel.at(-1), blocks);
        render();
        select(blocks.map((b) => b.id));
        return changed();
      }
      const b = byId(at);
      const text = cd.getData('text/plain');
      if (ed.classList.contains('dk-cell') || b.type === 'code') {
        e.preventDefault();
        typingSnap(b.id);
        document.execCommand('insertText', false, ed.classList.contains('dk-cell') ? text.replace(/\s*\n\s*/g, ' ') : text);
        return;
      }
      e.preventDefault();
      const c = caretOf(ed) || { start: runsLen(b.runs), end: runsLen(b.runs) };
      // A link pasted over selected words links them.
      if (c.start !== c.end && /^(https?:\/\/|mailto:)\S+$/i.test(text.trim())) {
        snap();
        b.runs = setMark(b.runs, c.start, c.end, 'link', text.trim());
        draw(b.runs, ed);
        setCaret(ed, c.end);
        return changed();
      }
      const blocks = pasted(cd);
      if (!blocks.length) return;
      snap();
      // One plain paragraph goes into the line where the caret is.
      if (blocks.length === 1 && blocks[0].type === 'p') {
        const add = blocks[0].runs;
        b.runs = joinRuns(sliceRuns(b.runs, 0, c.start), add, sliceRuns(b.runs, c.end));
        draw(b.runs, ed);
        setCaret(ed, c.start + runsLen(add));
        return changed();
      }
      const after = sliceRuns(b.runs, c.end);
      b.runs = sliceRuns(b.runs, 0, c.start);
      const tailB = runsLen(after) ? newBlock(TEXT.has(b.type) && b.type !== 'code' ? b.type : 'p', { runs: after, ...(b.indent ? { indent: b.indent } : {}) }) : null;
      if (b.indent) for (const x of blocks) if (!/^h/.test(x.type)) x.indent = Math.min(8, (x.indent || 0) + b.indent);
      // Ending on a divider, table or file leaves a line to keep typing in.
      const typeOn = !tailB && !TEXT.has(blocks.at(-1).type) ? newBlock('p', b.indent ? { indent: b.indent } : {}) : null;
      let list = [...blocks, ...(tailB ? [tailB] : []), ...(typeOn ? [typeOn] : [])];
      if (!runsLen(b.runs)) {
        S.blocks.splice(idx(b.id), 1, ...list);
      } else {
        // The first pasted paragraph joins the line it was pasted into.
        if (list[0].type === 'p' && TEXT.has(b.type)) { b.runs = joinRuns(b.runs, list[0].runs); list = list.slice(1); }
        insertAfter(b.id, list);
      }
      render();
      const last = typeOn || (tailB ? byId(tailB.id) && S.blocks[idx(tailB.id) - 1] : list.at(-1) || b);
      if (last) TEXT.has(last.type) ? focus(last.id, 'end') : select([last.id]);
      changed();
    }
    const pasted = (cd) => {
      const mine = cd.getData('application/x-column-blocks');
      if (mine) {
        try {
          return JSON.parse(mine).map((b) => ({ ...b, id: uid() }));
        } catch {}
      }
      const html = cd.getData('text/html');
      const blocks = html ? fromHtml(html) : [];
      return blocks.length ? blocks : fromText(cd.getData('text/plain'));
    };
    function onCopy(e, cut) {
      if (!S.sel.length || document.activeElement !== root) return;
      e.preventDefault();
      const blocks = withChildren(S.sel).map((id) => clone(byId(id)));
      e.clipboardData.setData('text/plain', toText(blocks));
      e.clipboardData.setData('text/html', toHtml(blocks).innerHTML);
      e.clipboardData.setData('application/x-column-blocks', JSON.stringify(blocks));
      if (cut) {
        snap();
        const at = removeBlocks(blocks.map((b) => b.id));
        render();
        const b = S.blocks[Math.min(at, S.blocks.length - 1)];
        TEXT.has(b.type) ? focus(b.id, 'end') : select([b.id]);
        changed();
      }
    }

    // ----- pointer: handles, checkboxes, toggles, dragging -----
    function blockMenu(anchor, b) {
      const rows = [];
      if (opts.comment) rows.push({ label: '💬 Comment', run: () => opts.comment({ blockId: b.id, quote: '' }) });
      if (S.ro) return opts.menu?.(anchor, rows);
      if (TEXT.has(b.type)) {
        rows.push({ head: 'Turn into' });
        for (const c of COMMANDS.filter((x) => TEXT.has(x.type) && x.type !== b.type)) rows.push({ label: c.label, run: () => { snap(); turnInto(b, c.type, false); } });
      }
      if (b.type === 'callout') rows.push({ head: 'Icon' }, { emojis: EMOJIS, run: (em) => { snap(); b.emoji = em; render(); changed(); } });
      if (b.type === 'table') {
        rows.push({ head: 'Table' },
          { label: 'Add a row', run: () => { snap(); b.rows.push(b.rows[0].map(() => [])); render(); changed(); } },
          { label: 'Add a column', run: () => { snap(); b.rows.forEach((r) => r.push([])); render(); changed(); } },
          b.rows.length > 1 ? { label: 'Remove the last row', run: () => { snap(); b.rows.pop(); render(); changed(); } } : null,
          b.rows[0].length > 1 ? { label: 'Remove the last column', run: () => { snap(); b.rows.forEach((r) => r.pop()); render(); changed(); } } : null,
          { label: b.header ? 'First row as plain cells' : 'First row as headings', run: () => { snap(); b.header = !b.header; if (!b.header) delete b.header; render(); changed(); } });
      }
      if (b.type === 'file') rows.push({ label: 'Open', run: () => opts.openFile?.(b.itemId) });
      if (b.type === 'todo' && opts.makeTask) {
        rows.push({ head: 'Task' });
        if (!b.taskId) rows.push({ label: 'Make it a task', run: () => { if (!runsText(b.runs).trim()) return opts.toast?.('Write the to-do first.'); linkTask(b); } });
        else rows.push({ label: 'Open the task', run: () => opts.openTask?.(b.taskId) }, { label: 'Unlink from the task', run: () => { snap(); delete b.taskId; render(); changed(); } });
      }
      if (b.type === 'live') {
        rows.push({ head: b.snap ? 'Snapshot' : 'Live' });
        if (!b.snap) rows.push({ label: 'Freeze the numbers as of today', run: () => { snap(); b.snap = { at: Date.now(), data: opts.liveData?.(b) ?? null }; render(); changed(); } });
        else rows.push({ label: 'Update the numbers to today', run: () => { snap(); b.snap = { at: Date.now(), data: opts.liveData?.(b) ?? null }; render(); changed(); } }, { label: 'Make it live again', run: () => { snap(); delete b.snap; render(); changed(); } });
        if (b.source === 'calls') for (const [d, label] of [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [0, 'All time']]) rows.push({ label, on: (b.days || 0) === d, run: () => { snap(); if (d) b.days = d; else delete b.days; if (b.snap) b.snap = { at: Date.now(), data: opts.liveData?.(b) ?? null }; render(); changed(); } });
      }
      rows.push({ head: 'Block' },
        { label: 'Duplicate', run: () => { snap(); duplicate([b.id]); render(); changed(); } },
        { label: 'Move up', run: () => { snap(); move([b.id], -1); render(); select([b.id]); changed(); } },
        { label: 'Move down', run: () => { snap(); move([b.id], 1); render(); select([b.id]); changed(); } },
        { label: 'Delete', danger: true, run: () => { snap(); const at = removeBlocks(withChildren([b.id])); render(); const n = S.blocks[Math.min(at, S.blocks.length - 1)]; TEXT.has(n.type) && focus(n.id, 'end'); changed(); } });
      opts.menu?.(anchor, rows.filter(Boolean));
    }
    // Dragging a block by its handle, children and all (or the selected blocks, if it's one of them).
    function gripDrag(e, id) {
      e.preventDefault();
      const grip = e.currentTarget;
      const y0 = e.clientY;
      let moving = null;
      const line = el('div', { class: 'dk-drop' });
      let target = null;
      const ids = S.sel.includes(id) ? S.sel : [id];
      const over = (ev) => {
        if (!moving) {
          if (Math.abs(ev.clientY - y0) < 4) return;
          moving = withChildren(ids);
          select(ids);
          body.append(line);
        }
        const rows = [...body.querySelectorAll('.dk-row')].filter((r) => !moving.includes(r.dataset.id));
        let best = null;
        for (const r of rows) {
          const rc = r.getBoundingClientRect();
          if (ev.clientY < rc.top + rc.height / 2) { best = { id: r.dataset.id, before: true, y: rc.top }; break; }
          best = { id: r.dataset.id, before: false, y: rc.bottom };
        }
        target = best;
        if (best) {
          const bb = body.getBoundingClientRect();
          line.style.top = best.y - bb.top - 1 + 'px';
        }
      };
      const up = () => {
        removeEventListener('pointermove', over);
        removeEventListener('pointerup', up);
        line.remove();
        if (!moving) return blockMenu(grip, byId(id));
        if (!target) return;
        snap();
        const set = new Set(moving);
        const group = S.blocks.filter((b) => set.has(b.id));
        let rest = S.blocks.filter((b) => !set.has(b.id));
        let at = rest.findIndex((b) => b.id === target.id);
        if (!target.before) {
          const lvl = rest[at].indent || 0;
          // Dropped after a closed toggle: past what it hides.
          if (rest[at].type === 'toggle' && rest[at].closed) { at++; while (at < rest.length && (rest[at].indent || 0) > lvl) at++; at--; }
          at++;
        }
        // The moved blocks keep their shape, shifted to fit where they land.
        const prev = rest[at - 1];
        const want = Math.min(group[0].indent || 0, prev ? (prev.indent || 0) + 1 : 0);
        const d = want - (group[0].indent || 0);
        if (d) for (const b of group) { const n = Math.max(0, (b.indent || 0) + d); if (n && !/^h/.test(b.type)) b.indent = n; else delete b.indent; }
        rest.splice(at, 0, ...group);
        S.blocks = rest;
        render();
        select(ids);
        changed();
      };
      addEventListener('pointermove', over);
      addEventListener('pointerup', up);
    }
    // Dragging from one block's text into another selects whole blocks, as in Notion.
    function textDrag(e) {
      const start = e.target.closest('.dk-row')?.dataset.id;
      if (!start) return;
      let on = false;
      const over = (ev) => {
        const r = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.dk-row');
        if (!r || !body.contains(r)) return;
        if (r.dataset.id !== start) {
          on = true;
          select(range(start, r.dataset.id), start);
        } else if (on) {
          on = false;
          clearSel();
        }
      };
      const up = () => {
        removeEventListener('pointermove', over);
        removeEventListener('pointerup', up);
      };
      addEventListener('pointermove', over);
      addEventListener('pointerup', up);
    }
    body.addEventListener('pointerdown', (e) => {
      const r = e.target.closest('.dk-row');
      if (!r) return;
      const id = r.dataset.id;
      const b = byId(id);
      const cm = e.target.closest('.dk-cmt');
      if (cm) {
        e.preventDefault();
        return opts.openComments?.(cm.dataset.cmt);
      }
      // Read-only: links, mentions, files and live blocks work; nothing changes the doc.
      if (S.ro) {
        const ref = e.target.closest('.dk-ref');
        if (ref) { e.preventDefault(); return opts.openRef?.({ k: ref.dataset.k, id: ref.dataset.id }); }
        if (e.target.closest('.dk-figure, .dk-file') && b?.type === 'file') return opts.openFile?.(b.itemId);
        if (e.target.closest('.dk-grip')) { e.preventDefault(); return blockMenu(e.target, b); }
        if (e.target.closest('a') && (isMac ? e.metaKey : e.ctrlKey)) { e.preventDefault(); return open(e.target.closest('a').href, '_blank', 'noopener'); }
        if (e.target.closest('.dk-check, .dk-arrow, .dk-emoji, .dk-add, .dk-tbl-add')) e.preventDefault();
        return;
      }
      if (e.target.closest('.dk-grip')) return gripDrag(e, id);
      if (e.target.closest('.dk-add')) {
        e.preventDefault();
        return addBelow(id);
      }
      if (e.target.closest('.dk-check')) {
        e.preventDefault();
        snap();
        const on = !isDone(b);
        if (on) b.checked = true;
        else delete b.checked;
        if (b.taskId && opts.task?.(b.taskId)) opts.toggleTask?.(b.taskId, on);
        render();
        return changed();
      }
      if (e.target.closest('.dk-arrow')) {
        e.preventDefault();
        snap();
        b.closed = !b.closed;
        if (!b.closed) delete b.closed;
        render();
        return changed();
      }
      if (e.target.closest('.dk-emoji')) {
        e.preventDefault();
        return opts.menu?.(e.target, [{ emojis: EMOJIS, run: (em) => { snap(); b.emoji = em; render(); changed(); } }]);
      }
      if (e.target.closest('.dk-tbl-add')) {
        e.preventDefault();
        snap();
        if (e.target.closest('.dk-tbl-row')) b.rows.push(b.rows[0].map(() => []));
        else b.rows.forEach((x) => x.push([]));
        render();
        focus(id, 0, 0, e.target.closest('.dk-tbl-row') ? [b.rows.length - 1, 0] : [0, b.rows[0].length - 1]);
        return changed();
      }
      const ref = e.target.closest('.dk-ref');
      if (ref) {
        e.preventDefault();
        return opts.openRef?.({ k: ref.dataset.k, id: ref.dataset.id });
      }
      if (e.target.closest('.dk-task-bits')) return;
      if (e.target.closest('.dk-live-body button, .dk-live-body a, .dk-live-body input')) return;
      if (e.target.closest('.dk-figure, .dk-file, .dk-hr, .dk-lv')) {
        e.preventDefault();
        if (b.type === 'file' && (e.detail > 1 || S.sel.includes(id))) return opts.openFile?.(b.itemId);
        return e.shiftKey && S.anchor ? select(range(S.anchor, id), S.anchor) : select([id]);
      }
      if (e.target.closest('a') && (isMac ? e.metaKey : e.ctrlKey)) {
        e.preventDefault();
        return open(e.target.closest('a').href, '_blank', 'noopener');
      }
      if (e.shiftKey && S.sel.length) {
        e.preventDefault();
        return select(range(S.anchor, id), S.anchor);
      }
      clearSel();
      if (e.button === 0 && e.target.closest('.dk-text')) textDrag(e);
    });
    // Links open with ⌘ or Ctrl; a plain click puts the caret in them.
    body.addEventListener('click', (e) => {
      if (e.target.closest('a')) e.preventDefault();
    });
    tail.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (S.ro) return;
      const last = S.blocks.at(-1);
      if (last && last.type === 'p' && !runsLen(last.runs)) return focus(last.id);
      snap();
      const n = newBlock();
      S.blocks.push(n);
      render();
      focus(n.id);
      changed();
    });
    body.addEventListener('beforeinput', onBeforeInput);
    body.addEventListener('input', onInput);
    body.addEventListener('compositionstart', () => (S.composing = true));
    body.addEventListener('compositionend', () => (S.composing = false));
    root.addEventListener('keydown', onKey);
    root.addEventListener('paste', onPaste);
    root.addEventListener('copy', (e) => onCopy(e, false));
    root.addEventListener('cut', (e) => onCopy(e, true));
    body.addEventListener('focusout', (e) => {
      const id = e.target.closest?.('.dk-row')?.dataset.id;
      if (id && S.autoTask.has(id)) setTimeout(() => !rowOf(id)?.contains(document.activeElement) && makeTaskSoon(id), 0);
    });
    root.addEventListener('focusout', () => setTimeout(() => { if (!root.contains(document.activeElement) && !slashEl.contains(document.activeElement)) closeSlash(); }, 150));
    // Pictures and files dropped on the page go where they're dropped.
    root.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    });
    root.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length || S.ro) return;
      e.preventDefault();
      e.stopPropagation();
      const r = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.dk-row');
      let after = r?.dataset.id || S.blocks.at(-1)?.id;
      if (r && e.clientY < r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2) after = S.blocks[idx(r.dataset.id) - 1]?.id || null;
      addFiles(files, after);
    });
    let lastBlock;
    let kbShow = null;
    const onSel = () => {
      if (!root.isConnected) return;
      kbShow?.();
      const at = getSelection().anchorNode;
      const id = at && root.contains(at) ? (at.nodeType === 1 ? at : at.parentElement)?.closest('.dk-row')?.dataset.id || null : lastBlock;
      if (id !== lastBlock) { lastBlock = id; opts.onBlock?.(id); }
      if (barEl.querySelector('.dk-link-in')) return;
      const sel = getSelection();
      if (sel.rangeCount && !sel.isCollapsed && root.contains(sel.anchorNode)) showBar();
      else hideBar();
    };
    document.addEventListener('selectionchange', onSel);
    // Only scrolling the page the doc is on moves it away from its menus; the app redrawing behind it doesn't.
    const onScroll = (e) => {
      if (e.target !== document && !e.target.contains?.(root)) return;
      hideBar();
      if (S.slash) closeSlash();
    };
    addEventListener('scroll', onScroll, true);

    // ----- the title -----
    titleEl.addEventListener('beforeinput', (e) => S.ro && e.preventDefault());
    titleEl.addEventListener('input', () => {
      const t = titleEl.textContent.replace(/\s*\n\s*/g, ' ');
      if (titleEl.querySelector('*')) { titleEl.textContent = t; setCaret(titleEl, t.length); }
      if (t !== S.title) {
        typingSnap('title');
        S.title = t;
        changed();
      }
    });
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && lineEdge(titleEl, false))) {
        e.preventDefault();
        e.stopPropagation();
        const first = S.blocks[0];
        if (e.key === 'Enter' && (!first || !TEXT.has(first.type) || runsLen(first.runs))) {
          snap();
          const n = newBlock();
          S.blocks.unshift(n);
          render();
          changed();
          return focus(n.id);
        }
        if (first) TEXT.has(first.type) || first.type === 'table' ? focus(first.id, 0) : select([first.id]);
      }
    });

    const ICON = { p: 'Aa', h1: 'H1', h2: 'H2', h3: 'H3', ul: '•', ol: '1.', todo: '☑', toggle: '▸', quote: '❝', callout: '💡', code: '</>', divider: '—', table: '▦', image: '🖼', file: '📎', task: '✓', mention: '@', ai: '✦', 'live:campaign': '◎', 'live:goal': '▰', 'live:tasks': '☰', 'live:calls': '☏', 'live:budgets': '$', 'live:list': '≡', 'live:pipeline': '▥' };
    // Live blocks, task chips and mention names drawn again from the app's data, leaving the caret alone.
    function refresh() {
      const at = document.activeElement;
      for (const b of S.blocks) {
        const r = rowOf(b.id);
        if (!r) continue;
        if (b.type === 'live') r.querySelector('.dk-lv')?.replaceWith(liveEl(b));
        if (b.type === 'todo') {
          const done = isDone(b);
          r.classList.toggle('dk-done', done);
          r.classList.toggle('dk-tasked', !!b.taskId);
          r.querySelector('.dk-check')?.classList.toggle('on', done);
          const bits = r.querySelector('.dk-task-bits');
          const fresh = taskBits(b);
          if (bits && fresh) bits.replaceWith(fresh);
          else if (bits) bits.remove();
          else if (fresh) r.querySelector('.dk-line').append(fresh);
        }
        r.querySelectorAll(':scope > .dk-cmt, :scope > .dk-here').forEach((m) => m.remove());
        r.prepend(...rowMarks(b));
        for (const chip of r.querySelectorAll('.dk-ref')) {
          const info = opts.refInfo?.({ k: chip.dataset.k, id: chip.dataset.id });
          chip.classList.toggle('gone', !!info?.gone);
          if (info?.label && chip.textContent !== info.label && !r.contains(at)) chip.textContent = info.label;
        }
      }
    }
    if (!S.blocks.length) S.blocks.push(newBlock());
    render();
    if (touch) root.classList.add('dk-touch');
    // On a phone: a bar over the keyboard for what a keyboard shortcut would do.
    const kb = touch ? el('div', { class: 'dk-kb hidden', contenteditable: 'false' }) : null;
    if (kb) {
      document.body.append(kb);
      const current = () => {
        const ed = document.activeElement?.closest?.('.dk-text');
        return ed && root.contains(ed) ? { ed, b: byId(ed.closest('.dk-row').dataset.id) } : null;
      };
      const act = (label, title, fn) => el('button', { type: 'button', title, 'aria-label': title, onpointerdown: (e) => { e.preventDefault(); const c = current(); if (c) fn(c); } }, label);
      const turn = (type) => ({ b, ed }) => { const at = caretOf(ed)?.start || 0; snap(); setType(b, b.type === type ? 'p' : type); render(); focus(b.id, at); changed(); };
      kb.append(...[
        act('+', 'Add a block', ({ b }) => addBelow(b.id)),
        act(el('b', {}, 'B'), 'Bold', () => format('b')),
        act(el('i', {}, 'I'), 'Italic', () => format('i')),
        act('☐', 'To-do', turn('todo')),
        act('•', 'Bulleted list', turn('ul')),
        act('⇥', 'Indent', ({ b, ed }) => { const at = caretOf(ed)?.start || 0; snap(); indent([b.id], 1); render(); focus(b.id, at); changed(); }),
        act('⇤', 'Outdent', ({ b, ed }) => { const at = caretOf(ed)?.start || 0; snap(); indent([b.id], -1); render(); focus(b.id, at); changed(); }),
        opts.mentions ? act('@', 'Mention', () => document.execCommand('insertText', false, '@')) : null,
        opts.ai ? act('✦', 'Write with AI', ({ b }) => aiAsk({ mode: 'write', at: b.id, replaceEmpty: !runsLen(b.runs) })) : null,
        act('⌄', 'Done', ({ ed }) => ed.blur())].filter(Boolean));
      // Sits on top of the keyboard, which shrinks the visual viewport.
      const place = () => {
        const vv = window.visualViewport;
        kb.style.bottom = vv ? Math.max(0, innerHeight - vv.height - vv.offsetTop) + 'px' : '0px';
      };
      const show = () => { kb.classList.toggle('hidden', S.ro || !current()); place(); };
      kbShow = show;
      root.addEventListener('focusin', show);
      root.addEventListener('focusout', () => setTimeout(show, 50));
      window.visualViewport?.addEventListener('resize', place);
      window.visualViewport?.addEventListener('scroll', place);
    }
    // Locked: shown, not edited.
    function setReadOnly(on) {
      S.ro = !!on;
      root.classList.toggle('dk-ro', S.ro);
      titleEl.contentEditable = S.ro ? 'false' : 'true';
      closeSlash();
      render();
    }
    if (S.ro) setReadOnly(true);

    return {
      el: root,
      get blocks() { return S.blocks; },
      get title() { return S.title; },
      // Someone else's changes, applied under what you're doing. Your own unsaved changes to the same blocks win.
      merge(ops, ids, title, keep) {
        const at = where();
        const mine = new Set(keep || []);
        const theirs = (ops || []).filter((op) => !mine.has(op.set?.id || op.del));
        S.blocks = apply(S.blocks, theirs, ids);
        if (!S.blocks.length) S.blocks.push(newBlock());
        for (const s of [...S.undo, ...S.redo]) s.blocks = apply(s.blocks, theirs, ids);
        if (title != null && !keep?.includes('title') && title !== S.title) {
          S.title = title;
          if (document.activeElement !== titleEl) titleEl.textContent = title;
        }
        render();
        if (at?.sel) select(at.sel);
        else if (at && byId(at.id)) focus(at.id, at.start, at.end, at.cell);
        return theirs.length !== (ops || []).length;
      },
      focusStart() {
        if (!S.title) return titleEl.focus();
        const last = S.blocks.at(-1);
        TEXT.has(last.type) ? focus(last.id, 'end') : select([last.id]);
      },
      redraw() { render(); },
      refresh,
      setReadOnly,
      get readOnly() { return S.ro; },
      // Scrolls to a block and flashes it (from a comment).
      show(id) {
        const r = rowOf(id);
        if (!r) return false;
        r.scrollIntoView({ block: 'center', behavior: 'smooth' });
        r.classList.remove('dk-flash');
        void r.offsetWidth;
        r.classList.add('dk-flash');
        return true;
      },
      // Starts the doc over from a template, as one step that undo takes back.
      replace(blocks, title) {
        snap();
        S.blocks = clone(blocks).map((b) => ({ ...b, id: b.id || uid() }));
        if (!S.blocks.length) S.blocks.push(newBlock());
        if (title != null) { S.title = title; titleEl.textContent = title; }
        render();
        changed();
      },
      draft(ask) { aiRun({ mode: 'draft', ask: ask || '', at: null }); },
      get empty() { return S.blocks.every((b) => TEXT.has(b.type) && !runsLen(b.runs)) && !S.draft; },
      // A change to one block from outside (a task renamed elsewhere): applied, and saved like any edit.
      update(id, fn) {
        const b = byId(id);
        if (!b) return;
        const r = rowOf(id);
        const typing = r?.contains(document.activeElement);
        fn(b);
        if (r && !typing) r.replaceWith(row(b, 0));
        else refresh();
        if (b.type === 'ol') render();
        changed();
      },
      destroy() {
        document.removeEventListener('selectionchange', onSel);
        removeEventListener('scroll', onScroll, true);
        slashEl.remove();
        barEl.remove();
        kb?.remove();
      },
    };
  }

  return { editor, diff, apply, toText, toHtml, toPdf, fromText, fromHtml, runsText, uid, LABEL };
})();
