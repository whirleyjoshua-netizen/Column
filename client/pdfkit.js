// PDFs in Column: pages drawn with pdf.js (hosted with Column, loaded the first time a PDF opens), and a pad
// for drawing or typing a signature. Shared by the app and the signing page (sign.html).
window.ColumnPdf = (() => {
  const BASE = '/vendor/pdfjs-5.7.284/';
  let lib;
  const pdfjs = () =>
    (lib ||= import(BASE + 'pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';
      return m;
    }));
  const el = (tag, cls, attrs = {}) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, attrs);

  async function open(url) {
    const m = await pdfjs();
    return m.getDocument({
      url, isEvalSupported: false, enableXfa: false,
      standardFontDataUrl: BASE + 'standard_fonts/', cMapUrl: BASE + 'cmaps/', cMapPacked: true, wasmUrl: BASE + 'wasm/', iccUrl: BASE + 'iccs/',
    }).promise;
  }

  // Lays out every page at the given width and draws each one as it scrolls into view.
  // onPage(p) gets { n, page, vp, el, layer } for each page, for whatever goes on top of it.
  async function pages(doc, host, { width, onPage }) {
    const out = [];
    const draw = async (p) => {
      if (p.drawn) return;
      p.drawn = true;
      const vp = p.page.getViewport({ scale: p.vp.scale * Math.min(window.devicePixelRatio || 1, 2) });
      p.canvas.width = Math.floor(vp.width);
      p.canvas.height = Math.floor(vp.height);
      await p.page.render({ canvasContext: p.canvas.getContext('2d'), viewport: vp }).promise.catch(() => {});
    };
    const io = new IntersectionObserver((seen) => seen.forEach((e) => e.isIntersecting && draw(e.target.pdfPage)), { rootMargin: '400px 0px' });
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (!host.isConnected && i > 1) break;
      const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const box = el('div', 'pdf-page');
      Object.assign(box.style, { width: vp.width + 'px', height: vp.height + 'px' });
      const canvas = el('canvas');
      const layer = el('div', 'pdf-layer');
      box.append(canvas, layer);
      host.append(box);
      const p = { n: i - 1, page, vp, el: box, layer, canvas, drawn: false };
      box.pdfPage = p;
      out.push(p);
      io.observe(box);
      onPage?.(p);
    }
    return { pages: out, stop: () => io.disconnect() };
  }

  // Between the screen and the PDF. A mark is { page, x, y, w, h } in PDF points, where x, y is its
  // bottom-left corner as the page is shown (the server draws it the same way, rotated pages included).
  function toPdf(p, left, top, w, h) {
    const [x, y] = p.vp.convertToPdfPoint(left, top + h);
    return { page: p.n, x, y, w: w / p.vp.scale, h: h / p.vp.scale };
  }
  function fromPdf(p, m) {
    const [left, bottom] = p.vp.convertToViewportPoint(m.x, m.y);
    return { left, top: bottom - m.h * p.vp.scale, w: m.w * p.vp.scale, h: m.h * p.vp.scale };
  }

  // The fillable fields on a page, with where they sit on screen.
  async function fields(p) {
    const list = await p.page.getAnnotations({ intent: 'display' }).catch(() => []);
    return list
      .filter((a) => a.subtype === 'Widget' && a.fieldName && ['Tx', 'Btn', 'Ch'].includes(a.fieldType) && !a.pushButton && !a.hidden)
      .map((a) => {
        const [x1, y1, x2, y2] = p.vp.convertToViewportRectangle(a.rect);
        return { a, left: Math.min(x1, x2), top: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      });
  }

  // Draw with a finger, mouse or pen, or type your name in a handwriting font.
  // Returns { el, png() } where png() is a trimmed PNG data URL, or null when it's empty.
  const HAND = '"Snell Roundhand", "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive';
  function pad({ typed = '', label = 'Sign here' } = {}) {
    const W = 520;
    const H = 170;
    const wrap = el('div', 'sig-pad');
    const tabs = el('div', 'sig-tabs');
    const drawBtn = el('button', 'on', { type: 'button', textContent: 'Draw' });
    const typeBtn = el('button', '', { type: 'button', textContent: 'Type' });
    tabs.append(drawBtn, typeBtn);
    const canvas = el('canvas', 'sig-canvas', { width: W * 2, height: H * 2 });
    const input = el('input', 'sig-type hidden', { value: typed, placeholder: 'Type your name', maxLength: 60 });
    const foot = el('div', 'sig-foot');
    const clear = el('button', 'link', { type: 'button', textContent: 'Clear' });
    foot.append(el('span', '', { textContent: label }), clear);
    wrap.append(tabs, canvas, input, foot);
    const ctx = canvas.getContext('2d');
    let mode = 'draw';
    let inked = false;
    const reset = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      inked = false;
    };
    const ink = '#111';
    const typeIt = () => {
      reset();
      const t = input.value.trim();
      if (!t) return;
      let size = 110;
      ctx.font = `${size}px ${HAND}`;
      while (ctx.measureText(t).width > canvas.width - 60 && size > 30) ctx.font = `${(size -= 6)}px ${HAND}`;
      ctx.fillStyle = ink;
      ctx.textBaseline = 'middle';
      ctx.fillText(t, 30, canvas.height / 2);
      inked = true;
    };
    const setMode = (m) => {
      mode = m;
      drawBtn.classList.toggle('on', m === 'draw');
      typeBtn.classList.toggle('on', m === 'type');
      input.classList.toggle('hidden', m !== 'type');
      if (m === 'type') {
        typeIt();
        input.focus();
      } else reset();
    };
    drawBtn.onclick = () => setMode('draw');
    typeBtn.onclick = () => setMode('type');
    clear.onclick = () => (mode === 'type' ? ((input.value = ''), typeIt(), input.focus()) : reset());
    input.addEventListener('input', typeIt);
    let last = null;
    const pt = (e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (mode !== 'draw') setMode('draw');
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      last = pt(e);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(last[0], last[1], 2.5, 0, Math.PI * 2);
      ctx.fill();
      inked = true;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const next = pt(e);
      ctx.strokeStyle = ink;
      ctx.lineWidth = e.pressure && e.pointerType === 'pen' ? 3 + e.pressure * 4 : 5;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.quadraticCurveTo(last[0], last[1], (last[0] + next[0]) / 2, (last[1] + next[1]) / 2);
      ctx.lineTo(next[0], next[1]);
      ctx.stroke();
      last = next;
    });
    const end = () => (last = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    // Just the ink, with a little room around it, on a clear background.
    const png = () => {
      if (!inked) return null;
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let [x1, y1, x2, y2] = [width, height, -1, -1];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < 20) continue;
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
      if (x2 < 0) return null;
      const m = 8;
      [x1, y1, x2, y2] = [Math.max(0, x1 - m), Math.max(0, y1 - m), Math.min(width, x2 + m), Math.min(height, y2 + m)];
      const out = el('canvas', '', { width: x2 - x1, height: y2 - y1 });
      out.getContext('2d').drawImage(canvas, x1, y1, x2 - x1, y2 - y1, 0, 0, x2 - x1, y2 - y1);
      return out.toDataURL('image/png');
    };
    return { el: wrap, png, typeMode: () => setMode('type') };
  }

  return { open, pages, toPdf, fromPdf, fields, pad };
})();
