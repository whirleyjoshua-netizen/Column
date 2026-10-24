// The words in a file, for the AI to read: Word, Excel and PowerPoint files are zips of XML,
// so they're opened here; text files are read as they are. PDFs and images go to the AI whole.
import zlib from 'node:zlib';

// A zip's files by name, from its central directory.
function readZip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a zip');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const skip = nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    files.set(name, () => {
      const raw = buf.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    });
    p += 46 + skip;
  }
  return files;
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const tidy = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const byNumber = (re) => (a, b) => Number(re.exec(a)?.[1]) - Number(re.exec(b)?.[1]);

function wordText(zip) {
  const xml = zip.get('word/document.xml')?.() || '';
  return tidy(unescape(xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')));
}

function slidesText(zip) {
  const re = /slide(\d+)\.xml$/;
  const names = [...zip.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber(re));
  return names.map((n, i) => `Slide ${i + 1}\n` + tidy(unescape(zip.get(n)().replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')))).join('\n\n');
}

// Each sheet as rows of tab-separated cells.
function sheetsText(zip) {
  const strings = [...(zip.get('xl/sharedStrings.xml')?.() || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const titles = [...(zip.get('xl/workbook.xml')?.() || '').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => unescape(m[1]));
  const re = /sheet(\d+)\.xml$/;
  const names = [...zip.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(byNumber(re));
  return names.map((n, i) => {
    const rows = [...zip.get(n)().matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
      [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const inner = c[2] || '';
        if (/t="s"/.test(c[1])) return strings[Number(/<v>([^<]*)<\/v>/.exec(inner)?.[1])] ?? '';
        if (/t="inlineStr"/.test(c[1])) return unescape([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        return unescape(/<v>([^<]*)<\/v>/.exec(inner)?.[1] || '');
      }).join('\t').replace(/\t+$/, ''),
    ).filter(Boolean);
    return `Sheet: ${titles[i] || i + 1}\n${rows.join('\n')}`;
  }).join('\n\n');
}

export const officeKind = (name) => /\.(docx|xlsx|pptx)$/i.exec(name)?.[1].toLowerCase() || null;

export function fileText(buf, name) {
  const office = officeKind(name);
  if (office) {
    const zip = readZip(buf);
    return office === 'docx' ? wordText(zip) : office === 'xlsx' ? sheetsText(zip) : slidesText(zip);
  }
  const text = buf.toString('utf8');
  if (/\.html?$/i.test(name)) return tidy(unescape(text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|li|h\d|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')));
  return text;
}
