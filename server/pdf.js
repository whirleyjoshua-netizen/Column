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
