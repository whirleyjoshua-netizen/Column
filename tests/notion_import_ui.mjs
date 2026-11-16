// Bringing in a Notion export in a real browser (headless Chrome): Docs → Import, pick the .zip, it uploads and
// comes in with progress, then the folder's docs are in Docs as a tree; the handbook shows its callout, its picture,
// its page blocks and a mention that opens the page it links to. A Markdown file's "Make it a doc" opens it as a doc.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
import { notionZip } from './zipmake.mjs';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/notion_import_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const ZIP = DIR + '/Export-abc.zip';
FS.writeFileSync(ZIP, notionZip);
const PORT = 4876, CDP = 9497, APP = `http://127.0.0.1:${PORT}/`;
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
  await cmd('DOM.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(120);
  };
  const setFile = async (selector, file) => {
    const doc = await cmd('DOM.getDocument', { depth: -1 });
    const q = await cmd('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
    await cmd('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] });
  };
  return { ev, until, tap, cmd, setFile, errors, close: () => ws.close() };
}
const row = (title) => `[...document.querySelectorAll('.docs-list .doc-row')].find((r) => r.querySelector('.doc-t')?.textContent.replace('★ ', '') === ${JSON.stringify(title)})`;
const treeRow = (title) => `[...document.querySelectorAll('.docs-list .doc-tree')].find((r) => r.querySelector('.doc-t')?.textContent.replace('★ ', '') === ${JSON.stringify(title)})`;
// Docs is in Workspace now (Folders & Docs), not All tools (2026-11-14).
const menuBtn = (label) => (label === 'Docs' ? `((document.querySelector('#tabs [data-tab=docs]').click(), document.querySelector('#tool .df-switch [data-df=docs]')?.click()), document.querySelector('#tool h2'))` : `[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes(${JSON.stringify(label)}))`);

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Notion ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.ev(`document.querySelector('#tabs [data-tab=docs]').click()`);
  await A.tap(menuBtn('Docs'));
  await A.until(`!!document.querySelector('.docs-import')`);
  await A.tap(`document.querySelector('.docs-import')`);
  ok(await A.until(`document.querySelector('#sheet .sheet h2')?.textContent.includes('Import from Notion') && document.querySelector('#sheet .day-hint')?.textContent.includes('Markdown & CSV')`), 'Import opens, saying how to export from Notion');
  ok(await A.ev(`document.querySelector('#sheet').textContent.includes('Databases become tables in a doc')`), 'it says what databases become here (Jobs & projects is off)');
  await A.tap(`document.querySelector('#sheet .im-go')`);
  ok(await A.until(`document.querySelector('#sheet .im-status .err')?.textContent.includes('Pick the .zip')`), 'Bring it in without a file asks for one');
  await A.setFile('#sheet .im-file', ZIP);
  await A.tap(`document.querySelector('#sheet .im-go')`);
  ok(await A.until(`document.querySelector('#sheet .im-done')?.textContent.includes('Brought in')`, 30000), 'it uploads and comes in: ' + (await A.ev(`document.querySelector('#sheet .im-status')?.textContent`)));
  ok(await A.ev(`[...document.querySelectorAll('#sheet .im-status .day-hint')].some((p) => p.textContent.includes('too big'))`), 'and lists what it couldn’t bring in');
  await A.tap(`document.querySelector('#sheet .im-open')`);
  ok(await A.until(`[...document.querySelectorAll('.docs-h')].some((h) => h.textContent.startsWith('From Notion')) && !!(${row('Handbook')})`), 'Docs shows the new folder with the handbook');
  await A.tap(`${treeRow('Handbook')}.querySelector('.doc-arrow')`);
  ok(await A.until(`!!(${treeRow('Pricing')}) && !!(${treeRow('Safety')}) && !!(${treeRow('Jobs')})`), 'the pages inside it are under it');

  await A.tap(row('Handbook'));
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Handbook' && document.querySelectorAll('#docview .dk-pg').length === 3`), 'the handbook opens with its three pages inside as blocks');
  ok(await A.until(`document.querySelector('#docview .dk-callout .dk-emoji')?.textContent === '💡' && document.querySelector('#docview .dk-table') && document.querySelector('#docview .dk-code')`), 'its callout, table and code');
  ok(await A.until(`(() => { const i = document.querySelector('#docview .dk-figure img'); return i && i.complete && i.naturalWidth > 0; })()`), 'its picture loads');
  await A.tap(`[...document.querySelectorAll('#docview .dk-ref-doc')].find((x) => x.textContent.includes('Pricing'))`);
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Pricing'`), 'the link to Pricing is a mention that opens it');
  ok(await A.until(`[...document.querySelectorAll('#docview .dv-crumb')].some((b) => b.textContent === 'Handbook')`), 'and Pricing knows it’s inside the handbook');

  // Make it a doc, from a Markdown file's card.
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const md = await (await fetch(APP + 'api/upload?name=' + encodeURIComponent('Install steps.md'), { method: 'PUT', headers: { authorization: 'Bearer ' + a.token }, body: '# Install steps\n\n- Measure twice\n- [ ] Order brackets\n' })).json();
  await A.ev(`location.href = '/?go=file:${md.id}'; true`);
  await A.until(`document.readyState === 'complete' && !!document.querySelector('#settingsBtn')`, 20000);
  const offered = await A.until(`!!document.querySelector('#preview:not(.hidden) .pv-makedoc')`, 15000);
  if (!offered) console.log(await A.ev(`JSON.stringify({ href: location.href, pv: document.querySelector('#preview')?.className, bar: document.querySelector('#preview .pv-bar')?.textContent, n: document.querySelectorAll('button[aria-label="Make it a doc"]').length })`));
  ok(offered, 'opening the Markdown file offers “Make it a doc”');
  await A.tap(`document.querySelector('#preview .pv-makedoc')`);
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Install steps' && document.querySelectorAll('#docview .dk-todo').length === 1`), '“Make it a doc” on a Markdown file opens it as a doc, with its list and to-do');
  ok((await api('GET', '/state')).items.some((x) => x.id === md.id), 'and the file is still there');

  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.tap(`document.querySelector('#docview .dv-lib')`);
  await A.tap(`document.querySelector('.docs-import')`);
  await sleep(500);
  ok(await A.ev(`document.documentElement.scrollWidth <= 392 && document.querySelector('#sheet .sheet').getBoundingClientRect().right <= 391`), 'Import fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
