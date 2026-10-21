// Filling in and signing PDFs: marks (text, checks, signatures) drawn onto the pages, form fields filled in,
// and a signing certificate added at the end of a signed copy.
import { PDFDocument, StandardFonts, rgb, degrees, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from 'pdf-lib';

export class PdfError extends Error {}

const INK = rgb(0.07, 0.07, 0.1);
const GREY = rgb(0.42, 0.42, 0.47);

export async function loadPdf(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    throw new PdfError(/encrypt/i.test(e.message) ? 'This PDF is password-protected, so Column can’t change it.' : 'Column couldn’t read this PDF.');
  }
}

// Helvetica covers Western European text; any other character becomes "?".
function safeText(font, t) {
  return [...String(t)].map((ch) => {
    try {
      font.encodeText(ch);
      return ch;
    } catch {
      return '?';
    }
  }).join('');
}

// A mark's x, y is its bottom-left corner as the page is shown on screen, in PDF points. On a rotated page
// the mark turns with the page, so it reads upright on screen.
function placer(page, m) {
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const r = (rot * Math.PI) / 180;
  const at = (dx, dy) => ({ x: m.x + dx * Math.cos(r) - dy * Math.sin(r), y: m.y + dx * Math.sin(r) + dy * Math.cos(r) });
  return { at, rotate: degrees(rot) };
}

function fillForm(doc, font, values) {
  if (!values || !Object.keys(values).length) return;
  let fields;
  try {
    fields = doc.getForm().getFields();
  } catch {
    return;
  }
  for (const f of fields) {
    const name = f.getName();
    if (!Object.hasOwn(values, name)) continue;
    const v = values[name];
    try {
      if (f instanceof PDFTextField) f.setText(safeText(font, v ?? ''));
      else if (f instanceof PDFCheckBox) v ? f.check() : f.uncheck();
      else if ((f instanceof PDFRadioGroup || f instanceof PDFDropdown || f instanceof PDFOptionList) && v) f.select(String(v));
    } catch {}
  }
}

// marks: [{ type: text|check|image, page, x, y, w, h, text, size, image }]; images: { key: PNG bytes }.
export async function stampPdf(bytes, { marks = [], form = {}, images = {}, flatten = false } = {}) {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const embedded = {};
  fillForm(doc, font, form);
  for (const m of marks) {
    const page = pages[m.page];
    if (!page) continue;
    const { at, rotate } = placer(page, m);
    if (m.type === 'text') {
      const text = safeText(font, m.text || '');
      if (!text.trim()) continue;
      // Shrinks to fit the box when a filled-in answer runs long.
      let size = m.size || Math.min(14, m.h * 0.72);
      while (size > 5 && font.widthOfTextAtSize(text, size) > Math.max(m.w, 40) * 1.02 && !m.size) size -= 0.5;
      page.drawText(text, { ...at(0, Math.max(0, (m.h - size) / 2) + size * 0.18), size, font, color: INK, rotate });
    } else if (m.type === 'check') {
      const s = Math.min(m.w, m.h);
      const [a, b, c] = [at(s * 0.15, s * 0.5), at(s * 0.4, s * 0.18), at(s * 0.88, s * 0.85)];
      page.drawLine({ start: a, end: b, thickness: s * 0.12, color: INK });
      page.drawLine({ start: b, end: c, thickness: s * 0.12, color: INK });
    } else if (m.type === 'image' && images[m.image]) {
      embedded[m.image] ||= await doc.embedPng(images[m.image]);
      const img = embedded[m.image];
      const k = Math.min(m.w / img.width, m.h / img.height);
      const [w, h] = [img.width * k, img.height * k];
      page.drawImage(img, { ...at(0, (m.h - h) / 2), width: w, height: h, rotate });
    }
  }
  if (flatten) {
    try {
      doc.getForm().flatten();
    } catch {}
  }
  return doc;
}

// The last page of a signed copy: what was signed, by whom, and everything that happened to the request.
// c: { title, rows: [[label, value]], events: [[when, what]], images: [[label, PNG bytes]] }
export async function addCertificate(doc, c) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H, M] = [612, 792, 56];
  let page = doc.addPage([W, H]);
  let y = H - M;
  const room = (n) => {
    if (y - n >= M) return;
    page = doc.addPage([W, H]);
    y = H - M;
  };
  // Wraps on spaces; a long unbroken value (a fingerprint) breaks anywhere.
  const lines = (t, f, size, width) => {
    const out = [];
    for (const para of safeText(f, t).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const next = line ? line + ' ' + word : word;
        if (f.widthOfTextAtSize(next, size) <= width) {
          line = next;
          continue;
        }
        if (line) out.push(line);
        line = '';
        let w = word;
        while (f.widthOfTextAtSize(w, size) > width) {
          let i = w.length;
          while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  };
  const write = (t, { f = font, size = 10, x = M, width = W - 2 * M - (x - M), color = INK, gap = 1.45 } = {}) => {
    for (const l of lines(t, f, size, width)) {
      room(size * gap);
      page.drawText(l, { x, y: y - size, size, font: f, color });
      y -= size * gap;
    }
  };
  write(c.title, { f: bold, size: 18 });
  y -= 10;
  for (const [label, value] of c.rows) {
    const top = y;
    write(label, { size: 9, color: GREY, width: 120 });
    const after = y;
    y = top;
    write(value, { x: M + 130 });
    y = Math.min(y, after) - 4;
  }
  if (c.images.length) {
    y -= 8;
    for (const [label, png] of c.images) {
      const img = await doc.embedPng(png);
      const k = Math.min(200 / img.width, 60 / img.height);
      room(img.height * k + 24);
      write(label, { size: 9, color: GREY });
      page.drawImage(img, { x: M, y: y - img.height * k, width: img.width * k, height: img.height * k });
      y -= img.height * k + 10;
    }
  }
  y -= 8;
  write('History', { f: bold, size: 12 });
  y -= 2;
  for (const [when, what] of c.events) {
    const top = y;
    write(when, { size: 9, color: GREY, width: 150 });
    const after = y;
    y = top;
    write(what, { size: 9.5, x: M + 160 });
    y = Math.min(y, after) - 2;
  }
  if (c.note) {
    y -= 10;
    write(c.note, { size: 8.5, color: GREY });
  }
}

export const pageCount = async (bytes) => (await loadPdf(bytes)).getPageCount();

// A document typed in Column (or a Word file) as a PDF, so it can be signed or sent.
// blocks: [{ t: p|h1…h6|li|table|img|break, align, runs: [{ text, b, i, u, s, link }], ordered, n, lvl, rows, img }]
// images: PNG or JPEG bytes for img blocks, by index.
export async function writeDoc(blocks, { title = '' } = {}) {
  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title);
  const fonts = {
    r: await doc.embedFont(StandardFonts.Helvetica),
    b: await doc.embedFont(StandardFonts.HelveticaBold),
    i: await doc.embedFont(StandardFonts.HelveticaOblique),
    bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const LINK = rgb(0.02, 0.39, 0.76);
  const [W, H, M] = [612, 792, 72];
  const SIZE = { p: 11, li: 11, h1: 24, h2: 17, h3: 14, h4: 12, h5: 11, h6: 11 };
  let page, y;
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };
  newPage();
  const fontOf = (r) => fonts[(r.b ? 'b' : '') + (r.i ? 'i' : '') || 'r'];

  // Runs → wrapped lines of pieces, each piece one style.
  function lines(runs, size, width) {
    const out = [];
    let line = { parts: [], w: 0 };
    const push = () => {
      while (line.parts.length && !line.parts.at(-1).text.trim()) line.w -= line.parts.pop().w;
      out.push(line);
      line = { parts: [], w: 0 };
    };
    const add = (r, text) => {
      const f = fontOf(r);
      const w = f.widthOfTextAtSize(text, size);
      const last = line.parts.at(-1);
      if (last && last.f === f && !!last.u === !!r.u && !!last.s === !!r.s && !!last.link === !!r.link) {
        last.text += text;
        last.w += w;
      } else line.parts.push({ text, w, f, u: r.u, s: r.s, link: r.link });
      line.w += w;
    };
    for (const r of runs) {
      const f = fontOf(r);
      for (const tok of safeText(f, r.text.replace(/\t/g, '    ').replace(/\r/g, '')).split(/(\n|\s+)/)) {
        if (!tok) continue;
        if (tok === '\n') {
          push();
          continue;
        }
        const w = f.widthOfTextAtSize(tok, size);
        if (!tok.trim()) {
          if (line.parts.length) add(r, tok);
          continue;
        }
        if (line.w + w > width && line.parts.length) push();
        if (w <= width) {
          add(r, tok);
          continue;
        }
        // A word wider than the line breaks wherever it has to.
        let rest = tok;
        while (rest) {
          let i = rest.length;
          while (i > 1 && f.widthOfTextAtSize(rest.slice(0, i), size) > width - line.w) i--;
          add(r, rest.slice(0, i));
          rest = rest.slice(i);
          if (rest) push();
        }
      }
    }
    push();
    return out;
  }
  function drawLine(l, x, top, width, size, align) {
    const base = top - size;
    let at = x + (align === 'center' ? (width - l.w) / 2 : align === 'right' ? width - l.w : 0);
    for (const p of l.parts) {
      const color = p.link ? LINK : INK;
      page.drawText(p.text, { x: at, y: base, size, font: p.f, color });
      if (p.u || p.link) page.drawLine({ start: { x: at, y: base - size * 0.12 }, end: { x: at + p.w, y: base - size * 0.12 }, thickness: size / 16, color });
      if (p.s) page.drawLine({ start: { x: at, y: base + size * 0.3 }, end: { x: at + p.w, y: base + size * 0.3 }, thickness: size / 16, color });
      at += p.w;
    }
  }
  const styleRuns = (b) => {
    const runs = (b.runs || []).filter((r) => r.text);
    return /^h[2-6]$/.test(b.t) ? runs.map((r) => ({ ...r, b: true })) : runs;
  };
  const bullet = (b) => (b.ordered ? `${b.n}.` : ['•', '–', '·'][Math.min(2, b.lvl || 0) % 3]);
  // How tall a text block is at a width, and how to draw it at a given top.
  function text(b, width) {
    const size = SIZE[b.t] || 11;
    const lh = size * 1.32;
    const indent = b.t === 'li' ? 18 * (1 + Math.min(6, b.lvl || 0)) : 0;
    const ls = lines(styleRuns(b), size, width - indent);
    const before = /^h/.test(b.t) ? size * 0.5 : 0;
    const after = b.t === 'li' ? 3 : size * 0.55;
    return {
      ls, lh, size, before, after, indent,
      height: before + ls.length * lh + after,
      draw(x, top, n = ls.length, from = 0) {
        if (b.t === 'li' && from === 0) page.drawText(safeText(fonts.r, bullet(b)), { x: x + indent - 14, y: top - size, size, font: fonts.r, color: INK });
        for (let i = from; i < from + n; i++) drawLine(ls[i], x + indent, top - (i - from) * lh, width - indent, size, b.align);
      },
    };
  }

  const width = W - 2 * M;
  for (const b of blocks) {
    if (b.t === 'break') {
      newPage();
      continue;
    }
    if (b.t === 'img') {
      if (!b.img) continue;
      const img = b.img.type === 'png' ? await doc.embedPng(b.img.bytes) : await doc.embedJpg(b.img.bytes);
      const wantW = b.w > 0 ? b.w * 0.75 : img.width * 0.75;
      const k = Math.min(1, width / wantW, (H - 2 * M) / ((wantW / img.width) * img.height));
      const w = wantW * k;
      const h = (w / img.width) * img.height;
      if (y - h < M) newPage();
      page.drawImage(img, { x: M, y: y - h, width: w, height: h });
      y -= h + 8;
      continue;
    }
    if (b.t === 'table') {
      const cols = Math.max(1, ...b.rows.map((r) => r.length));
      const cw = width / cols;
      const pad = 5;
      for (const row of b.rows) {
        const cells = row.map((blocks) => blocks.map((x) => text(x, cw - 2 * pad)));
        const rh = Math.max(16, ...cells.map((c) => c.reduce((n, t) => n + t.height, 0) - (c.at(-1)?.after || 0) + 2 * pad));
        if (y - rh < M && y < H - M) newPage();
        cells.forEach((c, i) => {
          const x = M + i * cw;
          page.drawRectangle({ x, y: y - rh, width: cw, height: rh, borderColor: GREY, borderWidth: 0.6 });
          let top = y - pad;
          for (const t of c) {
            top -= t.before;
            t.draw(x + pad, top);
            top -= t.ls.length * t.lh + t.after;
          }
        });
        y -= rh;
      }
      y -= 10;
      continue;
    }
    const t = text(b, width);
    if (!(b.runs || []).some((r) => r.text.trim())) {
      if (y - t.lh < M) newPage();
      y -= t.lh * 0.8;
      continue;
    }
    y -= t.before;
    // A heading moves to the next page rather than sit alone at the bottom.
    if (/^h/.test(b.t) && y - t.lh * 3 < M) newPage();
    for (let i = 0; i < t.ls.length; ) {
      if (y - t.lh < M) newPage();
      const fit = Math.max(1, Math.min(t.ls.length - i, Math.floor((y - M) / t.lh)));
      t.draw(M, y, fit, i);
      y -= fit * t.lh;
      i += fit;
    }
    y -= t.after;
  }
  return doc.save();
}
