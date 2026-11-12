// Bringing a Notion export into Kloomie (docs-notion plan, step 2). Notion's "Markdown & CSV" export is a zip (often a
// zip of zips, "Part-1.zip"…): each page is "Title <32 hex>.md", the pages inside it sit in a folder of the same name,
// and a database is "Title <32 hex>.csv" (and "_all.csv") with its rows' pages in a folder beside it.
// This file only reads: a zip from disk with hard limits enforced while inflating (never trusting the sizes a zip
// claims), the page tree, Markdown as Kloomie doc blocks, and CSV as rows with each column's type guessed. It never
// writes a path from a name inside the zip: names are only ever titles. index.js makes the docs, files and projects.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const LIMITS = { entries: 50_000, cdBytes: 64 * 1024 * 1024, textBytes: 5 * 1024 * 1024, nested: 20 };
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// ---------- a zip on disk ----------
// The central directory (zip64 too), then each entry read on demand. Encrypted entries and methods other than stored
// and deflate are skipped.
export async function openZip(file) {
  const fh = await fsp.open(file, 'r');
  const { size } = await fh.stat();
  const readAt = async (pos, len) => { const b = Buffer.alloc(len); const { bytesRead } = await fh.read(b, 0, len, pos); return b.subarray(0, bytesRead); };
  const tailLen = Math.min(size, 22 + 65_535 + 20);
  const tail = await readAt(size - tailLen, tailLen);
  let e = tail.length - 22;
  while (e >= 0 && tail.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) { await fh.close(); throw bad('That isn’t a zip file. In Notion, export as “Markdown & CSV”.'); }
  let count = tail.readUInt16LE(e + 10);
  let cdSize = tail.readUInt32LE(e + 12);
  let cdAt = tail.readUInt32LE(e + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdAt === 0xffffffff) {
    const loc = e - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) { await fh.close(); throw bad('That zip is damaged.'); }
    const z64 = Number(tail.readBigUInt64LE(loc + 8));
    const rec = await readAt(z64, 56);
    if (rec.readUInt32LE(0) !== 0x06064b50) { await fh.close(); throw bad('That zip is damaged.'); }
    count = Number(rec.readBigUInt64LE(32));
    cdSize = Number(rec.readBigUInt64LE(40));
    cdAt = Number(rec.readBigUInt64LE(48));
  }
  if (count > LIMITS.entries) { await fh.close(); throw bad(`That export has ${count.toLocaleString()} files; Kloomie takes up to ${LIMITS.entries.toLocaleString()} at once. Export a part of the workspace.`); }
  if (cdSize > LIMITS.cdBytes || cdAt + cdSize > size) { await fh.close(); throw bad('That zip is damaged.'); }
  const cd = await readAt(cdAt, cdSize);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; i++) {
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20);
    let usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let at = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    // zip64: the real sizes and offset are in the extra field, in this order, for those that overflowed.
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff && q + 8 <= x + 4 + len) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff && q + 8 <= x + 4 + len) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (at === 0xffffffff && q + 8 <= x + 4 + len) { at = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + len;
    }
    p = xEnd + commentLen;
    if (name.endsWith('/') || flags & 1 || (method !== 0 && method !== 8)) continue;
    if (at + 30 > size) continue;
    entries.push({ name: name.replace(/\\/g, '/'), method, csize, usize, at });
  }
  // Where an entry's data starts: after its local header (its own name and extra lengths).
  const start = async (en) => { const h = await readAt(en.at, 30); if (h.readUInt32LE(0) !== 0x04034b50) throw bad('That zip is damaged.'); return en.at + 30 + h.readUInt16LE(26) + h.readUInt16LE(28); };
  return {
    entries,
    // The whole entry, refused past max bytes however big the zip says it is.
    async read(en, max) {
      if (en.csize > max * 20 + 1024) throw bad(`“${path.basename(en.name)}” is too big.`);
      const from = await start(en);
      const raw = await readAt(from, en.csize);
      if (en.method === 0) { if (raw.length > max) throw bad(`“${path.basename(en.name)}” is too big.`); return raw; }
      try { return zlib.inflateRawSync(raw, { maxOutputLength: max }); } catch (e) { throw bad(e.code === 'ERR_BUFFER_TOO_LARGE' || /larger than/.test(e.message) ? `“${path.basename(en.name)}” is too big.` : `“${path.basename(en.name)}” couldn’t be read.`); }
    },
    // Into a file, stopping as soon as it's over max bytes. Returns the bytes written.
    async save(en, dest, max) {
      const from = await start(en);
      let n = 0;
      const count = new Transform({ transform(chunk, _, cb) { n += chunk.length; cb(n > max ? bad(`“${path.basename(en.name)}” is too big.`) : null, chunk); } });
      const src = fs.createReadStream(null, { fd: fh.fd, start: from, end: from + Math.max(0, en.csize) - 1, autoClose: false });
      try {
        if (en.csize === 0) await fsp.writeFile(dest, '');
        else await pipeline(src, ...(en.method === 8 ? [zlib.createInflateRaw()] : []), count, fs.createWriteStream(dest));
      } catch (e) {
        await fsp.rm(dest, { force: true });
        throw e.status ? e : bad(`“${path.basename(en.name)}” couldn’t be read.`);
      }
      return n;
    },
    close: () => fh.close(),
  };
}

// ---------- the page tree ----------
const ID_RE = /\s+([0-9a-f]{32})$/i;
const stripId = (base) => base.replace(ID_RE, '').trim();
const idOf = (base) => ID_RE.exec(base)?.[1]?.toLowerCase() || null;
const posix = path.posix;
// Every page, database and file in the export, keyed by its path in the zip with any "Part-N" zip folded in.
// A page's children are what's in the folder named like it; a database's rows are the pages in its folder.
export function notionTree(files) {
  // Drop one top folder all the paths share (the export's own name), so the tree starts at the pages.
  const names = files.map((f) => f.name);
  const top = names.length && names.every((n) => n.includes('/')) ? names[0].split('/')[0] + '/' : '';
  const all = top && names.every((n) => n.startsWith(top)) ? files.map((f) => ({ ...f, key: f.name.slice(top.length) })) : files.map((f) => ({ ...f, key: f.name }));
  const pages = new Map(), dbs = new Map(), assets = new Map();
  for (const f of all) {
    if (/(^|\/)(__MACOSX|\.DS_Store)/.test(f.key)) continue;
    const ext = posix.extname(f.key).toLowerCase();
    const dir = posix.dirname(f.key) === '.' ? '' : posix.dirname(f.key);
    const base = posix.basename(f.key, posix.extname(f.key));
    if (ext === '.md') pages.set(f.key, { key: f.key, dir, base, folder: (dir ? dir + '/' : '') + base, title: stripId(base) || 'Untitled', nid: idOf(base), entry: f, kids: [], parent: null, db: null });
    else if (ext === '.csv') {
      const all_ = /_all$/.test(base);
      const b = all_ ? base.slice(0, -4) : base;
      const k = (dir ? dir + '/' : '') + b;
      const d = dbs.get(k) || { key: k, dir, base: b, folder: k, title: stripId(b) || 'Table', nid: idOf(b), entry: null, all: false, rows: [], parent: null };
      if (!d.entry || all_) { d.entry = f; d.all = all_; }
      dbs.set(k, d);
    } else assets.set(f.key, { key: f.key, name: posix.basename(f.key), entry: f });
  }
  const byFolder = new Map([...pages.values()].map((p) => [p.folder, p]));
  for (const p of pages.values()) {
    const d = dbs.get(p.dir);
    if (d) { d.rows.push(p); p.db = d; continue; }
    const parent = byFolder.get(p.dir);
    if (parent) { parent.kids.push(p); p.parent = parent; }
  }
  for (const d of dbs.values()) {
    const parent = byFolder.get(d.dir);
    if (parent) { parent.kids.push(d); d.parent = parent; }
  }
  const byId = new Map();
  for (const x of [...pages.values(), ...dbs.values()]) if (x.nid) byId.set(x.nid, x);
  const roots = [...pages.values(), ...dbs.values()].filter((x) => !x.parent && !x.db);
  return { pages, dbs, assets, byFolder, byId, roots };
}
// What a link in a page points at: another page or database (by its path, or by the id in a notion.so address), a
// file in the export, or nothing of ours (an outside address, kept as a link).
export function resolveLink(tree, fromKey, href) {
  let h = String(href || '').trim().replace(/^<|>$/g, '');
  if (!h) return null;
  const nid = /notion\.(so|site)\/.*?([0-9a-f]{32})(?:[?#].*)?$/i.exec(h)?.[2];
  if (nid) return tree.byId.get(nid.toLowerCase()) || null;
  if (/^[a-z][\w+.-]*:/i.test(h) || h.startsWith('#')) return null;
  try { h = decodeURIComponent(h.split('#')[0].split('?')[0]); } catch { h = h.split('#')[0]; }
  const fromDir = posix.dirname(fromKey) === '.' ? '' : posix.dirname(fromKey);
  const key = posix.normalize(posix.join(fromDir, h)).replace(/^(\.\.\/)+/, '');
  return tree.pages.get(key) || tree.dbs.get(key.replace(/(_all)?\.csv$/i, '')) || tree.assets.get(key) || null;
}

// ---------- Markdown as Kloomie doc blocks ----------
// Runs of text with marks: **bold**, *italic*/_italic_, `code`, ~~struck~~, <u>underline</u>, [links](…).
// link(href, text) says what a link becomes: { ref } (a mention of a doc), { link } (an address) or null (just text).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
// One pass along the text: each mark's closing is looked for at most a few thousand characters ahead (native
// indexOf), and the text is capped, so a hostile page can't make this slow.
const AHEAD = 4000;
export function inline(src, link, marks = {}) {
  const s = String(src || '').slice(0, 20_000);
  const out = [];
  const same = (a, b) => ['b', 'i', 'u', 's', 'code', 'link'].every((k) => a[k] === b[k]) && JSON.stringify(a.ref) === JSON.stringify(b.ref);
  const push = (text, m) => { if (!text) return; const last = out.at(-1); if (last && same(last, m)) last.text += text; else out.push({ text, ...m }); };
  const pushRuns = (runs) => { for (const { text, ...m } of runs) push(text, m); };
  const find = (mark, from) => { const i = s.indexOf(mark, from); return i >= 0 && i - from <= AHEAD ? i : -1; };
  let buf = '';
  const flush = () => { push(unent(buf.replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1')), marks); buf = ''; };
  const ws = (c) => c === undefined || /\s/.test(c);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { buf += s[i] + s[i + 1]; i += 2; continue; }
    if (c === '`') {
      const e = find('`', i + 1);
      if (e > i + 1) { flush(); push(s.slice(i + 1, e), { ...marks, code: true }); i = e + 1; continue; }
    }
    if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const o = c === '!' ? i + 1 : i;
      const close = find(']', o + 1);
      if (close > 0 && s[close + 1] === '(') {
        // The address ends at its ")" (one "(…)" inside it is allowed, as in Wikipedia links). Addresses have no spaces.
        let e = find(')', close + 2);
        const open = e > 0 ? s.indexOf('(', close + 2) : -1;
        if (open > 0 && open < e) e = find(')', e + 1);
        const hrefRaw = e > 0 ? s.slice(close + 2, e) : '';
        if (e > 0 && !/\s/.test(hrefRaw.replace(/\s+"[^"]*"$/, '').trim())) {
          e++;
          flush();
          const text = s.slice(o + 1, close);
          const href = s.slice(close + 2, e - 1).trim().replace(/\s+"[^"]*"$/, '');
          const to = link?.(href, text);
          pushRuns(inline(text || href, link, { ...marks, ...(to?.link ? { link: to.link } : {}), ...(to?.ref ? { ref: to.ref } : {}) }));
          i = e;
          continue;
        }
      }
    }
    const pair = s.slice(i, i + 2);
    if ((pair === '**' || pair === '__' || pair === '~~') && !ws(s[i + 2])) {
      const e = find(pair, i + 3);
      if (e > 0 && !ws(s[e - 1])) { flush(); pushRuns(inline(s.slice(i + 2, e), link, { ...marks, ...(pair === '~~' ? { s: true } : { b: true }) })); i = e + 2; continue; }
    }
    if (s.startsWith('<u>', i) || s.startsWith('<U>', i)) {
      const e = Math.max(find('</u>', i + 3), find('</U>', i + 3));
      if (e > 0) { flush(); pushRuns(inline(s.slice(i + 3, e), link, { ...marks, u: true })); i = e + 4; continue; }
    }
    if ((c === '*' || c === '_') && s[i + 1] !== c && !ws(s[i + 1]) && (c === '*' || !/\w/.test(s[i - 1] || ''))) {
      const e = find(c, i + 1);
      if (e > i + 1 && s[e + 1] !== c && !ws(s[e - 1]) && (c === '*' || !/\w/.test(s[e + 1] || ''))) { flush(); pushRuns(inline(s.slice(i + 1, e), link, { ...marks, i: true })); i = e + 1; continue; }
    }
    if (c === '<') {
      const m = /^<br\s*\/?>/i.exec(s.slice(i, i + 8));
      if (m) { buf += '\n'; i += m[0].length; continue; }
      const t = /^<\/?(span|strong|em|b|i|mark|sup|sub)\b[^>]{0,200}>/i.exec(s.slice(i, i + 220));
      if (t) { i += t[0].length; continue; }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}
const runsLen = (runs) => runs.reduce((n, r) => n + r.text.length, 0);
const EMOJI_RE = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u;
// opts: { link(href, text), page(href) → docId if that line is a page inside this one, file(href, alt) → { itemId,
// name } | null, id() → a new block id }. Notion's own bits: <aside> callouts, <details> toggles, the "Key: value"
// lines at the top of a database row's page (dropped: they're the row's fields).
export function mdToBlocks(md, opts) {
  const lines = String(md || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const blocks = [];
  const add = (b) => { blocks.push({ id: opts.id(), ...b }); return blocks.at(-1); };
  const run = (t) => inline(t, opts.link);
  // How far one level of a list is indented in this file (Notion uses 4 spaces; others use 2).
  const steps = lines.map((l) => /^( +)([-*+]|\d+[.)])\s/.exec(l)?.[1].length).filter(Boolean);
  const unit = steps.length && steps.every((n) => n % 4 === 0) ? 4 : 2;
  const lvl = (sp) => Math.min(8, Math.floor(sp / unit));
  let i = 0;
  // The title line, and (a database row's page) its property lines.
  while (i < lines.length && !lines[i].trim()) i++;
  let title = null;
  const h1 = /^#\s+(.+)$/.exec(lines[i] || '');
  if (h1) { title = runsText(run(h1[1])); i++; }
  if (opts.row) {
    let j = i;
    while (j < lines.length && !lines[j].trim()) j++;
    while (j < lines.length && /^[^:\n]{1,80}:\s/.test(lines[j]) && !/^https?:/.test(lines[j])) j++;
    if (j > i) i = j;
  }
  let para = null, toggleAt = [];
  const endPara = () => { if (para) para.b.runs = run(para.lines.join('\n')); para = null; };
  // A doc holds 5000 blocks: past that the page is cut short (the caller says so), not read to the end.
  const most = (opts.max || 5000) + 1;
  for (; i < lines.length && blocks.length < most; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const sp = raw.match(/^ */)[0].length;
    const t = line.trim();
    if (!t) { endPara(); continue; }
    // Code
    const fence = /^(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(t);
    if (fence) {
      endPara();
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i].slice(Math.min(sp, lines[i].match(/^ */)[0].length)));
      add({ type: 'code', runs: body.length ? [{ text: body.join('\n') }] : [], ...(fence[2] ? { lang: fence[2].slice(0, 20) } : {}), ...(lvl(sp) ? { indent: lvl(sp) } : {}) });
      continue;
    }
    // Callout: <aside> … </aside>
    if (/^<aside>/i.test(t)) {
      endPara();
      const body = [t.replace(/^<aside>/i, '')];
      if (!/<\/aside>/i.test(t)) for (i++; i < lines.length && !/<\/aside>/i.test(lines[i]); i++) body.push(lines[i].trim());
      if (i < lines.length && /<\/aside>/i.test(lines[i]) && lines[i] !== raw) body.push(lines[i].replace(/<\/aside>.*/i, '').trim());
      let text = body.join('\n').replace(/<\/aside>.*/is, '').replace(/<\/?p>/gi, '').trim();
      const em = EMOJI_RE.exec(text);
      if (em) text = text.slice(em[0].length);
      add({ type: 'callout', emoji: em ? em[1].slice(0, 8) : '💡', runs: run(text.replace(/\n{2,}/g, '\n')) });
      continue;
    }
    // Toggle: <details><summary>…</summary> … </details>
    let m;
    if ((m = /^<details[^>]*>\s*(?:<summary>([\s\S]*?)<\/summary>)?/i.exec(t))) {
      endPara();
      const summary = m[1] ?? /<summary>([\s\S]*?)<\/summary>/i.exec(lines[i + 1] || '')?.[1];
      if (m[1] == null && summary != null) i++;
      add({ type: 'toggle', runs: run(summary || ''), ...(lvl(sp) ? { indent: lvl(sp) } : {}) });
      toggleAt.push(lvl(sp));
      continue;
    }
    if (/^<\/details>/i.test(t)) { endPara(); toggleAt.pop(); continue; }
    if (/^<\/?(summary|p|div|br\s*\/?)>$/i.test(t)) continue;
    const inToggle = toggleAt.length ? toggleAt.at(-1) + 1 : 0;
    const ind = Math.max(lvl(sp), inToggle);
    const withIndent = (b) => (ind ? { ...b, indent: Math.min(8, ind) } : b);
    // Headings
    if ((m = /^(#{1,6})\s+(.*)$/.exec(t))) { endPara(); add({ type: 'h' + Math.min(3, m[1].length), runs: run(m[2].replace(/\s+#+$/, '')) }); continue; }
    // Divider
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { endPara(); add({ type: 'divider' }); continue; }
    // Table
    if (/^\|.*\|$/.test(t) && /^\|?\s*:?-{2,}/.test((lines[i + 1] || '').trim())) {
      endPara();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => run(c.trim().replace(/\\\|/g, '|')));
      const rows = [cells(t)];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      for (let r = 0; r < rows.length; r += 100) add({ type: 'table', header: true, rows: (r ? [rows[0], ...rows.slice(r, r + 99)] : rows.slice(0, 100)).map((x) => x.slice(0, 20)) });
      continue;
    }
    // Quote
    if ((m = /^>\s?(.*)$/.exec(t))) {
      endPara();
      const body = [m[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].trim().replace(/^>\s?/, ''));
      add(withIndent({ type: 'quote', runs: run(body.join('\n')) }));
      continue;
    }
    // A picture or file on a line of its own.
    if ((m = /^!\[([^\]]*)\]\(((?:[^()\s]|\([^)]*\))*)\)$/.exec(t)) || ((m = /^\[([^\]]*)\]\(((?:[^()\s]|\([^)]*\))*)\)$/.exec(t)) && !/\.(md|csv)$/i.test(decodeSafe(m[2])) && !/^[a-z][\w+.-]*:/i.test(m[2]))) {
      const f = opts.file?.(m[2], m[1]);
      if (f) { endPara(); add(withIndent({ type: 'file', itemId: f.itemId, name: f.name })); continue; }
    }
    // A video, map or design on a line of its own (Notion writes its embeds as a link): an embed.
    if ((m = /^\[([^\]]*)\]\((https:\/\/[^()\s]+)\)$/.exec(t)) || (m = /^(https:\/\/\S+)$/.exec(t))) {
      const url = m[2] || m[1];
      if (embedSrc(url)) { endPara(); add(withIndent({ type: 'embed', url })); continue; }
    }
    // A page inside this one, on a line of its own: its block goes here.
    if ((m = /^\[([^\]]*)\]\(((?:[^()\s]|\([^)]*\))*)\)$/.exec(t))) {
      const docId = opts.page?.(m[2]);
      if (docId) { endPara(); add(withIndent({ type: 'page', docId })); continue; }
    }
    // Lists
    if ((m = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(t))) { endPara(); add({ ...withIndent({ type: 'todo', runs: run(m[2]) }), indent: Math.max(lvl(sp), inToggle) || undefined, ...(m[1].trim() ? { checked: true } : {}) }); continue; }
    if ((m = /^[-*+•]\s+(.*)$/.exec(t))) { endPara(); add(withIndent({ type: 'ul', runs: run(m[1]) })); continue; }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) { endPara(); add(withIndent({ type: 'ol', runs: run(m[1]) })); continue; }
    // Writing: lines next to each other are one paragraph.
    if (para && para.indent === (ind || undefined)) { if ((para.len += t.length + 1) <= 20_000) para.lines.push(t); continue; }
    endPara();
    para = { b: add(withIndent({ type: 'p', runs: [] })), lines: [t], len: t.length, indent: ind || undefined };
  }
  endPara();
  for (const b of blocks) if (b.indent === undefined) delete b.indent;
  return { title, blocks };
}
const decodeSafe = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const runsText = (runs) => runs.map((r) => r.text).join('');

// What a link shows inside a doc (an embed): only these services, each as its own player address. The same rules
// are in client/dockit.js (embedSrc) and server/notion.js; tests/docs_embeds.mjs checks they agree.
export function embedSrc(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const id = (re, s) => re.exec(s)?.[1] || null;
  let v;
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    v = u.pathname === '/watch' ? u.searchParams.get('v') : id(/^\/(?:shorts|embed|live)\/([\w-]{6,20})/, u.pathname);
    return v && /^[\w-]{6,20}$/.test(v) ? { kind: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${v}`, ratio: 56.25 } : null;
  }
  if (host === 'youtu.be') return (v = id(/^\/([\w-]{6,20})$/, u.pathname)) ? { kind: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${v}`, ratio: 56.25 } : null;
  if (host === 'vimeo.com') return (v = id(/^\/(\d{4,12})(?:\/|$)/, u.pathname)) ? { kind: 'Vimeo', src: `https://player.vimeo.com/video/${v}`, ratio: 56.25 } : null;
  if (host === 'loom.com') return (v = id(/^\/(?:share|embed)\/([0-9a-f]{16,40})/, u.pathname)) ? { kind: 'Loom', src: `https://www.loom.com/embed/${v}`, ratio: 56.25 } : null;
  if ((host === 'google.com' || host === 'maps.google.com') && /^\/maps(\/|$)/.test(u.pathname)) {
    const q = u.searchParams.get('q') || decodeURIComponent(id(/^\/maps\/(?:place|search)\/([^/@]+)/, u.pathname) || '').replace(/\+/g, ' ');
    return q && q.length <= 300 ? { kind: 'Google Maps', src: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, ratio: 60 } : null;
  }
  if (host === 'figma.com' && /^\/(file|design|proto|board)\/[\w-]{10,40}/.test(u.pathname)) return { kind: 'Figma', src: `https://www.figma.com/embed?embed_host=kloomie&url=${encodeURIComponent(u.origin + u.pathname)}`, ratio: 62.5 };
  if (host === 'docs.google.com') {
    const m = /^\/(document|spreadsheets|presentation|forms)\/d\/(e\/)?([\w-]{20,80})/.exec(u.pathname);
    if (!m) return null;
    const kind = { document: 'Google Doc', spreadsheets: 'Google Sheet', presentation: 'Google Slides', forms: 'Google Form' }[m[1]];
    const tail = m[1] === 'forms' ? 'viewform?embedded=true' : 'preview';
    return { kind, src: `https://docs.google.com/${m[1]}/d/${m[2] || ''}${m[3]}/${tail}`, ratio: m[1] === 'presentation' ? 59 : 75 };
  }
  return null;
}

// ---------- CSV, and a database's columns ----------
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && !cell) q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
// A value as Notion writes it, without the address of a linked page: "Smith job (Smith%20job%201234….md)" → "Smith job".
export const cellText = (v) => String(v || '').replace(/\s*\((?:https?:\/\/www\.notion\.so\/[^)]*|[^()]*\.md)\)/g, '').trim();
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// Notion's dates: "November 11, 2026", "2026/11/11", "11/11/2026", with a time, or a range "A → B" (the start is kept).
export function notionDate(v) {
  const s = String(v || '').split('→')[0].trim();
  let m;
  const ok = (y, mo, d) => (y > 1900 && y < 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})/.exec(s)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ok(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s))) return ok(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return ok(+m[3], +m[1], +m[2]);
  return null;
}
const NUM_RE = /^-?\$?\s?-?[\d,]*\.?\d+%?$/;
const toNum = (v) => Number(String(v).replace(/[$,%\s]/g, ''));
// Each column's type from what's in it, for Projects: the first column is the name; dates, numbers (money with a $),
// Yes/No, emails, phones and addresses by their look; a few values repeated a lot is a choice (one or several).
export function guessColumns(header, rows) {
  return header.map((name, c) => {
    const vals = rows.map((r) => cellText(r[c])).filter(Boolean);
    const col = { name: String(name || '').trim().slice(0, 40) || 'Column ' + (c + 1), type: 'text' };
    if (c === 0 || !vals.length) return col;
    const every = (re) => vals.every((v) => re.test(v));
    if (vals.every((v) => notionDate(v))) col.type = 'date';
    else if (every(/^(yes|no)$/i)) col.type = 'checkbox';
    else if (every(NUM_RE)) col.type = vals.some((v) => v.includes('$')) ? 'money' : 'number';
    else if (every(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) col.type = 'email';
    else if (every(/^https?:\/\/\S+$/)) col.type = 'url';
    else if (every(/^\+?[\d\s().-]{7,20}$/) && vals.every((v) => v.replace(/\D/g, '').length >= 7)) col.type = 'phone';
    else {
      const parts = vals.flatMap((v) => v.split(/,\s*/));
      const distinct = [...new Set(parts)];
      const multi = vals.some((v) => /,\s/.test(v));
      if (distinct.length <= 15 && distinct.every((v) => v.length <= 40) && (distinct.length <= Math.max(2, vals.length * 0.5) || vals.length <= 3)) {
        col.type = multi ? 'multi' : 'select';
        col.choices = distinct;
      } else if (vals.some((v) => v.length > 120)) col.long = true;
    }
    return col;
  });
}
// A cell as the value its column takes.
export function cellValue(col, v) {
  const t = cellText(v);
  if (!t) return undefined;
  if (col.type === 'date') return notionDate(t) || undefined;
  if (col.type === 'checkbox') return /^yes$/i.test(t);
  if (col.type === 'number' || col.type === 'money') return Number.isFinite(toNum(t)) ? toNum(t) : undefined;
  if (col.type === 'multi') return t.split(/,\s*/).filter(Boolean);
  return t.slice(0, 5000);
}
