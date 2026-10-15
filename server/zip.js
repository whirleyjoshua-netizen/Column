// Streams a store-only (uncompressed) zip. CRCs and sizes are computed at upload time,
// so no data descriptors are needed and every unzip tool is happy. (Limit: 4 GB per folder.)
import fs from 'node:fs';

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
