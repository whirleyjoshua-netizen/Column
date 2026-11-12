// Docs, step 5 in a real browser (headless Chrome): a doc with pages inside is shared "with the pages inside, as a
// small site", and the public site has a contents list whose links open each page (stacked on a phone); a doc is
// saved as a team template from its ••• menu and a new, empty doc starts from it (pages and all); a trade template
// (Safety talk) fills an empty doc.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/docs_wiki_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4890, CDP = 9505, APP = `http://127.0.0.1:${PORT}/`;
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
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const type = async (s) => { for (const ch of s) { await cmd('Input.insertText', { text: ch }); await sleep(20); } };
  return { ev, until, tap, type, cmd, errors };
}
const menuBtn = (label) => `[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes(${JSON.stringify(label)}))`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Wiki ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const hb = await api('POST', '/items', { type: 'text', doc: { title: 'Crew handbook', blocks: [{ id: 'w1', type: 'p', runs: [{ text: 'Welcome to the crew' }] }] } });
  await api('POST', '/items', { type: 'text', doc: { title: 'Safety rules', blocks: [{ id: 's1', type: 'p', runs: [{ text: 'Hard hats on site' }] }] }, underId: hb.id });
  await api('POST', '/items', { type: 'text', doc: { title: 'Vans', blocks: [{ id: 'v1', type: 'p', runs: [{ text: 'Fuel on Fridays' }] }] }, underId: hb.id });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.href = '/?go=doc:${hb.id}'; true`);
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Crew handbook'`, 20000), 'the handbook opens');

  // Share with its pages.
  await A.tap(`document.querySelector('#docview .dv-bar [aria-label="Doc options"]')`);
  await A.tap(menuBtn('Share a public link'));
  ok(await A.until(`!!(${menuBtn('With the 2 pages inside')})`), 'sharing offers the doc with its 2 pages inside');
  await A.tap(menuBtn('With the 2 pages inside'));
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('Public site copied'))`), 'it says the site is shared');
  const st = await api('GET', '/state');
  const share = st.items.find((x) => x.id === hb.id).share;
  ok(share?.pages === true, 'shared with its pages');
  const P = await tab(`${APP}s/${share.token}`);
  ok(await P.until(`document.querySelectorAll('.toc a').length === 3 && document.querySelector('h1')?.textContent === 'Crew handbook'`, 15000), 'the public site has a contents list of all three pages');
  await P.tap(`[...document.querySelectorAll('.toc a')].find((x) => x.textContent === 'Vans')`);
  ok(await P.until(`document.querySelector('h1')?.textContent === 'Vans' && document.querySelector('.toc a.on')?.textContent === 'Vans' && document.body.textContent.includes('Fuel on Fridays')`), 'a contents link opens that page, marked as the one you’re on');
  await P.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await P.ev(`document.documentElement.scrollWidth <= 392 && document.querySelector('.toc').getBoundingClientRect().width <= 392 && document.querySelector('.toc').getBoundingClientRect().bottom <= document.querySelector('article').getBoundingClientRect().top + 2`), 'on a phone the contents sit above the page, nothing sideways');

  // Save as a team template, then start an empty doc from it.
  await A.tap(`document.querySelector('#docview .dv-bar [aria-label="Doc options"]')`);
  await A.tap(menuBtn('Save as a team template'));
  ok(await A.until(`document.querySelector('#sheet .sheet h2')?.textContent.includes('Save as a team template') && document.querySelector('#sheet').textContent.includes('copies of the 2 pages inside')`), 'Save as a team template says the 2 pages come too');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Save template')`);
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('Saved as a team template'))`), 'saved');
  await A.tap(`document.querySelector('#docview .dv-lib')`);
  await A.tap(`[...document.querySelectorAll('.dir-tools button')].find((b) => b.textContent.includes('New doc'))`);
  ok(await A.until(`[...document.querySelectorAll('#docview .dv-team-tpl button')].some((b) => b.textContent.includes('Crew handbook') && b.textContent.includes('(+2)'))`, 10000), 'a new doc offers the team’s template (with its 2 pages)');
  await A.tap(`[...document.querySelectorAll('#docview .dv-team-tpl button')].find((b) => b.textContent.includes('Crew handbook'))`);
  const filled = await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Crew handbook' && document.querySelectorAll('#docview .dk-pg').length === 2 && document.querySelector('#docview .dk-text')?.textContent === 'Welcome to the crew'`, 10000);
  if (!filled) console.log('DBG', await A.ev(`JSON.stringify({ title: document.querySelector('#docview .dk-title')?.textContent, pg: document.querySelectorAll('#docview .dk-pg').length, text: [...document.querySelectorAll('#docview .dk-row')].map((r) => r.className + ':' + r.textContent.slice(0, 30)), toasts: [...document.querySelectorAll('.toast')].map((x) => x.textContent) })`));
  ok(filled, 'the empty doc becomes the handbook, with its two pages inside');
  await sleep(600);
  const all = (await api('GET', '/state')).items.filter((x) => x.title === 'Safety rules');
  ok(all.length === 2, 'its pages are new copies');

  // A trade template.
  await A.tap(`document.querySelector('#docview .dv-lib')`);
  await A.tap(`[...document.querySelectorAll('.dir-tools button')].find((b) => b.textContent.includes('New doc'))`);
  await A.tap(`[...document.querySelectorAll('#docview .dv-start-row button')].find((b) => b.textContent === 'Safety talk')`);
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent.startsWith('Safety talk') && document.querySelectorAll('#docview .dk-todo').length >= 4`), 'Safety talk fills the doc with its checklist');
  ok(!A.errors.length && !P.errors.length, 'no errors in the pages' + (A.errors.length + P.errors.length ? ': ' + [...A.errors, ...P.errors].join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
