// Word documents (.docx) in Column: read one into something you can edit, and write the edit back.
// What Column can't edit (pictures, footnotes, equations, text boxes) rides along untouched, and the parts it
// never shows (styles, headers and footers, page setup) are copied over as they were.
// The page is built from elements, never from the file's own markup, so a document can't run anything.
window.ColumnWord = (() => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const REL = (t) => 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + t;
  const TYPE = (t) => `application/vnd.openxmlformats-officedocument.wordprocessingml.${t}+xml`;
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  // ---------- zip ----------
  function unzip(buf) {
    const dv = new DataView(buf);
    let end = buf.byteLength - 22;
    while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error('This isn’t a Word document Column can read.');
    const out = new Map();
    let p = dv.getUint32(end + 16, true);
    for (let n = dv.getUint16(end + 10, true); n > 0; n--) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), local = dv.getUint32(p + 42, true);
      const nameLen = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
      const raw = new Uint8Array(buf, local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), size);
      if (!name.endsWith('/')) {
        out.set(name, method === 0 ? async () => raw
          : async () => new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
      }
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return out;
  }
  const CRC = new Uint32Array(256).map((_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc32 = (d) => {
    let c = 0xffffffff;
    for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const deflate = async (d) => new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  // files: [[name, bytes]] → a .docx Blob.
  async function zip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const body = [], dir = [];
    let offset = 0;
    for (const [name, data] of files) {
      const nm = enc.encode(name);
      const packed = await deflate(data);
      const crc = crc32(data);
      const head = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 8, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, packed.length, 4], [22, data.length, 4], [26, nm.length, 2]]
        .forEach(([at, v, n]) => (n === 4 ? head.setUint32(at, v, true) : head.setUint16(at, v, true)));
      body.push(head, nm, packed);
      const c = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 8, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, packed.length, 4], [24, data.length, 4], [28, nm.length, 2], [42, offset, 4]]
        .forEach(([at, v, n]) => (n === 4 ? c.setUint32(at, v, true) : c.setUint16(at, v, true)));
      dir.push(c, nm);
      offset += 30 + nm.length + packed.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, dir.reduce((n, x) => n + x.byteLength, 0), true);
    end.setUint32(16, offset, true);
    return new Blob([...body, ...dir, end], { type: DOCX });
  }

  // ---------- xml ----------
  // An element made from a snippet of XML, ready to go into doc, without the snippet's own xmlns:w.
  const frag = (doc, src) => {
    const node = doc.importNode(parse(src).documentElement, true);
    node.removeAttributeNS('http://www.w3.org/2000/xmlns/', 'w');
    return node;
  };
  const parse = (src) => new DOMParser().parseFromString(typeof src === 'string' ? src : new TextDecoder().decode(src), 'application/xml');
  const kids = (el, tag) => (el ? [...el.children].filter((c) => c.localName === tag) : []);
  const kid = (el, tag) => kids(el, tag)[0] || null;
  const all = (el, tag) => (el ? [...el.getElementsByTagNameNS('*', tag)] : []);
  const val = (el) => (el ? el.getAttributeNS(W, 'val') : null);
  const on = (props, tag) => {
    const e = kid(props, tag);
    return !!e && !/^(0|false|none)$/.test(val(e) || '');
  };
  const out = (doc) => new TextEncoder().encode(XML_HEAD + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, ''));
  // Word wants the properties of a paragraph or a run in this order.
  const P_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
  const R_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange'];
  // Puts a property in its place, replacing any it had; null takes it away. node: an element, or attributes.
  function setProp(parent, order, tag, node) {
    for (const old of kids(parent, tag)) old.remove();
    if (!node) return;
    let el = node;
    if (!(node instanceof Element)) {
      el = parent.ownerDocument.createElementNS(W, 'w:' + tag);
      for (const [k, v] of Object.entries(node)) el.setAttributeNS(W, 'w:' + k, v);
    }
    const at = order.indexOf(tag);
    parent.insertBefore(el, [...parent.children].find((c) => order.indexOf(c.localName) > at) || null);
  }

  // ---------- the page ----------
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    e.append(...children);
    return e;
  };
  const HEADS = { H1: 'Title', H2: 'Heading1', H3: 'Heading2', H4: 'Heading3', H5: 'Heading4', H6: 'Heading5' };
  const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
  const dirOf = (name) => name.slice(0, name.lastIndexOf('/') + 1);
  function resolve(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = (dirOf(base) + target).split('/');
    const outp = [];
    for (const x of parts) x === '..' ? outp.pop() : x !== '.' && outp.push(x);
    return outp.join('/');
  }
  function listFmt(numbering, numId, lvl) {
    const num = all(numbering, 'num').find((n) => n.getAttributeNS(W, 'numId') === numId);
    const over = kids(num, 'lvlOverride').find((o) => o.getAttributeNS(W, 'ilvl') === String(lvl));
    const lvlOf = (holder) => kids(holder, 'lvl').find((l) => l.getAttributeNS(W, 'ilvl') === String(lvl));
    const abs = all(numbering, 'abstractNum').find((a) => a.getAttributeNS(W, 'abstractNumId') === val(kid(num, 'abstractNumId')));
    return val(kid(lvlOf(over) || lvlOf(abs), 'numFmt'));
  }
  const ordered = (numbering, numId, lvl) => !['bullet', 'none'].includes(listFmt(numbering, numId, lvl));

  // A .docx → { el, warn, save(el) → Blob, pictures(el) }. el is the document as HTML, ready to show or edit.
  async function read(buf) {
    const z = unzip(buf);
    const get = async (name) => (z.has(name) ? parse(await z.get(name)()) : null);
    const ct = await get('[Content_Types].xml');
    const pkgRels = await get('_rels/.rels');
    const mainRel = all(pkgRels, 'Relationship').find((r) => r.getAttribute('Type') === REL('officeDocument'));
    const main = mainRel ? resolve('', mainRel.getAttribute('Target')) : 'word/document.xml';
    const relsName = `${dirOf(main)}_rels/${main.slice(dirOf(main).length)}.rels`;
    const [xml, rels] = await Promise.all([get(main), get(relsName)]);
    const body = xml && all(xml, 'body').find((b) => b.namespaceURI === W);
    if (!ct || !body) throw new Error('This isn’t a Word document Column can read.');
    const relList = all(rels, 'Relationship');
    const partFor = (type) => {
      const r = relList.find((x) => x.getAttribute('Type') === REL(type));
      return r ? resolve(main, r.getAttribute('Target')) : null;
    };
    const numberingName = partFor('numbering');
    const stylesName = partFor('styles');
    const [numbering, styles] = await Promise.all([numberingName && get(numberingName), stylesName && get(stylesName)]);
    const target = (id) => relList.find((r) => r.getAttribute('Id') === id)?.getAttribute('Target') || null;

    // Pictures, loaded up front so the page can show them.
    const media = new Map();
    await Promise.all(relList.filter((r) => r.getAttribute('Type') === REL('image') && r.getAttribute('TargetMode') !== 'External').map(async (r) => {
      const name = resolve(main, r.getAttribute('Target'));
      const type = IMG_TYPES[(name.split('.').pop() || '').toLowerCase()];
      if (!type || !z.has(name)) return;
      const bytes = await z.get(name)();
      media.set(r.getAttribute('Id'), { bytes, type, url: URL.createObjectURL(new Blob([bytes], { type })) });
    }));

    const keep = []; // original pieces the page points back to with data-p, data-r, data-x, data-t, data-tr, data-c
    const ref = (node) => String(keep.push(node) - 1);
    const pics = new Map(); // data-x → the picture's bytes, for making a PDF
    const warn = new Set();
    const fld = []; // fields in progress: true while in the field's code, false in its result

    function atom(node, inline) {
      const i = ref(node);
      const blip = all(node, 'blip').find((b) => b.namespaceURI === A) || all(node, 'imagedata')[0];
      const pic = blip && media.get(blip.getAttributeNS(R, 'embed') || blip.getAttributeNS(R, 'id'));
      if (inline && pic && !all(node, 'txbxContent').length) {
        const ext = all(node, 'extent')[0];
        const w = ext ? Math.round(+ext.getAttribute('cx') / 9525) : null;
        const hgt = ext ? Math.round(+ext.getAttribute('cy') / 9525) : null;
        pics.set(i, { ...pic, w, h: hgt });
        return el('img', { class: 'wd-pic', src: pic.url, alt: 'Picture', 'data-x': i, contenteditable: 'false', ...(w ? { style: `width:${w}px` } : {}) });
      }
      const has = (tag) => all(node, tag).length > 0;
      let label = 'Kept as it is';
      if (has('txbxContent')) {
        label = 'Text box';
        warn.add('textbox');
      } else if (has('footnoteReference')) label = 'Footnote';
      else if (has('endnoteReference')) label = 'Endnote';
      else if (has('commentReference')) label = 'Comment';
      else if (has('oMath') || has('oMathPara')) label = 'Equation';
      else if (has('chart')) label = 'Chart';
      else if (has('drawing') || has('pict')) label = 'Picture';
      else if (has('object')) label = 'Embedded object';
      else if (has('sym')) label = 'Symbol';
      else if (all(node, 'br').some((b) => b.getAttributeNS(W, 'type') === 'page')) label = 'Page break';
      else if (all(node, 'br').some((b) => b.getAttributeNS(W, 'type') === 'column')) label = 'Column break';
      if (label === 'Page break') return el(inline ? 'span' : 'div', { class: 'wd-atom wd-break', 'data-x': i, contenteditable: 'false' }, label);
      return el(inline ? 'span' : 'div', { class: 'wd-atom', 'data-x': i, contenteditable: 'false', title: 'Column keeps this as it is' }, label);
    }

    function run(r, into) {
      const fc = kid(r, 'fldChar');
      if (fc) {
        warn.add('fields');
        const t = fc.getAttributeNS(W, 'fldCharType');
        if (t === 'begin') fld.push(true);
        else if (t === 'separate' && fld.length) fld[fld.length - 1] = false;
        else if (t === 'end') fld.pop();
        return;
      }
      if (fld.at(-1) || kid(r, 'instrText')) return;
      const rPr = kid(r, 'rPr');
      const parts = [];
      for (const x of r.children) {
        const n = x.localName;
        if (['rPr', 'lastRenderedPageBreak', 'softHyphen'].includes(n)) continue;
        if (n === 't') parts.push(x.textContent);
        else if (n === 'tab' || n === 'ptab') parts.push('\t');
        else if (n === 'noBreakHyphen') parts.push('-');
        else if (n === 'cr' || (n === 'br' && !['page', 'column'].includes(x.getAttributeNS(W, 'type')))) parts.push(el('br'));
        else return into.append(atom(r, true));
      }
      if (!parts.length) return;
      const extra = rPr && [...rPr.children].some((c) => !['b', 'bCs', 'i', 'iCs', 'u', 'strike'].includes(c.localName));
      let node = extra ? el('span', { 'data-r': ref(rPr) }, ...parts) : parts.length === 1 && typeof parts[0] === 'string' ? document.createTextNode(parts[0]) : el('span', {}, ...parts);
      if (!extra && node.tagName === 'SPAN') {
        const frag = document.createDocumentFragment();
        frag.append(...node.childNodes);
        node = frag;
      }
      for (const [tag, wrap] of [['strike', 's'], ['u', 'u'], ['i', 'i'], ['b', 'b']]) if (on(rPr, tag)) node = el(wrap, {}, node);
      into.append(node);
    }
    function inline(parent, into) {
      for (const c of parent.children) {
        const n = c.localName;
        if (n === 'r') run(c, into);
        else if (n === 'hyperlink') {
          const href = target(c.getAttributeNS(R, 'id')) || '';
          const a = /^(https?:|mailto:|tel:)/i.test(href) ? el('a', { href, target: '_blank', rel: 'noopener' }) : el('span');
          inline(c, a);
          into.append(a);
        } else if (n === 'sdt') inline(kid(c, 'sdtContent') || c, into);
        else if (['ins', 'moveTo', 'smartTag', 'fldSimple', 'customXml', 'sdtContent', 'dir', 'bdo'].includes(n)) {
          if (n === 'ins' || n === 'moveTo') warn.add('tracked');
          inline(c, into);
        } else if (n === 'del' || n === 'moveFrom') warn.add('tracked');
        else if (['pPr', 'bookmarkStart', 'bookmarkEnd', 'proofErr', 'permStart', 'permEnd', 'commentRangeStart', 'commentRangeEnd', 'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd'].includes(n)) continue;
        else into.append(atom(c, true));
      }
    }
    let sect = null;
    function blocks(parent, into) {
      let list = null;
      for (const c of parent.children) {
        const n = c.localName;
        if (n === 'p') {
          const pPr = kid(c, 'pPr');
          const head = /^(Title|Heading([1-6]))$/i.exec(val(kid(pPr, 'pStyle')) || '');
          const p = el(head ? (head[2] ? 'h' + Math.min(6, +head[2] + 1) : 'h1') : 'p', pPr ? { 'data-p': ref(pPr) } : {});
          const jc = val(kid(pPr, 'jc'));
          if (jc === 'center' || jc === 'right') p.style.textAlign = jc;
          else if (jc === 'both' || jc === 'distribute') p.style.textAlign = 'justify';
          inline(c, p);
          const num = kid(pPr, 'numPr');
          const numId = val(kid(num, 'numId'));
          if (numId && numId !== '0') {
            const lvl = Number(val(kid(num, 'ilvl'))) || 0;
            const ord = ordered(numbering, numId, lvl);
            if (!list || list.ordered !== ord) into.append((list = { ordered: ord, el: el(ord ? 'ol' : 'ul') }).el);
            const li = el('li', { 'data-p': p.dataset.p });
            li.append(...p.childNodes);
            li.style.textAlign = p.style.textAlign;
            if (lvl) li.style.marginLeft = lvl * 1.5 + 'em';
            if (!li.childNodes.length) li.append(el('br'));
            list.el.append(li);
            continue;
          }
          list = null;
          if (!p.childNodes.length) p.append(el('br'));
          into.append(p);
        } else if (n === 'tbl') {
          list = null;
          const t = el('table', { 'data-t': ref(c) });
          const tb = el('tbody');
          for (const tr of kids(c, 'tr')) {
            const row = el('tr', { 'data-tr': ref(tr) });
            for (const tc of kids(tr, 'tc')) {
              const td = el('td', { 'data-c': ref(tc) });
              const span = +val(kid(kid(tc, 'tcPr'), 'gridSpan')) || 1;
              if (span > 1) td.colSpan = span;
              blocks(tc, td);
              if (!td.childNodes.length) td.append(el('p', {}, el('br')));
              row.append(td);
            }
            tb.append(row);
          }
          t.append(tb);
          into.append(t);
        } else if (n === 'sdt' || n === 'customXml') {
          list = null;
          blocks(kid(c, 'sdtContent') || c, into);
        } else if (n === 'sectPr') sect = c;
        else if (['bookmarkStart', 'bookmarkEnd', 'proofErr', 'permStart', 'permEnd', 'commentRangeStart', 'commentRangeEnd', 'tblPr', 'tblGrid', 'tcPr', 'trPr'].includes(n)) continue;
        else {
          list = null;
          into.append(atom(c, false));
        }
      }
    }
    const root = el('div');
    blocks(body, root);
    if (!root.childNodes.length) root.append(el('p', {}, el('br')));
    const pkg = { z, ct, xml, main, rels, relsName, numbering, numberingName, styles, stylesName, sect, keep };
    return {
      el: root,
      warn: [...warn],
      save: (page) => write(pkg, page),
      picture: (i) => pics.get(String(i)) || null,
    };
  }

  // ---------- writing it back ----------
  const STYLES = {
    Title: '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>',
    Heading1: '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>',
    Heading2: '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="27"/><w:szCs w:val="27"/></w:rPr></w:style>',
    Heading3: '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>',
    Heading4: '<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="40"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>',
    Heading5: '<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="40"/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>',
    Hyperlink: '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>',
  };
  const BASE_STYLES = `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  const lvls = (ord) => Array.from({ length: 9 }, (_, i) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ord ? ['decimal', 'lowerLetter', 'lowerRoman'][i % 3] : 'bullet'}"/><w:lvlText w:val="${ord ? `%${i + 1}.` : ['•', '◦', '▪'][i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  const BORDERS = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('')}</w:tblBorders>`;

  // How a piece of the page is styled: bold, italic, underlined, struck through, from its tags and inline styles.
  function styleOf(node, st) {
    const s = { ...st };
    const t = node.tagName;
    if (t === 'B' || t === 'STRONG') s.b = true;
    if (t === 'I' || t === 'EM') s.i = true;
    if (t === 'U' || t === 'INS') s.u = true;
    if (t === 'S' || t === 'STRIKE' || t === 'DEL') s.s = true;
    const css = node.style;
    if (css) {
      if (css.fontWeight) s.b = css.fontWeight === 'bold' || css.fontWeight === 'bolder' || +css.fontWeight >= 600;
      if (css.fontStyle) s.i = css.fontStyle === 'italic' || css.fontStyle === 'oblique';
      const deco = css.textDecorationLine || css.textDecoration || '';
      if (deco.includes('underline')) s.u = true;
      if (deco.includes('line-through')) s.s = true;
    }
    if (node.dataset?.r != null) s.r = node.dataset.r;
    return s;
  }
  const BLOCK = /^(P|DIV|H[1-6]|BLOCKQUOTE|PRE|UL|OL|TABLE|HR|SECTION|ARTICLE)$/;

  async function write(pkg, page) {
    const xml = pkg.xml.cloneNode(true);
    const body = all(xml, 'body').find((b) => b.namespaceURI === W);
    body.replaceChildren();
    const rels = pkg.rels ? pkg.rels.cloneNode(true) : parse(`<Relationships xmlns="${PR}"/>`);
    const ct = pkg.ct.cloneNode(true);
    let numbering = pkg.numbering?.cloneNode(true) || null;
    let numberingName = pkg.numberingName;
    let styles = pkg.styles?.cloneNode(true) || null;
    let stylesName = pkg.stylesName;
    const added = new Map();
    const w = (tag) => xml.createElementNS(W, 'w:' + tag);
    const take = (i) => xml.importNode(pkg.keep[i], true);
    const usedStyles = new Set();

    const relIds = new Set(all(rels, 'Relationship').map((r) => r.getAttribute('Id')));
    function addRel(type, tgt, external) {
      let n = 1;
      while (relIds.has('rIdC' + n)) n++;
      const id = 'rIdC' + n;
      relIds.add(id);
      const r = rels.createElementNS(PR, 'Relationship');
      r.setAttribute('Id', id);
      r.setAttribute('Type', type);
      r.setAttribute('Target', tgt);
      if (external) r.setAttribute('TargetMode', 'External');
      rels.documentElement.append(r);
      return id;
    }
    // New pictures from the page (PNG or JPEG data URLs, from a Column doc): each becomes a media part.
    let picN = 0;
    function picture(img, into) {
      const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(img.getAttribute('src') || '');
      if (!m) return;
      const ext = m[1] === 'png' ? 'png' : 'jpeg';
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const name = `media/column-${Date.now().toString(36)}-${++picN}.${ext}`;
      added.set(dirOf(pkg.main) + name, bytes);
      const rid = addRel(REL('image'), name);
      if (!all(ct, 'Default').some((d) => d.getAttribute('Extension') === ext)) {
        const dft = ct.createElementNS(CT, 'Default');
        dft.setAttribute('Extension', ext);
        dft.setAttribute('ContentType', 'image/' + ext);
        ct.documentElement.prepend(dft);
      }
      // Sized as it was, no wider than the page (6.5 inches); 9525 EMU to a pixel.
      const pw = +img.dataset.w || 600, ph = +img.dataset.h || 400;
      const cx = Math.round(Math.min(pw * 9525, 6.5 * 914400));
      const cy = Math.round((cx * ph) / pw);
      const id = 4000 + picN;
      into.append(frag(xml, `<w:r xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="${A}" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="${R}"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${picN}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${picN}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`));
    }
    const linkRel = (href) => all(rels, 'Relationship').find((r) => r.getAttribute('Type') === REL('hyperlink') && r.getAttribute('Target') === href)?.getAttribute('Id') || addRel(REL('hyperlink'), href, true);
    function addPart(name, type, relType) {
      addRel(REL(relType), name.slice(dirOf(pkg.main).length));
      const o = ct.createElementNS(CT, 'Override');
      o.setAttribute('PartName', '/' + name);
      o.setAttribute('ContentType', TYPE(type));
      ct.documentElement.append(o);
    }

    // Lists Column starts: bullets share one list; each numbered list counts from 1.
    let bulletNum = null, numberAbs = null;
    const maxOf = (tag, attr) => Math.max(0, ...all(numbering, tag).map((x) => +x.getAttributeNS(W, attr) || 0));
    function numPart() {
      if (numbering) return;
      numbering = parse(`<w:numbering xmlns:w="${W}"/>`);
      numberingName = dirOf(pkg.main) + 'numbering.xml';
      addPart(numberingName, 'numbering', 'numbering');
    }
    function abstract(ord) {
      const id = maxOf('abstractNum', 'abstractNumId') + 1;
      const node = frag(numbering, `<w:abstractNum xmlns:w="${W}" w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(ord)}</w:abstractNum>`);
      numbering.documentElement.insertBefore(node, kid(numbering.documentElement, 'num') || kid(numbering.documentElement, 'numIdMacAtCleanup'));
      return id;
    }
    function num(abs, restart) {
      const id = maxOf('num', 'numId') + 1;
      const node = frag(numbering, `<w:num xmlns:w="${W}" w:numId="${id}"><w:abstractNumId w:val="${abs}"/>${restart ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`);
      numbering.documentElement.insertBefore(node, kid(numbering.documentElement, 'numIdMacAtCleanup'));
      return String(id);
    }
    function newList(ord) {
      numPart();
      if (!ord) return (bulletNum ||= num(abstract(false), false));
      return num((numberAbs ||= abstract(true)), true);
    }

    // A section break goes with the last paragraph that grew out of the one that had it.
    const left = {};
    for (const e of page.querySelectorAll('[data-p]')) left[e.dataset.p] = (left[e.dataset.p] || 0) + 1;

    function pProps(e, tag, list) {
      const i = e.dataset.p;
      const pPr = i != null && pkg.keep[i] ? take(i) : w('pPr');
      if (i != null && --left[i] > 0) kids(pPr, 'sectPr').forEach((x) => x.remove());
      const style = val(kid(pPr, 'pStyle')) || '';
      if (HEADS[tag]) {
        setProp(pPr, P_ORDER, 'pStyle', { val: HEADS[tag] });
        usedStyles.add(HEADS[tag]);
      } else if (tag === 'P' && /^(Title|Heading\d)$/i.test(style)) setProp(pPr, P_ORDER, 'pStyle', null);
      if (list) {
        const np = w('numPr');
        const il = w('ilvl');
        il.setAttributeNS(W, 'w:val', String(list.ilvl));
        const ni = w('numId');
        ni.setAttributeNS(W, 'w:val', list.numId);
        np.append(il, ni);
        setProp(pPr, P_ORDER, 'numPr', np);
      } else setProp(pPr, P_ORDER, 'numPr', null);
      const align = { center: 'center', right: 'right', justify: 'both' }[e.style?.textAlign];
      const jc = val(kid(pPr, 'jc'));
      if (align) setProp(pPr, P_ORDER, 'jc', { val: align });
      else if (['center', 'right', 'both', 'distribute'].includes(jc)) setProp(pPr, P_ORDER, 'jc', null);
      return pPr;
    }

    function runProps(st) {
      const rPr = st.r != null && pkg.keep[st.r] ? take(st.r) : w('rPr');
      const flag = (tag, want, attrs = {}) => {
        if (want === undefined) return;
        const cur = on(rPr, tag);
        if (want && !cur) setProp(rPr, R_ORDER, tag, attrs);
        else if (!want && cur) setProp(rPr, R_ORDER, tag, null);
        if (!want && tag !== 'u') setProp(rPr, R_ORDER, tag + 'Cs', null);
      };
      flag('b', st.b);
      flag('i', st.i);
      flag('u', st.u, { val: 'single' });
      flag('strike', st.s);
      // Unbolding text inside a heading turns its bold off outright.
      if (st.b === false && st.heading) setProp(rPr, R_ORDER, 'b', { val: '0' });
      if (st.link && st.r == null) {
        setProp(rPr, R_ORDER, 'rStyle', { val: 'Hyperlink' });
        usedStyles.add('Hyperlink');
      }
      return rPr.children.length ? rPr : null;
    }
    function text(str, into, st) {
      if (!str) return;
      const r = w('r');
      const rPr = runProps(st);
      if (rPr) r.append(rPr);
      for (const bit of str.split(/(\t|\n)/)) {
        if (!bit) continue;
        if (bit === '\t') r.append(w('tab'));
        else if (bit === '\n') r.append(w('br'));
        else {
          const t = w('t');
          t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
          t.textContent = bit;
          r.append(t);
        }
      }
      into.append(r);
    }
    function inlineXml(node, into, st) {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          text(c.data.replace(/​/g, ''), into, st);
          continue;
        }
        if (c.nodeType !== 1) continue;
        const t = c.tagName;
        if (t === 'UL' || t === 'OL' || t === 'TABLE' || t === 'SCRIPT' || t === 'STYLE') continue;
        if (c.dataset.x != null) {
          // A piece kept from between paragraphs (shown as a block) can't sit inside one.
          if (pkg.keep[c.dataset.x] && t !== 'DIV') into.append(take(c.dataset.x));
          continue;
        }
        if (t === 'BR') {
          const r = w('r');
          r.append(w('br'));
          into.append(r);
          continue;
        }
        if (t === 'IMG') {
          picture(c, into);
          continue;
        }
        const s = styleOf(c, st);
        const href = t === 'A' ? c.getAttribute('href') || '' : '';
        if (href && /^(https?:|mailto:|tel:)/i.test(href)) {
          const hl = w('hyperlink');
          hl.setAttributeNS(R, 'r:id', linkRel(href));
          inlineXml(c, hl, { ...s, link: true });
          if (hl.children.length) into.append(hl);
          continue;
        }
        inlineXml(c, into, s);
      }
    }
    function paragraph(e, tag, list) {
      const p = w('p');
      p.append(pProps(e, tag, list));
      inlineXml(e, p, { heading: !!HEADS[tag] });
      // The browser's stand-in line break at the end of a paragraph isn't part of it.
      const stray = (r) => r?.localName === 'r' && r.children.length === 1 && r.firstElementChild.localName === 'br' && !r.firstElementChild.hasAttributeNS(W, 'type');
      while (stray(p.lastElementChild)) p.lastElementChild.remove();
      return p;
    }
    function listXml(listEl, into, depth) {
      const ord = listEl.tagName === 'OL';
      let fresh = null;
      for (const li of listEl.children) {
        if (li.tagName === 'UL' || li.tagName === 'OL') {
          listXml(li, into, depth + 1);
          continue;
        }
        const i = li.dataset.p;
        const orig = i != null && pkg.keep[i] && kid(pkg.keep[i], 'numPr');
        const oNum = orig && val(kid(orig, 'numId'));
        const oLvl = (orig && +val(kid(orig, 'ilvl'))) || 0;
        let spec;
        if (oNum && oNum !== '0' && pkg.numbering && ordered(pkg.numbering, oNum, oLvl) === ord) spec = { numId: oNum, ilvl: Math.min(8, oLvl + depth - 1) };
        else spec = { numId: (fresh ||= newList(ord)), ilvl: Math.min(8, depth - 1) };
        into.append(paragraph(li, 'LI', spec));
        for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') listXml(sub, into, depth + 1);
      }
    }
    function tableXml(t) {
      const orig = t.dataset.t != null ? pkg.keep[t.dataset.t] : null;
      const tbl = w('tbl');
      const tblPr = orig && kid(orig, 'tblPr');
      tbl.append(tblPr ? xml.importNode(tblPr, true) : frag(xml, `<w:tblPr xmlns:w="${W}"><w:tblW w:w="0" w:type="auto"/>${BORDERS}</w:tblPr>`));
      const rows = [...t.rows];
      const cols = Math.max(1, ...rows.map((r) => [...r.cells].reduce((n, c) => n + (c.colSpan || 1), 0)));
      const og = orig && kid(orig, 'tblGrid');
      if (og && kids(og, 'gridCol').length === cols) tbl.append(xml.importNode(og, true));
      else {
        const grid = w('tblGrid');
        for (let i = 0; i < cols; i++) {
          const gc = w('gridCol');
          gc.setAttributeNS(W, 'w:w', String(Math.floor(9360 / cols)));
          grid.append(gc);
        }
        tbl.append(grid);
      }
      for (const r of rows) {
        const tr = w('tr');
        const trPr = r.dataset.tr != null && kid(pkg.keep[r.dataset.tr], 'trPr');
        if (trPr) tr.append(xml.importNode(trPr, true));
        for (const c of r.cells) {
          const tc = w('tc');
          const tcPr = c.dataset.c != null && kid(pkg.keep[c.dataset.c], 'tcPr');
          if (tcPr) tc.append(xml.importNode(tcPr, true));
          else {
            const pr = w('tcPr');
            const tw = w('tcW');
            tw.setAttributeNS(W, 'w:w', String(Math.floor((9360 / cols) * (c.colSpan || 1))));
            tw.setAttributeNS(W, 'w:type', 'dxa');
            pr.append(tw);
            if (c.colSpan > 1) {
              const gs = w('gridSpan');
              gs.setAttributeNS(W, 'w:val', String(c.colSpan));
              pr.append(gs);
            }
            tc.append(pr);
          }
          blocksXml(c, tc);
          // A cell always ends with a paragraph.
          if (tc.lastElementChild?.localName !== 'p') tc.append(w('p'));
          tr.append(tc);
        }
        if (tr.getElementsByTagNameNS(W, 'tc').length) tbl.append(tr);
      }
      return tbl;
    }
    function blocksXml(container, into) {
      let loose = null;
      const flush = () => {
        if (loose) into.append(paragraph(loose, 'P', null));
        loose = null;
      };
      for (const c of container.childNodes) {
        if (c.nodeType === 3 && !loose && !c.data.trim()) continue;
        const t = c.nodeType === 1 ? c.tagName : '';
        if (t && c.dataset.x != null && !/^(IMG|SPAN)$/.test(t)) {
          flush();
          const kept = pkg.keep[c.dataset.x] && take(c.dataset.x);
          if (kept && kept.localName !== 'r') into.append(kept);
          else if (kept) {
            const p = w('p');
            p.append(kept);
            into.append(p);
          }
          continue;
        }
        if (BLOCK.test(t)) {
          flush();
          if (t === 'UL' || t === 'OL') listXml(c, into, 1);
          else if (t === 'TABLE') into.append(tableXml(c));
          else if (t === 'HR') continue;
          else if ([...c.children].some((k) => BLOCK.test(k.tagName) && k.tagName !== 'HR')) blocksXml(c, into);
          else into.append(paragraph(c, HEADS[t] ? t : 'P', null));
          continue;
        }
        (loose ||= document.createElement('p')).append(c.cloneNode(true));
      }
      flush();
    }

    blocksXml(page, body);
    if (!body.children.length || body.lastElementChild.localName === 'tbl') body.append(w('p'));
    if (pkg.sect) body.append(xml.importNode(pkg.sect, true));

    // Styles the page uses that the document doesn't have yet.
    if (usedStyles.size) {
      if (!styles) {
        styles = parse(BASE_STYLES);
        stylesName = dirOf(pkg.main) + 'styles.xml';
        addPart(stylesName, 'styles', 'styles');
      }
      const have = new Set(all(styles, 'style').map((s) => s.getAttributeNS(W, 'styleId')));
      for (const id of usedStyles) if (!have.has(id)) styles.documentElement.append(frag(styles, STYLES[id].replace('<w:style ', `<w:style xmlns:w="${W}" `)));
      added.set(stylesName, out(styles));
    }
    if (numbering) added.set(numberingName, out(numbering));
    added.set(pkg.main, out(xml));
    added.set(pkg.relsName, out(rels));
    added.set('[Content_Types].xml', out(ct));
    const names = ['[Content_Types].xml', ...[...pkg.z.keys()].filter((n) => n !== '[Content_Types].xml')];
    for (const n of added.keys()) if (!names.includes(n)) names.push(n);
    const files = [];
    for (const n of names) files.push([n, added.get(n) || (await pkg.z.get(n)())]);
    return zip(files);
  }

  // A new, empty document: US Letter, one-inch margins, Calibri.
  async function blank() {
    const enc = (s) => new TextEncoder().encode(XML_HEAD + s);
    return zip([
      ['[Content_Types].xml', enc(`<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${TYPE('document.main')}"/><Override PartName="/word/styles.xml" ContentType="${TYPE('styles')}"/></Types>`)],
      ['_rels/.rels', enc(`<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${REL('officeDocument')}" Target="word/document.xml"/></Relationships>`)],
      ['word/_rels/document.xml.rels', enc(`<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${REL('styles')}" Target="styles.xml"/></Relationships>`)],
      ['word/document.xml', enc(`<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`)],
      ['word/styles.xml', enc(BASE_STYLES.replace('</w:styles>', Object.values(STYLES).join('') + '</w:styles>'))],
    ]);
  }

  // The page as plain blocks for making a PDF: { t: p|h1…h6|li|table|img|break, runs: [{ text, b, i, u, s, link }] }.
  async function outline(page, doc) {
    const blocks = [];
    const toData = (bytes, type) => new Promise((done) => {
      const fr = new FileReader();
      fr.onload = () => done(fr.result);
      fr.readAsDataURL(new Blob([bytes], { type }));
    });
    const runsOf = async (e, into, st, pending) => {
      for (const c of e.childNodes) {
        if (c.nodeType === 3) {
          if (c.data) into.push({ text: c.data, ...pick(st) });
          continue;
        }
        if (c.nodeType !== 1 || c.tagName === 'UL' || c.tagName === 'OL' || c.tagName === 'TABLE') continue;
        if (c.dataset.x != null) {
          if (c.classList.contains('wd-break')) pending.push({ t: 'break' });
          const pic = c.tagName === 'IMG' && doc?.picture(c.dataset.x);
          if (pic && /^image\/(png|jpeg)$/.test(pic.type)) pending.push({ t: 'img', src: await toData(pic.bytes, pic.type), w: pic.w || c.naturalWidth, h: pic.h || c.naturalHeight });
          continue;
        }
        if (c.tagName === 'BR') {
          into.push({ text: '\n' });
          continue;
        }
        const s = styleOf(c, st);
        if (c.tagName === 'A') s.link = true;
        if (BLOCK.test(c.tagName) && into.length) into.push({ text: '\n' });
        await runsOf(c, into, s, pending);
      }
    };
    const pick = (st) => Object.fromEntries(['b', 'i', 'u', 's', 'link'].filter((k) => st[k]).map((k) => [k, true]));
    const trim = (runs) => {
      while (runs.length && runs.at(-1).text === '\n') runs.pop();
      return runs;
    };
    async function walk(container, into, depth) {
      let loose = null;
      const flush = async () => {
        if (!loose) return;
        const pending = [];
        const runs = [];
        await runsOf(loose, runs, {}, pending);
        into.push({ t: 'p', runs: trim(runs) }, ...pending);
        loose = null;
      };
      for (const c of container.childNodes) {
        const t = c.nodeType === 1 ? c.tagName : '';
        if (c.nodeType === 3 && !loose && !c.data.trim()) continue;
        if (t && c.dataset.x != null && t !== 'IMG' && t !== 'SPAN') {
          await flush();
          if (c.classList.contains('wd-break')) into.push({ t: 'break' });
          continue;
        }
        if (t === 'UL' || t === 'OL') {
          await flush();
          let n = 0;
          for (const li of c.children) {
            if (li.tagName === 'UL' || li.tagName === 'OL') {
              await walk(el('div', {}, li.cloneNode(true)), into, depth + 1);
              continue;
            }
            const pending = [];
            const runs = [];
            await runsOf(li, runs, {}, pending);
            into.push({ t: 'li', ordered: t === 'OL', n: ++n, lvl: depth + (parseFloat(li.style.marginLeft) / 1.5 || 0), align: li.style.textAlign || '', runs: trim(runs) }, ...pending);
            for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') await walk(el('div', {}, sub.cloneNode(true)), into, depth + 1);
          }
          continue;
        }
        if (t === 'TABLE') {
          await flush();
          const rows = [];
          for (const r of c.rows) {
            const cells = [];
            for (const td of r.cells) {
              const inner = [];
              await walk(td, inner, 0);
              cells.push(inner.filter((b) => b.t !== 'table' && b.t !== 'img' && b.t !== 'break'));
            }
            rows.push(cells);
          }
          into.push({ t: 'table', rows });
          continue;
        }
        if (BLOCK.test(t)) {
          await flush();
          if (t === 'HR') continue;
          if ([...c.children].some((k) => BLOCK.test(k.tagName))) {
            await walk(c, into, depth);
            continue;
          }
          const pending = [];
          const runs = [];
          await runsOf(c, runs, {}, pending);
          into.push({ t: /^H[1-6]$/.test(t) ? t.toLowerCase() : 'p', align: c.style.textAlign || '', runs: trim(runs) }, ...pending);
          continue;
        }
        (loose ||= document.createElement('p')).append(c.cloneNode(true));
      }
      await flush();
    }
    await walk(page, blocks, 0);
    return blocks;
  }

  return { read, blank, outline, DOCX };
})();
