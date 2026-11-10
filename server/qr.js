// A small QR code maker, for the code an authenticator app scans when someone turns on two-step sign-in.
// Byte mode, error correction level M, versions 1–10 (up to 213 bytes, plenty for an otpauth:// link), the mask
// chosen by the standard penalty score. Gives an SVG. Follows the QR spec (ISO/IEC 18004) the way Project Nayuki's
// reference encoder lays it out.

// Per version (index 1–10) at level M: total codewords, error-correction codewords per block, number of blocks.
const RAW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const bit = (x, i) => ((x >>> i) & 1) !== 0;

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => (r[i] ^= gfMul(c, f)));
  }
  return r;
}

export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  let ver = 0;
  for (let v = 1; v <= 10; v++) {
    const cap = (RAW[v] - BLOCKS[v] * ECC[v]) * 8;
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap) { ver = v; break; }
  }
  if (!ver) throw new Error('Too long for a QR code here.');
  const dataLen = RAW[ver] - BLOCKS[ver] * ECC[ver];
  // The bits: byte mode, the length, the bytes, a terminator, then padding.
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataLen * 8; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));

  // Error correction per block, then interleaved.
  const nb = BLOCKS[ver], ecLen = ECC[ver], raw = RAW[ver];
  const shortBlocks = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const div = rsDivisor(ecLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - ecLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecLen || j >= shortBlocks) codewords.push(b[i]); });

  // The grid: function patterns first, then the data, then the best mask.
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = ALIGN[ver];
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (mask) => {
    const d = (0 << 3) | mask; // level M is 00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
    set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
    set(8, size - 8, true);
  };
  format(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)); }
  }
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (!fn[y][x] && n < codewords.length * 8) { mod[y][x] = bit(codewords[n >>> 3], 7 - (n & 7)); n++; }
    }
  }
  const masks = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const apply = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[m](x, y)) mod[y][x] = !mod[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    apply(m); format(m);
    const s = penalty(mod, size);
    if (s < bestScore) { best = m; bestScore = s; }
    apply(m); // undo
  }
  apply(best); format(best);
  return mod;
}

// The standard penalty: long runs, 2×2 blocks, finder look-alikes, and dark/light balance.
function penalty(mod, size) {
  let s = 0;
  const lines = [];
  for (let y = 0; y < size; y++) lines.push(mod[y].map((d) => (d ? 1 : 0)));
  for (let x = 0; x < size; x++) lines.push(mod.map((row) => (row[x] ? 1 : 0)));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++;
      else { if (run >= 5) s += 3 + (run - 5); run = 1; }
    }
    const str = line.join('');
    for (const pat of ['10111010000', '00001011101']) for (let i = str.indexOf(pat); i !== -1; i = str.indexOf(pat, i + 1)) s += 40;
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) s += 3; }
  const dark = mod.reduce((n, row) => n + row.filter(Boolean).length, 0);
  s += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return s;
}

export function qrSvg(text, { scale = 6, color = '#000', bg = '#fff' } = {}) {
  const m = qrMatrix(text);
  const size = m.length, q = 4, w = (size + q * 2) * scale;
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) d += `M${(x + q) * scale} ${(y + q) * scale}h${scale}v${scale}h-${scale}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 ${w} ${w}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${bg}"/><path d="${d}" fill="${color}"/></svg>`;
}
