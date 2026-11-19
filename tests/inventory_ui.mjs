// Inventory in a real browser (headless Chrome): Workspace → Tools → Inventory opens in the split. An owner adds an
// item with stock and a reorder point, adds a truck, moves some to it, uses some on the shelf until it's low; the list,
// the summary and the filters say so; the item's history and the team's Activity list every move. Fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4984, CDP = 9541, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 80 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, pick, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Stock ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`!!document.querySelector('#tabs [data-tab=tools]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  ok(await A.until(`!!document.querySelector('#split [data-tool=inventory]')`), 'Workspace → Tools lists Inventory');
  await A.tap(`document.querySelector('#split [data-tool=inventory]')`);
  ok(await A.until(`document.querySelector('#split .split-title')?.textContent.includes('Inventory') && !!document.querySelector('#split .inv-sum')`), 'it opens in the split, with its summary');
  ok(await A.ev(`/Add the things you keep/.test(document.querySelector('#split').textContent)`), 'empty, it says what to do');

  // An item, with stock and a reorder point.
  await A.tap(`document.querySelector('#split .inv-new')`);
  await A.until(`!!document.querySelector('#sheet .inv-f-name')`);
  // Desktop (2026-11-19): a page beside the sidebar, sections on the left and a live preview on the right.
  ok(await A.ev(`(() => { const s = document.querySelector('#sheet .sheet.page-form')?.getBoundingClientRect(); const m = document.querySelector('#sheet .cb-main')?.getBoundingClientRect(), p = document.querySelector('#sheet .inv-f-sum')?.getBoundingClientRect(); return !!s && s.width > innerWidth * 0.6 && s.height >= innerHeight - 2 && p.left >= m.right - 1; })()`), 'New item is a full page on a computer, with a preview beside the form');
  for (const [k, v] of [['name', '16x25 air filter'], ['sku', 'FLT-1625'], ['category', 'Filters'], ['unit', 'each'], ['cost', '6.50'], ['price', '18'], ['reorderAt', '10'], ['reorderQty', '40'], ['supplier', 'Ferguson'], ['onHand', '24']]) await A.fill(`document.querySelector('#sheet .inv-f-${k}')`, v);
  ok(await A.until(`(() => { const t = document.querySelector('#sheet .inv-f-sum')?.textContent || ''; return t.includes('16x25 air filter') && t.includes('24 each on hand') && t.includes('Shows as low at 10, then order 40') && t.includes('From Ferguson') && t.includes('64% margin'); })()`), 'the preview keeps up: on hand, when it shows as low, the supplier, the margin');
  { const shot = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(DIR + '/item-form-desktop.png', Buffer.from(shot.result.data, 'base64')); }
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Add it')`);
  ok(await A.until(`!!document.querySelector('#split .inv-row[data-item]') && document.querySelector('#split .inv-row .inv-qty-n b').textContent === '24'`), 'the item is listed with 24 on hand');
  ok(await A.ev(`document.querySelector('#split .inv-row .inv-val').textContent === '$156' && [...document.querySelectorAll('#split .inv-stat')].some((s) => s.textContent.includes('$156') && s.textContent.includes('Stock value'))`), 'worth $156, in its row and the summary');

  // A truck.
  await A.tap(`document.querySelector('#split .inv-views [data-view=places]')`);
  ok(await A.until(`[...document.querySelectorAll('#split .inv-place b')].some((b) => b.textContent === 'Main storage')`), 'Places shows Main storage (made with the first item)');
  await A.tap(`document.querySelector('#split .inv-place-new')`);
  await A.until(`!!document.querySelector('#sheet .inv-p-name')`);
  ok(await A.ev(`!!document.querySelector('#sheet .sheet.page-form') && document.querySelectorAll('#sheet .inv-kind').length === 4`), 'New place is a full page too, the kinds as cards to tap');
  await A.fill(`document.querySelector('#sheet .inv-p-name')`, 'Truck 2');
  await A.pick(`document.querySelector('#sheet .inv-p-kind')`, 'truck');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Add it')`);
  ok(await A.until(`[...document.querySelectorAll('#split .inv-place b')].some((b) => b.textContent === 'Truck 2')`), 'Truck 2 is added');

  // Move 6 to the truck, from the item.
  await A.tap(`document.querySelector('#split .inv-views [data-view=items]')`);
  await A.tap(`document.querySelector('#split .inv-row[data-item]')`);
  ok(await A.until(`document.querySelector('#sheet h2')?.textContent.includes('16x25 air filter') && /24 each/.test(document.querySelector('#sheet .inv-sum').textContent)`), 'the item opens: 24 each on hand');
  await A.tap(`document.querySelector('#sheet .inv-at [data-act=move]')`);
  await A.until(`!!document.querySelector('#sheet .inv-m-qty')`);
  await A.fill(`document.querySelector('#sheet .inv-m-qty')`, '6');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Move')`);
  ok(await A.until(`/Main storage 18 · Truck 2 6/.test(document.querySelector('#split .inv-row .inv-qty')?.textContent || '')`), 'moved: the row shows Main storage 18 · Truck 2 6');

  // Use 9 from the shelf: 15 left... then 6 more: 9 left, under the reorder point.
  for (const n of ['9', '6']) {
    await A.tap(`document.querySelector('#split .inv-row[data-item]')`);
    await A.until(`!!document.querySelector('#sheet .inv-at[data-place] [data-act=use]')`);
    await A.tap(`[...document.querySelectorAll('#sheet .inv-at')].find((r) => r.textContent.includes('Main storage')).querySelector('[data-act=use]')`);
    await A.until(`!!document.querySelector('#sheet .inv-m-qty')`);
    await A.fill(`document.querySelector('#sheet .inv-m-qty')`, n);
    await A.fill(`document.querySelector('#sheet .inv-m-note')`, 'Service calls');
    await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Use')`);
    await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
  }
  ok(await A.until(`document.querySelector('#split .inv-row')?.classList.contains('low') && !!document.querySelector('#split .inv-row .inv-low') && document.querySelector('#split .inv-row .inv-qty-n b').textContent === '9'`), '9 left (reorder at 10): marked Low');
  ok(await A.ev(`[...document.querySelectorAll('#split .inv-stat.inv-warn')].some((s) => s.textContent.includes('Low stock') && s.textContent.includes('1'))`), 'the summary counts 1 low');
  // Too many: refused, and says how many there are.
  await A.tap(`document.querySelector('#split .inv-row[data-item]')`);
  await A.until(`!!document.querySelector('#sheet .inv-at [data-act=use]')`);
  await A.tap(`[...document.querySelectorAll('#sheet .inv-at')].find((r) => r.textContent.includes('Truck 2')).querySelector('[data-act=use]')`);
  await A.until(`!!document.querySelector('#sheet .inv-m-qty')`);
  await A.fill(`document.querySelector('#sheet .inv-m-qty')`, '50');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Use')`);
  ok(await A.until(`/Only 6 each at Truck 2/.test(document.querySelector('#sheet .err')?.textContent || '')`), 'using more than is there is refused: “Only 6 each at Truck 2”');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);

  // Filters.
  await A.tap(`document.querySelector('#split .inv-f-low')`);
  ok(await A.until(`document.querySelectorAll('#split .inv-row').length === 1`), 'Low stock shows the low one');
  await A.tap(`document.querySelector('#split .inv-f-low')`);
  await A.pick(`document.querySelector('#split .inv-f-place')`, (await api('GET', '/inventory')).places.find((p) => p.name === 'Truck 2').id);
  ok(await A.until(`document.querySelector('#split .inv-row .inv-qty-n b')?.textContent === '6'`), 'filtered to Truck 2: 6 there');
  await A.pick(`document.querySelector('#split .inv-f-place')`, '');

  // History and Activity.
  await A.tap(`document.querySelector('#split .inv-row[data-item]')`);
  ok(await A.until(`document.querySelectorAll('#sheet .inv-move').length === 4`), 'the item’s history: received, moved, used twice');
  ok(await A.ev(`/Rico Vega used 6 each at Main storage · “Service calls”/.test(document.querySelector('#sheet .inv-moves').textContent)`), 'each says who, what, where and why');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);
  await A.tap(`document.querySelector('#split .inv-views [data-view=activity]')`);
  ok(await A.until(`document.querySelectorAll('#split .inv-move').length === 4 && /moved 6 each 16x25 air filter Main storage → Truck 2/.test(document.querySelector('#split .inv-moves').textContent)`), 'Activity lists every move, the item named');

  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.tap(`document.querySelector('#split .inv-views [data-view=items]')`);
  ok(await A.until(`document.documentElement.scrollWidth <= 392 && !!document.querySelector('.inv-row')`, 4000), 'it fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
