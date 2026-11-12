// For tests: a zip made in memory (deflated entries with their CRCs, UTF-8 names), and a small Notion export
// ("Markdown & CSV": pages, a page inside a page, a callout, a toggle, a table, code, a picture, a database with its
// row pages) in a "Part-1" zip inside the zip, as Notion sends big workspaces. Not a test by itself.
import zlib from 'node:zlib';
// A zip, made here: deflated entries with their CRCs.
export function makeZip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, data0] of files) {
    const data = Buffer.isBuffer(data0) ? data0 : Buffer.from(data0);
    const comp = zlib.deflateRawSync(data);
    const nm = Buffer.from(name);
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
export const ID = (c) => c.repeat(32);
export const HB = `Handbook ${ID('1')}`;
const enc = (s) => encodeURIComponent(s).replace(/'/g, '%27');
export const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const CSV = 'Name,Status,Due,Amount,Done,Email\nSmith job,Booked,"November 11, 2026",$1200,Yes,a@b.co\nJones job,Lead,2026/12/01,$800,No,c@d.co\nLee job,Booked,,$50,No,\n';
export const pages = [
  [`${HB}.md`, `# Handbook

Welcome to **our** handbook. See [Pricing](${enc(HB)}/${enc('Pricing ' + ID('2'))}.md) and [the web](https://example.com/guide).

<aside>
💡 Read this first
</aside>

[Safety](${enc(HB)}/${enc('Safety ' + ID('3'))}.md)

- [ ] Hard hat
- [x] Boots
    - nested item
1. One
2. Two

| Item | Price |
| --- | --- |
| Shutter | $120 |

\`\`\`js
let x = 1
\`\`\`

> A quote

---

![photo](${enc(HB)}/photo.png)

[Jobs](${enc(HB)}/${enc('Jobs ' + ID('4'))}.csv)
`],
  [`${HB}/Pricing ${ID('2')}.md`, `# Pricing\n\nShutters cost more. Back to [Handbook](../${enc(HB)}.md).\n`],
  [`${HB}/Safety ${ID('3')}.md`, `# Safety\n\n<details>\n<summary>Ladders</summary>\n\nThree points of contact\n\n</details>\n\nAfter the toggle\n`],
  [`${HB}/photo.png`, PNG],
  [`${HB}/Jobs ${ID('4')}.csv`, CSV],
  [`${HB}/Jobs ${ID('4')}_all.csv`, CSV],
  [`${HB}/Jobs ${ID('4')}/Smith job ${ID('5')}.md`, `# Smith job\n\nStatus: Booked\nDue: November 11, 2026\n\nCustomer wants white shutters.\n`],
  [`${HB}/Jobs ${ID('4')}/Jones job ${ID('6')}.md`, `# Jones job\n\nStatus: Lead\n`],
  [`Ideas ${ID('7')}.md`, `# Ideas\n\nA [link to pricing](https://www.notion.so/Pricing-${ID('2')}).\n`],
  ['../../evil ' + ID('8') + '.md', '# Evil\n\nNothing happens.\n'],
  [`Huge ${ID('9')}.md`, '# Huge\n\n' + 'a'.repeat(6 * 1024 * 1024)],
];
export const inner = makeZip(pages.map(([n, d]) => ['Export-abc/' + n, d]));
export const notionZip = makeZip([['Export-abc-Part-1.zip', inner]]);
