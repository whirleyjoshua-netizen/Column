// Docs, step 3 in a real browser (headless Chrome): "/project table" puts a project's list in a doc, its rows open the
// record and "+ New" adds one; the block menu turns it into a board by stage; "/embed" takes a YouTube link and shows
// it in a sandboxed player (a link it can't show is refused); the browser and the server agree on every link; a page
// gets an icon and a cover (picked through the real file chooser); and it fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
import { PNG } from './zipmake.mjs';
import { embedSrc } from '../server/notion.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/docs_blocks_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PIC = DIR + '/cover.png';
FS.writeFileSync(PIC, PNG);
const PORT = 4882, CDP = 9501, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const CASES = ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/abcDEF12345', 'https://vimeo.com/76979871', 'https://www.loom.com/share/0123456789abcdef0123456789abcdef', 'https://www.google.com/maps/place/Las+Vegas,+NV/@36.1,-115.1,11z', 'https://maps.google.com/maps?q=12+Main+St', 'https://www.figma.com/design/AbCdEf1234567890/Site?node-id=1', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit', 'https://docs.google.com/forms/d/e/1FAIpQLSdAbCdEfGhIjKlMnOpQr/viewform', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=x', 'not a url'];
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [], chooser = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.method === 'Page.fileChooserOpened') chooser.push(m.params); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('DOM.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const KEYS = { Enter: [13, '\r'], Escape: [27], End: [35] };
  const key = async (k) => { const [code, text] = KEYS[k]; await cmd('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); await sleep(70); };
  const type = async (s) => { for (const ch of s) { await cmd('Input.insertText', { text: ch }); await sleep(20); } };
  return { ev, until, tap, key, type, cmd, errors, chooser };
}
const menuBtn = (label) => `[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes(${JSON.stringify(label)}))`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Blocks ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const ws = (await api('GET', '/state')).workspace;
  await api('PATCH', '/workspace', { tools: { ...ws.tools, projects: true } });
  const p = await api('POST', '/projects', { template: 'crm', name: 'Sales' });
  const T = p.types[0];
  for (const n of ['Smith job', 'Jones job']) await api('POST', `/projects/${p.id}/records`, { typeId: T.id, values: { [T.primary]: n } });
  const doc = await api('POST', '/items', { type: 'text', doc: { title: 'Team page', blocks: [{ id: 'p1', type: 'p', runs: [{ text: 'Our deals' }] }] } });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  ok(JSON.stringify(await A.ev(`JSON.stringify(${JSON.stringify(CASES)}.map((u) => ColumnDocs.embedSrc(u)))`)) === JSON.stringify(JSON.stringify(CASES.map((u) => embedSrc(u)))), 'the browser and the server agree on what every link embeds as');
  const openTeamPage = async () => { await A.ev(`location.href = '/?go=doc:${doc.id}'; true`); await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Team page'`, 20000); };
  await openTeamPage();
  ok(await A.ev(`!!document.querySelector('#docview .dk-title')`), 'the doc opens');

  // A project's list in the doc.
  await A.tap(`document.querySelector('#docview .dk-row[data-id="p1"] .dk-text')`);
  await A.key('End');
  await A.key('Enter');
  await A.type('/project');
  ok(await A.until(`[...document.querySelectorAll('.dk-slash b')].some((b) => b.textContent === 'Project table')`), '"/project" offers Project table');
  await A.key('Enter');
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes(${JSON.stringify(T.name)}))`);
  ok(await A.until(`document.querySelectorAll('#docview .dk-vt-row').length === 2 && document.querySelector('#docview .dk-vt-name')?.textContent.includes('Sales')`), 'the doc shows the project’s list as a table');
  await A.tap(`document.querySelector('#docview .dk-vt-add')`);
  await A.type('Lee job');
  await A.key('Enter');
  const added = await A.until(`document.querySelectorAll('#docview .dk-vt-row').length === 3 && document.querySelector('#docview .dk-vt-row td')?.textContent === 'Lee job'`);
  if (!added) console.log('DBG1', await A.ev(`JSON.stringify([...document.querySelectorAll('#docview .dk-vt-row')].map((r) => r.textContent))`));
  ok(added, '“+ New” adds a record, at the top');
  ok(await A.until(`document.activeElement?.classList.contains('dk-vt-add')`, 3000), 'and the box is ready for the next one');
  await sleep(800);
  ok((await api('GET', `/projects/${p.id}/records`)).some((r) => r.values[T.primary] === 'Lee job'), 'the record is in the project');
  await A.tap(`document.querySelector('#docview .dk-row.dk-view .dk-grip')`);
  await A.tap(menuBtn('Show as a board'));
  ok(await A.until(`document.querySelectorAll('#docview .dk-vb-lane').length >= 1 && document.querySelectorAll('#docview .dk-vb-card').length === 3`), 'the block menu shows it as a board by stage');
  await sleep(1200);
  ok((await api('GET', `/items/${doc.id}/doc`)).blocks.some((b) => b.type === 'view' && b.mode === 'board'), 'and the doc keeps it as a board');
  await A.tap(`[...document.querySelectorAll('#docview .dk-vb-card')].find((c) => c.textContent === 'Smith job')`);
  const opened = await A.until(`!document.querySelector('#projects')?.classList.contains('hidden') && document.querySelector('#projects .pj-panel .pj-title')?.value === 'Smith job'`, 10000);
  if (!opened) console.log('DBG2', await A.ev(`JSON.stringify({ pj: document.querySelector('#projects')?.className, panel: document.querySelector('#projects .pj-panel')?.textContent?.slice(0, 120), dv: document.querySelector('#docview')?.className, title: document.querySelector('.pj-panel .pj-title')?.value })`));
  ok(opened, 'a card opens its record');

  // An embed.
  await openTeamPage();
  await A.tap(`[...document.querySelectorAll('#docview .dk-row')].at(-1).querySelector('.dk-text') || [...document.querySelectorAll('#docview .dk-text')].at(-1)`);
  await A.key('End');
  await A.key('Enter');
  await A.type('/embed');
  await A.until(`[...document.querySelectorAll('.dk-slash b')].some((b) => b.textContent === 'Embed')`);
  await A.key('Enter');
  ok(await A.until(`document.activeElement?.classList.contains('dk-em-in')`), '"/embed" asks for a link, ready to paste');
  await A.type('https://evil.example/video');
  await A.key('Enter');
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('can’t be shown here'))`), 'a link it can’t show is refused, saying which it can');
  await A.ev(`document.querySelector('#docview .dk-em-in').value = ''; true`);
  await A.tap(`document.querySelector('#docview .dk-em-in')`);
  await A.type('https://youtu.be/dQw4w9WgXcQ');
  await A.key('Enter');
  ok(await A.until(`document.querySelector('#docview .dk-em iframe')?.getAttribute('src') === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'`), 'a YouTube link shows as its player (without cookies)');
  ok(await A.ev(`(() => { const f = document.querySelector('#docview .dk-em iframe'); return f.getAttribute('sandbox').split(' ').sort().join() === 'allow-forms,allow-popups,allow-presentation,allow-same-origin,allow-scripts' && !/allow-top-navigation/.test(f.getAttribute('sandbox')); })()`), 'in a sandbox that can’t take over the page');
  await sleep(1200);
  ok((await api('GET', `/items/${doc.id}/doc`)).blocks.some((b) => b.type === 'embed' && b.url === 'https://youtu.be/dQw4w9WgXcQ'), 'saved with the link');

  // Icon and cover.
  await A.tap(`document.querySelector('#docview .dv-add-icon')`);
  await A.tap(`[...document.querySelectorAll('#menu .emoji-row button')].find((b) => b.textContent === '🦺')`);
  ok(await A.until(`document.querySelector('#docview .dv-icon')?.textContent === '🦺'`), 'an icon goes above the title');
  await A.cmd('Page.setInterceptFileChooserDialog', { enabled: true });
  A.chooser.length = 0;
  await A.tap(`document.querySelector('#docview .dv-add-cover')`);
  await A.until(`true`, 100);
  for (let i = 0; i < 40 && !A.chooser.length; i++) await sleep(100);
  ok(A.chooser.length === 1, 'Add cover opens the file chooser');
  if (A.chooser[0]) await A.cmd('DOM.setFileInputFiles', { files: [PIC], backendNodeId: A.chooser[0].backendNodeId });
  ok(await A.until(`(() => { const i = document.querySelector('#docview .dv-cover img'); return i && i.complete && i.naturalWidth > 0; })()`, 15000), 'the picture is the page’s cover');
  await A.cmd('Page.setInterceptFileChooserDialog', { enabled: false });
  await A.tap(`document.querySelector('#docview .dv-lib')`);
  ok(await A.until(`[...document.querySelectorAll('.docs-list .doc-row .doc-ic')].some((x) => x.textContent.includes('🦺'))`), 'Docs shows the page’s icon');

  // A phone.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await openTeamPage();
  await sleep(800);
  ok(await A.ev(`document.documentElement.scrollWidth <= 392 && [...document.querySelectorAll('#docview .dk-vw, #docview .dk-em')].every((e) => e.getBoundingClientRect().right <= 391)`), 'the board, the player and the cover fit a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
