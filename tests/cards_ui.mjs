// Business card in a real browser: Tools → Business card, filled in, a link added, Save and turn on; the card
// page opens with no script errors, its Share button and Save contact; and the editor fits a phone screen.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/cards_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4854, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9487', `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch('http://127.0.0.1:9487/json/new?' + url, { method: 'PUT' })).json(); } catch {} }
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
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Tint ' + t, name: 'Maria Lopez', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload()`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 15000), 'signed in');
  // Business card is in Settings → Business (2026-11-16).
  await A.tap(`document.querySelector('#settingsBtn')`);
  await A.tap(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent === 'Business')`);
  await A.tap(`document.querySelector('#settings [data-biz=cards] button')`);
  ok(await A.until(`document.querySelector('#split .split-title')?.textContent.startsWith('Business card') && !!document.querySelector('#split .card-status')`), 'Settings → Business → Business card opens the editor');
  ok(await A.ev(`[...document.querySelectorAll('#split label')].find((l) => l.textContent.startsWith('Name'))?.querySelector('input').value === 'Maria Lopez'`), 'filled in from the account');
  const fill = async (label, text) => { await A.tap(`[...document.querySelectorAll('#split label')].find((l) => l.textContent.startsWith(${JSON.stringify(label)})).querySelector('input, textarea')`); await A.ev(`document.activeElement.select?.()`); await A.type(text); };
  await fill('Title', 'Owner');
  await fill('Phone', '602 555 0142');
  await A.tap(`[...document.querySelectorAll('#split .btn')].find((b) => b.textContent === '+ Add a link')`);
  await A.until(`document.querySelectorAll('#split .card-link input').length === 2`);
  await A.tap(`document.querySelectorAll('#split .card-link input')[0]`); await A.type('Book a time');
  await A.tap(`document.querySelectorAll('#split .card-link input')[1]`); await A.type('cal.com/maria');
  await A.tap(`[...document.querySelectorAll('#split .btn')].find((b) => b.textContent === 'Save and turn on')`);
  ok(await A.until(`document.querySelector('#split .card-status.on')?.textContent.includes('/c/maria-lopez')`), 'Save and turn on: the card is on at its address');
  ok(await A.ev(`[...document.querySelectorAll('#split .card-share .btn')].map((b) => b.textContent).join('|')`).then((x) => /Show my card/.test(x) && /Open my card/.test(x)), 'with Share, Show my card and Open my card');
  // Full screen, for a quick hello (2026-11-19): the big QR code and Share, nothing else.
  await A.tap(`[...document.querySelectorAll('#split .card-share .btn')].find((b) => b.textContent === 'Show my card')`);
  ok(await A.until(`document.querySelector('#myCard img.mycard-qr')?.naturalWidth > 100 && document.querySelector('#myCard h2')?.textContent === 'Maria Lopez' && /Owner/.test(document.querySelector('#myCard .mycard-role')?.textContent || '') && !!document.querySelector('#myCard .mycard-share')`), 'Show my card: full screen, the QR code, her name and title, and Share');
  await A.tap(`document.querySelector('#myCard .mycard-pin')`);
  let pins = [];
  for (let i = 0; i < 40 && !pins.length; i++) { pins = (await (await fetch(APP + 'api/state', { headers: { authorization: 'Bearer ' + a.token } })).json()).me?.pins || []; if (!pins.length) await sleep(150); }
  ok(pins.some((x) => x.go === 'card:me'), 'Pin it: it’s one of her pins now' + JSON.stringify(pins));
  ok(await A.until(`!document.querySelector('#myCard .mycard-pin')`), 'and the full screen stops offering to pin it');
  await A.tap(`document.querySelector('#myCard .mycard-home')`);
  ok(await A.until(`document.querySelector('#sheet .card-home-open')?.getAttribute('href')?.endsWith('/c/maria-lopez/show')`), 'Put it on my Home Screen: steps, and the page to add');
  await A.ev(`closeSheet?.(); true`).catch(() => {});
  await A.key('Escape');
  ok(await A.until(`!document.querySelector('#myCard')`), 'Esc closes it');
  // From the pin, and from the app's own shortcut (/?go=mycard, held icon on Android).
  ok(await A.until(`!!document.querySelector('.pins-btn')`), '(the pins button is there)');
  await A.ev(`location.href = ${JSON.stringify(APP + '?go=mycard')}; true`);
  ok(await A.until(`document.querySelector('#myCard img.mycard-qr')?.naturalWidth > 100`, 15000), 'the app opened at /?go=mycard shows the card straight away');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  ok(await A.ev(`(() => { const q = document.querySelector('#myCard .mycard-qr').getBoundingClientRect(); return q.width >= 300 && q.right <= innerWidth && [...document.querySelectorAll('#myCard *')].every((x) => x.getBoundingClientRect().right <= innerWidth + 1); })()`), 'on a phone: a big code that fits the screen');
  await A.cmd('Emulation.clearDeviceMetricsOverride');
  await A.key('Escape');
  await A.until(`!document.querySelector('#myCard')`);
  await A.tap(`document.querySelector('#settingsBtn')`);
  await A.tap(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent === 'Business')`);
  await A.tap(`document.querySelector('#settings [data-biz=cards] button')`);
  await A.until(`!!document.querySelector('#split .card-status')`);
  ok(await A.ev(`document.querySelector('#split .card-link input')?.value === 'Book a time' && document.querySelectorAll('#split .card-link input')[1].value === 'https://cal.com/maria'`), 'the link was kept, made whole');
  // Phone width: nothing wider than the screen.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.ev(`document.querySelector('#sheet .sheet') && closeSheet?.()`).catch(() => {});
  await A.key('Escape');
  await sleep(400);
  ok(await A.ev(`(() => { const el = document.querySelector('#split'); return [...el.querySelectorAll('*')].every((x) => x.getBoundingClientRect().right <= innerWidth + 1); })()`), 'the editor fits a phone screen');
  const shot = await A.cmd('Page.captureScreenshot', { format: 'png' });
  FS.writeFileSync(DIR + '/editor-phone.png', Buffer.from(shot.result.data, 'base64'));
  ok(!A.errors.length, 'no script errors in the app' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
  // The card page itself.
  const C = await tab(APP + 'c/maria-lopez');
  await C.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  ok(await C.until(`document.querySelector('h1')?.textContent === 'Maria Lopez' && !document.getElementById('shareBtn').hidden`), 'the card page opens, and its script shows Share');
  ok(await C.ev(`!!document.querySelector('a.save[href="/c/maria-lopez.vcf"]') && !!document.querySelector('a[href="tel:6025550142"]') && !!document.querySelector('form[action^="/c/maria-lopez"]')`), 'with Save contact, Call and Share your info');
  ok(await C.ev(`document.documentElement.scrollWidth <= innerWidth`), 'and it fits a phone screen');
  const shot2 = await C.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  FS.writeFileSync(DIR + '/card-phone.png', Buffer.from(shot2.result.data, 'base64'));
  ok(!C.errors.length, 'no script errors on the card page' + (C.errors.length ? ': ' + C.errors.join(' | ') : ''));
  // The page for the Home Screen: just the code and Share.
  const P = await tab(APP + 'c/maria-lopez/show');
  await P.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  ok(await P.until(`document.querySelector('img.qr')?.naturalWidth > 100 && !document.getElementById('shareBtn').hidden && document.querySelector('h1')?.textContent === 'Maria Lopez'`), 'the Home Screen page: the QR code, her name, Share');
  ok(await P.ev(`document.querySelector('link[rel=manifest]')?.getAttribute('href') === '/c/maria-lopez/manifest.webmanifest' && document.documentElement.scrollWidth <= innerWidth`), 'with its own manifest, and it fits a phone');
  ok(!P.errors.length, 'no script errors on it' + (P.errors.length ? ': ' + P.errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  chrome.kill();
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
