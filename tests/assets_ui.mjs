// Equipment & assets in a real browser: a scanned label opens the item with its scan bar; typing an address moves
// it (and the move shows under Where it's been); the status in one tap; Assign to a job lists other projects' jobs;
// the lock combo is hidden until Show; the counts; Print labels with a QR code each; the scan bar fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/assets_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4858, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9489', `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch('http://127.0.0.1:9489/json/new?' + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  const chooser = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.method === 'Page.fileChooserOpened') chooser.push(m.params); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9] };
  const key = async (k) => { const [code, text] = KEYS[k]; await cmd('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); await sleep(40); };
  const type = async (t) => { await cmd('Input.insertText', { text: t }); await sleep(40); };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => {
    // Wait for what's tapped to be there (a menu or panel can take a moment to draw on a busy machine).
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(80);
  };
  const click = (sel) => ev(`(() => { const e = typeof ${JSON.stringify(sel)} === 'string' ? document.querySelector(${JSON.stringify(sel)}) : null; e.click(); return true; })()`);
  return { ev, key, type, until, click, tap, cmd, errors, chooser, close: () => ws.close() };
}

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Guard ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const p = await api('POST', '/projects', { template: 'assets', name: 'Cameras' });
  const T = p.types[0];
  const F = (k) => T.fields.find((f) => f.key === k);
  const tower = await api('POST', `/projects/${p.id}/records`, { typeId: T.id, values: { [F('name').id]: 'Tower 7', [F('combo').id]: '4-1-7-9', [F('location').id]: { address: 'Yard, 12 Main St', lat: 36.17, lng: -115.14 } } });
  await api('POST', `/projects/${p.id}/records`, { typeId: T.id, values: { [F('name').id]: 'Generator 2' } });
  const sites = await api('POST', '/projects', { template: 'team', name: 'Sites' });
  await api('POST', `/projects/${sites.id}/records`, { typeId: sites.types[0].id, values: { [sites.types[0].primary]: 'Smith build' } });

  const A = await tab(APP);
  // The job window is in tabs (2026-11-19): pjT(k) opens tab k first, inside a check (it waits for the window).
  const pjT = (k, sub) => `(document.querySelector('.pj-panel .pj-tab[data-tab=${k}]:not(.on)')?.click() ?? true) && ${sub ? `(document.querySelector('.pj-panel .pj-subtab[data-fin=${sub}]:not(.on)')?.click() ?? true) && ` : ''}`;
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); true`);
  // Scanning the label: the phone's camera opens /a/<tag>.
  await A.ev(`location.href = ${JSON.stringify(APP + 'a/' + tower.tag)}; true`);
  ok(await A.until(`document.querySelector('#projects .pj-panel .pj-title')?.value === 'Tower 7' && !!document.querySelector('#projects .as-bar')`, 15000), 'scanning the label opens the item, with its scan bar');
  ok(await A.ev(`location.search === ''`), 'and the address bar is tidied');
  ok(await A.ev(`document.querySelector('.as-where b').textContent === 'Yard, 12 Main St' && !!document.querySelector('.as-where a[href*="google.com/maps"]')`), 'it says where it is, with directions');
  // Typing an address.
  await A.tap(`[...document.querySelectorAll('.as-acts .btn')].find((b) => b.textContent === 'Type an address')`);
  await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('Where is Tower 7')`);
  await A.ev(`document.querySelector('#sheet input').select(); true`);
  await A.type('1200 Warm Springs Rd, Henderson');
  await A.tap(`[...document.querySelectorAll('#sheet .btns .primary-btn')].find((b) => b.textContent === 'Save')`);
  ok(await A.until(`document.querySelector('.as-where b')?.textContent === '1200 Warm Springs Rd, Henderson'`), 'typing an address moves it');
  ok(await A.until(`${pjT('work')}[...document.querySelectorAll('.as-moves .as-move')].some((m) => m.textContent.includes('1200 Warm Springs Rd, Henderson'))`, 8000), 'the move shows under Where it’s been');
  await A.until(`${pjT('overview')}!!document.querySelector('.pj-panel .pj-add-detail')`); // back to the details
  // The status, in one tap.
  await A.tap(`[...document.querySelectorAll('.as-status button')].find((b) => b.textContent === 'Deployed')`);
  ok(await A.until(`[...document.querySelectorAll('.as-status button')].find((b) => b.textContent === 'Deployed')?.classList.contains('on')`), 'its status changes in one tap');
  // The job.
  await A.tap(`[...document.querySelectorAll('.as-acts .btn')].find((b) => b.textContent.includes('Assign to a job'))`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .as-pick')].some((b) => b.textContent.includes('Smith build'))`, 8000), 'Assign to a job lists jobs from other projects');
  await A.tap(`[...document.querySelectorAll('#sheet .as-pick')].find((b) => b.textContent.includes('Smith build'))`);
  ok(await A.until(`document.querySelector('.as-where small')?.textContent.includes('At Smith build')`), 'and it’s at the Smith job');
  // The combo.
  await A.tap(`[...document.querySelectorAll('#projects .pj-panel .pj-frow')].find((r) => r.textContent.startsWith('🔒Lock combo'))?.querySelector('.pj-cell')`);
  ok(await A.until(`document.querySelector('#sheet .as-dots') && !document.querySelector('#sheet').textContent.includes('4-1-7-9')`), 'the combo sheet opens, hidden');
  await A.tap(`[...document.querySelectorAll('#sheet .btn')].find((b) => b.textContent.includes('Show'))`);
  ok(await A.until(`document.querySelector('#sheet .as-code')?.textContent === '4-1-7-9'`), 'Show shows it');
  await A.key('Escape');
  await A.ev(`document.querySelector('#sheet .icon-btn')?.click(); true`);
  // Counts and labels.
  ok(await A.until(`[...document.querySelectorAll('.as-count')].some((c) => c.textContent === '1Deployed') && [...document.querySelectorAll('.as-count')].some((c) => c.textContent === '1At the yard')`), 'the counts: 1 deployed, 1 at the yard');
  await A.tap(`[...document.querySelectorAll('.as-counts .btn')].find((b) => b.textContent.includes('Print labels'))`);
  ok(await A.until(`document.querySelectorAll('#sheet .as-preview .as-label img').length === 2 && [...document.querySelectorAll('#sheet .as-preview img')].every((i) => i.naturalWidth > 50) && document.querySelectorAll('#labelSheet .as-label').length === 2`), 'Print labels shows a QR code for each item, ready to print');
  // Phone width.
  await A.ev(`document.querySelector('#sheet .icon-btn')?.click(); true`);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  ok(await A.ev(`(() => { const el = document.querySelector('#projects .pj-panel .as-bar'); return !!el && [...el.querySelectorAll('*')].every((x) => x.getBoundingClientRect().right <= innerWidth + 1); })()`), 'the scan bar fits a phone screen');
  const shot = await A.cmd('Page.captureScreenshot', { format: 'png' });
  FS.writeFileSync(DIR + '/item-phone.png', Buffer.from(shot.result.data, 'base64'));
  ok(!A.errors.length, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  chrome.kill();
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
