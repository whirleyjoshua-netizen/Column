// Makes every Kloomie icon from brand/kloomie-check.png: node brand/make-icons.mjs
// The check alone (transparent) for tabs, the sign-in screen and notifications; the check on a dark tile for
// home screens and the desktop app; a black silhouette for the Mac menu bar. No dependencies.
import fs from 'node:fs';
import zlib from 'node:zlib';

const here = (p) => new URL(p, import.meta.url).pathname;
const TILE = [22, 22, 28]; // the app's dark background

// ---------- reading and writing PNGs (8-bit RGBA or RGB, not interlaced) ----------
function readPng(buf) {
  let pos = 8, w, h, type, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (type !== 6 && type !== 2)) throw new Error('Only 8-bit RGB/RGBA, not interlaced');
    } else if (name === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const px = new Float64Array(w * h * 4), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      cur[i] = (row[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, al = bpp === 4 ? cur[x * 4 + 3] / 255 : 1;
      // premultiplied, so resizing doesn't bleed dark edges
      px[o] = cur[x * bpp] * al; px[o + 1] = cur[x * bpp + 1] * al; px[o + 2] = cur[x * bpp + 2] * al; px[o + 3] = al;
    }
    prev.set(cur);
  }
  return { w, h, px };
}

function crc32(b) {
  let c = ~0;
  for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return ~c >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writePng({ w, h, px }) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, a = px[o + 3], r = y * (w * 4 + 1) + 1 + x * 4;
    for (let k = 0; k < 3; k++) raw[r + k] = a ? Math.round(Math.min(255, px[o + k] / a)) : 0;
    raw[r + 3] = Math.round(a * 255);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- shaping ----------
// The part of the picture that isn't see-through, as a square centered on it.
function trim(img) {
  let x0 = img.w, y0 = img.h, x1 = 0, y1 = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.px[(y * img.w + x) * 4 + 3] > 0.04) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  const side = Math.max(x1 - x0, y1 - y0) + 1, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { img, x: cx - side / 2, y: cy - side / 2, side };
}

// Area-averaged sample of the square src into a size×size box at (bx, by) of a canvas.
function draw(canvas, src, bx, by, size) {
  const { img, x: sx, y: sy, side } = src, k = side / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const ax = sx + x * k, ay = sy + y * k;
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = Math.floor(ay); yy < Math.ceil(ay + k); yy++) for (let xx = Math.floor(ax); xx < Math.ceil(ax + k); xx++) {
      const wgt = (Math.min(xx + 1, ax + k) - Math.max(xx, ax)) * (Math.min(yy + 1, ay + k) - Math.max(yy, ay));
      n += wgt;
      if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h || wgt <= 0) continue;
      const o = (yy * img.w + xx) * 4;
      r += img.px[o] * wgt; g += img.px[o + 1] * wgt; b += img.px[o + 2] * wgt; a += img.px[o + 3] * wgt;
    }
    const cx = bx + x, cy = by + y;
    if (cx < 0 || cy < 0 || cx >= canvas.w || cy >= canvas.h || !n) continue;
    const o = (cy * canvas.w + cx) * 4, sa = a / n;
    // source over what's there
    for (let c = 0; c < 3; c++) canvas.px[o + c] = [r, g, b][c] / n + canvas.px[o + c] * (1 - sa);
    canvas.px[o + 3] = sa + canvas.px[o + 3] * (1 - sa);
  }
  return canvas;
}

const blank = (s) => ({ w: s, h: s, px: new Float64Array(s * s * 4) });

// A dark tile: square (iOS and Android round it themselves), or with rounded corners and a margin (desktop).
function tile(s, { radius = 0, inset = 0 } = {}) {
  const c = blank(s), lo = inset, hi = s - inset, r = radius;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const px = x + 0.5, py = y + 0.5;
    const qx = Math.max(lo + r - px, px - (hi - r), 0), qy = Math.max(lo + r - py, py - (hi - r), 0);
    const inside = px >= lo && px <= hi && py >= lo && py <= hi;
    const a = !inside ? 0 : r ? Math.max(0, Math.min(1, r - Math.hypot(qx, qy) + 0.5)) : 1;
    const o = (y * s + x) * 4;
    c.px[o] = TILE[0] * a; c.px[o + 1] = TILE[1] * a; c.px[o + 2] = TILE[2] * a; c.px[o + 3] = a;
  }
  return c;
}

const check = trim(readPng(fs.readFileSync(here('./kloomie-check.png'))));
const alone = (s, pad = 0.04) => draw(blank(s), check, Math.round(s * pad), Math.round(s * pad), s - 2 * Math.round(s * pad));
const onTile = (s, share, opts) => { const inner = Math.round(s * share); return draw(tile(s, opts), check, Math.round((s - inner) / 2), Math.round((s - inner) / 2), inner); };
// Black where the check is, for the macOS menu bar (the system colors it).
function silhouette(s) {
  const c = alone(s, 0.02);
  for (let i = 0; i < c.px.length; i += 4) { c.px[i] = c.px[i + 1] = c.px[i + 2] = 0; c.px[i + 3] = Math.min(1, c.px[i + 3] * 1.4); }
  return c;
}

const out = {
  'client/favicon.png': alone(64),
  'client/icon-128.png': alone(128),
  'client/icon-256.png': alone(256),
  'client/apple-touch-icon.png': onTile(180, 0.66),
  'client/icon-192.png': onTile(192, 0.66),
  'client/icon-512.png': onTile(512, 0.6), // maskable: the check stays inside the safe circle
  // macOS-style: a rounded tile with a margin, like other apps in the Dock
  'desktop/icon.png': onTile(1024, 0.56, { radius: 185, inset: 100 }),
  'desktop/tray.png': alone(32),
  'desktop/trayTemplate@2x.png': silhouette(36),
  'desktop/drag.png': alone(64),
};
for (const [f, img] of Object.entries(out)) {
  fs.writeFileSync(here('../' + f), writePng(img));
  console.log(f, img.w + '×' + img.h);
}
