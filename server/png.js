// Tiny dependency-free PNG generator for the Column icon (app icon, tray icon, PWA icon).
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const clamp = (v) => Math.max(0, Math.min(1, v));

// opts.template: black glyph on transparent (macOS menu bar). Otherwise a colored app icon.
export function iconPng(size, opts = {}) {
  const template = !!opts.template;
  const bg = template ? null : opts.bg || [22, 22, 28];
  const fg = template ? [0, 0, 0] : opts.fg || [139, 124, 255];
  const s = size;
  const raw = Buffer.alloc((s * 4 + 1) * s);
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0;
    for (let x = 0; x < s; x++) {
      const px = x + 0.5, py = y + 0.5;
      let r = 0, g = 0, b = 0, a = 0;
      if (bg) {
        const ab = clamp(0.5 - sdRoundRect(px, py, s / 2, s / 2, s / 2, s / 2, s * 0.23));
        r = bg[0]; g = bg[1]; b = bg[2]; a = ab;
      }
      // the column
      const colHW = template ? s * 0.22 : s * 0.17;
      const colHH = template ? s * 0.44 : s * 0.33;
      let af = clamp(0.5 - sdRoundRect(px, py, s / 2, s / 2, colHW, colHH, s * 0.09));
      // three "items" cut out of the column
      for (const cy of [0.36, 0.5, 0.64]) {
        const cut = clamp(0.5 - sdRoundRect(px, py, s / 2, s * cy, colHW * 0.62, Math.max(s * 0.035, 0.6), s * 0.03));
        af *= 1 - cut;
      }
      // composite fg over bg
      const outA = af + a * (1 - af);
      if (outA > 0) {
        r = (fg[0] * af + r * a * (1 - af)) / outA;
        g = (fg[1] * af + g * a * (1 - af)) / outA;
        b = (fg[2] * af + b * a * (1 - af)) / outA;
      }
      const o = y * (s * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = Math.round(outA * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
