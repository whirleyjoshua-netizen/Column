// New project at full size (2026-11-19): a page with a list to scroll or filter (↑↓ to move), and what you get beside it,
// instead of the bottom sheet. Trades pick their kinds of work right there. A narrow window keeps the sheet.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/pjnui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4877, APP = `http://127.0.0.1:${PORT}/`, CDP = 9511;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-pjnui`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-pjnui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const mouse = async (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0, clickCount: 1 });
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(80); };
  return { ev, until, tap, mouse, cmd, pick, errors, close: () => ws.close() };
}
let A;
const shot = async (name) => { if (!process.env.SHOT) return; const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const P = (x) => `document.querySelector('#projects ${x}')`;
const rows = () => A.ev(`[...document.querySelectorAll('#projects .pjn-row b')].map((b) => b.textContent).join('|')`);
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Pjn ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  await api('PATCH', '/workspace', { tools: { projects: true } });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=projects]')`, 15000), 'Ada is in, with Projects');
  await A.ev(`document.querySelector('#tabs [data-tab=projects]').click(); true`);
  // No projects yet: the page itself is the picker, no sheet.
  ok(await A.until(`!!${P('.pjn.pjn-first')}`), 'with no projects, Projects at full size is the list of kinds, in the page');
  ok(await A.ev(`document.querySelector('#sheet').classList.contains('hidden')`), 'no pop-up sheet');
  await sleep(300); await shot('pjn-empty');
  ok(await rows() === 'Blank board|Jobs for a trade business|Software team|Agency client work|UGC|Team projects|Sales pipeline|Equipment & assets|Start blank|Something else? Describe how you work', 'every way to start is one row: ' + await rows());
  ok(await A.ev(`[...document.querySelectorAll('#projects .pjn-group')].map((g) => g.textContent.replace('// ', '')).join('|')`) === 'Start blank|Construction & Trades|Technology & Software|Creative & Agencies|Business Operations|Draft it with AI', 'a blank board first, then the four kinds, plus AI');
  // One project, then + New project opens the page (not a sheet).
  const sales = await api('POST', '/projects', { template: 'crm', name: 'Sales' });
  await A.ev(`location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=projects]')`, 15000);
  await A.ev(`document.querySelector('#tabs [data-tab=projects]').click(); true`);
  ok(await A.until(`!!${P('.pj-grid')}`), 'with a project, Projects lists them as before');
  await A.tap(`[...document.querySelectorAll('#projects .btn')].find((b) => b.textContent === 'Use a template')`);
  ok(await A.until(`!!${P('.pjn:not(.pjn-first)')} && ${P('.pj-head h2')}.textContent === 'New board'`), 'Use a template opens the New board page');
  ok(await A.ev(`document.querySelector('#sheet').classList.contains('hidden')`), 'still no sheet');
  ok(await A.until(`document.activeElement?.classList.contains('pjn-q')`), 'the filter has the cursor');
  ok(await A.ev(`${P('.pjn-row.on')}.textContent.includes('Blank board') && ${P('.pjn-detail h3')}.textContent === 'Blank board'`), 'the first row (Blank board) is picked, shown beside the list');
  // Filter and arrows.
  await A.ev(`(() => { const q = ${P('.pjn-q')}; q.value = 'deals'; q.dispatchEvent(new Event('input')); })()`);
  ok(await A.until(`[...document.querySelectorAll('#projects .pjn-row b')].map((b) => b.textContent).join('|') === 'Sales pipeline'`), 'typing filters it (deals → Sales pipeline, by what you get)');
  ok(await A.ev(`${P('.pjn-detail h3')}.textContent === 'Sales pipeline' && document.activeElement?.classList.contains('pjn-q')`), 'the match is picked and typing carries on');
  await A.ev(`(() => { const q = ${P('.pjn-q')}; q.value = ''; q.dispatchEvent(new Event('input')); })()`);
  await A.until(`document.querySelectorAll('#projects .pjn-row').length === 10`);
  await A.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  ok(await A.until(`${P('.pjn-detail h3')}.textContent === 'Equipment & assets'`), '↓ moves to the next row (Sales pipeline → Equipment & assets)');
  for (let i = 0; i < 8; i++) await A.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
  ok(await A.until(`${P('.pjn-detail h3')}.textContent === 'Blank board'`), '↑ walks back to the top');
  await A.tap(`[...document.querySelectorAll('#projects .pjn-row')].find((b) => b.textContent.includes('Team projects'))`);
  ok(await A.until(`[...document.querySelectorAll('#projects .pjn-d-gets li')].map((x) => x.textContent).join('|') === 'Projects|Tasks|Processes'`), 'Team projects says what you get: Projects, Tasks, Processes');
  await shot('pjn-team');
  // A teammate's change coming in doesn't wipe what you're typing.
  await A.ev(`(() => { const n = ${P('.pjn-name')}; n.focus(); n.value = 'Ops'; n.dispatchEvent(new Event('input')); })()`);
  await api('PATCH', '/projects/' + sales.id, { name: 'Sales team' });
  ok(await A.until(`(window.__seen ||= 0, true) && [...document.querySelectorAll('#projects .pjn')].length === 1`), 'the page is still up');
  await sleep(700);
  ok(await A.ev(`${P('.pjn-name')}.value === 'Ops' && document.activeElement === ${P('.pjn-name')}`), 'a project made elsewhere doesn’t wipe the name being typed');
  await A.tap(P('.pjn-create'));
  ok(await A.until(`${P('.pj-name')}?.textContent === 'Ops'`), 'Create makes it and opens it');
  // Trades: pick the kinds of work right there.
  await A.tap(`document.querySelector('#projects .pj-top [aria-label="All boards"]')`);
  await A.tap(`[...document.querySelectorAll('#projects .btn')].find((b) => b.textContent === 'Use a template')`);
  await A.until(`!!${P('.pjn')}`);
  await A.tap(`[...document.querySelectorAll('#projects .pjn-row')].find((b) => b.textContent.includes('Jobs for a trade business'))`);
  ok(await A.until(`!!${P('.pjn .pj-trade')}`), 'Jobs for a trade business lists the kinds of work in the page');
  await sleep(300); await shot('pjn-trades');
  ok(await A.ev(`${P('.pjn-create')}.disabled`), 'Create waits for a kind of work');
  await A.ev(`(() => { const n = ${P('.pjn-name')}; n.value = 'Field jobs'; n.dispatchEvent(new Event('input')); })()`);
  await A.tap(`document.querySelector('#projects .pj-trade')`);
  ok(await A.until(`!${P('.pjn-create')}.disabled && ${P('.pjn-create')}.textContent.includes('1 kind of work')`), 'picking one lets it go');
  await A.tap(`${P('.pj-bids input')}`);
  ok(await A.until(`[...document.querySelectorAll('#projects .pjn-d-gets li')].map((x) => x.textContent).join('|') === 'Jobs|Clients|Quotes|Bids|Price list'`), 'We bid on jobs too adds Quotes, Bids and a Price list to what you get');
  ok(await A.ev(`${P('.pjn-name')}.value === 'Field jobs' && ${P('.pj-trade[aria-pressed=true]')} !== null`), 'and keeps the name and the work picked');
  await A.tap(P('.pjn-create'));
  ok(await A.until(`${P('.pj-name')}?.textContent === 'Field jobs' && [...document.querySelectorAll('#projects .pj-types button')].some((b) => b.textContent.includes('Quotes'))`, 8000), 'Create makes the jobs project, with quotes');
  // Escape goes back; Describe shows its box in the page.
  await A.tap(`document.querySelector('#projects .pj-top [aria-label="All boards"]')`);
  await A.tap(`[...document.querySelectorAll('#projects .btn')].find((b) => b.textContent === 'Use a template')`);
  await A.until(`!!${P('.pjn')}`);
  await A.tap(`[...document.querySelectorAll('#projects .pjn-row')].find((b) => b.textContent.includes('Describe how you work'))`);
  ok(await A.until(`!!${P('.pjn-detail textarea')} && ${P('.pjn-create')}.textContent.includes('Draft it')`), 'Describe how you work is a box in the page');
  await A.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  ok(await A.until(`!${P('.pjn')} && !!${P('.pj-grid')}`), 'Escape goes back to Projects');
  // A narrow window keeps the sheet.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`!document.body.classList.contains('wide')`);
  if (await A.ev(`document.querySelector('#projects').classList.contains('hidden')`)) { await A.ev(`(document.querySelector('[data-tab=projects]') || document.querySelector('#tabs [data-tab=work]')).click(); true`); }
  await A.until(`!document.querySelector('#projects').classList.contains('hidden')`);
  await A.tap(`[...document.querySelectorAll('#projects .btn')].find((b) => b.textContent === 'Use a template')`);
  const narrow = await A.until(`!document.querySelector('#sheet').classList.contains('hidden') && document.querySelectorAll('#sheet .pj-kind').length === 4`);
  if (!narrow) console.log('NARROW:', await A.ev(`document.body.className + ' :: ' + document.querySelector('#sheet').className + ' :: ' + document.querySelectorAll('#sheet .pj-kind').length + ' :: ' + !!document.querySelector('#projects .pjn') + ' :: ' + document.querySelector('#projects').className`));
  ok(narrow, 'in a narrow window it’s still the sheet');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
