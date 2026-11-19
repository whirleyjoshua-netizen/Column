// Inventory round 2, step 1 in a real browser: a QR label from an item and from a place, on a Letter sheet or a
// single 2x1" label for a thermal printer; many at once from the menu; a place opens what's there; scanning a
// place's or an item's label opens it.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_labels_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5233, CDP = 9573, APP = `http://127.0.0.1:${PORT}/`;
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
    await until(`(() => { const e = ${expr}; if (!e) return false; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (top === e || e.contains(top)); })()`, 6000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'QR ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const flt = await api('POST', '/inventory/items', { name: '16x25 air filter', sku: 'FLT-1625', onHand: 12 });
  const fit = await api('POST', '/inventory/items', { name: 'Copper fitting', onHand: 30 });
  const shelf = await api('POST', '/inventory/places', { name: 'Shelf B2', kind: 'warehouse' });
  await api('POST', '/inventory/moves', { kind: 'move', itemId: fit.id, qty: 10, from: (await api('GET', '/inventory')).places[0].id, to: shelf.id });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`!!document.querySelector('#tabs [data-tab=tools]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  await A.tap(`document.querySelector('#menu [data-tool=inventory]')`);

  // An item's label.
  await A.tap(`[...document.querySelectorAll('#split .inv-row')].find((r) => r.textContent.includes('16x25 air filter'))`);
  await A.tap(`document.querySelector('#sheet .inv-item-label')`);
  ok(await A.until(`document.querySelectorAll('#sheet .as-preview .as-label img').length === 1 && document.querySelectorAll('#labelSheet .as-label').length === 1 && /FLT-1625/.test(document.querySelector('#labelSheet').textContent)`), 'an item’s QR label, with its SKU, ready to print');
  ok(await A.ev(`[...document.querySelectorAll('#sheet .inv-lfmt button')].map((b) => b.textContent).join('|') === 'Letter sheet|2×1" label printer'`), 'a Letter sheet or a 2×1" label printer');
  await A.tap(`document.querySelector('#sheet .inv-lfmt [data-fmt=thermal]')`);
  ok(await A.until(`document.querySelector('#labelSheet').classList.contains('thermal') && document.querySelector('#sheet .as-preview').classList.contains('thermal')`), 'the label printer size: the preview and the print change');
  await A.tap(`document.querySelector('#sheet .inv-lfmt [data-fmt=sheet]')`);
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`); await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);

  // A place: what's here, and its label.
  await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
  await sleep(300);
  await A.tap(`document.querySelector('#split .inv-views [data-view=places]')`);
  await A.until(`document.querySelector('#split .inv-views .on')?.textContent === 'Places'`);
  await A.tap(`document.querySelector('#split .inv-place[data-place="${shelf.id}"] .inv-place-main')`);
  ok(await A.until(`/Shelf B2/.test(document.querySelector('#sheet h2')?.textContent || '') && document.querySelectorAll('#sheet .inv-here .inv-at').length === 1 && /Copper fitting/.test(document.querySelector('#sheet .inv-here').textContent) && /10 each/.test(document.querySelector('#sheet .inv-here').textContent)`), 'a place opens what’s there: 10 copper fittings');
  ok(await A.ev(`!!document.querySelector('#sheet .inv-p-count') && !!document.querySelector('#sheet .inv-p-putaway') && !!document.querySelector('#sheet .inv-p-receive')`), 'with Receive here, Put away here and Count this place');
  await A.tap(`document.querySelector('#sheet .inv-p-label')`);
  ok(await A.until(`document.querySelectorAll('#labelSheet .as-label').length === 1 && /Shelf B2/.test(document.querySelector('#labelSheet').textContent) && /Warehouse/.test(document.querySelector('#labelSheet').textContent)`), 'a place’s QR label');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`); await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);

  // Many at once.
  await A.tap(`document.querySelector('#split .inv-more')`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Print QR labels…')`);
  ok(await A.until(`document.querySelectorAll('#sheet .inv-lpick').length === 4`), 'Print QR labels… lists the 2 places and 2 items');
  await A.ev(`[...document.querySelectorAll('#sheet .inv-lpick[data-kind=item] input')].forEach((i) => { i.checked = true; }); document.querySelector('#sheet .inv-lpick[data-kind=place][data-id="${shelf.id}"] input').checked = true; true`);
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Next')`);
  ok(await A.until(`document.querySelectorAll('#labelSheet .as-label').length === 3`), 'ticked 2 items and a place: 3 labels');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`); await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);

  // Scanning.
  const labs = (await api('GET', `/inventory/labels?items=${flt.id}&places=${shelf.id}`)).labels;
  await A.ev(`location.href = ${JSON.stringify(APP + '?go=asset:')} + ${JSON.stringify(labs.find((l) => l.kind === 'place').tag)}; true`);
  ok(await A.until(`/Shelf B2/.test(document.querySelector('#sheet h2')?.textContent || '') && !!document.querySelector('#sheet .inv-here')`, 15000), 'scanning the shelf’s label opens the shelf');
  await A.ev(`location.href = ${JSON.stringify(APP + '?go=asset:')} + ${JSON.stringify(labs.find((l) => l.kind === 'item').tag)}; true`);
  ok(await A.until(`/16x25 air filter/.test(document.querySelector('#sheet h2')?.textContent || '') && !!document.querySelector('#sheet .inv-item-label')`, 15000), 'scanning the filter’s label opens the filter');

  // Printed on the label printer: a 2x1 inch label, and nothing but the labels.
  await A.tap(`document.querySelector('#sheet .inv-item-label')`);
  await A.tap(`document.querySelector('#sheet .inv-lfmt [data-fmt=thermal]')`);
  await A.until(`document.querySelector('#labelSheet')?.classList.contains('thermal')`);
  await A.cmd('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(200);
  ok(await A.ev(`(() => { const l = document.querySelector('#labelSheet .as-label').getBoundingClientRect(); return Math.abs(l.width - 192) < 2 && Math.abs(l.height - 96) < 2 && getComputedStyle(document.querySelector('#sheet')).display === 'none'; })()`), 'printed: a 2×1 inch label, and only the labels');
  await A.cmd('Emulation.setEmulatedMedia', { media: '' });
  await A.tap(`document.querySelector('#sheet .inv-lfmt [data-fmt=sheet]')`);
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= 391`), 'fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
chrome.kill('SIGKILL');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
