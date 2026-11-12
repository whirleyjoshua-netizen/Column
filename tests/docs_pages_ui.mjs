// Pages inside pages, the trash and stars, in a real browser (headless Chrome): "/page" in a doc makes a page inside
// it and opens it; the breadcrumb leads back; the parent shows the page as a block that opens it; Docs lists every doc
// as a tree with the pages under their doc; "+" on a row adds a page inside; a star puts a doc at the top; Move to trash
// takes a doc and its pages out, Undo or the Trash puts them back; Move into another doc; and it all fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/docs_pages_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4872, CDP = 9495, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9], End: [35] };
  const key = async (k) => { const [code, text] = KEYS[k]; await cmd('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); await sleep(60); };
  const type = async (t) => { for (const ch of t) { await cmd('Input.insertText', { text: ch }); await sleep(25); } };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(120);
  };
  return { ev, key, type, until, tap, cmd, errors, close: () => ws.close() };
}
const row = (title) => `[...document.querySelectorAll('.docs-list .doc-row')].find((r) => r.querySelector('.doc-t')?.textContent.replace('★ ', '') === ${JSON.stringify(title)})`;
const menuBtn = (label) => `[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes(${JSON.stringify(label)}))`;

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Pages ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const hb = await api('POST', '/items', { type: 'text', doc: { title: 'Handbook', blocks: [{ id: 'intro1', type: 'p', runs: [{ text: 'How we work' }] }] } });
  await api('POST', '/items', { type: 'text', doc: { title: 'Loose notes', blocks: [] } });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#toolsBtn')`, 20000), 'signed in');
  const openDocs = async () => { await A.tap(`document.querySelector('#toolsBtn')`); await A.tap(menuBtn('Docs')); return A.until(`!!(${row('Handbook')})`); };
  ok(await openDocs(), 'Docs lists the handbook');

  // "/page" in the handbook makes a page inside it and opens it.
  await A.tap(row('Handbook'));
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Handbook'`), 'the handbook opens');
  await A.tap(`document.querySelector('#docview .dk-row[data-id="intro1"] .dk-text')`);
  await A.key('End');
  await A.key('Enter');
  await A.type('/page');
  ok(await A.until(`[...document.querySelectorAll('.dk-slash b')].some((b) => b.textContent === 'Page')`), '"/page" offers a Page block');
  await A.key('Enter');
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === '' && [...document.querySelectorAll('#docview .dv-crumb')].some((b) => b.textContent === 'Handbook')`), 'a new page opens, inside the handbook (the breadcrumb says so)');
  await A.tap(`document.querySelector('#docview .dk-title')`);
  await A.type('Safety rules');
  await A.key('Enter');
  await A.type('Hard hats on site');
  ok(await A.until(`document.querySelector('#docview .dv-status')?.textContent === 'Saved'`, 8000), 'it saves');
  await sleep(900);
  const st = await api('GET', '/state');
  const safety = st.items.find((x) => x.title === 'Safety rules');
  ok(safety?.underId === hb.id, 'on the server it’s a page inside the handbook');

  // Back up the breadcrumb: the handbook shows the page as a block that opens it.
  await A.tap(`[...document.querySelectorAll('#docview .dv-crumb')].find((b) => b.textContent === 'Handbook')`);
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Handbook' && document.querySelector('#docview .dk-pg .dk-page-n')?.textContent === 'Safety rules'`), 'the handbook shows “Safety rules” as a page block');
  const order = await A.ev(`[...document.querySelectorAll('#docview .dk-row')].map((r) => r.classList.contains('dk-page') ? 'page' : r.dataset.id).join(',')`);
  ok(order === 'intro1,page', `the page took the empty line's place, after the line above it (${order})`);
  await A.tap(`document.querySelector('#docview .dk-pg')`);
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Safety rules'`), 'tapping the block opens the page');

  // The library: a tree, "+" adds a page inside.
  await A.tap(`document.querySelector('#docview .dv-lib')`);
  ok(await A.until(`!!(${row('Handbook')}) && !(${row('Safety rules')})`), 'in Docs the page sits under its doc (closed at first)');
  await A.tap(`${row('Handbook')}.querySelector('.doc-arrow')`);
  ok(await A.until(`${row('Safety rules')}?.style.getPropertyValue('--in') === '1'`), 'the arrow shows the page inside, a step in');
  await A.tap(`${row('Safety rules')}.querySelector('.doc-add')`);
  ok(await A.until(`[...document.querySelectorAll('#docview .dv-crumb')].map((b) => b.textContent).join('>').endsWith('Handbook>Safety rules')`), '“+” opens a new page inside Safety rules, with the whole path');
  await A.tap(`document.querySelector('#docview .dk-title')`);
  await A.type('Ladders');
  await sleep(1200);
  await A.tap(`document.querySelector('#docview .dv-lib')`);
  await A.until(`!!(${row('Handbook')})`);
  if (!(await A.ev(`!!(${row('Safety rules')})`))) await A.tap(`${row('Handbook')}.querySelector('.doc-arrow')`);
  await A.tap(`${row('Safety rules')}.querySelector('.doc-arrow')`);
  ok(await A.until(`${row('Ladders')}?.style.getPropertyValue('--in') === '2'`), 'three levels show in the tree');

  // A star.
  await A.tap(`${row('Handbook')}.querySelector('.doc-more')`);
  await A.tap(menuBtn('Star it'));
  ok(await A.until(`[...document.querySelectorAll('.docs-h')][0]?.textContent === 'Starred' && document.querySelector('.docs-list .doc-row .doc-star')`), 'a starred doc is at the top, with a star');

  // Move into another doc, from the row menu.
  await A.tap(`${row('Loose notes')}.querySelector('.doc-more')`);
  await A.tap(menuBtn('Move into another doc'));
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.querySelector('.mfile-name')?.textContent === 'Handbook')`);
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('Moved into Handbook'))`), 'Move into another doc: it’s inside the handbook');
  await sleep(500);
  ok((await api('GET', `/items/${hb.id}/doc`)).blocks.filter((b) => b.type === 'page').length === 2, 'and the handbook has its block');

  // Move to trash, Undo.
  await A.until(`!!(${row('Safety rules')})`);
  await A.tap(`${row('Safety rules')}.querySelector('.doc-more')`);
  await A.tap(menuBtn('Move to trash'));
  ok(await A.until(`!(${row('Safety rules')}) && [...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('moved to the trash'))`), 'Move to trash: it leaves Docs, and says so');
  await A.tap(`[...document.querySelectorAll('.toast button')].find((b) => b.textContent === 'Undo')`);
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('is back'))`) && (await api('GET', '/state')).items.some((x) => x.id === safety.id && x.underId === hb.id), 'Undo puts it back inside the handbook, with Ladders');

  // The trash view.
  await A.until(`!!(${row('Handbook')})`);
  if (!(await A.ev(`!!(${row('Safety rules')})`))) await A.tap(`${row('Handbook')}.querySelector('.doc-arrow')`);
  await A.tap(`${row('Safety rules')}.querySelector('.doc-more')`);
  await A.tap(menuBtn('Move to trash'));
  await A.until(`!(${row('Safety rules')})`);
  await A.tap(`document.querySelector('.docs-trash')`);
  ok(await A.until(`[...document.querySelectorAll('.trash-row')].some((r) => r.textContent.includes('Safety rules') && r.textContent.includes('1 page inside') && r.textContent.includes('gone in 30 days'))`), 'the Trash lists it, with its page and the days left');
  await A.tap(`[...document.querySelectorAll('.trash-row')].find((r) => r.textContent.includes('Safety rules')).querySelector('.trash-back')`);
  ok(await A.until(`[...document.querySelectorAll('.docs-list p')].some((p) => p.textContent === 'The trash is empty.')`), 'Put back empties the trash');
  await A.tap(`[...document.querySelectorAll('.dir-tools button')].find((b) => b.textContent.includes('All docs'))`);
  ok(await A.until(`!!(${row('Handbook')})`), 'back to all docs');

  // A phone.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  ok(await A.ev(`document.documentElement.scrollWidth <= 392`), 'Docs fits a phone (no sideways scroll)');
  await A.tap(row('Handbook'));
  await A.until(`document.querySelector('#docview .dk-pg')`);
  await A.tap(`document.querySelector('#docview .dk-pg')`);
  await A.until(`[...document.querySelectorAll('#docview .dv-crumb')].length >= 2`);
  ok(await A.ev(`(() => { const b = document.querySelector('#docview .dv-bar'); return b.scrollWidth <= b.clientWidth + 2 && document.documentElement.scrollWidth <= 392; })()`), 'a page’s bar with its breadcrumb fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
