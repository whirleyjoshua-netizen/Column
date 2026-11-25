// Quotes and invoices that look like the business (docs/jobflows/PHASE3B.md §3): the team's settings (ws.docs), their
// checks, the business details block both pages show, and reading a drawn signature (a PNG) to tell ink from blank.
import zlib from 'node:zlib';

export const DOCS_DEFAULTS = { business: { name: '', address: '', phone: '', email: '', website: '', license: '' }, validDays: 30, terms: '', footer: '', showPrices: true, accept: 'type', showClientContact: false, signature: null };
const BIZ = { name: 120, address: 300, phone: 40, email: 120, website: 200, license: 60 };

export const docsOf = (ws) => ({ ...DOCS_DEFAULTS, ...(ws.docs || {}), business: { ...DOCS_DEFAULTS.business, ...(ws.docs?.business || {}) } });

// The settings as sent, checked; throws { status: 400 } with a plain reason.
export function cleanDocs(cur, body, cleanText) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  const out = { ...cur, business: { ...cur.business } };
  if (body.business !== undefined) {
    if (!body.business || typeof body.business !== 'object') throw bad('Business details are a set of fields.');
    for (const [k, max] of Object.entries(BIZ)) {
      if (body.business[k] === undefined) continue;
      const v = String(body.business[k] ?? '');
      if (v.length > max) throw bad(`Keep the ${k} under ${max} characters.`);
      out.business[k] = cleanText(v, max).trim();
    }
    if (out.business.website && !/^https?:\/\/[^\s"'<>]+$/i.test(out.business.website)) throw bad('The website must start with https:// or http://');
    if (out.business.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.business.email)) throw bad('That email address doesn’t look right.');
  }
  if (body.validDays !== undefined) {
    if (!Number.isInteger(body.validDays) || body.validDays < 0 || body.validDays > 365) throw bad('Quotes are valid for 0 to 365 days (0 means they don’t expire).');
    out.validDays = body.validDays;
  }
  if (body.terms !== undefined) { if (String(body.terms ?? '').length > 4000) throw bad('Keep the terms under 4,000 characters.'); out.terms = String(body.terms ?? '').replace(/\r\n?/g, '\n').trim(); }
  if (body.footer !== undefined) { if (String(body.footer ?? '').length > 300) throw bad('Keep the footer under 300 characters.'); out.footer = cleanText(String(body.footer ?? ''), 300).trim(); }
  if (body.showPrices !== undefined) { if (typeof body.showPrices !== 'boolean') throw bad('Show prices is on or off.'); out.showPrices = body.showPrices; }
  if (body.showClientContact !== undefined) { if (typeof body.showClientContact !== 'boolean') throw bad('Showing the client’s email and phone is on or off.'); out.showClientContact = body.showClientContact; }
  if (body.accept !== undefined) { if (!['type', 'draw'].includes(body.accept)) throw bad('Customers accept by typing their name or drawing a signature.'); out.accept = body.accept; }
  return out;
}

// The business details at the top of a quote or invoice.
export function bizHtml(biz, esc) {
  if (!biz) return '';
  const site = biz.website && /^https?:\/\//i.test(biz.website) ? `<div><a href="${esc(biz.website)}" rel="noopener">${esc(biz.website.replace(/^https?:\/\//i, ''))}</a></div>` : '';
  const rows = [biz.address, biz.phone, biz.email].filter(Boolean).map((x) => `<div>${esc(x)}</div>`).join('');
  const lic = biz.license ? `<div>License ${esc(biz.license)}</div>` : '';
  if (!biz.name && !rows && !site && !lic) return '';
  return `<div class="biz">${biz.name ? `<b>${esc(biz.name)}</b>` : ''}${rows}${site}${lic}</div>`;
}

// A drawn signature: a real PNG, at most `max` bytes, with ink on it. Reads 8-bit RGB / RGBA, not interlaced (what a
// canvas makes); anything else is refused. Answers the bytes, or null.
export function inkedPng(dataUrl, max = 100_000) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > max || buf.length < 60 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!bpp || depth !== 8 || interlace || !w || !h || w > 4000 || h > 4000 || !idat.length) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (w * bpp + 1) * h + 16 }); } catch { return null; }
  const stride = w * bpp;
  if (raw.length < (stride + 1) * h) return null;
  let prev = Buffer.alloc(stride), ink = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const add = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : -1;
      if (add < 0) return null;
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = x * bpp, alpha = bpp === 4 ? line[o + 3] : 255;
      if (alpha > 32 && 0.3 * line[o] + 0.59 * line[o + 1] + 0.11 * line[o + 2] < 200) ink++;
    }
    prev = line;
  }
  return ink >= 20 ? buf : null;
}
