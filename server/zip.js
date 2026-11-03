// Streams a store-only (uncompressed) zip. CRCs and sizes are computed at upload time,
// so no data descriptors are needed and every unzip tool is happy. (Limit: 4 GB per folder.)
import fs from 'node:fs';
import zlib from 'node:zlib';

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function write(out, buf) {
  return new Promise((resolve) => (out.write(buf) ? resolve() : out.once('drain', resolve)));
}

function pipeFile(out, path) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(path);
    rs.on('error', reject);
    rs.on('end', resolve);
    rs.pipe(out, { end: false });
  });
}

export function zipSize(entries) {
  let total = 22;
  for (const e of entries) {
    const n = Buffer.byteLength(e.name);
    total += 30 + n + e.size + 46 + n;
  }
  return total;
}

// entries: [{ name, path, size, crc, mtime }]
export async function streamZip(out, entries) {
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const { time, date } = dosDateTime(new Date(e.mtime || Date.now()));
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // utf-8 names
    h.writeUInt16LE(0, 8); // stored
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(e.crc >>> 0, 14);
    h.writeUInt32LE(e.size, 18);
    h.writeUInt32LE(e.size, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    await write(out, h);
    await write(out, name);
    if (e.size > 0) await pipeFile(out, e.path);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(e.crc >>> 0, 16);
    c.writeUInt32LE(e.size, 20);
    c.writeUInt32LE(e.size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + e.size;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(out, cd);
  await write(out, end);
  out.end();
}

// ---------- a zip written to a file, for exports ----------
// Small text files are compressed; uploaded files are copied in as they are (most are compressed already)
// with their checksum worked out on the way, so a big team never has to fit in memory. Same 4 GB limit.
const LIMIT = 0xffffffff;
const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = zlib.crc32 || ((buf, prev = 0) => {
  let c = ~prev >>> 0;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
});

export function createZip(outPath) {
  const fd = fs.openSync(outPath, 'w');
  let at = 0;
  const central = [];
  const names = new Set();
  const write = (buf) => {
    if (at + buf.length > LIMIT) throw Object.assign(new Error('This export is over 4 GB. Contact support to get it another way.'), { status: 413 });
    fs.writeSync(fd, buf);
    at += buf.length;
  };
  // Two files can't share a path: the second becomes "name (2).ext".
  const unique = (name) => {
    const base = name.replace(/\\/g, '/').replace(/^\/+/, '').split('/').map((p) => p.replace(/^\.+$/, '_').slice(0, 120) || '_').join('/');
    let n = base;
    for (let i = 2; names.has(n.toLowerCase()); i++) n = base.replace(/(\.[^./]*)?$/, ` (${i})$1`);
    names.add(n.toLowerCase());
    return n;
  };
  function header(name, method, crc, size, csize, when) {
    const nm = Buffer.from(name, 'utf8');
    const { time, date } = dosDateTime(when);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // names are UTF-8
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(csize, 18);
    h.writeUInt32LE(size, 22);
    h.writeUInt16LE(nm.length, 26);
    return { h, nm, time, date };
  }
  function record(name, method, crc, size, csize, offset, time, date, nm) {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(csize, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(nm.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([c, nm]));
  }
  return {
    // Text or a small buffer, compressed.
    add(name, data, when = new Date()) {
      name = unique(name);
      const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
      const comp = zlib.deflateRawSync(raw);
      const crc = crc32(raw);
      const offset = at;
      const { h, nm, time, date } = header(name, 8, crc, raw.length, comp.length, when);
      write(h); write(nm); write(comp);
      record(name, 8, crc, raw.length, comp.length, offset, time, date, nm);
    },
    // A file on disk, stored as it is. Read twice (once for the checksum) so the header can be written first.
    async addFile(name, file, when = new Date()) {
      const st = await fs.promises.stat(file).catch(() => null);
      if (!st?.isFile()) return false;
      name = unique(name);
      let crc = 0;
      for await (const chunk of fs.createReadStream(file)) crc = crc32(chunk, crc);
      const offset = at;
      const { h, nm, time, date } = header(name, 0, crc, st.size, st.size, when);
      write(h); write(nm);
      for await (const chunk of fs.createReadStream(file)) write(chunk);
      record(name, 0, crc, st.size, st.size, offset, time, date, nm);
      return true;
    },
    finish() {
      const start = at;
      for (const c of central) write(c);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(central.length, 8);
      end.writeUInt16LE(central.length, 10);
      end.writeUInt32LE(at - start, 12);
      end.writeUInt32LE(start, 16);
      write(end);
      fs.closeSync(fd);
      return at;
    },
    abort() {
      try { fs.closeSync(fd); } catch {}
      fs.rmSync(outPath, { force: true });
    },
  };
}
